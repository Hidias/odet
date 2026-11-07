-- Retour arrière de 0498 : fonctions d'avant (0404, 0430, 0496) remises, refus « ne se signe plus » retiré, fonctions
-- nouvelles retirées. Les sessions déjà préparées gardent leurs dates et horaires ; le signataire figé d'un devis
-- publié reste dans sa colonne, sans être lu (0496 ne lit que les groupes).

do $do$
declare
  v_def text := pg_get_functiondef('app.portail_signer_document(uuid,text,uuid,uuid,uuid,text,text,text,text)'::regprocedure);
  a1 text := $a$  if v_ex is not null then return jsonb_build_object('id', v_ex, 'deja', true); end if;
  -- Document qui ne se signe plus (0498) : devis accepté ou refusé, groupe annulé ou document signé sur papier
  if not app.document_signable(d) then
    raise exception 'Ce document ne se signe plus : contactez votre interlocuteur' using errcode = '22023';
  end if;
$a$;
  b1 text := $b$  if v_ex is not null then return jsonb_build_object('id', v_ex, 'deja', true); end if;
$b$;
begin
  if position(a1 in v_def) = 0 then return; end if;
  execute replace(v_def, a1, b1);
end
$do$;
revoke all on function app.portail_signer_document(uuid, text, uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;

create or replace function app.portail_documents_client(p_client uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'object_type', d.object_type, 'object_id', d.object_id, 'kind', d.kind,
      'label', d.label, 'published_at', d.published_at, 'sha256', d.sha256, 'size_bytes', d.size_bytes) order by d.published_at desc), '[]'::jsonb)
  from public.client_shared_documents d
  where d.client_id = p_client and d.withdrawn_at is null
$$;
revoke all on function app.portail_documents_client(uuid) from public, anon, authenticated;

create or replace function app.signataire_du_groupe(p_group uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when r->>'name' is not null and r->>'name' <> '' then r end
  from (
    select case when g.kind = 'particulier'
      then jsonb_build_object('name', btrim(coalesce(cl.name, '')), 'role', '')
      else (
        select jsonb_build_object(
          'name', coalesce(nullif(btrim(c.name), ''), btrim(concat_ws(' ', nullif(btrim(c.first_name), ''), nullif(btrim(c.last_name), '')))),
          'role', btrim(coalesce(nullif(btrim(c.fonction), ''), c.role, '')))
        from public.client_contacts c
        where c.id = g.contact_id and c.client_id = g.client_id)
      end as r
    from public.session_groups g
    join public.clients cl on cl.id = g.client_id
    where g.id = p_group
  ) x
$$;
revoke all on function app.signataire_du_groupe(uuid) from public, anon, authenticated;

create or replace function app.document_signataire_prevu()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.object_type = 'session_group' then
    new.signataire_prevu := app.signataire_du_groupe(new.object_id);
  else
    new.signataire_prevu := null;
  end if;
  return new;
end
$$;
revoke all on function app.document_signataire_prevu() from public, anon, authenticated;

create or replace function app.signataire_prevu(p_client uuid, p_document uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select d.signataire_prevu
    from public.client_shared_documents d
    join public.session_groups g on g.id = d.object_id
    where d.id = p_document and d.client_id = p_client and d.object_type = 'session_group'
      and d.withdrawn_at is null and g.client_id = p_client and g.status is distinct from 'cancelled'
  ), '{}'::jsonb)
$$;
revoke all on function app.signataire_prevu(uuid, uuid) from public, anon, authenticated;

create or replace function app.devis_prepare_sessions(p_quote uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
  c public.clients;
  it record;
  v_date date;
  v_id uuid;
  v_n int := 0;
  v_fund text;
begin
  select * into q from public.quotes where id = p_quote;
  if q.id is null or q.status not in ('accepted', 'partial') then return 0; end if;
  if exists (select 1 from public.sessions s where s.quote_id = q.id) then return 0; end if;
  select * into c from public.clients where id = q.client_id;
  v_date := coalesce(app.date_fr_du_texte(q.object), coalesce(q.quote_date, current_date) + 30);
  if v_date < current_date then v_date := current_date + 7; end if;
  v_fund := coalesce(nullif(to_jsonb(q) ->> 'funding_type', ''), 'none');
  if v_fund not in ('none', 'opco', 'cpf', 'faf', 'region', 'france_travail', 'ptp', 'fne', 'direct', 'other') then v_fund := 'none'; end if;
  for it in
    select i.*, co.default_trainer_id, co.duration_hours
    from public.quote_items i join public.courses co on co.id = i.course_id
    where i.quote_id = q.id and i.course_id is not null and coalesce(i.accepted, true)
    order by i.position
  loop
    insert into public.sessions (course_id, client_id, contact_id, quote_id, trainer_id, company_id, start_date, end_date,
      status, is_intra, session_type, day_type, location_name, location_address, location_postal_code, location_city,
      total_price, funding_type, validation_requise, notes)
    values (it.course_id, q.client_id, q.contact_id, q.id, it.default_trainer_id, q.company_id, v_date, v_date,
      'planned', true, 'intra', case when coalesce(it.duration_hours, 7) <= 4.5 then 'half' else 'full' end,
      c.name, c.address, c.postal_code, c.city,
      round(coalesce(it.quantity, 1) * coalesce(it.unit_price_ht, 0) * (1 - coalesce(q.discount_percent, 0) / 100), 2), v_fund, true,
      'Préparée depuis le devis signé ' || coalesce(q.reference, '') || ' : dates et formateur à confirmer.')
    returning id into v_id;
    v_n := v_n + 1;
    insert into public.notifications (company_id, type, title, message, link, metadata)
    values (q.company_id, 'session_a_valider', 'Session à valider',
      'Devis ' || coalesce(q.reference, '') || ' signé par ' || coalesce(c.name, 'le client') || ' : session préparée, confirmez les dates et le formateur.',
      '/sessions/' || v_id, jsonb_build_object('session_id', v_id, 'quote_id', q.id));
  end loop;
  return v_n;
end
$$;
revoke all on function app.devis_prepare_sessions(uuid) from public, anon, authenticated;

drop function if exists app.jour_ouvre(uuid, date, int);
drop function if exists app.est_ouvre(uuid, date);
drop function if exists app.signataire_du_devis(uuid);
drop function if exists app.signataire_du_contact(uuid, uuid);
drop function if exists app.document_signable(public.client_shared_documents);

delete from public.schema_migrations where version = '0498_signable_devis_sessions';
