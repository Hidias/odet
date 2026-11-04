-- Retour arrière de 0482 : fonctions et tables de la relance à froid retirées, rappel du pilote rétabli.
-- Attention : les tables froid_envois (trace des envois) et froid_employeur (réponses des employeurs) sont supprimées ;
-- les exporter avant si elles contiennent des données réelles. Les colonnes ajoutées (courses : délai et questions,
-- sessions.froid_inclure, evaluations_cold.reponses) sont retirées aussi : exporter avant si elles ont servi.
drop function if exists public.froid_employeur_corriger(uuid, jsonb, text);
drop function if exists public.ent_froid_repondre(uuid, jsonb);
drop function if exists public.ent_froid();
drop function if exists public.portail_froid_repondre(text, uuid, text, jsonb);
drop function if exists public.portail_froid(text, uuid, text);
drop function if exists public.froid_remettre(uuid[]);
drop function if exists public.froid_envoi_terminer(uuid, boolean, text, text, text);
drop function if exists public.froid_envois_reserver(uuid[]);
drop function if exists public.froid_reglages_enregistrer(uuid, jsonb);
drop function if exists public.froid_ecarter(uuid[], text);
drop function if exists public.froid_inclure_session(uuid, boolean);
drop function if exists public.froid_suivi();
drop function if exists public.froid_preparer_maintenant();
drop function if exists public.froid_preparer();
drop function if exists app.froid_preparer_corps(uuid[], date);
drop function if exists app.froid_contact(uuid);
drop function if exists app.froid_email_valide(text);
drop trigger if exists froid_employeur_figee on public.froid_employeur;
drop function if exists app.froid_employeur_figee();
drop table if exists public.froid_employeur;
drop table if exists public.froid_envois;
drop function if exists app.froid_reponses_valides(jsonb, jsonb);
drop function if exists app.froid_questions(uuid, text);
drop function if exists app.froid_questions_defaut(text);
drop function if exists app.froid_reglage(uuid);
drop table if exists public.froid_reglages;
alter table public.evaluations_cold drop column if exists reponses;
alter table public.sessions drop column if exists froid_inclure;
alter table public.courses drop column if exists froid_questions_employeur;
alter table public.courses drop column if exists froid_questions;
alter table public.courses drop column if exists froid_delai_jours;
update public.org_modules set settings = jsonb_set(settings, '{eval_froid,actif}', 'true'::jsonb)
 where key = 'pilote' and settings ? 'eval_froid';
delete from public.schema_migrations where version = '0482_relance_froid';
