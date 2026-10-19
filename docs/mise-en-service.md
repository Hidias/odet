# Mise en service (chantier A, migrations 0261 à 0264)

Lot de migrations : `a_0261-0264` (`supabase/lots/a_0261-0264.conf`), appliqué après 0277.
Retour arrière : `supabase/rollback/0261-0264_mise_en_service_retour.sql` (ou chaque partie seule).

## 0. Registre des migrations (0261)

Deux registres existent en production :

| Registre | Tenu par | Contenu au 19/10 |
|---|---|---|
| `public.schema_migrations` | chaque fichier du dépôt s'y inscrit | 0001 à 0051, 0070, 0080 à 0087, 0111, 0250, 0260, 0270 à 0276, 0360 à 0379 |
| `supabase_migrations.schema_migrations` | l'outil Supabase | 13 versions horodatées, arrêté le 14/10 |

**Référence retenue : `public.schema_migrations`** (lue par la Console et par l'action de migration). Le registre
Supabase est laissé tel quel, comme historique.

- **0190 (Passeport de prévention)** : objets présents en production (8 tables `pp_*`, 10 fonctions, module
  « passeport ») mais absente du registre. 0261 l'inscrit, sans rien rejouer, seulement si ses objets existent.
- **0110 (Budget générique) : NON appliquée.** La contrainte du payeur n'accepte encore que `entreprise`,
  `hicham_perso`, `maxime_perso` ; le repas a une personne invitante par défaut nominative ; le libellé de compte
  bancaire par défaut est celui d'un autre organisme ; `get_budget_kpis` renvoie encore deux colonnes nominatives.
  Sans effet tant que le module Budget est coupé. À appliquer avant de réactiver le Budget (elle ne modifie aucune
  ligne) ; à décider par H.

## 1. Rôles des associés (constat, aucun compte modifié)

- **Administrateur** (Anthony, Hubert) : 117 droits, tout sauf la plateforme. Les Paramètres (identité, modules,
  comptes, référents) restent fermés tant que la licence totale n'est pas cochée pour GLD Sécurité (décision du
  17/10, confirmée le 18/10) : correct.
- **Direction** (Léandra) : 106 droits, toutes les données de gestion, ni Paramètres ni Console ni journal d'audit.
  **Plus large que « lecture et validation »** : elle peut modifier des factures, émettre des avoirs, supprimer des
  clients. Si ce n'est pas voulu : lui attribuer le profil « Ressources humaines » ou retirer ces droits par un
  ajustement (Paramètres › Droits des personnes). Rien n'a été changé.
- **Double authentification** : l'authentification à deux facteurs par application (TOTP) de Supabase est gratuite
  sur toutes les offres. Proposition : écran d'enrôlement dans « Mon compte », puis exigence pour les rôles
  superadmin, admin et direction (accès refusé aux pages sensibles tant que le second facteur n'est pas validé).
  Non activée : à décider par H (un compte sans téléphone serait bloqué).

## 2. Bandeau d'information (0262)

- Table `platform_notices`, ligne `kind = 'bandeau'` : texte, activation (publié ou archivé), phrase sur les données
  fictives. Ligne sans société = toutes les sociétés ; une société peut avoir le sien (prioritaire).
- Texte de départ composé à l'application : « {prénom du super administrateur} fait évoluer {nom de l'application}
  régulièrement : des changements peuvent intervenir. » ; deuxième phrase « Une partie des données affichées est
  fictive (démonstration). » tant que `demo_records` n'est pas vide.
- Affiché en haut de l'application (composant Banner) pour tous les comptes internes connectés ; fermable pour la
  journée (mémoire du navigateur, clé tirée du texte : il réapparaît quand le texte change).
- Liens : « Voir les nouveautés » (module nouveautes) et « Signaler un problème ou une idée » (ouvre le post-it).
- Réglage : Console › Bandeau d'information (aperçu avant enregistrement).

## 3. Quoi de neuf (0262, module « nouveautes »)

