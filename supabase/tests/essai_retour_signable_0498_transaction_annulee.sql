-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (signable_0498) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0498_signable_devis_sessions.sql, retour arrière,
-- comparaison. Se termine TOUJOURS par l'erreur volontaire « RÉSULTAT DE L'ESSAI DU RETOUR ARRIÈRE » : tout est annulé.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

create temp view etat_essai as
  select 'règle' as kind, schemaname || '.' || tablename || '.' || policyname as name,
         md5(concat_ws('|', permissive, roles::text, cmd, qual, with_check)) as v
  from pg_policies where schemaname in ('public', 'storage')
  union all
  select 'fonction', p.oid::regprocedure::text,
         md5(concat_ws('|', pg_get_functiondef(p.oid), p.prosecdef::text, p.proconfig::text,
             (select string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',' order by a.grantee::regrole::text, a.privilege_type)
              from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a)))
  from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace) and p.prokind in ('f', 'p')
  union all
  select 'droits table', c.oid::regclass::text,
         md5(coalesce((select string_agg(a.grantee::regrole::text || ':' || a.privilege_type || ':' || a.is_grantable::text, ','
                               order by a.grantee::regrole::text, a.privilege_type)
                       from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a), '') || c.relrowsecurity::text)
  from pg_class c where c.relnamespace in ('public'::regnamespace, 'app'::regnamespace) and c.relkind in ('r', 'v', 'm', 'p')
  union all
  select 'vue', c.oid::regclass::text, md5(pg_get_viewdef(c.oid) || coalesce(c.reloptions::text, ''))
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
  union all
  select 'colonne', table_schema || '.' || table_name || '.' || column_name, md5(data_type || is_nullable || coalesce(column_default, ''))
  from information_schema.columns where table_schema in ('public', 'app')
  union all
  select 'contrainte', conrelid::regclass::text || '.' || conname, md5(pg_get_constraintdef(oid))
  from pg_constraint where connamespace in ('public'::regnamespace, 'app'::regnamespace)
  union all
  select 'index', indexrelid::regclass::text, md5(pg_get_indexdef(indexrelid))
  from pg_index where indrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace, 'app'::regnamespace))
  union all
  select 'déclencheur', tgrelid::regclass::text || '.' || tgname, md5(tgfoid::regprocedure::text || tgenabled::text)
  from pg_trigger where not tgisinternal
    and tgrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace, 'app'::regnamespace))
  union all
  select 'migrations', 'public.schema_migrations', md5(coalesce(string_agg(version, ',' order by version), ''))
  from public.schema_migrations
  union all
  select 'données', 'organization_settings', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.organization_settings t
  union all
  select 'données', 'profiles', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.profiles t
  union all
  select 'données', 'org_modules', md5(coalesce(string_agg(t::text, ',' order by t.key), '')) from public.org_modules t
  union all
  select 'données', 'company_members', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.company_members t
  union all
  select 'données', 'company_member_roles', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.company_member_roles t;
create temp table etat_essai_avant as select * from etat_essai;

