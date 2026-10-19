# Lot 2, obligations et échéances (migration 0042)

Spec : `odet-lot2-spec.md` v2, section 3. Lot : `l2_0042`. Retour arrière : `supabase/rollback/0042_obligations_retour.sql`
(refusé dès qu'une saisie existe ou que le référentiel a été modifié).

## Base
- `obligation_rules` (par société) : code, domaine, libellé, type (formation, matériel, exercice), périodicité en mois (vide
  quand aucun texte ne la fixe), groupe de validité, formations du catalogue qui la satisfont, familles de matériel, délai
  « à prévoir » (jours), référence, source et sa nature, confirmée ou non, suivie ou non.
  Valeurs de départ (13, toutes « à confirmer ») posées pour chaque société par `app.obligation_rules_depart(société)` :
  SST 24 mois (référentiel INRS), habilitation électrique 36 mois (NF C 18-510, indicatif), personnel désigné incendie
  (R4227-38, aucune périodicité), R489 et R485 60 mois (recommandations de l'Assurance Maladie), gestes et postures
  (R4541-8), exercice d'évacuation et essai d'alarme 6 mois (R4227-39), vérifications annuelles des extincteurs, RIA,
  alarme, éclairage de sécurité, désenfumage. Formations rattachées par leur code de catalogue quand il existe.
- `external_trainings` : formations suivies ailleurs (salarié ou entreprise) ; échéance calculée si non saisie.
- `client_safety_checks` : exercices et essais de l'exploitant ; prochaine échéance calculée si non saisie.
- `v_trainee_validities` : dernière validation par stagiaire et groupe (session réussie, certificat SST, formation suivie
  ailleurs) et son échéance. `v_obligation_deadlines` : échéances par client (formations, matériel du parc, fin de
  contrat, exercices) avec statut dépassé / à prévoir / à jour. Vues `security_invoker` : chacun ne voit que ce que ses
  règles lui ouvrent (un technicien ne voit rien hors de ses missions : testé).

## Application
- Tableau de bord : « Recyclages à prévoir » lit la vue (repli sur l'ancien calcul SST à 24 mois sans la vue).
- Fiche client : bloc « Échéances » (dépassées et à prévoir d'abord, faits datés, aucun taux) ; saisies « Exercice ou
  essai » et « Formation suivie ailleurs ».
- Formation › Obligations : référentiel, modification par qui gère le catalogue, confirmation par l'organisme.

## Reste du lot 2, section 3
- DUERP : identité lue sur le client, matériel inventorié dans `itv_equipment`, `duerp_formations_reglementaires`
  remplacé par `obligation_rules` (écrans DUERP à reprendre).
- Moteur commun de relances (`scheduled_actions`, section 8) : branche suivante.
- Nettoyage des tables vides remplacées (`client_providers`, `duerp_habilitations`, `duerp_verifications`) : chantier 8.
