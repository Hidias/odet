-- 0474 : prévisionnel pessimiste, réaliste, optimiste (décisions du 27/10 § 9), à partir des données existantes.
--
-- Sources, par mois, sur 36 mois (les sources récurrentes de 0150 ne portent que sur 12 mois) :
--   - certain : échéances des contrats à facturer (échéancier 0461) et devis acceptés pas encore facturés ;
--   - devis en cours : devis envoyés encore valables, placés au mois probable de signature ;
--   - récurrent : recyclages de formation, vérifications hors contrat et fins de contrat (vue v_recurring_revenue).
-- Hypothèses, par source et par scénario, en pourcentage :
--   - calculées sur l'historique quand il suffit (taux de signature des devis sur 12 mois, au moins 5 devis tranchés ;
--     délai moyen de paiement constaté, au moins 3 factures payées) ;
--   - sinon valeurs par défaut affichées comme telles (certain 100/100/100, devis 0/50/100, récurrent 0/50/100,
--     délai de signature 30 jours, retard de paiement 0 jour ; avec l'historique, retard pessimiste = troisième quartile
--     constaté, réaliste = moyenne, optimiste = paiement à l'échéance) ;
--   - ajustables par la direction (previsionnel_hypotheses), chaque modification tracée (previsionnel_hypotheses_journal).
-- Quatre lectures : chiffre d'affaires par mois et par activité, trésorerie (encaissements au mois probable, moins les
-- charges moyennes du Budget des trois derniers mois ; sans mouvement au Budget, c'est dit ; chiffre d'affaires passé
-- en TTC au rapport TTC / HT constaté sur les factures, sinon laissé HT et signalé), charge des techniciens
-- (visites prévues et temps moyen constaté), détail par client.
-- Prévu face au réalisé : chaque mois, la base garde la photo des trois scénarios (previsionnel_photos) ; le réalisé
-- est le chiffre d'affaires facturé du mois. Réalisé sous le pessimiste deux mois de suite : alerte à la direction.
-- Accès : droit « voir le cockpit de direction » (manager.cockpit.voir).
-- Retour arrière (manuel) : en fin de fichier.

create table if not exists public.previsionnel_hypotheses (
  company_id uuid not null references public.companies(id) on delete cascade,
  cle text not null check (cle in ('certain', 'devis', 'recurrent', 'delai_signature_j', 'retard_paiement_j')),
  pessimiste numeric not null, realiste numeric not null, optimiste numeric not null,
  updated_by uuid default auth.uid(), updated_at timestamptz not null default now(),
  primary key (company_id, cle)
);
create table if not exists public.previsionnel_hypotheses_journal (
  id bigint generated always as identity primary key,
  company_id uuid not null, cle text not null,
  avant jsonb, apres jsonb not null, par uuid default auth.uid(), le timestamptz not null default now()
);
create table if not exists public.previsionnel_photos (
  company_id uuid not null references public.companies(id) on delete cascade,
  prise_le date not null, mois date not null,
  pessimiste numeric not null, realiste numeric not null, optimiste numeric not null,
  primary key (company_id, prise_le, mois)
);
comment on table public.previsionnel_hypotheses is '0474 : hypothèses du prévisionnel ajustées par la direction (sinon calculées ou par défaut).';
comment on table public.previsionnel_photos is '0474 : prévision des trois scénarios photographiée le 1er de chaque mois, pour le prévu face au réalisé.';
alter table public.previsionnel_hypotheses enable row level security;
alter table public.previsionnel_hypotheses_journal enable row level security;
alter table public.previsionnel_photos enable row level security;
drop policy if exists previsionnel_hypotheses_sel on public.previsionnel_hypotheses;
create policy previsionnel_hypotheses_sel on public.previsionnel_hypotheses for select to authenticated
  using (company_id in (select app.societes_avec_droit('manager.cockpit.voir')));
drop policy if exists previsionnel_journal_sel on public.previsionnel_hypotheses_journal;
create policy previsionnel_journal_sel on public.previsionnel_hypotheses_journal for select to authenticated
  using (company_id in (select app.societes_avec_droit('manager.cockpit.voir')));
drop policy if exists previsionnel_photos_sel on public.previsionnel_photos;
create policy previsionnel_photos_sel on public.previsionnel_photos for select to authenticated
  using (company_id in (select app.societes_avec_droit('manager.cockpit.voir')));
