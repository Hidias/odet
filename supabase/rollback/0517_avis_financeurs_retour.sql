-- Retour arrière de 0517 : avis des financeurs retirés (demandes, réponses, échanges saisis, relances « avis_financeur »
-- préparées), liste des types de relance remise à celle d'avant 0517. Les notifications déjà reçues restent.

drop function if exists public.financeur_avis_repondre(text, jsonb);
drop function if exists public.financeur_avis_ouvrir(text);
drop function if exists app.financeur_avis_lire(text);
drop function if exists public.financeurs_suivi(int);
drop function if exists public.financeurs_avis_preparer();
drop function if exists app.avis_financeur_texte(boolean, text, int, int, text);
drop trigger if exists scheduled_actions_avis_financeur on public.scheduled_actions;
drop function if exists app.avis_financeur_lien_actif();
drop function if exists app.financeurs_annees_ouvertes();
drop function if exists app.financeurs_de_l_annee(uuid, int);

delete from public.scheduled_actions where kind = 'avis_financeur';
alter table public.scheduled_actions drop constraint if exists scheduled_actions_kind_check;
alter table public.scheduled_actions add constraint scheduled_actions_kind_check check (kind in ('relance_recyclage',
  'justificatif_prestataire', 'convocation', 'rappel', 'evaluation_froid', 'relance_impaye', 'autre', 'renouvellement_contrat',
  'visite_hors_contrat', 'emargement_manquant', 'eval_chaud', 'attestations', 'facture_brouillon'));

drop table if exists public.funder_exchanges;
drop function if exists app.funder_exchanges_regle();
drop table if exists public.funder_feedback;
drop function if exists app.financeur_cle(uuid, text, uuid, text);
drop function if exists app.financeur_email_valide(text);
drop function if exists app.financeur_nom_norme(text);

delete from public.schema_migrations where version = '0517_avis_financeurs';
