-- 0499 : deux restes connus du 07/11 (journal V24).
-- 1. Session préparée depuis un devis signé (0430, 0498) : le financement « Autre financeur » du devis (autre) était
--    changé en « aucun » (none), car la session n'accepte que other. Il devient other. Aucun devis de ce type en
--    production le 07/11 (vérifié), sessions déjà préparées inchangées.
-- 2. Documents qualité publiés (0036) : la liste fermée lisible depuis les devis, le portail et l'espace client
--    s'étend aux documents joints aux devis par métier (DOCS_PAR_METIER de src/modules/commercial/lib/metierDevis.js) :
--    cgv-maintenance, cgv-vente, cgv-installation, perimetre-maintenance, garantie-vente. Sans cela, une version
--    validée de ces documents serait jointe comme « non validée ». Aucune version enregistrée en production le 07/11.
--    Les procédures internes restent hors de la liste.

-- 1. Financement « Autre financeur »
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
  -- Le devis propose « Autre financeur » (autre), la session l'écrit other (0499)
  if v_fund = 'autre' then v_fund := 'other'; end if;
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

-- 2. Documents qualité publiés
create or replace function public.published_quality_doc(p_doc_id text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('content', v.content, 'version', v.version, 'validated_at', v.validated_at)
    from public.quality_doc_versions v
   where v.doc_id = p_doc_id
     and p_doc_id in ('reglement', 'livret-court', 'livret-complet', 'cgv', 'charte-egalite',
                      'cgv-maintenance', 'cgv-vente', 'cgv-installation', 'perimetre-maintenance', 'garantie-vente')
   order by v.version desc
   limit 1
$$;
grant execute on function public.published_quality_doc(text) to anon, authenticated;

insert into public.schema_migrations (version) values ('0499_financement_autre_docs_publies') on conflict (version) do nothing;
