-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (vr_0458) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0458_validation_reservee.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0458_validation_reservee_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0458_validation_reservee.sql =====
-- 0458 : validation réservée (demande de H du 24/10). Pour les documents choisis (les conditions générales chez GLD),
-- seules les personnes désignées valident une version. Une autre personne qui clique sur « Valider » envoie une demande
-- de confirmation ; la version n'entre en vigueur qu'après la confirmation d'une personne désignée. La demande n'est
-- notifiée qu'aux personnes désignées : le demandeur ne sait pas qui confirme.
--   1. doc_review_settings.validateurs (personnes désignées) et docs_reserves (documents concernés).
--   2. app.validation_reservee, app.peut_valider_ce_doc.
--   3. Gardes : une version (quality_doc_versions) et le passage d'un document au statut « valide » (quality_documents)
--      sont refusés aux autres ; le réglage ne se change que par une personne désignée ou le super administrateur.
--   4. public.validation_reservee_regler, public.demander_validation (notification réservée aux personnes désignées).
--   5. Notifications : audience « profils » (metadata.profils), visible des seules personnes listées.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0458_validation_reservee_retour.sql

alter table public.doc_review_settings add column if not exists validateurs uuid[] not null default '{}';
alter table public.doc_review_settings add column if not exists docs_reserves text[] not null default '{}';
comment on column public.doc_review_settings.validateurs is 'Personnes qui seules valident les documents réservés (vide : toute personne qui valide les documents)';
comment on column public.doc_review_settings.docs_reserves is 'Documents (doc_id) dont la validation est réservée aux validateurs';

create or replace function app.validation_reservee(p_company uuid, p_doc_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select cardinality(s.validateurs) > 0 and p_doc_id = any(s.docs_reserves)
                   from public.doc_review_settings s where s.company_id = p_company), false)
$$;
revoke all on function app.validation_reservee(uuid, text) from public, anon;
grant execute on function app.validation_reservee(uuid, text) to authenticated;

create or replace function app.peut_valider_ce_doc(p_company uuid, p_doc_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not app.validation_reservee(p_company, p_doc_id)
      or app.is_superadmin()
      or coalesce((select (select auth.uid()) = any(s.validateurs) from public.doc_review_settings s where s.company_id = p_company), false)
$$;
revoke all on function app.peut_valider_ce_doc(uuid, text) from public, anon;
grant execute on function app.peut_valider_ce_doc(uuid, text) to authenticated;

-- ── 3. Gardes ──
create or replace function app.doc_version_reservee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.peut_valider_ce_doc(coalesce(new.company_id, app.company_default()), new.doc_id) then
    raise exception 'La validation de ce document est confirmée par une seconde personne : envoyez votre demande depuis la fiche du document' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function app.doc_version_reservee() from public, anon, authenticated;
drop trigger if exists quality_doc_versions_reserve on public.quality_doc_versions;
create trigger quality_doc_versions_reserve before insert on public.quality_doc_versions for each row execute function app.doc_version_reservee();

create or replace function app.doc_statut_reserve()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.content->>'status' = 'valide'
     and (tg_op = 'INSERT' or old.content->>'status' is distinct from 'valide' or old.content->>'version' is distinct from new.content->>'version')
     and not app.peut_valider_ce_doc(coalesce(new.company_id, app.company_default()), new.doc_id) then
    raise exception 'La validation de ce document est confirmée par une seconde personne : envoyez votre demande depuis la fiche du document' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function app.doc_statut_reserve() from public, anon, authenticated;
drop trigger if exists quality_documents_reserve on public.quality_documents;
create trigger quality_documents_reserve before insert or update on public.quality_documents for each row execute function app.doc_statut_reserve();

create or replace function app.doc_review_settings_reserve()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if tg_op = 'UPDATE' and (new.validateurs, new.docs_reserves) is not distinct from (old.validateurs, old.docs_reserves) then return new; end if;
  if tg_op = 'INSERT' and cardinality(new.validateurs) = 0 and cardinality(new.docs_reserves) = 0 then return new; end if;
  if not (app.is_superadmin()
          or (tg_op = 'UPDATE' and v_uid = any(old.validateurs))
          or ((tg_op = 'INSERT' or cardinality(old.validateurs) = 0) and app.peut_valider_docs(new.company_id))) then
    raise exception 'La validation réservée se règle par une personne désignée' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(new.validateurs) x where not exists (
      select 1 from public.profiles p where p.id = x and coalesce(p.is_active, true) and p.role not in ('entreprise', 'formateur_externe', 'stagiaire'))) then
    raise exception 'Validateur inconnu ou hors de l''équipe' using errcode = '22023';
  end if;
  new.validateurs := array(select distinct x from unnest(new.validateurs) x);
  new.docs_reserves := array(select distinct x from unnest(new.docs_reserves) x where length(btrim(x)) > 0);
  return new;
