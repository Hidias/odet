# Droits composés par société (chantier C1b)

Spec complète, choix et compte rendu : `claude/odet-droits-composes.md` (Projet Claude). Catalogue et droits de chaque profil : `docs/droits-catalogue.md` (généré).

## En une phrase

Une règle d'accès demande un **droit nommé** à une seule fonction de la base, `app.a_le_droit(code)` (« le compte connecté a le droit X dans la société courante ») ; un profil est une liste de droits ; une personne a, dans chaque société, un profil de base (son rôle d'appartenance), des profils en plus et des droits accordés ou retirés. L'application lit les mêmes droits par `my_rights()`.

## Fichiers

| Fichier | Rôle |
|---|---|
| `scripts/securite/droits.py` | Catalogue des droits et profils types (à modifier pour ajouter un droit ou un profil) |
| `scripts/securite/regles.py` | Matrice des règles : chaque case porte le nom de son droit ; écrit 0082 (rôles, inchangée), 0273, 0372 (catalogue), 0373 (règles par droits), le retour arrière et `docs/droits-catalogue.md` |
| `supabase/migrations/0370` à `0375` | Tables, fonctions, catalogue, règles, prix cachés au technicien, circuit de validation |
| `supabase/rollback/0370-0375_droits_retour.sql` | Retour arrière unique (généré) |
| `scripts/securite/essai_droits.py` | Écrit les deux essais en transaction annulée et le fichier d'application |
| `scripts/securite/base_locale.py` | Base PostgreSQL locale qui rejoue toutes les migrations dans l'ordre de la production |
| `src/core/rights/rights.js` | Lecture des droits par l'application (null tant que les migrations ne sont pas appliquées : rien ne change) |

## Ajouter une table ou un droit

1. Le droit dans `droits.py` (code `domaine.objet.action`, libellé, ce qu'il permet, données, drapeaux `siens`, `prix`, `licence`, `plateforme`).
2. La table dans la matrice de `regles.py` avec `D('domaine.objet.action', rôles)` pour chaque action.
3. `python3 scripts/securite/regles.py` puis relire la différence ; un cas dans `supabase/tests/droits_chantier2.sql`.

## Mise en production (H, éditeur SQL d'odet-gld)

1. `supabase/tests/essai_c1b_transaction_annulee.sql` → « 284 test(s), 0 échec(s) ».
2. `supabase/tests/essai_retour_c1b_transaction_annulee.sql` → « 0 écart(s) ».
3. Recette de la préversion : rien ne doit changer à l'écran.
4. `supabase/application/c1b_0370-0375_odet-gld.sql` → « Success ».
5. `supabase/tests/droits_chantier2.sql` → « 284 test(s), 0 échec(s) ».
6. Fusion de la PR, déploiement, recette de production.

## Essais locaux

```
python3 scripts/securite/regles.py && python3 scripts/securite/essai_droits.py
python3 scripts/securite/base_locale.py --hote <socket> --port <port> --jusqu-a 0273 \
  --fichier supabase/tests/essai_c1b_transaction_annulee.sql
```
Résultats du 18/10 : 284 / 284, 1 738 couples compte-table lus à l'identique avant et après (seuls les prix du technicien disparaissent), retour arrière 0 écart.
