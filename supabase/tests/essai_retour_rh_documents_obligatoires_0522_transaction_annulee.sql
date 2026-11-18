-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (rh_documents_obligatoires_0522) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0522_rh_documents_obligatoires.sql, retour arrière,
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

-- ===== supabase/migrations/0522_rh_documents_obligatoires.sql =====
-- 0522 : documents obligatoires du personnel, un seul lot (choix de H du 18/11) : travail isolé, accueil sécurité,
-- affichages obligatoires. Conception : claude/odet-rh-documents-obligatoires-conception-2026-11-18.md.
-- Choix de H (18/11, 7 h 24) : travail isolé sur le poste ; accueil sécurité signé à l'écran ; un seul panneau
-- d'affichage (site de Plomelin).
-- Sources (lues le 18/11/2026) :
--   - Code du travail L4121-1 (évaluation des risques, organisation des secours) ; R4512-13 (entreprise extérieure :
--     aucun travailleur isolé hors de portée de secours) ; inventaire du 18/11.
--   - L4141-2 (formation pratique et appropriée à la sécurité à l'embauche, au changement de poste ou de technique,
--     pour les intérimaires) ; R4141-3 (trois domaines : circulation dans l'entreprise, exécution du travail, conduite
--     à tenir en cas d'accident ou de sinistre).
--   - Fiche service-public reprise par code.travail.gouv.fr, mise à jour du 08/07/2026, tableau « Jusqu'à 10
--     salariés » (21 lignes) : référentiel des affichages et diffusions.
-- Règles :
--   1. hr_jobs : « peut travailler seul », mesures retenues (DATI, appel de contrôle, procédure d'alerte, autre),
--      note et renvoi au DUERP. stock_items.dati : article EPI qui est un DATI (remis par l'écran EPI, 0394).
--   2. hr_safety_inductions : accueil sécurité daté, motif, points abordés, animé par, signature du salarié à
--      l'écran (signed_at posé par la base). Le poste de la personne est noté à la signature (changement de poste).
--      Signé : la ligne « Accueil sécurité fait » de la liste d'arrivée se coche seule. Une fiche signée ne se
--      modifie plus (seules les notes), elle se supprime si elle a été saisie par erreur.
--   3. hr_postings (état par société : fait le, vérifié le, moyen, sans objet avec motif), une ligne par affichage du
--      référentiel tenu dans le code (rhSecurite.js : toute table de la base porte une société) ;
--      hr_settings.posting_location (lieu du panneau).
--   4. v_hr_echeances : « accueil_securite » (contrat en cours sans accueil signé pour son poste, à la date de début)
--      et « travail_isole » (poste « seul » sans mesure, ou mesure DATI sans DATI remis en cours, à la date du jour).
--      Corps des six autres branches repris de 0521 à l'identique.
-- Additive. Idempotente. Retour arrière : supabase/rollback/0522_rh_documents_obligatoires_retour.sql

-- ── 1. Travail isolé ──
alter table public.hr_jobs add column if not exists lone_work boolean not null default false;
alter table public.hr_jobs add column if not exists lone_work_measures text[] not null default '{}';
alter table public.hr_jobs add column if not exists lone_work_note text;
alter table public.hr_jobs add column if not exists lone_work_duerp_ref text;
alter table public.hr_jobs drop constraint if exists hr_jobs_lone_work_check;
alter table public.hr_jobs add constraint hr_jobs_lone_work_check check (
  lone_work_measures <@ array['dati', 'appel_controle', 'procedure_alerte', 'autre']::text[]
  and (lone_work_note is null or length(lone_work_note) <= 1000)
  and (lone_work_duerp_ref is null or length(lone_work_duerp_ref) <= 200)
  and ('autre' <> all (lone_work_measures) or length(btrim(coalesce(lone_work_note, ''))) > 0));
comment on column public.hr_jobs.lone_work is 'Le poste peut travailler seul (L4121-1, R4512-13) ; mesures dans lone_work_measures';
comment on column public.hr_jobs.lone_work_measures is 'Mesures du travail isolé : dati, appel_controle, procedure_alerte, autre (détail dans lone_work_note)';

alter table public.stock_items add column if not exists dati boolean not null default false;
comment on column public.stock_items.dati is 'Article EPI qui est un dispositif d''alarme pour travailleur isolé (DATI), remis par l''écran EPI';

-- ── 2. Accueil sécurité ──
create table if not exists public.hr_safety_inductions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  person_id uuid not null references public.hr_people(id) on delete cascade,
  employment_id uuid references public.hr_employments(id) on delete set null,
  job_id uuid references public.hr_jobs(id) on delete set null,
  done_on date not null default current_date,
  reason text not null default 'embauche'
    check (reason in ('embauche', 'changement_poste', 'changement_technique', 'retour_absence', 'interim', 'autre')),
  topics jsonb not null default '[]'::jsonb check (jsonb_typeof(topics) = 'array' and jsonb_array_length(topics) <= 40),
  conducted_by text check (conducted_by is null or length(conducted_by) <= 120),
  employee_signature text check (employee_signature is null or (employee_signature like 'data:image/%' and length(employee_signature) <= 400000)),
  signed_at timestamptz,
  notes text check (notes is null or length(notes) <= 1000),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hr_safety_inductions_person_idx on public.hr_safety_inductions (person_id);
create index if not exists hr_safety_inductions_company_idx on public.hr_safety_inductions (company_id);
comment on table public.hr_safety_inductions is 'Accueil sécurité (L4141-2, R4141-3) : date, motif, points abordés [{ label, done }], signature du salarié';

create or replace function app.hr_accueil_avant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.company_id := coalesce((select p.company_id from public.hr_people p where p.id = new.person_id), new.company_id, app.company_default());
  if tg_op = 'UPDATE' and new.person_id is distinct from old.person_id and not exists (select 1 from public.hr_people p where p.id = new.person_id and p.company_id = old.company_id) then
    raise exception 'RH : la personne appartient à une autre société' using errcode = '23514';
  end if;
  if new.employment_id is not null and not exists (select 1 from public.hr_employments e where e.id = new.employment_id and e.person_id = new.person_id) then
    raise exception 'Ce contrat n''est pas celui de cette personne' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and old.signed_at is not null then
    -- Fiche signée : figée, sauf les notes. Exceptions (relecture du 18/11, tour 3) :
    --   - contrat ou poste supprimé : la clé passe à vide (on delete set null) ;
    --   - fiche signée avant la saisie du contrat : rattachée une fois au contrat et à son poste par app.hr_contrat_accueil.
    if new.done_on is distinct from old.done_on or new.reason is distinct from old.reason or new.topics is distinct from old.topics
       or new.conducted_by is distinct from old.conducted_by or new.employee_signature is distinct from old.employee_signature
       or new.person_id is distinct from old.person_id
       or (new.employment_id is distinct from old.employment_id
           and not (new.employment_id is null and not exists (select 1 from public.hr_employments e where e.id = old.employment_id))
           and not (old.employment_id is null and old.job_id is null and current_setting('app.accueil_rattache', true) = '1')) then
      raise exception 'Accueil sécurité signé : il ne se modifie plus (supprimez-le s''il a été saisi par erreur)' using errcode = '22023';
    end if;
    new.signed_at := old.signed_at;
    if not (new.job_id is null and old.job_id is not null and not exists (select 1 from public.hr_jobs j where j.id = old.job_id))
       and not (old.employment_id is null and old.job_id is null and current_setting('app.accueil_rattache', true) = '1') then
      new.job_id := old.job_id;
    end if;
  elsif new.employee_signature is not null then
    -- Contrôles de l'écran repris par la base à la signature (relecture du 18/11, tour 2)
    if new.done_on > (now() at time zone 'Europe/Paris')::date then
      raise exception 'L''accueil sécurité ne peut pas être daté dans le futur' using errcode = '22023';
    end if;
    if not exists (select 1 from jsonb_array_elements(new.topics) t where coalesce(t->>'done', '') = 'true') then
      raise exception 'Cochez au moins un point abordé' using errcode = '22023';
    end if;
    new.signed_at := now();
    -- Poste de la personne au moment de la signature (pour repérer un changement de poste)
    new.job_id := coalesce(
      (select e.job_id from public.hr_employments e where e.id = new.employment_id),
      (select e.job_id from public.hr_employments e
       where e.person_id = new.person_id and e.start_on <= new.done_on + 30 and (e.end_on is null or e.end_on >= new.done_on)
       order by e.start_on desc limit 1));
  else
    new.signed_at := null;
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_at := old.created_at; new.company_id := old.company_id; new.created_by := old.created_by;
  end if;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function app.hr_accueil_avant() from public, anon, authenticated;
drop trigger if exists hr_safety_inductions_avant on public.hr_safety_inductions;
create trigger hr_safety_inductions_avant before insert or update on public.hr_safety_inductions
  for each row execute function app.hr_accueil_avant();

-- Signé : coche la ligne « Accueil sécurité fait » de la liste d'arrivée (si la liste est ouverte et la ligne libre)
create or replace function app.hr_accueil_liste()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.signed_at is not null and (tg_op = 'INSERT' or old.signed_at is null) then
    update public.hr_checklists l
       set items = (select coalesce(jsonb_agg(case when x->>'label' = 'Accueil sécurité fait' and coalesce(x->>'done_on', '') = ''
                                              then x || jsonb_build_object('done_on', new.done_on, 'done_by', new.created_by)
                                              else x end order by o), '[]'::jsonb)
                    from jsonb_array_elements(l.items) with ordinality as t(x, o))
     where l.person_id = new.person_id and l.kind = 'arrivee'
       and exists (select 1 from jsonb_array_elements(l.items) x where x->>'label' = 'Accueil sécurité fait' and coalesce(x->>'done_on', '') = '');
  end if;
  return null;
end
$$;
revoke all on function app.hr_accueil_liste() from public, anon, authenticated;
drop trigger if exists hr_safety_inductions_liste on public.hr_safety_inductions;
create trigger hr_safety_inductions_liste after insert or update on public.hr_safety_inductions
  for each row execute function app.hr_accueil_liste();

-- Contrat saisi après la signature de l'accueil : la fiche sans contrat ni poste, datée d'au plus 30 jours avant le
-- début, est rattachée à ce contrat et à son poste (relecture du 18/11, tour 3 : un accueil sans poste ne vaut pas pour
-- tout poste)
create or replace function app.hr_contrat_accueil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.accueil_rattache', '1', true);
  update public.hr_safety_inductions i set employment_id = new.id, job_id = new.job_id
   where i.person_id = new.person_id and i.signed_at is not null and i.employment_id is null and i.job_id is null
     and i.done_on >= new.start_on - 30 and (new.end_on is null or i.done_on <= new.end_on);
  perform set_config('app.accueil_rattache', '', true);
  return null;
end
$$;
revoke all on function app.hr_contrat_accueil() from public, anon, authenticated;
drop trigger if exists hr_employments_accueil on public.hr_employments;
create trigger hr_employments_accueil after insert on public.hr_employments for each row execute function app.hr_contrat_accueil();

-- Liste d'arrivée ouverte après la signature : la ligne naît cochée (relecture du 18/11)
create or replace function app.hr_liste_accueil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  v_e uuid;
  v_debut date;
begin
  if new.kind = 'arrivee' then
    -- Seulement un accueil du contrat le plus récent (ou des contrats enchaînés), comme les échéances : pas celui
    -- d'un ancien contrat en cas de réembauche (relecture du 18/11, tour 2)
    select e.id, e.start_on into v_e, v_debut from public.hr_employments e
     where e.person_id = new.person_id order by e.start_on desc, e.created_at desc limit 1;
    v_debut := coalesce(app.hr_debut_continu(v_e), v_debut, current_date);
    select i.done_on, i.created_by into v from public.hr_safety_inductions i
     where i.person_id = new.person_id and i.signed_at is not null and i.done_on >= v_debut - 30
     order by i.done_on desc limit 1;
    if found then
      new.items := (select coalesce(jsonb_agg(case when x->>'label' = 'Accueil sécurité fait' and coalesce(x->>'done_on', '') = ''
                                              then x || jsonb_build_object('done_on', v.done_on, 'done_by', v.created_by)
                                              else x end order by o), '[]'::jsonb)
                    from jsonb_array_elements(new.items) with ordinality as t(x, o));
    end if;
  end if;
  return new;
end
$$;
revoke all on function app.hr_liste_accueil() from public, anon, authenticated;
drop trigger if exists hr_checklists_accueil on public.hr_checklists;
create trigger hr_checklists_accueil before insert on public.hr_checklists for each row execute function app.hr_liste_accueil();

-- Ligne du modèle de liste d'arrivée, pour chaque société et chaque nouvelle (corps de 0314 repris, une ligne ajoutée)
create or replace function app.hr_listes_depart(p_company uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.hr_checklist_templates (company_id, kind, label, position)
  select p_company, x.kind, x.label, x.pos
  from (values
    ('arrivee', 'Contrat signé et rangé dans les documents', 1),
    ('arrivee', 'Déclaration préalable à l''embauche faite', 2),
    ('arrivee', 'Visite d''information et de prévention demandée', 3),
    ('arrivee', 'Livret d''accueil et règlement intérieur remis', 4),
    ('arrivee', 'Équipements de protection individuelle remis', 5),
    ('arrivee', 'Accès à l''outil, badge et clés donnés', 6),
    ('arrivee', 'Habilitations vérifiées ou formations prévues', 7),
    ('arrivee', 'Accueil sécurité fait', 8),
    ('depart', 'Matériel, véhicule, badge et clés restitués', 1),
    ('depart', 'Accès à l''outil et aux comptes coupés', 2),
    ('depart', 'Solde de tout compte remis', 3),
    ('depart', 'Certificat de travail et attestation France Travail remis', 4),
    ('depart', 'Entretien de départ fait', 5)) as x(kind, label, pos)
  on conflict (company_id, kind, label) do nothing
$$;
revoke all on function app.hr_listes_depart(uuid) from public, anon, authenticated;
select app.hr_listes_depart(c.id) from public.companies c;

-- ── 3. Affichages et diffusions obligatoires ──
create table if not exists public.hr_postings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  -- Codes du référentiel (src/modules/rh/lib/rhSecurite.js, AFFICHAGES : fiche du 08/07/2026, 21 lignes)
  item_code text not null check (item_code in ('inspection_travail', 'discriminations_accueil', 'medecin_travail', 'secours_urgence', 'consignes_securite', 'conventions_accords', 'egalite_remuneration', 'duree_travail', 'horaires_collectifs', 'repos_hebdomadaire', 'conges_payes', 'harcelement_moral', 'harcelement_sexuel', 'discriminations', 'interdiction_fumer', 'interdiction_vapoter', 'acces_duerp', 'panneaux_syndicaux', 'organisations_syndicales', 'rupture_conventionnelle_collective', 'travail_temporaire')),
  status text not null default 'fait' check (status in ('fait', 'sans_objet')),
  done_on date,
  checked_on date,
  means text check (means is null or length(means) <= 200),
  note text check (note is null or length(note) <= 500),
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, item_code),
  constraint hr_postings_etat check (
    (status = 'fait' and done_on is not null and (checked_on is null or checked_on >= done_on))
    or (status = 'sans_objet' and length(btrim(coalesce(note, ''))) > 0))
);
create index if not exists hr_postings_company_idx on public.hr_postings (company_id);
comment on table public.hr_postings is 'Affichages et diffusions obligatoires de la société : fait le, vérifié le, moyen ; sans objet avec motif';

create or replace function app.hr_affichage_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then new.created_at := now(); else new.created_at := old.created_at; new.company_id := old.company_id; end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end
$$;
revoke all on function app.hr_affichage_maj() from public, anon, authenticated;
drop trigger if exists hr_postings_maj on public.hr_postings;
create trigger hr_postings_maj before insert or update on public.hr_postings for each row execute function app.hr_affichage_maj();

alter table public.hr_settings add column if not exists posting_location text;
alter table public.hr_settings drop constraint if exists hr_settings_posting_location_longueur;
alter table public.hr_settings add constraint hr_settings_posting_location_longueur
  check (posting_location is null or length(posting_location) <= 200);
comment on column public.hr_settings.posting_location is 'Lieu du panneau d''affichage obligatoire (un seul panneau, choix de H du 18/11)';

-- ── Droits ──
alter table public.hr_safety_inductions enable row level security;
alter table public.hr_postings enable row level security;
revoke all on table public.hr_safety_inductions, public.hr_postings from public, anon, authenticated;
grant select, insert, update, delete on table public.hr_safety_inductions, public.hr_postings to authenticated;
grant all on table public.hr_safety_inductions, public.hr_postings to service_role;

do $$
begin
  -- Accueil sécurité : comme les EPI (0394) ; lu par la personne ou avec « Voir les dossiers », tenu avec « Tenir les dossiers »
  drop policy if exists hr_safety_inductions_lire on public.hr_safety_inductions;
  drop policy if exists hr_safety_inductions_creer on public.hr_safety_inductions;
  drop policy if exists hr_safety_inductions_modifier on public.hr_safety_inductions;
  drop policy if exists hr_safety_inductions_supprimer on public.hr_safety_inductions;
  create policy hr_safety_inductions_lire on public.hr_safety_inductions for select to authenticated
    using ((company_id in (select app.societes_avec_droit('rh.dossiers.voir')) or person_id in (select app.hr_mes_personnes())));
  create policy hr_safety_inductions_creer on public.hr_safety_inductions for insert to authenticated
    with check (company_id in (select app.societes_avec_droit('rh.dossiers.gerer')));
  create policy hr_safety_inductions_modifier on public.hr_safety_inductions for update to authenticated
    using (company_id in (select app.societes_avec_droit('rh.dossiers.gerer')))
    with check (company_id in (select app.societes_avec_droit('rh.dossiers.gerer')));
  create policy hr_safety_inductions_supprimer on public.hr_safety_inductions for delete to authenticated
    using (company_id in (select app.societes_avec_droit('rh.dossiers.gerer')));
  -- Affichages : lus par qui voit le personnel, tenus avec « Tenir les dossiers »
  drop policy if exists hr_postings_lire on public.hr_postings;
  drop policy if exists hr_postings_creer on public.hr_postings;
  drop policy if exists hr_postings_modifier on public.hr_postings;
  drop policy if exists hr_postings_supprimer on public.hr_postings;
  create policy hr_postings_lire on public.hr_postings for select to authenticated
    using ((company_id in (select app.societes_avec_droit('rh.personnel.voir'))
            or company_id in (select app.societes_avec_droit('rh.dossiers.voir'))
            or company_id in (select app.societes_avec_droit('rh.parametres.gerer'))));
  create policy hr_postings_creer on public.hr_postings for insert to authenticated
    with check (company_id in (select app.societes_avec_droit('rh.dossiers.gerer')));
  create policy hr_postings_modifier on public.hr_postings for update to authenticated
    using (company_id in (select app.societes_avec_droit('rh.dossiers.gerer')))
    with check (company_id in (select app.societes_avec_droit('rh.dossiers.gerer')));
  create policy hr_postings_supprimer on public.hr_postings for delete to authenticated
    using (company_id in (select app.societes_avec_droit('rh.dossiers.gerer')));
end $$;

-- Vue groupe en lecture seule (0516) : verrou posé sur les nouvelles tables
select app.vue_groupe_poser();

-- Journal
do $$
declare r record;
begin
  for r in select * from (values ('hr_safety_inductions', 'personnel'), ('hr_postings', 'parametres_rh')) as t(nom, type) loop
    execute format('drop trigger if exists zz_audit_row on public.%I', r.nom);
    execute format('create trigger zz_audit_row after insert or update or delete on public.%I for each row execute function app.audit_row(%L)', r.nom, r.type);
  end loop;
end $$;

-- ── 4. Échéances ──
-- Début du contrat, ou du premier contrat enchaîné sur le même poste (au plus 7 jours entre deux contrats, un week-end
-- compris) (relecture du 18/11 : un CDI
-- qui suit un CDD sur le même poste ne redemande pas l'accueil)
create or replace function app.hr_debut_continu(p_employment uuid)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_person uuid; v_job uuid; v_debut date; v_prec date; i int := 0;
begin
  -- Seulement pour un contrat que le lecteur peut voir (dossiers du personnel, ou le sien)
  select e.person_id, e.job_id, e.start_on into v_person, v_job, v_debut from public.hr_employments e
   where e.id = p_employment
     and ((select auth.uid()) is null  -- tâches du serveur et essais (aucun droit d'exécution pour anon)
          or e.company_id in (select app.societes_avec_droit('rh.dossiers.voir')) or e.person_id in (select app.hr_mes_personnes()));
  if v_debut is null then return null; end if;
  loop
    i := i + 1;
    exit when i > 50;
    select min(e.start_on) into v_prec from public.hr_employments e
     where e.person_id = v_person and e.job_id is not distinct from v_job and e.id <> p_employment
       and e.start_on < v_debut and e.end_on is not null and e.end_on >= v_debut - 7;
    exit when v_prec is null;
    v_debut := v_prec;
  end loop;
  return v_debut;
end
$$;
revoke all on function app.hr_debut_continu(uuid) from public, anon;
grant execute on function app.hr_debut_continu(uuid) to authenticated;

-- DATI remis et non rendu, lu sans le droit du stock (relecture du 18/11 : le profil « rh » ne lit pas le stock)
create or replace function app.hr_dati_remis(p_person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.hr_ppe_handovers h join public.stock_items s on s.id = h.item_id and s.dati
                 where h.person_id = p_person and h.returned_on is null
                   and ((select auth.uid()) is null
                        or h.company_id in (select app.societes_avec_droit('rh.dossiers.voir')) or h.person_id in (select app.hr_mes_personnes())))
$$;
revoke all on function app.hr_dati_remis(uuid) from public, anon;
grant execute on function app.hr_dati_remis(uuid) to authenticated;

create or replace view public.v_hr_echeances with (security_invoker = true) as
  -- Contrat le plus récent par personne non archivée, en cours ou qui commence dans les 30 jours
  with courant as (
    select distinct on (e.person_id) e.*
    from public.hr_employments e
    join public.hr_people p on p.id = e.person_id and p.archived_at is null
    where (e.end_on is null or e.end_on >= current_date) and e.start_on <= current_date + 30
    order by e.person_id, e.start_on desc, e.created_at desc)
  select q.company_id, q.person_id, 'habilitation'::text as kind, q.label, q.expires_on as due_on, q.id as source_id
  from public.hr_qualifications q
  where q.archived_at is null and q.expires_on is not null
  union all
  select m.company_id, m.person_id, 'visite', 'Visite de santé au travail', m.next_due_on, m.id
  from public.hr_medical_followups m
  where m.next_due_on is not null
    and not exists (select 1 from public.hr_medical_followups m2
                    where m2.person_id = m.person_id and m2.visit_on is not null and m2.visit_on >= m.next_due_on)
  union all
  select e.company_id, e.person_id, 'fin_contrat', 'Fin de contrat', e.end_on, e.id
  from public.hr_employments e
  where e.end_on is not null and e.end_on >= current_date - 30
  union all
  select e.company_id, e.person_id, 'fin_essai', 'Fin de la période d''essai', e.trial_end_on, e.id
  from public.hr_employments e
  where e.trial_end_on is not null and e.trial_end_on >= current_date - 30
  union all
  select r.company_id, r.person_id, 'entretien',
         case r.kind when 'parcours' then 'Entretien de parcours professionnel' when 'bilan' then 'Bilan du parcours professionnel'
                     when 'annuel' then 'Entretien annuel' else 'Entretien' end,
         coalesce(case when r.done_on is null then r.planned_on end, r.next_due_on), r.id
  from public.hr_reviews r
  where coalesce(case when r.done_on is null then r.planned_on end, r.next_due_on) is not null
    and not exists (select 1 from public.hr_reviews r2 where r2.person_id = r.person_id and r2.kind = r.kind
                    and r2.done_on is not null and r2.done_on > coalesce(r.done_on, r.planned_on, r.next_due_on))
  union all
  select e.company_id, e.person_id, 'dpae', 'Déclaration préalable à l''embauche (DPAE)', e.start_on, e.id
  from public.hr_employments e
  where e.dpae_sent_on is null
    and e.contract_type in ('cdi', 'cdd', 'apprentissage', 'professionnalisation')
    and e.start_on >= current_date - 30
  union all
  -- Contrat le plus récent de la personne (non archivée), sans accueil signé pour son poste depuis ce contrat ou les
  -- contrats enchaînés sur le même poste (app.hr_debut_continu) ; mandataire : sans objet
  select c.company_id, c.person_id, 'accueil_securite',
         case when coalesce((select i.job_id from public.hr_safety_inductions i where i.person_id = c.person_id and i.signed_at is not null
                             order by i.done_on desc, i.signed_at desc limit 1), c.job_id) is distinct from c.job_id
              then 'Accueil sécurité à refaire (changement de poste)' else 'Accueil sécurité' end,
         c.start_on, c.id
  from courant c
  where c.contract_type <> 'mandataire'
    and not exists (select 1 from public.hr_safety_inductions i
                    where i.person_id = c.person_id and i.signed_at is not null
                      and i.job_id is not distinct from c.job_id
                      and i.done_on >= app.hr_debut_continu(c.id) - 30)
  union all
  -- Poste « seul » sans mesure, ou mesure DATI sans DATI remis et non rendu ; daté du début du contrat
  select c.company_id, c.person_id, 'travail_isole',
         case when cardinality(j.lone_work_measures) = 0 then 'Travail isolé : aucune mesure sur le poste ' || j.name
              else 'Travail isolé : DATI à remettre' end,
         c.start_on, c.id
  from courant c
  join public.hr_jobs j on j.id = c.job_id and j.lone_work
  where cardinality(j.lone_work_measures) = 0
     or ('dati' = any (j.lone_work_measures) and not app.hr_dati_remis(c.person_id))
;
comment on view public.v_hr_echeances is 'Échéances RH (habilitations, visites, fins de CDD et d''essai, entretiens, DPAE, accueil sécurité, travail isolé), aux droits du lecteur';
revoke all on public.v_hr_echeances from public, anon;
grant select on public.v_hr_echeances to authenticated;

insert into public.schema_migrations (version) values ('0522_rh_documents_obligatoires') on conflict (version) do nothing;

-- ===== supabase/rollback/0522_rh_documents_obligatoires_retour.sql =====
-- Retour arrière de 0522 : échéances remises comme en 0521, modèle de liste d'arrivée remis comme en 0314 (ligne
-- « Accueil sécurité fait » retirée des modèles, y compris une ligne de même libellé ajoutée à la main ; les listes déjà
-- ouvertes la gardent), tables, fonctions et colonnes supprimées.
create or replace view public.v_hr_echeances with (security_invoker = true) as
  select q.company_id, q.person_id, 'habilitation'::text as kind, q.label, q.expires_on as due_on, q.id as source_id
  from public.hr_qualifications q
  where q.archived_at is null and q.expires_on is not null
  union all
  select m.company_id, m.person_id, 'visite', 'Visite de santé au travail', m.next_due_on, m.id
  from public.hr_medical_followups m
  where m.next_due_on is not null
    and not exists (select 1 from public.hr_medical_followups m2
                    where m2.person_id = m.person_id and m2.visit_on is not null and m2.visit_on >= m.next_due_on)
  union all
  select e.company_id, e.person_id, 'fin_contrat', 'Fin de contrat', e.end_on, e.id
  from public.hr_employments e
  where e.end_on is not null and e.end_on >= current_date - 30
  union all
  select e.company_id, e.person_id, 'fin_essai', 'Fin de la période d''essai', e.trial_end_on, e.id
  from public.hr_employments e
  where e.trial_end_on is not null and e.trial_end_on >= current_date - 30
  union all
  select r.company_id, r.person_id, 'entretien',
         case r.kind when 'parcours' then 'Entretien de parcours professionnel' when 'bilan' then 'Bilan du parcours professionnel'
                     when 'annuel' then 'Entretien annuel' else 'Entretien' end,
         coalesce(case when r.done_on is null then r.planned_on end, r.next_due_on), r.id
  from public.hr_reviews r
  where coalesce(case when r.done_on is null then r.planned_on end, r.next_due_on) is not null
    and not exists (select 1 from public.hr_reviews r2 where r2.person_id = r.person_id and r2.kind = r.kind
                    and r2.done_on is not null and r2.done_on > coalesce(r.done_on, r.planned_on, r.next_due_on))
  union all
  select e.company_id, e.person_id, 'dpae', 'Déclaration préalable à l''embauche (DPAE)', e.start_on, e.id
  from public.hr_employments e
  where e.dpae_sent_on is null
    and e.contract_type in ('cdi', 'cdd', 'apprentissage', 'professionnalisation')
    and e.start_on >= current_date - 30
;
comment on view public.v_hr_echeances is 'Échéances RH (habilitations, visites, fins de CDD et d''essai, entretiens, DPAE), aux droits du lecteur';
revoke all on public.v_hr_echeances from public, anon;
grant select on public.v_hr_echeances to authenticated;

create or replace function app.hr_listes_depart(p_company uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.hr_checklist_templates (company_id, kind, label, position)
  select p_company, x.kind, x.label, x.pos
  from (values
    ('arrivee', 'Contrat signé et rangé dans les documents', 1),
    ('arrivee', 'Déclaration préalable à l''embauche faite', 2),
    ('arrivee', 'Visite d''information et de prévention demandée', 3),
    ('arrivee', 'Livret d''accueil et règlement intérieur remis', 4),
    ('arrivee', 'Équipements de protection individuelle remis', 5),
    ('arrivee', 'Accès à l''outil, badge et clés donnés', 6),
    ('arrivee', 'Habilitations vérifiées ou formations prévues', 7),
    ('depart', 'Matériel, véhicule, badge et clés restitués', 1),
    ('depart', 'Accès à l''outil et aux comptes coupés', 2),
    ('depart', 'Solde de tout compte remis', 3),
    ('depart', 'Certificat de travail et attestation France Travail remis', 4),
    ('depart', 'Entretien de départ fait', 5)) as x(kind, label, pos)
  on conflict (company_id, kind, label) do nothing
$$;
revoke all on function app.hr_listes_depart(uuid) from public, anon, authenticated;
delete from public.hr_checklist_templates where kind = 'arrivee' and label = 'Accueil sécurité fait';

drop trigger if exists hr_checklists_accueil on public.hr_checklists;
drop trigger if exists hr_employments_accueil on public.hr_employments;
drop function if exists app.hr_contrat_accueil();
drop function if exists app.hr_liste_accueil();
drop table if exists public.hr_safety_inductions;
drop function if exists app.hr_debut_continu(uuid);
drop function if exists app.hr_dati_remis(uuid);
drop function if exists app.hr_accueil_avant();
drop function if exists app.hr_accueil_liste();
drop table if exists public.hr_postings;
drop function if exists app.hr_affichage_maj();
alter table public.hr_settings drop constraint if exists hr_settings_posting_location_longueur;
alter table public.hr_settings drop column if exists posting_location;
alter table public.stock_items drop column if exists dati;
alter table public.hr_jobs drop constraint if exists hr_jobs_lone_work_check;
alter table public.hr_jobs drop column if exists lone_work_duerp_ref;
alter table public.hr_jobs drop column if exists lone_work_note;
alter table public.hr_jobs drop column if exists lone_work_measures;
alter table public.hr_jobs drop column if exists lone_work;
delete from public.schema_migrations where version = '0522_rh_documents_obligatoires';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE rh_documents_obligatoires_0522 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
