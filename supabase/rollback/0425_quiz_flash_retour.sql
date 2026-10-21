-- Retour arrière de 0425_quiz_flash.sql : quiz flash effacés (parties, joueurs, réponses, surnoms) ; la banque de
-- questions reste, sans la colonne for_flash. Idempotent.

drop function if exists public.portal_quiz_flash_repondre(text, uuid, text, uuid, int, int, boolean);
drop function if exists public.portal_quiz_flash(text, uuid, text);
drop function if exists public.quiz_flash_piloter(uuid, text);
drop function if exists public.quiz_flash_ecran(uuid);
drop function if exists public.quiz_flash_lancer(uuid, text, uuid, int);
drop function if exists app.qf_surnom(uuid, uuid);
drop function if exists app.qf_questions_jouables(uuid, uuid);
drop function if exists app.qf_question(uuid);
drop table if exists public.quiz_flash_reponses;
drop table if exists public.quiz_flash_joueurs;
drop table if exists public.quiz_flash_parties;
drop table if exists public.quiz_flash_surnoms;
alter table public.theme_questions drop column if exists for_flash;

delete from public.schema_migrations where version = '0425_quiz_flash';
