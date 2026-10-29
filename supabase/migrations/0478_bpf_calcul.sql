-- 0478 : BPF, corrections de la relecture indépendante de 0477 ; stock, relecture de #255.
-- 1. Calcul du BPF (bpf_calculer, corps de 0477 repris, seules ces règles changent) :
--    - avoir rangé sur la ligne de la facture qu'il corrige, même si elle date de l'exercice précédent ;
--    - CPF avant « particulier » (C-2-e) ;
--    - OPCO en C-2-h seulement quand l'OPCO paie (groupe, facture adressée à l'OPCO, subrogation) ; facture à
--      l'entreprise sans subrogation avec prise en charge OPCO : C-1, signalée (décision de H du 29/10) ;
--    - catégorie F-1 d'après le payeur ou le client du groupe (session inter) ;
--    - sous-traitance reçue saisie sans liste de stagiaires : comptée en G (nombre de stagiaires de la session) ;
--    - heures arrondies par participation, totaux C et C-2 égaux à la somme des lignes arrondies ;
--    - année rendue avec le calcul.
-- 2. Déclaration : une fois déposée, plus modifiable ni supprimable (seule la réouverture est permise) ; calcul
--    enregistré sous son année et sa société.
-- 3. Livraison d'un devis (0468) : réservation du stock sérialisée par article.
-- Retour arrière : supabase/rollback/0478_bpf_calcul_retour.sql.

