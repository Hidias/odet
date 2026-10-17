# Journaux sans données personnelles

Règle (chantier F, écart 14) : **aucune donnée personnelle dans les journaux des fonctions `/api` ni dans le suivi des erreurs.** Les journaux Vercel sont lisibles par toute personne qui a accès au projet Vercel et sont conservés par Vercel, hors du registre des traitements.

## 1. Ce qui est en place (chantier 1)

- **Filet de sécurité sur toutes les routes `/api`** : `api/_lib/redact.js`, installé par `api/_lib/errors.js` que chaque route importe. Tout ce qui passe par `console.log`, `info`, `warn`, `error` est masqué avant d'être écrit : adresses email, téléphones français, IBAN, numéros de sécurité sociale, jetons (JWT, « Bearer », `access_token`, `refresh_token`, `password`, `secret`), paramètres `code`, `state`, `t` des adresses.
- **Suivi des erreurs** (`error_logs`, migration 0070) :
  - la personne n'est connue que par l'identifiant de son compte (`user_ids`), jamais par son email ; l'écran Console › Erreurs affiche le nom en lisant les profils au moment de l'affichage ;
  - message, pile et page masqués trois fois : par le navigateur (`src/core/errors/reporter.js`), par le serveur (`api/_lib/errors.js`) et par la base elle-même (`error_redact` dans `log_error`), pour qu'un appel direct de la fonction ne puisse pas enregistrer de donnée en clair ;
  - « Traitée par » enregistre l'identifiant du compte, pas son email.
- **Tests** : `tests/journaux.test.js` (masquage, journaux console, absence d'email dans le suivi).

## 2. Limite du filet

Les motifs ne reconnaissent pas les **noms de personnes, raisons sociales, adresses postales, noms de fichiers ni textes libres**. Les journaux ci-dessous en écrivent encore. Ils sont dans le code venu de main (routes partagées avec le chantier 2) : **non modifiés par le chantier 1**, à reprendre par le chantier 8 (nettoyage) ou par F, en remplaçant le contenu par un identifiant, un compte ou un code d'erreur.

Relevé du 17/10/2026 sur la branche `fiabilite/env-test` à jour de main.

| Fichier : ligne | Ce qui est écrit | Donnée restante après masquage |
|---|---|---|
| `api/auth/google.js` : 83, 88, 95, 104, 112, 115 | réponses brutes de Google Business (comptes, établissements) | nom et adresse de l'établissement |
| `api/auth/meta.js` : 71, 81, 89 | réponses brutes de Meta (jeton long, pages) | noms des pages et du compte |
| `api/auth/linkedin.js` : 80 | réponse d'erreur complète de LinkedIn | selon la réponse |
| `api/social/publish.js` : 54, 236, 303, 386 | réponses Google et LinkedIn, **texte complet du post** | texte du post, noms cités |
| `api/social/cron-publish.js` : 71 | titre du post et réponse de publication | titre, réponse |
| `api/auto-enrich.js` : 50, 103, 107 | nom et ville du prospect, réponse brute de l'IA, résultat (téléphone, site, email) | nom de l'entreprise, nom du dirigeant éventuel, site |
| `api/parse-bank-statement.js` : 131, 150 | détail de l'erreur de l'IA, **300 premiers caractères du relevé bancaire lu** | libellés d'opérations, noms de tiers |
| `api/parse-planning-import.js` : 89 | 500 premiers caractères de la réponse de l'IA | noms de stagiaires et de formateurs du planning |
| `api/generate-relance-email.js` : 137, 156 | réponse brute de l'IA | texte de l'email au client, noms |
| `api/duerp-ai-evaluate.js` : 400 | réponse brute de l'IA | contenu du DUERP |
| `api/generate-compte-rendu-formation.js` : 42 | réponse d'erreur de l'IA | selon la réponse |
| `api/sync-google-calendar.js` : 686, 692 | réponses de Google Agenda | titres d'événements (noms de clients, de stagiaires) |
| `api/sync-sent-emails.js` : 173, 178, 306, 350, 352 | adresse de la boîte, résultats de synchronisation | (adresse masquée) ; résumé des résultats |
| `api/_lib/save-to-sent.js` : 34, 78, 85 | adresse de la boîte, liste des dossiers | (adresse masquée) ; noms de dossiers |
| `api/mailing-replies-cron.js` : 178 | adresse de la boîte en erreur | (masquée) |
| `api/send-email-session.js` : 53, 60, 70, 72 | chemins et **noms de fichiers joints** | noms de fichiers (« Attestation_Nom.pdf ») |
| `api/send-email-rdv.js` : 50, 56, 66, 68 | chemins et noms de fichiers joints | noms de fichiers |
| `api/send-email-stagiaire.js` : 51, 57 | chemins des fichiers joints | noms de fichiers |
| `api/send-quote-email.js` : 84, 98, 112 | noms des fichiers joints | noms de fichiers |
| `api/send-budget-comptable.js` : 92 | nom du justificatif | nom du fichier |
| `api/send-*-email.js`, `send-email-*.js`, `mailing-cron.js`, `send-mailing-report.js` | objet d'erreur complet (`console.error('…', error)`) | réponse du serveur de messagerie (adresses masquées) |

**Règle pour tout nouveau code** : journaliser un identifiant (`session.id`, `client_id`, compte), un code ou une étape, jamais une réponse brute d'un service, un texte saisi, un nom ou un nom de fichier.
