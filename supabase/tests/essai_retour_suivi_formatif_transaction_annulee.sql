-- Essai du retour arrière de 0250 en transaction annulée : migration, retour arrière, contrôle qu'il ne reste rien.
-- Se termine TOUJOURS par l'erreur volontaire « RÉSULTAT RETOUR SUIVI FORMATIF » : rien n'est enregistré.

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

-- Retour arrière de 0250_suivi_formatif.sql (module Suivi formatif et archives de formation).
-- À coller dans l'éditeur SQL de Supabase. Efface les séquences du catalogue et des sessions, les saisies du
-- suivi formatif, le registre des fiches archivées et la colonne courses.formative_enabled.
-- Les fichiers déjà déposés dans le bucket « archives-formation » ne sont PAS effacés (archives) : le bucket et ses
-- fichiers restent, seules ses deux règles sont retirées (plus personne ne peut les lire depuis l'application).
-- Les grilles de certification SST déjà archivées gardent leur adresse dans sst_certifications.pdf_url.
-- Rien d'autre n'est touché.


drop policy if exists archives_formation_lire on storage.objects;
drop policy if exists archives_formation_deposer on storage.objects;

drop function if exists public.sf_register_sheet(uuid, text, text, text, text);
drop function if exists public.save_formative_batch(jsonb);
drop function if exists public.sf_init_session(uuid);

drop table if exists public.formative_sheets;
drop table if exists public.formative_evaluations;
drop table if exists public.session_sequences;
drop table if exists public.course_sequences;

drop function if exists public.sf_touch_updated_at();

alter table public.courses drop column if exists formative_enabled;

drop function if exists public.sf_archive_can(text, boolean);
drop function if exists public.sf_catalog_write();
drop function if exists public.sf_catalog_read();
drop function if exists public.sf_can_write(uuid, text);
drop function if exists public.sf_can_read(uuid, text);
drop function if exists public.sf_is_trainer_of(uuid);
drop function if exists public.sf_module_on(text);
drop function if exists public.sf_role();

delete from public.org_modules where key = 'suivi_formatif';
delete from public.schema_migrations where version = '0250_suivi_formatif';


do $chk$
declare v text;
begin
  v := format('tables=%s fonctions=%s colonne=%s module=%s regles_stockage=%s migration=%s',
    (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('course_sequences','session_sequences','formative_evaluations','formative_sheets')),
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'sf\_%' or p.proname = 'save_formative_batch')),
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'courses' and column_name = 'formative_enabled'),
    (select count(*) from public.org_modules where key = 'suivi_formatif'),
    (select count(*) from pg_policies where schemaname = 'storage' and policyname like 'archives_formation%'),
    (select count(*) from public.schema_migrations where version = '0250_suivi_formatif'));
  raise exception 'RÉSULTAT RETOUR SUIVI FORMATIF (tout est annulé ; attendu partout 0) : %', v;
end $chk$;
