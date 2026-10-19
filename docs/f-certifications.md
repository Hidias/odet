# Certifications de la société (chantier F, migration 0350)

## Ce que ça fait

- **Toutes les certifications** (Certification › Toutes les certifications) : une ligne par référentiel
  (Qualiopi, déclaration d'activité, APSAD et NF Service I4NF285, référentiels propres à la société).
  Pour chacun : où en est la société (visée, dossier, audit planifié, obtenue, suspendue, retirée, refusée),
  certificateur, numéro, dates d'audit, validité, périmètre. La prochaine échéance s'affiche avec sa pastille.
- **Import d'un texte payant** (APSAD…) : l'outil ne fournit pas ce texte. La société colle le texte de son
  exemplaire (une exigence par ligne, « # » pour un chapitre, « code ; titre ; texte »). La base crée une copie
  propre à la société (code « apsad-i4nf285-xxxxxxxx »), invisible des autres sociétés. Remplacement refusé dès qu'une
  exigence importée a un suivi.
- **Garde des documents réservés aux certifiés** : `app.cert_valid(société, référentiel)` est vraie seulement si la
  certification est obtenue et en cours de validité. Tout futur document N4, Q4 ou portant une marque devra l'appeler
  en base avant d'être produit.
- **Erreurs à éviter** (onglet visible avec le droit « Voir le cockpit de direction » : super administrateur,
  administrateur, direction) : conseil interne. Liste de départ par société : APSAD A0 à A13, Qualiopi Q1 à Q15,
  déclaration d'activité N1 à N8, toutes « à confirmer ». La direction confirme, écarte, complète ou ajoute ses
  propres points. Jamais lue par un export, un PDF, un portail ni un document d'audit (test
  `tests/certification-face-interne.test.js`).

## Droits

| Table | Lire | Écrire |
|---|---|---|
| cert_referentials, cert_criteria, cert_indicators | communs : toutes les sociétés ; propres : la société | communs : super administrateur ; propres : la société (gérer la certification) |
| cert_company_certifications | gérer la certification | gérer la certification |
| cert_pitfalls | voir le cockpit de direction | voir le cockpit de direction |

## Retour arrière

`supabase/rollback/0350_certifications_generiques_retour.sql`. Refusé si une société a un référentiel propre ou si
des exigences APSAD ont été importées (sans la colonne company_id, elles deviendraient lisibles par toutes).

## Reste à faire

- Interventions (0354) : motif de remplacement obligatoire, numéro de série, opérations dues (5, 10, 15, 20 ans).
- « Préparer l'audit » : liste de contrôle avant l'audit, construite depuis les points confirmés.
- Création d'un référentiel interne depuis l'écran (aujourd'hui : import sur un référentiel commun « à saisir »).
