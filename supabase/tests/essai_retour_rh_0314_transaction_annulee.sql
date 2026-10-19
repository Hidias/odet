-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (rh_0314) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0314_rh_entretiens.sql, retour arrière,
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

-- ===== supabase/migrations/0314_rh_entretiens.sql =====
-- 0314_rh_entretiens.sql : chantier 12, module RH, entretiens et listes d'arrivée et de départ (spec odet-spec-rh.md
-- § 7, branche rh/entretiens).
--
-- Entretiens (hr_reviews) : entretien de parcours professionnel, bilan du parcours, entretien annuel, autre ; date
-- prévue, date faite, conduit par, compte rendu court, document joint, prochaine échéance.
-- Échéances proposées par défaut (loi du 24/10/2025 issue de l'ANI sur les transitions professionnelles, en vigueur
-- depuis le 26/10/2025, lue le 19/10/2026 sur ffbatiment.fr) : premier entretien de parcours dans l'année qui suit
-- l'embauche, puis tous les 4 ans ; bilan récapitulatif tous les 8 ans. Un accord de branche ou d'entreprise peut
-- fixer une autre fréquence : l'échéance reste modifiable, l'outil ne bloque rien.
-- Listes d'arrivée et de départ (hr_checklists) : étapes cochées une à une (date et auteur), depuis un modèle par
-- société (hr_checklist_templates, posé au départ : remise du livret, visite d'information et de prévention, EPI,
-- badge, accès ; au départ : restitution du matériel, solde de tout compte, attestation, coupure des accès).
-- Les échéances d'entretien rejoignent v_hr_echeances (remplacée, mêmes colonnes).
-- Droits (build_suite('0314')) : voir regles.py ; isolement par société ; journal par app.audit_row.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0314_rh_entretiens_retour.sql

create table if not exists public.hr_reviews (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  person_id uuid not null references public.hr_people(id) on delete cascade,
  kind text not null default 'parcours' check (kind in ('parcours', 'bilan', 'annuel', 'autre')),
  planned_on date,
  done_on date,
  interviewer_person_id uuid references public.hr_people(id) on delete set null,
  summary text check (summary is null or length(summary) <= 2000),
  document_id uuid references public.hr_documents(id) on delete set null,
  next_due_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_reviews_date check (planned_on is not null or done_on is not null or next_due_on is not null)
);
create index if not exists hr_reviews_company_idx on public.hr_reviews (company_id);
create index if not exists hr_reviews_person_idx on public.hr_reviews (person_id);
comment on table public.hr_reviews is 'Entretiens du personnel : parcours professionnel, bilan, annuel ; dates et prochaine échéance';

create table if not exists public.hr_checklist_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  kind text not null check (kind in ('arrivee', 'depart')),
  label text not null check (length(btrim(label)) > 0),
  position int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hr_checklist_templates_company_idx on public.hr_checklist_templates (company_id, kind, position);
create unique index if not exists hr_checklist_templates_uniq on public.hr_checklist_templates (company_id, kind, label);

create table if not exists public.hr_checklists (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  person_id uuid not null references public.hr_people(id) on delete cascade,
  kind text not null check (kind in ('arrivee', 'depart')),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (person_id, kind)
);
create index if not exists hr_checklists_company_idx on public.hr_checklists (company_id);
comment on table public.hr_checklists is 'Liste d''arrivée ou de départ d''une personne : étapes [{ label, done_on, done_by }]';

do $$
declare t text;
begin
  foreach t in array array['hr_reviews', 'hr_checklist_templates', 'hr_checklists'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_maj', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function app.hr_h_maj()', t || '_maj', t);
  end loop;
end $$;

-- Même société que la personne ; document joint et intervieweur de la même société
create or replace function app.hr_entretien_garde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' or new.person_id is distinct from old.person_id or new.company_id is distinct from old.company_id)
     and not exists (select 1 from public.hr_people p where p.id = new.person_id and p.company_id = new.company_id) then
    raise exception 'RH : la personne appartient à une autre société' using errcode = '23514';
  end if;
  if tg_table_name = 'hr_reviews' then
    if new.document_id is not null and (tg_op = 'INSERT' or new.document_id is distinct from old.document_id)
       and not exists (select 1 from public.hr_documents d where d.id = new.document_id and d.person_id = new.person_id) then
      raise exception 'Le document joint est celui d''une autre personne' using errcode = '23514';
    end if;
    if new.interviewer_person_id is not null and (tg_op = 'INSERT' or new.interviewer_person_id is distinct from old.interviewer_person_id)
       and not exists (select 1 from public.hr_people p where p.id = new.interviewer_person_id and p.company_id = new.company_id) then
      raise exception 'La personne qui conduit l''entretien appartient à une autre société' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;
