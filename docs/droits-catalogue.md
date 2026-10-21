# Catalogue des droits et profils types (chantier C1b)

FICHIER GÉNÉRÉ par `scripts/securite/regles.py` à partir de `scripts/securite/droits.py` et de la matrice des règles d'accès. Ne pas modifier à la main.

Drapeaux : **P** périmètre de la personne (ses sessions, ses visites…) ; **€** montre des prix ; **L** licence totale de la société (**L (0379)** : drapeau posé par la migration 0379, après 0372) ; **Pf** plateforme (super administrateur). « Règle » : le droit est demandé aujourd'hui par une règle d'accès en base ; sinon il est prêt pour un module ou un écran à venir.

## Profils types

| Clé | Profil | Rôle actuel repris | Droits | Description |
|---|---|---|---|---|
| SA `superadmin` | Super administrateur | superadmin | 122 | Éditeur de la plateforme : tous les droits ; voit une société par l'accès de support (C1a) |
| AD `admin` | Administrateur | admin | 118 | Associés : tout sauf la plateforme ; les Paramètres seulement avec la licence totale de la société |
| DIR `direction` | Direction | direction | 106 | Direction de la société : toutes les données de gestion, jamais les Paramètres |
| GES `gestionnaire` | Gestionnaire | gestionnaire | 76 | Organisation des sessions, des clients et des interventions |
| FOR `formateur` | Formateur | formateur | 29 | Ses sessions et leurs stagiaires seulement ; ni devis ni factures |
| COM `commercial` | Commercial | commercial | 46 | Clients, prospection, devis et factures |
| TEC `technicien` | Technicien | technicien | 12 | Ses missions sur le terrain ; peut annoter ; jamais aucun prix |
| CPI `comptable` | Comptable interne | comptable | 24 | Factures, paiements, espace comptable ; aucune donnée de formation sensible |
| CPE `comptable_externe` | Comptable externe | — | 6 | Cabinet comptable : lit les factures et avoirs (brouillons signalés « sans valeur comptable ») ; ne modifie rien ; demande une confirmation à l'auteur. Devis : la direction ajoute « Voir les devis » au profil de sa société si elle le veut |
| RH `rh` | Ressources humaines | — | 15 | Dossiers du personnel, absences, heures, documents RH |
| SAL `salarie` | Salarié | — | 8 | Son espace : congés, heures, frais, son véhicule, son stock |
| LEC `lecture` | Lecture | lecture | 22 | Consultation sans modification ; ni devis ni factures |
| ECR `ecran` | Compte « écran » | — | 2 | Écran mural des véhicules : une seule page, lecture seule, révocable d'un clic |
| MBR `membre` | Sans profil de base | — | 0 | Rôle de base vide : les droits viennent seulement des profils attribués dans la société (comptable externe, RH, salarié, écran) |

## Catalogue

