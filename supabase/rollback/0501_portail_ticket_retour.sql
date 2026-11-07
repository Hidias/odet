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

delete from public.schema_migrations where version = '0501_portail_ticket';
