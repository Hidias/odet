# Socle multi-sociétés (chantier C1a)

Migrations 0270 à 0273. Spec : `odet-multi-entreprise-spec.md` v2 (projet Claude), § 11.

## Ce que le socle apporte

- `companies` (sociétés), `company_establishments` (établissements), `company_members` (appartenances, rôle par société),
  `company_member_roles` (plusieurs profils de droits par personne et par société, vide, pour C1b), `company_modules`
  (modules par société), `support_access_grants` (fenêtres d'accès de support à la demande).
- Société courante : en-tête `x-company-id` lu par `app.current_company()` et contrôlé contre les sociétés visibles du
  compte ; une valeur non autorisée retombe sur la société par défaut, jamais sur une autre.
- Société n° 1 créée depuis les réglages de l'organisme ; appartenances et modules repris de l'existant ; recopies à sens
  unique (réglages → société n° 1, profils → appartenances, modules installés → modules de la société n° 1) jusqu'aux
  écrans de C3.
- Accès de support de l'éditeur : `permanent`, `on_demand` (défaut du produit, fenêtre ouverte par l'administrateur de la
  société, 24 h par défaut) ou `none`. Le mode ne change que par l'administrateur de la société
  (`company_set_support_mode`). Le super administrateur n'a pas d'appartenance.
- Trace : chaque lecture de données métier par le super administrateur est envoyée par lots à `support_trace` et écrite
  au journal d'audit (société, mode, fenêtre, tables, page sans recherche ; jamais de valeur). La base ne peut pas
  écrire pendant une lecture (PostgREST lit en lecture seule) : la trace part de l'application
  (`src/core/company/companyContext.js`).
- `app.role()` n'est pas modifiée : les règles des tables métier sont celles du chantier 2. Aucun changement visible.

## Règle pour toute nouvelle table

Toute table créée après 0273 naît avec une colonne `company_id` (contrôlé par `supabase/tests/droits_chantier2.sql`,
à partir de la photographie `app.tables_avant_societes`). Les tables existantes sont rattachées par C2.

## Fichiers

| Fichier | Rôle |
|---|---|
| `supabase/migrations/0270` à `0272` | tables, fonctions, reprise et recopies |
| `supabase/migrations/0273_societes_regles.sql` | GÉNÉRÉ par `scripts/securite/regles.py` (matrice `MS`) |
| `supabase/instances/odet-gld/c1a_acces_support_permanent.sql` | réglage propre à l'instance GLD : accès de support permanent (décision du 17/10/2026) |
| `supabase/rollback/0270-0273_societes_retour.sql` | retour arrière des quatre migrations |
| `supabase/tests/droits_chantier2.sql` | tests de droits, bloc C1a en fin de script (joué si `companies` existe) |
| `supabase/tests/essai_c1a_transaction_annulee.sql` | GÉNÉRÉ par `scripts/securite/essai_societes.py` : migrations et tests, tout annulé |
| `supabase/tests/essai_retour_c1a_transaction_annulee.sql` | GÉNÉRÉ : photographie, migrations, retour arrière, comparaison, tout annulé |
| `supabase/application/c1a_0270-0273_odet-gld.sql` | GÉNÉRÉ : application réelle en un envoi |

## Procédure (éditeur SQL de Supabase, projet odet-gld)

1. Sauvegarde de nuit du jour verte (GitHub › Actions › « Sauvegarde de nuit »).
2. Coller `supabase/tests/essai_c1a_transaction_annulee.sql`, Run. Attendu : erreur volontaire
   « RÉSULTAT DES TESTS DE DROITS … 0 échec(s) » (202 tests au 18/10 sur une base comme la production).
3. Coller `supabase/tests/essai_retour_c1a_transaction_annulee.sql`, Run. Attendu : « 0 écart(s) ».
4. Application : coller `supabase/application/c1a_0270-0273_odet-gld.sql`, Run. Attendu : succès. Les quatre migrations
   s'enregistrent dans `public.schema_migrations`.
