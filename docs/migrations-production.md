# Migrations en production (action GitHub)

L'action « Migrations en production » (`.github/workflows/migrations.yml`) applique un lot de migrations sur la base
de production sans passer par l'éditeur SQL de Supabase. Elle utilise le secret `SUPABASE_DB_URL`, le même que la
sauvegarde de nuit : rien à créer en plus.

## Décrire un lot

Un fichier `supabase/lots/<lot>.conf`, une clé par ligne :

| Clé | Rôle |
|-----|------|
| `ESSAI` | essai en transaction annulée, se termine par « N test(s), M échec(s) » |
| `RETOUR_ESSAI` | essai du retour arrière en transaction annulée, se termine par « N écart(s) » |
| `APPLICATION` | application réelle, une seule transaction, sans BEGIN ni COMMIT (vide : lot d'essai seul) |
| `RETOUR` | retour arrière réel, joué automatiquement si les tests échouent après l'application |
| `TESTS` | tests rejoués après l'application (par défaut `supabase/tests/droits_chantier2.sql`) |

Le lot `temoin` n'applique rien : il rejoue les tests de droits sur la production telle qu'elle est.

## Lancer

- Onglet Actions › Migrations en production › Run workflow : nom du lot, mode `essai` ou `appliquer`.
- Ou, sur une PR dont la description contient une ligne `Lot : <nom>`, poser l'étiquette `migration:essai` ou
  `migration:appliquer`. Le résultat arrive en commentaire de la PR et l'étiquette est retirée.

## Ce que fait l'action

1. Refuse de continuer si la dernière sauvegarde de nuit n'est pas verte ou a plus de 30 heures.
2. Joue l'essai puis l'essai du retour arrière ; il faut au moins un test, 0 échec et 0 écart.
3. En mode `appliquer`, applique le fichier d'application en une seule transaction.
4. Rejoue les tests ; s'ils ne sont pas tous verts, joue immédiatement le retour arrière et finit en rouge.

L'adresse de la base n'apparaît jamais dans les journaux (elle est masquée par GitHub et par le script).

## Incident du 19/10/2026 : 0312 retirée par l'Action après une course

L'application de la 0312 (PR #98) a été retirée automatiquement : le second passage des tests de droits a compté un
échec sur la pastille « Quoi de neuf » (0262), parce que deux nouveautés ont été publiées pendant la transaction de
test. Ce n'était pas un défaut de la 0312. Elle est réappliquée par une PR dédiée (« Lot : rh_0312 »).
Règle : ne rien publier dans « Quoi de neuf » pendant qu'une Action de migration tourne.
