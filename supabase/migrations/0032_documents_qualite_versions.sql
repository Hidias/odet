-- 0032_documents_qualite_versions.sql : nouveau modèle des documents qualité.
--
-- 1. Versions validées des documents qualité (procédures, règlement intérieur, livrets, CGV, chartes...).
--    Le document en cours de travail reste dans quality_documents (content.model = 'rich') ; chaque
--    validation fige une copie ici, avec la date, le valideur et le motif. Les versions ne se modifient
--    pas et ne s'effacent pas depuis l'application : aucune règle d'accès n'est donnée pour cela.
--    Validation réservée aux rôles superadmin, admin et direction.
-- 2. Suppléant de chaque rôle qualité (exigé pour le référent signalements et le référent handicap).
-- 3. Libellés de deux rôles alignés sur les procédures : « Référent données personnelles » (le titre de
--    délégué à la protection des données est une désignation officielle déclarée à la CNIL) et
--    « Référent pédagogique ». Les codes ne changent pas : les champs {{role.*}} restent valables.

-- ── 1. Versions validées ──
create table if not exists public.quality_doc_versions (
  id uuid primary key default gen_random_uuid(),
  doc_id varchar not null,
  version integer not null check (version > 0),
  content jsonb not null,
  motif text,
  validated_by uuid,
  validated_by_name text,
  validated_at timestamptz not null default now(),
  next_review date,
  unique (doc_id, version)
);
create index if not exists quality_doc_versions_doc_idx on public.quality_doc_versions (doc_id, version desc);

alter table public.quality_doc_versions enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'quality_doc_versions' and policyname = 'quality_doc_versions_select') then
    create policy quality_doc_versions_select on public.quality_doc_versions for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'quality_doc_versions' and policyname = 'quality_doc_versions_insert') then
    create policy quality_doc_versions_insert on public.quality_doc_versions for insert to authenticated
      with check (coalesce(public.current_profile_role() in ('superadmin', 'admin', 'direction'), false));
  end if;
end $$;
grant select, insert on public.quality_doc_versions to authenticated;

-- ── 2. Suppléants ──
alter table public.quality_roles add column if not exists deputy_profile_id uuid;

-- ── 3. Libellés ──
update public.quality_roles set label = 'Référent données personnelles', updated_at = now()
 where code = 'referent_rgpd' and label = 'Délégué à la protection des données (RGPD)';
update public.quality_roles set label = 'Référent pédagogique', updated_at = now()
 where code = 'validation_programmes' and label = 'Validation des programmes';

insert into public.schema_migrations (version) values ('0032_documents_qualite_versions') on conflict (version) do nothing;

-- Désignation déjà enregistrée sous l'ancien intitulé « DPO » : même libellé que le rôle
update public.quality_documents
   set content = jsonb_set(content, '{role}', '"Référent données personnelles"'), name = 'Désignation Référent données personnelles', updated_at = now()
 where doc_id = 'des-rgpd' and content->>'role' = 'DPO';