5. Fusionner la PR, attendre le déploiement Vercel de production.
6. Rejouer `supabase/tests/droits_chantier2.sql` : attendu « 0 échec(s) ».
7. En cas de problème : `supabase/rollback/0270-0273_societes_retour.sql` (le code de l'application reste compatible
   avec une base sans socle : la trace s'arrête d'elle-même si `support_trace` n'existe pas).

## Rattachement des données existantes (chantier C2, migrations 0274 et 0275)

Générées par `scripts/securite/societes_c2.py` (classes de la spec § 3, liste relue dans `odet-c1a-socle.md` § 6).

- **0274** : `company_id` non nul, clé étrangère vers `companies`, index, sur 124 tables (classes A et B) et
  `company_ids` (sociétés qui voient la fiche) sur 30 tables partageables (classe C). Lignes existantes rattachées à la
  société qui porte l'instance. Défaut d'une création : `app.company_default()` (société courante, sinon société n° 1
  pour les tâches et les portails). Lignes filles : société recopiée du parent par déclencheur (`app.societe_du_parent`),
  le parent fait foi. Fiches partageables : la société d'origine figure toujours dans `company_ids`.
  L'ajout de colonne avec valeur par défaut remplit les lignes sans passer par les déclencheurs (verrou des factures
  émises intact).
- **0275** : quatre règles **restrictives** par table, ajoutées aux règles du chantier 2 et de C1b (qui décident
  toujours qui voit quoi) : lecture des sociétés lisibles (`app.societes_lisibles()` : appartenances ; super
  administrateur : sociétés ouvertes au support ; comptes externes : toutes, leurs règles propres les limitant à leurs
  objets), écriture dans la société courante (`app.societes_ecriture()`). Les tables du serveur seul (aucune règle pour
  les comptes) restent fermées sans règle ajoutée.
- Avec une seule société, aucun accès ne change. Tests : bloc C2 de `droits_chantier2.sql` (isolement entre deux
  sociétés, création rattachée à la société courante, création forcée ailleurs refusée, ligne fille, fiche partagée,
  super administrateur sans support, compte externe).
- Retour arrière : `supabase/rollback/0274-0275_societes_retour.sql` (refusé s'il existe plus d'une société).
- **0276** (généré par `scripts/securite/societes_c2_fonctions.py` à partir des définitions de production) : les
  fonctions `security definer` qui traitent un objet (facture, devis, visite, stagiaire, client, fichier du Passeport)
  vérifient sa société (`app.exiger_societe`) ; `app.can_read_session`, `app.can_edit_session` et
  `app.itv_can_edit_visit_parts` (feuilles d'émargement, tests, pièces de visite, stockage) aussi ; les comptages et
  listes (journal d'audit, handicap, PSH, tableau de bord des interventions, purge, Passeport) ne lisent que les
  sociétés du compte ; alertes de complétude rattachées à la société de l'élément. Tâches du serveur non concernées.
- Reste, traité avec C3 (visible seulement à partir de deux sociétés) : routes `/api` à clé de service (lecture de
  l'objet sous la session de l'appelant avant traitement), numérotation des sessions et devis par société, identité des
  PDF et emails par société, rangement des nouveaux fichiers par société, échéances de certification par société
  (`cert_settings` est aujourd'hui une ligne unique).

## Interface multi-sociétés (chantier C3, migration 0277)

Générée par `scripts/securite/societes_c3.py` (fonctions existantes lues en base locale, modifications vérifiées).

- **Vue groupe** : en-tête `x-company-id: groupe`, réservée aux appartenances « vue groupe » ; société courante vide,
  toute écriture refusée (règles de C2 et routes `/api`), droits = ceux que le compte a dans toutes ses sociétés.
- **Modules par société** : `app.module_on` = installé sur l'instance et actif dans la société courante.
- **Création d'une société** : `company_create` (plateforme) en une fois : société, siège, modules, réglages de
  facturation, premières appartenances. Accès et modules ensuite par `company_member_set` et `company_module_set`
  (administrateur de la société ou plateforme), écrits au journal.
- **Identité par société** : `app.identite_societe` (réglages de l'organisme pour la société de l'instance, fiche de
  la société sinon) pour le contrôle et l'émission des factures (vendeur figé), le Factur-X (`getOrgForCompany`), les
  initiales des sessions ; à l'écran, `company_identity` remplace l'identité de l'organisme pour les documents.
- **Numérotation** : numéros uniques par société (factures, devis, sessions) ; compteur et reprise des factures par
  société.
- **Comptes** : un compte rattaché à une autre société n'est plus ajouté d'office à la société de l'instance.
- **Écran** : sélecteur dans l'en-tête et écran de choix (plusieurs sociétés), bandeau de la vue groupe,
  Paramètres › Sociétés (liste, fiche, modules, accès, assistant en quatre étapes avec l'annuaire officiel),
  « Pour quelle société ? » sur la fiche client. La société choisie est envoyée aussi aux routes `/api`.
- Avec une seule société, rien ne s'affiche de nouveau.
- Reste (petit, sans effet tant qu'il n'y a qu'une société) : rangement des nouveaux fichiers par société, échéances de
  certification par société, défauts de partage réglables (aujourd'hui : société courante seule).
