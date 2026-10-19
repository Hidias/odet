# Lot 2, clients et sites (migration 0041)

Spec : `odet-lot2-spec.md` v2, section 2. Lot de migrations : `l2_0041`. Retour arrière : `supabase/rollback/0041_clients_sites_retour.sql`
(refusé si des valeurs ont été saisies dans les nouvelles colonnes).

Déjà fait avant ce lot : TVA calculée depuis le SIREN et particuliers (0040), coordonnées du client figées à l'émission
(0361, `invoices.buyer_snapshot`), contrôle du SIRET dans l'annuaire avant émission (0365).

## Base (0041)
- `clients` : `legal_name`, `country`, `dirigeant_nom`, `dirigeant_qualite`, `date_creation`, `etat_administratif`,
  `registry_synced_at`, `registry_snapshot`.
- `sites` : `siret`, `is_head_office`, `etat_administratif`, `registry_snapshot` ; un seul site « adresse de la fiche »
  (`is_default`) par client (index unique).
- `client_contacts.site_id`, `trainees.site_id` (facultatifs).
- Adresse de la fiche = site par défaut, synchronisés dans les deux sens par la base (sans boucle) ; un client
  professionnel créé reçoit son site (droits du propriétaire : la création d'un client ne dépend pas du droit d'écrire
  un site) ; les clients professionnels sans site l'ont reçu à l'application. Un particulier n'a pas de site.
- `public.tva_from_siren(siren)` : même calcul que `src/core/org/tva.js`.

## Application
- `src/modules/commercial/lib/registry.js` : bibliothèque unique du répertoire (recherche, entreprise, établissements
  avec filtre géographique obligatoire, normalisation, écarts avec la fiche, liens Pappers et annuaire officiel) ;
  tests `tests/registry.test.js`.
- Nouveau client : champ « Nom, SIREN ou SIRET » (résultats avec état actif / cessée / déjà client), préremplissage
  complet ; saisie manuelle toujours possible.
- Fiche client : « Actualiser depuis le répertoire » (écarts ligne par ligne, Accepter / Ignorer, jamais d'écriture
  d'office ; adresse comparée au siège seulement si la fiche porte le SIRET du siège) ; bloc « Sites » (adresse de la
  fiche, siège, établissements avec SIRET et état, recherche des établissements par code postal ou département,
  archivage).
- Session intra : « Site du client » remplit le lieu de la session (repris par les documents) et `sessions.site_id`.
- Interventions : « Créer le site » réutilise le site « adresse de la fiche » s'il existe.

## Reste du lot 2, section 2
- Onglets complets de la fiche client (Synthèse, Sites, Contacts, Salariés, Formation, Maintenance, Devis et factures,
  Accès entreprise) et refonte graphique de la liste ; fiche « particulier » sur une page.
- Retrait du parseur de texte Pappers / Infogreffe, de `MultiSiretWizard` et de `MultiEtablissements` quand le bloc
  Sites les remplace dans l'usage.
- Rattachement d'un contact ou d'un salarié à un site dans leurs formulaires.
