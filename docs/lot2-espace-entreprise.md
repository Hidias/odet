# Lot 2 : espace entreprise avec compte

Migration `0046_espace_entreprise.sql`, retour arrière `supabase/rollback/0046_espace_entreprise_retour.sql`, lot `l2_0046`.
Le lien avec code (carte « Accès entreprise » de la fiche client) reste pour les contacts sans compte.

## Principe

- Un compte au rôle **entreprise** est relié à un client et à un contact. Il n'a **aucun droit sur les tables** :
  toutes ses données passent par les fonctions `ent_*` de la base, qui commencent par la garde `app.ent_compte()`
  (compte actif, rôle entreprise, profil actif) et ne renvoient que son client.
- Options par compte : tous les sites ou certains, demander l'inscription de salariés, voir les factures.
- **Aucun email n'est envoyé par l'application** : à l'invitation, le lien pour choisir un mot de passe s'affiche et
  la personne qui invite le transmet depuis sa messagerie. Même chose pour un nouveau lien.

## Ce que voit l'entreprise (`/mon-entreprise`, téléphone d'abord)

- **Accueil** : formations à venir, échéances dépassées ou à prévoir, demandes en cours, actualités, coordonnées de
  l'organisme.
- **Formations** : sessions intra du client et ses groupes dans les inter (seulement ses salariés) ; documents :
  convention, convocations, émargement, attestations, certificats.
- **Salariés** : liste avec la validité de leurs formations ; matériel et exercices à échéance.
- **Demandes** : inscription à une session inter ouverte, formation dans ses locaux, remplacement, message ; réponse
  de l'organisme visible.
- **Plus** : catalogue et prochaines sessions inter, factures (si autorisé), actualités.
- Jamais de numéro de sécurité sociale, ni de donnée d'un autre client.

## Côté organisme

- Fiche client, carte **Comptes de l'espace entreprise** : inviter un contact, options, nouveau lien, désactiver.
  Droit « Gérer l'espace entreprise ».
- **Commerce > Espace entreprise** : demandes reçues (prendre en charge, traiter, refuser, réponse au client) et
  actualités publiées dans les espaces. Une notification arrive à chaque demande.

## Droits

- Comptes et sites des comptes : « Gérer l'espace entreprise ».
- Demandes : lues avec les clients, traitées par qui modifie les clients, créées seulement par `ent_demander`.
- Actualités : lues avec les clients, rédigées avec l'espace entreprise.

## Recette

1. Fiche d'un client fictif : inviter un contact avec une adresse de test, copier le lien affiché.
2. Ouvrir le lien en navigation privée, choisir un mot de passe : arrivée sur l'espace entreprise.
3. Vérifier formations, documents, salariés ; envoyer une demande ; la traiter dans Commerce > Espace entreprise.
4. Désactiver le compte : l'espace affiche que l'accès n'est pas actif.
