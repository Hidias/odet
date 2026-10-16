-- Essai de 0250 (suivi formatif) en transaction annulée : migration jouée DEUX fois (rejouable), puis tests de droits.
-- À coller en une fois dans l'éditeur SQL de Supabase. Se termine TOUJOURS par l'erreur volontaire
-- « RÉSULTAT DES TESTS SUIVI FORMATIF (tout est annulé) » : rien n'est enregistré.
-- Fichier généré : 0250_suivi_formatif.sql (deux fois) + droits_suivi_formatif.sql.

-- 0250_suivi_formatif.sql : module « Suivi formatif » (évaluation formative par séquence, fiche de suivi archivée)
-- et archivage des grilles de certification SST.
--
-- Migration additive : aucune colonne, règle ni fonction existante n'est modifiée (une seule colonne ajoutée à
-- courses). Rejouable sans effet. Retour arrière : supabase/rollback/0250_suivi_formatif_retour.sql
--
-- 1. Module « suivi_formatif » (org_modules), désactivé par défaut.
-- 2. Fonctions de droits sf_* : même matrice que les règles de trainee_objectives du chantier 2 (0082) :
--      lecture  : admin, commercial, direction, gestionnaire, lecture, superadmin, ou formateur de la session ;
--      écriture : admin, direction, gestionnaire, superadmin, ou formateur de la session ;
--      module coupé : lecture du superadmin seulement.
--    Elles ne dépendent pas du schéma app du chantier 2 : la migration peut être appliquée avant ou après lui.
-- 3. courses.formative_enabled, course_sequences (séquences du catalogue).
-- 4. session_sequences (copie figée par session, note du groupe), formative_evaluations (écarts au groupe,
--    rôle, indicateurs, remarque), formative_sheets (fiches archivées, versionnées, jamais modifiées).
-- 5. Fonctions : sf_init_session(), save_formative_batch(), sf_register_sheet().
-- 6. Bucket privé « archives-formation » : <session>/suivi/... et <session>/certification-sst/...
--    Lecture et dépôt selon les droits de la session ; ni modification ni suppression (archives immuables).

-- ── 1. Module ──
insert into public.org_modules (key, label, enabled, position, description)
values ('suivi_formatif', 'Suivi formatif', false, 32,
        'Évaluation formative par séquence : saisie du formateur sur téléphone, fiche de suivi archivée, couverture avant l''épreuve')
on conflict (key) do nothing;

-- ── 2. Droits ──
create or replace function public.sf_role()
returns text
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = (select auth.uid()) and p.is_active
$$;

create or replace function public.sf_module_on(p_key text default 'suivi_formatif')
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select m.enabled from public.org_modules m where m.key = p_key), false)
$$;

create or replace function public.sf_is_trainer_of(p_session uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid()) and p.is_active and p.trainer_id is not null
      and (
        exists (select 1 from public.sessions s where s.id = p_session and s.trainer_id = p.trainer_id)
        or exists (select 1 from public.session_trainers st where st.session_id = p_session and st.trainer_id = p.trainer_id)
      )
  )
$$;

-- Lecture des données d'une session (p_module : module qui garde la donnée)
create or replace function public.sf_can_read(p_session uuid, p_module text default 'suivi_formatif')
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    public.sf_role() = 'superadmin'
    or (
      public.sf_module_on(p_module)
      and (
        public.sf_role() in ('admin', 'commercial', 'direction', 'gestionnaire', 'lecture')
        or (public.sf_role() = 'formateur' and public.sf_is_trainer_of(p_session))
      )
    ),
    false)
$$;

-- Écriture des données d'une session
create or replace function public.sf_can_write(p_session uuid, p_module text default 'suivi_formatif')
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    public.sf_module_on(p_module)
    and (
      public.sf_role() in ('superadmin', 'admin', 'direction', 'gestionnaire')
      or (public.sf_role() = 'formateur' and public.sf_is_trainer_of(p_session))
    ),
    false)
$$;

-- Catalogue : lecture par l'équipe, écriture par les gestionnaires
create or replace function public.sf_catalog_read()
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    public.sf_role() = 'superadmin'
    or (public.sf_module_on() and public.sf_role() in ('admin', 'commercial', 'direction', 'formateur', 'gestionnaire', 'lecture')),
    false)
$$;

create or replace function public.sf_catalog_write()
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.sf_module_on() and public.sf_role() in ('superadmin', 'admin', 'direction', 'gestionnaire'), false)
$$;

-- Fichiers d'archive : <session_id>/<suivi|certification-sst>/<fichier>
create or replace function public.sf_archive_can(p_name text, p_write boolean)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_parts text[] := string_to_array(coalesce(p_name, ''), '/');
  v_session uuid;
  v_module text;
begin
  if array_length(v_parts, 1) is distinct from 3 then return false; end if;
  if v_parts[1] !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return false; end if;
  if coalesce(v_parts[3], '') = '' then return false; end if;
  v_session := v_parts[1]::uuid;
  v_module := case v_parts[2] when 'suivi' then 'suivi_formatif' when 'certification-sst' then 'prevention' else null end;
  if v_module is null then return false; end if;
  if p_write then return public.sf_can_write(v_session, v_module); end if;
  return public.sf_can_read(v_session, v_module);
end $$;

revoke all on function public.sf_role() from public, anon;
revoke all on function public.sf_module_on(text) from public, anon;
revoke all on function public.sf_is_trainer_of(uuid) from public, anon;
revoke all on function public.sf_can_read(uuid, text) from public, anon;
revoke all on function public.sf_can_write(uuid, text) from public, anon;
revoke all on function public.sf_catalog_read() from public, anon;
revoke all on function public.sf_catalog_write() from public, anon;
revoke all on function public.sf_archive_can(text, boolean) from public, anon;
grant execute on function public.sf_role() to authenticated, service_role;
grant execute on function public.sf_module_on(text) to authenticated, service_role;
grant execute on function public.sf_is_trainer_of(uuid) to authenticated, service_role;
grant execute on function public.sf_can_read(uuid, text) to authenticated, service_role;
grant execute on function public.sf_can_write(uuid, text) to authenticated, service_role;
grant execute on function public.sf_catalog_read() to authenticated, service_role;
grant execute on function public.sf_catalog_write() to authenticated, service_role;
grant execute on function public.sf_archive_can(text, boolean) to authenticated, service_role;

-- ── 3. Catalogue ──
alter table public.courses add column if not exists formative_enabled boolean not null default false;

