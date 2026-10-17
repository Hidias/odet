-- 0260_retours_post_it.sql : retours des utilisateurs, version simple (post-it toujours visible).
--
-- Chaque utilisateur interne note ce qu'il veut dans un post-it ; « Envoyer » enregistre le texte ici.
-- Le super administrateur lit et traite les retours dans la Console.
-- Lecture et écriture uniquement par le serveur (route /api/retours, clé de service) :
-- aucune règle d'accès, aucun droit pour anon ni pour les comptes connectés.
-- La table est donc sans effet sur les règles du chantier 2 (0082 ne crée aucune règle pour une table non listée).
-- company_id : facultatif, sans clé étrangère (le socle multi-sociétés C1 posera la clé).
-- Migration additive : aucune donnée existante n'est modifiée. Retour arrière : supabase/rollback/0260_retours_post_it_retour.sql

create table if not exists public.user_feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  company_id uuid,
  author_id uuid not null,
  author_label text,
  page_path text,
  page_title text,
  viewport text,
  message text not null check (char_length(message) between 1 and 4000),
  status text not null default 'nouveau' check (status in ('nouveau', 'fait', 'ecarte')),
  handled_at timestamptz,
  handled_by uuid
);

comment on table public.user_feedback is 'Retours des utilisateurs (post-it) : lus et écrits seulement par le serveur (/api/retours)';

create index if not exists user_feedback_created_idx on public.user_feedback (created_at desc);

alter table public.user_feedback enable row level security;
revoke all on table public.user_feedback from anon, authenticated;

insert into public.schema_migrations (version) values ('0260_retours_post_it') on conflict (version) do nothing;
