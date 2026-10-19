# Conformité RGPD (chantier F, migration 0340)

Spec : `odet-conformite-rgpd-certifications.md` § 4 et 5 (validée par H le 17/10). Module « rgpd », par société.

## Écran : Qualité › RGPD

- **Registre** : traitements de la société. « Mettre à jour depuis les modules » propose les traitements modèles des
  modules actifs, au statut « À revoir » ; la société relit, adapte et valide (validation tracée par la base).
  « Exporter le registre » produit le PDF de l'article 30. Les 6 lignes héritées de l'outil précédent sont archivées,
  jamais supprimées (« Afficher les archivés »).
- **Demandes** des personnes : échéance d'un mois calculée par la base, trois mois si la prolongation est motivée.
- **Violations** : échéance de notification à 72 h calculée par la base, compte à rebours et bandeau d'alerte ; toute
  violation s'inscrit, même non notifiée (art. 33.5).
- **Sous-traitants** : services réellement appelés par l'outil (Supabase, Vercel, Anthropic, messagerie, Google,
  OpenStreetMap), garantie de transfert, contrat à signer.
- **Information des personnes** (notices remises, preuve) et **analyses d'impact** (critères du CEPD).

## Droits

`conformite.rgpd.gerer` (registre, sous-traitants, informations, AIPD), `conformite.demandes.gerer`,
`conformite.violations.gerer` : profils direction et administrateur. Le registre garde ses règles (`qualite.registres.*`).

## Reste (phase 2, chantier F)

- 0344 purges validées par société ; 0345 journal d'audit commun écrit par la base ; 0346 audit interne noté.
- Mentions d'information (portail, formulaires, emails de prospection), adresse IP de la signature lue côté serveur.
- Certifications génériques et face interne « erreurs à éviter » (0350 à 0355).
