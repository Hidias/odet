-- 0526 (B126) : la relance des évaluations à chaud est tracée dans session_emails_sent avec son propre type
-- « relance_chaud » (preuve datée, indicateur 30). Le type « after » reste réservé à l'envoi « Après formation »,
-- qui sert de preuve que l'avis de l'entreprise a été demandé : une relance ne doit pas passer pour cet envoi.
-- Même correctif pour « demande_nir » (api/nir-demande.js) : sa trace était refusée par la contrainte sans que l'envoi
-- échoue (insertion non vérifiée), donc la demande de NIR partait sans preuve. Relevé en V82.
-- À appliquer seulement après la fusion (après le départ de l'auditrice le 27/11).
-- Retour arrière : supabase/rollback/0526_relance_chaud_trace_retour.sql
begin;
alter table public.session_emails_sent drop constraint if exists session_emails_sent_email_type_check;
alter table public.session_emails_sent add constraint session_emails_sent_email_type_check
  check (email_type::text = any (array['before', 'after', 'relance_chaud', 'demande_nir']));
insert into public.schema_migrations (version) values ('0526_relance_chaud_trace') on conflict (version) do nothing;
commit;