create table if not exists public.course_sequences (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  position int not null default 0,
  title text not null,
  competences text[] not null default '{}',
  modality text not null default 'oral'
    check (modality in ('oral', 'qcm', 'etude_cas', 'mise_situation', 'demonstration', 'autre')),
  roles text[] not null default '{}',
  success_indicators text[] not null default '{}',
  duration_minutes int,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists course_sequences_course_idx on public.course_sequences (course_id, position);

-- ── 4. Sessions ──
create table if not exists public.session_sequences (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  source_sequence_id uuid references public.course_sequences(id) on delete set null,
  position int not null default 0,
  title text not null,
  competences text[] not null default '{}',
  modality text not null default 'oral'
    check (modality in ('oral', 'qcm', 'etude_cas', 'mise_situation', 'demonstration', 'autre')),
  roles text[] not null default '{}',
  success_indicators text[] not null default '{}',
  planned_date date,
  group_status text check (group_status in ('acquis', 'en_cours', 'a_revoir', 'non_observe')),
  group_remark text,
  group_updated_at timestamptz,
  closed_at timestamptz,
  closed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists session_sequences_session_idx on public.session_sequences (session_id, position);

create table if not exists public.formative_evaluations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  session_sequence_id uuid not null references public.session_sequences(id) on delete cascade,
  trainee_id uuid not null references public.trainees(id) on delete cascade,
  status text check (status in ('acquis', 'en_cours', 'a_revoir', 'non_observe')),
  role text,
  indicators_met text[] not null default '{}',
  remark text,
  evaluated_by uuid,
  client_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_sequence_id, trainee_id)
);
create index if not exists formative_evaluations_session_idx on public.formative_evaluations (session_id);
create index if not exists formative_evaluations_trainee_idx on public.formative_evaluations (trainee_id);

create table if not exists public.formative_sheets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  version int not null,
  file_path text not null,
  file_name text not null,
  content_hash text,
  reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (session_id, version)
);

-- Mises à jour horodatées
create or replace function public.sf_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists course_sequences_touch on public.course_sequences;
create trigger course_sequences_touch before update on public.course_sequences
  for each row execute function public.sf_touch_updated_at();
drop trigger if exists session_sequences_touch on public.session_sequences;
create trigger session_sequences_touch before update on public.session_sequences
  for each row execute function public.sf_touch_updated_at();
drop trigger if exists formative_evaluations_touch on public.formative_evaluations;
create trigger formative_evaluations_touch before update on public.formative_evaluations
  for each row execute function public.sf_touch_updated_at();

-- ── Règles d'accès ──
alter table public.course_sequences enable row level security;
alter table public.session_sequences enable row level security;
alter table public.formative_evaluations enable row level security;
alter table public.formative_sheets enable row level security;
revoke all on public.course_sequences, public.session_sequences, public.formative_evaluations, public.formative_sheets from anon;

drop policy if exists course_sequences_lire on public.course_sequences;
drop policy if exists course_sequences_creer on public.course_sequences;
drop policy if exists course_sequences_modifier on public.course_sequences;
drop policy if exists course_sequences_supprimer on public.course_sequences;
create policy course_sequences_lire on public.course_sequences for select to authenticated
  using ((select public.sf_catalog_read()));
create policy course_sequences_creer on public.course_sequences for insert to authenticated
  with check ((select public.sf_catalog_write()));
create policy course_sequences_modifier on public.course_sequences for update to authenticated
  using ((select public.sf_catalog_write())) with check ((select public.sf_catalog_write()));
create policy course_sequences_supprimer on public.course_sequences for delete to authenticated
  using ((select public.sf_catalog_write()));

drop policy if exists session_sequences_lire on public.session_sequences;
drop policy if exists session_sequences_creer on public.session_sequences;
drop policy if exists session_sequences_modifier on public.session_sequences;
drop policy if exists session_sequences_supprimer on public.session_sequences;
create policy session_sequences_lire on public.session_sequences for select to authenticated
  using (public.sf_can_read(session_id));
create policy session_sequences_creer on public.session_sequences for insert to authenticated
  with check (public.sf_can_write(session_id));
create policy session_sequences_modifier on public.session_sequences for update to authenticated
  using (public.sf_can_write(session_id)) with check (public.sf_can_write(session_id));
create policy session_sequences_supprimer on public.session_sequences for delete to authenticated
  using (public.sf_can_write(session_id));

drop policy if exists formative_evaluations_lire on public.formative_evaluations;
drop policy if exists formative_evaluations_creer on public.formative_evaluations;
drop policy if exists formative_evaluations_modifier on public.formative_evaluations;
drop policy if exists formative_evaluations_supprimer on public.formative_evaluations;
create policy formative_evaluations_lire on public.formative_evaluations for select to authenticated
  using (public.sf_can_read(session_id));
create policy formative_evaluations_creer on public.formative_evaluations for insert to authenticated
  with check (public.sf_can_write(session_id));
create policy formative_evaluations_modifier on public.formative_evaluations for update to authenticated
  using (public.sf_can_write(session_id)) with check (public.sf_can_write(session_id));
create policy formative_evaluations_supprimer on public.formative_evaluations for delete to authenticated
  using (public.sf_can_write(session_id));

-- Fiches archivées : lecture et ajout seulement, jamais de modification ni de suppression
drop policy if exists formative_sheets_lire on public.formative_sheets;
drop policy if exists formative_sheets_creer on public.formative_sheets;
create policy formative_sheets_lire on public.formative_sheets for select to authenticated
  using (public.sf_can_read(session_id));
create policy formative_sheets_creer on public.formative_sheets for insert to authenticated
  with check (public.sf_can_write(session_id));

grant select, insert, update, delete on public.course_sequences, public.session_sequences, public.formative_evaluations to authenticated;
grant select, insert on public.formative_sheets to authenticated;

-- ── 5. Fonctions ──

-- Copie les séquences du catalogue dans la session (une seule fois). Renvoie le nombre de séquences de la session.
create or replace function public.sf_init_session(p_session uuid)
returns int
language plpgsql security invoker set search_path = '' as $$
declare
  v_course uuid;
  v_n int;
begin
  if not public.sf_can_write(p_session) then
    raise exception 'Accès refusé au suivi formatif de cette session' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('sf_init_' || p_session::text));
  select count(*) into v_n from public.session_sequences where session_id = p_session;
  if v_n > 0 then return v_n; end if;
  select s.course_id into v_course from public.sessions s where s.id = p_session;
  if v_course is null then return 0; end if;
  insert into public.session_sequences (session_id, source_sequence_id, position, title, competences, modality, roles, success_indicators)
  select p_session, cs.id, cs.position, cs.title, cs.competences, cs.modality, cs.roles, cs.success_indicators
  from public.course_sequences cs
  where cs.course_id = v_course
  order by cs.position;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Enregistre une file de saisies faites sur le téléphone.
