# Performance des droits (migration 0090)

## Constat (19/10, production, compte simulé, transaction annulée)

| Lecture | Avant |
|---|---|
| clients (38 lignes, forme exacte de PostgREST, société choisie) | 384 ms d'exécution + 94 ms de préparation |
| dont « sociétés lisibles » (règle restrictive) | 195 ms |
| dont « a le droit » (règle par droits) | 123 ms |
| pg_stat_statements, moyenne | clients ≈ 380 ms, trainees ≈ 290 ms, courses ≈ 260-280 ms, sessions ≈ 245 ms |

Les règles étaient déjà évaluées une fois par requête (InitPlan) ; chaque règle refaisait en revanche tout le calcul :
rôle, sociétés visibles (appelées trois fois par la société courante), société courante, droits, à travers des
fonctions SQL imbriquées et non dépliables (sécurité définie), replanifiées à chaque requête.

Index : `company_id` et `company_ids` déjà indexés sur toutes les tables de plus de 50 lignes ; colonnes des
conditions (appartenances, profils, droits, visites du technicien) indexées. Rien à ajouter.

## Correctif

Les sept fonctions de base (`app.role`, `app.rights`, `app.current_company`, `app.vue_groupe`,
`app.visible_companies`, `app.societes_lisibles`, `app.societes_ecriture`) gardent nom, signature et résultat.
Le calcul d'origine est recopié tel quel dans `app.<nom>_calc()`. La fonction lit d'abord un cache de transaction
(`app.m_<nom>`, réglage local effacé à la fin de chaque requête), sinon calcule et range.

Clé du cache (`app.ctx_cle`) : identité (jeton), en-têtes de la requête (société choisie, vue groupe), rôle de la
requête et compteur `app.droits_gen`. Ce compteur est augmenté par un déclencheur sur chaque table dont dépend le calcul
(comptes, techniciens, modules, appartenances, profils et droits, sociétés, offres, accès de support) : une écriture
dans la même transaction invalide le cache.

## Preuves

- Tests de droits complets : 470 / 470.
- Tous les comptes de la base locale × toutes les tables publiques (3 375 couples, dans une seule transaction qui change
  d'identité à chaque compte) : nombre de lignes lues identique avant et après.
- Retour arrière : 0 écart (`supabase/rollback/0090_cache_droits_retour.sql`, définitions d'origine).

## Mesures après

Voir le journal de production (`claude/odet-journal-production.md`, 19/10 après-midi).
