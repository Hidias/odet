# Sauvegarde et restauration de la base odet

Tout se fait depuis GitHub web, onglet **Actions** du dépôt. Aucun terminal.

## 1. Ce qui tourne chaque nuit

Le workflow **Sauvegarde de nuit** (`.github/workflows/sauvegarde-nuit.yml`) démarre à 3h17 en été, 2h17 en hiver (heure de Paris). Il fait deux choses :

1. **Export chiffré** de la base Supabase odet-gld :
   - rôles, schéma (tables, fonctions, déclencheurs, politiques RLS, droits), données de toutes les tables ;
   - comptes utilisateurs (`auth.users`, mots de passe chiffrés compris : chacun se reconnecte avec son mot de passe habituel) ;
   - politiques du Storage et déclencheur `on_auth_user_created` (absents de l'export standard de Supabase, ajoutés par `hors_public.sql`) ;
   - fichiers du Storage (logos, signatures, conventions signées...) avec leur inventaire ;
   - une empreinte de contrôle (`comptage.tsv`) : nombre de lignes par table, nombre de politiques, fonctions, déclencheurs, et empreinte exacte des droits.

   Le tout est compressé puis chiffré en AES-256 (GPG) avant de quitter la machine GitHub. Le fichier `odet-sauvegarde-AAAA-MM-JJ_HHMM` est gardé **30 jours** dans l'onglet Actions, puis supprimé automatiquement.

2. **Test de restauration** : l'export de la nuit est déchiffré et restauré dans un Supabase vierge monté sur la machine GitHub, puis comparé à l'empreinte. Une seule différence (une ligne, un droit, un fichier) fait échouer le test.

En cas d'échec de l'un ou l'autre, GitHub envoie un email. Une coche verte sur la ligne de la nuit veut dire : sauvegarde faite **et** restaurable.

**Pas sauvegardé** (à garder ailleurs, par exemple dans un gestionnaire de mots de passe) :
- les variables d'environnement Vercel (`ENCRYPTION_KEY`, `CRON_SECRET`, clés Google, etc.) ;
- les réglages Auth du tableau de bord Supabase (Site URL, URL de redirection, modèles d'emails) ;
- la phrase de chiffrement elle-même.

Attention : les mots de passe des comptes email (Paramètres > Comptes email) et les numéros de sécurité sociale sont chiffrés avec `ENCRYPTION_KEY`. Une base restaurée sans la même `ENCRYPTION_KEY` dans Vercel ne pourra plus les lire.

## 2. Mise en place (une seule fois)

Dans GitHub : dépôt `Hidias/odet` > **Settings** > **Secrets and variables** > **Actions** > **New repository secret**. Créer :

| Nom | Où le trouver |
|---|---|
| `SUPABASE_DB_URL` | Supabase > projet odet-gld > bouton **Connect** > **Session pooler** (port 5432). Remplacer `[YOUR-PASSWORD]` par le mot de passe de la base. Mot de passe oublié : Settings > Database > **Reset database password** (sans risque : l'application ne l'utilise pas, elle passe par les clés API). |
| `SUPABASE_SERVICE_ROLE_KEY` | Même valeur que dans Vercel (Supabase > Settings > API Keys > `service_role`). Sert à lire les fichiers du Storage. |
| `BACKUP_PASSPHRASE` | Une phrase longue inventée (5 mots ou plus). **La noter aussi dans un gestionnaire de mots de passe** : sans elle, aucune sauvegarde n'est lisible, par personne. |

Le pooler de session est obligatoire : les machines GitHub n'ont pas d'IPv6, et la connexion directe de Supabase (`db.xxx.supabase.co`) est en IPv6.

Puis lancer un premier essai : **Actions** > **Sauvegarde de nuit** > **Run workflow**. Compter 5 à 8 minutes. Les deux étapes doivent être vertes.

## 3. Surveillance

- Rien à faire tant que les coches sont vertes.
- Email d'échec ou croix rouge : ouvrir l'exécution, lire l'étape en rouge. Causes probables : mot de passe de la base changé (mettre à jour `SUPABASE_DB_URL`), clé `service_role` changée, projet Supabase en pause.
- Un échec du **test de restauration** alors que l'export est vert veut dire que l'export n'est pas fiable : à traiter avant toute autre chose.

## 4. Télécharger une sauvegarde

**Actions** > **Sauvegarde de nuit** > cliquer sur la nuit voulue > en bas, section **Artifacts** > télécharger `odet-sauvegarde-...`. Le zip contient le fichier `.tar.gz.gpg` (chiffré) et son empreinte `.sha256`. Il n'est lisible qu'avec la phrase de chiffrement.

## 5. Restaurer (projet Supabase perdu, supprimé ou corrompu)

La restauration se fait **toujours dans un projet Supabase neuf**. Le script refuse une base qui contient déjà des tables, et le workflow refuse l'URL de la production : impossible d'écraser odet-gld par erreur.

1. **Créer le projet** : Supabase > New project, région **West EU (Paris)**, Postgres 17. Noter le mot de passe de la base.
2. **Créer deux secrets** dans GitHub (même écran qu'au point 2) :
   - `RESTORE_DB_URL` : chaîne **Session pooler** du nouveau projet, mot de passe inclus ;
   - `RESTORE_SERVICE_ROLE_KEY` : clé `service_role` du nouveau projet.
3. **Lancer** : **Actions** > **Restauration** > **Run workflow** :
   - *URL du projet Supabase NEUF* : `https://<ref-du-nouveau-projet>.supabase.co` ;
   - *Numéro de l'exécution* : vide pour la sauvegarde la plus récente, ou le numéro visible dans l'adresse de la page de la nuit voulue (`.../actions/runs/<numéro>`) ;
   - *Confirmation* : `RESTAURER`.
   Compter 3 à 5 minutes. La dernière étape affiche « OK : N tables identiques ligne pour ligne ».
4. **Réglages Auth** du nouveau projet (Authentication > URL Configuration) : reprendre la Site URL et les URL de redirection de l'ancien projet.
5. **Basculer Vercel** (projet `odet` > Settings > Environment Variables), puis **Redeploy** :
   - `VITE_SUPABASE_URL` et `SUPABASE_URL` : nouvelle URL ;
   - `VITE_SUPABASE_ANON_KEY` : nouvelle clé `anon` ;
   - `SUPABASE_SERVICE_ROLE_KEY` : nouvelle clé `service_role` ;
   - **ne pas toucher** `ENCRYPTION_KEY`.
6. **Vérifier** : se connecter, ouvrir une session, un PDF, le portail stagiaire d'une session, l'espace entreprise. Les utilisateurs déjà connectés devront se reconnecter (le nouveau projet a une autre clé de signature).
7. **Remettre la sauvegarde sur la nouvelle production** : dans `sauvegarde-nuit.yml` et `restauration.yml`, remplacer `thcngystpaiamejoaejn` par la référence du nouveau projet ; mettre à jour `SUPABASE_DB_URL` et `SUPABASE_SERVICE_ROLE_KEY` ; supprimer les secrets `RESTORE_*`.

## 6. Retrouver des données effacées par erreur

Pour récupérer quelques lignes (une session supprimée, un client écrasé) sans toucher la production :

1. Faire les étapes 1 à 3 du point 5 dans un **projet temporaire** (offre gratuite : 2 projets actifs au maximum, mettre en pause un autre projet si besoin).
2. Dans le SQL Editor du projet temporaire, retrouver les lignes voulues et les copier dans la production (ou demander à Claude de préparer le script de recopie).
3. Supprimer le projet temporaire et les secrets `RESTORE_*`.

## 7. Tests réalisés (12/10/2026)

Cycle complet sur une copie locale de Supabase (Postgres 17.11, CLI 2.120.0), base montée avec les 23 migrations d'odet, la session de démo, un compte utilisateur et deux fichiers Storage :

- sauvegarde, puis base remise à zéro, puis restauration : 153 lignes de contrôle identiques (tables, politiques, fonctions, déclencheurs, empreintes des droits) ;
- connexion avec le mot de passe d'origine ; session de démo lue par ce compte ; fichier d'une convention signée relu ;
- droits identiques à la production : `anon` ne lit pas `trainees` (erreur 42501) et n'a pas de droit complet sur `sessions`. Point corrigé pendant le test : un projet neuf donne par défaut tous les droits à `anon`, le script les neutralise avant de recréer le schéma ;
- création d'un nouvel utilisateur après restauration : son profil est bien créé (déclencheur restauré) ;
- restauration refusée sur une base non vide ; mauvaise phrase de chiffrement : échec immédiat ;
- requêtes de contrôle et d'export des objets auth/storage exécutées sur la production (59 politiques Storage, 1 déclencheur auth, 216 politiques public, 115 fonctions, 58 déclencheurs).

Le test de restauration du workflow rejoue ce contrôle chaque nuit sur la vraie sauvegarde.

## 8. Limites connues

- Les machines GitHub sont aux États-Unis. Les données y transitent quelques secondes avant chiffrement ; le fichier stocké est chiffré.
- Perte maximale : les saisies depuis la dernière sauvegarde (moins de 24 h).
- Quota GitHub gratuit : 2 000 minutes par mois pour les dépôts privés ; une nuit consomme environ 8 minutes, soit environ 250 minutes par mois.

## Fichiers

- `scripts/sauvegarde/sauvegarder.sh` : export, comptage, Storage, chiffrement.
- `scripts/sauvegarde/restaurer.sh` : contrôle de la cible, déchiffrement, restauration en une transaction, Storage, comparaison.
- `scripts/sauvegarde/storage.mjs` : téléchargement et renvoi des fichiers du Storage.
- `scripts/sauvegarde/comptage.sql` : empreinte de contrôle.
- `scripts/sauvegarde/hors_public.sql` : politiques et déclencheurs des schémas auth et storage.