-- Élément « stagiaire » : { "type": "trainee", "session_sequence_id", "trainee_id", "status", "role",
--   "indicators_met": [], "remark", "clear": false, "client_updated_at" }
-- Élément « groupe »    : { "type": "group", "session_sequence_id", "group_status", "group_remark", "client_updated_at" }
-- Élément « clôture »   : { "type": "close", "session_sequence_id", "closed": true|false, "client_updated_at" }
-- Une saisie plus ancienne que la ligne en base est ignorée (deux téléphones, ou file rejouée).
create or replace function public.save_formative_batch(p_items jsonb)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  it jsonb;
  v_type text;
  v_seq uuid;
  v_session uuid;
  v_trainee uuid;
  v_at timestamptz;
  v_saved int := 0;
  v_ignored int := 0;
  v_existing timestamptz;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Liste de saisies attendue' using errcode = '22023';
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    v_type := coalesce(it->>'type', 'trainee');
    v_seq := (it->>'session_sequence_id')::uuid;
    v_at := coalesce((it->>'client_updated_at')::timestamptz, now());
    select ss.session_id into v_session from public.session_sequences ss where ss.id = v_seq;
    if v_session is null or not public.sf_can_write(v_session) then
      v_ignored := v_ignored + 1;
      continue;
    end if;

    if v_type = 'group' then
      update public.session_sequences
         set group_status = nullif(it->>'group_status', ''),
             group_remark = nullif(it->>'group_remark', ''),
             group_updated_at = v_at
       where id = v_seq and (group_updated_at is null or group_updated_at <= v_at);
      if found then v_saved := v_saved + 1; else v_ignored := v_ignored + 1; end if;

    elsif v_type = 'close' then
      update public.session_sequences
         set closed_at = case when coalesce((it->>'closed')::boolean, true) then coalesce(closed_at, v_at) else null end,
             closed_by = case when coalesce((it->>'closed')::boolean, true) then coalesce(closed_by, (select auth.uid())) else null end
       where id = v_seq;
      v_saved := v_saved + 1;

    else
      v_trainee := (it->>'trainee_id')::uuid;
      select fe.client_updated_at into v_existing
        from public.formative_evaluations fe
       where fe.session_sequence_id = v_seq and fe.trainee_id = v_trainee;
      if v_existing is not null and v_existing > v_at then
        v_ignored := v_ignored + 1;
        continue;
      end if;
      if coalesce((it->>'clear')::boolean, false) then
        delete from public.formative_evaluations where session_sequence_id = v_seq and trainee_id = v_trainee;
      else
        insert into public.formative_evaluations
          (session_id, session_sequence_id, trainee_id, status, role, indicators_met, remark, evaluated_by, client_updated_at)
        values (
          v_session, v_seq, v_trainee,
          nullif(it->>'status', ''),
          nullif(it->>'role', ''),
          coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(it->'indicators_met', '[]'::jsonb)) x), '{}'),
          nullif(it->>'remark', ''),
          (select auth.uid()),
          v_at)
        on conflict (session_sequence_id, trainee_id) do update
          set status = excluded.status,
              role = excluded.role,
              indicators_met = excluded.indicators_met,
              remark = excluded.remark,
              evaluated_by = excluded.evaluated_by,
              client_updated_at = excluded.client_updated_at;
      end if;
      v_saved := v_saved + 1;
    end if;
  end loop;
  return jsonb_build_object('saved', v_saved, 'ignored', v_ignored);
end $$;

-- Inscrit une fiche de suivi archivée et renvoie son numéro de version
create or replace function public.sf_register_sheet(p_session uuid, p_path text, p_name text, p_hash text, p_reason text)
returns int
language plpgsql security invoker set search_path = '' as $$
declare
  v_version int;
begin
  if not public.sf_can_write(p_session) then
    raise exception 'Accès refusé au suivi formatif de cette session' using errcode = '42501';
  end if;
  if p_path is null or split_part(p_path, '/', 1) <> p_session::text or split_part(p_path, '/', 2) <> 'suivi' then
    raise exception 'Chemin d''archive invalide' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('sf_sheet_' || p_session::text));
  select coalesce(max(version), 0) + 1 into v_version from public.formative_sheets where session_id = p_session;
  insert into public.formative_sheets (session_id, version, file_path, file_name, content_hash, reason, created_by)
  values (p_session, v_version, p_path, p_name, p_hash, nullif(p_reason, ''), (select auth.uid()));
  return v_version;
end $$;

revoke all on function public.sf_init_session(uuid) from public, anon;
revoke all on function public.save_formative_batch(jsonb) from public, anon;
revoke all on function public.sf_register_sheet(uuid, text, text, text, text) from public, anon;
grant execute on function public.sf_init_session(uuid) to authenticated;
grant execute on function public.save_formative_batch(jsonb) to authenticated;
grant execute on function public.sf_register_sheet(uuid, text, text, text, text) to authenticated;

-- ── 6. Archives : bucket privé, ni modification ni suppression ──
insert into storage.buckets (id, name, public) values ('archives-formation', 'archives-formation', false)
on conflict (id) do nothing;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'archives_formation_lire') then
    create policy archives_formation_lire on storage.objects for select to authenticated
      using (bucket_id = 'archives-formation' and public.sf_archive_can(name, false));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'archives_formation_deposer') then
    create policy archives_formation_deposer on storage.objects for insert to authenticated
      with check (bucket_id = 'archives-formation' and public.sf_archive_can(name, true));
  end if;
end $$;

insert into public.schema_migrations (version) values ('0250_suivi_formatif') on conflict (version) do nothing;

-- 0250_suivi_formatif.sql : module « Suivi formatif » (évaluation formative par séquence, fiche de suivi archivée)
-- et archivage des grilles de certification SST.
--
-- Migration additive : aucune colonne, règle ni fonction existante n'est modifiée (une seule colonne ajoutée à
-- courses). Rejouable sans effet. Retour arrière : supabase/rollback/0250_suivi_formatif_retour.sql
--
-- 1. Module « suivi_formatif » (org_modules), désactivé par défaut.
-- 2. Fonctions de droits sf_* : même matrice que les règles de trainee_objectives du chantier 2 (0082) :
--      lecture  : admin, commercial, direction, gestionnaire, lecture, superadmin, ou formateur de la session ;
--      écriture : admin, direction, gestionnaire, superadmin, ou formateur de la session ;
--      module coupé : lecture du superadmin seulement.
--    Elles ne dépendent pas du schéma app du chantier 2 : la migration peut être appliquée avant ou après lui.
-- 3. courses.formative_enabled, course_sequences (séquences du catalogue).
-- 4. session_sequences (copie figée par session, note du groupe), formative_evaluations (écarts au groupe,
--    rôle, indicateurs, remarque), formative_sheets (fiches archivées, versionnées, jamais modifiées).
-- 5. Fonctions : sf_init_session(), save_formative_batch(), sf_register_sheet().
-- 6. Bucket privé « archives-formation » : <session>/suivi/... et <session>/certification-sst/...
--    Lecture et dépôt selon les droits de la session ; ni modification ni suppression (archives immuables).

-- ── 1. Module ──
insert into public.org_modules (key, label, enabled, position, description)
values ('suivi_formatif', 'Suivi formatif', false, 32,
        'Évaluation formative par séquence : saisie du formateur sur téléphone, fiche de suivi archivée, couverture avant l''épreuve')
