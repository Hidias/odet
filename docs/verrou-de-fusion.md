# Verrou de fusion sur main

Décisions de H : 29/10/2026 (feu vert obligatoire après trois fusions anticipées) et 04/11/2026 (verrou remis, avec le contrôle des migrations).

## Ce que fait le verrou
Le circuit `.github/workflows/feu-vert.yml` lance deux contrôles sur chaque PR vers main :

| Contrôle | Vert quand | Rouge quand |
|---|---|---|
| `feu-vert` | l'étiquette « feu-vert » est posée | pas d'étiquette, ou nouveau commit poussé depuis (l'étiquette est alors retirée d'office) |
| `migrations-en-base` | la PR n'a pas de migration, ou chaque migration de la PR figure au registre de production | une migration ne s'inscrit pas au registre, ou n'est pas encore appliquée en production, ou le secret `SUPABASE_DB_URL` manque |

Le second contrôle ne fait qu'une lecture (`select` sur `public.schema_migrations`, transaction en lecture seule).
Chaque migration s'inscrit elle-même au registre par sa dernière ligne :
`insert into public.schema_migrations (version) values ('NNNN_nom') on conflict (version) do nothing;`

## Ordre pour une PR avec migration
1. Relecture automatique terminée et corrigée.
2. « Fenêtre Supabase à valider maintenant » : la migration est appliquée, les empreintes sont comparées.
3. L'étiquette « feu-vert » est posée : les deux contrôles repartent et passent au vert.
4. H fusionne.

## Réglage à faire une fois par H (règle de dépôt)
Sans cette règle, les contrôles s'affichent en rouge mais le bouton de fusion reste utilisable.

1. Sur GitHub, ouvrir le dépôt Hidias/odet, puis **Settings**.
2. Menu de gauche : **Rules**, puis **Rulesets**, puis **New ruleset** et **New branch ruleset**.
3. **Ruleset name** : `Feu vert obligatoire`. **Enforcement status** : `Active`.
4. **Bypass list** : laisser vide (personne en dérogation).
5. **Target branches** : **Add target**, puis **Include default branch** (main).
6. Cocher **Require status checks to pass**, puis **Add checks** et ajouter `feu-vert` et `migrations-en-base`
   (ils apparaissent dans la liste dès qu'une PR les a lancés une fois, par exemple la PR qui installe ce verrou).
7. Laisser cochée **Block force pushes**. Ne rien cocher d'autre.
8. **Create**.

Vérification : sur une PR sans étiquette, le bouton de fusion doit être grisé avec « Required statuses must pass ».

## Si un jour il faut fusionner en urgence
Poser l'étiquette ne suffit pas si une migration n'est pas en base : c'est voulu. Appliquer d'abord la migration.
Seul H peut désactiver la règle (Settings, Rules, Rulesets, `Feu vert obligatoire`, Enforcement status : `Disabled`).
