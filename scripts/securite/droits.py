"""Catalogue des droits élémentaires et profils types (chantier C1b, droits composés par société).

Ce fichier est la source du catalogue et des modèles de profils. scripts/securite/regles.py le lit pour :
  * vérifier que chaque droit utilisé par une règle d'accès existe ici ;
  * calculer les droits des profils qui reprennent un rôle actuel (superadmin, admin, direction, gestionnaire,
    formateur, commercial, comptable, lecture, technicien) À PARTIR DE LA MATRICE : un rôle a un droit si et
    seulement si la matrice le lui donnait. C'est ce qui garantit qu'aucun compte actuel ne change d'accès ;
  * générer la migration 0372 (catalogue et modèles) et la documentation du catalogue.

Champs d'un droit : code, module (clé de org_modules, ou None), libellé, ce que le droit permet, données concernées,
drapeaux :
  siens   : limité au périmètre de la personne (ses sessions, ses visites, sa fiche) ;
  prix    : le droit montre des prix, des montants ou des coûts (jamais au technicien) ;
  licence : réservé aux sociétés qui ont la licence totale (companies.full_license), sauf super administrateur ;
  plateforme : réservé au super administrateur (éditeur).
Les droits sans règle d'accès aujourd'hui (modules prévus : RH, véhicules, stock, manager, validations, envois)
sont décrits ici pour les écrans et les modules à venir ; ils seront branchés par leurs branches.
"""

# Droits réservés à la licence totale par la migration 0379 (décision de H, 17/10, confirmée le 18/10 à 22h38) :
# sans licence totale, l'administrateur d'une société ne modifie plus l'identité, les modules, les référents ni les
# comptes ; ces réglages passent par le super administrateur. Le catalogue (0372) les crée sans le drapeau, pour que
# l'application de C1b ne change aucun accès ; 0379 pose le drapeau et se retire seule
# (supabase/rollback/0379_droits_licence_parametres_retour.sql). 0379 doit toujours suivre 0372.
LICENCE_0379 = ['parametres.organisme.modifier', 'parametres.modules.gerer', 'parametres.referents.gerer',
                'parametres.utilisateurs.gerer']

