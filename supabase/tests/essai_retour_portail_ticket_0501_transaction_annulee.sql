-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (portail_ticket_0501) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0501_portail_ticket.sql, retour arrière,
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

-- ===== supabase/migrations/0501_portail_ticket.sql =====
-- 0501 : le code personnel du stagiaire exigé partout dans le portail (reste de B1, relevé le 04/11).
-- Défaut : huit fonctions du portail stagiaire ne demandaient que le lien de la session et l'identifiant du stagiaire,
-- sans le ticket délivré par le code personnel (portal_entrer, 0423) : quelqu'un qui a le lien de la session pouvait
-- remplir l'évaluation à chaud, le test de positionnement ou le quiz final d'un autre stagiaire, signer son
-- émargement du jour (aussi par l'envoi différé) ou changer son refus d'e-mail. save_positioning_test_answers ne vérifiait même pas que le
-- stagiaire était inscrit à la session.
--   Chaque fonction garde son corps tel quel, déplacé dans le schéma app (app.<nom>_corps, fermé aux comptes), et
--   la fonction publique prend un dernier paramètre p_ticket : elle passe d'abord par app.portal_session_for (règle
--   commune de 0084 : ticket exigé quand le stagiaire a un code personnel, refus « Code d'accès requis », 42501),
--   puis appelle le corps. Les fonctions qui rendaient leurs refus en json (émargement, refus d'e-mail) rendent
--   aussi ce refus en json.
--   Émargement gardé sans réseau (portal_sign_halfday_differe, 0417) : le portail garde le ticket avec la signature ;
--   il est accepté s'il est toujours celui du stagiaire et que l'heure de la signature ne dépasse pas sa fin de
--   validité. Limite connue (déjà là avec 0417) : l'heure de signature est donnée par le téléphone, jusqu'à 48 heures
--   en arrière ; il n'y a pas d'heure de délivrance du ticket pour la borner.
--   Gardés sans ticket, exprès : portal_quiz_check (aucun stagiaire), portal_log_download (trace seulement).
-- Aucune donnée modifiée. Retour arrière : supabase/rollback/0501_portail_ticket_retour.sql

-- save_evaluation
alter function public.save_evaluation(text,uuid,jsonb) rename to save_evaluation_corps;
alter function public.save_evaluation_corps(text,uuid,jsonb) set schema app;
revoke all on function app.save_evaluation_corps(text,uuid,jsonb) from public, anon, authenticated;
create or replace function public.save_evaluation(p_token text, p_trainee_id uuid, p_eval_data jsonb, p_ticket text default null)
returns json
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.portal_session_for(p_token, p_trainee_id, p_ticket);
  return app.save_evaluation_corps(p_token, p_trainee_id, p_eval_data);
end
$$;
revoke all on function public.save_evaluation(text,uuid,jsonb,text) from public;
grant execute on function public.save_evaluation(text,uuid,jsonb,text) to anon, authenticated, service_role;

-- save_positioning_test_answers
alter function public.save_positioning_test_answers(text,uuid,jsonb) rename to save_positioning_test_answers_corps;
alter function public.save_positioning_test_answers_corps(text,uuid,jsonb) set schema app;
revoke all on function app.save_positioning_test_answers_corps(text,uuid,jsonb) from public, anon, authenticated;
create or replace function public.save_positioning_test_answers(p_token text, p_trainee_id uuid, p_answers jsonb, p_ticket text default null)
returns json
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.portal_session_for(p_token, p_trainee_id, p_ticket);
  return app.save_positioning_test_answers_corps(p_token, p_trainee_id, p_answers);
end
$$;
revoke all on function public.save_positioning_test_answers(text,uuid,jsonb,text) from public;
grant execute on function public.save_positioning_test_answers(text,uuid,jsonb,text) to anon, authenticated, service_role;

-- portal_set_email_refused
alter function public.portal_set_email_refused(text,uuid,boolean) rename to portal_set_email_refused_corps;
alter function public.portal_set_email_refused_corps(text,uuid,boolean) set schema app;
revoke all on function app.portal_set_email_refused_corps(text,uuid,boolean) from public, anon, authenticated;
create or replace function public.portal_set_email_refused(p_token text, p_trainee_id uuid, p_refused boolean, p_ticket text default null)
returns json
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform app.portal_session_for(p_token, p_trainee_id, p_ticket);
  exception
    when sqlstate '42501' then
      return json_build_object('ok', false, 'error', 'Votre accès a expiré : saisissez à nouveau votre code personnel');
    -- lien ou stagiaire inconnu : le corps rend son propre refus, inchangé
    when others then null;
  end;
  return app.portal_set_email_refused_corps(p_token, p_trainee_id, p_refused);
end
$$;
revoke all on function public.portal_set_email_refused(text,uuid,boolean,text) from public;
grant execute on function public.portal_set_email_refused(text,uuid,boolean,text) to anon, authenticated, service_role;

-- portal_quiz_questions
alter function public.portal_quiz_questions(text,uuid,text) rename to portal_quiz_questions_corps;
alter function public.portal_quiz_questions_corps(text,uuid,text) set schema app;
revoke all on function app.portal_quiz_questions_corps(text,uuid,text) from public, anon, authenticated;
create or replace function public.portal_quiz_questions(p_token text, p_trainee_id uuid, p_purpose text, p_ticket text default null)
returns json
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.portal_session_for(p_token, p_trainee_id, p_ticket);
  return app.portal_quiz_questions_corps(p_token, p_trainee_id, p_purpose);
end
$$;
revoke all on function public.portal_quiz_questions(text,uuid,text,text) from public;
grant execute on function public.portal_quiz_questions(text,uuid,text,text) to anon, authenticated, service_role;

-- portal_quiz_finish
alter function public.portal_quiz_finish(text,uuid,text,jsonb) rename to portal_quiz_finish_corps;
alter function public.portal_quiz_finish_corps(text,uuid,text,jsonb) set schema app;
revoke all on function app.portal_quiz_finish_corps(text,uuid,text,jsonb) from public, anon, authenticated;
create or replace function public.portal_quiz_finish(p_token text, p_trainee_id uuid, p_purpose text, p_answers jsonb, p_ticket text default null)
returns json
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.portal_session_for(p_token, p_trainee_id, p_ticket);
  return app.portal_quiz_finish_corps(p_token, p_trainee_id, p_purpose, p_answers);
end
$$;
revoke all on function public.portal_quiz_finish(text,uuid,text,jsonb,text) from public;
grant execute on function public.portal_quiz_finish(text,uuid,text,jsonb,text) to anon, authenticated, service_role;

-- portal_quiz_summary
alter function public.portal_quiz_summary(text,uuid) rename to portal_quiz_summary_corps;
alter function public.portal_quiz_summary_corps(text,uuid) set schema app;
revoke all on function app.portal_quiz_summary_corps(text,uuid) from public, anon, authenticated;
create or replace function public.portal_quiz_summary(p_token text, p_trainee_id uuid, p_ticket text default null)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.portal_session_for(p_token, p_trainee_id, p_ticket);
  return app.portal_quiz_summary_corps(p_token, p_trainee_id);
end
$$;
revoke all on function public.portal_quiz_summary(text,uuid,text) from public;
grant execute on function public.portal_quiz_summary(text,uuid,text) to anon, authenticated, service_role;

-- portal_sign_halfday
alter function public.portal_sign_halfday(text,uuid,text,text) rename to portal_sign_halfday_corps;
alter function public.portal_sign_halfday_corps(text,uuid,text,text) set schema app;
revoke all on function app.portal_sign_halfday_corps(text,uuid,text,text) from public, anon, authenticated;
create or replace function public.portal_sign_halfday(p_token text, p_trainee_id uuid, p_period text, p_signature text, p_ticket text default null)
returns json
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform app.portal_session_for(p_token, p_trainee_id, p_ticket);
  exception
    when sqlstate '42501' then
      return json_build_object('ok', false, 'error', 'Votre accès a expiré : saisissez à nouveau votre code personnel');
    -- lien ou stagiaire inconnu : le corps rend son propre refus, inchangé
    when others then null;
  end;
  return app.portal_sign_halfday_corps(p_token, p_trainee_id, p_period, p_signature);
end
$$;
revoke all on function public.portal_sign_halfday(text,uuid,text,text,text) from public;
grant execute on function public.portal_sign_halfday(text,uuid,text,text,text) to anon, authenticated, service_role;

-- portal_sign_halfday_differe
alter function public.portal_sign_halfday_differe(text,uuid,text,text,timestamp with time zone) rename to portal_sign_halfday_differe_corps;
alter function public.portal_sign_halfday_differe_corps(text,uuid,text,text,timestamp with time zone) set schema app;
revoke all on function app.portal_sign_halfday_differe_corps(text,uuid,text,text,timestamp with time zone) from public, anon, authenticated;
create or replace function public.portal_sign_halfday_differe(p_token text, p_trainee_id uuid, p_period text, p_signature text, p_signed_at timestamp with time zone, p_ticket text default null)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_st record;
begin
  -- Signature gardée sans réseau : le ticket est celui du moment de la signature. Il est accepté s'il est encore celui du
  -- stagiaire et si l'heure de la signature ne dépasse pas sa fin de validité, même expiré depuis (le ticket dure
  -- 12 heures, la signature est gardée jusqu'à 48 heures ; portal_entrer redonne le même ticket tant qu'il est valable).
  select st.access_code, st.portal_ticket, st.portal_ticket_expires_at into v_st
  from public.sessions s join public.session_trainees st on st.session_id = s.id and st.trainee_id = p_trainee_id
  where s.attendance_token = p_token and coalesce(p_token, '') <> '';
  if found and v_st.access_code is not null
     and (p_ticket is null or v_st.portal_ticket is distinct from p_ticket or v_st.portal_ticket_expires_at is null
          or p_signed_at is null or p_signed_at > v_st.portal_ticket_expires_at) then
    return json_build_object('ok', false, 'error', 'Votre accès a expiré : saisissez à nouveau votre code personnel');
  end if;
  -- lien ou stagiaire inconnu : le corps rend son propre refus, inchangé
  return app.portal_sign_halfday_differe_corps(p_token, p_trainee_id, p_period, p_signature, p_signed_at);
end
$$;
revoke all on function public.portal_sign_halfday_differe(text,uuid,text,text,timestamp with time zone,text) from public;
grant execute on function public.portal_sign_halfday_differe(text,uuid,text,text,timestamp with time zone,text) to anon, authenticated, service_role;

insert into public.schema_migrations (version) values ('0501_portail_ticket') on conflict (version) do nothing;

-- ===== supabase/rollback/0501_portail_ticket_retour.sql =====
-- Retour arrière de 0501 : fonctions publiques d'origine remises (corps inchangé, droits d'origine).

