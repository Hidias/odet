-- 0263_retours_suivi.sql : suivi des retours des utilisateurs (chantier A, évolution du post-it de 0260).
--
-- Un seul circuit : la table user_feedback (0260) reste lue et écrite seulement par le serveur (/api/retours,
-- clé de service) ; aucune règle d'accès, aucun droit pour anon ni pour les comptes connectés.
-- 1. user_feedback : type (problème, idée, question ; vide = remarque libre d'avant), gravité ressentie,
--    capture facultative (chemin dans le bucket privé « retours »), statuts nouveau, vu, en cours, fait, écarté,
--    réponse visible par l'auteur (date de lecture), lien vers l'entrée « Quoi de neuf » qui règle le retour.
-- 2. Bucket privé « retours » (captures compressées, 3 Mo au plus, images seulement) : aucune règle de stockage,
--    donc seul le serveur y lit et écrit ; les captures ne sortent jamais de l'outil (lien signé de courte durée).
-- 3. Droit « organisation.retours.suivre » (module « retours ») : lire tous les retours, voir les captures, changer
--    le statut, répondre. Donné aux modèles super administrateur et administrateur, et aux copies de société du
--    modèle administrateur (un nouveau droit ne doit pas manquer à une société qui a personnalisé ce profil).
--    Sans ce droit, un compte ne voit que ses propres retours.
-- Traitement à inscrire au registre RGPD (chantier F) : retours des utilisateurs internes (texte, page, taille
-- d'écran, capture facultative), conservés pour l'amélioration de l'outil.
-- Migration additive : aucune ligne existante n'est modifiée. Idempotente.
-- Retour arrière : supabase/rollback/0263_retours_suivi_retour.sql

-- ── 1. Colonnes ──
alter table public.user_feedback add column if not exists kind text;
alter table public.user_feedback add column if not exists severity text;
alter table public.user_feedback add column if not exists screenshot_path text;
alter table public.user_feedback add column if not exists response text;
alter table public.user_feedback add column if not exists responded_at timestamptz;
alter table public.user_feedback add column if not exists responded_by uuid;
alter table public.user_feedback add column if not exists response_read_at timestamptz;
alter table public.user_feedback add column if not exists notice_id uuid;
alter table public.user_feedback add column if not exists updated_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_feedback_kind_check') then
    alter table public.user_feedback add constraint user_feedback_kind_check
      check (kind is null or kind in ('probleme', 'idee', 'question'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_feedback_severity_check') then
    alter table public.user_feedback add constraint user_feedback_severity_check
      check (severity is null or severity in ('faible', 'genant', 'bloquant'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_feedback_response_check') then
    alter table public.user_feedback add constraint user_feedback_response_check
      check (response is null or char_length(response) <= 4000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_feedback_notice_fk') then
    alter table public.user_feedback add constraint user_feedback_notice_fk
      foreign key (notice_id) references public.platform_notices(id) on delete set null;
  end if;
end $$;

alter table public.user_feedback drop constraint if exists user_feedback_status_check;
alter table public.user_feedback add constraint user_feedback_status_check
  check (status in ('nouveau', 'vu', 'en_cours', 'fait', 'ecarte'));

create index if not exists user_feedback_author_idx on public.user_feedback (author_id, created_at desc);

comment on table public.user_feedback is 'Retours des utilisateurs (post-it) : lus et écrits seulement par le serveur (/api/retours) ; captures dans le bucket privé « retours »';

-- ── 2. Bucket privé des captures ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('retours', 'retours', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- ── 3. Droit de suivi ──
insert into public.permissions (code, module, label, description, data_scope, own_scope, shows_prices,
  full_license_only, platform_only, position) values
  ('organisation.retours.suivre', 'retours', 'Suivre les retours des utilisateurs', 'Lire tous les retours (post-it), voir les captures, changer leur statut et répondre à l''auteur ; chacun voit toujours ses propres retours', 'user_feedback (par le serveur, /api/retours)', false, false, false, false, 1360)
on conflict (code) do update set module = excluded.module, label = excluded.label,
  description = excluded.description, data_scope = excluded.data_scope, updated_at = now();

insert into public.permission_profile_rights (profile_id, right_code)
select p.id, 'organisation.retours.suivre' from public.permission_profiles p
where (p.company_id is null and p.key in ('superadmin', 'admin'))
   or (p.company_id is not null and p.key = 'admin')
on conflict do nothing;

insert into public.schema_migrations (version) values ('0263_retours_suivi') on conflict (version) do nothing;