on conflict (key) do nothing;

-- ── 2. Droits ──
create or replace function public.sf_role()
returns text
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = (select auth.uid()) and p.is_active
$$;

create or replace function public.sf_module_on(p_key text default 'suivi_formatif')
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select m.enabled from public.org_modules m where m.key = p_key), false)
$$;

create or replace function public.sf_is_trainer_of(p_session uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid()) and p.is_active and p.trainer_id is not null
      and (
        exists (select 1 from public.sessions s where s.id = p_session and s.trainer_id = p.trainer_id)
        or exists (select 1 from public.session_trainers st where st.session_id = p_session and st.trainer_id = p.trainer_id)
      )
  )
$$;

-- Lecture des données d'une session (p_module : module qui garde la donnée)
create or replace function public.sf_can_read(p_session uuid, p_module text default 'suivi_formatif')
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    public.sf_role() = 'superadmin'
    or (
      public.sf_module_on(p_module)
      and (
        public.sf_role() in ('admin', 'commercial', 'direction', 'gestionnaire', 'lecture')
        or (public.sf_role() = 'formateur' and public.sf_is_trainer_of(p_session))
      )
    ),
    false)
$$;

-- Écriture des données d'une session
create or replace function public.sf_can_write(p_session uuid, p_module text default 'suivi_formatif')
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    public.sf_module_on(p_module)
    and (
      public.sf_role() in ('superadmin', 'admin', 'direction', 'gestionnaire')
      or (public.sf_role() = 'formateur' and public.sf_is_trainer_of(p_session))
    ),
    false)
$$;

-- Catalogue : lecture par l'équipe, écriture par les gestionnaires
create or replace function public.sf_catalog_read()
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    public.sf_role() = 'superadmin'
    or (public.sf_module_on() and public.sf_role() in ('admin', 'commercial', 'direction', 'formateur', 'gestionnaire', 'lecture')),
    false)
$$;

create or replace function public.sf_catalog_write()
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.sf_module_on() and public.sf_role() in ('superadmin', 'admin', 'direction', 'gestionnaire'), false)
$$;

-- Fichiers d'archive : <session_id>/<suivi|certification-sst>/<fichier>
create or replace function public.sf_archive_can(p_name text, p_write boolean)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_parts text[] := string_to_array(coalesce(p_name, ''), '/');
  v_session uuid;
  v_module text;
begin
  if array_length(v_parts, 1) is distinct from 3 then return false; end if;
  if v_parts[1] !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return false; end if;
  if coalesce(v_parts[3], '') = '' then return false; end if;
  v_session := v_parts[1]::uuid;
  v_module := case v_parts[2] when 'suivi' then 'suivi_formatif' when 'certification-sst' then 'prevention' else null end;
  if v_module is null then return false; end if;
  if p_write then return public.sf_can_write(v_session, v_module); end if;
  return public.sf_can_read(v_session, v_module);
end $$;

revoke all on function public.sf_role() from public, anon;
revoke all on function public.sf_module_on(text) from public, anon;
revoke all on function public.sf_is_trainer_of(uuid) from public, anon;
revoke all on function public.sf_can_read(uuid, text) from public, anon;
revoke all on function public.sf_can_write(uuid, text) from public, anon;
revoke all on function public.sf_catalog_read() from public, anon;
revoke all on function public.sf_catalog_write() from public, anon;
revoke all on function public.sf_archive_can(text, boolean) from public, anon;
grant execute on function public.sf_role() to authenticated, service_role;
grant execute on function public.sf_module_on(text) to authenticated, service_role;
grant execute on function public.sf_is_trainer_of(uuid) to authenticated, service_role;
grant execute on function public.sf_can_read(uuid, text) to authenticated, service_role;
grant execute on function public.sf_can_write(uuid, text) to authenticated, service_role;
grant execute on function public.sf_catalog_read() to authenticated, service_role;
grant execute on function public.sf_catalog_write() to authenticated, service_role;
grant execute on function public.sf_archive_can(text, boolean) to authenticated, service_role;

-- ── 3. Catalogue ──
alter table public.courses add column if not exists formative_enabled boolean not null default false;

create table if not exists public.course_sequences (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  position int not null default 0,
  title text not null,
  competences text[] not null default '{}',
  modality text not null default 'oral'
    check (modality in ('oral', 'qcm', 'etude_cas', 'mise_situation', 'demonstration', 'autre')),
  roles text[] not null default '{}',
  success_indicators text[] not null default '{}',
  duration_minutes int,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists course_sequences_course_idx on public.course_sequences (course_id, position);

-- ── 4. Sessions ──
create table if not exists public.session_sequences (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  source_sequence_id uuid references public.course_sequences(id) on delete set null,
  position int not null default 0,
  title text not null,
  competences text[] not null default '{}',
  modality text not null default 'oral'
    check (modality in ('oral', 'qcm', 'etude_cas', 'mise_situation', 'demonstration', 'autre')),
  roles text[] not null default '{}',
  success_indicators text[] not null default '{}',
  planned_date date,
  group_status text check (group_status in ('acquis', 'en_cours', 'a_revoir', 'non_observe')),
  group_remark text,
  group_updated_at timestamptz,
  closed_at timestamptz,
  closed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists session_sequences_session_idx on public.session_sequences (session_id, position);

create table if not exists public.formative_evaluations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  session_sequence_id uuid not null references public.session_sequences(id) on delete cascade,
  trainee_id uuid not null references public.trainees(id) on delete cascade,
  status text check (status in ('acquis', 'en_cours', 'a_revoir', 'non_observe')),
  role text,
  indicators_met text[] not null default '{}',
  remark text,
  evaluated_by uuid,
  client_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_sequence_id, trainee_id)
);
create index if not exists formative_evaluations_session_idx on public.formative_evaluations (session_id);
create index if not exists formative_evaluations_trainee_idx on public.formative_evaluations (trainee_id);

create table if not exists public.formative_sheets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  version int not null,
  file_path text not null,
  file_name text not null,
  content_hash text,
  reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (session_id, version)
);

-- Mises à jour horodatées
create or replace function public.sf_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists course_sequences_touch on public.course_sequences;
create trigger course_sequences_touch before update on public.course_sequences
  for each row execute function public.sf_touch_updated_at();
drop trigger if exists session_sequences_touch on public.session_sequences;
create trigger session_sequences_touch before update on public.session_sequences
  for each row execute function public.sf_touch_updated_at();
drop trigger if exists formative_evaluations_touch on public.formative_evaluations;
create trigger formative_evaluations_touch before update on public.formative_evaluations
  for each row execute function public.sf_touch_updated_at();

-- ── Règles d'accès ──
alter table public.course_sequences enable row level security;
alter table public.session_sequences enable row level security;
alter table public.formative_evaluations enable row level security;
alter table public.formative_sheets enable row level security;
revoke all on public.course_sequences, public.session_sequences, public.formative_evaluations, public.formative_sheets from anon;