drop function if exists public.save_evaluation(text,uuid,jsonb,text);
alter function app.save_evaluation_corps(text,uuid,jsonb) set schema public;
alter function public.save_evaluation_corps(text,uuid,jsonb) rename to save_evaluation;
grant execute on function public.save_evaluation(text,uuid,jsonb) to anon, authenticated, service_role;

drop function if exists public.save_positioning_test_answers(text,uuid,jsonb,text);
alter function app.save_positioning_test_answers_corps(text,uuid,jsonb) set schema public;
alter function public.save_positioning_test_answers_corps(text,uuid,jsonb) rename to save_positioning_test_answers;
grant execute on function public.save_positioning_test_answers(text,uuid,jsonb) to anon, authenticated, service_role;

drop function if exists public.portal_set_email_refused(text,uuid,boolean,text);
alter function app.portal_set_email_refused_corps(text,uuid,boolean) set schema public;
alter function public.portal_set_email_refused_corps(text,uuid,boolean) rename to portal_set_email_refused;
grant execute on function public.portal_set_email_refused(text,uuid,boolean) to anon, authenticated, service_role;

drop function if exists public.portal_quiz_questions(text,uuid,text,text);
alter function app.portal_quiz_questions_corps(text,uuid,text) set schema public;
alter function public.portal_quiz_questions_corps(text,uuid,text) rename to portal_quiz_questions;
grant execute on function public.portal_quiz_questions(text,uuid,text) to anon, authenticated, service_role;