revoke all on public.previsionnel_hypotheses, public.previsionnel_hypotheses_journal, public.previsionnel_photos from anon, authenticated;
grant select on public.previsionnel_hypotheses, public.previsionnel_hypotheses_journal, public.previsionnel_photos to authenticated;

-- ── Calcul (une société) ──
create or replace function app.previsionnel_calcul(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tranches int; v_signes int; v_taux numeric;
  v_payees int; v_retard numeric; v_retard_haut numeric;
  v_h jsonb := '{}'::jsonb;
  r record;
  v_certain numeric[]; v_devis numeric[]; v_recur numeric[];
  v_delai int; v_ret int; v_terme int;
  v_charges numeric; v_nb_charges int;
  v_heure numeric; v_nb_heure int;
  v_ratio numeric; v_nb_fact int;
  v_debut date := date_trunc('month', current_date)::date;
begin
  -- Historique : taux de signature des devis tranchés sur 12 mois
  select count(*) filter (where q.status in ('accepted', 'partial', 'invoiced', 'refused', 'expired')),
         count(*) filter (where q.status in ('accepted', 'partial', 'invoiced'))
    into v_tranches, v_signes
  from public.quotes q where q.company_id = p_company and q.quote_date >= current_date - 365 and q.amendment_of is null;
  v_taux := case when v_tranches >= 5 then round(100.0 * v_signes / v_tranches) end;
  -- Retard moyen de paiement constaté (dernier paiement moins échéance), factures payées sur 12 mois
  select count(*), avg(x.retard), percentile_cont(0.75) within group (order by x.retard) into v_payees, v_retard, v_retard_haut from (
    select i.id, max(pm.payment_date) - i.due_date as retard
    from public.invoices i join public.invoice_payments pm on pm.invoice_id = i.id
    where i.company_id = p_company and i.status = 'paid' and i.due_date is not null and i.invoice_date >= current_date - 365
    group by i.id, i.due_date) x;

  -- Hypothèses : saisie de la direction, sinon historique, sinon défaut
  for r in
    select d.cle, d.p, d.re, d.o, d.origine,
           h.pessimiste as hp, h.realiste as hr, h.optimiste as ho
    from (values
      ('certain', 100::numeric, 100::numeric, 100::numeric, 'defaut'),
      ('devis', 0, coalesce(v_taux, 50), 100, case when v_taux is not null then 'historique' else 'defaut' end),
      ('recurrent', 0, 50, 100, 'defaut'),
      ('delai_signature_j', 30, 30, 30, 'defaut'),
      -- Retard : pessimiste = 3e quartile constaté, réaliste = moyenne, optimiste = paiement à l'échéance
      ('retard_paiement_j', case when v_payees >= 3 then greatest(round(v_retard_haut::numeric), 0) else 0 end,
        case when v_payees >= 3 then greatest(round(v_retard), 0) else 0 end, 0,
        case when v_payees >= 3 then 'historique' else 'defaut' end)
    ) d(cle, p, re, o, origine)
    left join public.previsionnel_hypotheses h on h.company_id = p_company and h.cle = d.cle
  loop
    v_h := v_h || jsonb_build_object(r.cle, jsonb_build_object(
      'pessimiste', coalesce(r.hp, r.p), 'realiste', coalesce(r.hr, r.re), 'optimiste', coalesce(r.ho, r.o),
      'origine', case when r.hp is not null then 'direction' else r.origine end));
  end loop;
  v_delai := ((v_h -> 'delai_signature_j' ->> 'realiste')::numeric)::int;

  -- Sources par mois (index 1 = mois en cours), 36 mois
  v_certain := array_fill(0::numeric, array[36]); v_devis := array_fill(0::numeric, array[36]); v_recur := array_fill(0::numeric, array[36]);
  for r in
    select (extract(year from age(date_trunc('month', e.due_on), v_debut)) * 12 + extract(month from age(date_trunc('month', e.due_on), v_debut)))::int + 1 as m, sum(e.amount_ht) as ht
    from public.itv_contract_installments e join public.itv_contracts k on k.id = e.contract_id
    where k.company_id = p_company and e.status in ('a_facturer', 'preparee') and e.due_on >= v_debut
    group by 1
  loop
    if r.m between 1 and 36 then v_certain[r.m] := v_certain[r.m] + r.ht; end if;
  end loop;
  -- Devis acceptés sans facture : au mois en cours
  v_certain[1] := v_certain[1] + coalesce((select sum(q.total_ht) from public.quotes q
    where q.company_id = p_company and q.status in ('accepted', 'partial') and q.quote_date >= current_date - 365
      and not exists (select 1 from public.invoices i where i.quote_id = q.id and i.status not in ('cancelled'))
      and not exists (select 1 from public.itv_contracts k where k.quote_id = q.id)), 0);
  for r in
    select (extract(year from age(date_trunc('month', greatest(q.quote_date + v_delai, current_date)), v_debut)) * 12
            + extract(month from age(date_trunc('month', greatest(q.quote_date + v_delai, current_date)), v_debut)))::int + 1 as m, sum(q.total_ht) as ht
    from public.quotes q
    where q.company_id = p_company and q.status = 'sent' and (q.validity_date is null or q.validity_date >= current_date) and q.amendment_of is null
    group by 1
  loop
    if r.m between 1 and 36 then v_devis[r.m] := v_devis[r.m] + r.ht; end if;
  end loop;
  for r in
    select (extract(year from age(v.mois, v_debut)) * 12 + extract(month from age(v.mois, v_debut)))::int + 1 as m, sum(v.montant_attendu) as ht
    from public.v_recurring_revenue v where v.company_id = p_company and v.mois >= v_debut
    group by 1
  loop
    if r.m between 1 and 36 then v_recur[r.m] := v_recur[r.m] + r.ht; end if;
  end loop;

  -- Charges : moyenne mensuelle des dépenses du Budget sur les trois derniers mois complets
  select count(*), sum(b.debit) / 3 into v_nb_charges, v_charges
  from public.budget_transactions b
  where b.company_id = p_company and not coalesce(b.is_personal, false) and coalesce(b.debit, 0) > 0
    and b.date >= (v_debut - interval '3 months')::date and b.date < v_debut;
  -- Rapport TTC / HT constaté sur les factures émises (12 mois) : pour passer le chiffre d'affaires en encaissements
  select count(*), sum(i.total_ttc) / nullif(sum(i.total_net_ht), 0) into v_nb_fact, v_ratio
  from public.invoices i where i.company_id = p_company and i.type = 'invoice' and i.status not in ('draft', 'cancelled')
    and i.invoice_date >= current_date - 365 and coalesce(i.total_net_ht, 0) > 0;
  -- Temps moyen constaté par visite (12 mois)
  select count(*), avg(extract(epoch from v.finished_at - v.started_at) / 3600) into v_nb_heure, v_heure
  from public.itv_visits v
  where v.company_id = p_company and v.status = 'terminee' and v.started_at >= current_date - 365
    and v.finished_at > v.started_at and v.finished_at - v.started_at < interval '12 hours';

  return jsonb_build_object(
    'hypotheses', v_h,
    'historique', jsonb_build_object('devis_tranches', v_tranches, 'devis_signes', v_signes, 'factures_payees', v_payees,
      'retard_moyen_j', round(coalesce(v_retard, 0), 1), 'visites_mesurees', v_nb_heure, 'heures_par_visite', round(coalesce(v_heure, 0)::numeric, 2),
      'ratio_ttc', case when v_nb_fact >= 3 then round(v_ratio, 4) end, 'factures_emises', v_nb_fact),
    'charges_mensuelles', case when v_nb_charges > 0 then round(v_charges, 2) end,
    'mois', (select jsonb_agg(jsonb_build_object(
        'mois', (v_debut + make_interval(months => g - 1))::date,
        'certain', v_certain[g], 'devis', v_devis[g], 'recurrent', v_recur[g],
        'visites_prevues', (select count(*) from public.itv_visits v where v.company_id = p_company and v.status in ('a_planifier', 'planifiee')
                              and date_trunc('month', coalesce(v.planned_on, v.due_on)) = (v_debut + make_interval(months => g - 1))),
        'realise', case when g = 1 then (select coalesce(sum(i.total_net_ht), 0) from public.invoices i
                     where i.company_id = p_company and i.type = 'invoice' and i.status not in ('draft', 'cancelled')
                       and date_trunc('month', i.invoice_date) = v_debut) end)
      order by g) from generate_series(1, 36) g),
    'passe', (select jsonb_agg(jsonb_build_object(
        'mois', m.mois,
        'realise', (select coalesce(sum(i.total_net_ht), 0) from public.invoices i
                     where i.company_id = p_company and i.type = 'invoice' and i.status not in ('draft', 'cancelled')
                       and date_trunc('month', i.invoice_date) = m.mois),
        'prevu', (select jsonb_build_object('pessimiste', p.pessimiste, 'realiste', p.realiste, 'optimiste', p.optimiste)
                  from public.previsionnel_photos p where p.company_id = p_company and p.mois = m.mois
                  order by p.prise_le limit 1))
      order by m.mois)
      from (select (v_debut - make_interval(months => g))::date as mois from generate_series(1, 12) g) m),
    'encaissements', jsonb_build_object('factures_ouvertes', (select jsonb_agg(jsonb_build_object('mois', x.mois, 'montant', x.montant) order by x.mois) from (
        select date_trunc('month', greatest(i.due_date, current_date))::date as mois, sum(coalesce(i.amount_due, i.total_ttc)) as montant
        from public.invoices i where i.company_id = p_company and i.type = 'invoice' and i.status in ('sent', 'due', 'overdue', 'partial')
          and coalesce(i.amount_due, i.total_ttc, 0) > 0 and i.due_date is not null
        group by 1) x)));
end
$$;
revoke all on function app.previsionnel_calcul(uuid) from public, anon, authenticated;

create or replace function public.previsionnel_scenarios()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_co uuid;
begin
  perform app.require_right('manager.cockpit.voir');
  v_co := app.company_default();
  if not (v_co in (select app.societes_avec_droit('manager.cockpit.voir')) or app.is_superadmin()) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  return app.previsionnel_calcul(v_co);
end
$$;
revoke all on function public.previsionnel_scenarios() from public, anon;
grant execute on function public.previsionnel_scenarios() to authenticated;

create or replace function public.previsionnel_hypothese_regler(p_cle text, p_pess numeric, p_reel numeric, p_opt numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_co uuid := app.company_default(); v_avant jsonb;
begin
  perform app.require_right('manager.cockpit.voir');
  if not (v_co in (select app.societes_avec_droit('manager.cockpit.voir')) or app.is_superadmin()) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if p_cle not in ('certain', 'devis', 'recurrent', 'delai_signature_j', 'retard_paiement_j') then raise exception 'Hypothèse inconnue' using errcode = '22023'; end if;
  select to_jsonb(h) - 'company_id' into v_avant from public.previsionnel_hypotheses h where h.company_id = v_co and h.cle = p_cle;
  if p_pess is null and p_reel is null and p_opt is null then
    delete from public.previsionnel_hypotheses where company_id = v_co and cle = p_cle;
    insert into public.previsionnel_hypotheses_journal (company_id, cle, avant, apres) values (v_co, p_cle, v_avant, '{"retour": "calcul ou défaut"}');
    return;
  end if;
  if p_cle in ('certain', 'devis', 'recurrent') and (least(p_pess, p_reel, p_opt) < 0 or greatest(p_pess, p_reel, p_opt) > 100) then
    raise exception 'Pourcentage entre 0 et 100' using errcode = '22023';
  end if;
  if p_cle in ('delai_signature_j', 'retard_paiement_j') and (least(p_pess, p_reel, p_opt) < 0 or greatest(p_pess, p_reel, p_opt) > 365) then
    raise exception 'Nombre de jours entre 0 et 365' using errcode = '22023';
  end if;
  insert into public.previsionnel_hypotheses (company_id, cle, pessimiste, realiste, optimiste, updated_by, updated_at)
  values (v_co, p_cle, p_pess, p_reel, p_opt, (select auth.uid()), now())
  on conflict (company_id, cle) do update set pessimiste = excluded.pessimiste, realiste = excluded.realiste, optimiste = excluded.optimiste,
    updated_by = excluded.updated_by, updated_at = now();
  insert into public.previsionnel_hypotheses_journal (company_id, cle, avant, apres)
  values (v_co, p_cle, v_avant, jsonb_build_object('pessimiste', p_pess, 'realiste', p_reel, 'optimiste', p_opt));
end
$$;
revoke all on function public.previsionnel_hypothese_regler(text, numeric, numeric, numeric) from public, anon;
grant execute on function public.previsionnel_hypothese_regler(text, numeric, numeric, numeric) to authenticated;

-- ── Nuit : photo du 1er du mois, alerte si le réalisé reste sous le pessimiste deux mois de suite ──
create or replace function public.previsionnel_nuit()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare co record; v jsonb; h jsonb; m jsonb; g int; v_p int := 0; v_a int := 0; v_debut date := date_trunc('month', current_date)::date;
  r1 numeric; r2 numeric; p1 numeric; p2 numeric;
begin
  if coalesce((select auth.role()), '') not in ('service_role', '') and not app.a_le_droit('plateforme.administrer') then
    raise exception 'Réservé à la tâche de nuit' using errcode = '42501';
  end if;
  for co in select c.id from public.companies c loop
    if not exists (select 1 from public.previsionnel_photos p where p.company_id = co.id and p.prise_le >= v_debut) then
      v := app.previsionnel_calcul(co.id);
      h := v -> 'hypotheses';
      for g in 0 .. 11 loop
        m := v -> 'mois' -> g;
        insert into public.previsionnel_photos (company_id, prise_le, mois, pessimiste, realiste, optimiste)
        values (co.id, current_date, (m ->> 'mois')::date,
          round((m->>'certain')::numeric * (h->'certain'->>'pessimiste')::numeric / 100 + (m->>'devis')::numeric * (h->'devis'->>'pessimiste')::numeric / 100 + (m->>'recurrent')::numeric * (h->'recurrent'->>'pessimiste')::numeric / 100, 2),
          round((m->>'certain')::numeric * (h->'certain'->>'realiste')::numeric / 100 + (m->>'devis')::numeric * (h->'devis'->>'realiste')::numeric / 100 + (m->>'recurrent')::numeric * (h->'recurrent'->>'realiste')::numeric / 100, 2),
          round((m->>'certain')::numeric * (h->'certain'->>'optimiste')::numeric / 100 + (m->>'devis')::numeric * (h->'devis'->>'optimiste')::numeric / 100 + (m->>'recurrent')::numeric * (h->'recurrent'->>'optimiste')::numeric / 100, 2))
        on conflict do nothing;
      end loop;
      v_p := v_p + 1;
      -- Les deux derniers mois clos : réalisé face à la première photo de chacun
      select coalesce(sum(i.total_net_ht), 0) into r1 from public.invoices i where i.company_id = co.id and i.type = 'invoice' and i.status not in ('draft', 'cancelled') and date_trunc('month', i.invoice_date) = (v_debut - interval '1 month');
      select coalesce(sum(i.total_net_ht), 0) into r2 from public.invoices i where i.company_id = co.id and i.type = 'invoice' and i.status not in ('draft', 'cancelled') and date_trunc('month', i.invoice_date) = (v_debut - interval '2 months');
      select p.pessimiste into p1 from public.previsionnel_photos p where p.company_id = co.id and p.mois = (v_debut - interval '1 month')::date order by p.prise_le limit 1;
      select p.pessimiste into p2 from public.previsionnel_photos p where p.company_id = co.id and p.mois = (v_debut - interval '2 months')::date order by p.prise_le limit 1;
      if p1 is not null and p2 is not null and r1 < p1 and r2 < p2 then
        insert into public.scheduled_actions (company_id, kind, target_table, client_id, due_on, title, payload, dedup_key)
        values (co.id, 'rappel', 'previsionnel', null, current_date, 'Chiffre d''affaires sous le scénario pessimiste deux mois de suite',
          jsonb_build_object('interne', true, 'lien', '/previsionnel',
            'texte', 'Facturé ' || app.euros_fr(r2) || ' puis ' || app.euros_fr(r1) || ', pour un pessimiste de ' || app.euros_fr(p2) || ' puis ' || app.euros_fr(p1)
              || '. Ouvrez le prévisionnel : devis en attente, échéances à facturer, relances.'),
          'previsionnel_alerte:' || to_char(v_debut, 'YYYY-MM'))
        on conflict (company_id, dedup_key) do nothing;
        v_a := v_a + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('photos', v_p, 'alertes', v_a);
end
$$;
revoke all on function public.previsionnel_nuit() from public, anon, authenticated;
grant execute on function public.previsionnel_nuit() to service_role;

-- Retour arrière (manuel) :
-- drop function if exists public.previsionnel_nuit(); drop function if exists public.previsionnel_hypothese_regler(text, numeric, numeric, numeric);
-- drop function if exists public.previsionnel_scenarios(); drop function if exists app.previsionnel_calcul(uuid);
-- drop table if exists public.previsionnel_photos, public.previsionnel_hypotheses_journal, public.previsionnel_hypotheses;