- Lignes `kind = 'nouveaute'` : brouillon, publiée, archivée. Page `/nouveautes`, groupée par mois.
- **Alimentation automatique** : l'action GitHub `Nouveautés` (`.github/workflows/nouveautes.yml`) appelle, à chaque
  PR fusionnée dans main, `notice_from_pull_request` (serveur seulement) : titre de la PR, premier paragraphe de sa
  description sans titres ni balises Markdown. **Toujours en brouillon** ; une PR ne crée jamais deux entrées.
  Aucun jeton à saisir : l'action utilise le secret `SUPABASE_DB_URL` déjà en place.
- Console › Quoi de neuf : relire, réécrire en français simple, publier, archiver, supprimer, écrire à la main.
- Pastille « nouveau » sur le lien (menu, menu du compte) tant que l'utilisateur n'a pas ouvert la page depuis la
  dernière entrée publiée (`profiles.notices_seen_at`, `notices_mark_seen()`).
- Aucune donnée personnelle dans les entrées (rappel dans la Console).

## 4. Retours des utilisateurs (0263, module « retours »)

Un seul circuit : le post-it existant, la table `user_feedback`, la route `/api/retours`.

- Post-it : type (problème, idée, question), gravité ressentie pour un problème (gêne légère, gênant, bloquant),
  capture facultative (« Capturer l'écran » par le navigateur sur PC, « Joindre une image » partout), compressée en
  JPEG (1 600 px, 2,5 Mo au plus) ; onglet « Mes retours » : statut et réponse de l'équipe, pastille de réponse.
- Captures dans le bucket privé `retours` (3 Mo, images seulement, aucune règle de stockage) : lues par un lien signé
  d'une minute, jamais envoyées hors de l'outil.
- Suivi : page `/retours` (DataTable, statut nouveau / vu / en cours / fait / écarté, réponse visible par l'auteur,
  lien vers l'entrée « Quoi de neuf » qui règle le retour). Ouvrir un retour nouveau le passe en « vu ».
- Droit `organisation.retours.suivre` (super administrateur, administrateur) ; un administrateur suit les retours de
  ses sociétés. Chacun voit toujours les siens.
- Notification à chaque nouveau retour, réservée au super administrateur (`metadata.audience = 'superadmin'`, règle
  restrictive de 0070), sans le texte du retour.
- Avant 0263 : le post-it garde sa forme simple (texte seul) et la route reste compatible.
- **Registre RGPD (chantier F)** : traitement « Retours des utilisateurs internes » (texte, page, taille d'écran,
  capture facultative ; finalité : amélioration de l'outil ; accès : super administrateur et administrateurs ;
  conservation à fixer).

## 5. Saisies réelles rattachées au fictif (0264)

**Constat** : `purge_demo_data()` efface toute ligne qui pointe vers un client, une session, un stagiaire, un devis,
une facture ou un rendez-vous fictif, quel que soit son auteur. Une visite, un devis, une facture, une note ou un
contact saisis pour un client fictif, ou un stagiaire réel inscrit à une session fictive, disparaîtraient.

**Solution retenue (la plus simple, rien n'est perdu sans le savoir)** : `demo_real_links()` liste avant la purge les
lignes « probablement réelles » (créées plus d'une heure après le dernier enregistrement de démonstration) qui
seraient effacées, par table et par lien. Console › Données de démonstration : si la liste n'est pas vide, le bouton
d'effacement reste bloqué tant que la case « J'ai vérifié ces lignes » n'est pas cochée. La purge n'est jamais
lancée sans H.

## Tests

`supabase/tests/droits_chantier2.sql` : 11 contrôles (registre, nouveautés lues et écrites selon le rôle, pastille,
brouillon de PR unique et refusé aux comptes, retours fermés aux comptes, droit de suivi admin et pas direction,
bucket privé, lignes réelles réservées au super administrateur). `tests/gardes-pages.test.js` : menu et gardes.