drop function if exists public.portal_quiz_finish(text,uuid,text,jsonb,text);
alter function app.portal_quiz_finish_corps(text,uuid,text,jsonb) set schema public;
alter function public.portal_quiz_finish_corps(text,uuid,text,jsonb) rename to portal_quiz_finish;
grant execute on function public.portal_quiz_finish(text,uuid,text,jsonb) to anon, authenticated, service_role;

drop function if exists public.portal_quiz_summary(text,uuid,text);
alter function app.portal_quiz_summary_corps(text,uuid) set schema public;
alter function public.portal_quiz_summary_corps(text,uuid) rename to portal_quiz_summary;
grant execute on function public.portal_quiz_summary(text,uuid) to anon, authenticated, service_role;

drop function if exists public.portal_sign_halfday(text,uuid,text,text,text);
alter function app.portal_sign_halfday_corps(text,uuid,text,text) set schema public;
alter function public.portal_sign_halfday_corps(text,uuid,text,text) rename to portal_sign_halfday;
grant execute on function public.portal_sign_halfday(text,uuid,text,text) to anon, authenticated, service_role;

drop function if exists public.portal_sign_halfday_differe(text,uuid,text,text,timestamp with time zone,text);
alter function app.portal_sign_halfday_differe_corps(text,uuid,text,text,timestamp with time zone) set schema public;
alter function public.portal_sign_halfday_differe_corps(text,uuid,text,text,timestamp with time zone) rename to portal_sign_halfday_differe;
grant execute on function public.portal_sign_halfday_differe(text,uuid,text,text,timestamp with time zone) to anon, authenticated, service_role;

delete from public.schema_migrations where version = '0501_portail_ticket';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE portail_ticket_0501 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
