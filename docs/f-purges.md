# Purges RGPD (chantier F, migration 0344)

Spec : `odet-conformite-rgpd-certifications.md` § 5.2. Écran : Qualité › RGPD › Durées et purges.

- Quatre règles par société, programmées en SQL : journal d'audit au-delà de 12 mois (minimum 6), prospects sans
  contact depuis 36 mois (la liste « ne pas appeler » est gardée), stagiaires sans session depuis 60 mois
  (anonymisés : la fiche et les preuves restent, sans nom ni coordonnées), handicap 12 mois après la dernière session.
- Chaque nuit, `rgpd_purges_generer()` prépare un passage « à valider » par règle (identifiants seuls).
- `rgpd_purge_decider(passage, 'executer' | 'ignorer')` : droit « Valider les purges » ; les lignes sont recalculées
  à l'exécution ; décision et nombre de lignes traitées gardés dans le passage.
- Le mode automatique n'est possible qu'après un premier passage validé à la main ; l'outil ne le pose jamais.
- Reste : photos de visites (stockage) et traces d'accès des portails, avec le chantier des fichiers.