revoke all on function app.hr_entretien_garde() from public, anon, authenticated;
drop trigger if exists hr_reviews_garde on public.hr_reviews;
create trigger hr_reviews_garde before insert or update on public.hr_reviews for each row execute function app.hr_entretien_garde();
drop trigger if exists hr_checklists_garde on public.hr_checklists;
create trigger hr_checklists_garde before insert or update on public.hr_checklists for each row execute function app.hr_entretien_garde();

-- Modèles de départ pour chaque société (et chaque nouvelle)
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
select app.hr_listes_depart(c.id) from public.companies c;

-- Nouvelle société : listes posées avec les autres référentiels de départ
create or replace function app.societe_referentiels_depart()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.subcontractor_doc_types_depart(new.id);
  if to_regprocedure('app.obligation_rules_depart(uuid)') is not null then
    execute 'select app.obligation_rules_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.commercial_lists_depart(uuid)') is not null then
    execute 'select app.commercial_lists_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.rgpd_sous_traitants_depart(uuid)') is not null then
    execute 'select app.rgpd_sous_traitants_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.rgpd_purge_regles_depart(uuid)') is not null then
    execute 'select app.rgpd_purge_regles_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.cert_pitfalls_depart(uuid)') is not null then
    execute 'select app.cert_pitfalls_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.hr_horaires_depart(uuid)') is not null then
    execute 'select app.hr_horaires_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.hr_types_absence_depart(uuid)') is not null then
    execute 'select app.hr_types_absence_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.hr_feries_depart(uuid)') is not null then
    execute 'select app.hr_feries_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.hr_listes_depart(uuid)') is not null then
    execute 'select app.hr_listes_depart($1)' using new.id;
  end if;
  return null;
end
$$;
revoke all on function app.societe_referentiels_depart() from public, anon, authenticated;