| Droit | Ce qu'il permet | Données | Drapeaux | Règle | SA | AD | DIR | GES | FOR | COM | TEC | CPI | CPE | RH | SAL | LEC | ECR | MBR |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **plateforme** | | | | | | | | | | | | | | | | | | |
| **Administrer la plateforme** `plateforme.administrer` | Opérations réservées à l'éditeur : versions, migrations, données de démonstration, corrections exceptionnelles | app_versions, schema_migrations, demo_records, catalogue des droits, modèles de profils | Pf | oui | x |  |  |  |  |  |  |  |  |  |  |  |  |  |
| **organisation** | | | | | | | | | | | | | | | | | | |
| **Voir les réglages de l'organisme** `organisation.reglages.voir` | Lire l'identité, les modules actifs, les référents qualité et les versions (nécessaire à tous les écrans) | organization_settings, org_settings, org_modules, quality_roles, app_versions |  | oui | x | x | x | x | x | x | x | x | x | x | x | x | x |  |
| **Voir les comptes** `organisation.comptes.voir` | Lire la liste des comptes (noms, fonctions, rôles) pour afficher les auteurs et choisir un collègue | profiles |  | oui | x | x | x | x | x | x | x | x |  | x |  | x |  |  |
| **Gérer ses préférences** `organisation.preferences.gerer` | Régler son tableau de bord et sa boîte d'envoi (seulement les siens) | dashboard_widget_configs, user_email_configs | P | oui | x | x | x | x | x | x | x | x | x | x | x | x |  |  |
| **Écrire au journal d'audit** `organisation.journal.ecrire` | Ajouter une ligne au journal lors d'une action (en attendant l'écriture par la base, chantier F) | audit_logs (ajout seulement) |  | oui | x | x | x | x | x | x | x | x |  |  |  | x |  |  |
| **Voir et traiter les notifications** `organisation.notifications.gerer` | Lire, créer et marquer comme lues les notifications | notifications |  | oui | x | x | x | x | x | x |  | x |  | x |  | x |  |  |
| **Supprimer des notifications** `organisation.notifications.supprimer` | Supprimer des notifications | notifications |  | oui | x | x |  |  |  |  |  |  |  |  |  |  |  |  |
| **planning** | | | | | | | | | | | | | | | | | | |
| **Voir les agendas** `planning.agenda.voir` | Lire les évènements d'agenda de l'équipe | user_planning_events |  | oui | x | x | x | x | x | x |  | x |  | x |  | x |  |  |
| **Gérer son agenda** `planning.agenda.gerer_siens` | Créer, modifier, supprimer ses propres évènements | user_planning_events | P | oui | x | x | x | x | x | x |  | x |  | x |  | x |  |  |
| **Gérer les agendas de l'équipe** `planning.agenda.gerer_equipe` | Créer, modifier, supprimer les évènements de toute l'équipe | user_planning_events |  | oui | x | x | x | x |  |  |  |  |  |  |  |  |  |  |
| **parametres** | | | | | | | | | | | | | | | | | | |
| **Ouvrir les Paramètres** `parametres.ouvrir` | Accéder aux pages Paramètres et à l'assistant de configuration (garde des écrans, branche ecrans/gardes) | pages Paramètres, Console exclue | L |  | x | x |  |  |  |  |  |  |  |  |  |  |  |  |
| **Configurer l'organisme** `parametres.organisme.modifier` | Modifier l'identité, les textes et les réglages de l'organisme | organization_settings, org_settings | L (0379) | oui | x | x |  |  |  |  |  |  |  |  |  |  |  |  |
| **Configurer les modules** `parametres.modules.gerer` | Activer ou couper un module | org_modules | L (0379) | oui | x | x |  |  |  |  |  |  |  |  |  |  |  |  |
| **Désigner les référents** `parametres.referents.gerer` | Désigner les référents qualité (dont le référent handicap) | quality_roles | L (0379) | oui | x | x |  |  |  |  |  |  |  |  |  |  |  |  |
| **Gérer les comptes** `parametres.utilisateurs.gerer` | Créer, modifier, désactiver un compte (jamais un super administrateur) | profiles | L (0379) | oui | x | x |  |  |  |  |  |  |  |  |  |  |  |  |
| **Gérer les profils de droits** `parametres.profils.gerer` | Créer et modifier les profils de droits de la société (Paramètres › Profils) | permission_profiles, permission_profile_rights | L |  | x | x |  |  |  |  |  |  |  |  |  |  |  |  |
| **Attribuer des droits** `parametres.droits.attribuer` | Donner ou retirer des profils et des droits à une personne dans la société (Paramètres › Utilisateurs) | company_member_roles, company_member_rights | L |  | x | x |  |  |  |  |  |  |  |  |  |  |  |  |
| **Voir les connexions aux réseaux sociaux** `parametres.reseaux_sociaux.voir` | Lire l'état des connexions (jetons) des réseaux sociaux | social_tokens |  | oui | x | x |  |  |  |  |  |  |  |  |  |  |  |  |
| **validations** | | | | | | | | | | | | | | | | | | |
| **Configurer les circuits de validation** `validations.circuits.configurer` | Régler par périmètre (factures par client, commandes avec seuil, absences, heures, frais) qui valide | approval_rules |  |  | x | x | x |  |  |  |  |  |  |  |  |  |  |  |
| **formation** | | | | | | | | | | | | | | | | | | |
| **Voir le catalogue** `formation.catalogue.voir` | Lire les formations, thèmes, matériel, programmes, documents de formation et banques de questions | courses, training_themes, course_equipment, equipment_catalog, programme_versions, trainer_qualifications, course_documents, course_questions, theme_questions, positioning_questions_ref, positioning_themes |  | oui | x | x | x | x | x | x |  | x |  |  |  | x |  |  |
| **Gérer le catalogue** `formation.catalogue.gerer` | Créer, modifier, supprimer formations, thèmes, matériel et programmes ; supprimer des questions | mêmes tables que « Voir le catalogue » |  | oui | x | x | x | x |  |  |  |  |  |  |  |  |  |  |
| **Rédiger les questions** `formation.questions.modifier` | Créer et modifier les questions des tests et quiz | course_questions, theme_questions, positioning_* |  | oui | x | x | x | x | x | x |  |  |  |  |  |  |  |  |
| **Voir les formateurs** `formation.formateurs.voir` | Lire les fiches formateurs | trainers |  | oui | x | x | x | x | x | x |  | x |  |  |  | x |  |  |
| **Gérer les formateurs** `formation.formateurs.gerer` | Créer, modifier, supprimer les fiches formateurs | trainers |  | oui | x | x | x | x |  |  |  |  |  |  |  |  |  |  |
| **Modifier sa fiche de formateur** `formation.formateurs.modifier_sa_fiche` | Le formateur met à jour sa propre fiche (signature, coordonnées) | trainers (la sienne) | P | oui |  |  |  |  | x |  |  |  |  |  |  |  |  |  |
| **Tenir le dossier des formateurs** `formation.formateurs.dossier` | Entretiens, formations suivies et certificats des formateurs | trainer_interviews, trainer_trainings, trainer_certificates |  | oui | x | x | x | x |  |  |  |  |  |  |  |  |  |  |
| **Voir toutes les sessions** `formation.sessions.voir` | Lire toutes les sessions, leurs financements, groupes et formateurs | sessions, session_fundings, session_groups, session_trainers |  | oui | x | x | x | x |  | x |  | x |  |  |  | x |  |  |
| **Voir ses sessions** `formation.sessions.voir_siennes` | Le formateur lit ses sessions et tout leur suivi (émargement, évaluations, fiches) | sessions et tables filles, limitées à ses sessions | P | oui |  |  |  |  | x |  |  |  |  |  |  |  |  |  |
| **Créer des sessions** `formation.sessions.creer` | Créer une session | sessions |  | oui | x | x | x | x |  | x |  |  |  |  |  |  |  |  |
| **Modifier les sessions** `formation.sessions.modifier` | Modifier toutes les sessions, financements, groupes et formateurs | sessions, session_fundings, session_groups, session_trainers |  | oui | x | x | x | x |  | x |  |  |  |  |  |  |  |  |
| **Faire vivre ses sessions** `formation.sessions.modifier_siennes` | Le formateur modifie ses sessions : émargement, évaluations, fiches, documents, check-list | sessions et tables filles, limitées à ses sessions | P | oui |  |  |  |  | x |  |  |  |  |  |  |  |  |  |
| **Supprimer des sessions** `formation.sessions.supprimer` | Supprimer une session | sessions |  | oui | x | x | x | x |  |  |  |  |  |  |  |  |  |  |
| **Préparer les sessions** `formation.sessions.preparer` | Check-list, documents, envois enregistrés, matériel, analyses des besoins des sessions | session_checklists, session_documents, session_document_access, session_emails_sent, session_equipment, session_needs_analysis, session_qualiopi, course_document_downloads |  | oui | x | x | x | x |  | x |  |  |  |  |  |  |  |  |
| **Voir le suivi des sessions** `formation.suivi.voir` | Lire émargement, évaluations, fiches de renseignements, objectifs, tests et certificats SST | attendance_*, trainee_info_sheets, trainee_objectives, trainee_positioning_tests, positioning_results, sst_certifications, quiz_attempts, trainee_evaluations, evaluations_cold, trainer_evaluations, trainee_documents, session_checklists et documents des sessions |  | oui | x | x | x | x |  | x |  |  |  |  |  | x |  |  |
| **Corriger le suivi des sessions** `formation.suivi.gerer` | Saisir et corriger émargement, évaluations, fiches et certificats ; supprimer des pièces de suivi | mêmes tables que « Voir le suivi des sessions » |  | oui | x | x | x | x |  |  |  |  |  |  |  |  |  |  |
| **Voir et saisir les coûts des sessions** `formation.couts.gerer` | Coûts engagés par session (marge) | session_costs | € | oui | x | x | x | x |  |  |  |  |  |  |  |  |  |  |
| **Suivre les relances de signature** `formation.signatures.suivre` | Lire les alertes de signature envoyées | signature_alerts_sent |  | oui | x | x | x | x |  |  |  |  |  |  |  |  |  |  |
| **Voir les documents** `formation.documents.voir` | Lire les documents déposés | documents, uploaded_documents, uploaded_files |  | oui | x | x | x | x | x | x |  |  |  |  |  | x |  |  |
| **Déposer des documents** `formation.documents.modifier` | Déposer et modifier des documents | documents, uploaded_documents, uploaded_files |  | oui | x | x | x | x | x | x |  |  |  |  |  |  |  |  |
| **Supprimer des documents** `formation.documents.supprimer` | Supprimer des documents | documents, uploaded_documents, uploaded_files |  | oui | x | x | x | x |  |  |  |  |  |  |  |  |  |  |
| **Voir tous les stagiaires** `formation.stagiaires.voir` | Lire les fiches et inscriptions de tous les stagiaires (jamais le numéro de sécurité sociale ni le handicap) | trainees, session_trainees |  | oui | x | x | x | x |  | x |  | x |  |  |  | x |  |  |
| **Voir les stagiaires de ses sessions** `formation.stagiaires.voir_siens` | Le formateur lit les stagiaires inscrits à ses sessions | trainees, trainee_documents (ses sessions) | P | oui |  |  |  |  | x |  |  |  |  |  |  |  |  |  |
| **Créer des stagiaires** `formation.stagiaires.creer` | Créer une fiche stagiaire | trainees |  | oui | x | x | x | x | x | x |  |  |  |  |  |  |  |  |
| **Modifier les stagiaires** `formation.stagiaires.modifier` | Modifier toutes les fiches stagiaires | trainees |  | oui | x | x | x | x |  | x |  |  |  |  |  |  |  |  |
| **Compléter les stagiaires de ses sessions** `formation.stagiaires.modifier_siens` | Le formateur complète les fiches et documents des stagiaires de ses sessions | trainees, trainee_documents (ses sessions) | P | oui |  |  |  |  | x |  |  |  |  |  |  |  |  |  |
| **Supprimer des stagiaires** `formation.stagiaires.supprimer` | Supprimer une fiche stagiaire | trainees |  | oui | x | x | x | x |  |  |  |  |  |  |  |  |  |  |
| **Gérer les archives des stagiaires** `formation.stagiaires.archives` | Lire et tenir les archives des stagiaires | trainees_archive |  | oui | x | x | x | x |  |  |  |  |  |  |  |  |  |  |
| **Inscrire des stagiaires** `formation.inscriptions.gerer` | Inscrire, modifier et retirer des stagiaires d'une session | session_trainees |  | oui | x | x | x | x |  | x |  |  |  |  |  |  |  |  |
| **Envoyer aux stagiaires et aux clients** `formation.convocations.envoyer` | Envoyer convocations, documents de fin de stage et liens d'évaluation (route /api, branche ecrans/gardes) | emails des sessions |  |  | x | x | x | x |  | x |  |  |  |  |  |  |  |  |
| **clients** | | | | | | | | | | | | | | | | | | |
| **Voir les clients** `clients.fiches.voir` | Lire clients, contacts, sites et historique des échanges | clients, client_contacts, sites, client_interactions |  | oui | x | x | x | x | x | x |  | x | x |  |  | x |  |  |
| **Modifier les clients** `clients.fiches.modifier` | Créer et modifier clients, contacts, sites ; supprimer contacts et sites | clients, client_contacts, sites, client_interactions |  | oui | x | x | x | x |  | x |  |  |  |  |  |  |  |  |
| **Supprimer des clients** `clients.fiches.supprimer` | Supprimer un client et des lignes d'historique | clients, client_interactions |  | oui | x | x | x | x |  |  |  |  |  |  |  |  |  |  |
| **Noter un échange avec un client** `clients.historique.ecrire` | Ajouter une ligne à l'historique d'un client | client_interactions |  | oui | x | x | x | x | x | x |  | x |  |  |  |  |  |  |
| **Gérer l'espace entreprise et les prestataires** `clients.espace.gerer` | Accès des clients à leur espace, prestataires concurrents | client_portal_access, client_providers |  | oui | x | x | x | x |  | x |  |  |  |  |  |  |  |  |
| **commercial** | | | | | | | | | | | | | | | | | | |
| **Voir les devis** `commercial.devis.voir` | Lire les devis et leurs lignes, avec les prix | quotes, quote_items | € | oui | x | x | x | x |  | x |  | x |  |  |  |  |  |  |
| **Préparer les devis** `commercial.devis.modifier` | Créer et modifier des devis | quotes, quote_items | € | oui | x | x | x | x |  | x |  |  |  |  |  |  |  |  |
| **Supprimer des devis** `commercial.devis.supprimer` | Supprimer un devis | quotes |  | oui | x | x | x | x |  |  |  |  |  |  |  |  |  |  |
| **Envoyer les devis** `commercial.devis.envoyer` | Envoyer un devis au client (route /api) | emails des devis | € |  | x | x | x | x |  | x |  |  |  |  |  |  |  |  |
| **Voir la prospection** `commercial.prospection.voir` | Lire la base prospects, appels, rendez-vous, analyses de besoin, imports | prospection_massive, prospect_*, phoning_sessions, call_*, rdv_*, import_logs |  | oui | x | x | x | x |  | x |  |  |  |  |  |  |  |  |
| **Prospecter** `commercial.prospection.gerer` | Appeler, noter, prendre rendez-vous, importer | mêmes tables que « Voir la prospection » |  | oui | x | x | x | x |  | x |  |  |  |  |  |  |  |  |
| **Supprimer des prospects** `commercial.prospection.supprimer` | Supprimer de la base prospects | prospection_massive |  | oui | x | x | x | x |  |  |  |  |  |  |  |  |  |  |
| **communication** | | | | | | | | | | | | | | | | | | |
| **Gérer les campagnes email** `communication.campagnes.gerer` | Segments, modèles, envois, liste d'exclusion | mailing_* |  | oui | x | x | x | x |  | x |  |  |  |  |  |  |  |  |
| **Publier sur les réseaux sociaux** `communication.reseaux.gerer` | Préparer et planifier les publications, bibliothèque de médias | social_posts, social_media_library |  | oui | x | x | x | x |  | x |  |  |  |  |  |  |  |  |
| **facturation** | | | | | | | | | | | | | | | | | | |
| **Voir les factures** `facturation.factures.voir` | Lire factures, avoirs, lignes, paiements, relances et envois, avec les montants | invoices, invoice_items, invoice_sessions, invoice_payments, invoice_relances, invoice_emails_sent | € | oui | x | x | x | x |  | x |  | x | x |  |  |  |  |  |
| **Préparer les factures** `facturation.factures.modifier` | Créer et modifier factures et lignes, saisir les paiements et les relances | mêmes tables que « Voir les factures » | € | oui | x | x | x | x |  | x |  | x |  |  |  |  |  |  |
| **Supprimer des factures** `facturation.factures.supprimer` | Supprimer une facture (refusé par la base pour une facture émise, chantier Facturation fiable) | invoices, invoice_relances, invoice_emails_sent |  | oui | x | x | x | x |  |  |  |  |  |  |  |  |  |  |
| **Supprimer ses brouillons de facture** `facturation.brouillons.supprimer` | Supprimer une facture encore en brouillon | invoices (brouillons) |  | oui |  |  |  |  |  | x |  | x |  |  |  |  |  |  |
| **Valider les factures** `facturation.factures.valider` | Émettre une facture : numéro définitif donné par la base, contenu figé (chantier Facturation fiable) | invoices | € |  | x | x | x |  |  |  |  |  |  |  |  |  |  |  |
| **Envoyer les factures** `facturation.factures.envoyer` | Envoyer ou mettre à disposition une facture émise | emails des factures | € |  | x | x | x |  |  | x |  | x |  |  |  |  |  |  |
| **Émettre des avoirs** `facturation.avoirs.emettre` | Annuler tout ou partie d'une facture émise par un avoir | invoices (avoirs) | € |  | x | x | x |  |  |  |  |  |  |  |  |  |  |  |
| **Demander la confirmation d'un brouillon** `facturation.brouillons.demander_confirmation` | Comptable externe : signaler un brouillon à son auteur et demander sa confirmation, sans le modifier | notifications |  |  | x |  |  |  |  |  |  |  | x |  |  |  |  |  |
| **Choisir ce que voit le comptable externe** `facturation.comptable_externe.regler` | Direction : rendre les devis visibles ou non au comptable externe de la société (sans ouvrir les Paramètres) | profil « comptable externe » de la société |  |  | x | x | x |  |  |  |  |  |  |  |  |  |  |  |
| **Exporter pour la comptabilité** `facturation.export.comptable` | Exports comptables, FEC, transmission au comptable | factures émises, avoirs, paiements | € |  | x | x | x |  |  |  |  | x | x |  |  |  |  |  |
| **finance** | | | | | | | | | | | | | | | | | | |
| **Tenir le budget et la comptabilité** `finance.budget.gerer` | Budget, relevés bancaires, rapprochement, catégories, périodes comptables | budget_*, bank_statements, accounting_periods | € | oui | x | x | x |  |  |  |  | x |  |  |  |  |  |  |
| **qualite** | | | | | | | | | | | | | | | | | | |
| **Voir les registres qualité** `qualite.registres.voir` | Non-conformités, réclamations, alertes, veille, processus, audits internes, RGPD, BPF, indicateurs | non_conformites, reclamations, quality_alerts, veille_*, process_*, audits_internes, rgpd_traitements, bpf_declarations, qualiopi_indicators |  | oui | x | x | x | x | x | x |  |  |  |  |  | x |  |  |
| **Signaler dans les registres qualité** `qualite.registres.signaler` | Créer une non-conformité, une réclamation, une alerte, une veille | mêmes tables |  | oui | x | x | x | x | x | x |  |  |  |  |  |  |  |  |
| **Traiter les registres qualité** `qualite.registres.gerer` | Modifier et clore les lignes des registres qualité | mêmes tables |  | oui | x | x | x | x |  |  |  |  |  |  |  |  |  |  |
| **Voir les documents qualité** `qualite.documents.voir` | Lire les documents qualité et leurs versions | quality_documents, qualiopi_documents, quality_doc_versions |  | oui | x | x | x | x | x | x |  | x |  |  |  | x |  |  |
| **Gérer les documents qualité** `qualite.documents.gerer` | Créer et modifier les documents qualité | quality_documents, qualiopi_documents |  | oui | x | x | x | x |  |  |  |  |  |  |  |  |  |  |
| **Valider une version de document qualité** `qualite.documents.valider` | Enregistrer une nouvelle version validée | quality_doc_versions |  | oui | x | x | x |  |  |  |  |  |  |  |  |  |  |  |
| **Suivre la complétude** `qualite.completude.suivre` | Lire et traiter les alertes de complétude des sessions | completude_alerts, completude_tracking |  | oui | x | x | x | x | x | x |  | x |  |  |  | x |  |  |
| **Supprimer des alertes de complétude** `qualite.completude.supprimer` | Supprimer des alertes | completude_alerts, completude_tracking |  | oui | x | x | x | x |  |  |  |  |  |  |  |  |  |  |
| **Préparer les certifications** `qualite.certification.gerer` | Référentiels, preuves, constats d'audit, réglages (face auditeur) | cert_* |  | oui | x | x | x | x |  |  |  |  |  |  |  |  |  |  |
| **Voir les données de handicap** `qualite.handicap.voir` | Direction et référent handicap : besoins, adaptations, registre PSH (règle app.can_see_disability, inchangée) | trainee_disability, psh_requests |  |  | x | x | x |  |  |  |  |  |  |  |  |  |  |  |
| **prestations** | | | | | | | | | | | | | | | | | | |
| **Réaliser les DUERP** `prestations.duerp.gerer` | Projets DUERP, unités, risques, actions | duerp_* |  | oui | x | x | x | x |  |  |  |  |  |  |  |  |  |  |
| **passeport** | | | | | | | | | | | | | | | | | | |
| **Déclarer au Passeport de prévention** `passeport.declarations.gerer` | Préparer et suivre les déclarations (règles propres du Passeport, pp_can, inchangées) | pp_* |  |  | x | x | x | x |  |  |  |  |  |  |  |  |  |  |
| **conformite** | | | | | | | | | | | | | | | | | | |
| **Voir le journal d'audit** `conformite.journal.voir` | Lire le journal d'audit de la société | audit_logs |  | oui | x | x |  |  |  |  |  |  |  |  |  |  |  |  |
| **Tenir le registre RGPD** `conformite.rgpd.gerer` | Registre, sous-traitants, AIPD, informations (chantier F) | rgpd_* (prévu) |  |  | x | x | x |  |  |  |  |  |  |  |  |  |  |  |
| **Traiter les demandes des personnes** `conformite.demandes.gerer` | Droits d'accès, rectification, effacement | rgpd_requests (prévu) |  |  | x | x | x |  |  |  |  |  |  |  |  |  |  |  |
| **Gérer les violations de données** `conformite.violations.gerer` | Registre des violations (72 h) | rgpd_breaches (prévu) |  |  | x | x | x |  |  |  |  |  |  |  |  |  |  |  |
| **Valider les purges** `conformite.purges.valider` | Valider les passages de purge proposés | rgpd_purges (prévu) |  |  | x | x | x |  |  |  |  |  |  |  |  |  |  |  |
| **interventions** | | | | | | | | | | | | | | | | | | |
| **Voir les types d'appareils et les techniciens** `interventions.referentiel.voir` | Lire les types de matériel et la liste des techniciens | itv_equipment_types, itv_technicians |  | oui | x | x | x | x | x | x | x |  |  |  |  | x |  |  |
| **Voir les prix des interventions** `interventions.tarifs.voir` | Lire les prix des pièces, le forfait de visite et les prix des pièces fournies | itv_parts, itv_settings, itv_visit_parts | € | oui | x | x | x | x | x | x |  |  |  |  |  | x |  |  |
| **Configurer les interventions** `interventions.reglages.gerer` | Réglages, types de matériel, pièces et prix, techniciens | itv_settings, itv_equipment_types, itv_parts, itv_technicians | € | oui | x | x | x | x |  |  |  |  |  |  |  |  |  |  |
| **Voir les contrats de maintenance** `interventions.contrats.voir` | Lire les contrats avec leur prix annuel | itv_contracts | € | oui | x | x | x | x | x | x |  |  |  |  |  | x |  |  |
| **Gérer les contrats de maintenance** `interventions.contrats.gerer` | Créer et modifier les contrats | itv_contracts | € | oui | x | x | x | x |  |  |  |  |  |  |  |  |  |  |
| **Voir toutes les visites** `interventions.visites.voir` | Lire toutes les visites et leurs lignes de contrôle | itv_visits, itv_visit_items |  | oui | x | x | x | x | x | x |  |  |  |  |  | x |  |  |
| **Planifier et gérer les visites** `interventions.visites.gerer` | Créer, planifier, modifier, supprimer toutes les visites et leurs lignes | itv_visits, itv_visit_items, itv_visit_parts |  | oui | x | x | x | x |  |  |  |  |  |  |  |  |  |  |
| **Voir le parc des clients** `interventions.parc.voir` | Lire les appareils de tous les clients | itv_equipment |  | oui | x | x | x | x | x | x |  |  |  |  |  | x |  |  |
| **Gérer le parc des clients** `interventions.parc.gerer` | Créer, modifier, supprimer des appareils | itv_equipment |  | oui | x | x | x | x |  |  |  |  |  |  |  |  |  |  |
| **Voir ses missions** `interventions.missions.voir` | Le technicien lit ses visites, les clients, sites et contacts de ses visites, leur parc et leur historique, sans aucun prix | itv_visits, clients, client_contacts, sites, itv_equipment, itv_visit_items, vues terrain | P | oui |  |  |  |  |  |  | x |  |  |  |  |  |  |  |
| **Intervenir** `interventions.missions.realiser` | Le technicien réalise ses visites : démarrage, contrôles, pièces fournies, photos, signature du client | itv_visits, itv_visit_items, itv_visit_parts (ses visites) | P | oui |  |  |  |  |  |  | x |  |  |  |  |  |  |  |
| **Annoter le parc de ses clients** `interventions.parc.annoter` | Le technicien ajoute ou corrige un appareil chez les clients de ses visites | itv_equipment (ses clients) | P | oui |  |  |  |  |  |  | x |  |  |  |  |  |  |  |
| **Envoyer les rapports d'intervention** `interventions.rapports.envoyer` | Envoyer le rapport de visite au client | emails des visites |  |  | x | x | x | x |  |  | x |  |  |  |  |  |  |  |
| **rh** | | | | | | | | | | | | | | | | | | |
| **Voir le personnel** `rh.personnel.voir` | Annuaire : nom, emploi, équipe, téléphone et email professionnels | hr_people (partie annuaire) |  |  | x | x | x | x |  |  |  |  |  | x | x |  |  |  |
| **Voir les dossiers du personnel** `rh.dossiers.voir` | Fiche complète : identité, coordonnées personnelles, contrat | hr_people, hr_employments |  |  | x | x | x |  |  |  |  |  |  | x |  |  |  |  |
| **Tenir les dossiers du personnel** `rh.dossiers.gerer` | Créer et modifier personnes, contrats, équipes, horaires, habilitations, suivi de santé administratif | hr_* |  |  | x | x | x |  |  |  |  |  |  | x |  |  |  |  |
| **Voir les salaires** `rh.salaires.voir` | Lire les rémunérations (consultation journalisée) | hr_compensation | € |  | x | x | x |  |  |  |  |  |  | x |  |  |  |  |
| **Demander une absence** `rh.absences.demander` | Demander ses congés et absences, voir son solde | hr_absence_requests (les siennes) | P |  |  |  |  |  |  |  |  |  |  |  | x |  |  |  |
| **Valider les absences** `rh.absences.valider` | Valider ou refuser les demandes d'absence | hr_absence_requests, approval_requests |  |  | x | x | x |  |  |  |  |  |  | x |  |  |  |  |
| **Saisir ses heures** `rh.heures.saisir` | Remplir sa semaine d'heures | hr_time_entries (les siennes) | P |  |  |  |  |  |  |  |  |  |  |  | x |  |  |  |
| **Valider les heures** `rh.heures.valider` | Valider les semaines d'heures et les heures supplémentaires | hr_timesheets, approval_requests |  |  | x | x | x |  |  |  |  |  |  | x |  |  |  |  |
| **Voir les documents restreints du personnel** `rh.documents.restreints` | Justificatifs d'absence, santé au travail administrative, bulletins | hr_documents (restreint, privé) |  |  | x |  |  |  |  |  |  |  |  | x |  |  |  |  |
| **Configurer les RH** `rh.parametres.gerer` | Types d'absence, horaires de référence, règles de temps | hr_absence_types, hr_schedules |  |  | x | x | x |  |  |  |  |  |  | x |  |  |  |  |
| **frais** | | | | | | | | | | | | | | | | | | |
| **Saisir ses notes de frais** `frais.notes.saisir` | Déclarer ses frais avec justificatif | notes de frais (les siennes) | P |  |  |  |  |  |  |  |  |  |  |  | x |  |  |  |
| **Valider les notes de frais** `frais.notes.valider` | Valider ou refuser les notes de frais | notes de frais, approval_requests | € |  | x | x | x |  |  |  |  |  |  |  |  |  |  |  |
| **vehicules** | | | | | | | | | | | | | | | | | | |
| **Utiliser son véhicule** `vehicules.siens.utiliser` | Voir son véhicule, saisir un plein, un état des lieux, un incident | vehicles (le sien), pleins, incidents | P |  |  |  |  |  |  |  | x |  |  |  | x |  |  |  |
| **Voir le parc de véhicules** `vehicules.parc.voir` | Lire les véhicules, échéances et historiques | vehicles, entretiens, échéances |  |  | x | x | x | x |  |  |  |  |  |  |  |  |  |  |
| **Voir les coûts des véhicules** `vehicules.couts.voir` | Coûts, pleins, factures d'entretien | pleins, entretiens | € |  | x | x | x |  |  |  |  | x |  |  |  |  |  |  |
| **Gérer le parc de véhicules** `vehicules.parc.gerer` | Créer, modifier, attribuer les véhicules | vehicles, attributions |  |  | x | x | x |  |  |  |  |  |  |  |  |  |  |  |
| **Voir la carte en direct** `vehicules.carte.voir` | Positions des véhicules pendant les heures de service (direction seulement) | vehicle_live, positions |  |  | x | x | x |  |  |  |  |  |  |  |  |  |  |  |
| **Afficher l'écran mural** `vehicules.ecran_mural.voir` | Page plein écran du suivi des véhicules, en lecture seule (compte « écran ») | vehicle_live (affichage) |  |  | x |  |  |  |  |  |  |  |  |  |  |  | x |  |
| **Configurer la géolocalisation** `vehicules.geolocalisation.configurer` | Fournisseur de boîtiers, heures de service | réglages du module |  |  | x | x |  |  |  |  |  |  |  |  |  |  |  |  |
| **stock** | | | | | | | | | | | | | | | | | | |
| **Mouvementer son stock** `stock.sien.mouvementer` | Voir et mouvementer le stock de son véhicule ou le sien (prise au dépôt, retour) | stock_movements (le sien) | P |  |  |  |  |  |  |  | x |  |  |  | x |  |  |  |
| **Voir tout le stock** `stock.voir` | Quantités de tous les emplacements, transferts entre dépôts | stock_* |  |  | x | x | x | x |  |  |  |  |  |  |  |  |  |  |
| **Gérer les articles et les seuils** `stock.articles.gerer` | Articles, fournisseurs, seuils | stock_items, suppliers, stock_thresholds |  |  | x | x | x | x |  |  |  |  |  |  |  |  |  |  |
| **Préparer une commande** `stock.commandes.preparer` | Préparer une demande ou une commande d'achat | purchase_orders |  |  | x | x | x | x |  |  | x |  |  |  |  |  |  |  |
| **Valider les commandes** `stock.commandes.valider` | Valider les commandes selon le seuil de la société | purchase_orders, approval_requests | € |  | x | x | x |  |  |  |  |  |  |  |  |  |  |  |
| **Valider un inventaire** `stock.inventaires.valider` | Valider les écarts d'inventaire | stock_counts |  |  | x | x | x | x |  |  |  |  |  |  |  |  |  |  |
| **Voir les prix d'achat et la valeur du stock** `stock.valeur.voir` | Prix d'achat, valorisation | stock_items (prix), v_stock_value | € |  | x | x | x |  |  |  |  | x |  |  |  |  |  |  |
| **manager** | | | | | | | | | | | | | | | | | | |
| **Voir le cockpit de direction** `manager.cockpit.voir` | Indicateurs de la société et du groupe, rapport du lundi | vues du Manager | € |  | x | x | x |  |  |  |  |  |  |  |  |  |  |  |
| **Voir le centre de validations** `manager.validations.voir` | Toutes les demandes de validation de la société | approval_requests, approval_delegations |  |  | x | x | x |  |  |  |  |  |  | x |  |  |  |  |
| **Gérer les emprunts** `manager.emprunts.gerer` | Emprunts, échéanciers, capital restant | emprunts (prévu) | € |  | x | x | x |  |  |  |  |  |  |  |  |  |  |  |
| **Gérer les objectifs** `manager.objectifs.gerer` | Objectifs suivis dans le cockpit | objectifs (prévu) |  |  | x | x | x |  |  |  |  |  |  |  |  |  |  |  |
| **validations** | | | | | | | | | | | | | | | | | | |
| **Déléguer ses validations** `validations.deleguer` | Confier ses validations à une autre personne pendant une période | approval_delegations |  |  | x | x | x |  |  |  |  |  |  |  |  |  |  |  |
| **organisation** | | | | | | | | | | | | | | | | | | |
| **Suivre les retours des utilisateurs** `organisation.retours.suivre` | Lire tous les retours (post-it), voir les captures, changer leur statut et répondre à l'auteur ; chacun voit toujours ses propres retours | user_feedback (par le serveur, /api/retours) |  |  | x | x |  |  |  |  |  |  |  |  |  |  |  |  |
