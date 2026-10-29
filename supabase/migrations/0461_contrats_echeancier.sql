-- 0461 : contrats de maintenance, lot 2 (décisions de H du 27/10/2026, § 2 et § 4) : échéancier, ce que le contrat
-- comprend, clients publics.
--   1. Échéancier : une échéance par mois, trimestre civil ou année de contrat (prorata au jour sur une période
--      incomplète), jusqu'à l'échéance du contrat, prolongé à chaque reconduction. « À la visite » : aucun échéancier,
--      la facture de visite existante reste. Terme à échoir (début de période) ou échu (lendemain de la fin) ; client
--      public : échu par défaut (paiement après service fait), à confirmer par l'entreprise.
--   2. Une facture brouillon par échéance, préparée la nuit (ou à la demande), une ligne par site couvert (répartition
--      selon le nombre d'appareils, l'arrondi sur la dernière ligne), signalée dans « Relances à valider ». Rien
--      n'est émis ni envoyé seul.
--   3. Ce que le contrat comprend (pièces, recharges, déplacement) : repris par la facture de visite (écran) ;
--      catégorie de chaque article du catalogue d'intervention.
--   4. Clients publics : numéro d'engagement par client et par exercice, repris sur chaque facture de l'année
--      (l'émission reste bloquée sans lui, 0427) ; rappel en décembre pour l'exercice suivant ; bon de commande rangé
--      avec le contrat, son numéro repris sur les factures (« Réf. client »).
-- Migration additive, rejouable. Retour arrière en fin de fichier.

-- ── Contrat : terme, ce qu'il comprend, bon de commande ──
alter table public.itv_contracts add column if not exists billing_term text;
alter table public.itv_contracts add column if not exists includes jsonb not null default '{}'::jsonb;
alter table public.itv_contracts add column if not exists purchase_order_ref text;
alter table public.itv_contracts add column if not exists purchase_order_document_id uuid references public.client_shared_documents(id) on delete set null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'itv_contracts_echeancier_chk') then
    alter table public.itv_contracts add constraint itv_contracts_echeancier_chk check (
      (billing_term is null or billing_term in ('echoir', 'echu')) and jsonb_typeof(includes) = 'object'
      and (purchase_order_ref is null or length(purchase_order_ref) <= 60));
  end if;
end $$;
comment on column public.itv_contracts.includes is 'Compris au contrat : {"pieces": bool, "recharges": bool, "deplacement": bool} ; facturé à 0 € sur la visite (0461)';
comment on column public.itv_contracts.billing_term is 'echoir : facture au début de la période ; echu : au lendemain de la fin ; vide : échu pour un client public, à échoir sinon (0461)';

-- ── Catégorie des articles d'intervention ──
alter table public.itv_parts add column if not exists category text not null default 'piece';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'itv_parts_category_chk') then
    alter table public.itv_parts add constraint itv_parts_category_chk check (category in ('piece', 'recharge', 'deplacement'));
  end if;
end $$;

-- ── Échéances ──
create table if not exists public.itv_contract_installments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  contract_id uuid not null references public.itv_contracts(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  due_on date not null,
  amount_ht numeric(12,2) not null,
  status text not null default 'a_facturer' check (status in ('a_facturer', 'preparee', 'annulee')),
  invoice_id uuid references public.invoices(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contract_id, period_start),
  check (period_end >= period_start and amount_ht >= 0)
);
create index if not exists itv_contract_installments_due on public.itv_contract_installments (status, due_on);
alter table public.itv_contract_installments enable row level security;
drop policy if exists itv_contract_installments_sel on public.itv_contract_installments;
create policy itv_contract_installments_sel on public.itv_contract_installments for select to authenticated
  using (company_id in (select app.societes_lisibles())
    and (((select app.module_on('interventions')) and (select app.a_le_droit('interventions.contrats.voir'))) or (select app.is_superadmin())));
