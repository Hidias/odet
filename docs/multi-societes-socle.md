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