-- Créer la liste d'une personne depuis le modèle (« Tenir les dossiers »)
create or replace function public.hr_liste_ouvrir(p_person uuid, p_kind text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_co uuid;
  v_id uuid;
begin
  select p.company_id into v_co from public.hr_people p where p.id = p_person;
  if v_co is null then raise exception 'Personne introuvable' using errcode = 'P0002'; end if;
  if v_co not in (select app.societes_avec_droit('rh.dossiers.gerer')) then raise exception 'Accès refusé' using errcode = '42501'; end if;
  if p_kind not in ('arrivee', 'depart') then raise exception 'Liste inconnue' using errcode = '22023'; end if;
  insert into public.hr_checklists (company_id, person_id, kind, items)
  select v_co, p_person, p_kind,
         coalesce(jsonb_agg(jsonb_build_object('label', t.label, 'done_on', null, 'done_by', null) order by t.position), '[]'::jsonb)
  from public.hr_checklist_templates t where t.company_id = v_co and t.kind = p_kind and t.is_active
  on conflict (person_id, kind) do nothing
  returning id into v_id;
  if v_id is null then select id into v_id from public.hr_checklists where person_id = p_person and kind = p_kind; end if;
  return v_id;
end
$$;
revoke all on function public.hr_liste_ouvrir(uuid, text) from public, anon;
grant execute on function public.hr_liste_ouvrir(uuid, text) to authenticated;

-- Échéances : celles de 0301, plus les entretiens prévus ou à refaire
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
;
comment on view public.v_hr_echeances is 'Échéances RH (habilitations, visites, fins de CDD et d''essai, entretiens), aux droits du lecteur';
revoke all on public.v_hr_echeances from public, anon;
grant select on public.v_hr_echeances to authenticated;

-- Journal
do $$
declare r record;
begin
  for r in select * from (values ('hr_reviews', 'personnel'), ('hr_checklists', 'personnel'), ('hr_checklist_templates', 'parametres_rh')) as t(nom, type) loop
    execute format('drop trigger if exists zz_audit_row on public.%I', r.nom);
    execute format('create trigger zz_audit_row after insert or update or delete on public.%I for each row execute function app.audit_row(%L)', r.nom, r.type);
  end loop;
end $$;

-- ── Droits des tables ──
alter table public.hr_reviews enable row level security;
alter table public.hr_checklists enable row level security;
alter table public.hr_checklist_templates enable row level security;
revoke all on table public.hr_reviews, public.hr_checklists, public.hr_checklist_templates from public, anon;
grant select, insert, update, delete on table public.hr_reviews, public.hr_checklists, public.hr_checklist_templates to authenticated;
grant all on table public.hr_reviews, public.hr_checklists, public.hr_checklist_templates to service_role;

-- ── Règles (générées par scripts/securite/regles.py, build_suite('0314')) ──

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
           where schemaname = 'public' and tablename = any (array['hr_checklist_templates', 'hr_checklists', 'hr_reviews'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- hr_checklist_templates
select pg_temp.regles(array['hr_checklist_templates'], null,
  $r$company_id in (select app.societes_avec_droit('rh.personnel.voir'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.parametres.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.parametres.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.parametres.gerer'))$r$);

-- hr_checklists
select pg_temp.regles(array['hr_checklists'], null,
  $r$(company_id in (select app.societes_avec_droit('rh.dossiers.voir')) or person_id in (select app.hr_mes_personnes()))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))$r$);

-- hr_reviews
select pg_temp.regles(array['hr_reviews'], null,
  $r$(company_id in (select app.societes_avec_droit('rh.dossiers.voir')) or person_id in (select app.hr_mes_personnes()) or person_id in (select app.hr_mon_equipe()))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))$r$);


do $$
declare t text;
begin
  foreach t in array array['hr_reviews', 'hr_checklists', 'hr_checklist_templates'] loop
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

insert into public.schema_migrations (version) values ('0314_rh_entretiens') on conflict (version) do nothing;

-- ===== supabase/rollback/0314_rh_entretiens_retour.sql =====
-- Retour arrière de 0314_rh_entretiens.sql : remet la vue des échéances de 0301 et les référentiels de départ de 0311,
-- retire entretiens, listes et modèles. Idempotent. Refusé si des entretiens ou des listes ont été saisis.

do $$
begin
  if (to_regclass('public.hr_reviews') is not null and exists (select 1 from public.hr_reviews))
     or (to_regclass('public.hr_checklists') is not null and exists (select 1 from public.hr_checklists)) then
    raise exception 'Retour arrière refusé : des entretiens ou des listes d''arrivée et de départ ont été saisis (à exporter d''abord)';
  end if;
end $$;

drop view if exists public.v_hr_echeances;
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
  where e.trial_end_on is not null and e.trial_end_on >= current_date - 30;
comment on view public.v_hr_echeances is 'Échéances RH (habilitations, visites, fins de CDD et d''essai), aux droits du lecteur';
revoke all on public.v_hr_echeances from public, anon;
grant select on public.v_hr_echeances to authenticated;

create or replace function app.societe_referentiels_depart()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.subcontractor_doc_types_depart(new.id);
  if to_regprocedure('app.obligation_rules_depart(uuid)') is not null then
    execute 'select app.obligation_rules_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.commercial_lists_depart(uuid)') is not null then
    execute 'select app.commercial_lists_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.rgpd_sous_traitants_depart(uuid)') is not null then
    execute 'select app.rgpd_sous_traitants_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.rgpd_purge_regles_depart(uuid)') is not null then
    execute 'select app.rgpd_purge_regles_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.cert_pitfalls_depart(uuid)') is not null then
    execute 'select app.cert_pitfalls_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.hr_horaires_depart(uuid)') is not null then
    execute 'select app.hr_horaires_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.hr_types_absence_depart(uuid)') is not null then
    execute 'select app.hr_types_absence_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.hr_feries_depart(uuid)') is not null then
    execute 'select app.hr_feries_depart($1)' using new.id;
  end if;
  return null;
end
$$;
revoke all on function app.societe_referentiels_depart() from public, anon, authenticated;

drop function if exists public.hr_liste_ouvrir(uuid, text);
drop function if exists app.hr_listes_depart(uuid);
drop table if exists public.hr_checklists;
drop table if exists public.hr_checklist_templates;
drop table if exists public.hr_reviews;
drop function if exists app.hr_entretien_garde();

delete from public.schema_migrations where version = '0314_rh_entretiens';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE rh_0314 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
