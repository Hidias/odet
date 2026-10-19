-- 0368_facturation_acomptes_financeurs.sql : factures d'acompte et de solde, financement OPCO (Facturation fiable).
--
-- Décisions de H (17/10) : facturer les acomptes (CGI 289 I-1-c, BOFiP BOI-TVA-DECLA-30-20-10-10 § 120) et préparer
-- les factures selon l'accord de financement OPCO (subrogation supprimée chez la plupart des OPCO pour les accords
-- engagés depuis le 01/10/2026 : règle réglable par OPCO, rien en dur).
--   invoices.invoice_kind : standard, acompte (type 386 du Factur-X), solde (cadre S4, acomptes déduits) ; la facture
--     reste de type « invoice » : paiements, avoirs, relances et tableaux de bord inchangés ; même série de numéros ;
--   invoices.deposit_paid_on : date du versement de l'acompte si elle est connue ;
--   invoice_deposit_links : acompte déduit d'une facture de solde (une seule fois, montants HT et TVA repris) ;
--   billing_create_deposit(devis, pourcentage | montant TTC) : brouillon de facture d'acompte, TTC réparti par taux ;
--   billing_create_final(devis) : brouillon de facture de solde, lignes du devis, remise par taux, reprise des acomptes ;
--   billing_deposit_summary(devis) : suivi des acomptes facturés, déduits, restant ;
--   session_fundings : date de l'accord, subrogation (oui seulement si l'accord la prévoit), pièces exigées ;
--   clients.opco_subrogation_end : date à partir de laquelle l'OPCO n'accepte plus la subrogation (fiche de l'OPCO) ;
--   app.billing_check : numéro de dossier obligatoire pour un OPCO, alerte de subrogation, acomptes déduits cohérents.
-- Idempotente. Retour arrière : supabase/rollback/0368_facturation_acomptes_financeurs_retour.sql

alter table public.invoices add column if not exists invoice_kind text not null default 'standard';
alter table public.invoices add column if not exists deposit_paid_on date;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_invoice_kind_check') then
    alter table public.invoices add constraint invoices_invoice_kind_check check (invoice_kind in ('standard', 'acompte', 'solde'));
  end if;
end
$$;
comment on column public.invoices.invoice_kind is 'standard ; acompte (facture d''acompte, type 386) ; solde (facture définitive après acomptes, cadre S4)';
comment on column public.invoices.deposit_paid_on is 'Facture d''acompte : date du versement si elle est connue';

alter table public.session_fundings add column if not exists agreement_date date;
alter table public.session_fundings add column if not exists subrogation boolean not null default false;
alter table public.session_fundings add column if not exists required_documents text;
comment on column public.session_fundings.subrogation is 'Paiement direct par l''OPCO : seulement si l''accord le prévoit (supprimé chez la plupart des OPCO depuis le 01/10/2026)';
alter table public.clients add column if not exists opco_subrogation_end date;
comment on column public.clients.opco_subrogation_end is 'OPCO : date d''accord à partir de laquelle la subrogation n''est plus acceptée (vide = acceptée)';

create table if not exists public.invoice_deposit_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  final_invoice_id uuid not null references public.invoices (id) on delete cascade,
  deposit_invoice_id uuid not null references public.invoices (id) on delete restrict,
  amount_ht numeric(12, 2) not null,
  amount_tva numeric(12, 2) not null,
  created_at timestamptz not null default now(),
  unique (deposit_invoice_id)
);
comment on table public.invoice_deposit_links is 'Acomptes déduits d''une facture de solde (un acompte ne se déduit qu''une fois) ; écrite seulement par billing_create_final';
create index if not exists invoice_deposit_links_final_idx on public.invoice_deposit_links (final_invoice_id);
alter table public.invoice_deposit_links enable row level security;
revoke all on table public.invoice_deposit_links from public, anon;
grant select on table public.invoice_deposit_links to authenticated;
grant all on table public.invoice_deposit_links to service_role;

-- Les acomptes déduits d'une facture de solde émise ne bougent plus
create or replace function app.invoice_deposit_links_verrou()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.invoices i where i.id = old.final_invoice_id and i.issued_at is not null) then
    raise exception 'Facture de solde émise : ses acomptes déduits ne se modifient plus' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;
drop trigger if exists invoice_deposit_links_verrou on public.invoice_deposit_links;
create trigger invoice_deposit_links_verrou before update or delete on public.invoice_deposit_links
  for each row execute function app.invoice_deposit_links_verrou();