drop policy if exists itv_contract_installments_upd on public.itv_contract_installments;
create policy itv_contract_installments_upd on public.itv_contract_installments for update to authenticated
  using (company_id in (select app.societes_ecriture()) and (select app.module_on('interventions')) and (select app.a_le_droit('interventions.contrats.gerer')))
  with check (company_id in (select app.societes_ecriture()) and (select app.module_on('interventions')) and (select app.a_le_droit('interventions.contrats.gerer')));
revoke all on public.itv_contract_installments from anon, authenticated;
grant select on public.itv_contract_installments to authenticated;
grant update (status, updated_at) on public.itv_contract_installments to authenticated;

-- ── Engagements des clients publics, par exercice ──
create table if not exists public.client_engagements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  year int not null check (year between 2000 and 2100),
  number text not null check (length(btrim(number)) between 1 and 60),
  notes text check (notes is null or length(notes) <= 500),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (client_id, year)
);
alter table public.client_engagements enable row level security;
drop policy if exists client_engagements_sel on public.client_engagements;
create policy client_engagements_sel on public.client_engagements for select to authenticated
  using (company_id in (select app.societes_lisibles())
    and ((select app.a_le_droit('interventions.contrats.voir')) or (select app.a_le_droit('facturation.factures.voir')) or (select app.is_superadmin())));
drop policy if exists client_engagements_ecr on public.client_engagements;
create policy client_engagements_ecr on public.client_engagements for all to authenticated
  using (company_id in (select app.societes_ecriture())
    and ((select app.a_le_droit('interventions.contrats.gerer')) or (select app.a_le_droit('facturation.factures.modifier'))))
  with check (company_id in (select app.societes_ecriture())
    and ((select app.a_le_droit('interventions.contrats.gerer')) or (select app.a_le_droit('facturation.factures.modifier'))));
revoke all on public.client_engagements from anon;
grant select, insert, update, delete on public.client_engagements to authenticated;

