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