-- Pose des règles d'une liste de tables : une règle par action, garde du module ajoutée ici.
-- Lecture : module actif, ou super administrateur. Écriture : module actif.
create or replace function pg_temp.regles(p_tables text[], p_module text, p_sel text, p_ins text, p_upd text, p_del text)
returns void
language plpgsql
as $f$
declare
  t text;
  v_on text;
  v_sel text := p_sel; v_ins text := p_ins; v_upd text := p_upd; v_del text := p_del;
begin
  if p_module is not null then
    select '(' || string_agg(format('(select app.module_on(%L))', m), ' or ') || ')' into v_on
    from unnest(string_to_array(p_module, '|')) m;
    if v_sel is not null then v_sel := format('((%s and %s) or (select app.is_superadmin()))', v_on, v_sel); end if;
    if v_ins is not null then v_ins := format('(%s and %s)', v_on, v_ins); end if;
    if v_upd is not null then v_upd := format('(%s and %s)', v_on, v_upd); end if;
    if v_del is not null then v_del := format('(%s and %s)', v_on, v_del); end if;
  end if;
  foreach t in array p_tables loop
    execute format('alter table public.%I enable row level security', t);
    if v_sel is not null then
      execute format('create policy %I on public.%I for select to authenticated using (%s)', t || '_lire', t, v_sel);
    end if;
    if v_ins is not null then
      execute format('create policy %I on public.%I for insert to authenticated with check (%s)', t || '_creer', t, v_ins);
    end if;
    if v_upd is not null then
      execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', t || '_modifier', t, v_upd, v_upd);
    end if;
    if v_del is not null then
      execute format('create policy %I on public.%I for delete to authenticated using (%s)', t || '_supprimer', t, v_del);
    end if;
  end loop;
end
$f$;

-- Suppression des règles nommées du générateur (lire, créer, modifier, supprimer) ; les autres règles
-- (règle restrictive des notifications de 0070, etc.) ne sont pas touchées
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and tablename = any (array['invoice_deposit_links'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- invoice_deposit_links
select pg_temp.regles(array['invoice_deposit_links'], null,
  $r$company_id in (select app.societes_avec_droit('facturation.factures.voir'))$r$,
  null,
  null,
  null);



-- Totaux d'un brouillon préparé par la base, rangés sur la facture (liste, suivi des acomptes) ; l'émission les recalcule
create or replace function app.billing_store_totals(p_invoice uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t jsonb := public.billing_compute_totals(p_invoice);
begin
  update public.invoices set total_ht = (t ->> 'total_ht')::numeric, total_discount = (t ->> 'total_discount')::numeric,
    total_net_ht = (t ->> 'total_net_ht')::numeric, total_tva = (t ->> 'total_tva')::numeric, total_ttc = (t ->> 'total_ttc')::numeric,
    amount_due = (t ->> 'total_ttc')::numeric
  where id = p_invoice and issued_at is null;
end
$$;

-- Totaux d'un devis par taux (lignes acceptées, remise du devis répartie par taux), même règle que les factures
create or replace function app.billing_quote_groups(p_quote uuid)
returns table (rate numeric, lines numeric, allowance numeric, base numeric, tax numeric, nature text, vat_regime text)
language sql
stable
security definer
set search_path = ''
as $$
  with q as (
    select coalesce(discount_percent, 0) as dp, coalesce(tva_applicable, true) as vat from public.quotes where id = p_quote
  ), l as (
    select case when q.vat then coalesce(it.tva_rate, 20) else 0 end as rate,
           round(coalesce(it.quantity, 0) * coalesce(it.unit_price_ht, 0), 2) as net, it.nature, it.vat_regime
    from public.quote_items it, q where it.quote_id = p_quote and it.accepted is not false
  ), g as (
    select l.rate, round(sum(l.net), 2) as lines, min(l.nature) as nature, min(l.vat_regime) as vat_regime from l group by l.rate
  )
  select g.rate, g.lines, round(g.lines * q.dp / 100, 2), round(g.lines - round(g.lines * q.dp / 100, 2), 2),
         case when g.rate > 0 then round(round(g.lines - round(g.lines * q.dp / 100, 2), 2) * g.rate / 100, 2) else 0 end,
         g.nature, g.vat_regime
  from g, q
$$;

create or replace function public.billing_deposit_summary(p_quote uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_total numeric;
begin
  if not app.a_le_droit('facturation.factures.voir') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  select coalesce(sum(base + tax), 0) into v_total from app.billing_quote_groups(p_quote);
  return jsonb_build_object(
    'devis_ttc', v_total,
    'acomptes', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'reference', i.reference, 'emise', i.issued_at is not null,
                   'ttc', i.total_ttc, 'credite', coalesce(i.amount_credited, 0), 'date', i.invoice_date,
                   'deduite', exists (select 1 from public.invoice_deposit_links l where l.deposit_invoice_id = i.id)) order by i.created_at)
                 from public.invoices i where i.quote_id = p_quote and i.type = 'invoice' and i.invoice_kind = 'acompte'), '[]'::jsonb),
    'acomptes_ttc', coalesce((select sum(coalesce(i.total_ttc, 0) - coalesce(i.amount_credited, 0)) from public.invoices i
                              where i.quote_id = p_quote and i.type = 'invoice' and i.invoice_kind = 'acompte'), 0),
    'solde', (select jsonb_build_object('id', i.id, 'reference', i.reference, 'emise', i.issued_at is not null) from public.invoices i
              where i.quote_id = p_quote and i.type = 'invoice' and i.invoice_kind = 'solde' order by i.created_at desc limit 1));
