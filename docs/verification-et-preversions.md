# Vérification automatique, préversions et suivi des erreurs

## 1. Méthode d'essai (décision du 14/10/2026)

Pas de base de test séparée. Les migrations sont additives et s'essaient **sur la production, dans une transaction annulée** (`begin; … rollback;`) avec les tests de droits, après avoir vérifié que la sauvegarde de nuit est verte. L'application réelle se fait après recette, avec l'accord écrit de la direction.

## 2. Préversions Vercel

Chaque branche autre que `main` est publiée en préversion. **Une préversion travaille sur la base de production** : créer, modifier ou supprimer une fiche depuis une préversion le fait pour de vrai. Seuls les effets vers l'extérieur sont neutralisés :

| Effet | Production | Préversion |
|---|---|---|
| Emails (toutes les routes `/api/send-*`, campagnes, relances, alertes) | partent normalement | tous vers `EMAIL_TEST_TO`, objet préfixé `[TEST]`, destinataires d'origine rappelés en tête |
| Copie dans le dossier « Envoyés » (IMAP) | active | désactivée |
| Publications réseaux sociaux (manuelle et programmée) | actives | simulées, rien n'est publié |
| Écritures Google Agenda | actives | simulation forcée |
| Liens dans les emails | `APP_URL` | adresse de la préversion |
| Tâches planifiées (crons) | actives | jamais : Vercel ne les lance que sur la production |

Le mode test s'active si `EMAIL_MODE=test` **ou** si Vercel indique une préversion (`VERCEL_ENV=preview`) : une préversion reste protégée même si la variable est oubliée. Sans `EMAIL_TEST_TO`, l'envoi est refusé plutôt que de partir. Code : `api/_lib/mailer.js` (`isTestEnvironment`, `applyTestRedirect`).

Variables Vercel (onglet Preview) : `EMAIL_MODE=test`, `EMAIL_TEST_TO`.

## 3. Vérification automatique

Workflow **Vérification** (`.github/workflows/verification.yml`), à chaque envoi sur une branche et à chaque pull request : `npm ci`, `vite build`, `npm test` (Vitest).

Tests (`tests/`) :
- totaux de facture, d'avoir et de devis, cohérence avec Factur-X ;
- échéances (30, 45, 60 jours, fin de mois) ;
- références des factures, avoirs et devis ;
- résultats Qualiopi (indicateur 2, assiduité par demi-journées) et heures de présence ;
- redirection des emails en préversion ;
- chargement de toutes les routes `/api` dans Node ;
- enveloppe du suivi des erreurs sans changement de comportement ;
- aucune donnée personnelle dans les journaux et le suivi des erreurs ;
- aucune référence à la face interne des certifications dans un export, un PDF ou une page publique.

Les tests marqués « bug connu » (`it.fails`) décrivent un défaut existant : ils passent tant que le défaut est là et deviennent rouges le jour où il est corrigé, pour penser à les transformer en tests normaux.

Les références de session sont générées en base par un déclencheur : elles se vérifient en transaction annulée sur la production.

## 4. Protection de main

À activer après la fusion du chantier 1 : GitHub > dépôt `odet` > **Settings** > **Branches** > règle sur `main` qui exige la vérification **verification** au vert avant toute fusion. Détail des cases à cocher : liste unique du projet (`odet-apres-demo.md`).

## 5. Suivi des erreurs

Console › **Erreurs** (super administrateur) : erreurs regroupées par empreinte, filtres, détail, « Marquer comme traitée », « Ignorer », « Copier pour Claude ». Notification « Nouvelle erreur » au seul super administrateur. Purge automatique après 90 jours. Aucun service externe, aucun coût.

Migration `0070_suivi_erreurs.sql`. Tant qu'elle n'est pas appliquée, l'application fonctionne normalement ; les erreurs ne sont simplement pas enregistrées.

Aucune donnée personnelle : voir `docs/journaux-sans-donnees-personnelles.md`.