drop policy if exists course_sequences_lire on public.course_sequences;
drop policy if exists course_sequences_creer on public.course_sequences;
drop policy if exists course_sequences_modifier on public.course_sequences;
drop policy if exists course_sequences_supprimer on public.course_sequences;
create policy course_sequences_lire on public.course_sequences for select to authenticated
  using ((select public.sf_catalog_read()));
create policy course_sequences_creer on public.course_sequences for insert to authenticated
  with check ((select public.sf_catalog_write()));
create policy course_sequences_modifier on public.course_sequences for update to authenticated
  using ((select public.sf_catalog_write())) with check ((select public.sf_catalog_write()));
create policy course_sequences_supprimer on public.course_sequences for delete to authenticated
  using ((select public.sf_catalog_write()));

drop policy if exists session_sequences_lire on public.session_sequences;
drop policy if exists session_sequences_creer on public.session_sequences;
drop policy if exists session_sequences_modifier on public.session_sequences;
drop policy if exists session_sequences_supprimer on public.session_sequences;
create policy session_sequences_lire on public.session_sequences for select to authenticated
  using (public.sf_can_read(session_id));
create policy session_sequences_creer on public.session_sequences for insert to authenticated
  with check (public.sf_can_write(session_id));
create policy session_sequences_modifier on public.session_sequences for update to authenticated
  using (public.sf_can_write(session_id)) with check (public.sf_can_write(session_id));
create policy session_sequences_supprimer on public.session_sequences for delete to authenticated
  using (public.sf_can_write(session_id));

drop policy if exists formative_evaluations_lire on public.formative_evaluations;
drop policy if exists formative_evaluations_creer on public.formative_evaluations;
drop policy if exists formative_evaluations_modifier on public.formative_evaluations;
drop policy if exists formative_evaluations_supprimer on public.formative_evaluations;
create policy formative_evaluations_lire on public.formative_evaluations for select to authenticated
  using (public.sf_can_read(session_id));
create policy formative_evaluations_creer on public.formative_evaluations for insert to authenticated
  with check (public.sf_can_write(session_id));
create policy formative_evaluations_modifier on public.formative_evaluations for update to authenticated
  using (public.sf_can_write(session_id)) with check (public.sf_can_write(session_id));
create policy formative_evaluations_supprimer on public.formative_evaluations for delete to authenticated
  using (public.sf_can_write(session_id));

-- Fiches archivées : lecture et ajout seulement, jamais de modification ni de suppression
drop policy if exists formative_sheets_lire on public.formative_sheets;
drop policy if exists formative_sheets_creer on public.formative_sheets;
create policy formative_sheets_lire on public.formative_sheets for select to authenticated
  using (public.sf_can_read(session_id));
create policy formative_sheets_creer on public.formative_sheets for insert to authenticated
  with check (public.sf_can_write(session_id));

grant select, insert, update, delete on public.course_sequences, public.session_sequences, public.formative_evaluations to authenticated;
grant select, insert on public.formative_sheets to authenticated;

-- ── 5. Fonctions ──

-- Copie les séquences du catalogue dans la session (une seule fois). Renvoie le nombre de séquences de la session.
create or replace function public.sf_init_session(p_session uuid)
returns int
language plpgsql security invoker set search_path = '' as $$
declare
  v_course uuid;
  v_n int;
begin
  if not public.sf_can_write(p_session) then
    raise exception 'Accès refusé au suivi formatif de cette session' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('sf_init_' || p_session::text));
  select count(*) into v_n from public.session_sequences where session_id = p_session;
  if v_n > 0 then return v_n; end if;
  select s.course_id into v_course from public.sessions s where s.id = p_session;
  if v_course is null then return 0; end if;
  insert into public.session_sequences (session_id, source_sequence_id, position, title, competences, modality, roles, success_indicators)
  select p_session, cs.id, cs.position, cs.title, cs.competences, cs.modality, cs.roles, cs.success_indicators
  from public.course_sequences cs
  where cs.course_id = v_course
  order by cs.position;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Enregistre une file de saisies faites sur le téléphone.
-- Élément « stagiaire » : { "type": "trainee", "session_sequence_id", "trainee_id", "status", "role",
--   "indicators_met": [], "remark", "clear": false, "client_updated_at" }
-- Élément « groupe »    : { "type": "group", "session_sequence_id", "group_status", "group_remark", "client_updated_at" }
-- Élément « clôture »   : { "type": "close", "session_sequence_id", "closed": true|false, "client_updated_at" }
-- Une saisie plus ancienne que la ligne en base est ignorée (deux téléphones, ou file rejouée).
create or replace function public.save_formative_batch(p_items jsonb)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  it jsonb;
  v_type text;
  v_seq uuid;
  v_session uuid;
  v_trainee uuid;
  v_at timestamptz;
  v_saved int := 0;
  v_ignored int := 0;
  v_existing timestamptz;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Liste de saisies attendue' using errcode = '22023';
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    v_type := coalesce(it->>'type', 'trainee');
    v_seq := (it->>'session_sequence_id')::uuid;
    v_at := coalesce((it->>'client_updated_at')::timestamptz, now());
    select ss.session_id into v_session from public.session_sequences ss where ss.id = v_seq;
    if v_session is null or not public.sf_can_write(v_session) then
      v_ignored := v_ignored + 1;
      continue;
    end if;

    if v_type = 'group' then
      update public.session_sequences
         set group_status = nullif(it->>'group_status', ''),
             group_remark = nullif(it->>'group_remark', ''),
             group_updated_at = v_at
       where id = v_seq and (group_updated_at is null or group_updated_at <= v_at);
      if found then v_saved := v_saved + 1; else v_ignored := v_ignored + 1; end if;

    elsif v_type = 'close' then
      update public.session_sequences
         set closed_at = case when coalesce((it->>'closed')::boolean, true) then coalesce(closed_at, v_at) else null end,
             closed_by = case when coalesce((it->>'closed')::boolean, true) then coalesce(closed_by, (select auth.uid())) else null end
       where id = v_seq;
      v_saved := v_saved + 1;

    else
      v_trainee := (it->>'trainee_id')::uuid;
      select fe.client_updated_at into v_existing
        from public.formative_evaluations fe
       where fe.session_sequence_id = v_seq and fe.trainee_id = v_trainee;
      if v_existing is not null and v_existing > v_at then
        v_ignored := v_ignored + 1;
        continue;
      end if;
      if coalesce((it->>'clear')::boolean, false) then
        delete from public.formative_evaluations where session_sequence_id = v_seq and trainee_id = v_trainee;
      else
        insert into public.formative_evaluations
          (session_id, session_sequence_id, trainee_id, status, role, indicators_met, remark, evaluated_by, client_updated_at)
        values (
          v_session, v_seq, v_trainee,
          nullif(it->>'status', ''),
          nullif(it->>'role', ''),
          coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(it->'indicators_met', '[]'::jsonb)) x), '{}'),
          nullif(it->>'remark', ''),
          (select auth.uid()),
          v_at)
        on conflict (session_sequence_id, trainee_id) do update
          set status = excluded.status,
              role = excluded.role,
              indicators_met = excluded.indicators_met,
              remark = excluded.remark,
              evaluated_by = excluded.evaluated_by,
              client_updated_at = excluded.client_updated_at;
      end if;
      v_saved := v_saved + 1;
    end if;
  end loop;
  return jsonb_build_object('saved', v_saved, 'ignored', v_ignored);