-- ── 1. Calcul du BPF ──
create or replace function public.bpf_calculer(p_annee integer, p_company uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cie uuid := coalesce(p_company, app.current_company());
  v_mois integer;
  v_debut date;
  v_fin date;
  v_lignes jsonb := '{}'::jsonb;
  v_detail jsonb := '{}'::jsonb;
  v_c_total numeric := 0;
  v_ca_total numeric := 0;
  v_part integer := null;
  r record;
begin
  -- Chiffre d'affaires et charges : réservé à ceux qui gèrent les registres qualité, dans cette société
  if v_cie is null then raise exception 'Choisissez une société : le BPF se fait société par société'; end if;
  perform app.require_right('qualite.registres.gerer');
  -- Pas d'exception pour le super administrateur : a_le_droit_dans passe par les sociétés visibles (accès de support)
  if not app.a_le_droit_dans(v_cie, 'qualite.registres.gerer') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if p_annee is null or p_annee < 2000 or p_annee > 2100 then raise exception 'Année invalide'; end if;

  select fiscal_year_start_month into v_mois from public.companies where id = v_cie;
  if v_mois is null then raise exception 'Société inconnue'; end if;
  if v_mois = 1 then
    v_debut := make_date(p_annee, 1, 1);
  else
    v_debut := make_date(p_annee - 1, v_mois, 1);
  end if;
  v_fin := (v_debut + interval '1 year' - interval '1 day')::date;

  -- ── Cadre C : produits de formation (factures émises de l'exercice, avoirs déduits, HT) ──
  -- Classement de chaque facture de l'exercice et de la facture d'origine de ses avoirs : un avoir suit la ligne et la
  -- nature (formation ou non) de la facture qu'il corrige (relecture indépendante de 0477)
  create temporary table if not exists pg_temp.bpf_cls (id uuid, formation boolean, ligne text, motif text, a_verifier boolean) on commit drop;
  truncate pg_temp.bpf_cls;
  insert into pg_temp.bpf_cls
  select i.id, coalesce(i.is_formation_pro, true), x.ligne, x.motif, (x.a_verifier and x.ligne = 'C-1')
  from public.invoices i
  left join public.clients c on c.id = i.client_id
  left join public.clients cb on cb.id = i.billing_client_id
  left join public.sessions s on s.id = i.session_id
  left join public.quotes q on q.id = i.quote_id
  left join public.session_groups g on g.id = i.session_group_id
  cross join lateral (
    select
      (coalesce(s.funding_type, '') = 'opco' or coalesce(q.funding_type, '') = 'opco') as fin_opco,
      (coalesce(g.payer_kind, '') = 'opco' or coalesce(cb.client_type, '') = 'opco' or coalesce(c.client_type, '') = 'opco'
        or coalesce(i.is_subrogation, false)) as paye_opco
  ) o
  cross join lateral (
    -- Payeur réel d'abord (groupe d'une session inter : 0044), puis financement de la session ou du devis.
    -- CPF avant le particulier : les fonds viennent du compte personnel (C-2-e), pas de la poche du stagiaire.
    -- OPCO : C-2-h seulement quand l'OPCO est le payeur (groupe, facture adressée à l'OPCO, subrogation) ; facture à
    -- l'entreprise sans subrogation : C-1, signalée (décision de H du 29/10, lecture à confirmer par la DREETS).
    select case
      when g.payer_kind = 'france_travail' then 'C-7'
      when coalesce(s.funding_type, '') = 'cpf' or coalesce(q.funding_type, '') = 'cpf' then 'C-2-e'
      when g.payer_kind = 'particulier' or (g.payer_kind is null and c.client_type = 'particulier') then 'C-9'
      when g.payer_kind = 'opco' then 'C-2-h'
      when c.client_type = 'organisme_formation' or s.session_type = 'subcontract' then 'C-10'
      when s.funding_type = 'ptp' then 'C-2-d'
      when s.funding_type = 'faf' then 'C-2-g'
      when s.funding_type = 'region' or q.funding_type = 'region' then 'C-6'
      when s.funding_type = 'france_travail' or q.funding_type = 'france_travail' then 'C-7'
      when s.funding_type = 'fne' then 'C-5'
      when o.paye_opco then 'C-2-h'
      when c.client_type = 'public' then 'C-3'
      else 'C-1'
    end as ligne,
    case
      when g.payer_kind = 'france_travail' then 'payeur du groupe : france_travail'
      when coalesce(s.funding_type, '') = 'cpf' or coalesce(q.funding_type, '') = 'cpf' then 'compte personnel de formation'
      when g.payer_kind in ('particulier', 'opco') then 'payeur du groupe : ' || g.payer_kind
      when c.client_type = 'particulier' then 'client particulier'
      when c.client_type = 'organisme_formation' or s.session_type = 'subcontract' then 'pour le compte d''un autre organisme'
      when coalesce(s.funding_type, '') in ('ptp', 'faf', 'region', 'france_travail', 'fne') then 'financement de la session : ' || s.funding_type
      when coalesce(q.funding_type, '') in ('region', 'france_travail') then 'financement prévu au devis : ' || q.funding_type
      when o.paye_opco and coalesce(i.is_subrogation, false) then 'subrogation OPCO'
      when o.paye_opco then 'facturé à l''OPCO'
      when c.client_type = 'public' then 'client public (agents)'
      when o.fin_opco then 'employeur facturé sans subrogation, prise en charge OPCO prévue : à vérifier'
      else 'employeur (par défaut)'
    end as motif,
    (o.fin_opco and not o.paye_opco) as a_verifier
  ) x
  where i.company_id = v_cie
    and (i.invoice_date between v_debut and v_fin
         or i.id in (select a.parent_invoice_id from public.invoices a
                     where a.company_id = v_cie and a.type = 'credit_note' and a.parent_invoice_id is not null
                       and a.status not in ('draft', 'cancelled') and a.invoice_date between v_debut and v_fin));

  create temporary table if not exists pg_temp.bpf_fac (id uuid, reference text, ht numeric, formation boolean, ligne text, motif text, a_verifier boolean) on commit drop;
  truncate pg_temp.bpf_fac;
  insert into pg_temp.bpf_fac
  select i.id, i.reference,
         case when i.type = 'credit_note' then -abs(coalesce(i.total_net_ht, i.total_ht, 0)) else coalesce(i.total_net_ht, i.total_ht, 0) end,
         coalesce(pc.formation, ic.formation),
         coalesce(pc.ligne, ic.ligne),
         case when pc.id is not null then 'avoir sur ' || coalesce(p.reference, 'facture d''origine') || ' : ' || pc.motif else ic.motif end,
         coalesce(pc.a_verifier, ic.a_verifier)
  from public.invoices i
  join pg_temp.bpf_cls ic on ic.id = i.id
  left join public.invoices p on i.type = 'credit_note' and p.id = i.parent_invoice_id and p.company_id = v_cie
  left join pg_temp.bpf_cls pc on pc.id = p.id
  where i.company_id = v_cie
    and i.status not in ('draft', 'cancelled')
    and i.invoice_date between v_debut and v_fin;

  for r in select ligne, round(sum(ht)) as montant, count(*) as nb from pg_temp.bpf_fac where formation group by ligne loop
    v_lignes := v_lignes || jsonb_build_object(r.ligne, r.montant);
  end loop;
  v_lignes := v_lignes || jsonb_build_object('C-2', (
    select coalesce(sum(m), 0) from (select round(sum(ht)) as m from pg_temp.bpf_fac where formation and ligne like 'C-2-%' group by ligne) t));
  select coalesce(sum(m), 0) into v_c_total from (select round(sum(ht)) as m from pg_temp.bpf_fac where formation group by ligne) t;
  select coalesce(round(sum(ht)), 0) into v_ca_total from pg_temp.bpf_fac;
  v_lignes := v_lignes || jsonb_build_object('C', v_c_total);
  if v_ca_total > 0 and v_c_total > 0 then
    v_part := greatest(1, round(100 * v_c_total / v_ca_total));
  end if;
  v_detail := v_detail || jsonb_build_object('C', coalesce((
    select jsonb_agg(jsonb_build_object('facture', reference, 'ligne', ligne, 'ht', round(ht, 2), 'motif', motif, 'a_verifier', a_verifier) order by ligne, reference)
    from pg_temp.bpf_fac where formation), '[]'::jsonb),
    'hors_formation', (select count(*) from pg_temp.bpf_fac where not formation));

  -- ── Participations des actions de l'exercice (cadres F et G) ──
  create temporary table if not exists pg_temp.bpf_part (session_id uuid, reference text, trainee_id uuid, sous_traitance_recue boolean,
    categorie text, heures numeric, heures_source text, objectif text, niveau integer, nsf text, course_title text) on commit drop;
  truncate pg_temp.bpf_part;
  -- Catégorie : saisie, sinon le payeur ou le client du groupe (session inter), sinon le client de la session.
  -- Heures arrondies à l'heure par participation : F-1, F-3 et F-4 se recoupent exactement (notice : totaux égaux).
  insert into pg_temp.bpf_part
  select s.id, s.reference, st.trainee_id,
         (coalesce(s.session_type = 'subcontract', false) or coalesce(c.client_type = 'organisme_formation', false)),
         coalesce(st.bpf_categorie, case
           when g.payer_kind = 'france_travail' then 'c'
           when g.payer_kind = 'particulier' or coalesce(gc.client_type, c.client_type) = 'particulier' then 'd'
           when coalesce(gc.client_type, c.client_type) = 'public' then 'e'
           else 'a' end),
         round(coalesce(h.hours, co.duration_hours, 0)),
         case when h.hours is not null then 'document émis' else 'durée prévue' end,
         co.bpf_objectif, co.bpf_rncp_niveau, co.nsf_code, coalesce(co.title, s.subcontract_course_title)
  from public.sessions s
  join public.session_trainees st on st.session_id = s.id and not coalesce(st.absent, false)
  left join public.session_groups g on g.id = st.group_id
  left join public.clients gc on gc.id = coalesce(g.payer_client_id, g.client_id)
  left join public.clients c on c.id = s.client_id
  left join public.courses co on co.id = s.course_id
  left join lateral (
    select d.hours from public.training_documents_issued d
    where d.session_id = s.id and d.trainee_id = st.trainee_id and d.hours is not null
    order by case d.kind when 'attestation' then 1 when 'certificat' then 2 else 3 end, d.version desc
    limit 1
  ) h on true
  where s.company_id = v_cie
    and coalesce(s.status, '') not in ('cancelled', 'canceled', 'annule', 'annulee')
    and coalesce(s.end_date, s.start_date) between v_debut and least(v_fin, current_date);

  -- Sous-traitance reçue saisie sans liste de stagiaires (nombre seul, formation souvent hors catalogue) : comptée en G
  -- avec la durée de la formation quand elle est connue ; sinon 0 heure et la session est signalée à compléter
  insert into pg_temp.bpf_part
  select s.id, s.reference, null, true, null,
         round(coalesce(co.duration_hours, 0)),
         case when co.duration_hours is not null then 'durée prévue' else 'heures inconnues' end,
         co.bpf_objectif, co.bpf_rncp_niveau, co.nsf_code, coalesce(co.title, s.subcontract_course_title)
  from public.sessions s
  cross join lateral generate_series(1, least(greatest(coalesce(s.subcontract_nb_trainees, 0), 0), 1000)) n
  left join public.courses co on co.id = s.course_id
  where s.company_id = v_cie and s.session_type = 'subcontract'
    and not exists (select 1 from public.session_trainees st where st.session_id = s.id)
    and coalesce(s.status, '') not in ('cancelled', 'canceled', 'annule', 'annulee')
    and coalesce(s.end_date, s.start_date) between v_debut and least(v_fin, current_date);

  -- F-1 : type de stagiaires
  for r in select categorie, count(*) as nb, sum(heures) as h from pg_temp.bpf_part where not sous_traitance_recue group by categorie loop
    v_lignes := v_lignes || jsonb_build_object('F-1-' || r.categorie, jsonb_build_object('stagiaires', r.nb, 'heures', r.h));
  end loop;
  v_lignes := v_lignes || jsonb_build_object('F-1', (
    select jsonb_build_object('stagiaires', count(*), 'heures', coalesce(sum(heures), 0)) from pg_temp.bpf_part where not sous_traitance_recue));

  -- F-3 : objectif général (les formations non classées sont listées, jamais rangées d'office)
  for r in
    select case
             when objectif = 'rncp' and niveau >= 6 then 'F-3-a-6'
             when objectif = 'rncp' and niveau = 5 then 'F-3-a-5'
             when objectif = 'rncp' and niveau = 4 then 'F-3-a-4'
             when objectif = 'rncp' and niveau = 3 then 'F-3-a-3'
             when objectif = 'rncp' and niveau = 2 then 'F-3-a-2'
             when objectif = 'rncp_cqp' then 'F-3-a-cqp'
             when objectif = 'rs' then 'F-3-b'
             when objectif = 'cqp' then 'F-3-c'
             when objectif = 'autre' then 'F-3-d'
             when objectif = 'bilan' then 'F-3-e'
             when objectif = 'vae' then 'F-3-f'
           end as ligne, count(*) as nb, sum(heures) as h
    from pg_temp.bpf_part where not sous_traitance_recue and objectif is not null and (objectif <> 'rncp' or niveau is not null)
    group by 1
  loop
    v_lignes := v_lignes || jsonb_build_object(r.ligne, jsonb_build_object('stagiaires', r.nb, 'heures', r.h));
  end loop;
  v_lignes := v_lignes || jsonb_build_object('F-3-a', (
    select jsonb_build_object('stagiaires', count(*), 'heures', coalesce(sum(heures), 0)) from pg_temp.bpf_part
    where not sous_traitance_recue and ((objectif = 'rncp' and niveau is not null) or objectif = 'rncp_cqp')));
  v_lignes := v_lignes || jsonb_build_object('F-3', (
    select jsonb_build_object('stagiaires', count(*), 'heures', coalesce(sum(heures), 0)) from pg_temp.bpf_part
    where not sous_traitance_recue and objectif is not null and (objectif <> 'rncp' or niveau is not null)));

  -- F-4 : 5 principales spécialités (par heures), le reste en « autres »
  v_lignes := v_lignes || jsonb_build_object('F-4', coalesce((
    with sp as (
      select nsf, count(*) as nb, sum(heures) as h, row_number() over (order by sum(heures) desc, count(*) desc, nsf) as rang
      from pg_temp.bpf_part where not sous_traitance_recue and nsf is not null group by nsf
    )
    select jsonb_build_object(
      'principales', coalesce((select jsonb_agg(jsonb_build_object('code', nsf, 'stagiaires', nb, 'heures', h) order by rang) from sp where rang <= 5), '[]'::jsonb),
      'autres', (select jsonb_build_object('stagiaires', coalesce(sum(nb), 0), 'heures', coalesce(sum(h), 0)) from sp where rang > 5),
      'total', (select jsonb_build_object('stagiaires', coalesce(sum(nb), 0), 'heures', coalesce(sum(h), 0)) from sp))
  ), '{}'::jsonb));

  -- F-2 : actions confiées à un autre organisme (bon de commande à un prestataire « organisme », hors brouillon et
  -- annulé) ; ces stagiaires restent comptés en F-1 (notice : « parmi les actions mentionnées au cadre F-1 »)
  v_lignes := v_lignes || jsonb_build_object('F-2', (
    select jsonb_build_object('stagiaires', count(*), 'heures', coalesce(sum(p.heures), 0))
    from pg_temp.bpf_part p
    where not p.sous_traitance_recue and exists (
      select 1 from public.subcontract_orders o join public.subcontractors su on su.id = o.subcontractor_id
      where o.session_id = p.session_id and o.company_id = v_cie and su.kind = 'organisme'
        and o.status not in ('brouillon', 'annule'))));

  -- G : actions confiées par un autre organisme
  v_lignes := v_lignes || jsonb_build_object('G', (
    select jsonb_build_object('stagiaires', count(*), 'heures', coalesce(sum(heures), 0)) from pg_temp.bpf_part where sous_traitance_recue));

  -- ── Cadre E : personnes qui ont dispensé les heures (intervenant principal et co-intervenants) ──
  v_lignes := v_lignes || jsonb_build_object('E-1', (
    with sess as (
      select distinct s.id, coalesce(co.duration_hours, 0) as h, t.id as tid, (coalesce(t.is_internal, true) and t.subcontractor_id is null) as interne
      from public.sessions s
      left join public.courses co on co.id = s.course_id
      join lateral (select s.trainer_id as id union select x.trainer_id from public.session_trainers x where x.session_id = s.id) tr on tr.id is not null
      join public.trainers t on t.id = tr.id
      where s.company_id = v_cie and coalesce(s.status, '') not in ('cancelled', 'canceled', 'annule', 'annulee')
        and coalesce(s.end_date, s.start_date) between v_debut and least(v_fin, current_date)
    )
    select jsonb_build_object('personnes', count(distinct tid), 'heures', coalesce(round(sum(h)), 0)) from sess where interne));
  v_lignes := v_lignes || jsonb_build_object('E-2', (
    with sess as (
      select distinct s.id, coalesce(co.duration_hours, 0) as h, t.id as tid, (coalesce(t.is_internal, true) and t.subcontractor_id is null) as interne
      from public.sessions s
      left join public.courses co on co.id = s.course_id
      join lateral (select s.trainer_id as id union select x.trainer_id from public.session_trainers x where x.session_id = s.id) tr on tr.id is not null
      join public.trainers t on t.id = tr.id
      where s.company_id = v_cie and coalesce(s.status, '') not in ('cancelled', 'canceled', 'annule', 'annulee')
        and coalesce(s.end_date, s.start_date) between v_debut and least(v_fin, current_date)
    )
    select jsonb_build_object('personnes', count(distinct tid), 'heures', coalesce(round(sum(h)), 0)) from sess where not interne));

  -- B-2 : formation à distance pendant l'exercice
  v_lignes := v_lignes || jsonb_build_object('B-2', exists (
    select 1 from public.sessions s where s.company_id = v_cie and coalesce(s.is_remote, false)
      and coalesce(s.status, '') not in ('cancelled', 'canceled', 'annule', 'annulee')
      and coalesce(s.end_date, s.start_date) between v_debut and least(v_fin, current_date)));

  return jsonb_build_object(
    'cerfa', '10443*17',
    'annee', p_annee,
    'societe', v_cie,
    'exercice', jsonb_build_object('debut', v_debut, 'fin', v_fin),
    'calcule_le', now(),
    'lignes', v_lignes,
    'part_ca', v_part,
    'detail', v_detail || jsonb_build_object(
      'heures_prevues', (select count(*) from pg_temp.bpf_part where heures_source = 'durée prévue'),
      'heures_inconnues', coalesce((select jsonb_agg(distinct reference) from pg_temp.bpf_part where heures_source = 'heures inconnues'), '[]'::jsonb),
      'factures_a_verifier', coalesce((select jsonb_agg(reference order by reference) from pg_temp.bpf_fac where formation and a_verifier), '[]'::jsonb),
      'participations', (select count(*) from pg_temp.bpf_part)),
    'a_classer', jsonb_build_object(
      'objectif', coalesce((select jsonb_agg(distinct course_title) from pg_temp.bpf_part
                            where not sous_traitance_recue and (objectif is null or (objectif = 'rncp' and niveau is null))), '[]'::jsonb),
      'specialite', coalesce((select jsonb_agg(distinct course_title) from pg_temp.bpf_part where not sous_traitance_recue and nsf is null), '[]'::jsonb)),
    'a_saisir', jsonb_build_array('D', 'D-1', 'D-2', 'C-2-a', 'C-2-b', 'C-2-c', 'C-2-f', 'C-4', 'C-8', 'C-11'),
    'hypotheses', jsonb_build_array(
      'Un stagiaire suivi dans deux actions compte deux fois (lecture de la notice, à confirmer auprès de la DREETS).',
      'Heures suivies : celles des documents émis ; sinon la durée prévue de la formation, signalée.',
      'Formateurs : heures = durée de la formation pour chaque session animée ; formateur rattaché à un prestataire = personne extérieure (E-2).',
      'Sessions comptées : terminées à la date du calcul et non annulées, quel que soit leur statut (une session faite dont le statut n''a pas été mis à jour reste comptée).',
      'Avoirs : déduits sur la ligne de la facture qu''ils corrigent.',
      'Facture à l''entreprise sans subrogation avec prise en charge OPCO : rangée en C-1 (employeur) et signalée ; lecture à confirmer auprès de la DREETS.',
      'Heures arrondies à l''heure pour chaque participation, pour que les totaux F-1, F-3 et F-4 se recoupent.')
  );
end
$$;
revoke all on function public.bpf_calculer(integer, uuid) from public, anon;
grant execute on function public.bpf_calculer(integer, uuid) to authenticated;

-- ── 2. Déclaration déposée verrouillée, calcul rangé sous la bonne année ──
create or replace function app.bpf_declaration_garde()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.submitted_at is not null then
      raise exception 'BPF déposé : il ne peut plus être supprimé' using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.submitted_at is not null then
    -- Seule la réouverture est permise : retirer la date de dépôt sans rien changer d'autre
    if new.submitted_at is not null
       or (to_jsonb(new) - array['submitted_at', 'status', 'updated_at']) is distinct from (to_jsonb(old) - array['submitted_at', 'status', 'updated_at']) then
      raise exception 'BPF déposé : il n''est plus modifiable (le rouvrir d''abord)' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.calcul is not null then
    if new.calcul ? 'annee' and (new.calcul->>'annee')::integer is distinct from new.year then
      raise exception 'Calcul de l''exercice % enregistré sous l''exercice %', new.calcul->>'annee', new.year;
    end if;
    if new.calcul ? 'societe' and (new.calcul->>'societe')::uuid is distinct from new.company_id then
      raise exception 'Calcul d''une autre société';
    end if;
  end if;
  return new;
end
$$;
drop trigger if exists bpf_declarations_garde on public.bpf_declarations;
create trigger bpf_declarations_garde before insert or update or delete on public.bpf_declarations
  for each row execute function app.bpf_declaration_garde();
revoke all on function app.bpf_declaration_garde() from public, anon, authenticated;

-- ── 3. Livraison d'un devis : réservation du stock sérialisée (corps de 0468, seul le verrou est ajouté) ──
create or replace function app.devis_prepare_livraison(p_quote uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
  c public.clients;
  v_site uuid;
  v_visit uuid;
  v_k uuid;
  v_stock boolean;
  r record;
  v_po uuid;
  v_manque text := '';
begin
  select * into q from public.quotes where id = p_quote;
  if q.id is null or q.status not in ('accepted', 'partial') or q.amendment_of is not null then return null; end if;
  if exists (select 1 from public.itv_visits v where v.quote_id = q.id and v.kind = 'livraison') then return null; end if;
  if not exists (select 1 from public.quote_items i where i.quote_id = q.id and coalesce(i.accepted, true) and i.stock_item_id is not null
                   and coalesce(i.metier, q.metier) in ('vente', 'installation') and coalesce(i.quantity, 0) > 0) then
    return null;
  end if;
  -- Deux devis acceptés en même temps sur le même article : le second attend que le premier ait créé sa livraison,
  -- puis voit la quantité déjà promise (relecture de #255). Verrou des articles dans un ordre fixe : pas d'interblocage.
  perform 1 from public.stock_items si
  where si.id in (select i.stock_item_id from public.quote_items i
                  where i.quote_id = q.id and coalesce(i.accepted, true) and i.stock_item_id is not null
                    and coalesce(i.metier, q.metier) in ('vente', 'installation') and coalesce(i.quantity, 0) > 0)
  order by si.id
  for update;
  -- Le même devis traité deux fois en même temps : la seconde passe ne crée pas une seconde livraison
  perform pg_advisory_xact_lock(hashtextextended('devis_livraison:' || q.id::text, 0));
  if exists (select 1 from public.itv_visits v where v.quote_id = q.id and v.kind = 'livraison') then return null; end if;
  select * into c from public.clients where id = q.client_id;

  select s.id into v_site from public.sites s where s.client_id = q.client_id and s.is_active order by s.is_default desc nulls last, s.created_at limit 1;
  if v_site is null then
    insert into public.sites (client_id, company_id, kind, name, address, postal_code, city, is_default, is_active)
    values (q.client_id, q.company_id, 'client', 'Site principal', c.address, c.postal_code, c.city, true, true)
    returning id into v_site;
  end if;
  select k.id into v_k from public.itv_contracts k
  where k.client_id = q.client_id and k.status = 'actif' and (k.site_ids is null or cardinality(k.site_ids) = 0 or v_site = any(k.site_ids))
  order by k.created_at limit 1;

  insert into public.itv_visits (client_id, site_id, company_id, contract_id, kind, status, due_on, quote_id, notes)
  values (q.client_id, v_site, q.company_id, v_k, 'livraison', 'a_planifier', current_date, q.id,
          'Livraison du devis ' || coalesce(q.reference, '') || ' signé')
  returning id into v_visit;

  insert into public.itv_visit_parts (visit_id, company_id, part_id, label, quantity, unit_price_ht, stock_item_id)
  select v_visit, q.company_id, si.itv_part_id, coalesce(nullif(i.description_title, ''), si.label), i.quantity, coalesce(i.unit_price_ht, 0), si.id
  from public.quote_items i join public.stock_items si on si.id = i.stock_item_id
  where i.quote_id = q.id and coalesce(i.accepted, true) and coalesce(i.metier, q.metier) in ('vente', 'installation') and coalesce(i.quantity, 0) > 0
  order by i.position;

  -- Stock insuffisant : commande proposée par fournisseur, rappel avec la liste
  select coalesce(bool_or(m.enabled), false) into v_stock from public.org_modules m where m.key = 'stock';
  for r in
    select si.id as item_id, si.label, si.supplier_id, sum(i.quantity) as besoin,
           coalesce((select sum(case when mv.to_location_id is not null then mv.quantity else 0 end) - sum(case when mv.from_location_id is not null then mv.quantity else 0 end)
                     from public.stock_movements mv where mv.item_id = si.id and mv.company_id = q.company_id), 0)
           -- déjà promis aux autres livraisons en attente (pas encore sorties du stock)
           - coalesce((select sum(op.quantity) from public.itv_visit_parts op join public.itv_visits ov on ov.id = op.visit_id
                       where op.stock_item_id = si.id and ov.id <> v_visit and ov.company_id = q.company_id
                         and ov.kind in ('livraison', 'installation', 'mise_en_service') and ov.status not in ('terminee', 'annulee')), 0) as dispo
    from public.quote_items i join public.stock_items si on si.id = i.stock_item_id
    where i.quote_id = q.id and coalesce(i.accepted, true) and coalesce(i.metier, q.metier) in ('vente', 'installation') and coalesce(i.quantity, 0) > 0
    group by si.id, si.label, si.supplier_id
    order by si.supplier_id nulls last, si.label
  loop
    if r.besoin <= greatest(r.dispo, 0) then continue; end if;
    v_manque := v_manque || E'\n- ' || r.label || ' : ' || trim(to_char(r.besoin - greatest(r.dispo, 0), 'FM999990.###'))
      || ' manquant' || case when r.supplier_id is null then ' (aucun fournisseur sur l''article)' else '' end;
    if v_stock and r.supplier_id is not null then
      select o.id into v_po from public.purchase_orders o
      where o.company_id = q.company_id and o.supplier_id = r.supplier_id and o.status = 'brouillon'
        and o.notes = 'Proposée pour la livraison du devis ' || coalesce(q.reference, q.id::text);
      if v_po is null then
        insert into public.purchase_orders (company_id, supplier_id, location_id, notes)
        values (q.company_id, r.supplier_id,
                (select l.id from public.stock_locations l where l.company_id = q.company_id and l.kind = 'depot' and l.is_active order by l.created_at limit 1),
                'Proposée pour la livraison du devis ' || coalesce(q.reference, q.id::text))
        returning id into v_po;
      end if;
      insert into public.purchase_order_lines (company_id, order_id, item_id, quantity, position)
      values (q.company_id, v_po, r.item_id, r.besoin - greatest(r.dispo, 0),
              (select coalesce(max(position), 0) + 1 from public.purchase_order_lines where order_id = v_po));
      v_po := null;
    end if;
  end loop;
  if v_manque <> '' then
    insert into public.scheduled_actions (company_id, kind, target_table, target_id, client_id, due_on, title, payload, dedup_key)
    values (q.company_id, 'rappel', 'itv_visits', v_visit, q.client_id, current_date,
            'Livraison du devis ' || coalesce(q.reference, '') || ' pour ' || c.name || ' : stock insuffisant',
            jsonb_build_object('interne', true, 'lien', '/stock',
              'texte', 'Il manque, tous emplacements confondus et en tenant compte des autres livraisons en attente :' || v_manque || E'\n\n'
                || case when v_stock then 'Une commande en brouillon est proposée pour chaque fournisseur (Stock › Commandes) : relisez-la, puis soumettez-la.'
                        else 'Le module Stock n''est pas actif : aucune commande n''a été préparée.' end),
            'livraison_stock:' || v_visit)
    on conflict (company_id, dedup_key) do nothing;
  end if;
  return v_visit;
end
$$;

insert into public.schema_migrations (version) values ('0478_bpf_calcul') on conflict (version) do nothing;
