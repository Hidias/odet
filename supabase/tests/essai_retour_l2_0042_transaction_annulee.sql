-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (l2_0042) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0042_obligations.sql, retour arrière,
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

-- ===== supabase/migrations/0042_obligations.sql =====
-- 0042_obligations.sql : obligations, échéances et validités (lot 2, branche obligations).
--
-- Spec : odet-lot2-spec.md v2, section 3 ; base commune des fonctions 10 (pont formation-maintenance), 11 (registre de
-- sécurité) et 12 (chiffre récurrent) : aucune d'elles ne crée sa propre règle.
-- 1. obligation_rules (par société) : formations, matériel et exercices à suivre, avec leur périodicité (vide quand
--    aucun texte ne la fixe), les formations du catalogue qui les satisfont, les familles de matériel, la source
--    (officielle, norme, secondaire) et l'état « confirmé par l'organisme ». Valeurs de départ toutes « à confirmer ».
-- 2. external_trainings : formations suivies ailleurs (un salarié, ou seulement l'entreprise) ; remplace
--    client_providers et duerp_habilitations (vides, gardées jusqu'au nettoyage).
-- 3. client_safety_checks : exercices et essais de l'exploitant (évacuation, alarme) ; remplace duerp_verifications.
-- 4. v_trainee_validities : dernière validation par stagiaire et groupe de validité (session réussie, certificat SST,
--    formation suivie ailleurs) et son échéance ; v_obligation_deadlines : toutes les échéances d'un client
--    (formations, matériel, contrats, exercices) avec un statut à jour / à prévoir / dépassé. Vues exécutées avec les
--    droits de la personne qui lit (security_invoker) : chacun ne voit que ce que ses règles lui ouvrent.
-- Toutes les tables naissent avec company_id ; règles par droits (regles.py, build_suite('0042')) et isolement par
-- société (règles restrictives). Migration additive. Idempotente.
-- Retour arrière : supabase/rollback/0042_obligations_retour.sql

-- ── 1. Référentiel ──
create table if not exists public.obligation_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  code text not null,
  domain text not null default 'autre' check (domain in ('incendie', 'secours', 'electrique', 'manutention', 'conduite', 'autre')),
  label text not null,
  kind text not null check (kind in ('formation', 'materiel', 'exercice')),
  validity_months int check (validity_months is null or validity_months > 0),
  validity_group text,
  course_ids uuid[] not null default '{}',
  equipment_families text[] not null default '{}',
  reminder_days int not null default 90 check (reminder_days between 0 and 730),
  legal_ref text,
  source_url text,
  source_kind text not null default 'a_confirmer' check (source_kind in ('officiel', 'norme', 'secondaire', 'a_confirmer')),
  checked_on date,
  is_confirmed boolean not null default false,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);
comment on table public.obligation_rules is 'Obligations suivies par société (formations, matériel, exercices) : périodicité, formations qui les satisfont, source';

-- ── 2. Formations suivies ailleurs ──
create table if not exists public.external_trainings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id),
  client_id uuid references public.clients(id) on delete cascade,
  trainee_id uuid references public.trainees(id) on delete cascade,
  rule_id uuid references public.obligation_rules(id) on delete set null,
  provider_name text,
  label text,
  done_on date,
  valid_until date,
  source text not null default 'saisie_of' check (source in ('saisie_of', 'prospection', 'espace_entreprise', 'reprise')),
  notes text,
  document_path text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (client_id is not null or trainee_id is not null)
);
create index if not exists external_trainings_trainee_idx on public.external_trainings (trainee_id);
create index if not exists external_trainings_client_idx on public.external_trainings (client_id);
comment on table public.external_trainings is 'Formations suivies ailleurs (salarié ou entreprise) : comptées comme valides jusqu''à leur échéance';