end $$;

-- Inscrit une fiche de suivi archivée et renvoie son numéro de version
create or replace function public.sf_register_sheet(p_session uuid, p_path text, p_name text, p_hash text, p_reason text)
returns int
language plpgsql security invoker set search_path = '' as $$
declare
  v_version int;
begin
  if not public.sf_can_write(p_session) then
    raise exception 'Accès refusé au suivi formatif de cette session' using errcode = '42501';
  end if;
  if p_path is null or split_part(p_path, '/', 1) <> p_session::text or split_part(p_path, '/', 2) <> 'suivi' then
    raise exception 'Chemin d''archive invalide' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('sf_sheet_' || p_session::text));
  select coalesce(max(version), 0) + 1 into v_version from public.formative_sheets where session_id = p_session;
  insert into public.formative_sheets (session_id, version, file_path, file_name, content_hash, reason, created_by)
  values (p_session, v_version, p_path, p_name, p_hash, nullif(p_reason, ''), (select auth.uid()));
  return v_version;
end $$;

revoke all on function public.sf_init_session(uuid) from public, anon;
revoke all on function public.save_formative_batch(jsonb) from public, anon;
revoke all on function public.sf_register_sheet(uuid, text, text, text, text) from public, anon;
grant execute on function public.sf_init_session(uuid) to authenticated;
grant execute on function public.save_formative_batch(jsonb) to authenticated;
grant execute on function public.sf_register_sheet(uuid, text, text, text, text) to authenticated;

-- ── 6. Archives : bucket privé, ni modification ni suppression ──
insert into storage.buckets (id, name, public) values ('archives-formation', 'archives-formation', false)
on conflict (id) do nothing;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'archives_formation_lire') then
    create policy archives_formation_lire on storage.objects for select to authenticated
      using (bucket_id = 'archives-formation' and public.sf_archive_can(name, false));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'archives_formation_deposer') then
    create policy archives_formation_deposer on storage.objects for insert to authenticated
      with check (bucket_id = 'archives-formation' and public.sf_archive_can(name, true));
  end if;
end $$;

insert into public.schema_migrations (version) values ('0250_suivi_formatif') on conflict (version) do nothing;

-- supabase/tests/droits_suivi_formatif.sql : tests de droits et de comportement du module Suivi formatif (0250).
--
-- Le script crée des comptes et des données d'essai, se fait passer pour chaque rôle
-- (set local role + request.jwt.claims), vérifie ce que chacun voit, modifie et appelle,
-- puis SE TERMINE TOUJOURS PAR UNE ERREUR VOLONTAIRE : rien n'est jamais enregistré.
-- Le message d'erreur contient le résultat, une ligne par test : OK ou ÉCHEC, puis le total.
--
-- Utilisation : placé après 0250 dans une même exécution (fichier essai_suivi_formatif_transaction_annulee.sql),
-- ou seul une fois 0250 appliquée.

create or replace function pg_temp.sf_essai(p_uid uuid, p_sql text)
returns text
language plpgsql as $f$
declare
  v_n bigint;
begin
  if p_uid is null then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform set_config('request.jwt.claim.sub', '', true);
    execute 'set local role anon';
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', p_uid::text, true);
    execute 'set local role authenticated';
  end if;
  execute p_sql into v_n;
  execute 'reset role';
  return v_n::text;
exception when others then
  return 'refus (' || sqlstate || ')';
end $f$;

do $test$
declare
  u_sa uuid := gen_random_uuid();  u_ges uuid := gen_random_uuid(); u_for uuid := gen_random_uuid();
  u_for2 uuid := gen_random_uuid(); u_com uuid := gen_random_uuid(); u_cpt uuid := gen_random_uuid();
  u_lec uuid := gen_random_uuid(); u_off uuid := gen_random_uuid();
  v_trainer uuid; v_trainer2 uuid; v_client uuid; v_course uuid; v_s1 uuid; v_s2 uuid; v_t1 uuid;
  v_seq1 uuid; v_seq2 uuid; v_prev_on boolean;
  r record; v_got text; v_ok boolean; v_lines text[] := '{}'; v_fail int := 0; v_total int := 0; v_uid uuid;
  v_before int; v_after int;