end
$$;
revoke all on function app.doc_review_settings_reserve() from public, anon, authenticated;
drop trigger if exists doc_review_settings_reserve on public.doc_review_settings;
create trigger doc_review_settings_reserve before insert or update on public.doc_review_settings for each row execute function app.doc_review_settings_reserve();

-- ── 4. Réglage et demande ──
create or replace function public.validation_reservee_regler(p_validateurs uuid[], p_docs text[])
returns public.doc_review_settings
language plpgsql
security invoker
set search_path = ''
as $$
declare v public.doc_review_settings;
begin
  insert into public.doc_review_settings as s (company_id, validateurs, docs_reserves)
  values (app.company_default(), coalesce(p_validateurs, '{}'), coalesce(p_docs, '{}'))
  on conflict (company_id) do update
    set validateurs = coalesce(p_validateurs, s.validateurs), docs_reserves = coalesce(p_docs, s.docs_reserves),
        updated_at = now(), updated_by = (select auth.uid())
  returning * into v;
  return v;
end
$$;
revoke all on function public.validation_reservee_regler(uuid[], text[]) from public, anon;
grant execute on function public.validation_reservee_regler(uuid[], text[]) to authenticated;

create or replace function public.demander_validation(p_doc_id text, p_doc_name text, p_motif text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_co uuid := app.company_default();
  v_uid uuid := (select auth.uid());
  v_val uuid[];
begin
  if not app.peut_gerer_docs(v_co) then raise exception 'Demander une validation demande le droit de gérer les documents' using errcode = '42501'; end if;
  if not app.validation_reservee(v_co, p_doc_id) then raise exception 'Ce document se valide directement' using errcode = '23514'; end if;
  select s.validateurs into v_val from public.doc_review_settings s where s.company_id = v_co;
  insert into public.notifications (company_id, type, title, message, link, metadata)
  values (v_co, 'document_validation', left('Validation demandée : ' || coalesce(nullif(btrim(p_doc_name), ''), p_doc_id), 255),
          left(coalesce(app.nom_profil(v_uid), 'Un membre de l''équipe') || ' demande la validation de ce document'
               || coalesce(' : « ' || nullif(btrim(p_motif), '') || ' »', '') || '.', 1000),
          '/qualite',
          jsonb_build_object('audience', 'profils', 'profils', to_jsonb(v_val), 'doc_id', p_doc_id, 'demandeur', v_uid));
  return jsonb_build_object('ok', true);
end
$$;
revoke all on function public.demander_validation(text, text, text) from public, anon;
grant execute on function public.demander_validation(text, text, text) to authenticated;

-- ── 5. Notifications à audience restreinte ──
drop policy if exists notifications_audience_profils on public.notifications;
create policy notifications_audience_profils on public.notifications as restrictive for select to authenticated
  using (coalesce(metadata ->> 'audience', '') <> 'profils' or app.is_superadmin()
         or coalesce(metadata -> 'profils', '[]'::jsonb) ? (select auth.uid())::text);

insert into public.schema_migrations (version) values ('0458_validation_reservee') on conflict (version) do nothing;
