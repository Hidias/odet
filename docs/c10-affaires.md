# Suivi des affaires (chantier 10, migration 0380)

Spec d'origine : `odet-pac-commercial-inventaire.md` (lots 0 à 3 et cadence du lot 4). Version livrée : l'essentiel,
simple à utiliser, complète là où il faut.

## Ce que voit l'utilisateur

- **Commerce › Affaires** (module « Suivi des affaires », actif si le module commercial l'est) :
  - **À faire** : les affaires et les devis envoyés à relancer, la plus ancienne action d'abord (en retard, aujourd'hui,
    date) ; « Noter » enregistre l'échange dans l'historique du client et fixe la prochaine action ; à droite,
    **Ma semaine** : appels, emails, rendez-vous et affaires créées depuis lundi, contre l'objectif ;
  - **Pipeline** : une colonne par étape ouverte, nombre, montant et montant pondéré (montant × probabilité) ;
  - **À appeler** : clients avec une échéance dans les 90 jours (formations du personnel, matériel, contrat,
    exercices), contact et téléphone cliquable, affaire ou devis en cours, dernier échange ; « Ne pas appeler » si le
    client s'y est opposé ;
  - **Réglages** : objectifs de l'équipe par semaine, étapes (probabilité), sources, motifs de perte, segments.
- **Fiche client › Commercial** : ce que le client achète déjà (calculé : formations, maintenance, facturé sur 12
  mois), ses affaires, segment, source, responsable, opposition par canal.

## Règles tenues par la base

- Une affaire ouverte a toujours une date de prochaine action ; une affaire perdue a un motif.
- La probabilité suit l'étape (modifiable à la main) ; « Gagnée » 100 %, « Perdue » 0 %, étapes non supprimables.
- Un devis lié fait avancer l'affaire : envoyé → « Devis envoyé », accepté ou facturé → gagnée, refusé → perdue.
- Les devis envoyés sans affaire comptent au pipeline (étape « Devis envoyé ») : aucune reprise des devis existants.
- Opposition par email = « ne pas solliciter » (`do_not_mail`), dans les deux sens ; la date d'opposition est posée.
- Droits : affaires (montants) lues avec « Voir les devis », tenues par « Préparer les devis » ; listes et objectifs
  lus avec les clients ; technicien : rien.

## Reste (attend H ou une donnée)

- Import du portefeuille papier et de l'historique de l'ancien logiciel de facturation : attend un vrai export.
- Décision « devis dans l'ancien logiciel ou dans l'outil » : l'affaire porte déjà `quote_id` (l'outil) et `external_ref`
  (numéro de l'ancien logiciel).
- Plan d'actions, scénarios, récaps envoyés par email : plus tard (aucun email sans accord ; domaine d'envoi de la société à venir).
- Réactivation de la prospection (Base prospects, Campagnes) : après la purge de la démo et le domaine.
