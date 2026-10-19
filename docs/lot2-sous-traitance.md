# Lot 2 : sous-traitance (l'organisme donneur d'ordres)

Migration `0045_sous_traitance.sql`, retour arrière `supabase/rollback/0045_sous_traitance_retour.sql`, lot `l2_0045`.
Le cas inverse (session réalisée pour le compte d'un autre organisme, `session_type = 'subcontract'`) est inchangé.

## Ce que fait la base

- `subcontractors` : prestataires (organisme de formation ou formateur indépendant), identité, NDA, Qualiopi, prix par jour.
- `subcontractor_doc_types` : justificatifs demandés, par société, avec périodicité et seuil. Départ :
  - attestation de vigilance URSSAF, six mois, exigée dès 5 000 € HT de commandes sur 12 mois (code du travail
    D8222-5 et R8222-1, consultés sur code.travail.gouv.fr le 14/10/2026) ;
  - extrait d'immatriculation (D8222-5), même seuil ;
  - assurance de responsabilité civile professionnelle (12 mois), déclaration d'activité (organismes), certificat
    Qualiopi (facultatif, 36 mois), CV, charte qualité et contrat signés (indicateur 27).
  Une société créée ensuite reçoit ces justificatifs et les obligations de départ (0042) à sa création.
- `subcontractor_documents` : justificatifs déposés ; validité calculée (date du document + périodicité) si elle
  n'est pas saisie. Fichiers dans le bucket privé `prestataires`, chemin `<société>/<prestataire>/<fichier>`.
- `subcontract_orders` : bons de commande (référence `BC-AAAAMMJJ-NNNN`, montant = jours × prix par jour).
- `trainers.subcontractor_id` : formateur rattaché à son prestataire.
- `v_subcontractor_compliance` : par prestataire et justificatif, état à jour, à renouveler (30 jours), périmé,
  manquant. **Avertissement, jamais blocage** (décision du 12/10).
- `scheduled_actions_generate()` prépare chaque nuit une demande de justificatifs par prestataire actif qui a une
  commande en cours ou à venir et un justificatif manquant, périmé ou à renouveler (une par mois au plus).

## Droits

- Prestataires et justificatifs : lecture avec « Voir les formateurs », écriture avec « Tenir le dossier des
  formateurs ».
- Bons de commande (montants) : « Voir et saisir les coûts des sessions ».
- Isolement par société sur les quatre tables ; fichiers par droits et par société.

## Écrans

- **Formation > Sous-traitants** : liste et état des justificatifs ; fiche avec identité, justificatifs (dépôt,
  ouverture par lien signé, suppression) et bons de commande (création, statut, PDF à signer).
- **Relances à valider** : les demandes de justificatifs y arrivent, texte prêt à envoyer.
- **Certification, indicateur 27** : état des justificatifs des prestataires.

## Recette

1. Ajouter un prestataire, déposer une attestation de vigilance datée de plus de six mois : état « Périmé ».
2. Créer un bon de commande de 2 jours à 3 000 € : montant 6 000 € HT, extrait d'immatriculation « Manquant ».
3. Télécharger le PDF du bon de commande.
4. Le lendemain (tâche de nuit), une demande de justificatifs dans « Relances à valider ».