# (code, module, libellé, ce que le droit permet, données, drapeaux)
CATALOGUE = [
    # ── Plateforme et organisation ──────────────────────────────────────────────────────────────
    ('plateforme.administrer', None, 'Administrer la plateforme',
     'Opérations réservées à l\'éditeur : versions, migrations, données de démonstration, corrections exceptionnelles',
     'app_versions, schema_migrations, demo_records, catalogue des droits, modèles de profils', 'plateforme'),
    ('organisation.reglages.voir', None, 'Voir les réglages de l\'organisme',
     'Lire l\'identité, les modules actifs, les référents qualité et les versions (nécessaire à tous les écrans)',
     'organization_settings, org_settings, org_modules, quality_roles, app_versions', ''),
    ('organisation.comptes.voir', None, 'Voir les comptes',
     'Lire la liste des comptes (noms, fonctions, rôles) pour afficher les auteurs et choisir un collègue',
     'profiles', ''),
    ('organisation.preferences.gerer', None, 'Gérer ses préférences',
     'Régler son tableau de bord et sa boîte d\'envoi (seulement les siens)',
     'dashboard_widget_configs, user_email_configs', 'siens'),
    ('organisation.journal.ecrire', None, 'Écrire au journal d\'audit',
     'Ajouter une ligne au journal lors d\'une action (en attendant l\'écriture par la base, chantier F)',
     'audit_logs (ajout seulement)', ''),
    ('organisation.notifications.gerer', None, 'Voir et traiter les notifications',
     'Lire, créer et marquer comme lues les notifications', 'notifications', ''),
    ('organisation.notifications.supprimer', None, 'Supprimer des notifications',
     'Supprimer des notifications', 'notifications', ''),
    ('planning.agenda.voir', None, 'Voir les agendas',
     'Lire les évènements d\'agenda de l\'équipe', 'user_planning_events', ''),
    ('planning.agenda.gerer_siens', None, 'Gérer son agenda',
     'Créer, modifier, supprimer ses propres évènements', 'user_planning_events', 'siens'),
    ('planning.agenda.gerer_equipe', None, 'Gérer les agendas de l\'équipe',
     'Créer, modifier, supprimer les évènements de toute l\'équipe', 'user_planning_events', ''),

    # ── Paramètres (configurer) ─────────────────────────────────────────────────────────────────
    ('parametres.ouvrir', None, 'Ouvrir les Paramètres',
     'Accéder aux pages Paramètres et à l\'assistant de configuration (garde des écrans, branche ecrans/gardes)',
     'pages Paramètres, Console exclue', 'licence'),
    ('parametres.organisme.modifier', None, 'Configurer l\'organisme',
     'Modifier l\'identité, les textes et les réglages de l\'organisme', 'organization_settings, org_settings', ''),
    ('parametres.modules.gerer', None, 'Configurer les modules',
     'Activer ou couper un module', 'org_modules', ''),
    ('parametres.referents.gerer', None, 'Désigner les référents',
     'Désigner les référents qualité (dont le référent handicap)', 'quality_roles', ''),
    ('parametres.utilisateurs.gerer', None, 'Gérer les comptes',
     'Créer, modifier, désactiver un compte (jamais un super administrateur)', 'profiles', ''),
    ('parametres.profils.gerer', None, 'Gérer les profils de droits',
     'Créer et modifier les profils de droits de la société (Paramètres › Profils)',
     'permission_profiles, permission_profile_rights', 'licence'),
    ('parametres.droits.attribuer', None, 'Attribuer des droits',
     'Donner ou retirer des profils et des droits à une personne dans la société (Paramètres › Utilisateurs)',
     'company_member_roles, company_member_rights', 'licence'),
    ('parametres.reseaux_sociaux.voir', 'social', 'Voir les connexions aux réseaux sociaux',
     'Lire l\'état des connexions (jetons) des réseaux sociaux', 'social_tokens', ''),
    ('validations.circuits.configurer', None, 'Configurer les circuits de validation',
     'Régler par périmètre (factures par client, commandes avec seuil, absences, heures, frais) qui valide',
     'approval_rules', ''),

    # ── Formation ───────────────────────────────────────────────────────────────────────────────
    ('formation.catalogue.voir', 'formation', 'Voir le catalogue',
     'Lire les formations, thèmes, matériel, programmes, documents de formation et banques de questions',
     'courses, training_themes, course_equipment, equipment_catalog, programme_versions, trainer_qualifications, '
     'course_documents, course_questions, theme_questions, positioning_questions_ref, positioning_themes', ''),
    ('formation.catalogue.gerer', 'formation', 'Gérer le catalogue',
     'Créer, modifier, supprimer formations, thèmes, matériel et programmes ; supprimer des questions',
     'mêmes tables que « Voir le catalogue »', ''),
    ('formation.questions.modifier', 'formation', 'Rédiger les questions',
     'Créer et modifier les questions des tests et quiz', 'course_questions, theme_questions, positioning_*', ''),
    ('formation.formateurs.voir', 'formation', 'Voir les formateurs', 'Lire les fiches formateurs', 'trainers', ''),
    ('formation.formateurs.gerer', 'formation', 'Gérer les formateurs',
     'Créer, modifier, supprimer les fiches formateurs', 'trainers', ''),
    ('formation.formateurs.modifier_sa_fiche', 'formation', 'Modifier sa fiche de formateur',
     'Le formateur met à jour sa propre fiche (signature, coordonnées)', 'trainers (la sienne)', 'siens'),
    ('formation.formateurs.dossier', 'formation', 'Tenir le dossier des formateurs',
     'Entretiens, formations suivies et certificats des formateurs',
     'trainer_interviews, trainer_trainings, trainer_certificates', ''),
    ('formation.sessions.voir', 'formation', 'Voir toutes les sessions',
     'Lire toutes les sessions, leurs financements, groupes et formateurs',
     'sessions, session_fundings, session_groups, session_trainers', ''),
    ('formation.sessions.voir_siennes', 'formation', 'Voir ses sessions',
     'Le formateur lit ses sessions et tout leur suivi (émargement, évaluations, fiches)',
     'sessions et tables filles, limitées à ses sessions', 'siens'),
    ('formation.sessions.creer', 'formation', 'Créer des sessions', 'Créer une session', 'sessions', ''),
    ('formation.sessions.modifier', 'formation', 'Modifier les sessions',
     'Modifier toutes les sessions, financements, groupes et formateurs',
     'sessions, session_fundings, session_groups, session_trainers', ''),
    ('formation.sessions.modifier_siennes', 'formation', 'Faire vivre ses sessions',
     'Le formateur modifie ses sessions : émargement, évaluations, fiches, documents, check-list',
     'sessions et tables filles, limitées à ses sessions', 'siens'),
    ('formation.sessions.supprimer', 'formation', 'Supprimer des sessions', 'Supprimer une session', 'sessions', ''),
    ('formation.sessions.preparer', 'formation', 'Préparer les sessions',
     'Check-list, documents, envois enregistrés, matériel, analyses des besoins des sessions',
     'session_checklists, session_documents, session_document_access, session_emails_sent, session_equipment, '
     'session_needs_analysis, session_qualiopi, course_document_downloads', ''),
    ('formation.suivi.voir', 'formation', 'Voir le suivi des sessions',
     'Lire émargement, évaluations, fiches de renseignements, objectifs, tests et certificats SST',
     'attendance_*, trainee_info_sheets, trainee_objectives, trainee_positioning_tests, positioning_results, '
     'sst_certifications, quiz_attempts, trainee_evaluations, evaluations_cold, trainer_evaluations, '
     'trainee_documents, session_checklists et documents des sessions', ''),
    ('formation.suivi.gerer', 'formation', 'Corriger le suivi des sessions',
     'Saisir et corriger émargement, évaluations, fiches et certificats ; supprimer des pièces de suivi',
     'mêmes tables que « Voir le suivi des sessions »', ''),
    ('formation.couts.gerer', 'formation', 'Voir et saisir les coûts des sessions',
     'Coûts engagés par session (marge)', 'session_costs', 'prix'),
    ('formation.signatures.suivre', 'formation', 'Suivre les relances de signature',
     'Lire les alertes de signature envoyées', 'signature_alerts_sent', ''),
    ('formation.documents.voir', 'formation', 'Voir les documents', 'Lire les documents déposés',
     'documents, uploaded_documents, uploaded_files', ''),
    ('formation.documents.modifier', 'formation', 'Déposer des documents', 'Déposer et modifier des documents',
     'documents, uploaded_documents, uploaded_files', ''),
    ('formation.documents.supprimer', 'formation', 'Supprimer des documents', 'Supprimer des documents',
     'documents, uploaded_documents, uploaded_files', ''),
    ('formation.stagiaires.voir', 'formation', 'Voir tous les stagiaires',
     'Lire les fiches et inscriptions de tous les stagiaires (jamais le numéro de sécurité sociale ni le handicap)',
     'trainees, session_trainees', ''),
    ('formation.stagiaires.voir_siens', 'formation', 'Voir les stagiaires de ses sessions',
     'Le formateur lit les stagiaires inscrits à ses sessions', 'trainees, trainee_documents (ses sessions)', 'siens'),
    ('formation.stagiaires.creer', 'formation', 'Créer des stagiaires', 'Créer une fiche stagiaire', 'trainees', ''),
    ('formation.stagiaires.modifier', 'formation', 'Modifier les stagiaires', 'Modifier toutes les fiches stagiaires',
     'trainees', ''),
    ('formation.stagiaires.modifier_siens', 'formation', 'Compléter les stagiaires de ses sessions',
     'Le formateur complète les fiches et documents des stagiaires de ses sessions',
     'trainees, trainee_documents (ses sessions)', 'siens'),
    ('formation.stagiaires.supprimer', 'formation', 'Supprimer des stagiaires', 'Supprimer une fiche stagiaire',
     'trainees', ''),
    ('formation.stagiaires.archives', 'formation', 'Gérer les archives des stagiaires',
     'Lire et tenir les archives des stagiaires', 'trainees_archive', ''),
    ('formation.inscriptions.gerer', 'formation', 'Inscrire des stagiaires',
     'Inscrire, modifier et retirer des stagiaires d\'une session', 'session_trainees', ''),
    ('formation.convocations.envoyer', 'formation', 'Envoyer aux stagiaires et aux clients',
     'Envoyer convocations, documents de fin de stage et liens d\'évaluation (route /api, branche ecrans/gardes)',
     'emails des sessions', ''),

    # ── Clients ─────────────────────────────────────────────────────────────────────────────────
    ('clients.fiches.voir', 'commercial', 'Voir les clients',
     'Lire clients, contacts, sites et historique des échanges',
     'clients, client_contacts, sites, client_interactions', ''),
    ('clients.fiches.modifier', 'commercial', 'Modifier les clients',
     'Créer et modifier clients, contacts, sites ; supprimer contacts et sites',
     'clients, client_contacts, sites, client_interactions', ''),
    ('clients.fiches.supprimer', 'commercial', 'Supprimer des clients',
     'Supprimer un client et des lignes d\'historique', 'clients, client_interactions', ''),
    ('clients.historique.ecrire', 'commercial', 'Noter un échange avec un client',
     'Ajouter une ligne à l\'historique d\'un client', 'client_interactions', ''),
    ('clients.espace.gerer', 'commercial', 'Gérer l\'espace entreprise et les prestataires',
     'Accès des clients à leur espace, prestataires concurrents', 'client_portal_access, client_providers', ''),

    # ── Commercial : devis et prospection ───────────────────────────────────────────────────────
    ('commercial.devis.voir', 'commercial', 'Voir les devis', 'Lire les devis et leurs lignes, avec les prix',
     'quotes, quote_items', 'prix'),
    ('commercial.devis.modifier', 'commercial', 'Préparer les devis', 'Créer et modifier des devis',
     'quotes, quote_items', 'prix'),
    ('commercial.devis.supprimer', 'commercial', 'Supprimer des devis', 'Supprimer un devis', 'quotes', ''),
    ('commercial.devis.envoyer', 'commercial', 'Envoyer les devis',
     'Envoyer un devis au client (route /api)', 'emails des devis', 'prix'),
    ('commercial.prospection.voir', 'prospection', 'Voir la prospection',
     'Lire la base prospects, appels, rendez-vous, analyses de besoin, imports',
     'prospection_massive, prospect_*, phoning_sessions, call_*, rdv_*, import_logs', ''),
    ('commercial.prospection.gerer', 'prospection', 'Prospecter',
     'Appeler, noter, prendre rendez-vous, importer', 'mêmes tables que « Voir la prospection »', ''),
    ('commercial.prospection.supprimer', 'prospection', 'Supprimer des prospects', 'Supprimer de la base prospects',
     'prospection_massive', ''),
    ('communication.campagnes.gerer', 'mailing', 'Gérer les campagnes email',
     'Segments, modèles, envois, liste d\'exclusion', 'mailing_*', ''),
    ('communication.reseaux.gerer', 'social', 'Publier sur les réseaux sociaux',
     'Préparer et planifier les publications, bibliothèque de médias', 'social_posts, social_media_library', ''),

    # ── Facturation ─────────────────────────────────────────────────────────────────────────────
    ('facturation.factures.voir', 'commercial', 'Voir les factures',
     'Lire factures, avoirs, lignes, paiements, relances et envois, avec les montants',
     'invoices, invoice_items, invoice_sessions, invoice_payments, invoice_relances, invoice_emails_sent', 'prix'),
    ('facturation.factures.modifier', 'commercial', 'Préparer les factures',
     'Créer et modifier factures et lignes, saisir les paiements et les relances',
     'mêmes tables que « Voir les factures »', 'prix'),
    ('facturation.factures.supprimer', 'commercial', 'Supprimer des factures',
     'Supprimer une facture (refusé par la base pour une facture émise, chantier Facturation fiable)',
     'invoices, invoice_relances, invoice_emails_sent', ''),
    ('facturation.brouillons.supprimer', 'commercial', 'Supprimer ses brouillons de facture',
     'Supprimer une facture encore en brouillon', 'invoices (brouillons)', ''),
    ('facturation.factures.valider', 'commercial', 'Valider les factures',
     'Émettre une facture : numéro définitif donné par la base, contenu figé (chantier Facturation fiable)',
     'invoices', 'prix'),
    ('facturation.factures.envoyer', 'commercial', 'Envoyer les factures',
     'Envoyer ou mettre à disposition une facture émise', 'emails des factures', 'prix'),
    ('facturation.avoirs.emettre', 'commercial', 'Émettre des avoirs',
     'Annuler tout ou partie d\'une facture émise par un avoir', 'invoices (avoirs)', 'prix'),
    ('facturation.brouillons.demander_confirmation', 'commercial', 'Demander la confirmation d\'un brouillon',
     'Comptable externe : signaler un brouillon à son auteur et demander sa confirmation, sans le modifier',
     'notifications', ''),
    ('facturation.comptable_externe.regler', 'commercial', 'Choisir ce que voit le comptable externe',
     'Direction : rendre les devis visibles ou non au comptable externe de la société (sans ouvrir les Paramètres)',
     'profil « comptable externe » de la société', ''),
    ('facturation.export.comptable', 'comptabilite', 'Exporter pour la comptabilité',
     'Exports comptables, FEC, transmission au comptable', 'factures émises, avoirs, paiements', 'prix'),

    # ── Finance ─────────────────────────────────────────────────────────────────────────────────
    ('finance.budget.gerer', 'finance', 'Tenir le budget et la comptabilité',
     'Budget, relevés bancaires, rapprochement, catégories, périodes comptables',
     'budget_*, bank_statements, accounting_periods', 'prix'),

    # ── Qualité, conformité, prestations ────────────────────────────────────────────────────────
    ('qualite.registres.voir', 'qualite', 'Voir les registres qualité',
     'Non-conformités, réclamations, alertes, veille, processus, audits internes, RGPD, BPF, indicateurs',
     'non_conformites, reclamations, quality_alerts, veille_*, process_*, audits_internes, rgpd_traitements, '
     'bpf_declarations, qualiopi_indicators', ''),
    ('qualite.registres.signaler', 'qualite', 'Signaler dans les registres qualité',
     'Créer une non-conformité, une réclamation, une alerte, une veille', 'mêmes tables', ''),
    ('qualite.registres.gerer', 'qualite', 'Traiter les registres qualité',
     'Modifier et clore les lignes des registres qualité', 'mêmes tables', ''),
    ('qualite.documents.voir', None, 'Voir les documents qualité', 'Lire les documents qualité et leurs versions',
     'quality_documents, qualiopi_documents, quality_doc_versions', ''),
    ('qualite.documents.gerer', None, 'Gérer les documents qualité', 'Créer et modifier les documents qualité',
     'quality_documents, qualiopi_documents', ''),
    ('qualite.documents.valider', None, 'Valider une version de document qualité',
     'Enregistrer une nouvelle version validée', 'quality_doc_versions', ''),
    ('qualite.completude.suivre', None, 'Suivre la complétude',
     'Lire et traiter les alertes de complétude des sessions', 'completude_alerts, completude_tracking', ''),
    ('qualite.completude.supprimer', None, 'Supprimer des alertes de complétude', 'Supprimer des alertes',
     'completude_alerts, completude_tracking', ''),
    ('qualite.certification.gerer', 'certification', 'Préparer les certifications',
     'Référentiels, preuves, constats d\'audit, réglages (face auditeur)', 'cert_*', ''),
    ('qualite.handicap.voir', 'qualite', 'Voir les données de handicap',
     'Direction et référent handicap : besoins, adaptations, registre PSH (règle app.can_see_disability, inchangée)',
     'trainee_disability, psh_requests', ''),
    ('prestations.duerp.gerer', 'duerp', 'Réaliser les DUERP',
     'Projets DUERP, unités, risques, actions', 'duerp_*', ''),
    ('passeport.declarations.gerer', 'passeport', 'Déclarer au Passeport de prévention',
     'Préparer et suivre les déclarations (règles propres du Passeport, pp_can, inchangées)', 'pp_*', ''),
    ('conformite.journal.voir', None, 'Voir le journal d\'audit', 'Lire le journal d\'audit de la société',
     'audit_logs', ''),
    ('conformite.rgpd.gerer', None, 'Tenir le registre RGPD',
     'Registre, sous-traitants, AIPD, informations (chantier F)', 'rgpd_* (prévu)', ''),
    ('conformite.demandes.gerer', None, 'Traiter les demandes des personnes', 'Droits d\'accès, rectification, effacement',
     'rgpd_requests (prévu)', ''),
    ('conformite.violations.gerer', None, 'Gérer les violations de données', 'Registre des violations (72 h)',
     'rgpd_breaches (prévu)', ''),
    ('conformite.purges.valider', None, 'Valider les purges', 'Valider les passages de purge proposés',
     'rgpd_purges (prévu)', ''),

    # ── Interventions ───────────────────────────────────────────────────────────────────────────
    ('interventions.referentiel.voir', 'interventions', 'Voir les types d\'appareils et les techniciens',
     'Lire les types de matériel et la liste des techniciens', 'itv_equipment_types, itv_technicians', ''),
    ('interventions.tarifs.voir', 'interventions', 'Voir les prix des interventions',
     'Lire les prix des pièces, le forfait de visite et les prix des pièces fournies',
     'itv_parts, itv_settings, itv_visit_parts', 'prix'),
    ('interventions.reglages.gerer', 'interventions', 'Configurer les interventions',
     'Réglages, types de matériel, pièces et prix, techniciens', 'itv_settings, itv_equipment_types, itv_parts, '
     'itv_technicians', 'prix'),
    ('interventions.contrats.voir', 'interventions', 'Voir les contrats de maintenance',
     'Lire les contrats avec leur prix annuel', 'itv_contracts', 'prix'),
    ('interventions.contrats.gerer', 'interventions', 'Gérer les contrats de maintenance',
     'Créer et modifier les contrats', 'itv_contracts', 'prix'),
    ('interventions.visites.voir', 'interventions', 'Voir toutes les visites',
     'Lire toutes les visites et leurs lignes de contrôle', 'itv_visits, itv_visit_items', ''),
    ('interventions.visites.gerer', 'interventions', 'Planifier et gérer les visites',
     'Créer, planifier, modifier, supprimer toutes les visites et leurs lignes', 'itv_visits, itv_visit_items, '
     'itv_visit_parts', ''),
    ('interventions.parc.voir', 'interventions', 'Voir le parc des clients', 'Lire les appareils de tous les clients',
     'itv_equipment', ''),
    ('interventions.parc.gerer', 'interventions', 'Gérer le parc des clients',
     'Créer, modifier, supprimer des appareils', 'itv_equipment', ''),
    ('interventions.missions.voir', 'interventions', 'Voir ses missions',
     'Le technicien lit ses visites, les clients, sites et contacts de ses visites, leur parc et leur historique, '
     'sans aucun prix', 'itv_visits, clients, client_contacts, sites, itv_equipment, itv_visit_items, vues terrain',
     'siens'),
    ('interventions.missions.realiser', 'interventions', 'Intervenir',
     'Le technicien réalise ses visites : démarrage, contrôles, pièces fournies, photos, signature du client',
     'itv_visits, itv_visit_items, itv_visit_parts (ses visites)', 'siens'),
    ('interventions.parc.annoter', 'interventions', 'Annoter le parc de ses clients',
     'Le technicien ajoute ou corrige un appareil chez les clients de ses visites', 'itv_equipment (ses clients)',
     'siens'),
    ('interventions.rapports.envoyer', 'interventions', 'Envoyer les rapports d\'intervention',
     'Envoyer le rapport de visite au client', 'emails des visites', ''),

    # ── RH (module rh, prévu) ───────────────────────────────────────────────────────────────────
    ('rh.personnel.voir', 'rh', 'Voir le personnel',
     'Annuaire : nom, emploi, équipe, téléphone et email professionnels', 'hr_people (partie annuaire)', ''),
    ('rh.dossiers.voir', 'rh', 'Voir les dossiers du personnel',
     'Fiche complète : identité, coordonnées personnelles, contrat', 'hr_people, hr_employments', ''),
    ('rh.dossiers.gerer', 'rh', 'Tenir les dossiers du personnel',
     'Créer et modifier personnes, contrats, équipes, horaires, habilitations, suivi de santé administratif',
     'hr_*', ''),
    ('rh.salaires.voir', 'rh', 'Voir les salaires', 'Lire les rémunérations (consultation journalisée)',
     'hr_compensation', 'prix'),
    ('rh.absences.demander', 'rh', 'Demander une absence', 'Demander ses congés et absences, voir son solde',
     'hr_absence_requests (les siennes)', 'siens'),
    ('rh.absences.valider', 'rh', 'Valider les absences', 'Valider ou refuser les demandes d\'absence',
     'hr_absence_requests, approval_requests', ''),
    ('rh.heures.saisir', 'rh', 'Saisir ses heures', 'Remplir sa semaine d\'heures', 'hr_time_entries (les siennes)',
     'siens'),
    ('rh.heures.valider', 'rh', 'Valider les heures', 'Valider les semaines d\'heures et les heures supplémentaires',
     'hr_timesheets, approval_requests', ''),
    ('rh.documents.restreints', 'rh', 'Voir les documents restreints du personnel',
     'Justificatifs d\'absence, santé au travail administrative, bulletins', 'hr_documents (restreint, privé)', ''),
    ('rh.parametres.gerer', 'rh', 'Configurer les RH', 'Types d\'absence, horaires de référence, règles de temps',
     'hr_absence_types, hr_schedules', ''),

    # ── Frais (module frais, prévu) ─────────────────────────────────────────────────────────────
    ('frais.notes.saisir', 'frais', 'Saisir ses notes de frais', 'Déclarer ses frais avec justificatif',
     'notes de frais (les siennes)', 'siens'),
    ('frais.notes.valider', 'frais', 'Valider les notes de frais', 'Valider ou refuser les notes de frais',
     'notes de frais, approval_requests', 'prix'),

    # ── Véhicules (module vehicules, prévu) ─────────────────────────────────────────────────────
    ('vehicules.siens.utiliser', 'vehicules', 'Utiliser son véhicule',
     'Voir son véhicule, saisir un plein, un état des lieux, un incident', 'vehicles (le sien), pleins, incidents',
     'siens'),
    ('vehicules.parc.voir', 'vehicules', 'Voir le parc de véhicules', 'Lire les véhicules, échéances et historiques',
     'vehicles, entretiens, échéances', ''),
    ('vehicules.couts.voir', 'vehicules', 'Voir les coûts des véhicules', 'Coûts, pleins, factures d\'entretien',
     'pleins, entretiens', 'prix'),
    ('vehicules.parc.gerer', 'vehicules', 'Gérer le parc de véhicules', 'Créer, modifier, attribuer les véhicules',
     'vehicles, attributions', ''),
    ('vehicules.carte.voir', 'vehicules', 'Voir la carte en direct',
     'Positions des véhicules pendant les heures de service (direction seulement)', 'vehicle_live, positions', ''),
    ('vehicules.ecran_mural.voir', 'vehicules', 'Afficher l\'écran mural',
     'Page plein écran du suivi des véhicules, en lecture seule (compte « écran »)', 'vehicle_live (affichage)', ''),
    ('vehicules.geolocalisation.configurer', 'vehicules', 'Configurer la géolocalisation',
     'Fournisseur de boîtiers, heures de service', 'réglages du module', ''),

    # ── Stock et achats (module stock, prévu) ───────────────────────────────────────────────────
    ('stock.sien.mouvementer', 'stock', 'Mouvementer son stock',
     'Voir et mouvementer le stock de son véhicule ou le sien (prise au dépôt, retour)', 'stock_movements (le sien)',
     'siens'),
    ('stock.voir', 'stock', 'Voir tout le stock', 'Quantités de tous les emplacements, transferts entre dépôts',
     'stock_*', ''),
    ('stock.articles.gerer', 'stock', 'Gérer les articles et les seuils', 'Articles, fournisseurs, seuils',
     'stock_items, suppliers, stock_thresholds', ''),
    ('stock.commandes.preparer', 'stock', 'Préparer une commande', 'Préparer une demande ou une commande d\'achat',
     'purchase_orders', ''),
    ('stock.commandes.valider', 'stock', 'Valider les commandes',
     'Valider les commandes selon le seuil de la société', 'purchase_orders, approval_requests', 'prix'),
    ('stock.inventaires.valider', 'stock', 'Valider un inventaire', 'Valider les écarts d\'inventaire',
     'stock_counts', ''),
    ('stock.valeur.voir', 'stock', 'Voir les prix d\'achat et la valeur du stock', 'Prix d\'achat, valorisation',
     'stock_items (prix), v_stock_value', 'prix'),

    # ── Manager (cockpit, prévu) ────────────────────────────────────────────────────────────────
    ('manager.cockpit.voir', 'manager', 'Voir le cockpit de direction',
     'Indicateurs de la société et du groupe, rapport du lundi', 'vues du Manager', 'prix'),
    ('manager.validations.voir', None, 'Voir le centre de validations',
     'Toutes les demandes de validation de la société', 'approval_requests, approval_delegations', ''),
    ('manager.emprunts.gerer', 'manager', 'Gérer les emprunts', 'Emprunts, échéanciers, capital restant',
     'emprunts (prévu)', 'prix'),
    ('manager.objectifs.gerer', 'manager', 'Gérer les objectifs', 'Objectifs suivis dans le cockpit',
     'objectifs (prévu)', ''),
    ('validations.deleguer', None, 'Déléguer ses validations',
     'Confier ses validations à une autre personne pendant une période', 'approval_delegations', ''),
]

