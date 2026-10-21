-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (attentes_0413) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0413_bilan_attentes.sql, retour arrière,
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

-- ===== supabase/migrations/0413_bilan_attentes.sql =====
-- 0413 : bilan des attentes en fin de formation (suggestion validée par H le 21/10). Les attentes que le stagiaire
-- écrit dans sa fiche de renseignements sont reprises à la fin :
--   1. sur le portail, avec l'avis à chaud : « Vous attendiez : … Ces attentes ont-elles été satisfaites ? »
--      (oui, en partie, non, et un commentaire) ; une réponse « non » prévient l'équipe (une notification) ;
--   2. dans la session, onglet Évaluations : le formateur ou l'organisme note son propre bilan pour chaque stagiaire.
-- Rien n'est envoyé par email. Migration additive : deux colonnes sur trainee_evaluations, trois sur session_trainees,
-- une fonction du portail (même contrôle que les autres : jeton de session, stagiaire inscrit, code d'accès).
-- Idempotente. Retour arrière : supabase/rollback/0413_bilan_attentes_retour.sql

-- 1. Avis du stagiaire
alter table public.trainee_evaluations add column if not exists attentes_satisfaites text;
alter table public.trainee_evaluations add column if not exists attentes_commentaire text;
alter table public.trainee_evaluations drop constraint if exists trainee_evaluations_attentes_satisfaites_check;
alter table public.trainee_evaluations add constraint trainee_evaluations_attentes_satisfaites_check
  check (attentes_satisfaites is null or attentes_satisfaites in ('oui', 'en_partie', 'non'));
comment on column public.trainee_evaluations.attentes_satisfaites is
  'Avis du stagiaire en fin de formation sur ses attentes (fiche de renseignements) : oui, en_partie, non';

-- 2. Bilan du formateur ou de l'organisme
alter table public.session_trainees add column if not exists attentes_bilan text;
alter table public.session_trainees add column if not exists attentes_bilan_note text;
alter table public.session_trainees add column if not exists attentes_bilan_at timestamptz;
alter table public.session_trainees drop constraint if exists session_trainees_attentes_bilan_check;
alter table public.session_trainees add constraint session_trainees_attentes_bilan_check
  check (attentes_bilan is null or attentes_bilan in ('oui', 'en_partie', 'non'));
comment on column public.session_trainees.attentes_bilan is
  'Bilan de l''organisme sur les attentes du stagiaire en fin de formation : oui, en_partie, non';

-- 3. Portail : avis du stagiaire sur ses attentes
create or replace function public.portal_save_attentes(p_token text, p_trainee_id uuid, p_verdict text,
                                                       p_commentaire text default null, p_ticket text default null)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session uuid;
  v_avant text;
  s record;
  t record;
begin
  v_session := app.portal_session_for(p_token, p_trainee_id, p_ticket);
  if p_verdict is null or p_verdict not in ('oui', 'en_partie', 'non') then
    raise exception 'Réponse invalide';
  end if;
  select e.attentes_satisfaites into v_avant from public.trainee_evaluations e
   where e.session_id = v_session and e.trainee_id = p_trainee_id;
  -- Seulement sur un avis déjà envoyé : une ligne créée ici fausserait la satisfaction (notes à 5 par défaut)
  update public.trainee_evaluations e
     set attentes_satisfaites = p_verdict,
         attentes_commentaire = nullif(btrim(left(coalesce(p_commentaire, ''), 2000)), ''),
         updated_at = now()
   where e.session_id = v_session and e.trainee_id = p_trainee_id;
  if not found then raise exception 'Envoyez d''abord votre avis sur la formation'; end if;
  -- Attentes non satisfaites : l'équipe est prévenue une fois (pas de nouvelle alerte si la réponse ne change pas)
  if p_verdict = 'non' and v_avant is distinct from 'non' then
    select se.company_id, se.start_date, co.title into s
      from public.sessions se left join public.courses co on co.id = se.course_id where se.id = v_session;
    select tr.first_name, tr.last_name into t from public.trainees tr where tr.id = p_trainee_id;
    insert into public.notifications (type, title, message, link, company_id, metadata)
    values ('attentes_non_satisfaites',
            left('Attentes non satisfaites' || coalesce(' : ' || s.title, '') || coalesce(' du ' || to_char(s.start_date, 'DD/MM'), ''), 255),
            concat_ws(' ', t.first_name, upper(t.last_name)) || ' indique que ses attentes n''ont pas été satisfaites.'
              || coalesce(' « ' || nullif(btrim(left(coalesce(p_commentaire, ''), 300)), '') || ' »', ''),
            '/sessions/' || v_session, s.company_id,
            jsonb_build_object('session_id', v_session, 'trainee_id', p_trainee_id));
  end if;
  return json_build_object('success', true);
end
$$;
revoke all on function public.portal_save_attentes(text, uuid, text, text, text) from public;
grant execute on function public.portal_save_attentes(text, uuid, text, text, text) to anon, authenticated;

insert into public.schema_migrations (version) values ('0413_bilan_attentes') on conflict (version) do nothing;

-- ===== supabase/rollback/0413_bilan_attentes_retour.sql =====
-- Retour arrière de 0413_bilan_attentes.sql. Les avis et bilans des attentes sont effacés ; les notifications déjà
-- créées restent. Idempotent.

drop function if exists public.portal_save_attentes(text, uuid, text, text, text);
alter table public.session_trainees drop constraint if exists session_trainees_attentes_bilan_check;
alter table public.session_trainees drop column if exists attentes_bilan_at;
alter table public.session_trainees drop column if exists attentes_bilan_note;
alter table public.session_trainees drop column if exists attentes_bilan;
alter table public.trainee_evaluations drop constraint if exists trainee_evaluations_attentes_satisfaites_check;
alter table public.trainee_evaluations drop column if exists attentes_commentaire;
alter table public.trainee_evaluations drop column if exists attentes_satisfaites;

delete from public.schema_migrations where version = '0413_bilan_attentes';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE attentes_0413 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