-- ── 3. Exercices et essais de l'exploitant ──
create table if not exists public.client_safety_checks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id),
  client_id uuid not null references public.clients(id) on delete cascade,
  site_id uuid references public.sites(id) on delete set null,
  rule_id uuid references public.obligation_rules(id) on delete set null,
  done_on date not null,
  done_by text,
  participants int check (participants is null or participants >= 0),
  observations text,
  is_compliant boolean,
  next_due_on date,
  declared_by_client boolean not null default false,
  document_path text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists client_safety_checks_client_idx on public.client_safety_checks (client_id, done_on desc);
comment on table public.client_safety_checks is 'Exercices et essais de l''exploitant (évacuation, alarme…), registre de sécurité';

-- Société de la fiche reprise du client ou du stagiaire (lignes enfants)
create or replace function app.obligations_societe()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.client_id is not null then
    new.company_id := coalesce((select c.company_id from public.clients c where c.id = new.client_id), new.company_id);
  elsif tg_table_name = 'external_trainings' and new.trainee_id is not null then
    new.company_id := coalesce((select t.company_id from public.trainees t where t.id = new.trainee_id), new.company_id);
  end if;
  new.updated_at := now();
  return new;
end
$$;

-- Prochaine échéance d'un exercice : date + périodicité de la règle, sauf si saisie
create or replace function app.safety_check_echeance()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_mois int;
begin
  if new.next_due_on is null and new.rule_id is not null then
    select r.validity_months into v_mois from public.obligation_rules r where r.id = new.rule_id;
    if v_mois is not null then new.next_due_on := (new.done_on + make_interval(months => v_mois))::date; end if;
  end if;
  return new;
end
$$;

-- Échéance d'une formation suivie ailleurs : date + périodicité, sauf si saisie
create or replace function app.external_training_echeance()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_mois int;
begin
  if new.valid_until is null and new.done_on is not null and new.rule_id is not null then
    select r.validity_months into v_mois from public.obligation_rules r where r.id = new.rule_id;
    if v_mois is not null then new.valid_until := (new.done_on + make_interval(months => v_mois))::date; end if;
  end if;
  return new;
end
$$;

create or replace function app.obligation_rules_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

revoke all on function app.obligations_societe(), app.safety_check_echeance(), app.external_training_echeance(), app.obligation_rules_maj()
  from public, anon, authenticated;

drop trigger if exists external_trainings_societe on public.external_trainings;
create trigger external_trainings_societe before insert or update on public.external_trainings
  for each row execute function app.obligations_societe();
drop trigger if exists external_trainings_echeance on public.external_trainings;
create trigger external_trainings_echeance before insert or update on public.external_trainings
  for each row execute function app.external_training_echeance();
drop trigger if exists client_safety_checks_societe on public.client_safety_checks;
create trigger client_safety_checks_societe before insert or update on public.client_safety_checks
  for each row execute function app.obligations_societe();
drop trigger if exists client_safety_checks_echeance on public.client_safety_checks;
create trigger client_safety_checks_echeance before insert or update on public.client_safety_checks
  for each row execute function app.safety_check_echeance();
drop trigger if exists obligation_rules_maj on public.obligation_rules;
create trigger obligation_rules_maj before update on public.obligation_rules
  for each row execute function app.obligation_rules_maj();

alter table public.obligation_rules enable row level security;
alter table public.external_trainings enable row level security;
alter table public.client_safety_checks enable row level security;
revoke all on table public.obligation_rules, public.external_trainings, public.client_safety_checks from public, anon;
grant select, insert, update, delete on table public.obligation_rules, public.external_trainings, public.client_safety_checks to authenticated;
grant all on table public.obligation_rules, public.external_trainings, public.client_safety_checks to service_role;

