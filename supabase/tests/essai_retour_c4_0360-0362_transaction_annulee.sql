-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (c4_0360-0362) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0360_facturation_reglages.sql, 0361_facturation_emission.sql, 0362_facturation_verrou.sql, retour arrière,
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

-- ===== supabase/migrations/0360_facturation_reglages.sql =====
-- 0360_facturation_reglages.sql : réglages de facturation et compteurs par société (Facturation fiable, branche
-- facturation/numerotation). Décisions du 17/10 : format FACT-AAAAMMJJ-NNNNN et AVR-…, compteur continu, jamais remis
-- à zéro ; une société qui existe déjà reprend la suite de ses numéros (dernier numéro à saisir dans les réglages),
-- une société créée part de 1.
--   billing_settings   une ligne par société : préfixes, format, dernier numéro avant l'outil (vide = à saisir)
--   billing_sequences  compteur par société et par série (facture, avoir), écrit seulement par billing_issue (0361)
-- Règles d'accès : matrice de scripts/securite/regles.py (MD_SUITE, 0360), écriture « droits ».
-- Idempotente. Retour arrière : supabase/rollback/0360-0362_facturation_numerotation_retour.sql

create table if not exists public.billing_settings (
  company_id uuid primary key references public.companies (id) on delete cascade,
  invoice_prefix text not null default 'FACT' check (invoice_prefix ~ '^[A-Z0-9]{1,10}$'),
  credit_prefix text not null default 'AVR' check (credit_prefix ~ '^[A-Z0-9]{1,10}$'),
  number_format text not null default '{PREFIXE}-{AAAAMMJJ}-{N5}'
    check (number_format ~ '\{N[0-9]?\}' and number_format ~ '\{PREFIXE\}' and char_length(number_format) <= 60),
  invoice_last_number_before bigint check (invoice_last_number_before >= 0),
  credit_last_number_before bigint check (credit_last_number_before >= 0),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
comment on table public.billing_settings is 'Réglages de facturation par société : préfixes, format du numéro, dernier numéro de la société avant l''outil (reprise de la suite)';
comment on column public.billing_settings.invoice_last_number_before is 'Dernier numéro de facture émis avant l''outil (la première facture prend le suivant). Vide : à saisir ; en attendant, suite des numéros déjà dans l''outil';

create table if not exists public.billing_sequences (
  company_id uuid not null references public.companies (id) on delete cascade,
  series text not null check (series in ('invoice', 'credit_note')),
  last_number bigint not null check (last_number >= 0),
  updated_at timestamptz not null default now(),
  primary key (company_id, series)
);
comment on table public.billing_sequences is 'Compteur continu des numéros par société et par série ; écrit seulement par billing_issue (verrou de ligne : ni trou ni doublon)';

revoke all on table public.billing_settings, public.billing_sequences from public, anon;
grant select, insert, update, delete on table public.billing_settings to authenticated;
grant select on table public.billing_sequences to authenticated;
grant all on table public.billing_settings, public.billing_sequences to service_role;

-- Une ligne de réglages par société existante (valeurs par défaut, dernier numéro à saisir)
insert into public.billing_settings (company_id)
select c.id from public.companies c
on conflict (company_id) do nothing;

-- Règles d'accès (générées par scripts/securite/regles.py, build_suite('0360'))

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
           where schemaname = 'public' and tablename = any (array['billing_sequences', 'billing_settings'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- billing_sequences
select pg_temp.regles(array['billing_sequences'], null,
  $r$company_id in (select app.societes_avec_droit('facturation.factures.voir'))$r$,
  null,
  null,
  null);

-- billing_settings
select pg_temp.regles(array['billing_settings'], null,
  $r$company_id in (select app.societes_avec_droit('organisation.reglages.voir'))$r$,
  $r$company_id in (select app.societes_avec_droit('parametres.organisme.modifier'))$r$,
  $r$company_id in (select app.societes_avec_droit('parametres.organisme.modifier'))$r$,
  $r$(select app.a_le_droit('plateforme.administrer'))$r$);

insert into public.schema_migrations (version) values ('0360_facturation_reglages') on conflict (version) do nothing;

-- ===== supabase/migrations/0361_facturation_emission.sql =====
-- 0361_facturation_emission.sql : émission des factures et des avoirs par la base (Facturation fiable).
--
-- Décisions du 17/10 : aucun numéro avant la validation (le brouillon porte « BROUILLON-… », sans valeur) ; le numéro
-- définitif est donné par la base à l'émission, dans la même transaction que le calcul des totaux et le gel des
-- coordonnées du vendeur et du client ; « émise » = date d'émission renseignée (issued_at), les statuts actuels
-- restent ceux des écrans.
--   app.billing_company()         société de facturation (la société de l'instance tant que C2 n'a pas rattaché
--                                 invoices à une société)
--   app.billing_format(...)       numéro selon le format réglé : {PREFIXE} {AAAA} {MM} {JJ} {AAAAMMJJ} {N} {N4}..{N9}
--   billing_compute_totals(id)    totaux d'un document, même règle que src/core/billing/totals.js (EN 16931)
--   billing_issue(id)             émission : contrôles, totaux, coordonnées figées, numéro, date du jour
--   billing_next_number(type)     aperçu du prochain numéro (lecture, n'avance pas le compteur)
-- Reprise : les factures déjà sorties du brouillon sont marquées émises (date de facture) ; leurs numéros restent.
-- Idempotente. Retour arrière : supabase/rollback/0360-0362_facturation_numerotation_retour.sql

alter table public.invoices add column if not exists issued_at timestamptz;
alter table public.invoices add column if not exists issued_by uuid;
alter table public.invoices add column if not exists seller_snapshot jsonb;
alter table public.invoices add column if not exists buyer_snapshot jsonb;
comment on column public.invoices.issued_at is 'Date d''émission : la facture est numérotée et figée (aucune modification ni suppression ensuite)';
comment on column public.invoices.seller_snapshot is 'Coordonnées du vendeur figées à l''émission';
comment on column public.invoices.buyer_snapshot is 'Coordonnées du client (et du payeur) figées à l''émission';

-- Reprise : ce qui n'est plus un brouillon a déjà été émis
update public.invoices
   set issued_at = coalesce(invoice_date::timestamp at time zone 'Europe/Paris', created_at)
 where issued_at is null and status is distinct from 'draft';

create or replace function app.billing_company()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.current_company(), (select c.id from public.companies c where c.is_instance_owner limit 1))
$$;

create or replace function app.billing_format(p_format text, p_prefix text, p_day date, p_number bigint)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := p_format;
  m text[];
begin
  v := replace(v, '{PREFIXE}', p_prefix);
  v := replace(v, '{AAAAMMJJ}', to_char(p_day, 'YYYYMMDD'));
  v := replace(v, '{AAAA}', to_char(p_day, 'YYYY'));
  v := replace(v, '{MM}', to_char(p_day, 'MM'));
  v := replace(v, '{JJ}', to_char(p_day, 'DD'));
  m := regexp_match(v, '\{N([0-9]?)\}');
  if m is null then
    raise exception 'Format de numéro sans compteur : %', p_format using errcode = '22023';
  end if;
  return regexp_replace(v, '\{N[0-9]?\}',
    case when m[1] = '' then p_number::text else lpad(p_number::text, greatest(m[1]::int, length(p_number::text)), '0') end);
end
$$;

-- Totaux : ligne arrondie ; regroupement par taux ; remise par groupe arrondie ; TVA par groupe arrondie ; TTC = HT net + TVA
create or replace function public.billing_compute_totals(p_invoice uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with inv as (
    select i.id, coalesce(i.discount_percent, 0) as dp, coalesce(i.tva_applicable, true) as vat
    from public.invoices i where i.id = p_invoice and app.a_le_droit('facturation.factures.voir')
  ), lignes as (
    select case when inv.vat then coalesce(it.tva_rate, 20) else 0 end as rate,
           round(coalesce(it.quantity, 0) * coalesce(it.unit_price_ht, 0), 2) as net
    from public.invoice_items it join inv on inv.id = it.invoice_id
  ), groupes as (
    select l.rate, round(sum(l.net), 2) as lines from lignes l group by l.rate
  ), calc as (
    select g.rate, g.lines,
           case when inv.dp > 0 then round(g.lines * inv.dp / 100, 2) else 0 end as allowance
    from groupes g, inv
  ), fin as (
    select c.rate, c.lines, c.allowance, round(c.lines - c.allowance, 2) as base,
           case when c.rate > 0 then round(round(c.lines - c.allowance, 2) * c.rate / 100, 2) else 0 end as tax
    from calc c
  )
  select jsonb_build_object(
    'total_ht', coalesce((select round(sum(net), 2) from lignes), 0),
    'total_discount', coalesce((select round(sum(allowance), 2) from fin), 0),
    'total_net_ht', coalesce((select round(sum(base), 2) from fin), 0),
    'total_tva', coalesce((select round(sum(tax), 2) from fin), 0),
    'total_ttc', coalesce((select round(sum(base), 2) + round(sum(tax), 2) from fin), 0),
    'par_taux', coalesce((select jsonb_agg(jsonb_build_object('taux', rate, 'base', base, 'tva', tax) order by rate) from fin), '[]'::jsonb))
$$;

create or replace function public.billing_next_number(p_type text default 'invoice')
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company uuid := app.billing_company();
  s public.billing_settings;
  v_prefix text;
  v_last bigint;
begin
  if not (app.a_le_droit('facturation.factures.voir')) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  select * into s from public.billing_settings where company_id = v_company;
  v_prefix := case when p_type = 'credit_note' then coalesce(s.credit_prefix, 'AVR') else coalesce(s.invoice_prefix, 'FACT') end;
  select q.last_number into v_last from public.billing_sequences q where q.company_id = v_company and q.series = p_type;
  if v_last is null then
    v_last := coalesce(case when p_type = 'credit_note' then s.credit_last_number_before else s.invoice_last_number_before end,
      (select max((regexp_match(i.reference, '([0-9]+)$'))[1]::bigint) from public.invoices i
        where i.issued_at is not null and i.type = p_type and i.reference like v_prefix || '%'), 0);
  end if;
  return app.billing_format(coalesce(s.number_format, '{PREFIXE}-{AAAAMMJJ}-{N5}'), v_prefix,
                            (now() at time zone 'Europe/Paris')::date, v_last + 1);
end
$$;

create or replace function public.billing_issue(p_invoice uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invoices;
  v_company uuid := app.billing_company();
  s public.billing_settings;
  v_today date := (now() at time zone 'Europe/Paris')::date;
  v_prefix text;
  v_last bigint;
  v_ref text;
  t jsonb;
  v_parent public.invoices;
  v_credites numeric;
  v_seller jsonb;
  v_buyer jsonb;
begin
  select * into inv from public.invoices where id = p_invoice for update;
  if inv.id is null then
    raise exception 'Document introuvable' using errcode = 'P0002';
  end if;
  if not app.a_le_droit(case when inv.type = 'credit_note' then 'facturation.avoirs.emettre' else 'facturation.factures.valider' end) then
    raise exception 'Accès refusé : émettre ce document ne fait pas partie de vos accès' using errcode = '42501';
  end if;
  if inv.issued_at is not null then
    raise exception 'Ce document est déjà émis (%)', inv.reference using errcode = '22023';
  end if;
  if inv.client_id is null then
    raise exception 'Client manquant' using errcode = '22023';
  end if;
  if not exists (select 1 from public.invoice_items where invoice_id = p_invoice) then
    raise exception 'Document sans ligne' using errcode = '22023';
  end if;

  t := public.billing_compute_totals(p_invoice);
  if inv.type = 'credit_note' then
    select * into v_parent from public.invoices where id = inv.parent_invoice_id;
    if v_parent.id is null or v_parent.issued_at is null then
      raise exception 'Un avoir se rattache à une facture émise' using errcode = '22023';
    end if;
    select coalesce(sum(total_ttc), 0) into v_credites from public.invoices
    where parent_invoice_id = v_parent.id and type = 'credit_note' and issued_at is not null;
    if v_credites + (t ->> 'total_ttc')::numeric > coalesce(v_parent.total_ttc, 0) + 0.01 then
      raise exception 'Avoirs supérieurs au montant de la facture % (% € déjà crédités)', v_parent.reference, v_credites
        using errcode = '22023';
    end if;
  elsif (t ->> 'total_ttc')::numeric <= 0 then
    raise exception 'Facture d''un montant nul ou négatif : utiliser un avoir' using errcode = '22023';
  end if;

  -- Réglages et compteur de la société (ligne verrouillée jusqu'à la fin de la transaction)
  insert into public.billing_settings (company_id) values (v_company) on conflict (company_id) do nothing;
  select * into s from public.billing_settings where company_id = v_company;
  v_prefix := case when inv.type = 'credit_note' then s.credit_prefix else s.invoice_prefix end;
  select q.last_number into v_last from public.billing_sequences q
  where q.company_id = v_company and q.series = inv.type for update;
  if v_last is null then
    v_last := coalesce(case when inv.type = 'credit_note' then s.credit_last_number_before else s.invoice_last_number_before end,
      (select max((regexp_match(i.reference, '([0-9]+)$'))[1]::bigint) from public.invoices i
        where i.issued_at is not null and i.type = inv.type and i.reference like v_prefix || '%'), 0);
    insert into public.billing_sequences (company_id, series, last_number) values (v_company, inv.type, v_last)
    on conflict (company_id, series) do nothing;
    select q.last_number into v_last from public.billing_sequences q
    where q.company_id = v_company and q.series = inv.type for update;
  end if;
  v_ref := app.billing_format(s.number_format, v_prefix, v_today, v_last + 1);
  if exists (select 1 from public.invoices where reference = v_ref) then
    raise exception 'Numéro % déjà utilisé : vérifier le dernier numéro dans les réglages de facturation', v_ref
      using errcode = '23505';
  end if;
  update public.billing_sequences set last_number = v_last + 1, updated_at = now()
  where company_id = v_company and series = inv.type;

  -- Coordonnées figées (vendeur : réglages de l'organisme ; client et payeur : fiches au moment de l'émission)
  select jsonb_strip_nulls(jsonb_build_object('name', o.name, 'legal_name', o.legal_name, 'forme_juridique', o.forme_juridique,
           'capital_social', o.capital_social, 'siret', o.siret, 'siren', o.siren, 'naf', o.naf, 'tva_intra', o.tva_intra,
           'rcs', o.rcs, 'nda', o.nda, 'address', o.address, 'postal_code', o.postal_code, 'city', o.city,
           'phone', o.phone, 'email', o.email, 'website', o.website))
    into v_seller from public.organization_settings o limit 1;
  select jsonb_strip_nulls(jsonb_build_object('client', (select jsonb_strip_nulls(jsonb_build_object('id', c.id, 'name', c.name,
           'address', c.address, 'postal_code', c.postal_code, 'city', c.city, 'siret', c.siret, 'siren', c.siren, 'tva', c.tva,
           'client_type', c.client_type)) from public.clients c where c.id = inv.client_id),
         'payeur', (select jsonb_strip_nulls(jsonb_build_object('id', c.id, 'name', c.name, 'address', c.address,
           'postal_code', c.postal_code, 'city', c.city, 'siret', c.siret, 'siren', c.siren, 'tva', c.tva))
           from public.clients c where c.id = inv.billing_client_id)))
    into v_buyer;

  update public.invoices set
    reference = v_ref,
    issued_at = now(),
    issued_by = (select auth.uid()),
    due_date = case when inv.due_date is not null and inv.invoice_date is not null
                    then v_today + (inv.due_date - inv.invoice_date) else inv.due_date end,
    invoice_date = v_today,
    total_ht = (t ->> 'total_ht')::numeric,
    total_discount = (t ->> 'total_discount')::numeric,
    total_net_ht = (t ->> 'total_net_ht')::numeric,
    total_tva = (t ->> 'total_tva')::numeric,
    total_ttc = (t ->> 'total_ttc')::numeric,
    amount_due = case when inv.type = 'credit_note' then inv.amount_due
                      else greatest(0, (t ->> 'total_ttc')::numeric - coalesce(inv.amount_paid, 0) - coalesce(inv.amount_credited, 0)) end,
    status = 'due',
    seller_snapshot = v_seller,
    buyer_snapshot = v_buyer,
    updated_at = now()
  where id = p_invoice;

  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_id, entity_name, details)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'update', 'document', p_invoice, v_ref,
          jsonb_build_object('emission', true, 'type', inv.type));

  return jsonb_build_object('reference', v_ref, 'invoice_date', v_today, 'total_ttc', (t ->> 'total_ttc')::numeric);
end
$$;

revoke all on function app.billing_company(), app.billing_format(text, text, date, bigint) from public, anon;
grant execute on function app.billing_company(), app.billing_format(text, text, date, bigint) to authenticated, service_role;
revoke all on function public.billing_compute_totals(uuid), public.billing_next_number(text), public.billing_issue(uuid)
  from public, anon;
grant execute on function public.billing_compute_totals(uuid), public.billing_next_number(text), public.billing_issue(uuid)
  to authenticated, service_role;

insert into public.schema_migrations (version) values ('0361_facturation_emission') on conflict (version) do nothing;

-- ===== supabase/migrations/0362_facturation_verrou.sql =====
-- 0362_facturation_verrou.sql : facture émise figée, en base (Facturation fiable).
--
-- Décision du 17/10 : une facture émise n'est modifiable ni supprimable par personne, super administrateur compris ;
-- une erreur se corrige par un avoir. Garanti en base pour l'application, l'API et tous les comptes.
--   À la création : un document naît brouillon, sans numéro (référence « BROUILLON-… »), jamais déjà émis.
--   Brouillon : il ne quitte l'état brouillon que par billing_issue (0361).
--   Émis : seuls changent les champs de vie (statut de paiement, montants payés, dus et crédités, transmission au
--   comptable, notes internes, date de mise à jour) ; retour en brouillon et annulation refusés ; suppression refusée.
--   Lignes d'un document émis : aucune création, modification ni suppression.
-- Limite connue : le propriétaire de la base (éditeur SQL de Supabase) peut désactiver un déclencheur.
-- Idempotente. Retour arrière : supabase/rollback/0360-0362_facturation_numerotation_retour.sql

-- Sans SECURITY DEFINER : current_user est le rôle de la requête. Un compte connecté (authenticated) ne peut pas poser
-- la date d'émission lui-même ; billing_issue (SECURITY DEFINER, propriétaire de la base) le peut.
create or replace function app.invoices_verrou()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.issued_at := null;
    new.issued_by := null;
    new.seller_snapshot := null;
    new.buyer_snapshot := null;
    new.status := 'draft';
    new.reference := 'BROUILLON-' || upper(substr(replace(new.id::text, '-', ''), 1, 10));
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.issued_at is not null then
      raise exception 'Document émis (%) : suppression impossible, corriger par un avoir', old.reference using errcode = '42501';
    end if;
    return old;
  end if;
  -- UPDATE
  if old.issued_at is null then
    if new.issued_at is not null and current_user in ('authenticated', 'anon') then
      raise exception 'L''émission passe par la fonction d''émission' using errcode = '42501';
    end if;
    if new.issued_at is null and new.status is distinct from 'draft' then
      raise exception 'Un brouillon s''émet avant de changer de statut' using errcode = '42501';
    end if;
    if new.issued_at is null then
      new.reference := old.reference;
    end if;
    return new;
  end if;
  if new.status in ('draft', 'cancelled') then
    raise exception 'Document émis (%) : retour en brouillon ou annulation impossible, corriger par un avoir', old.reference
      using errcode = '42501';
  end if;
  if (new.reference, new.type, new.client_id, new.contact_id, new.quote_id, new.session_id, new.parent_invoice_id,
      new.client_reference, new.invoice_date, new.service_start_date, new.service_end_date, new.due_date, new.object,
      new.payment_method, new.payment_terms, new.discount_percent, new.discount_label, new.tva_applicable, new.total_ht,
      new.total_discount, new.total_net_ht, new.total_tva, new.total_ttc, new.is_formation_pro, new.billing_client_id,
      new.is_subrogation, new.issued_at, new.issued_by, new.seller_snapshot, new.buyer_snapshot, new.created_by, new.created_at)
     is distinct from
     (old.reference, old.type, old.client_id, old.contact_id, old.quote_id, old.session_id, old.parent_invoice_id,
      old.client_reference, old.invoice_date, old.service_start_date, old.service_end_date, old.due_date, old.object,
      old.payment_method, old.payment_terms, old.discount_percent, old.discount_label, old.tva_applicable, old.total_ht,
      old.total_discount, old.total_net_ht, old.total_tva, old.total_ttc, old.is_formation_pro, old.billing_client_id,
      old.is_subrogation, old.issued_at, old.issued_by, old.seller_snapshot, old.buyer_snapshot, old.created_by, old.created_at) then
    raise exception 'Document émis (%) : contenu figé, corriger par un avoir', old.reference using errcode = '42501';
  end if;
  return new;
end
$$;

create or replace function app.invoice_items_verrou()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
begin
  if exists (select 1 from public.invoices i where i.id = v_id and i.issued_at is not null)
     or (tg_op = 'UPDATE' and exists (select 1 from public.invoices i where i.id = old.invoice_id and i.issued_at is not null)) then
    raise exception 'Lignes d''un document émis : contenu figé, corriger par un avoir' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

revoke all on function app.invoice_items_verrou() from public, anon, authenticated;
revoke all on function app.invoices_verrou() from public, anon;
grant execute on function app.invoices_verrou() to authenticated, service_role;

drop trigger if exists invoices_verrou_creation on public.invoices;
create trigger invoices_verrou_creation before insert on public.invoices
  for each row execute function app.invoices_verrou();
drop trigger if exists invoices_verrou on public.invoices;
create trigger invoices_verrou before update or delete on public.invoices
  for each row execute function app.invoices_verrou();
drop trigger if exists invoice_items_verrou on public.invoice_items;
create trigger invoice_items_verrou before insert or update or delete on public.invoice_items
  for each row execute function app.invoice_items_verrou();

insert into public.schema_migrations (version) values ('0362_facturation_verrou') on conflict (version) do nothing;

-- ===== supabase/rollback/0360-0362_facturation_numerotation_retour.sql =====
-- Retour arrière de 0360, 0361 et 0362 (numérotation par la base, émission, verrou). Idempotent.
-- Les factures émises gardent leur numéro ; les brouillons créés entre-temps gardent leur référence « BROUILLON-… ».
-- Les dates d'émission et les coordonnées figées sont perdues (colonnes retirées). Revenir aussi au code d'avant.

drop trigger if exists invoices_verrou_creation on public.invoices;
drop trigger if exists invoices_verrou on public.invoices;
drop trigger if exists invoice_items_verrou on public.invoice_items;
drop function if exists app.invoices_verrou();
drop function if exists app.invoice_items_verrou();

drop function if exists public.billing_issue(uuid);
drop function if exists public.billing_next_number(text);
drop function if exists public.billing_compute_totals(uuid);
drop function if exists app.billing_format(text, text, date, bigint);
drop function if exists app.billing_company();

alter table public.invoices drop column if exists issued_at;
alter table public.invoices drop column if exists issued_by;
alter table public.invoices drop column if exists seller_snapshot;
alter table public.invoices drop column if exists buyer_snapshot;

drop table if exists public.billing_sequences;
drop table if exists public.billing_settings;

delete from public.schema_migrations
where version in ('0360_facturation_reglages', '0361_facturation_emission', '0362_facturation_verrou');

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE c4_0360-0362 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
