-- 0476 : attestation de fin de formation (chantier formation S12, lot 1a, décision de H du 29/10).
-- Document remis au stagiaire, distinct du certificat de réalisation : objectifs de la formation et résultat de
-- l'évaluation des acquis, objectif par objectif. Il est figé comme les autres documents émis (0399) : une
-- correction ajoute une version datée du jour, avec motif. Les objectifs et leur résultat sont gardés avec la
-- version émise, pour que les espaces extérieurs servent exactement ce qui a été remis.
-- 1. training_documents_issued : type « fin_formation », colonne objectives (liste figée), cohérence.
-- 2. Portail client et espace entreprise : la liste figée sort avec la version émise (mêmes droits que 0400).
-- 3. Espace stagiaire : stg_documents_emis(), ses seules versions émises (aucun motif, aucun auteur).
-- Additive. Idempotente. Retour arrière : supabase/rollback/0476_attestation_fin_formation_retour.sql

-- ── 1. Type et liste figée ──
alter table public.training_documents_issued drop constraint if exists training_documents_issued_kind_check;
alter table public.training_documents_issued add constraint training_documents_issued_kind_check
  check (kind in ('certificat', 'attestation', 'fin_formation'));

alter table public.training_documents_issued add column if not exists objectives jsonb;
alter table public.training_documents_issued drop constraint if exists training_documents_issued_objectives_check;
alter table public.training_documents_issued add constraint training_documents_issued_objectives_check
  check (objectives is null or (jsonb_typeof(objectives) = 'array' and jsonb_array_length(objectives) between 1 and 60));
-- Une attestation de fin de formation porte toujours un résultat global et ses objectifs
alter table public.training_documents_issued drop constraint if exists training_documents_issued_fin_check;
alter table public.training_documents_issued add constraint training_documents_issued_fin_check
  check (kind <> 'fin_formation' or (objectives is not null and result is not null and result in ('acquired', 'not_acquired')));

comment on table public.training_documents_issued is 'Versions émises des certificats de réalisation, attestations de présence et attestations de fin de formation (une correction ajoute une version)';
comment on column public.training_documents_issued.objectives is 'Attestation de fin de formation : objectifs et résultat de chacun tels que remis, [{"texte", "acquis": true|false|null}]';

-- ── 2. Portails : la liste figée accompagne la version émise ──
create or replace function public.client_portal_documents_emis(p_token text, p_code text)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  with vis as (
    select (s->>'id')::uuid as sid, (st->>'trainee_id')::uuid as tid
    from jsonb_array_elements(coalesce(public.client_portal_data(p_token, p_code)->'sessions', '[]'::jsonb)) s,
         jsonb_array_elements(coalesce(s->'session_trainees', '[]'::jsonb)) st
  )
  select coalesce(jsonb_agg(jsonb_build_object('session_id', d.session_id, 'trainee_id', d.trainee_id, 'kind', d.kind,
      'version', d.version, 'issued_on', d.issued_on, 'hours', d.hours, 'result', d.result, 'absences', d.absences,
      'objectives', d.objectives)
    order by d.session_id, d.trainee_id, d.kind, d.version), '[]'::jsonb)
  from public.training_documents_issued d
  join vis on vis.sid = d.session_id and vis.tid = d.trainee_id
$$;
revoke all on function public.client_portal_documents_emis(text, text) from public;
grant execute on function public.client_portal_documents_emis(text, text) to anon, authenticated;

create or replace function public.ent_documents_emis()
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  with vis as (
    select (s->>'id')::uuid as sid, (st->>'trainee_id')::uuid as tid
    from jsonb_array_elements(coalesce(public.ent_sessions()->'sessions', '[]'::jsonb)) s,
         jsonb_array_elements(coalesce(s->'session_trainees', '[]'::jsonb)) st
  )
  select coalesce(jsonb_agg(jsonb_build_object('session_id', d.session_id, 'trainee_id', d.trainee_id, 'kind', d.kind,
      'version', d.version, 'issued_on', d.issued_on, 'hours', d.hours, 'result', d.result, 'absences', d.absences,
      'objectives', d.objectives)
    order by d.session_id, d.trainee_id, d.kind, d.version), '[]'::jsonb)
  from public.training_documents_issued d
  join vis on vis.sid = d.session_id and vis.tid = d.trainee_id
$$;
revoke all on function public.ent_documents_emis() from public, anon;
grant execute on function public.ent_documents_emis() to authenticated;

-- ── 3. Espace stagiaire : ses versions émises ──
-- Il recalculait ses documents : les heures pouvaient différer de celles remises. Même périmètre que stg_sessions
-- (ses inscriptions) ; app.stg_stagiaire() refuse tout compte qui n'est pas un stagiaire actif relié à sa fiche.
create or replace function public.stg_documents_emis()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('session_id', d.session_id, 'trainee_id', d.trainee_id, 'kind', d.kind,
      'version', d.version, 'issued_on', d.issued_on, 'hours', d.hours, 'result', d.result, 'absences', d.absences,
      'objectives', d.objectives)
    order by d.session_id, d.kind, d.version), '[]'::jsonb)
  from public.training_documents_issued d
  join public.session_trainees st on st.session_id = d.session_id and st.trainee_id = d.trainee_id
  where d.trainee_id = app.stg_stagiaire()
$$;
revoke all on function public.stg_documents_emis() from public, anon;
grant execute on function public.stg_documents_emis() to authenticated;

insert into public.schema_migrations (version) values ('0476_attestation_fin_formation') on conflict (version) do nothing;