# Profils types (modèles de plateforme, copiables et modifiables par société).
#   cle : (libellé, description, rôle actuel repris (droits calculés depuis la matrice) ou None, droits en plus)
# Les droits « en plus » sont des droits sans règle d'accès aujourd'hui (modules prévus) : ils ne changent
# aucun accès actuel.
_GESTION_FUTURE = [
    'formation.convocations.envoyer', 'commercial.devis.envoyer', 'facturation.factures.valider',
    'facturation.factures.envoyer', 'facturation.avoirs.emettre', 'interventions.rapports.envoyer',
    'qualite.handicap.voir', 'passeport.declarations.gerer',
    'conformite.rgpd.gerer', 'conformite.demandes.gerer', 'conformite.violations.gerer', 'conformite.purges.valider',
    'rh.personnel.voir', 'rh.dossiers.voir', 'rh.dossiers.gerer', 'rh.salaires.voir', 'rh.absences.valider',
    'rh.heures.valider', 'rh.parametres.gerer', 'frais.notes.valider',
    'vehicules.parc.voir', 'vehicules.couts.voir', 'vehicules.parc.gerer', 'vehicules.carte.voir',
    'stock.voir', 'stock.articles.gerer', 'stock.commandes.preparer', 'stock.commandes.valider',
    'stock.inventaires.valider', 'stock.valeur.voir',
    'manager.cockpit.voir', 'manager.validations.voir', 'manager.emprunts.gerer', 'manager.objectifs.gerer',
    'validations.deleguer', 'validations.circuits.configurer', 'facturation.export.comptable',
    'facturation.comptable_externe.regler',
]