-- ===== supabase/migrations/0498_signable_devis_sessions.sql =====
-- 0498 : espace client et devis signé (constats du 06/11 sur les données d'essai, décisions de H du 06/11 et du 07/11).
-- 1. « À signer » rendu par la base : chaque document de l'espace client porte « signable ». Un devis ne se signe que
--    brouillon ou envoyé (pas accepté, même en partie, ni refusé, expiré, facturé ou remplacé) ; la convention ou le
--    contrat d'un groupe inter ne se signe plus quand le groupe est annulé ou son document marqué signé (sur papier
--    ou en ligne) ; la convention d'une session ne se signe plus quand la session l'a signée ou est annulée ; un contrat
--    de maintenance ne se signe plus une fois signé (papier ou en ligne) ou terminé ; le bon
--    d'intervention garde sa règle (0451). La signature (app.portail_signer_document) refuse un document non signable,
--    après le cas « déjà signé » (réponse inchangée).
-- 2. Signataire prévu d'un devis (extension de 0496) : le contact du devis, s'il appartient au client du devis, figé à
--    la publication. L'écran le pré-remplit et signale un nom différent (« à la place de »), comme pour un groupe.
--    Les devis déjà publiés gardent un signataire vide (2 en production le 07/11, tous deux signés).
-- 3. Session préparée depuis un devis signé (0430) : date par défaut reportée au premier jour ouvré (ni samedi, ni
--    dimanche, ni jour férié non travaillé de la société) ; fin à 9 h plus la durée de la formation pour moins de
--    6 heures (13 h pour 4 heures), 17 h sinon ; une formation de plusieurs jours (jusqu'à 5) tient sur des jours
--    ouvrés qui se suivent, car l'émargement compte chaque jour du calendrier entre le début et la fin.
--    Une date écrite dans l'objet du devis reste celle du client. Sessions déjà préparées inchangées.

-- 1. Document signable
create or replace function app.document_signable(d public.client_shared_documents)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when d.id is null or d.withdrawn_at is not null then false
    when d.kind = 'devis' then d.object_type = 'quote'
      and exists (select 1 from public.quotes q where q.id = d.object_id and q.status in ('draft', 'sent'))
    when d.kind = 'contrat' and d.object_type = 'session_group' then exists (select 1 from public.session_groups g
      where g.id = d.object_id and g.client_id = d.client_id and g.status is distinct from 'cancelled' and g.doc_status is distinct from 'signe')
    when d.kind = 'contrat' and d.object_type = 'session' then exists (select 1 from public.sessions s
      where s.id = d.object_id and not coalesce(s.convention_signed, false) and s.status is distinct from 'cancelled')
    when d.kind = 'contrat' and d.object_type = 'itv_contract' then exists (select 1 from public.itv_contracts k
      where k.id = d.object_id and k.signed_at is null and k.status is distinct from 'termine')
    when d.kind = 'contrat' then true
    when d.kind = 'rapport' then d.object_type = 'itv_visit' and exists (select 1 from public.itv_visits v where v.id = d.object_id
      and v.status = 'terminee' and v.client_signature is null and v.remote_signature_requested_at is not null and v.remote_signed_at is null)
    else false
  end
$$;
revoke all on function app.document_signable(public.client_shared_documents) from public, anon, authenticated;

-- Liste des documents de l'espace client (0404) : « signable » en plus
create or replace function app.portail_documents_client(p_client uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'object_type', d.object_type, 'object_id', d.object_id, 'kind', d.kind,
      'label', d.label, 'published_at', d.published_at, 'sha256', d.sha256, 'size_bytes', d.size_bytes,
      'signable', app.document_signable(d)) order by d.published_at desc), '[]'::jsonb)
  from public.client_shared_documents d
  where d.client_id = p_client and d.withdrawn_at is null
$$;
revoke all on function app.portail_documents_client(uuid) from public, anon, authenticated;

-- Signature : refus d'un document qui ne se signe plus
do $do$
declare
  v_def text := pg_get_functiondef('app.portail_signer_document(uuid,text,uuid,uuid,uuid,text,text,text,text)'::regprocedure);
  a1 text := $a$  if v_ex is not null then return jsonb_build_object('id', v_ex, 'deja', true); end if;
$a$;
  b1 text := $b$  if v_ex is not null then return jsonb_build_object('id', v_ex, 'deja', true); end if;
  -- Document qui ne se signe plus (0498) : devis accepté ou refusé, groupe annulé ou document signé sur papier
  if not app.document_signable(d) then
    raise exception 'Ce document ne se signe plus : contactez votre interlocuteur' using errcode = '22023';
  end if;
$b$;
begin
  if position('(0498)' in v_def) > 0 then return; end if;
  if position(a1 in v_def) = 0 then
    raise exception 'Fonction portail_signer_document inattendue : rien n''est changé';
  end if;
  execute replace(v_def, a1, b1);
