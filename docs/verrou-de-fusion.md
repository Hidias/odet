# Verrou de fusion sur main

Décisions de H : 29/10/2026 (feu vert obligatoire après trois fusions anticipées) et 04/11/2026 (verrou remis, avec le contrôle des migrations).

## Ce que fait le verrou
Le circuit `.github/workflows/feu-vert.yml` lance deux contrôles quand l'étiquette « feu-vert » est posée sur une PR
vers main. Depuis le 05/11/2026 (décision de H, sobriété), rien ne tourne à l'ouverture de la PR ni à la pose d'une autre
étiquette : sans règle de dépôt, ces passages ne faisaient qu'échouer d'avance. Un nouveau commit retire l'étiquette
(passage vert, sans échec) ; il faut la reposer après relecture.

| Contrôle | Vert quand | Rouge quand |
|---|---|---|
| `feu-vert` | l'étiquette « feu-vert » est posée | ne tourne pas sans l'étiquette ; un nouveau commit la retire d'office |
| `migrations-en-base` | la PR n'a pas de migration, ou chaque migration de la PR figure au registre de production | une migration ne s'inscrit pas au registre, ou n'est pas encore appliquée en production, ou le secret `SUPABASE_DB_URL` manque |

Les deux contrôles tournent avec le circuit de main (`pull_request_target`) : une PR ne peut pas modifier le contrôle qui la juge ; les fichiers de la PR sont seulement lus. Conséquence : la PR qui installe le verrou n'est pas contrôlée elle-même, les contrôles apparaissent à partir de la PR suivante.

Le second contrôle ne fait qu'une lecture (`select` sur `public.schema_migrations`, transaction en lecture seule).
Chaque migration s'inscrit elle-même au registre par sa dernière ligne :
`insert into public.schema_migrations (version) values ('NNNN_nom') on conflict (version) do nothing;`

## Ordre pour une PR avec migration
1. Relecture automatique terminée et corrigée.
2. « Fenêtre Supabase à valider maintenant » : la migration est appliquée, les empreintes sont comparées.
3. L'étiquette « feu-vert » est posée : `feu-vert` et `migrations-en-base` tournent et passent au vert (rouge si la migration n'est pas en base).
4. H fusionne.

## Règle de dépôt : non retenue (décision de H du 04/11/2026)
Aucune règle de dépôt n'exige ces contrôles : l'étiquette « feu-vert » est la signature de la production après
relecture, et la fusion suit sa pose. Si `migrations-en-base` est rouge au moment de la pose (migration pas encore en
base) : appliquer la migration, puis relancer le contrôle (« Re-run » de l'exécution) ou retirer et reposer l'étiquette.
Retirer l'étiquette seule ne relance plus rien.