end
$$;

create or replace function public.billing_create_deposit(p_quote uuid, p_percent numeric default null, p_amount_ttc numeric default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
  v_total numeric;
  v_deja numeric;
  v_cible numeric;
  v_id uuid;
  v_libelle text;
begin
  if not app.a_le_droit('facturation.factures.modifier') then
    raise exception 'Accès refusé : préparer les factures ne fait pas partie de vos accès' using errcode = '42501';
  end if;
  select * into q from public.quotes where id = p_quote;
  if q.id is null then
    raise exception 'Devis introuvable' using errcode = 'P0002';
  end if;
  if q.status not in ('accepted', 'partial', 'invoiced') then
    raise exception 'Un acompte se facture sur un devis accepté' using errcode = '22023';
  end if;
  select coalesce(sum(base + tax), 0) into v_total from app.billing_quote_groups(p_quote);
  if v_total <= 0 then
    raise exception 'Devis sans montant' using errcode = '22023';
  end if;
  v_cible := case when p_percent is not null then round(v_total * p_percent / 100, 2) else round(p_amount_ttc, 2) end;
  if v_cible is null or v_cible <= 0 or (p_percent is not null and p_percent > 100) then
    raise exception 'Pourcentage (jusqu''à 100) ou montant TTC positif attendu' using errcode = '22023';
  end if;
  select coalesce(sum(case when i.issued_at is null then (public.billing_compute_totals(i.id) ->> 'total_ttc')::numeric
                           else coalesce(i.total_ttc, 0) - coalesce(i.amount_credited, 0) end), 0) into v_deja
  from public.invoices i where i.quote_id = p_quote and i.type = 'invoice' and i.invoice_kind = 'acompte';
  if v_deja + v_cible > v_total + 0.01 then
    raise exception 'Acomptes supérieurs au devis : % € déjà facturés sur % € TTC', v_deja, v_total using errcode = '22023';
  end if;
  v_libelle := case when p_percent is not null then 'Acompte de ' || trim(to_char(p_percent, 'FM990D99')) || ' % sur le devis ' || q.reference
                    else 'Acompte sur le devis ' || q.reference end;

  insert into public.invoices (reference, type, invoice_kind, client_id, contact_id, quote_id, session_id, client_reference, invoice_date,
    due_date, object, payment_method, payment_terms, discount_percent, tva_applicable, created_by, is_formation_pro, status)
  values ('x', 'invoice', 'acompte', q.client_id, q.contact_id, q.id, q.session_id, q.client_reference, (now() at time zone 'Europe/Paris')::date,
    (now() at time zone 'Europe/Paris')::date, v_libelle, coalesce(q.payment_method, 'virement bancaire'), 'à réception', 0,
    coalesce(q.tva_applicable, true),
    coalesce((select coalesce(p.display_name, p.email) from public.profiles p where p.id = (select auth.uid())), q.created_by), true, 'draft')
  returning id into v_id;

  -- TTC de l'acompte réparti au prorata du TTC de chaque taux du devis ; HT = TTC / (1 + taux)
  insert into public.invoice_items (invoice_id, position, description_title, description_detail, quantity, unit, unit_price_ht,
    tva_rate, total_ht, nature, vat_regime)
  select v_id, (row_number() over (order by g.rate))::int - 1, v_libelle,
    case when count(*) over () > 1 then 'Part au taux de ' || trim(to_char(g.rate, 'FM990D99')) || ' %' else null end,
    1, 'forfait', round(v_cible * (g.base + g.tax) / v_total / (1 + g.rate / 100), 2), g.rate,
    round(v_cible * (g.base + g.tax) / v_total / (1 + g.rate / 100), 2), coalesce(g.nature, 'service'), coalesce(g.vat_regime, 'normal')
  from app.billing_quote_groups(p_quote) g
  where g.base + g.tax > 0;

  perform app.billing_store_totals(v_id);
  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_id, entity_name, details)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'create', 'document', v_id, 'Brouillon de facture d''acompte sur ' || q.reference,
          jsonb_build_object('pourcentage', p_percent));
  return v_id;