end
$do$;
revoke all on function app.portail_signer_document(uuid, text, uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;

-- 2. Signataire d'un contact du client (nom fait du prénom et du nom si besoin, fonction), partagé par le groupe et le devis
create or replace function app.signataire_du_contact(p_contact uuid, p_client uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'name', coalesce(nullif(btrim(c.name), ''), btrim(concat_ws(' ', nullif(btrim(c.first_name), ''), nullif(btrim(c.last_name), '')))),
    'role', btrim(coalesce(nullif(btrim(c.fonction), ''), c.role, '')))
  from public.client_contacts c
  where c.id = p_contact and c.client_id = p_client
$$;
revoke all on function app.signataire_du_contact(uuid, uuid) from public, anon, authenticated;

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
      else app.signataire_du_contact(g.contact_id, g.client_id)
      end as r
    from public.session_groups g
    join public.clients cl on cl.id = g.client_id
    where g.id = p_group
  ) x
$$;
revoke all on function app.signataire_du_groupe(uuid) from public, anon, authenticated;

create or replace function app.signataire_du_devis(p_quote uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when r->>'name' is not null and r->>'name' <> '' then r end
  from (select app.signataire_du_contact(q.contact_id, q.client_id) as r from public.quotes q where q.id = p_quote) x
$$;
revoke all on function app.signataire_du_devis(uuid) from public, anon, authenticated;

create or replace function app.document_signataire_prevu()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.object_type = 'session_group' then
    new.signataire_prevu := app.signataire_du_groupe(new.object_id);
  elsif new.object_type = 'quote' and new.kind = 'devis' then
    -- Devis (0498) : le contact du devis, s'il appartient au client à qui le devis est publié
    new.signataire_prevu := case when exists (select 1 from public.quotes q where q.id = new.object_id and q.client_id = new.client_id)
      then app.signataire_du_devis(new.object_id) end;
  else
    new.signataire_prevu := null;
  end if;
  return new;
end
$$;
revoke all on function app.document_signataire_prevu() from public, anon, authenticated;

-- Lecture : le signataire figé d'un document de ce client encore à signer (groupe ou devis)
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
    where d.id = p_document and d.client_id = p_client and d.object_type in ('session_group', 'quote')
      and app.document_signable(d)
  ), '{}'::jsonb)
$$;
revoke all on function app.signataire_prevu(uuid, uuid) from public, anon, authenticated;