PROFILS = {
    'superadmin': ('Super administrateur', 'Éditeur de la plateforme : tous les droits ; voit une société par '
                   'l\'accès de support (C1a)', 'superadmin', None),  # None = tous les droits du catalogue non limités
    'admin': ('Administrateur', 'Associés : tout sauf la plateforme ; les Paramètres seulement avec la licence '
              'totale de la société', 'admin',
              _GESTION_FUTURE + ['parametres.ouvrir', 'parametres.profils.gerer', 'parametres.droits.attribuer',
                                 'vehicules.geolocalisation.configurer']),
    'direction': ('Direction', 'Direction de la société : toutes les données de gestion, jamais les Paramètres',
                  'direction', _GESTION_FUTURE),
    'gestionnaire': ('Gestionnaire', 'Organisation des sessions, des clients et des interventions', 'gestionnaire',
                     ['formation.convocations.envoyer', 'commercial.devis.envoyer', 'interventions.rapports.envoyer',
                      'passeport.declarations.gerer', 'rh.personnel.voir', 'stock.voir', 'stock.articles.gerer',
                      'stock.commandes.preparer', 'stock.inventaires.valider', 'vehicules.parc.voir']),
    'formateur': ('Formateur', 'Ses sessions et leurs stagiaires seulement ; ni devis ni factures', 'formateur', []),
    'commercial': ('Commercial', 'Clients, prospection, devis et factures', 'commercial',
                   ['formation.convocations.envoyer', 'commercial.devis.envoyer', 'facturation.factures.envoyer']),
    'technicien': ('Technicien', 'Ses missions sur le terrain ; peut annoter ; jamais aucun prix', 'technicien',
                   ['interventions.rapports.envoyer', 'stock.sien.mouvementer', 'stock.commandes.preparer',
                    'vehicules.siens.utiliser']),
    'comptable': ('Comptable interne', 'Factures, paiements, espace comptable ; aucune donnée de formation sensible',
                  'comptable', ['facturation.export.comptable', 'facturation.factures.envoyer', 'stock.valeur.voir',
                                'vehicules.couts.voir']),
    'comptable_externe': ('Comptable externe', 'Cabinet comptable : lit les factures et avoirs (brouillons signalés '
                          '« sans valeur comptable ») ; ne modifie rien ; demande une confirmation à l\'auteur. '
                          'Devis : la direction ajoute « Voir les devis » au profil de sa société si elle le veut',
                          None, ['organisation.reglages.voir', 'organisation.preferences.gerer',
                                 'clients.fiches.voir', 'facturation.factures.voir',
                                 'facturation.brouillons.demander_confirmation', 'facturation.export.comptable']),
    'rh': ('Ressources humaines', 'Dossiers du personnel, absences, heures, documents RH', None,
           ['organisation.reglages.voir', 'organisation.comptes.voir', 'organisation.preferences.gerer',
            'organisation.notifications.gerer', 'planning.agenda.voir', 'planning.agenda.gerer_siens',
            'rh.personnel.voir', 'rh.dossiers.voir', 'rh.dossiers.gerer', 'rh.salaires.voir', 'rh.absences.valider',
            'rh.heures.valider', 'rh.documents.restreints', 'rh.parametres.gerer', 'manager.validations.voir']),
    'salarie': ('Salarié', 'Son espace : congés, heures, frais, son véhicule, son stock', None,
                ['organisation.reglages.voir', 'organisation.preferences.gerer', 'rh.personnel.voir',
                 'rh.absences.demander', 'rh.heures.saisir', 'frais.notes.saisir', 'vehicules.siens.utiliser',
                 'stock.sien.mouvementer']),
    'lecture': ('Lecture', 'Consultation sans modification ; ni devis ni factures', 'lecture', []),
    'ecran': ('Compte « écran »', 'Écran mural des véhicules : une seule page, lecture seule, révocable d\'un clic',
              None, ['organisation.reglages.voir', 'vehicules.ecran_mural.voir']),
    'membre': ('Sans profil de base', 'Rôle de base vide : les droits viennent seulement des profils attribués '
               'dans la société (comptable externe, RH, salarié, écran)', None, []),
}

# Rôles du profil (profiles.role) qui reprennent un modèle ; « membre » : droits seulement par profils attribués
ROLES_REPRIS = ['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable',
                'lecture', 'technicien']


def catalogue_par_code():
    out = {}
    for c in CATALOGUE:
        assert c[0] not in out, f'droit en double : {c[0]}'
        out[c[0]] = c
    return out
