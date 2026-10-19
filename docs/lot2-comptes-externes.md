# Lot 2 : comptes formateur externe et stagiaire

Migration `0047_comptes_externes.sql`, retour arrière `supabase/rollback/0047_comptes_externes_retour.sql`, lot `l2_0047`.

## Principe

Comme le compte entreprise, ces comptes n'ont **aucun droit sur les tables** : leurs données passent par des fonctions
de la base (`ext_*`, `stg_*`) qui commencent par une garde (rôle, compte actif, fiche reliée) et ne renvoient que leur
périmètre. Aucun email n'est envoyé par l'application.

- **Formateur externe** (rôle `formateur_externe`, `profiles.trainer_id`) : `/mon-espace`, ses sessions comme formateur
  principal ou associé (dates, lieu, salle, client, stagiaires, objectifs et programme, matériel, feuille
  d'émargement), ses certificats et, s'il est rattaché à un prestataire, l'état des justificatifs de celui-ci. Jamais
  de prix, de facture ni de numéro de sécurité sociale. Compte créé depuis la fiche du formateur externe (droit
  « Gérer les formateurs »), lien affiché à transmettre.
- **Stagiaire** (rôle `stagiaire`, `profiles.trainee_id`, unique) : `/mon-espace`, ses formations, attestation de
  présence et certificat de réalisation, lien vers son espace de session (émargement, évaluations). Compte créé :
  - par le stagiaire lui-même depuis son espace de session (« Créer mon compte »), après le code de sa convocation :
    le serveur vérifie le ticket du portail, refuse si la fiche a déjà un compte ou si l'adresse est prise ;
  - ou depuis la fiche stagiaire (droit « Modifier les stagiaires »), lien affiché à transmettre.

## Sécurité corrigée au passage

- La règle de lecture des profils devient « sa propre ligne, ou le droit de voir les comptes » (matrice
  `regles.py`). Sans elle, un compte externe ne lisait pas son profil et l'application le déconnectait (le compte
  entreprise de 0046 en avait besoin aussi).
- `profiles.trainer_id`, `trainee_id` et `is_active` ne se changent que par un compte qui gère les utilisateurs, ou
  par le serveur : un compte qui voit les profils ne peut plus se relier à une autre fiche ni se réactiver lui-même.
- `base_locale.py` : l'ordre de production rejouait 0041 et suivantes avant le socle multi-sociétés (plage 0001-0051) ;
  corrigé (0001-0040, puis 0050 et 0051).

## Recette

1. Fiche d'un formateur externe fictif : « Créer son accès » avec une adresse de test, lien affiché.
2. Ouvrir le lien en navigation privée : espace formateur, sessions sans prix, justificatifs.
3. Portail d'une session fictive, code d'un stagiaire : « Créer mon compte », puis connexion : ses formations et
   documents.