-- 3. Jour ouvré de la société : ni samedi, ni dimanche, ni jour férié non travaillé saisi pour la société
create or replace function app.est_ouvre(p_company uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select extract(isodow from p_date) < 6 and not exists (select 1 from public.hr_public_holidays h
    where h.company_id = p_company and h.day = p_date and not h.is_worked)
$$;
revoke all on function app.est_ouvre(uuid, date) from public, anon, authenticated;

-- Premier jour à partir de p_date qui ouvre p_jours jours ouvrés qui se suivent (1 à 5) ; au-delà de 5 jours, ou rien
-- trouvé en 400 jours, le premier jour ouvré. Nombre de tours borné.
create or replace function app.jour_ouvre(p_company uuid, p_date date, p_jours int default 1)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_n int := least(greatest(coalesce(p_jours, 1), 1), 5);
  v date;
  k int;
  ok boolean;
begin
  if p_date is null or not isfinite(p_date) then return p_date; end if;
  for i in 0 .. 400 loop
    v := p_date + i;
    ok := true;
    for k in 0 .. v_n - 1 loop
      if not app.est_ouvre(p_company, v + k) then ok := false; exit; end if;
    end loop;
    if ok then return v; end if;
  end loop;
  for i in 0 .. 400 loop
    if app.est_ouvre(p_company, p_date + i) then return p_date + i; end if;
  end loop;
  return p_date;
end
$$;
revoke all on function app.jour_ouvre(uuid, date, int) from public, anon, authenticated;

-- Devis signé : sessions préparées (une par ligne de formation acceptée), une seule fois par devis
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
  v_texte date;
  v_id uuid;
  v_n int := 0;
  v_fund text;
  v_h numeric;
  v_jours int;
  v_debut date;
begin
  select * into q from public.quotes where id = p_quote;
  if q.id is null or q.status not in ('accepted', 'partial') then return 0; end if;
  if exists (select 1 from public.sessions s where s.quote_id = q.id) then return 0; end if;
  select * into c from public.clients where id = q.client_id;
  -- Date écrite dans l'objet du devis : celle du client ; sinon devis + 30 jours, au premier jour ouvré (0498)
  v_texte := app.date_fr_du_texte(q.object);
  v_date := coalesce(v_texte, coalesce(q.quote_date, current_date) + 30);
  if v_date < current_date then v_date := current_date + 7; v_texte := null; end if;
  v_fund := coalesce(nullif(to_jsonb(q) ->> 'funding_type', ''), 'none');
  if v_fund not in ('none', 'opco', 'cpf', 'faf', 'region', 'france_travail', 'ptp', 'fne', 'direct', 'other') then v_fund := 'none'; end if;
  for it in
    select i.*, co.default_trainer_id, co.duration_hours, co.duration_days
    from public.quote_items i join public.courses co on co.id = i.course_id
    where i.quote_id = q.id and i.course_id is not null and coalesce(i.accepted, true)
    order by i.position
  loop
    -- Horaires selon la durée (0498) : 9 h plus la durée sous 6 heures, journée de 9 h à 17 h sinon, sur autant de
    -- jours ouvrés que la formation en demande
    v_h := coalesce(nullif(it.duration_hours, 0), 7);
    v_jours := greatest(coalesce(it.duration_days, 1), ceil(v_h / 7.0)::int, 1);
    -- Début : la date écrite dans l'objet du devis, sinon le premier jour qui ouvre assez de jours ouvrés à la suite
    v_debut := case when v_texte is null then app.jour_ouvre(q.company_id, v_date, v_jours) else v_date end;
    insert into public.sessions (course_id, client_id, contact_id, quote_id, trainer_id, company_id, start_date, end_date,
      start_time, end_time,
      status, is_intra, session_type, day_type, location_name, location_address, location_postal_code, location_city,
      total_price, funding_type, validation_requise, notes)
    values (it.course_id, q.client_id, q.contact_id, q.id, it.default_trainer_id, q.company_id, v_debut, v_debut + (v_jours - 1),
      time '09:00', case when v_jours = 1 and v_h < 6 then time '09:00' + make_interval(mins => round(v_h * 60)::int) else time '17:00' end,
      'planned', true, 'intra', case when v_jours = 1 and v_h <= 4.5 then 'half' else 'full' end,
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

insert into public.schema_migrations (version) values ('0498_signable_devis_sessions') on conflict (version) do nothing;

-- ===== supabase/rollback/0498_signable_devis_sessions_retour.sql =====
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

do $verif$
declare
  v_diff text[];
  v_n int;
  v_par text;
begin
  select count(*), (array_agg(coalesce(a.kind, b.kind) || ' ' || coalesce(a.name, b.name) || case
           when a.name is null then ' (en trop après retour)' when b.name is null then ' (manquant après retour)'
           else ' (différent)' end order by coalesce(a.kind, b.kind) desc, coalesce(a.name, b.name)))[1:40]
    into v_n, v_diff
  from etat_essai_avant a full join etat_essai b on a.kind = b.kind and a.name = b.name
  where a.v is distinct from b.v;
  select string_agg(k || ' ' || n, ', ') into v_par from (
    select coalesce(a.kind, b.kind) k, count(*) n
    from etat_essai_avant a full join etat_essai b on a.kind = b.kind and a.name = b.name
    where a.v is distinct from b.v group by 1) z;
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE signable_0498 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