end
$$;

create or replace function public.billing_create_final(p_quote uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
  s public.sessions;
  v_id uuid;
  v_pos int;
  d record;
  g record;
  v_ht numeric;
  v_tva numeric;
begin
  if not app.a_le_droit('facturation.factures.modifier') then
    raise exception 'Accès refusé : préparer les factures ne fait pas partie de vos accès' using errcode = '42501';
  end if;
  select * into q from public.quotes where id = p_quote;
  if q.id is null then
    raise exception 'Devis introuvable' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.invoices i where i.quote_id = p_quote and i.invoice_kind = 'acompte' and i.issued_at is null) then
    raise exception 'Un acompte de ce devis est encore en brouillon : émettez-le ou supprimez-le d''abord' using errcode = '22023';
  end if;
  if q.session_id is not null then
    select * into s from public.sessions where id = q.session_id;
  end if;

  insert into public.invoices (reference, type, invoice_kind, client_id, contact_id, quote_id, session_id, client_reference, invoice_date,
    service_start_date, service_end_date, due_date, object, payment_method, payment_terms, discount_percent, tva_applicable, created_by,
    is_formation_pro, status)
  values ('x', 'invoice', 'solde', q.client_id, q.contact_id, q.id, q.session_id, q.client_reference, (now() at time zone 'Europe/Paris')::date,
    s.start_date, s.end_date, (now() at time zone 'Europe/Paris')::date + 30, coalesce(q.object, 'Facture du devis ' || q.reference),
    coalesce(q.payment_method, 'virement bancaire'), coalesce(q.payment_terms, 'à 30 jours'), 0, coalesce(q.tva_applicable, true),
    coalesce((select coalesce(p.display_name, p.email) from public.profiles p where p.id = (select auth.uid())), q.created_by), true, 'draft')
  returning id into v_id;

  insert into public.invoice_items (invoice_id, position, code, description_title, description_detail, quantity, unit, unit_price_ht,
    tva_rate, total_ht, course_id, nature, vat_regime)
  select v_id, (row_number() over (order by it.position, it.created_at))::int - 1, it.code, it.description_title, it.description_detail,
    it.quantity, it.unit, it.unit_price_ht, it.tva_rate, round(coalesce(it.quantity, 0) * coalesce(it.unit_price_ht, 0), 2), it.course_id,
    coalesce(it.nature, 'service'), coalesce(it.vat_regime, 'normal')
  from public.quote_items it where it.quote_id = p_quote and it.accepted is not false;
  select coalesce(max(position), -1) + 1 into v_pos from public.invoice_items where invoice_id = v_id;

  -- Remise du devis : une ligne par taux, au centime près comme le total du devis
  for g in select * from app.billing_quote_groups(p_quote) where allowance > 0 order by rate loop
    insert into public.invoice_items (invoice_id, position, description_title, quantity, unit, unit_price_ht, tva_rate, total_ht, nature, vat_regime)
    values (v_id, v_pos, coalesce(nullif(btrim(q.discount_label), ''), 'Remise') || ' (' || trim(to_char(q.discount_percent, 'FM990D99')) || ' %)',
      1, 'forfait', -g.allowance, g.rate, -g.allowance, coalesce(g.nature, 'service'), coalesce(g.vat_regime, 'normal'));
    v_pos := v_pos + 1;
  end loop;

  -- Acomptes émis, non annulés, pas encore déduits : une ligne de reprise par taux, avec numéro et date
  for d in
    select i.id, i.reference, i.invoice_date from public.invoices i
    where i.quote_id = p_quote and i.type = 'invoice' and i.invoice_kind = 'acompte' and i.issued_at is not null
      and coalesce(i.amount_credited, 0) <= 0.01
      and not exists (select 1 from public.invoice_deposit_links l where l.deposit_invoice_id = i.id)
    order by i.invoice_date, i.created_at
  loop
    v_ht := 0; v_tva := 0;
    for g in
      select coalesce(it.tva_rate, 20) as rate, round(sum(round(coalesce(it.quantity, 0) * coalesce(it.unit_price_ht, 0), 2)), 2) as ht,
             min(it.nature) as nature, min(it.vat_regime) as vat_regime
      from public.invoice_items it where it.invoice_id = d.id group by coalesce(it.tva_rate, 20) order by 1
    loop
      insert into public.invoice_items (invoice_id, position, description_title, description_detail, quantity, unit, unit_price_ht,
        tva_rate, total_ht, nature, vat_regime)
      values (v_id, v_pos, 'Reprise de l''acompte ' || d.reference || ' du ' || to_char(d.invoice_date, 'DD/MM/YYYY'), null, 1, 'forfait',
        -g.ht, g.rate, -g.ht, coalesce(g.nature, 'service'), coalesce(g.vat_regime, 'normal'));
      v_pos := v_pos + 1;
      v_ht := v_ht + g.ht;
      v_tva := v_tva + case when g.rate > 0 then round(g.ht * g.rate / 100, 2) else 0 end;
    end loop;
    insert into public.invoice_deposit_links (company_id, final_invoice_id, deposit_invoice_id, amount_ht, amount_tva)
    values (app.billing_company(), v_id, d.id, v_ht, v_tva);
  end loop;

  perform app.billing_store_totals(v_id);
  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_id, entity_name, details)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'create', 'document', v_id, 'Brouillon de facture de solde sur ' || q.reference,
          jsonb_build_object('acomptes', (select count(*) from public.invoice_deposit_links where final_invoice_id = v_id)));
  return v_id;