-- ── Règles (générées par scripts/securite/regles.py, build_suite('0042')) ──

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
           where schemaname = 'public' and tablename = any (array['client_safety_checks', 'external_trainings', 'obligation_rules'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- client_safety_checks
select pg_temp.regles(array['client_safety_checks'], null,
  $r$company_id in (select app.societes_avec_droit('clients.fiches.voir'))$r$,
  $r$company_id in (select app.societes_avec_droit('clients.fiches.modifier'))$r$,
  $r$company_id in (select app.societes_avec_droit('clients.fiches.modifier'))$r$,
  $r$company_id in (select app.societes_avec_droit('clients.fiches.modifier'))$r$);

-- external_trainings
select pg_temp.regles(array['external_trainings'], null,
  $r$company_id in (select app.societes_avec_droit('formation.stagiaires.voir'))$r$,
  $r$company_id in (select app.societes_avec_droit('formation.stagiaires.modifier'))$r$,
  $r$company_id in (select app.societes_avec_droit('formation.stagiaires.modifier'))$r$,
  $r$company_id in (select app.societes_avec_droit('formation.stagiaires.modifier'))$r$);

-- obligation_rules
select pg_temp.regles(array['obligation_rules'], null,
  $r$company_id in (select app.societes_avec_droit('organisation.reglages.voir'))$r$,
  $r$company_id in (select app.societes_avec_droit('formation.catalogue.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('formation.catalogue.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('formation.catalogue.gerer'))$r$);

-- Isolement par société (mêmes règles restrictives que les tables rattachées en C2)
do $$
declare t text;
begin
  foreach t in array array['obligation_rules', 'external_trainings', 'client_safety_checks'] loop
    execute format('drop policy if exists %I on public.%I', t || '_societe_lire', t);
    execute format('drop policy if exists %I on public.%I', t || '_societe_creer', t);
    execute format('drop policy if exists %I on public.%I', t || '_societe_modifier', t);
    execute format('drop policy if exists %I on public.%I', t || '_societe_supprimer', t);
    execute format('create policy %I on public.%I as restrictive for select to authenticated using (company_id in (select app.societes_lisibles()))', t || '_societe_lire', t);
    execute format('create policy %I on public.%I as restrictive for insert to authenticated with check (company_id in (select app.societes_ecriture()))', t || '_societe_creer', t);
    execute format('create policy %I on public.%I as restrictive for update to authenticated using (company_id in (select app.societes_ecriture())) with check (company_id in (select app.societes_ecriture()))', t || '_societe_modifier', t);
    execute format('create policy %I on public.%I as restrictive for delete to authenticated using (company_id in (select app.societes_ecriture()))', t || '_societe_supprimer', t);
  end loop;
end $$;

-- ── Valeurs de départ (toutes « à confirmer » par l'organisme) ──
-- Formations du catalogue rattachées par leur code quand il existe (sinon la liste reste vide, à compléter à l'écran)
create or replace function app.obligation_rules_depart(p_company uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v_n int;
begin
  with depart(code, domain, label, kind, validity_months, validity_group, codes_cours, familles, reminder_days, legal_ref, source_url, source_kind) as (values
    ('sst', 'secours', 'Sauveteur secouriste du travail', 'formation', 24, 'sst', array['SST-FI', 'SST-MAC'], '{}'::text[], 90,
     'Document de référence INRS du dispositif SST : maintien et actualisation des compétences tous les 24 mois', 'https://www.inrs.fr/services/formation/demultiplicateur/sst.html', 'secondaire'),
    ('habilitation_electrique', 'electrique', 'Habilitation électrique (préparation)', 'formation', 36, 'habilitation_electrique', array['B0H0V', 'BSBEM'], '{}', 90,
     'NF C 18-510 : recyclage recommandé, périodicité indicative de 3 ans ; l''employeur délivre et revoit le titre (R4544-9)', 'https://code.travail.gouv.fr/code-du-travail/r4544-9', 'norme'),
    ('incendie_equipier', 'incendie', 'Personnel désigné pour le matériel de premier secours et l''évacuation', 'formation', null, 'incendie_equipier', array['INC-EPI', 'INC-EXT'], '{}', 90,
     'R4227-38 : la consigne incendie désigne le personnel chargé du matériel de premier secours et de l''évacuation ; aucune périodicité de formation fixée par un texte', 'https://code.travail.gouv.fr/code-du-travail/r4227-38', 'officiel'),
    ('conduite_r489', 'conduite', 'Conduite de chariots (R489) : formation et autorisation de conduite', 'formation', 60, 'r489', array['R489'], '{}', 120,
     'Recommandation R489 de l''Assurance Maladie : évaluation tous les 5 ans ; autorisation de conduite délivrée par l''employeur (R4323-56)', 'https://code.travail.gouv.fr/code-du-travail/r4323-56', 'norme'),
    ('conduite_r485', 'conduite', 'Conduite de gerbeurs (R485) : formation et autorisation de conduite', 'formation', 60, 'r485', array['R485'], '{}', 120,
     'Recommandation R485 de l''Assurance Maladie : évaluation tous les 5 ans ; autorisation de conduite délivrée par l''employeur (R4323-56)', 'https://code.travail.gouv.fr/code-du-travail/r4323-56', 'norme'),
    ('gestes_postures', 'manutention', 'Gestes et postures (manutention manuelle)', 'formation', null, 'gestes_postures', array['ERG-GP'], '{}', 90,
     'R4541-8 : formation à la sécurité des travailleurs exposés à la manutention manuelle ; aucune périodicité fixée', 'https://code.travail.gouv.fr/code-du-travail/r4541-8', 'officiel'),
    ('exercice_evacuation', 'incendie', 'Exercice d''évacuation', 'exercice', 6, 'exercice_evacuation', '{}', '{}', 30,
     'R4227-39 : exercices et essais au moins tous les six mois, consignés au registre de sécurité', 'https://code.travail.gouv.fr/code-du-travail/r4227-39', 'officiel'),
    ('essai_alarme', 'incendie', 'Essai du système d''alarme', 'exercice', 6, 'essai_alarme', '{}', '{}', 30,
     'R4227-39 : exercices et essais au moins tous les six mois, consignés au registre de sécurité', 'https://code.travail.gouv.fr/code-du-travail/r4227-39', 'officiel'),
    ('verification_extincteurs', 'incendie', 'Vérification des extincteurs', 'materiel', 12, 'verification_extincteurs', '{}', array['Extincteurs'], 60,
     'R4227-39 (matériel entretenu et vérifié) ; vérification annuelle selon la norme NF S 61-919 et la règle APSAD R4', 'https://code.travail.gouv.fr/code-du-travail/r4227-39', 'norme'),
    ('verification_ria', 'incendie', 'Vérification des robinets d''incendie armés', 'materiel', 12, 'verification_ria', '{}', array['RIA'], 60,
     'R4227-39 ; vérification annuelle selon la règle APSAD R5', 'https://code.travail.gouv.fr/code-du-travail/r4227-39', 'norme'),
    ('verification_alarme', 'incendie', 'Vérification de l''équipement d''alarme', 'materiel', 12, 'verification_alarme', '{}', array['Alarme'], 60,
     'R4227-39 ; vérification périodique par une personne qualifiée', 'https://code.travail.gouv.fr/code-du-travail/r4227-39', 'norme'),
    ('verification_baes', 'incendie', 'Vérification de l''éclairage de sécurité', 'materiel', 12, 'verification_baes', '{}', array['Éclairage de sécurité'], 60,
     'Arrêté du 14/12/2011 (lieux de travail) : vérification annuelle de l''éclairage de sécurité', 'https://www.legifrance.gouv.fr/loda/id/JORFTEXT000025059567', 'officiel'),
    ('verification_desenfumage', 'incendie', 'Vérification du désenfumage', 'materiel', 12, 'verification_desenfumage', '{}', array['Désenfumage'], 60,
     'R4216-30 et arrêté du 05/08/1992 : désenfumage maintenu en bon état ; vérification annuelle', 'https://code.travail.gouv.fr/code-du-travail/r4216-30', 'secondaire')
  )
  insert into public.obligation_rules (company_id, code, domain, label, kind, validity_months, validity_group, course_ids,
    equipment_families, reminder_days, legal_ref, source_url, source_kind, checked_on)
  select p_company, d.code, d.domain, d.label, d.kind, d.validity_months, d.validity_group,
         coalesce((select array_agg(c.id order by c.code) from public.courses c
                   where c.code = any (d.codes_cours) and p_company = any (coalesce(c.company_ids, array[c.company_id]))), '{}'),
         d.familles, d.reminder_days, d.legal_ref, d.source_url, d.source_kind, date '2026-10-19'
  from depart d
  on conflict (company_id, code) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
revoke all on function app.obligation_rules_depart(uuid) from public, anon, authenticated;

select app.obligation_rules_depart(c.id) from public.companies c;

-- ── 4. Vues ──
-- Validités : une ligne par stagiaire et groupe de validité (la plus récente l'emporte)
create or replace view public.v_trainee_validities
with (security_invoker = true)
as
with sources as (
  -- Session réussie d'une formation qui satisfait la règle
  select st.trainee_id, r.id as rule_id, r.company_id, r.validity_group, r.validity_months,
         s.end_date as valide_le, 'session'::text as source, s.id as source_id
  from public.session_trainees st
  join public.sessions s on s.id = st.session_id
  join public.obligation_rules r on r.kind = 'formation' and r.is_active and s.course_id = any (r.course_ids)
  where st.result in ('acquired', 'acquis') and s.end_date is not null
  union all
  -- Certificat SST
  select sc.trainee_id, r.id, r.company_id, r.validity_group, r.validity_months,
         sc.date_certification, 'certificat_sst', sc.id
  from public.sst_certifications sc
  join public.sessions s on s.id = sc.session_id
  join public.obligation_rules r on r.kind = 'formation' and r.is_active and s.course_id = any (r.course_ids)
  where sc.candidat_certifie and sc.date_certification is not null
  union all
  -- Formation suivie ailleurs, rattachée à un salarié
  select et.trainee_id, r.id, r.company_id, r.validity_group, r.validity_months,
         coalesce(et.done_on, et.valid_until), 'externe', et.id
  from public.external_trainings et
  join public.obligation_rules r on r.id = et.rule_id
  where et.trainee_id is not null and coalesce(et.done_on, et.valid_until) is not null
), classees as (
  select so.*, row_number() over (partition by so.trainee_id, so.company_id, coalesce(so.validity_group, so.rule_id::text)
                                  order by so.valide_le desc) as rang
  from sources so
)
select c.trainee_id, t.client_id, t.site_id, c.company_id, c.rule_id, c.validity_group, c.valide_le, c.source, c.source_id,
       case
         when c.source = 'externe' then coalesce((select et.valid_until from public.external_trainings et where et.id = c.source_id),
                                                 (c.valide_le + make_interval(months => c.validity_months))::date)
         when c.validity_months is not null then (c.valide_le + make_interval(months => c.validity_months))::date
       end as echeance
from classees c
join public.trainees t on t.id = c.trainee_id
where c.rang = 1;

comment on view public.v_trainee_validities is 'Dernière validation par stagiaire et groupe de validité, et son échéance (droits de la personne qui lit)';

-- Échéances d'un client : formations, matériel, contrats, exercices
create or replace view public.v_obligation_deadlines
with (security_invoker = true)
as
with toutes as (
  select 'formation'::text as kind, v.company_id, v.client_id, v.site_id, v.rule_id, 'trainees'::text as objet_table,
         v.trainee_id as objet_id, nullif(btrim(coalesce(t.first_name, '') || ' ' || coalesce(t.last_name, '')), '') as objet_label,
         v.echeance as due_on
  from public.v_trainee_validities v
  join public.trainees t on t.id = v.trainee_id
  where v.echeance is not null and v.client_id is not null
  union all
  select 'materiel', e.company_id, e.client_id, e.site_id,
         (select r.id from public.obligation_rules r where r.company_id = e.company_id and r.kind = 'materiel' and r.is_active
            and ty.family = any (r.equipment_families) order by r.code limit 1),
         'itv_equipment', e.id, concat_ws(' · ', ty.name, nullif(e.location, '')), e.next_check_on
  from public.itv_equipment e
  left join public.itv_equipment_types ty on ty.id = e.type_id
  where e.next_check_on is not null and coalesce(e.status, '') <> 'retire'
  union all
  select 'contrat', k.company_id, k.client_id, null::uuid, null::uuid, 'itv_contracts', k.id,
         coalesce(nullif(k.label, ''), k.reference, 'Contrat de maintenance'), k.end_on
  from public.itv_contracts k
  where k.end_on is not null and coalesce(k.status, 'active') in ('active', 'actif')
  union all
  select 'exercice', x.company_id, x.client_id, x.site_id, x.rule_id, 'client_safety_checks', x.id,
         coalesce((select r.label from public.obligation_rules r where r.id = x.rule_id), 'Exercice'), x.next_due_on
  from (
    select cs.*, row_number() over (partition by cs.client_id, coalesce(cs.site_id::text, ''), coalesce(cs.rule_id::text, '') order by cs.done_on desc) as rang
    from public.client_safety_checks cs
  ) x
  where x.rang = 1 and x.next_due_on is not null
)
select a.*, r.domain, r.label as rule_label,
       case
         when a.due_on < current_date then 'depasse'
         when a.due_on <= current_date + coalesce(r.reminder_days, 90) then 'a_prevoir'
         else 'a_jour'
       end as status
from toutes a
left join public.obligation_rules r on r.id = a.rule_id;

comment on view public.v_obligation_deadlines is 'Échéances des clients (formations, matériel, contrats, exercices) avec statut ; droits de la personne qui lit';

revoke all on table public.v_trainee_validities, public.v_obligation_deadlines from public, anon;
grant select on table public.v_trainee_validities, public.v_obligation_deadlines to authenticated, service_role;

insert into public.schema_migrations (version) values ('0042_obligations') on conflict (version) do nothing;

-- ===== supabase/rollback/0042_obligations_retour.sql =====
-- Retour arrière de 0042_obligations.sql : retire le référentiel des obligations, les formations suivies ailleurs,
-- les exercices de l'exploitant et les vues d'échéances. Idempotent.
-- Refusé si des formations suivies ailleurs ou des exercices ont été saisis, ou si le référentiel a été modifié
-- (règle confirmée, changée ou ajoutée) : ce sont des données saisies, jamais effacées par un retour arrière.

do $$
begin
  if to_regclass('public.obligation_rules') is not null then
    if exists (select 1 from public.external_trainings) or exists (select 1 from public.client_safety_checks) then
      raise exception 'Retour arrière refusé : des formations suivies ailleurs ou des exercices ont été saisis';
    end if;
    if exists (select 1 from public.obligation_rules where is_confirmed or updated_at > created_at + interval '1 second'
                 or code not in ('sst', 'habilitation_electrique', 'incendie_equipier', 'conduite_r489', 'conduite_r485', 'gestes_postures',
                                 'exercice_evacuation', 'essai_alarme', 'verification_extincteurs', 'verification_ria',
                                 'verification_alarme', 'verification_baes', 'verification_desenfumage')) then
      raise exception 'Retour arrière refusé : le référentiel des obligations a été modifié';
    end if;
  end if;
end $$;

drop view if exists public.v_obligation_deadlines;
drop view if exists public.v_trainee_validities;
drop table if exists public.client_safety_checks;
drop table if exists public.external_trainings;
drop table if exists public.obligation_rules;
drop function if exists app.obligation_rules_depart(uuid);
drop function if exists app.obligations_societe();
drop function if exists app.safety_check_echeance();
drop function if exists app.external_training_echeance();
drop function if exists app.obligation_rules_maj();

delete from public.schema_migrations where version = '0042_obligations';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE l2_0042 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
