# Lot 2, sessions inter et groupes (migration 0044)

Spec : `odet-lot2-spec.md` v2, section 4. Lot : `l2_0044`. Retour arrière : `supabase/rollback/0044_inter_groupes_retour.sql`.

## Base
- `sessions.session_type = 'inter'` (texte libre) ; l'ancien regroupement `inter_group_id` reste lu (0 session concernée).
- `session_groups` : nature (entreprise, particulier ; `is_individual` recopié pour l'ancien code), site, payeur et son
  client, numéro de dossier, document (à envoyer, envoyé, signé, dates tenues par la base), fin de rétractation, origine,
  facture du groupe (reliée par la base à la création de la facture).
- `session_trainees.cpf_dossier_number`, `session_fundings.group_id`, `invoices.session_group_id`.
- `inter_requests` : demandes de la page publique (écrites plus tard par une fonction publique ; page publique livrée après
  le choix de l'hébergement) ; lues et traitées par qui inscrit.
- Particulier qui paie lui-même [OFFICIEL, code.travail.gouv.fr, 14/10/2026] : fin de rétractation = signature + 10 jours
  (L6353-5) ; paiement refusé par la base avant cette date, puis au-delà de 30 % du prix avant le début de la formation
  (L6353-6). Testé.

## Application
- Création de session : case « Session inter » (client principal facultatif).
- Fiche session inter : onglet « Groupes » (entreprise ou particulier, payeur, dossier, prix du groupe ou par personne,
  stagiaires rattachés, convention ou contrat envoyé puis signé, rétractation affichée, « Facturer ce groupe »).
- Contrat de formation du particulier (PDF, mentions L6353-4, rétractation L6353-5, paiements L6353-6, force majeure
  L6353-7) : même générateur que la convention.
- Facture préparée pour un groupe : ses stagiaires, son client (ou son financeur pour le compte du client), son prix ;
  facture reliée au groupe.

## Reste
- Convention par groupe (aujourd'hui : convention de la session) et émargement filtré par groupe ; convocations,
  attestations et certificats filtrables par groupe.
- Page publique d'inscription aux inter (après le choix de l'hébergement) et écran des demandes.