end
$$;

revoke all on function app.billing_quote_groups(uuid), app.invoice_deposit_links_verrou(), app.billing_store_totals(uuid) from public, anon, authenticated;
revoke all on function public.billing_deposit_summary(uuid), public.billing_create_deposit(uuid, numeric, numeric), public.billing_create_final(uuid)
  from public, anon;
grant execute on function public.billing_deposit_summary(uuid), public.billing_create_deposit(uuid, numeric, numeric), public.billing_create_final(uuid)
  to authenticated, service_role;

create or replace function app.billing_check(p_invoice uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  inv public.invoices;
  c public.clients;
  o public.organization_settings;
  s public.billing_settings;
  v_pts jsonb := '[]'::jsonb;
  v_ment jsonb := '[]'::jsonb;
  v_pro boolean;
  v_public boolean;
  v_credit boolean;
  v_net numeric;
  v_n_bien int;
  v_n_service int;
  v_exo boolean;
  v_auto boolean;
  v_franchise boolean;
  v_societe boolean;
  v_ident text;
  v_regle record;
begin
  select * into inv from public.invoices where id = p_invoice;
  if inv.id is null then
    raise exception 'Document introuvable' using errcode = 'P0002';
  end if;
  select * into c from public.clients where id = coalesce(inv.billing_client_id, inv.client_id);
  select * into o from public.organization_settings limit 1;
  select * into s from public.billing_settings where company_id = app.billing_company();
  v_credit := inv.type = 'credit_note';
  v_pro := coalesce(c.client_type, 'entreprise') <> 'particulier';
  v_public := c.client_type = 'public';
  v_franchise := o.tva_applicable is false;
  v_societe := coalesce(o.forme_juridique, '') !~* '(entrepreneur|individuel|^ei$|micro)';
  select coalesce(sum(round(coalesce(quantity, 0) * coalesce(unit_price_ht, 0), 2)), 0) * (1 - coalesce(inv.discount_percent, 0) / 100),
         count(*) filter (where nature = 'bien'), count(*) filter (where nature <> 'bien'),
         bool_or(vat_regime = 'exonere'), bool_or(vat_regime = 'autoliquidation')
    into v_net, v_n_bien, v_n_service, v_exo, v_auto
  from public.invoice_items where invoice_id = p_invoice;

  -- Vendeur
  if coalesce(nullif(btrim(o.legal_name), ''), nullif(btrim(o.name), '')) is null then
    v_pts := v_pts || jsonb_build_object('code', 'vendeur_nom', 'libelle', 'raison sociale de l''organisme', 'ou', 'parametres', 'bloquant', true);
  end if;
  if coalesce(nullif(btrim(o.siren), ''), nullif(btrim(o.siret), '')) is null then
    v_pts := v_pts || jsonb_build_object('code', 'vendeur_siren', 'libelle', 'SIREN de l''organisme', 'ou', 'parametres', 'bloquant', true);
  end if;
  if nullif(btrim(o.address), '') is null or nullif(btrim(o.postal_code), '') is null or nullif(btrim(o.city), '') is null then
    v_pts := v_pts || jsonb_build_object('code', 'vendeur_adresse', 'libelle', 'adresse du siège de l''organisme', 'ou', 'parametres', 'bloquant', true);
  end if;
  if nullif(btrim(o.forme_juridique), '') is null then
    v_pts := v_pts || jsonb_build_object('code', 'vendeur_forme', 'libelle', 'forme juridique de l''organisme', 'ou', 'parametres', 'bloquant', true);
  elsif v_societe and o.capital_social is null then
    v_pts := v_pts || jsonb_build_object('code', 'vendeur_capital', 'libelle', 'capital social de l''organisme', 'ou', 'parametres', 'bloquant', true);
  end if;
  if not v_franchise and nullif(btrim(o.tva_intra), '') is null then
    v_pts := v_pts || jsonb_build_object('code', 'vendeur_tva', 'libelle', 'numéro de TVA intracommunautaire de l''organisme', 'ou', 'parametres', 'bloquant', true);
  end if;
  if v_societe and nullif(btrim(o.rcs), '') is null then
    v_pts := v_pts || jsonb_build_object('code', 'vendeur_rcs', 'libelle', 'mention RCS et ville du greffe de l''organisme', 'ou', 'parametres', 'bloquant', false);
  end if;

  -- Circuit de validation (0367, règles de gestion) : facture soumise à validation selon la règle du client, sinon
  -- de la société, sinon le défaut du produit (toujours validée par « Valider les factures »). Émet directement
  -- la personne qui a le droit du valideur (circuit à une étape) ; sinon il faut une demande validée.
  if not v_credit then
    select * into v_regle from app.approval_rule_for(app.billing_company(), 'invoice', inv.client_id);
    if v_regle.mode = 'always' or (v_regle.mode = 'threshold' and v_net > coalesce(v_regle.threshold, 0)) then
      if not exists (select 1 from public.approval_requests ar where ar.object_table = 'invoices' and ar.object_id = inv.id
                       and ar.status = 'approved')
         and not (app.a_le_droit(v_regle.validator_right) and jsonb_array_length(coalesce(v_regle.extra_steps, '[]'::jsonb)) = 0) then
        v_pts := v_pts || jsonb_build_object('code', 'circuit',
          'libelle', case when exists (select 1 from public.approval_requests ar where ar.object_table = 'invoices'
                                        and ar.object_id = inv.id and ar.status = 'pending')
                          then 'validation en attente (circuit de la société)'
                          else 'validation requise avant émission : demandez la validation' end,
          'ou', 'circuit', 'bloquant', true);
      end if;
    end if;
  end if;

  -- Acomptes (0368) : un avoir sur un acompte déjà déduit d'une facture de solde ferait compter deux fois la déduction ;
  -- une facture de solde ne déduit que des acomptes émis et non annulés.
  if v_credit and exists (select 1 from public.invoice_deposit_links l where l.deposit_invoice_id = inv.parent_invoice_id) then
    v_pts := v_pts || jsonb_build_object('code', 'acompte_repris',
      'libelle', 'acompte déjà déduit d''une facture de solde : faites l''avoir sur la facture de solde', 'ou', 'facture', 'bloquant', true);
  end if;
  if inv.invoice_kind = 'solde' and exists (select 1 from public.invoice_deposit_links l join public.invoices d on d.id = l.deposit_invoice_id
                                            where l.final_invoice_id = inv.id and (d.issued_at is null or coalesce(d.amount_credited, 0) > 0.01)) then
    v_pts := v_pts || jsonb_build_object('code', 'acompte_annule',
      'libelle', 'un acompte déduit a été annulé par un avoir : refaites la facture de solde', 'ou', 'facture', 'bloquant', true);
  end if;

  -- Financement OPCO (0368) : numéro de dossier obligatoire sur une facture à un OPCO ; subrogation signalée si
  -- l'OPCO ne l'accepte plus pour les accords datés de sa date de fin ou après (réglée sur la fiche de l'OPCO).
  if c.client_type = 'opco' and nullif(btrim(coalesce(inv.client_reference, '')), '') is null then
    v_pts := v_pts || jsonb_build_object('code', 'opco_dossier', 'libelle', 'numéro de dossier de l''OPCO (référence client de la facture)',
      'ou', 'facture', 'bloquant', true);
  end if;
  if coalesce(inv.is_subrogation, false) and c.opco_subrogation_end is not null
     and coalesce((select max(f.agreement_date) from public.session_fundings f
                   where f.session_id = inv.session_id and f.funder_client_id = c.id), inv.invoice_date) >= c.opco_subrogation_end then
    v_pts := v_pts || jsonb_build_object('code', 'opco_subrogation',
      'libelle', 'subrogation : ' || coalesce(c.name, 'l''OPCO') || ' ne l''accepte plus pour les accords datés du '
        || to_char(c.opco_subrogation_end, 'DD/MM/YYYY') || ' ou après (vérifiez l''accord)', 'ou', 'facture', 'bloquant', false);
  end if;

  -- Client
  if c.id is null or nullif(btrim(c.name), '') is null then
    v_pts := v_pts || jsonb_build_object('code', 'client_nom', 'libelle', 'nom du client', 'ou', 'client', 'bloquant', true);
  end if;
  if c.id is not null and (nullif(btrim(c.address), '') is null or nullif(btrim(c.postal_code), '') is null or nullif(btrim(c.city), '') is null) then
    v_pts := v_pts || jsonb_build_object('code', 'client_adresse', 'libelle', 'adresse complète du client', 'ou', 'client', 'bloquant', true);
  end if;
  if v_pro and coalesce(nullif(btrim(c.siren), ''), nullif(btrim(c.siret), '')) is null then
    v_pts := v_pts || jsonb_build_object('code', 'client_siren', 'libelle', 'SIREN ou SIRET du client', 'ou', 'client', 'bloquant', true);
  end if;
  if v_pro and not coalesce(c.vat_exempt, false) and not v_franchise and v_net > 150 and nullif(btrim(c.tva), '') is null then
    v_pts := v_pts || jsonb_build_object('code', 'client_tva', 'libelle', 'numéro de TVA du client (au-delà de 150 € HT)', 'ou', 'client', 'bloquant', true);
  end if;
  -- Revérification du SIRET dans l'annuaire (0365) : facture à un professionnel, contrôle de moins de 24 h
  -- fait par /api/verifier-siret pour le SIRET actuel du client, ou motif saisi si l'annuaire ne répondait pas.
  v_ident := regexp_replace(coalesce(nullif(btrim(c.siret), ''), c.siren, ''), '\s', '', 'g');
  if v_pro and not v_credit and v_ident ~ '^[0-9]{9}([0-9]{5})?$' then
    if inv.siret_checked_at > now() - interval '24 hours' and inv.siret_check_result ->> 'identifiant' = v_ident then
      if inv.siret_check_result ->> 'etat' in ('ferme', 'siege_deplace', 'inconnu') then
        v_pts := v_pts || jsonb_build_object('code', 'siret_' || (inv.siret_check_result ->> 'etat'),
          'libelle', 'annuaire : ' || coalesce(inv.siret_check_result ->> 'message', 'à vérifier')
            || coalesce(' (' || nullif(concat_ws(' ', inv.siret_check_result ->> 'adresse', inv.siret_check_result ->> 'code_postal',
                 inv.siret_check_result ->> 'ville'), '') || ')', ''),
          'ou', 'client', 'bloquant', false);
      elsif jsonb_array_length(coalesce(inv.siret_check_result -> 'ecarts', '[]'::jsonb)) > 0 then
        v_pts := v_pts || jsonb_build_object('code', 'siret_adresse',
          'libelle', 'adresse du client différente de l''annuaire : ' || concat_ws(' ', inv.siret_check_result ->> 'adresse',
            inv.siret_check_result ->> 'code_postal', inv.siret_check_result ->> 'ville'),
          'ou', 'client', 'bloquant', false);
      end if;
    elsif inv.siret_motif_at > now() - interval '24 hours' and length(btrim(coalesce(inv.siret_check_motif, ''))) >= 5 then
      v_pts := v_pts || jsonb_build_object('code', 'siret_motif',
        'libelle', 'annuaire non consulté, motif : ' || btrim(inv.siret_check_motif), 'ou', 'annuaire', 'bloquant', false);
    else
      v_pts := v_pts || jsonb_build_object('code', 'siret_controle',
        'libelle', 'vérification du SIRET du client dans l''annuaire (moins de 24 h)', 'ou', 'annuaire', 'bloquant', true);
    end if;
  end if;
  if v_public and nullif(btrim(c.siret), '') is null then
    v_pts := v_pts || jsonb_build_object('code', 'public_siret', 'libelle', 'SIRET du client public (Chorus Pro)', 'ou', 'client', 'bloquant', true);
  end if;
  if v_public and nullif(btrim(c.chorus_service_code), '') is not null and nullif(btrim(inv.chorus_service_code), '') is null then
    v_pts := v_pts || jsonb_build_object('code', 'chorus_service', 'libelle', 'code service Chorus Pro sur la facture', 'ou', 'facture', 'bloquant', true);
  end if;
  if v_public and coalesce(c.chorus_engagement_required, false)
     and coalesce(nullif(btrim(inv.chorus_engagement), ''), nullif(btrim(inv.client_reference), '')) is null then
    v_pts := v_pts || jsonb_build_object('code', 'chorus_engagement', 'libelle', 'numéro d''engagement ou bon de commande (Chorus Pro)', 'ou', 'facture', 'bloquant', true);
  end if;

  -- Lignes et régimes
  if v_exo and not coalesce(s.exoneration_formation_active, false) then
    v_pts := v_pts || jsonb_build_object('code', 'exoneration', 'libelle', 'ligne exonérée alors que l''exonération n''est pas activée dans les réglages', 'ou', 'facture', 'bloquant', true);
  elsif v_exo and nullif(btrim(s.exoneration_attestation_ref), '') is null then
    v_pts := v_pts || jsonb_build_object('code', 'exoneration_attestation', 'libelle', 'référence de l''attestation d''exonération (réglages de facturation)', 'ou', 'parametres', 'bloquant', true);
  end if;
  if v_auto and (not v_pro or nullif(btrim(c.tva), '') is null) then
    v_pts := v_pts || jsonb_build_object('code', 'autoliquidation', 'libelle', 'autoliquidation seulement pour un client professionnel avec son numéro de TVA', 'ou', 'facture', 'bloquant', true);
  end if;
  if v_franchise and exists (select 1 from public.invoice_items where invoice_id = p_invoice and coalesce(tva_rate, 0) > 0) then
    v_pts := v_pts || jsonb_build_object('code', 'franchise_taux', 'libelle', 'TVA sur une ligne alors que l''organisme est en franchise', 'ou', 'facture', 'bloquant', true);
  end if;

  -- Facture
  if not v_credit and inv.due_date is null then
    v_pts := v_pts || jsonb_build_object('code', 'echeance', 'libelle', 'date d''échéance', 'ou', 'facture', 'bloquant', true);
  end if;
  if inv.service_start_date is null and inv.service_end_date is null then
    v_pts := v_pts || jsonb_build_object('code', 'date_prestation', 'libelle', 'date de la prestation (à défaut, la date d''émission vaut date de prestation)', 'ou', 'facture', 'bloquant', false);
  end if;

  -- Mentions légales
  if not v_credit and v_pro then
    v_ment := v_ment || to_jsonb(coalesce(s.mention_escompte, 'Escompte pour paiement anticipé : néant.'));
    v_ment := v_ment || to_jsonb(s.mention_penalites);
    v_ment := v_ment || to_jsonb(s.mention_indemnite);
  end if;
  if v_franchise then v_ment := v_ment || to_jsonb(s.mention_franchise); end if;
  if v_exo then
    v_ment := v_ment || to_jsonb(s.mention_exoneration || coalesce(' Attestation ' || nullif(btrim(s.exoneration_attestation_ref), ''), '')
      || coalesce(' du ' || to_char(s.exoneration_attestation_date, 'DD/MM/YYYY'), '') || case when s.exoneration_attestation_ref is not null then '.' else '' end);
  end if;
  if v_auto then v_ment := v_ment || to_jsonb(s.mention_autoliquidation); end if;
  if s.option_debits and not v_franchise then v_ment := v_ment || to_jsonb(s.mention_debits); end if;
  v_ment := (select coalesce(jsonb_agg(m), '[]'::jsonb) from jsonb_array_elements(v_ment) m where m is not null and m <> 'null'::jsonb);

  return jsonb_build_object('points', v_pts, 'mentions', v_ment,
    'nature', case when v_n_bien > 0 and v_n_service > 0 then 'mixte' when v_n_bien > 0 then 'biens' else 'services' end);
end
$$;

insert into public.schema_migrations (version) values ('0368_facturation_acomptes_financeurs') on conflict (version) do nothing;
