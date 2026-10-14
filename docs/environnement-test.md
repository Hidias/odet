# Environnement de test odet-test

But : ne plus jamais tester sur la production. Chaque branche autre que `main` est publiée par Vercel en **préversion** branchée sur la base **odet-test**, une copie de la production faite à partir d'une sauvegarde de nuit.

Tout se fait depuis GitHub web, Vercel et Supabase. Aucun terminal.

## 1. Ce qui est en place

| Élément | Production | Préversions |
|---|---|---|
| Base Supabase | odet-gld (`thcngystpaiamejoaejn`, Paris) | odet-test (`yqgqjqjtrspgeoqkunha`, Irlande) |
| Variables Vercel | onglet Production | onglet Preview |
| Emails | partent normalement | tous vers `EMAIL_TEST_TO`, objet `[TEST]` |
| Réseaux sociaux, Google Agenda | actifs | simulés, rien n'est publié ni écrit |
| Copie dans « Envoyés » (IMAP) | active | désactivée |
| Tâches planifiées (crons) | actives | **jamais** : Vercel ne les lance que sur la production |
| Bandeau rouge « ENVIRONNEMENT DE TEST » | non | oui |

Variables propres aux préversions (Vercel > projet odet > Settings > Environment Variables, onglet Preview) :

- `VITE_SUPABASE_URL`, `SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` : base odet-test ;
- `VITE_SUPABASE_PROD_URL` : adresse de la base de production. Si l'application n'est pas branchée dessus, le bandeau s'affiche. Cette variable n'existe pas en Production ;
- `EMAIL_MODE=test` et `EMAIL_TEST_TO` : adresse unique qui reçoit tous les emails des préversions.

Sécurité en plus : sur une préversion, le mode test s'active même si `EMAIL_MODE` est oubliée (Vercel indique lui-même qu'il s'agit d'une préversion). Sans `EMAIL_TEST_TO`, les envois sont refusés plutôt que de partir.

`ENCRYPTION_KEY` est la même en production et en préversion : obligatoire pour relire les mots de passe SMTP et les numéros de sécurité sociale de la copie.

## 2. Rafraîchir odet-test avec une sauvegarde plus récente

La restauration n'accepte qu'une base vide. Pour repartir d'une sauvegarde plus récente, il faut donc vider odet-test d'abord.

1. **Vider odet-test** : Supabase > odet-test > SQL Editor, exécuter :
   ```sql
   drop schema public cascade;
   create schema public;
   grant usage on schema public to anon, authenticated, service_role;
   delete from auth.users;
   ```
   puis Storage > supprimer chaque bucket. Le plus simple : demander à Claude, qui vérifie d'abord que la base visée est bien odet-test.
2. **Restaurer** : GitHub > Actions > **Restauration** > **Run workflow** :
   - *URL du projet* : `https://yqgqjqjtrspgeoqkunha.supabase.co`
   - *Numéro de l'exécution* : vide pour la sauvegarde la plus récente
   - *Confirmation* : `RESTAURER`
   Compter 3 à 5 minutes. La dernière étape affiche « OK : N tables identiques ligne pour ligne ».
3. **Réappliquer les migrations pas encore en production** (voir point 3).

Les secrets `RESTORE_DB_URL` et `RESTORE_SERVICE_ROLE_KEY` restent en place : ils pointent vers odet-test. Le workflow refuse l'adresse de la production.

## 3. Essayer une migration avant la production

1. Écrire la migration dans `supabase/migrations/` sur une branche (numéro du chantier).
2. L'appliquer sur **odet-test** (SQL Editor d'odet-test, ou Claude avec le connecteur Supabase en visant odet-test).
3. Tester sur la préversion de la branche (lien dans la pull request, bandeau rouge visible).
4. Le jour de la mise en production : fusionner la pull request, puis appliquer la même migration sur odet-gld (Console > Mises à jour de la base > Copier, puis SQL Editor d'odet-gld).

## 4. Vérification automatique

Le workflow **Vérification** (`.github/workflows/verification.yml`) tourne à chaque envoi sur une branche et sur chaque pull request :

- installation (`npm ci`) ;
- construction de l'application (`vite build`) ;
- tests (`npm test`, Vitest) : totaux de facture, d'avoir et de devis, cohérence avec Factur-X, échéances, références, résultats Qualiopi, heures de présence, redirection des emails de test, chargement de toutes les routes `/api`.

Les tests marqués « bug connu » décrivent un défaut existant : ils passent tant que le défaut est là, et deviennent rouges le jour où il est corrigé, pour penser à les transformer en tests normaux.

**Règle de fusion** (à activer le jour de la mise en production, pas avant) : GitHub > Settings > Branches > **Add branch ruleset** (ou *Add rule*) pour `main` : *Require status checks to pass*, cocher **verification**. Une pull request ne peut alors être fusionnée que si la vérification est verte.

## 5. Suivi des erreurs

Console > **Erreurs** (super administrateur) : erreurs regroupées, filtres, détail, « Marquer comme traitée », « Ignorer », « Copier pour Claude ». Une notification « Nouvelle erreur » arrive au super administrateur seulement. Les erreurs plus vues depuis 90 jours sont effacées automatiquement.

Migration : `0070_suivi_erreurs.sql`. Tant qu'elle n'est pas appliquée, l'application fonctionne normalement ; les erreurs ne sont simplement pas enregistrées.

## 6. Limites

- odet-test est en Irlande (offre gratuite, 2 projets au plus) : un peu plus lent que la production, sans incidence pour des tests.
- Les réglages Auth (Site URL, adresses de redirection) d'odet-test se règlent à la main : Authentication > URL Configuration. Ils doivent accepter les adresses de préversion `https://odet-*-hidias-projects.vercel.app/**`.
- Les secrets du coffre-fort Supabase (`cron_secret`, `app_url`) ne sont pas dans la sauvegarde : odet-test ne peut donc déclencher aucune tâche de la production.