-- ── Périodes d'un contrat ──
create or replace function app.contrat_periodes(p_contract uuid)
returns table (period_start date, period_end date, amount_ht numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  k public.itv_contracts;
  v_fin date;
  d date;
  f date;
  v_plein date;
  v_part numeric;
  v_jours numeric;
  v_total numeric;
begin
  select * into k from public.itv_contracts where id = p_contract;
  if k.id is null or k.billing_period is null or k.billing_period = 'visite' or coalesce(k.annual_price_ht, 0) <= 0 then return; end if;
  v_fin := least(coalesce(k.term_on, (k.start_on + interval '1 year' - interval '1 day')::date), coalesce(k.end_on, 'infinity'::date));
  d := k.start_on;
  while d <= v_fin loop
    if k.billing_period = 'mensuel' then
      v_plein := (date_trunc('month', d) + interval '1 month' - interval '1 day')::date;
      v_part := k.annual_price_ht / 12;
      v_total := extract(day from v_plein);
    elsif k.billing_period = 'trimestriel' then
      v_plein := (date_trunc('quarter', d) + interval '3 months' - interval '1 day')::date;
      v_part := k.annual_price_ht / 4;
      v_total := (v_plein - date_trunc('quarter', d)::date) + 1;
    else -- annuel : année de contrat
      v_plein := (d + interval '1 year' - interval '1 day')::date;
      v_part := k.annual_price_ht;
      v_total := (v_plein - d) + 1;
    end if;
    f := least(v_plein, v_fin);
    -- Prorata au jour d'une période incomplète (début en cours de mois ou de trimestre, fin anticipée)
    if k.billing_period = 'annuel' then
      v_jours := (f - d) + 1;
    elsif k.billing_period = 'mensuel' then
      v_jours := (f - greatest(d, date_trunc('month', d)::date)) + 1;
    else
      v_jours := (f - greatest(d, date_trunc('quarter', d)::date)) + 1;
    end if;
    period_start := d; period_end := f; amount_ht := round(v_part * least(1, v_jours / v_total), 2);
    return next;
    d := f + 1;
  end loop;
end
$$;
revoke all on function app.contrat_periodes(uuid) from public, anon, authenticated;

-- ── Échéancier : échéances manquantes ajoutées (les échéances déjà facturées ne bougent jamais) ──
create or replace function app.contrat_echeancier(p_contract uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare k public.itv_contracts; c public.clients; v_echu boolean; v_n int;
begin
  select * into k from public.itv_contracts where id = p_contract;
  if k.id is null or k.status <> 'actif' then return 0; end if;
  select * into c from public.clients where id = k.client_id;
  v_echu := coalesce(k.billing_term, case when c.client_type = 'public' then 'echu' else 'echoir' end) = 'echu';
  -- Échéances pas encore facturées : recalculées (prix ou dates corrigés avant facturation)
  delete from public.itv_contract_installments i where i.contract_id = k.id and i.status = 'a_facturer';
  insert into public.itv_contract_installments (company_id, contract_id, period_start, period_end, due_on, amount_ht)
  select k.company_id, k.id, p.period_start, p.period_end, case when v_echu then p.period_end + 1 else p.period_start end, p.amount_ht
  from app.contrat_periodes(k.id) p
  where not exists (select 1 from public.itv_contract_installments i where i.contract_id = k.id and i.period_start = p.period_start)
  on conflict (contract_id, period_start) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
revoke all on function app.contrat_echeancier(uuid) from public, anon, authenticated;

create or replace function public.contrat_echeancier_generer(p_contract uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_right('interventions.contrats.gerer');
  perform app.exiger_societe('itv_contracts', p_contract, true);
  return app.contrat_echeancier(p_contract);
end
$$;
revoke all on function public.contrat_echeancier_generer(uuid) from public, anon;
grant execute on function public.contrat_echeancier_generer(uuid) to authenticated;

-- ── Facture brouillon d'une échéance ──
create or replace function app.contrat_facturer_echeance(p_installment uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.itv_contract_installments;
  k public.itv_contracts;
  c public.clients;
  v_tva numeric;
  v_inv uuid;
  v_contact uuid;
  v_eng text;
  v_total_app int;
  v_reste numeric;
  v_pos int := 0;
  v_ht numeric;
  v_n int;
  s record;
  v_label text;
  v_periode text;
begin
  select * into e from public.itv_contract_installments where id = p_installment for update;
  if e.id is null or e.status <> 'a_facturer' then return e.invoice_id; end if;
  select * into k from public.itv_contracts where id = e.contract_id;
  select * into c from public.clients where id = k.client_id;
  select coalesce(tva_rate, 20) into v_tva from public.itv_settings limit 1;
  v_tva := coalesce(v_tva, 20);
  select id into v_contact from public.client_contacts where client_id = k.client_id order by coalesce(is_billing, false) desc, coalesce(is_primary, false) desc, created_at limit 1;
  select number into v_eng from public.client_engagements where client_id = k.client_id and year = extract(year from greatest(current_date, e.due_on))::int;
  v_label := coalesce(nullif(k.label, ''), 'Contrat de maintenance') || coalesce(' ' || nullif(k.reference, ''), '');
  v_periode := 'du ' || to_char(e.period_start, 'DD/MM/YYYY') || ' au ' || to_char(e.period_end, 'DD/MM/YYYY');

  insert into public.invoices (reference, type, client_id, contact_id, company_id, invoice_date, service_start_date, service_end_date,
    object, status, is_formation_pro, tva_applicable, payment_terms, client_reference, chorus_service_code, chorus_engagement,
    total_ht, total_discount, total_net_ht, total_tva, total_ttc, amount_paid, amount_due, created_by, notes)
  values ('BROUILLON-' || upper(substr(md5(random()::text), 1, 10)), 'invoice', k.client_id, v_contact, k.company_id, current_date,
    e.period_start, e.period_end, v_label || ', échéance ' || v_periode, 'draft', false, true,
    coalesce(nullif(c.default_payment_terms, ''), 'à 30 jours'), nullif(k.purchase_order_ref, ''),
    case when c.client_type = 'public' then nullif(c.chorus_service_code, '') end, case when c.client_type = 'public' then v_eng end,
    0, 0, 0, 0, 0, 0, 0, 'Échéancier du contrat',
    'Préparée depuis l''échéancier du contrat : à relire, puis à émettre.')
  returning id into v_inv;

  -- Une ligne par site couvert, montant réparti selon le nombre d'appareils ; un seul site : une seule ligne
  -- Sites retenus : ceux couverts ; s'il y a du matériel, seulement les sites qui en ont (le site créé d'office avec
  -- la fiche client, sans appareil, ne donne pas de ligne à 0 €)
  select count(*) into v_total_app from public.itv_equipment q
  where q.client_id = k.client_id and q.status <> 'retire' and (k.site_ids is null or cardinality(k.site_ids) = 0 or q.site_id = any(k.site_ids))
    and (k.type_ids is null or cardinality(k.type_ids) = 0 or q.type_id = any(k.type_ids));
  select count(*) into v_n from public.sites st
  where st.client_id = k.client_id and st.is_active and (k.site_ids is null or cardinality(k.site_ids) = 0 or st.id = any(k.site_ids))
    and (coalesce(v_total_app, 0) = 0 or exists (select 1 from public.itv_equipment q where q.site_id = st.id and q.status <> 'retire'
      and (k.type_ids is null or cardinality(k.type_ids) = 0 or q.type_id = any(k.type_ids))));
  if v_n <= 1 then
    insert into public.invoice_items (invoice_id, company_id, position, description_title, description_detail, quantity, unit, unit_price_ht, tva_rate, total_ht, nature, vat_regime)
    values (v_inv, k.company_id, 0, v_label, 'Échéance ' || v_periode, 1, 'forfait', e.amount_ht, v_tva, e.amount_ht, 'service', 'normal');
  else
    v_reste := e.amount_ht;
    for s in
      select st.id, st.name, st.city,
             (select count(*) from public.itv_equipment q where q.site_id = st.id and q.status <> 'retire'
               and (k.type_ids is null or cardinality(k.type_ids) = 0 or q.type_id = any(k.type_ids))) as nb
      from public.sites st
      where st.client_id = k.client_id and st.is_active and (k.site_ids is null or cardinality(k.site_ids) = 0 or st.id = any(k.site_ids))
        and (coalesce(v_total_app, 0) = 0 or exists (select 1 from public.itv_equipment q where q.site_id = st.id and q.status <> 'retire'
          and (k.type_ids is null or cardinality(k.type_ids) = 0 or q.type_id = any(k.type_ids))))
      order by st.name
    loop
      v_pos := v_pos + 1;
      v_ht := case when v_pos = v_n then v_reste
                   when coalesce(v_total_app, 0) > 0 then round(e.amount_ht * s.nb / v_total_app, 2)
                   else round(e.amount_ht / v_n, 2) end;
      v_reste := v_reste - v_ht;
      insert into public.invoice_items (invoice_id, company_id, position, description_title, description_detail, quantity, unit, unit_price_ht, tva_rate, total_ht, nature, vat_regime)
      values (v_inv, k.company_id, v_pos - 1, v_label || ' : ' || coalesce(s.name, 'site'),
        'Échéance ' || v_periode || coalesce(', ' || nullif(s.city, ''), '') || case when s.nb > 0 then ', ' || s.nb || ' appareil' || case when s.nb > 1 then 's' else '' end else '' end,
        1, 'forfait', v_ht, v_tva, v_ht, 'service', 'normal');
    end loop;
  end if;

  update public.invoices set total_ht = e.amount_ht, total_net_ht = e.amount_ht,
    total_tva = round(e.amount_ht * v_tva / 100, 2), total_ttc = e.amount_ht + round(e.amount_ht * v_tva / 100, 2),
    amount_due = e.amount_ht + round(e.amount_ht * v_tva / 100, 2)
  where id = v_inv;
  update public.itv_contract_installments set status = 'preparee', invoice_id = v_inv, updated_at = now() where id = e.id;
  return v_inv;
end
$$;
revoke all on function app.contrat_facturer_echeance(uuid) from public, anon, authenticated;

create or replace function public.contrat_echeance_facturer(p_installment uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_k uuid;
begin
  select contract_id into v_k from public.itv_contract_installments where id = p_installment;
  if v_k is null then raise exception 'Échéance introuvable' using errcode = 'P0002'; end if;
  perform app.require_right('interventions.contrats.gerer');
  perform app.exiger_societe('itv_contracts', v_k, true);
  return app.contrat_facturer_echeance(p_installment);
end
$$;
revoke all on function public.contrat_echeance_facturer(uuid) from public, anon;
grant execute on function public.contrat_echeance_facturer(uuid) to authenticated;

-- ── Validation du contrat : l'échéancier suit (contrat_valider de 0460, une ligne en plus) ──
create or replace function public.contrat_valider(p_contract uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare k public.itv_contracts; v_term date;
begin
  perform app.require_right('interventions.contrats.gerer');
  perform app.exiger_societe('itv_contracts', p_contract, true);
  select * into k from public.itv_contracts where id = p_contract for update;
  if k.id is null then raise exception 'Contrat introuvable' using errcode = 'P0002'; end if;
  if k.status <> 'a_valider' then return jsonb_build_object('ok', true, 'deja', true); end if;
  if coalesce(cardinality(k.visit_months), 0) = 0 then raise exception 'Choisissez au moins un mois de visite' using errcode = '22023'; end if;
  v_term := (k.start_on + make_interval(years => coalesce(k.duration_years, 1)) - interval '1 day')::date;
  update public.itv_contracts set status = 'actif', validated_at = now(), validated_by = auth.uid(), term_on = v_term,
    end_on = case when tacit_renewal then end_on else coalesce(end_on, v_term) end, updated_at = now()
  where id = p_contract;
  /* 0461 */ perform app.contrat_echeancier(p_contract);
  return jsonb_build_object('ok', true, 'term_on', v_term);
end
$$;

-- ── Nuit : contrats_relances_generer (0460) + échéancier prolongé, factures des échéances dues, engagements ──
create or replace function public.contrats_relances_generer()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_r int := 0; v_p int := 0; v_i int := 0; v_f int := 0; v_e int := 0; r record; v_t date; v_inv uuid;
begin
  -- Reconduction tacite : l'échéance passée avance d'une période de reconduction (autant de fois que nécessaire),
  -- et l'échéancier est prolongé d'autant
  for r in select id, term_on, renewal_years from public.itv_contracts
           where status = 'actif' and tacit_renewal and term_on is not null and term_on < current_date for update loop
    v_t := r.term_on;
    while v_t < current_date loop v_t := (v_t + 1 + make_interval(years => r.renewal_years) - interval '1 day')::date; end loop;
    update public.itv_contracts set term_on = v_t, updated_at = now() where id = r.id;
    perform app.contrat_echeancier(r.id);
    v_r := v_r + 1;
  end loop;

  -- Relance interne 45 jours avant la fin du préavis (dernier jour pour refuser la reconduction)
  insert into public.scheduled_actions (company_id, kind, target_table, target_id, client_id, due_on, title, payload, dedup_key)
  select k.company_id, 'renouvellement_contrat', 'itv_contracts', k.id, k.client_id, x.limite,
         'Contrat de ' || c.name || ' : reconduit le ' || to_char(k.term_on + 1, 'DD/MM/YYYY') || ' sauf refus avant le ' || to_char(x.limite, 'DD/MM/YYYY'),
         jsonb_build_object('interne', true, 'texte',
           'Le contrat ' || coalesce(nullif(k.label, ''), 'de maintenance') || ' de ' || c.name || ' se reconduit le ' || to_char(k.term_on + 1, 'DD/MM/YYYY')
           || '. Le client peut le refuser jusqu''au ' || to_char(x.limite, 'DD/MM/YYYY') || ' (préavis de ' || coalesce(k.notice_months, 0) || ' mois).'
           || E'\n\n' || 'Bon moment pour faire le point avec lui : bilan des visites, matériel à remplacer, révision du prix.'),
         'contrat_preavis:' || k.id || ':' || to_char(k.term_on, 'YYYY-MM-DD')
  from public.itv_contracts k
  join public.clients c on c.id = k.client_id
  cross join lateral (select ((k.term_on + 1) - make_interval(months => coalesce(k.notice_months, 0)))::date - 1 as limite) x
  where k.status = 'actif' and k.tacit_renewal and k.term_on is not null
    and x.limite between current_date and current_date + 45
  on conflict (company_id, dedup_key) do nothing;
  get diagnostics v_p = row_count;

  -- Particulier : courrier d'information sur la possibilité de ne pas reconduire, au plus tôt trois mois et au plus
  -- tard un mois avant la date limite de refus (code de la consommation, L215-1 ; texte à valider par l'expert).
  insert into public.scheduled_actions (company_id, kind, target_table, target_id, client_id, due_on, title, payload, dedup_key)
  select k.company_id, 'renouvellement_contrat', 'itv_contracts', k.id, k.client_id, x.limite - 30,
         'Particulier : informer ' || c.name || ' de la reconduction de son contrat (au plus tard le ' || to_char(x.limite - 30, 'DD/MM/YYYY') || ')',
         jsonb_build_object(
           'destinataire', coalesce(nullif(btrim(c.contact_email), ''), nullif(btrim(c.email), '')),
           'objet', 'Votre contrat de maintenance : reconduction le ' || to_char(k.term_on + 1, 'DD/MM/YYYY'),
           'texte', 'Bonjour,' || E'\n\n' || 'Votre contrat ' || coalesce(nullif(k.label, ''), 'de maintenance') || ' arrive à son échéance le '
             || to_char(k.term_on, 'DD/MM/YYYY') || '. Sans demande de votre part, il sera reconduit le ' || to_char(k.term_on + 1, 'DD/MM/YYYY')
             || ' pour ' || k.renewal_years || case when k.renewal_years > 1 then ' ans.' else ' an.' end
             || E'\n\n' || 'Si vous ne souhaitez pas le reconduire, il vous suffit de nous le faire savoir avant le ' || to_char(x.limite, 'DD/MM/YYYY')
             || ', par écrit ou depuis votre espace client.' || E'\n\n' || 'Bien cordialement,',
           'a_valider_par_expert', true),
         'contrat_info_conso:' || k.id || ':' || to_char(k.term_on, 'YYYY-MM-DD')
  from public.itv_contracts k
  join public.clients c on c.id = k.client_id
  cross join lateral (select ((k.term_on + 1) - make_interval(months => coalesce(k.notice_months, 0)))::date - 1 as limite) x
  where k.status = 'actif' and k.tacit_renewal and k.term_on is not null and c.client_type = 'particulier'
    and current_date between x.limite - 75 and x.limite - 30
    and coalesce(c.status, 'actif') not in ('archive', 'archived', 'inactif')
  on conflict (company_id, dedup_key) do nothing;
  get diagnostics v_i = row_count;

  -- Échéances dues : facture brouillon préparée, signalée dans « Relances à valider » (rien n'est émis seul)
  for r in select e.id, e.contract_id, e.due_on, e.period_start, e.period_end, e.amount_ht, k.company_id, k.client_id, c.name as client_name
           from public.itv_contract_installments e
           join public.itv_contracts k on k.id = e.contract_id
           join public.clients c on c.id = k.client_id
           where e.status = 'a_facturer' and e.due_on <= current_date and k.status = 'actif' loop
    v_inv := app.contrat_facturer_echeance(r.id);
    insert into public.scheduled_actions (company_id, kind, target_table, target_id, client_id, due_on, title, payload, dedup_key)
    values (r.company_id, 'facture_brouillon', 'invoices', v_inv, r.client_id, r.due_on,
      'Facture d''échéance à émettre : ' || r.client_name || ' (' || to_char(r.period_start, 'DD/MM/YYYY') || ' au ' || to_char(r.period_end, 'DD/MM/YYYY') || ')',
      jsonb_build_object('lien', '/factures?open=' || v_inv, 'etape', 'facture',
        'texte', 'Facture préparée depuis l''échéancier du contrat (' || to_char(r.amount_ht, 'FM999G999D00') || ' € HT) : relisez-la, puis émettez-la.'),
      'echeance:' || r.id)
    on conflict (company_id, dedup_key) do nothing;
    v_f := v_f + 1;
  end loop;

  -- Clients publics : numéro d'engagement de l'exercice suivant à demander, à partir du 1er décembre
  if extract(month from current_date) = 12 then
    insert into public.scheduled_actions (company_id, kind, target_table, target_id, client_id, due_on, title, payload, dedup_key)
    select distinct on (c.id) k.company_id, 'rappel', 'clients', c.id, c.id, make_date(extract(year from current_date)::int, 12, 15),
           'Numéro d''engagement ' || (extract(year from current_date)::int + 1) || ' à demander à ' || c.name,
           jsonb_build_object('interne', true, 'lien', '/clients/' || c.id,
             'texte', 'Sans numéro d''engagement, les factures de ' || (extract(year from current_date)::int + 1) || ' ne pourront pas être émises sur Chorus Pro. Saisissez-le dans le contrat de maintenance du client dès réception.'),
           'engagement:' || c.id || ':' || (extract(year from current_date)::int + 1)
    from public.itv_contracts k join public.clients c on c.id = k.client_id
    where k.status = 'actif' and c.client_type = 'public' and coalesce(c.chorus_engagement_required, false)
      and not exists (select 1 from public.client_engagements g where g.client_id = c.id and g.year = extract(year from current_date)::int + 1)
    on conflict (company_id, dedup_key) do nothing;
    get diagnostics v_e = row_count;
  end if;

  return jsonb_build_object('reconduits', v_r, 'preavis', v_p, 'information_particulier', v_i, 'factures_echeances', v_f, 'engagements', v_e);
end
$$;
revoke all on function public.contrats_relances_generer() from public, anon, authenticated;
grant execute on function public.contrats_relances_generer() to service_role;

-- Échéanciers des contrats actifs déjà facturés par période (aucun aujourd'hui, ligne sans effet sinon)
do $$ begin perform app.contrat_echeancier(k.id) from public.itv_contracts k where k.status = 'actif' and k.billing_period in ('mensuel', 'trimestriel', 'annuel') and k.term_on is not null; end $$;

-- Retour arrière :
-- (contrat_valider et contrats_relances_generer : reprendre les définitions de 0460)
-- drop function if exists public.contrat_echeance_facturer(uuid); drop function if exists app.contrat_facturer_echeance(uuid);
-- drop function if exists public.contrat_echeancier_generer(uuid); drop function if exists app.contrat_echeancier(uuid);
-- drop function if exists app.contrat_periodes(uuid);
-- drop table if exists public.client_engagements; drop table if exists public.itv_contract_installments;
-- alter table public.itv_parts drop constraint if exists itv_parts_category_chk; alter table public.itv_parts drop column if exists category;
-- alter table public.itv_contracts drop constraint if exists itv_contracts_echeancier_chk;
-- alter table public.itv_contracts drop column if exists purchase_order_document_id, drop column if exists purchase_order_ref,
--   drop column if exists includes, drop column if exists billing_term;
