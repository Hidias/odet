-- 0512 : financeur du devis repris sur la session préparée à la signature (relevé par la relecture de #323).
-- Défaut : app.devis_prepare_sessions (signature en ligne, dépôt du devis signé) ne recopiait que funding_type ; le nom du
-- financeur, l'OPCO lié, la référence et la date d'accord, la subrogation et le montant pris en charge étaient perdus,
-- alors que la création depuis l'écran (Quotes.jsx) crée la ligne de financement de la session.
-- Correctif : corps de 0499 repris tel qu'en production, à l'identique sauf deux points : quand le devis donne le montant
-- pris en charge, une ligne session_fundings est créée avec la même règle que l'écran (part de la session au prorata,
-- plafonnée au prix de la session ; subrogation et OPCO lié pour un OPCO seulement) ; sans montant, la note de la session
-- nomme le financeur et demande de compléter le montant. Rien ne change pour un devis sans financement.
-- Retour arrière : supabase/rollback/0512_session_devis_financeur_retour.sql (corps de 0499).

CREATE OR REPLACE FUNCTION app.devis_prepare_sessions(p_quote uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_total numeric;
  v_part numeric;
  v_note text;
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
    v_total := round(coalesce(it.quantity, 1) * coalesce(it.unit_price_ht, 0) * (1 - coalesce(q.discount_percent, 0) / 100), 2);
    -- Financeur prévu au devis (0512), même règle que la création depuis l'écran (Quotes.jsx) : part de la session au
    -- prorata du montant pris en charge donné par le devis ; sans montant, rien n'est créé et la note de la session le dit
    v_part := null;
    v_note := 'Préparée depuis le devis signé ' || coalesce(q.reference, '') || ' : dates et formateur à confirmer.';
    if q.funding_type is not null then
      if coalesce(q.funding_amount_ht, 0) > 0 and coalesce(q.total_ht, 0) > 0 and v_total > 0 then
        v_part := round(v_total * least(1, q.funding_amount_ht / q.total_ht), 2);
      end if;
      if coalesce(v_part, 0) <= 0 then
        v_part := null;
        v_note := v_note || ' Financeur prévu au devis' || coalesce(' : ' || nullif(btrim(q.funding_name), ''), '')
          || coalesce(' (accord ' || nullif(btrim(q.funding_agreement_ref), '') || ')', '')
          || ', montant pris en charge à compléter dans la session.';
      end if;
    end if;
    insert into public.sessions (course_id, client_id, contact_id, quote_id, trainer_id, company_id, start_date, end_date,
      start_time, end_time,
      status, is_intra, session_type, day_type, location_name, location_address, location_postal_code, location_city,
      total_price, funding_type, validation_requise, notes)
    values (it.course_id, q.client_id, q.contact_id, q.id, it.default_trainer_id, q.company_id, v_debut, v_debut + (v_jours - 1),
      time '09:00', case when v_jours = 1 and v_h < 6 then time '09:00' + make_interval(mins => round(v_h * 60)::int) else time '17:00' end,
      'planned', true, 'intra', case when v_jours = 1 and v_h <= 4.5 then 'half' else 'full' end,
      c.name, c.address, c.postal_code, c.city,
      v_total, v_fund, true, v_note)
    returning id into v_id;
    if v_part is not null then
      insert into public.session_fundings (session_id, company_id, funder_type, funder_name, funder_client_id, dossier_number,
        agreement_date, subrogation, amount_ht, percentage, notes, status)
      values (v_id, q.company_id,
        case q.funding_type when 'opco' then 'opco' when 'cpf' then 'cpf' when 'france_travail' then 'pole_emploi'
          when 'region' then 'region' else 'autre' end,
        nullif(btrim(q.funding_name), ''), case when q.funding_type = 'opco' then q.funding_client_id end,
        nullif(btrim(q.funding_agreement_ref), ''), q.funding_agreement_date,
        q.funding_type = 'opco' and coalesce(q.funding_subrogation, false),
        v_part, round(v_part / v_total * 100, 2), 'Repris du devis ' || coalesce(q.reference, ''), 'pending');
    end if;
    v_n := v_n + 1;
    insert into public.notifications (company_id, type, title, message, link, metadata)
    values (q.company_id, 'session_a_valider', 'Session à valider',
      'Devis ' || coalesce(q.reference, '') || ' signé par ' || coalesce(c.name, 'le client') || ' : session préparée, confirmez les dates et le formateur.',
      '/sessions/' || v_id, jsonb_build_object('session_id', v_id, 'quote_id', q.id));
  end loop;
  return v_n;
end
$function$;

revoke all on function app.devis_prepare_sessions(uuid) from public, anon, authenticated;

insert into public.schema_migrations (version) values ('0512_session_devis_financeur') on conflict (version) do nothing;