begin
  set local lock_timeout = '5s';

  -- Comptes ------------------------------------------------------------------------------------------
  insert into auth.users (id, email, aud, role)
  select x.id, x.email, 'authenticated', 'authenticated' from (values
    (u_sa, 'sf.sa@test.invalid'), (u_ges, 'sf.ges@test.invalid'), (u_for, 'sf.for@test.invalid'),
    (u_for2, 'sf.for2@test.invalid'), (u_com, 'sf.com@test.invalid'), (u_cpt, 'sf.cpt@test.invalid'),
    (u_lec, 'sf.lec@test.invalid'), (u_off, 'sf.off@test.invalid')) x(id, email);

  insert into public.trainers (first_name, last_name) values ('Essai', 'SUIVI') returning id into v_trainer;
  insert into public.trainers (first_name, last_name) values ('Essai', 'AUTRE') returning id into v_trainer2;

  if exists (select 1 from pg_trigger where tgname = 'profiles_protect_role') then
    execute 'alter table public.profiles disable trigger profiles_protect_role';
  end if;
  insert into public.profiles (id, email, role, is_active, trainer_id)
  select x.id, x.email, x.role, x.active, x.trainer from (values
    (u_sa, 'sf.sa@test.invalid', 'superadmin', true, null::uuid), (u_ges, 'sf.ges@test.invalid', 'gestionnaire', true, null),
    (u_for, 'sf.for@test.invalid', 'formateur', true, v_trainer), (u_for2, 'sf.for2@test.invalid', 'formateur', true, v_trainer2),
    (u_com, 'sf.com@test.invalid', 'commercial', true, null), (u_cpt, 'sf.cpt@test.invalid', 'comptable', true, null),
    (u_lec, 'sf.lec@test.invalid', 'lecture', true, null), (u_off, 'sf.off@test.invalid', 'direction', false, null)) x(id, email, role, active, trainer)
  on conflict (id) do update set role = excluded.role, is_active = excluded.is_active, trainer_id = excluded.trainer_id;
  if exists (select 1 from pg_trigger where tgname = 'profiles_protect_role') then
    execute 'alter table public.profiles enable trigger profiles_protect_role';
  end if;

  -- Données ------------------------------------------------------------------------------------------
  insert into public.clients (name) values ('Essai suivi formatif') returning id into v_client;
  insert into public.courses (title, code) values ('Essai SST suivi formatif', 'ESSAI-SF') returning id into v_course;
  insert into public.course_sequences (course_id, position, title, competences, modality, roles)
  values (v_course, 1, 'Protéger', '{C2}', 'mise_situation', '{Sauveteur,Victime,Témoin}'),
         (v_course, 2, 'Le SST, cadre juridique', '{C1}', 'oral', '{}');
  insert into public.sessions (course_id, start_date, end_date, trainer_id, client_id, attendance_token)
  values (v_course, current_date, current_date, v_trainer, v_client, 'essai-' || replace(gen_random_uuid()::text, '-', ''))
  returning id into v_s1;
  insert into public.sessions (course_id, start_date, end_date, trainer_id, client_id, attendance_token)
  values (v_course, current_date, current_date, v_trainer2, v_client, 'essai-' || replace(gen_random_uuid()::text, '-', ''))
  returning id into v_s2;
  insert into public.trainees (first_name, last_name, client_id) values ('Essai', 'STAGIAIRE', v_client) returning id into v_t1;
  insert into public.session_trainees (session_id, trainee_id) values (v_s1, v_t1), (v_s2, v_t1);

  select enabled into v_prev_on from public.org_modules where key = 'suivi_formatif';

  -- Phase A : module coupé ---------------------------------------------------------------------------
  update public.org_modules set enabled = false where key = 'suivi_formatif';
  for r in
    select * from (values
      ('A', u_ges, 'gestionnaire ne lit pas le catalogue, module coupé', format('select count(*) from public.course_sequences where course_id = %L', v_course), '=0'),
      ('A', u_sa, 'superadmin lit le catalogue, module coupé', format('select count(*) from public.course_sequences where course_id = %L', v_course), '=2'),
      ('A', u_for, 'formateur ne prépare pas sa session, module coupé', format('select public.sf_init_session(%L)', v_s1), 'refus'),
      ('A', u_ges, 'gestionnaire ne crée pas de séquence, module coupé', format('with x as (insert into public.course_sequences (course_id, title) values (%L, ''x'') returning 1) select count(*) from x', v_course), 'refus')
    ) t(phase, who, label, sql, expect)
  loop
    v_got := pg_temp.sf_essai(r.who, r.sql);
    v_ok := case when r.expect = 'refus' then v_got like 'refus%' when r.expect like '=%' then v_got = substr(r.expect, 2) else false end;
    v_total := v_total + 1; if not v_ok then v_fail := v_fail + 1; end if;
    v_lines := v_lines || format('%s  %s %-60s attendu %-6s obtenu %s', case when v_ok then 'OK   ' else 'ÉCHEC' end, r.phase, r.label, r.expect, v_got);
  end loop;

  -- Phase B : module actif ---------------------------------------------------------------------------
  update public.org_modules set enabled = true where key = 'suivi_formatif';
  for r in
    select * from (values
      ('B', null::uuid, 'anonyme ne lit pas le catalogue', 'select count(*) from public.course_sequences', 'refus'),
      ('B', u_ges, 'gestionnaire lit le catalogue', format('select count(*) from public.course_sequences where course_id = %L', v_course), '=2'),
      ('B', u_for, 'formateur lit le catalogue', format('select count(*) from public.course_sequences where course_id = %L', v_course), '=2'),
      ('B', u_for, 'formateur ne crée pas de séquence au catalogue', format('with x as (insert into public.course_sequences (course_id, title) values (%L, ''x'') returning 1) select count(*) from x', v_course), 'refus'),
      ('B', u_ges, 'gestionnaire crée une séquence au catalogue', format('with x as (insert into public.course_sequences (course_id, position, title, competences, modality) values (%L, 3, ''Examiner'', ''{C3}'', ''mise_situation'') returning 1) select count(*) from x', v_course), '=1'),
      ('B', u_off, 'compte désactivé ne lit rien', format('select count(*) from public.course_sequences where course_id = %L', v_course), '=0'),
      ('B', u_for, 'formateur prépare sa session (3 séquences)', format('select public.sf_init_session(%L)', v_s1), '=3'),
      ('B', u_for, 'deuxième préparation sans doublon', format('select public.sf_init_session(%L)', v_s1), '=3'),
      ('B', u_for, 'formateur ne prépare pas la session d''un autre', format('select public.sf_init_session(%L)', v_s2), 'refus'),
      ('B', u_ges, 'gestionnaire prépare l''autre session', format('select public.sf_init_session(%L)', v_s2), '=3'),
      ('B', u_for, 'formateur ne voit pas les séquences de l''autre session', format('select count(*) from public.session_sequences where session_id = %L', v_s2), '=0'),
      ('B', u_for2, 'autre formateur voit sa session', format('select count(*) from public.session_sequences where session_id = %L', v_s2), '=3')
    ) t(phase, who, label, sql, expect)
  loop
    v_got := pg_temp.sf_essai(r.who, r.sql);
    v_ok := case when r.expect = 'refus' then v_got like 'refus%' when r.expect like '=%' then v_got = substr(r.expect, 2) else false end;
    v_total := v_total + 1; if not v_ok then v_fail := v_fail + 1; end if;
    v_lines := v_lines || format('%s  %s %-60s attendu %-6s obtenu %s', case when v_ok then 'OK   ' else 'ÉCHEC' end, r.phase, r.label, r.expect, v_got);
  end loop;

  select id into v_seq1 from public.session_sequences where session_id = v_s1 and position = 1;
  select id into v_seq2 from public.session_sequences where session_id = v_s2 and position = 1;

  -- Phase C : saisies, versions, archives ------------------------------------------------------------
  for r in
    select * from (values
      ('C', u_for, 'formateur enregistre groupe + stagiaire', format($q$select (public.save_formative_batch(jsonb_build_array(
          jsonb_build_object('type','group','session_sequence_id',%L,'group_status','acquis','client_updated_at','2026-10-21T10:00:00Z'),
          jsonb_build_object('type','trainee','session_sequence_id',%L,'trainee_id',%L,'status','a_revoir','role','Sauveteur','indicators_met',jsonb_build_array('Protège'),'remark','À reprendre','client_updated_at','2026-10-21T10:01:00Z')))->>'saved')::bigint$q$, v_seq1, v_seq1, v_t1), '=2'),
      ('C', u_for, 'saisie plus ancienne ignorée', format($q$select (public.save_formative_batch(jsonb_build_array(
          jsonb_build_object('type','trainee','session_sequence_id',%L,'trainee_id',%L,'status','acquis','client_updated_at','2026-10-21T09:00:00Z')))->>'ignored')::bigint$q$, v_seq1, v_t1), '=1'),
      ('C', u_for, 'la saisie la plus récente reste', format('select count(*) from public.formative_evaluations where session_sequence_id = %L and status = ''a_revoir''', v_seq1), '=1'),
      ('C', u_for, 'formateur ne saisit pas dans l''autre session', format($q$select (public.save_formative_batch(jsonb_build_array(
          jsonb_build_object('type','trainee','session_sequence_id',%L,'trainee_id',%L,'status','acquis')))->>'ignored')::bigint$q$, v_seq2, v_t1), '=1'),
      ('C', u_lec, 'lecture voit la saisie', format('select count(*) from public.formative_evaluations where session_id = %L', v_s1), '=1'),
      ('C', u_lec, 'lecture n''écrit pas', format('with x as (insert into public.formative_evaluations (session_id, session_sequence_id, trainee_id, status) values (%L, %L, %L, ''acquis'') returning 1) select count(*) from x', v_s2, v_seq2, v_t1), 'refus'),
      ('C', u_com, 'commercial voit la saisie', format('select count(*) from public.formative_evaluations where session_id = %L', v_s1), '=1'),
      ('C', u_cpt, 'comptable ne voit pas la saisie', format('select count(*) from public.formative_evaluations where session_id = %L', v_s1), '=0'),
      ('C', u_for2, 'autre formateur ne voit pas la saisie', format('select count(*) from public.formative_evaluations where session_id = %L', v_s1), '=0'),
      ('C', u_for, 'clôture de la séquence', format($q$select (public.save_formative_batch(jsonb_build_array(jsonb_build_object('type','close','session_sequence_id',%L,'closed',true)))->>'saved')::bigint$q$, v_seq1), '=1'),
      ('C', u_for, 'première fiche archivée : version 1', format('select public.sf_register_sheet(%L, %L, ''fiche.pdf'', ''abc'', null)', v_s1, v_s1 || '/suivi/fiche-v1.pdf'), '=1'),
      ('C', u_for, 'deuxième fiche : version 2', format('select public.sf_register_sheet(%L, %L, ''fiche.pdf'', ''def'', ''Correction'')', v_s1, v_s1 || '/suivi/fiche-v2.pdf'), '=2'),
      ('C', u_for, 'chemin d''archive hors session refusé', format('select public.sf_register_sheet(%L, %L, ''fiche.pdf'', ''x'', null)', v_s1, v_s2 || '/suivi/fiche.pdf'), 'refus'),
      ('C', u_ges, 'fiche archivée non modifiable', format('with x as (update public.formative_sheets set file_name = ''x'' where session_id = %L returning 1) select count(*) from x', v_s1), 'refus'),
      ('C', u_sa, 'fiche archivée non supprimable', format('with x as (delete from public.formative_sheets where session_id = %L returning 1) select count(*) from x', v_s1), 'refus'),
      ('C', u_for, 'archive de sa session : dépôt permis', format('select case when public.sf_archive_can(%L, true) then 1 else 0 end', v_s1 || '/suivi/a.pdf'), '=1'),
      ('C', u_for, 'archive d''une autre session : dépôt refusé', format('select case when public.sf_archive_can(%L, true) then 1 else 0 end', v_s2 || '/suivi/a.pdf'), '=0'),
      ('C', u_for, 'grille SST de sa session : dépôt permis', format('select case when public.sf_archive_can(%L, true) then 1 else 0 end', v_s1 || '/certification-sst/g.pdf'), '=1'),
      ('C', u_lec, 'lecture lit une grille SST archivée', format('select case when public.sf_archive_can(%L, false) then 1 else 0 end', v_s1 || '/certification-sst/g.pdf'), '=1'),
      ('C', u_lec, 'lecture ne dépose pas', format('select case when public.sf_archive_can(%L, true) then 1 else 0 end', v_s1 || '/suivi/a.pdf'), '=0'),
      ('C', u_ges, 'chemin mal formé refusé', 'select case when public.sf_archive_can(''pas-un-uuid/suivi/a.pdf'', true) then 1 else 0 end', '=0'),
      ('C', u_ges, 'dossier inconnu refusé', format('select case when public.sf_archive_can(%L, true) then 1 else 0 end', v_s1 || '/autre/a.pdf'), '=0'),
      ('C', u_ges, 'sous-dossier en trop refusé', format('select case when public.sf_archive_can(%L, true) then 1 else 0 end', v_s1 || '/suivi/x/a.pdf'), '=0'),
      ('C', null::uuid, 'anonyme ne lit aucune archive', 'select count(*) from storage.objects where bucket_id = ''archives-formation''', 'refus_ou_0')
    ) t(phase, who, label, sql, expect)
  loop
    v_got := pg_temp.sf_essai(r.who, r.sql);
    v_ok := case when r.expect = 'refus' then v_got like 'refus%'
                 when r.expect = 'refus_ou_0' then v_got like 'refus%' or v_got = '0'
                 when r.expect like '=%' then v_got = substr(r.expect, 2) else false end;
    v_total := v_total + 1; if not v_ok then v_fail := v_fail + 1; end if;
    v_lines := v_lines || format('%s  %s %-60s attendu %-6s obtenu %s', case when v_ok then 'OK   ' else 'ÉCHEC' end, r.phase, r.label, r.expect, v_got);
  end loop;

  -- Phase D : effacement d'une session -----------------------------------------------------------------
  select count(*) into v_before from public.session_sequences where session_id = v_s1;
  delete from public.session_trainees where session_id = v_s1;
  delete from public.sessions where id = v_s1;
  select count(*) into v_after from public.session_sequences where session_id = v_s1;
  v_ok := v_before = 3 and v_after = 0
          and not exists (select 1 from public.formative_evaluations where session_id = v_s1)
          and not exists (select 1 from public.formative_sheets where session_id = v_s1);
  v_total := v_total + 1; if not v_ok then v_fail := v_fail + 1; end if;
  v_lines := v_lines || format('%s  D %-60s avant %s après %s', case when v_ok then 'OK   ' else 'ÉCHEC' end, 'session effacée : séquences, saisies et registre suivent', v_before, v_after);

  -- Rien d'existant n'a bougé
  v_ok := (select count(*) from pg_policies where schemaname = 'public' and tablename = 'sst_certifications') > 0
          and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'trainee_objectives') > 0;
  v_total := v_total + 1; if not v_ok then v_fail := v_fail + 1; end if;
  v_lines := v_lines || format('%s  D %-60s', case when v_ok then 'OK   ' else 'ÉCHEC' end, 'règles de sst_certifications et trainee_objectives toujours là');

  update public.org_modules set enabled = coalesce(v_prev_on, false) where key = 'suivi_formatif';

  raise exception E'RÉSULTAT DES TESTS SUIVI FORMATIF (tout est annulé)\n%\n\n% test(s), % échec(s)',
    array_to_string(v_lines, E'\n'), v_total, v_fail;
end
$test$;
