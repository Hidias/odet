-- 0001_base_schema.sql : socle de données du produit (derive du schema Access Campus du 2026-10-11, nettoye)
-- Tables supprimees volontairement : call_script_steps, call_scripts, client_tags, daily_attendances, evaluations_hot, evaluations_trainer, internal_notes, marine_commissions, marine_queue, phoning_session_items, prospect_search_history, prospect_search_history_backup_20260206, prospect_transfers, prospection_massive_backup_phonecleanup_v2, prospection_massive_backup_phonelink, public_portal_tokens, public_tokens, questionnaire_responses, questionnaires, revues_direction, session_accessibility, session_alerts, session_attendance, session_attendance_days, session_evaluations, session_qualiopi_indicators, stagiaire_tags, veille_reglementaire

create extension if not exists "pg_cron";
create extension if not exists "pg_net";
create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";


create table public."_encryption_keys" (
  "id" text default 'ssn_key'::text not null,
  "key_value" text not null,
  "created_at" timestamp with time zone default now(),
  constraint "_encryption_keys_pkey" PRIMARY KEY (id)
);

create table public."accounting_periods" (
  "id" uuid default gen_random_uuid() not null,
  "year" integer not null,
  "month" integer not null,
  "label" text not null,
  "locked" boolean default false not null,
  "locked_at" timestamp with time zone,
  "locked_by" text,
  "notes" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  constraint "accounting_periods_month_check" CHECK (((month >= 1) AND (month <= 12))),
  constraint "accounting_periods_pkey" PRIMARY KEY (id),
  constraint "accounting_periods_year_month_key" UNIQUE (year, month)
);

create table public."app_versions" (
  "id" uuid default gen_random_uuid() not null,
  "version" character varying(20) not null,
  "release_date" date not null,
  "title" character varying(255),
  "changes" jsonb default '[]'::jsonb,
  "created_at" timestamp with time zone default now(),
  constraint "app_versions_pkey" PRIMARY KEY (id)
);

create table public."attendance_halfdays" (
  "id" uuid default gen_random_uuid() not null,
  "session_id" uuid,
  "trainee_id" uuid,
  "date" date not null,
  "morning" boolean default false,
  "afternoon" boolean default false,
  "validated_by" text,
  "validated_at" timestamp with time zone,
  "created_at" timestamp with time zone default now(),
  "signed_morning_at" timestamp with time zone,
  "signed_afternoon_at" timestamp with time zone,
  "signature_morning" text,
  "signature_afternoon" text,
  constraint "attendance_halfdays_pkey" PRIMARY KEY (id)
);

create table public."attendance_proxy_signatures" (
  "id" uuid default gen_random_uuid() not null,
  "session_id" uuid not null,
  "trainee_id" uuid not null,
  "date" date not null,
  "period" text not null,
  "reason" text not null,
  "proxy_last_name" text not null,
  "proxy_first_name" text not null,
  "proxy_role" text not null,
  "proxy_signature" text not null,
  "trainer_signature" text not null,
  "created_by" text,
  "created_at" timestamp with time zone default now() not null,
  constraint "attendance_proxy_signatures_period_check" CHECK ((period = ANY (ARRAY['morning'::text, 'afternoon'::text]))),
  constraint "attendance_proxy_signatures_pkey" PRIMARY KEY (id)
);

create table public."attendances" (
  "id" uuid default gen_random_uuid() not null,
  "session_id" uuid not null,
  "trainee_id" uuid not null,
  "date" date not null,
  "period" text default 'full'::text,
  "present" boolean default false,
  "signature" text,
  "created_at" timestamp with time zone default now(),
  "signature_hash" text,
  "signed_at" timestamp with time zone,
  constraint "attendances_pkey" PRIMARY KEY (id)
);

create table public."audit_logs" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid,
  "user_email" text,
  "timestamp" timestamp with time zone default now(),
  "action" character varying(50) not null,
  "entity_type" character varying(50) not null,
  "entity_id" uuid,
  "entity_name" text,
  "details" jsonb,
  "ip_address" text,
  "user_agent" text,
  "created_at" timestamp with time zone default now(),
  constraint "audit_logs_action_check" CHECK (((action)::text = ANY ((ARRAY['view'::character varying, 'create'::character varying, 'update'::character varying, 'delete'::character varying, 'export'::character varying, 'login'::character varying, 'logout'::character varying, 'print'::character varying, 'download'::character varying])::text[]))),
  constraint "audit_logs_entity_type_check" CHECK (((entity_type)::text = ANY ((ARRAY['trainee'::character varying, 'session'::character varying, 'client'::character varying, 'trainer'::character varying, 'course'::character varying, 'document'::character varying, 'nc'::character varying, 'veille'::character varying, 'evaluation'::character varying, 'attendance'::character varying, 'system'::character varying])::text[]))),
  constraint "audit_logs_pkey" PRIMARY KEY (id)
);

create table public."audits_internes" (
  "id" uuid default gen_random_uuid() not null,
  "date_audit" date not null,
  "auditeur" character varying(100) not null,
  "processus_audite" character varying(255) not null,
  "indicateurs_qualiopi" character varying(50),
  "constats_positifs" text,
  "points_amelioration" text,
  "non_conformites" text,
  "actions_decidees" text,
  "conclusion" text,
  "date_prochaine_action" date,
  "statut" character varying(20) default 'planifie'::character varying,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  constraint "audits_internes_pkey" PRIMARY KEY (id)
);

create table public."bank_statements" (
  "id" uuid default gen_random_uuid() not null,
  "statement_number" integer,
  "statement_year" integer,
  "period_start" date,
  "period_end" date not null,
  "account_label" text default 'CMB — 00890689 40'::text,
  "opening_balance" numeric(12,2) not null,
  "closing_balance" numeric(12,2) not null,
  "total_debits" numeric(12,2) default 0 not null,
  "total_credits" numeric(12,2) default 0 not null,
  "arithmetic_ok" boolean default false not null,
  "arithmetic_delta" numeric(12,2) default 0,
  "campus_balance" numeric(12,2),
  "campus_delta" numeric(12,2),
  "reconciled_at" timestamp with time zone,
  "file_name" text not null,
  "file_path" text not null,
  "file_size" integer,
  "parse_source" text default 'auto'::text,
  "uploaded_by" text,
  "sent_to_comptable" boolean default false not null,
  "sent_to_comptable_at" timestamp with time zone,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "bank_statements_pkey" PRIMARY KEY (id)
);

create table public."bpf_declarations" (
  "id" uuid default gen_random_uuid() not null,
  "year" integer not null,
  "status" text default 'draft'::text,
  "org_name" text default 'Access Formation'::text,
  "org_siret" text default '94356386600012'::text,
  "org_nda" text default '53291026129'::text,
  "org_address" text default '24 Rue Kerbleiz, 29900 Concarneau'::text,
  "org_dirigeant" text default 'Hicham Saidi'::text,
  "exercice_start" date,
  "exercice_end" date,
  "ca_entreprises" numeric(12,2) default 0,
  "ca_opco" numeric(12,2) default 0,
  "ca_pouvoirs_publics" numeric(12,2) default 0,
  "ca_cpf" numeric(12,2) default 0,
  "ca_contrats_apprentissage" numeric(12,2) default 0,
  "ca_particuliers" numeric(12,2) default 0,
  "ca_sous_traitance" numeric(12,2) default 0,
  "ca_autres" numeric(12,2) default 0,
  "ca_total" numeric(12,2) default 0,
  "charges_personnel_formateur" numeric(12,2) default 0,
  "charges_personnel_non_formateur" numeric(12,2) default 0,
  "charges_sous_traitance" numeric(12,2) default 0,
  "charges_locaux" numeric(12,2) default 0,
  "charges_achats" numeric(12,2) default 0,
  "charges_impots" numeric(12,2) default 0,
  "charges_amortissements" numeric(12,2) default 0,
  "charges_autres" numeric(12,2) default 0,
  "charges_total" numeric(12,2) default 0,
  "formateurs_internes_nb" integer default 0,
  "formateurs_internes_heures" numeric(8,1) default 0,
  "formateurs_externes_nb" integer default 0,
  "formateurs_externes_heures" numeric(8,1) default 0,
  "stagiaires_salaries" integer default 0,
  "stagiaires_demandeurs_emploi" integer default 0,
  "stagiaires_particuliers" integer default 0,
  "stagiaires_autres" integer default 0,
  "stagiaires_total" integer default 0,
  "stagiaires_hommes" integer default 0,
  "stagiaires_femmes" integer default 0,
  "obj_certification" integer default 0,
  "obj_perfectionnement" integer default 0,
  "obj_adaptation_poste" integer default 0,
  "obj_insertion" integer default 0,
  "obj_autres" integer default 0,
  "heures_stagiaires_total" numeric(10,1) default 0,
  "specialites" jsonb default '[]'::jsonb,
  "nb_sessions" integer default 0,
  "nb_sessions_realisees" integer default 0,
  "notes" text,
  "calculated_at" timestamp with time zone,
  "submitted_at" timestamp with time zone,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  constraint "bpf_declarations_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text, 'validated'::text]))),
  constraint "bpf_declarations_pkey" PRIMARY KEY (id),
  constraint "bpf_declarations_year_key" UNIQUE (year)
);

create table public."budget_actions" (
  "id" uuid default gen_random_uuid() not null,
  "title" text not null,
  "detail" text,
  "type" text default 'manual'::text,
  "auto_key" text,
  "status" text default 'todo'::text,
  "impact_monthly" numeric(10,2),
  "impact_once" numeric(10,2),
  "due_date" date,
  "note" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  constraint "budget_actions_pkey" PRIMARY KEY (id)
);

create table public."budget_categories" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "direction" text not null,
  "type" text not null,
  "icon" text default '📁'::text,
  "color" text default 'gray'::text,
  "sort_order" integer default 100,
  "created_at" timestamp with time zone default now(),
  constraint "budget_categories_direction_check" CHECK ((direction = ANY (ARRAY['depense'::text, 'recette'::text, 'neutre'::text]))),
  constraint "budget_categories_type_check" CHECK ((type = ANY (ARRAY['fixe'::text, 'variable'::text, 'exceptionnel'::text]))),
  constraint "budget_categories_pkey" PRIMARY KEY (id),
  constraint "budget_categories_name_key" UNIQUE (name)
);

create table public."budget_emails_sent" (
  "id" uuid default gen_random_uuid() not null,
  "sent_at" timestamp with time zone default now(),
  "sent_by" text,
  "to_email" text not null,
  "cc_email" text,
  "subject" text,
  "nb_transactions" integer default 0,
  "nb_receipts" integer default 0,
  "transaction_ids" uuid[],
  "notes" text,
  "message_id" text,
  "status" text default 'sent'::text,
  constraint "budget_emails_sent_pkey" PRIMARY KEY (id)
);

create table public."budget_meal_guests" (
  "id" uuid default gen_random_uuid() not null,
  "transaction_id" uuid not null,
  "meal_for" text default 'hicham'::text not null,
  "guest_name" text,
  "guest_company" text,
  "motif" text,
  "nb_convives" integer default 2,
  "created_at" timestamp with time zone default now(),
  "guest_first_name" text,
  "client_id" uuid,
  constraint "budget_meal_guests_meal_for_check" CHECK ((meal_for = ANY (ARRAY['hicham'::text, 'maxime'::text]))),
  constraint "budget_meal_guests_pkey" PRIMARY KEY (id)
);

create table public."budget_pipeline" (
  "id" uuid default gen_random_uuid() not null,
  "client" text not null,
  "description" text,
  "amount_ht" numeric default 0,
  "amount_ttc" numeric default 0,
  "expected_month" text not null,
  "expected_date" date,
  "type" text default 'previsionnel'::text,
  "status" text default 'prevu'::text,
  "trainer" text,
  "notes" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  constraint "budget_pipeline_status_check" CHECK ((status = ANY (ARRAY['prevu'::text, 'facture'::text, 'encaisse'::text, 'annule'::text]))),
  constraint "budget_pipeline_type_check" CHECK ((type = ANY (ARRAY['previsionnel'::text, 'devis_signe'::text, 'facture_emise'::text]))),
  constraint "budget_pipeline_pkey" PRIMARY KEY (id)
);

create table public."budget_receipts" (
  "id" uuid default gen_random_uuid() not null,
  "transaction_id" uuid,
  "file_name" text not null,
  "file_path" text not null,
  "file_type" text,
  "file_size" integer,
  "created_at" timestamp with time zone default now(),
  constraint "budget_receipts_pkey" PRIMARY KEY (id)
);

create table public."budget_rules" (
  "id" uuid default gen_random_uuid() not null,
  "keyword" text not null,
  "category_id" uuid,
  "direction" text default 'both'::text,
  "priority" integer default 10,
  "created_at" timestamp with time zone default now(),
  constraint "budget_rules_direction_check" CHECK ((direction = ANY (ARRAY['debit'::text, 'credit'::text, 'both'::text]))),
  constraint "budget_rules_pkey" PRIMARY KEY (id)
);

create table public."budget_settings" (
  "key" text not null,
  "value" text not null,
  "updated_at" timestamp with time zone default now(),
  constraint "budget_settings_pkey" PRIMARY KEY (key)
);

create table public."budget_transaction_invoices" (
  "id" uuid default gen_random_uuid() not null,
  "transaction_id" uuid not null,
  "invoice_id" uuid not null,
  "amount_applied" numeric default 0 not null,
  "reconciled_at" timestamp with time zone default now(),
  "reconciled_by" text default 'Hicham'::text,
  "notes" text,
  "created_at" timestamp with time zone default now(),
  constraint "budget_transaction_invoices_pkey" PRIMARY KEY (id),
  constraint "budget_transaction_invoices_transaction_id_invoice_id_key" UNIQUE (transaction_id, invoice_id)
);

create table public."budget_transactions" (
  "id" uuid default gen_random_uuid() not null,
  "date" date not null,
  "date_valeur" date,
  "description" text not null,
  "debit" numeric(12,2) default 0,
  "credit" numeric(12,2) default 0,
  "category_id" uuid,
  "category_name" text,
  "month" text,
  "year" integer,
  "source_file" text,
  "receipt_url" text,
  "payer" text,
  "sent_to_comptable" boolean default false,
  "sent_to_comptable_at" timestamp with time zone,
  "notes" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "is_manual" boolean default false,
  "is_personal" boolean default false,
  "note_comptable" text,
  "linked_invoice_id" uuid,
  "reconciled_at" timestamp with time zone,
  "linked_transaction_id" uuid,
  "is_private" boolean default false not null,
  "private_owner" text,
  constraint "budget_transactions_payer_check" CHECK ((payer = ANY (ARRAY['entreprise'::text, 'hicham_perso'::text, 'maxime_perso'::text]))),
  constraint "budget_transactions_private_owner_check" CHECK (((is_private = false) OR (private_owner IS NOT NULL))),
  constraint "budget_transactions_pkey" PRIMARY KEY (id)
);

create table public."call_arguments" (
  "id" uuid default gen_random_uuid() not null,
  "code" text not null,
  "title" text not null,
  "say_text" text not null,
  "detail" text,
  "legal_reference" text,
  "themes" text[] default '{}'::text[] not null,
  "valid_until" date,
  "sort_order" integer default 0 not null,
  "is_active" boolean default true not null,
  "updated_by" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "call_arguments_pkey" PRIMARY KEY (id),
  constraint "call_arguments_code_key" UNIQUE (code)
);

create table public."call_objections" (
  "id" uuid default gen_random_uuid() not null,
  "code" text not null,
  "category" text default 'autre'::text not null,
  "label" text not null,
  "answer" text not null,
  "followup_question" text,
  "themes" text[] default '{}'::text[] not null,
  "argument_codes" text[] default '{}'::text[] not null,
  "scenarios" text[] default '{}'::text[] not null,
  "usage_count" integer default 0 not null,
  "sort_order" integer default 0 not null,
  "is_active" boolean default true not null,
  "updated_by" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "call_objections_category_check" CHECK ((category = ANY (ARRAY['barrage'::text, 'accroche'::text, 'temps'::text, 'budget'::text, 'concurrence'::text, 'deja_couvert'::text, 'pas_concerne'::text, 'confiance'::text, 'client_existant'::text, 'autre'::text]))),
  constraint "call_objections_pkey" PRIMARY KEY (id),
  constraint "call_objections_code_key" UNIQUE (code)
);

create table public."client_contacts" (
  "id" uuid default gen_random_uuid() not null,
  "client_id" uuid not null,
  "name" text not null,
  "role" text,
  "email" text,
  "phone" text,
  "is_primary" boolean default false,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "civilite" character varying(10),
  "first_name" character varying(100),
  "last_name" character varying(100),
  "mobile" character varying(20),
  "fonction" character varying(100),
  "is_billing" boolean default false,
  "is_followup" boolean default false,
  "notes" text,
  "sellsy_contact_id" character varying(50),
  "is_document_contact" boolean default false,
  constraint "client_contacts_civilite_check" CHECK (((civilite)::text = ANY ((ARRAY['M'::character varying, 'Mme'::character varying, NULL::character varying])::text[]))),
  constraint "client_contacts_pkey" PRIMARY KEY (id)
);

create table public."client_interactions" (
  "id" uuid default uuid_generate_v4() not null,
  "client_id" uuid not null,
  "type" character varying(20) not null,
  "title" character varying(255),
  "content" text,
  "author" character varying(100),
  "interaction_date" timestamp with time zone default now(),
  "metadata" jsonb default '{}'::jsonb,
  "created_at" timestamp with time zone default now(),
  constraint "client_interactions_type_check" CHECK (((type)::text = ANY (ARRAY['call'::text, 'email'::text, 'sms'::text, 'meeting'::text, 'note'::text, 'devis'::text, 'facture'::text, 'relance'::text, 'rdv_phoning'::text, 'rappel_phoning'::text]))),
  constraint "client_interactions_pkey" PRIMARY KEY (id)
);

create table public."client_providers" (
  "id" uuid default gen_random_uuid() not null,
  "client_id" uuid not null,
  "theme" text not null,
  "provider_name" text,
  "last_training_year" integer,
  "satisfaction" text,
  "renewal_date" date,
  "notes" text,
  "created_by" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "client_providers_satisfaction_check" CHECK (((satisfaction IS NULL) OR (satisfaction = ANY (ARRAY['satisfait'::text, 'neutre'::text, 'insatisfait'::text])))),
  constraint "client_providers_theme_check" CHECK ((theme = ANY (ARRAY['sst'::text, 'incendie'::text, 'electrique'::text, 'conduite'::text, 'gestes_postures'::text, 'duerp'::text, 'autre'::text]))),
  constraint "client_providers_pkey" PRIMARY KEY (id)
);

create table public."clients" (
  "id" uuid default gen_random_uuid() not null,
  "name" character varying(255) not null,
  "address" text,
  "postal_code" character varying(10),
  "city" character varying(100),
  "siret" character varying(14),
  "contact_name" character varying(255),
  "contact_function" character varying(255),
  "contact_email" character varying(255),
  "contact_phone" character varying(20),
  "notes" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "siren" character varying(9),
  "mobile" character varying(20),
  "email" character varying(255),
  "website" character varying(500),
  "taille_entreprise" character varying(20),
  "proprietaire" character varying(50),
  "sellsy_id" character varying(50),
  "forme_juridique" character varying(200),
  "naf" character varying(10),
  "tva" character varying(20),
  "status" character varying default 'actif'::character varying not null,
  "type" text default 'prospect'::text,
  "opco_name" text,
  "client_type" text default 'entreprise'::text,
  "naf_code" character varying(10),
  "naf_label" text,
  "effectif" character varying(20),
  "billing_mode" text default 'per_session'::text,
  "default_payment_terms" text default 'à 30 jours'::text,
  "billing_email" text,
  "satisfaction_mode" text default 'after_session'::text,
  "group_name" text,
  "is_decisionnaire" boolean default false,
  "do_not_mail" boolean default false,
  constraint "clients_billing_mode_check" CHECK ((billing_mode = ANY (ARRAY['per_session'::text, 'monthly'::text]))),
  constraint "clients_client_type_check" CHECK ((client_type = ANY (ARRAY['entreprise'::text, 'organisme_formation'::text, 'public'::text, 'opco'::text]))),
  constraint "clients_status_check" CHECK (((status)::text = ANY ((ARRAY['prospect'::character varying, 'en_discussion'::character varying, 'actif'::character varying, 'a_completer'::character varying, 'archive'::character varying, 'inactif'::character varying])::text[]))),
  constraint "clients_pkey" PRIMARY KEY (id),
  constraint "clients_sellsy_id_key" UNIQUE (sellsy_id)
);

create table public."completude_alerts" (
  "id" uuid default uuid_generate_v4() not null,
  "category" character varying(50) not null,
  "element" character varying(255) not null,
  "detail" text not null,
  "priority" character varying(20) not null,
  "entity_id" uuid,
  "link" character varying(255),
  "first_detected_at" timestamp with time zone default now(),
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone default now(),
  constraint "completude_alerts_pkey" PRIMARY KEY (id)
);

create table public."completude_tracking" (
  "id" integer default 1 not null,
  "last_blocker_count" integer default 0,
  "last_check_at" timestamp with time zone default now(),
  constraint "single_row" CHECK ((id = 1)),
  constraint "completude_tracking_pkey" PRIMARY KEY (id)
);

create table public."course_document_downloads" (
  "id" uuid default uuid_generate_v4() not null,
  "document_id" uuid not null,
  "trainee_id" uuid not null,
  "session_id" uuid not null,
  "downloaded_at" timestamp with time zone default now(),
  constraint "course_document_downloads_pkey" PRIMARY KEY (id)
);
comment on table public."course_document_downloads" is 'Traçabilité des téléchargements de documents par les stagiaires';

create table public."course_documents" (
  "id" uuid default uuid_generate_v4() not null,
  "course_id" uuid not null,
  "type" text not null,
  "title" text not null,
  "file_url" text not null,
  "file_name" text not null,
  "file_size" integer,
  "created_by" uuid,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  constraint "course_documents_type_check" CHECK ((type = ANY (ARRAY['support_formateur'::text, 'document_stagiaire'::text, 'programme'::text]))),
  constraint "course_documents_pkey" PRIMARY KEY (id),
  constraint "course_documents_course_id_type_key" UNIQUE (course_id, type)
);
comment on table public."course_documents" is 'Documents pédagogiques par formation (support formateur, document stagiaire, programme)';

create table public."course_equipment" (
  "id" uuid default gen_random_uuid() not null,
  "course_id" uuid,
  "equipment_id" uuid,
  "notes" text,
  "created_at" timestamp with time zone default now(),
  constraint "course_equipment_pkey" PRIMARY KEY (id),
  constraint "course_equipment_course_id_equipment_id_key" UNIQUE (course_id, equipment_id),
  constraint "course_equipment_unique" UNIQUE (course_id, equipment_id)
);

create table public."course_questions" (
  "id" uuid default gen_random_uuid() not null,
  "course_id" uuid not null,
  "question_text" text not null,
  "question_type" character varying(20) default 'qcm'::character varying not null,
  "option_a" text,
  "option_b" text,
  "option_c" text,
  "position" integer default 0,
  "created_at" timestamp with time zone default now(),
  constraint "course_questions_pkey" PRIMARY KEY (id)
);

create table public."courses" (
  "id" uuid default gen_random_uuid() not null,
  "title" character varying(255) not null,
  "code" character varying(50),
  "description" text,
  "objectives" text,
  "duration_days" integer default 1,
  "duration_hours" numeric(5,1) default 7,
  "price_ht" numeric(10,2),
  "prerequisites" text,
  "target_audience" text,
  "teaching_methods" text,
  "evaluation_methods" text,
  "materials" text,
  "positioning_questions" jsonb default '[]'::jsonb,
  "qualiopi_indicators" integer[] default ARRAY[5, 6, 8],
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "default_trainer_id" uuid,
  "pedagogical_methods" text,
  "material" text,
  "methods" text,
  "content" text,
  "program" text,
  "duration" integer,
  "price_per_day" numeric(10,2),
  "theme_id" uuid,
  "sellsy_id" text,
  "reference" text,
  "trainer_equipment" text,
  "program_url" text,
  constraint "courses_pkey" PRIMARY KEY (id)
);

create table public."dashboard_widget_configs" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid,
  "widget_id" text not null,
  "position" integer default 0,
  "size" text default 'md'::text,
  "visible" boolean default true,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  constraint "dashboard_widget_configs_size_check" CHECK ((size = ANY (ARRAY['sm'::text, 'md'::text, 'lg'::text, 'xl'::text]))),
  constraint "dashboard_widget_configs_pkey" PRIMARY KEY (id),
  constraint "dashboard_widget_configs_user_id_widget_id_key" UNIQUE (user_id, widget_id)
);

create table public."document_signatures" (
  "id" uuid default gen_random_uuid() not null,
  "document_type" text not null,
  "session_id" uuid,
  "trainee_id" uuid,
  "client_id" uuid,
  "signer_type" text default 'trainee'::text not null,
  "signer_name" text not null,
  "signer_email" text,
  "signer_role" text,
  "signature_data" text not null,
  "document_hash" text,
  "ip_address" text,
  "user_agent" text,
  "signed_at" timestamp with time zone default now() not null,
  "metadata" jsonb default '{}'::jsonb,
  "status" text default 'valid'::text not null,
  "revoked_at" timestamp with time zone,
  "revoked_reason" text,
  "created_at" timestamp with time zone default now(),
  constraint "document_signatures_status_check" CHECK ((status = ANY (ARRAY['valid'::text, 'revoked'::text]))),
  constraint "document_signatures_pkey" PRIMARY KEY (id)
);

create table public."documents" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "filename" text,
  "file_url" text,
  "file_size" integer,
  "mime_type" text,
  "category" text default 'other'::text,
  "session_id" uuid,
  "course_id" uuid,
  "client_id" uuid,
  "notes" text,
  "created_at" timestamp with time zone default now(),
  constraint "documents_pkey" PRIMARY KEY (id)
);

create table public."duerp_actions" (
  "id" uuid default uuid_generate_v4() not null,
  "project_id" uuid not null,
  "risk_id" uuid,
  "action" text not null,
  "priorite" character varying(20) default 'moyenne'::character varying,
  "type_action" character varying(30) default 'prevention'::character varying,
  "responsable" character varying(255),
  "echeance" date,
  "cout_estime" character varying(100),
  "date_realisation" date,
  "statut" character varying(20) default 'a_faire'::character varying,
  "course_id" uuid,
  "notes" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  constraint "duerp_actions_priorite_check" CHECK (((priorite)::text = ANY ((ARRAY['critique'::character varying, 'haute'::character varying, 'moyenne'::character varying, 'basse'::character varying])::text[]))),
  constraint "duerp_actions_statut_check" CHECK (((statut)::text = ANY ((ARRAY['a_faire'::character varying, 'en_cours'::character varying, 'fait'::character varying, 'annule'::character varying])::text[]))),
  constraint "duerp_actions_type_action_check" CHECK (((type_action)::text = ANY ((ARRAY['prevention'::character varying, 'protection'::character varying, 'formation'::character varying, 'organisationnelle'::character varying, 'technique'::character varying])::text[]))),
  constraint "duerp_actions_pkey" PRIMARY KEY (id)
);

create table public."duerp_equipements" (
  "id" uuid default gen_random_uuid() not null,
  "project_id" uuid not null,
  "unit_id" uuid,
  "type_id" text not null,
  "label" text,
  "category" text default 'incendie'::text,
  "emplacement" text,
  "marque" text,
  "modele" text,
  "numero_serie" text,
  "capacite" text,
  "install_date" date,
  "expiry_date" date,
  "last_check_date" date,
  "next_check_date" date,
  "last_check_by" text,
  "status" text default 'conforme'::text,
  "notes" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  constraint "duerp_equipements_status_check" CHECK ((status = ANY (ARRAY['conforme'::text, 'a_verifier'::text, 'non_conforme'::text, 'perime'::text, 'manquant'::text]))),
  constraint "duerp_equipements_pkey" PRIMARY KEY (id)
);

create table public."duerp_formations_reglementaires" (
  "id" uuid default uuid_generate_v4() not null,
  "category_code" character varying(30),
  "formation_label" character varying(255) not null,
  "reglementation" text,
  "periodicite" character varying(100),
  "course_code" character varying(50),
  "sort_order" integer default 0,
  constraint "duerp_formations_reglementaires_pkey" PRIMARY KEY (id)
);

create table public."duerp_habilitations" (
  "id" uuid default gen_random_uuid() not null,
  "project_id" uuid not null,
  "person_name" text not null,
  "person_function" text,
  "type_id" text not null,
  "label" text,
  "obtained_date" date,
  "expiry_date" date,
  "organisme" text,
  "certificate_ref" text,
  "niveau" text,
  "notes" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  constraint "duerp_habilitations_pkey" PRIMARY KEY (id)
);

create table public."duerp_projects" (
  "id" uuid default uuid_generate_v4() not null,
  "client_id" uuid,
  "company_name" character varying(255) not null,
  "siret" character varying(14),
  "naf_code" character varying(10),
  "naf_label" text,
  "address" text,
  "city" character varying(100),
  "postal_code" character varying(10),
  "effectif" character varying(50),
  "contact_name" character varying(255),
  "contact_function" character varying(100),
  "sector_template" character varying(255),
  "reference" character varying(100),
  "version" integer default 1,
  "status" character varying(20) default 'brouillon'::character varying,
  "date_elaboration" date,
  "date_visite" date,
  "date_finalisation" date,
  "date_prochaine_maj" date,
  "participants" jsonb default '[]'::jsonb,
  "evaluateur" character varying(255),
  "notes" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "created_by" uuid,
  constraint "duerp_projects_status_check" CHECK (((status)::text = ANY ((ARRAY['brouillon'::character varying, 'en_cours'::character varying, 'visite_terrain'::character varying, 'finalisation'::character varying, 'termine'::character varying, 'archive'::character varying])::text[]))),
  constraint "duerp_projects_pkey" PRIMARY KEY (id)
);

create table public."duerp_risk_categories" (
  "id" uuid default uuid_generate_v4() not null,
  "code" character varying(30) not null,
  "label" character varying(100) not null,
  "icon" character varying(10) default '⚠️'::character varying,
  "color" character varying(20) default 'gray'::character varying,
  "sort_order" integer default 0,
  constraint "duerp_risk_categories_pkey" PRIMARY KEY (id),
  constraint "duerp_risk_categories_code_key" UNIQUE (code)
);

create table public."duerp_risk_templates" (
  "id" uuid default uuid_generate_v4() not null,
  "category_code" character varying(30),
  "label" text not null,
  "situations" text,
  "consequences" text,
  "prevention_suggestions" text,
  "reglementation" text,
  "source_inrs" text,
  "sort_order" integer default 0,
  "created_at" timestamp with time zone default now(),
  constraint "duerp_risk_templates_pkey" PRIMARY KEY (id)
);

create table public."duerp_risks" (
  "id" uuid default uuid_generate_v4() not null,
  "project_id" uuid not null,
  "unit_id" uuid,
  "template_id" uuid,
  "category_code" character varying(30),
  "danger" text not null,
  "situation" text,
  "consequences" text,
  "description_travail" text,
  "frequence" integer,
  "gravite" integer,
  "risque_brut" integer generated always as ((COALESCE(frequence, 1) * COALESCE(gravite, 1))) stored,
  "prevention_existante" text,
  "maitrise" numeric(3,2) default 1,
  "risque_residuel" numeric(5,2) generated always as ((((COALESCE(frequence, 1) * COALESCE(gravite, 1)))::numeric * COALESCE(maitrise, (1)::numeric))) stored,
  "photos" jsonb default '[]'::jsonb,
  "notes" text,
  "sort_order" integer default 0,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  constraint "duerp_risks_frequence_check" CHECK (((frequence >= 1) AND (frequence <= 4))),
  constraint "duerp_risks_gravite_check" CHECK (((gravite >= 1) AND (gravite <= 4))),
  constraint "duerp_risks_maitrise_check" CHECK ((maitrise = ANY (ARRAY[0.5, 0.75, (1)::numeric]))),
  constraint "duerp_risks_pkey" PRIMARY KEY (id)
);

create table public."duerp_sector_templates" (
  "id" uuid default uuid_generate_v4() not null,
  "sector_code" character varying(30) not null,
  "sector_label" character varying(150) not null,
  "naf_prefix" character varying(5),
  "default_units" jsonb default '[]'::jsonb not null,
  "default_risk_codes" text[] default '{}'::text[] not null,
  "description" text,
  "created_at" timestamp with time zone default now(),
  constraint "duerp_sector_templates_pkey" PRIMARY KEY (id)
);

create table public."duerp_units" (
  "id" uuid default uuid_generate_v4() not null,
  "project_id" uuid not null,
  "code" character varying(50),
  "name" character varying(255) not null,
  "description" text,
  "effectif" integer,
  "metiers" text,
  "sort_order" integer default 0,
  "created_at" timestamp with time zone default now(),
  "surface_m2" integer,
  constraint "duerp_units_pkey" PRIMARY KEY (id)
);

create table public."duerp_verifications" (
  "id" uuid default gen_random_uuid() not null,
  "project_id" uuid not null,
  "type" text not null,
  "label" text,
  "date_realisation" date not null,
  "realise_par" text,
  "organisme" text,
  "nb_participants" integer,
  "observations" text,
  "conforme" boolean default true,
  "prochain_prevu" date,
  "created_at" timestamp with time zone default now(),
  constraint "duerp_verifications_pkey" PRIMARY KEY (id)
);

create table public."email_sync_cursors" (
  "id" uuid default gen_random_uuid() not null,
  "email" text not null,
  "last_uid" integer default 0,
  "last_synced_at" timestamp with time zone,
  "folder" text default 'Sent'::text,
  "created_at" timestamp with time zone default now(),
  constraint "email_sync_cursors_pkey" PRIMARY KEY (id),
  constraint "email_sync_cursors_email_key" UNIQUE (email)
);

create table public."equipment_catalog" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "theme" text not null,
  "ratio_per_persons" integer,
  "is_consumable" boolean default false,
  "is_custom" boolean default false,
  "created_at" timestamp with time zone default now(),
  "quantity" integer default 0 not null,
  "condition" text default 'bon'::text not null,
  "location" text,
  "last_check_date" date,
  "next_check_date" date,
  "check_notes" text,
  constraint "equipment_catalog_pkey" PRIMARY KEY (id),
  constraint "equipment_catalog_name_theme_unique" UNIQUE (name, theme)
);

create table public."evaluations_cold" (
  "id" uuid default gen_random_uuid() not null,
  "session_id" uuid not null,
  "trainee_id" uuid not null,
  "skills_applied" integer,
  "knowledge_retained" integer,
  "job_impact" integer,
  "objectives_met" integer,
  "would_recommend" boolean,
  "concrete_examples" text,
  "obstacles" text,
  "additional_needs" text,
  "comments" text,
  "sent_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone default now(),
  "needs_met" boolean,
  constraint "evaluations_cold_pkey" PRIMARY KEY (id),
  constraint "evaluations_cold_session_id_trainee_id_key" UNIQUE (session_id, trainee_id),
  constraint "evaluations_cold_session_trainee_unique" UNIQUE (session_id, trainee_id)
);

create table public."import_logs" (
  "id" uuid default gen_random_uuid() not null,
  "file_name" text,
  "target_table" text not null,
  "naf_code_applied" text,
  "total_rows" integer default 0,
  "inserted" integer default 0,
  "updated" integer default 0,
  "skipped" integer default 0,
  "errors" integer default 0,
  "created_by" text,
  "created_at" timestamp with time zone default now(),
  constraint "import_logs_pkey" PRIMARY KEY (id)
);

create table public."invoice_emails_sent" (
  "id" uuid default gen_random_uuid() not null,
  "sent_by" character varying(255) not null,
  "to_email" character varying(255) not null,
  "cc_email" character varying(255),
  "subject" text,
  "month_label" character varying(20),
  "nb_invoices" integer default 0,
  "nb_overdue" integer default 0,
  "total_ht" numeric default 0,
  "total_tva" numeric default 0,
  "total_ttc" numeric default 0,
  "invoice_ids" uuid[] default '{}'::uuid[],
  "notes" text,
  "message_id" text,
  "status" character varying(20) default 'sent'::character varying,
  "sent_at" timestamp with time zone default now(),
  "created_at" timestamp with time zone default now(),
  constraint "invoice_emails_sent_pkey" PRIMARY KEY (id)
);

create table public."invoice_items" (
  "id" uuid default gen_random_uuid() not null,
  "invoice_id" uuid not null,
  "position" integer default 0,
  "code" character varying,
  "description_title" text,
  "description_detail" text,
  "quantity" numeric default 1,
  "unit" character varying default 'unité'::character varying,
  "unit_price_ht" numeric default 0 not null,
  "tva_rate" numeric default 20.00,
  "total_ht" numeric default 0,
  "course_id" uuid,
  "created_at" timestamp with time zone default now(),
  constraint "invoice_items_pkey" PRIMARY KEY (id)
);

create table public."invoice_payments" (
  "id" uuid default gen_random_uuid() not null,
  "invoice_id" uuid not null,
  "amount" numeric not null,
  "payment_date" date default CURRENT_DATE not null,
  "payment_method" character varying default 'virement bancaire'::character varying,
  "payment_reference" character varying,
  "notes" text,
  "created_by" character varying default 'Hicham Saidi'::character varying,
  "created_at" timestamp with time zone default now(),
  constraint "invoice_payments_pkey" PRIMARY KEY (id)
);

create table public."invoice_relances" (
  "id" uuid default gen_random_uuid() not null,
  "invoice_id" uuid not null,
  "relance_number" integer default 1 not null,
  "to_email" text not null,
  "from_email" text not null,
  "sent_by" text not null,
  "subject" text,
  "body_preview" text,
  "status" text default 'sent'::text,
  "sent_at" timestamp with time zone default now(),
  "created_at" timestamp with time zone default now(),
  constraint "invoice_relances_pkey" PRIMARY KEY (id)
);

create table public."invoice_sessions" (
  "invoice_id" uuid not null,
  "session_id" uuid not null,
  "created_at" timestamp with time zone default now() not null,
  constraint "invoice_sessions_pkey" PRIMARY KEY (invoice_id, session_id)
);

create table public."invoices" (
  "id" uuid default gen_random_uuid() not null,
  "reference" character varying not null,
  "type" character varying default 'invoice'::character varying not null,
  "client_id" uuid,
  "contact_id" uuid,
  "quote_id" uuid,
  "session_id" uuid,
  "parent_invoice_id" uuid,
  "sellsy_reference" character varying,
  "client_reference" character varying,
  "invoice_date" date default CURRENT_DATE not null,
  "service_start_date" date,
  "service_end_date" date,
  "due_date" date,
  "object" text,
  "payment_method" character varying default 'virement bancaire'::character varying,
  "payment_terms" character varying default 'à 30 jours'::character varying,
  "discount_percent" numeric default 0,
  "discount_label" text,
  "tva_applicable" boolean default true,
  "total_ht" numeric default 0,
  "total_discount" numeric default 0,
  "total_net_ht" numeric default 0,
  "total_tva" numeric default 0,
  "total_ttc" numeric default 0,
  "amount_paid" numeric default 0,
  "amount_due" numeric default 0,
  "status" character varying default 'draft'::character varying,
  "notes" text,
  "created_by" character varying default 'Hicham Saidi'::character varying,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "is_formation_pro" boolean default true,
  "billing_client_id" uuid,
  "is_subrogation" boolean default false,
  "sent_to_comptable" boolean default false,
  "sent_to_comptable_at" timestamp with time zone,
  "amount_credited" numeric default 0 not null,
  constraint "invoices_status_check" CHECK (((status)::text = ANY (ARRAY['draft'::text, 'sent'::text, 'due'::text, 'overdue'::text, 'partial'::text, 'paid'::text, 'cancelled'::text, 'credited'::text]))),
  constraint "invoices_type_check" CHECK (((type)::text = ANY ((ARRAY['invoice'::character varying, 'credit_note'::character varying])::text[]))),
  constraint "invoices_pkey" PRIMARY KEY (id),
  constraint "invoices_reference_key" UNIQUE (reference)
);

create table public."mailing_blocklist" (
  "id" uuid default gen_random_uuid() not null,
  "kind" text not null,
  "value" text not null,
  "category" text not null,
  "note" text,
  "created_by" text,
  "created_at" timestamp with time zone default now() not null,
  constraint "mailing_blocklist_category_check" CHECK ((category = ANY (ARRAY['desabonne'::text, 'concurrent'::text, 'manuel'::text]))),
  constraint "mailing_blocklist_kind_check" CHECK ((kind = ANY (ARRAY['email'::text, 'domaine'::text, 'nom'::text]))),
  constraint "mailing_blocklist_pkey" PRIMARY KEY (id),
  constraint "mailing_blocklist_kind_value_key" UNIQUE (kind, value)
);

create table public."mailing_campaigns" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "subject" text not null,
  "body_html" text not null,
  "signature_caller" text default 'Marine'::text not null,
  "sender_email" text not null,
  "target_source" text default 'both'::text not null,
  "filters" jsonb default '{}'::jsonb,
  "status" text default 'brouillon'::text not null,
  "total_recipients" integer default 0,
  "sent_count" integer default 0,
  "error_count" integer default 0,
  "test_sent_at" timestamp with time zone,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_by" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "phoning_message" text,
  "phoning_notes" jsonb default '[]'::jsonb,
  "phoning_active" boolean default false,
  "phoning_active_until" timestamp with time zone,
  "send_mode" text default 'navigateur'::text not null,
  "scheduled_at" timestamp with time zone,
  "cadence_seconds" integer default 180 not null,
  "next_send_at" timestamp with time zone,
  "attachment" jsonb,
  "paused_at" timestamp with time zone,
  "last_error" text,
  "source_campaign_id" uuid,
  "report_requested_at" timestamp with time zone,
  constraint "mailing_campaigns_pkey" PRIMARY KEY (id)
);

create table public."mailing_email_status" (
  "email" text not null,
  "status" text default 'ok'::text not null,
  "flags" text[] default '{}'::text[] not null,
  "suggestion" text,
  "is_protected" boolean default false not null,
  "manual" boolean default false not null,
  "note" text,
  "decided_by" text,
  "decided_at" timestamp with time zone,
  "analysed_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "mailing_email_status_status_check" CHECK ((status = ANY (ARRAY['ok'::text, 'a_verifier'::text, 'invalide'::text]))),
  constraint "mailing_email_status_pkey" PRIMARY KEY (email)
);

create table public."mailing_reply_cursors" (
  "email" text not null,
  "last_uid" bigint default 0 not null,
  "uid_validity" bigint,
  "last_synced_at" timestamp with time zone,
  "last_error" text,
  constraint "mailing_reply_cursors_pkey" PRIMARY KEY (email)
);

create table public."mailing_segments" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "filters" jsonb default '{}'::jsonb not null,
  "created_by" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "mailing_segments_pkey" PRIMARY KEY (id)
);

create table public."mailing_sends" (
  "id" uuid default gen_random_uuid() not null,
  "campaign_id" uuid not null,
  "source" text not null,
  "source_id" uuid,
  "email" text not null,
  "company_name" text,
  "unsubscribe_token" uuid default gen_random_uuid(),
  "unsubscribed_at" timestamp with time zone,
  "status" text default 'pending'::text not null,
  "sent_at" timestamp with time zone,
  "error_message" text,
  "created_at" timestamp with time zone default now(),
  "message_id" text,
  "replied_at" timestamp with time zone,
  "claimed_at" timestamp with time zone,
  "vars" jsonb default '{}'::jsonb not null,
  constraint "mailing_sends_pkey" PRIMARY KEY (id)
);

create table public."mailing_templates" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "subject" text default ''::text not null,
  "body_html" text default ''::text not null,
  "signature_caller" text default 'Hicham'::text not null,
  "created_by" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "mailing_templates_pkey" PRIMARY KEY (id)
);

create table public."non_conformites" (
  "id" uuid default uuid_generate_v4() not null,
  "source" character varying(30) not null,
  "source_id" uuid,
  "session_id" uuid,
  "title" character varying(255) not null,
  "description" text not null,
  "critere_qualiopi" character varying(50),
  "severity" character varying(20) default 'minor'::character varying,
  "status" character varying(20) default 'open'::character varying,
  "cause_analysis" text,
  "corrective_action" text,
  "action_responsible" character varying(255),
  "action_deadline" date,
  "action_completed_at" timestamp with time zone,
  "preventive_action" text,
  "effectiveness_check" text,
  "effectiveness_verified_at" timestamp with time zone,
  "effectiveness_verified_by" character varying(255),
  "attachments" jsonb default '[]'::jsonb,
  "created_by" character varying(255),
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "closed_at" timestamp with time zone,
  "reclamation_origine" text,
  "date_detection" date,
  "date_cloture" date,
  "efficacite_verifiee" boolean default false,
  "efficacite_commentaire" text,
  "cout_estime" numeric(10,2),
  constraint "non_conformites_severity_check" CHECK (((severity)::text = ANY ((ARRAY['minor'::character varying, 'major'::character varying, 'critical'::character varying])::text[]))),
  constraint "non_conformites_source_check" CHECK (((source)::text = ANY ((ARRAY['evaluation'::character varying, 'audit'::character varying, 'reclamation'::character varying, 'interne'::character varying, 'autre'::character varying])::text[]))),
  constraint "non_conformites_status_check" CHECK (((status)::text = ANY ((ARRAY['open'::character varying, 'in_progress'::character varying, 'resolved'::character varying, 'closed'::character varying])::text[]))),
  constraint "non_conformites_pkey" PRIMARY KEY (id)
);

create table public."non_conformities" (
  "id" uuid default gen_random_uuid() not null,
  "reference" character varying(20) not null,
  "session_id" uuid,
  "title" character varying(255) not null,
  "description" text,
  "source" character varying(100),
  "severity" character varying(50) default 'minor'::character varying,
  "status" character varying(50) default 'open'::character varying,
  "root_cause" text,
  "corrective_action" text,
  "preventive_action" text,
  "responsible" character varying(255),
  "due_date" date,
  "closed_at" timestamp with time zone,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  constraint "non_conformities_pkey" PRIMARY KEY (id),
  constraint "non_conformities_reference_key" UNIQUE (reference)
);

create table public."notifications" (
  "id" uuid default uuid_generate_v4() not null,
  "type" character varying(50) not null,
  "title" character varying(255) not null,
  "message" text,
  "link" character varying(255),
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone default now(),
  "metadata" jsonb default '{}'::jsonb,
  constraint "notifications_pkey" PRIMARY KEY (id)
);

create table public."org_settings" (
  "id" uuid default uuid_generate_v4() not null,
  "name" character varying(255) default 'Access Formation'::character varying,
  "siret" character varying(14),
  "nda" character varying(20),
  "address" text,
  "city" character varying(100),
  "postal_code" character varying(10),
  "phone" character varying(20),
  "email" character varying(255),
  "website" character varying(255),
  "logo_url" character varying(500),
  "dirigeant_name" character varying(255),
  "updated_at" timestamp with time zone default now(),
  "comptable_email" text,
  "comptable_name" text default 'Comptable'::text,
  "comptable_cabinet" text,
  "comptable_cc" text,
  "comptable_bcc" text,
  constraint "org_settings_pkey" PRIMARY KEY (id)
);

create table public."organization_settings" (
  "id" uuid default gen_random_uuid() not null,
  "name" character varying(255) default 'Access Formation'::character varying not null,
  "address" text,
  "postal_code" character varying(10),
  "city" character varying(100),
  "phone" character varying(20),
  "email" character varying(255),
  "website" character varying(255),
  "siret" character varying(14),
  "nda" character varying(50),
  "logo_url" text,
  "logo_base64" text,
  "primary_color" character varying(7) default '#2563eb'::character varying,
  "reglement_interieur" text,
  "reglement_version" character varying(10) default 'V1.0'::character varying,
  "reglement_updated_at" timestamp with time zone,
  "livret_accueil" text,
  "livret_version" character varying(10) default 'V1.0'::character varying,
  "livret_updated_at" timestamp with time zone,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "stamp_base64" text,
  "referent_handicap_nom" character varying(255),
  "referent_handicap_email" character varying(255),
  "referent_handicap_phone" character varying(50),
  "dirigeant_name" text,
  "dirigeant_signature_url" text,
  constraint "organization_settings_pkey" PRIMARY KEY (id)
);

create table public."phoning_sessions" (
  "id" uuid default gen_random_uuid() not null,
  "caller" text not null,
  "title" text,
  "started_at" timestamp with time zone default now() not null,
  "ended_at" timestamp with time zone,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "phoning_sessions_pkey" PRIMARY KEY (id)
);

create table public."positioning_questions_ref" (
  "id" uuid default gen_random_uuid() not null,
  "positioning_theme_id" text not null,
  "qid" text not null,
  "question_type" text default 'single_choice'::text not null,
  "question_text" text not null,
  "options" jsonb default '[]'::jsonb,
  "correct_index" integer,
  "score" integer default 1,
  "critical" boolean default false,
  "scoring_rubric" text,
  "position" integer default 0,
  constraint "positioning_questions_ref_pkey" PRIMARY KEY (id),
  constraint "positioning_questions_ref_positioning_theme_id_qid_key" UNIQUE (positioning_theme_id, qid)
);

create table public."positioning_results" (
  "id" uuid default gen_random_uuid() not null,
  "session_id" uuid,
  "trainee_id" uuid,
  "answers" jsonb not null,
  "score" integer,
  "level" character varying(50),
  "submitted_at" timestamp with time zone default now(),
  constraint "positioning_results_pkey" PRIMARY KEY (id),
  constraint "positioning_results_session_id_trainee_id_key" UNIQUE (session_id, trainee_id)
);

create table public."positioning_themes" (
  "id" uuid default gen_random_uuid() not null,
  "theme_id" text not null,
  "theme_name" text not null,
  "category" text,
  "references_text" text,
  "created_at" timestamp with time zone default now(),
  constraint "positioning_themes_pkey" PRIMARY KEY (id),
  constraint "positioning_themes_theme_id_key" UNIQUE (theme_id)
);

create table public."process_categories" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "color" text default '#3B82F6'::text not null,
  "created_at" timestamp with time zone default now(),
  constraint "process_categories_pkey" PRIMARY KEY (id)
);

create table public."process_connections" (
  "id" uuid default gen_random_uuid() not null,
  "process_id" uuid,
  "from_step_id" uuid,
  "to_step_id" uuid,
  "label" text,
  "created_at" timestamp with time zone default now(),
  constraint "process_connections_pkey" PRIMARY KEY (id)
);

create table public."process_responsibles" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "created_at" timestamp with time zone default now(),
  constraint "process_responsibles_pkey" PRIMARY KEY (id),
  constraint "process_responsibles_name_unique" UNIQUE (name)
);

create table public."process_steps" (
  "id" uuid default gen_random_uuid() not null,
  "process_id" uuid,
  "type" text not null,
  "title" text not null,
  "description" text,
  "responsible_id" uuid,
  "document_id" uuid,
  "delay" text,
  "tool" text,
  "category_id" uuid,
  "linked_process_id" uuid,
  "position_x" double precision default 100,
  "position_y" double precision default 100,
  "created_at" timestamp with time zone default now(),
  constraint "process_steps_type_check" CHECK ((type = ANY (ARRAY['start'::text, 'end'::text, 'action'::text, 'decision'::text, 'document'::text, 'subprocess'::text]))),
  constraint "process_steps_pkey" PRIMARY KEY (id)
);

create table public."process_versions" (
  "id" uuid default gen_random_uuid() not null,
  "process_id" uuid,
  "version" integer not null,
  "data" jsonb not null,
  "created_at" timestamp with time zone default now(),
  "created_by" text,
  constraint "process_versions_pkey" PRIMARY KEY (id)
);

create table public."processes" (
  "id" uuid default gen_random_uuid() not null,
  "code" text not null,
  "title" text not null,
  "description" text,
  "version" integer default 1,
  "status" text default 'active'::text,
  "category_id" uuid,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "created_by" text,
  "updated_by" text,
  constraint "processes_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text]))),
  constraint "processes_pkey" PRIMARY KEY (id),
  constraint "processes_code_key" UNIQUE (code)
);

create table public."programme_versions" (
  "id" uuid default gen_random_uuid() not null,
  "ref_doc" text not null,
  "nom_programme" text not null,
  "version" text not null,
  "date_maj" date not null,
  "valide_par" text not null,
  "raison_changement" text not null,
  "created_at" timestamp with time zone default now(),
  constraint "programme_versions_pkey" PRIMARY KEY (id)
);

create table public."prospect_calls" (
  "id" uuid default gen_random_uuid() not null,
  "client_id" uuid not null,
  "called_at" timestamp with time zone default now(),
  "duration_seconds" integer,
  "called_by" character varying(50) default 'Marine'::character varying,
  "call_number" integer default 1,
  "previous_call_id" uuid,
  "contact_name" character varying(200),
  "contact_function" character varying(100),
  "contact_email" character varying(255),
  "contact_mobile" character varying(20),
  "call_result" character varying(20),
  "barrage_type" character varying(50),
  "formations_mentioned" text[],
  "notes" text,
  "rdv_created" boolean default false,
  "rdv_id" uuid,
  "email_sent" boolean default false,
  "email_type" character varying(50),
  "needs_callback" boolean default false,
  "callback_date" date,
  "callback_time" time without time zone,
  "callback_reason" text,
  "lead_score" integer,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "scenario_code" text,
  "objection_codes" text[],
  "phoning_session_id" uuid,
  "outcome_detail" text,
  "attempt_number" integer,
  "is_planned" boolean default false not null,
  constraint "prospect_calls_lead_score_check" CHECK (((lead_score >= 0) AND (lead_score <= 100))),
  constraint "prospect_calls_pkey" PRIMARY KEY (id)
);
comment on table public."prospect_calls" is 'Historique des appels téléphoniques de prospection';

create table public."prospect_email_logs" (
  "id" uuid default gen_random_uuid() not null,
  "prospect_siren" character varying,
  "client_id" uuid,
  "prospect_name" character varying,
  "to_email" character varying not null,
  "from_email" character varying not null,
  "subject" character varying not null,
  "template_type" character varying default 'suite_echange'::character varying,
  "body_preview" text,
  "sent_by" character varying not null,
  "sent_at" timestamp with time zone default now(),
  "status" character varying default 'sent'::character varying,
  "error_message" text,
  "source" text default 'campus'::text,
  "message_id" text,
  constraint "prospect_email_logs_pkey" PRIMARY KEY (id)
);

create table public."prospect_needs_analysis" (
  "id" uuid default gen_random_uuid() not null,
  "client_id" uuid not null,
  "rdv_id" uuid,
  "analysis_date" date,
  "context_reasons" text[],
  "context_other" text,
  "context_stakes" text,
  "objectives_description" text,
  "objectives_measurable" text,
  "participants_count" integer,
  "participants_profiles" text[],
  "prerequisites_validated" boolean,
  "level" character varying(20),
  "particularities_psh" text,
  "particularities_non_french" boolean default false,
  "particularities_other" text,
  "location_type" character varying(20),
  "location_client_address" text,
  "preferred_schedule" character varying(100),
  "preferred_dates" character varying(100),
  "company_equipment" boolean,
  "company_equipment_details" text,
  "ppe_provided" boolean,
  "other_constraints" text,
  "signature_trainer" text,
  "signature_client" text,
  "signed_at" timestamp with time zone,
  "filled_by" uuid,
  "filled_at" timestamp with time zone,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  constraint "prospect_needs_analysis_level_check" CHECK (((level)::text = ANY ((ARRAY['debutant'::character varying, 'intermediaire'::character varying, 'avance'::character varying, NULL::character varying])::text[]))),
  constraint "prospect_needs_analysis_location_type_check" CHECK (((location_type)::text = ANY ((ARRAY['client'::character varying, 'organisme'::character varying, NULL::character varying])::text[]))),
  constraint "prospect_needs_analysis_pkey" PRIMARY KEY (id),
  constraint "prospect_needs_analysis_client_id_key" UNIQUE (client_id)
);
comment on table public."prospect_needs_analysis" is 'Analyse des besoins en phase prospection (avant création de session)';

create table public."prospect_rdv" (
  "id" uuid default gen_random_uuid() not null,
  "client_id" uuid not null,
  "rdv_date" date,
  "rdv_time" time without time zone,
  "rdv_type" character varying(20),
  "rdv_location" character varying(20),
  "rdv_address" text,
  "contact_id" uuid,
  "contact_name" character varying(200),
  "contact_email" character varying(255),
  "contact_phone" character varying(20),
  "conducted_by" character varying(50),
  "status" character varying(20) default 'prevu'::character varying,
  "notes" text,
  "next_action" text,
  "next_action_date" date,
  "session_id" uuid,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "temperature" character varying(20),
  "source" character varying(50),
  "budget_estime" character varying(100),
  "formations_interet" text[],
  "concurrence" text,
  "timeline" character varying(20),
  "is_urgent" boolean default false,
  "notes_crm" text,
  "outcome" text,
  "outcome_reason" text,
  "outcome_at" timestamp with time zone,
  "outcome_by" text,
  "quote_id" uuid,
  "prep_data" jsonb default '{}'::jsonb not null,
  "prep_done_at" timestamp with time zone,
  "triaged_at" timestamp with time zone,
  constraint "prospect_rdv_conducted_by_check" CHECK (((conducted_by)::text = ANY ((ARRAY['Hicham'::character varying, 'Maxime'::character varying, NULL::character varying])::text[]))),
  constraint "prospect_rdv_outcome_check" CHECK (((outcome IS NULL) OR (outcome = ANY (ARRAY['devis_a_faire'::text, 'devis_envoye'::text, 'a_recontacter'::text, 'sans_suite'::text, 'converti_rappel'::text])))),
  constraint "prospect_rdv_rdv_location_check" CHECK (((rdv_location)::text = ANY ((ARRAY['leurs_locaux'::character varying, 'nos_locaux'::character varying, 'visio'::character varying, 'telephone'::character varying, NULL::character varying])::text[]))),
  constraint "prospect_rdv_rdv_type_check" CHECK (((rdv_type)::text = ANY ((ARRAY['decouverte'::character varying, 'suivi'::character varying, 'signature'::character varying, 'relance'::character varying, 'autre'::character varying, NULL::character varying])::text[]))),
  constraint "prospect_rdv_status_check" CHECK (((status)::text = ANY (ARRAY['a_prendre'::text, 'prevu'::text, 'realise'::text, 'annule'::text, 'reporte'::text]))),
  constraint "prospect_rdv_temperature_check" CHECK (((temperature)::text = ANY ((ARRAY['chaud'::character varying, 'tiede'::character varying, 'froid'::character varying, NULL::character varying])::text[]))),
  constraint "prospect_rdv_timeline_check" CHECK (((timeline)::text = ANY ((ARRAY['urgent'::character varying, 'court_terme'::character varying, 'long_terme'::character varying, NULL::character varying])::text[]))),
  constraint "prospect_rdv_pkey" PRIMARY KEY (id)
);
comment on table public."prospect_rdv" is 'Rendez-vous de prospection commerciale';

create table public."prospection_massive" (
  "id" uuid default gen_random_uuid() not null,
  "siret" text,
  "siren" text,
  "name" text,
  "address" text,
  "city" text,
  "postal_code" text,
  "departement" text,
  "effectif" text,
  "effectif_label" text,
  "naf" text,
  "forme_juridique" text,
  "latitude" double precision,
  "longitude" double precision,
  "phone" text,
  "phone_source" text,
  "email" text,
  "email_source" text,
  "site_web" text,
  "enrichment_status" text default 'pending'::text,
  "enrichment_attempts" integer default 0,
  "enrichment_last_attempt" timestamp without time zone,
  "enrichment_sources_tried" jsonb default '[]'::jsonb,
  "enrichment_errors" text,
  "quality_score" integer,
  "suggested_formations" text[],
  "created_at" timestamp without time zone default now(),
  "updated_at" timestamp without time zone default now(),
  "contacted" boolean default false,
  "contacted_at" timestamp without time zone,
  "prospection_status" text,
  "prospection_notes" text,
  "is_siege" boolean default false,
  "is_multi_etablissement" boolean default false,
  "etablissements_count" integer default 1,
  "same_contact_likely" boolean,
  "contact_recommendation" text,
  "ai_summary" text,
  "dirigeant_nom" text,
  "dirigeant_prenom" text,
  "dirigeant_qualite" text,
  "recrute_score" integer default 0,
  "api_enriched_at" timestamp with time zone,
  "email_patterns" jsonb default '[]'::jsonb,
  "dirigeant_fonction" text,
  "opco_name" text,
  "gere_par_id" uuid,
  "gere_par_city" text,
  "gere_par_at" timestamp with time zone,
  "contact_mobile" text,
  "do_not_call" boolean default false,
  "do_not_call_reason" text,
  "do_not_call_by" text,
  "do_not_call_at" timestamp with time zone,
  "enrichment_notes" text,
  "groupe" text,
  "mailing_groupe" text,
  constraint "prospection_massive_enrichment_status_check" CHECK ((enrichment_status = ANY (ARRAY['pending'::text, 'enriching'::text, 'done'::text, 'failed'::text]))),
  constraint "prospection_massive_pkey" PRIMARY KEY (id),
  constraint "prospection_massive_siret_key" UNIQUE (siret)
);

create table public."psh_requests" (
  "id" uuid default gen_random_uuid() not null,
  "reference" text,
  "is_test" boolean default false not null,
  "session_id" uuid,
  "client_id" uuid,
  "trainee_id" uuid,
  "source" text default 'stagiaire'::text not null,
  "canal" text default 'telephone'::text not null,
  "date_reception" timestamp with time zone default now() not null,
  "besoin_fonctionnel" text default ''::text not null,
  "impact_apprentissage" text,
  "contraintes_securite" text,
  "decision" text default 'a_analyser'::text not null,
  "justification_decision" text,
  "responsable" text default 'Référent handicap'::text,
  "date_decision" timestamp with time zone,
  "actions_prevues" text,
  "date_mise_en_oeuvre" date,
  "status" text default 'open'::text not null,
  "date_cloture" timestamp with time zone,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  constraint "psh_requests_pkey" PRIMARY KEY (id),
  constraint "psh_requests_reference_key" UNIQUE (reference)
);

create table public."qualiopi_documents" (
  "id" uuid default gen_random_uuid() not null,
  "type" text not null,
  "title" text not null,
  "content" text not null,
  "version" text default '1.0'::text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  constraint "qualiopi_documents_pkey" PRIMARY KEY (id),
  constraint "unique_doc_type" UNIQUE (type)
);

create table public."qualiopi_indicators" (
  "id" uuid default uuid_generate_v4() not null,
  "number" integer not null,
  "criterion" integer not null,
  "title" text not null,
  "description" text,
  "is_common" boolean default true,
  constraint "qualiopi_indicators_pkey" PRIMARY KEY (id),
  constraint "qualiopi_indicators_number_key" UNIQUE (number)
);

create table public."quality_alerts" (
  "id" uuid default gen_random_uuid() not null,
  "session_id" uuid,
  "trainee_id" uuid,
  "criterion_key" text not null,
  "criterion_label" text not null,
  "score" integer not null,
  "status" text default 'pending'::text not null,
  "treated_at" timestamp with time zone,
  "treated_by" text,
  "treatment_comment" text,
  "non_conformite_id" uuid,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  constraint "quality_alerts_score_check" CHECK (((score >= 1) AND (score <= 3))),
  constraint "quality_alerts_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'treated'::text, 'nc_created'::text, 'nc_linked'::text]))),
  constraint "quality_alerts_pkey" PRIMARY KEY (id),
  constraint "quality_alerts_unique" UNIQUE (session_id, trainee_id, criterion_key),
  constraint "quality_alerts_unique_key" UNIQUE (session_id, trainee_id, criterion_key)
);

create table public."quality_documents" (
  "id" uuid default gen_random_uuid() not null,
  "doc_id" character varying(50) not null,
  "code" character varying(20) not null,
  "name" character varying(255) not null,
  "content" jsonb default '{}'::jsonb,
  "version" character varying(10) default '1.0'::character varying,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "created_by" uuid,
  "updated_by" uuid,
  constraint "quality_documents_pkey" PRIMARY KEY (id),
  constraint "quality_documents_doc_id_key" UNIQUE (doc_id)
);

create table public."quote_items" (
  "id" uuid default gen_random_uuid() not null,
  "quote_id" uuid,
  "position" integer default 0,
  "code" character varying,
  "description_title" text,
  "description_detail" text,
  "quantity" numeric(10,2) default 1,
  "unit" character varying default 'unité'::character varying,
  "unit_price_ht" numeric(12,2) default 0 not null,
  "tva_rate" numeric(5,2) default 20.00,
  "total_ht" numeric(12,2) default 0,
  "course_id" uuid,
  "created_at" timestamp with time zone default now(),
  "accepted" boolean,
  constraint "quote_items_pkey" PRIMARY KEY (id)
);

create table public."quotes" (
  "id" uuid default gen_random_uuid() not null,
  "reference" character varying not null,
  "client_id" uuid,
  "contact_id" uuid,
  "session_id" uuid,
  "quote_date" date default CURRENT_DATE not null,
  "validity_date" date,
  "object" text,
  "client_reference" character varying,
  "status" character varying default 'draft'::character varying,
  "payment_method" character varying default 'virement bancaire'::character varying,
  "payment_terms" character varying default 'à 30 jours'::character varying,
  "payment_deadline" date,
  "discount_percent" numeric(5,2) default 0,
  "discount_label" text,
  "tva_rate" numeric(5,2) default 20.00,
  "tva_applicable" boolean default true,
  "total_ht" numeric(12,2) default 0,
  "total_tva" numeric(12,2) default 0,
  "total_ttc" numeric(12,2) default 0,
  "notes" text,
  "created_by" character varying default 'Hicham Saidi'::character varying,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "signature_base64" text,
  "relance_count" integer default 0,
  "last_relance_date" date,
  "followup_state" text default 'actif'::text not null,
  "veille_until" date,
  "next_followup_date" date,
  "lost_reason" text,
  "followup_notes" text,
  "triaged_at" timestamp with time zone,
  constraint "quotes_followup_state_check" CHECK ((followup_state = ANY (ARRAY['actif'::text, 'veille'::text]))),
  constraint "quotes_status_check" CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'sent'::character varying, 'accepted'::character varying, 'refused'::character varying, 'expired'::character varying, 'invoiced'::character varying])::text[]))),
  constraint "quotes_pkey" PRIMARY KEY (id),
  constraint "quotes_reference_key" UNIQUE (reference)
);

create table public."rdv_emails_sent" (
  "id" uuid default gen_random_uuid() not null,
  "rdv_id" uuid not null,
  "sent_at" timestamp with time zone default now() not null,
  "to_email" character varying(255) not null,
  "to_name" character varying(255),
  "subject" text not null,
  "body" text not null,
  "resend_email_id" character varying(255),
  "attachments" jsonb,
  "status" character varying(50) default 'sent'::character varying,
  "created_by" uuid,
  constraint "rdv_emails_sent_pkey" PRIMARY KEY (id)
);
comment on table public."rdv_emails_sent" is 'Historique des emails de compte-rendu envoyés depuis les RDV prospects';

create table public."rdv_kit_documents" (
  "id" uuid default gen_random_uuid() not null,
  "title" text not null,
  "category" text default 'toujours'::text not null,
  "file_name" text not null,
  "file_path" text not null,
  "file_type" text,
  "file_size" integer,
  "sort_order" integer default 0 not null,
  "is_active" boolean default true not null,
  "created_by" text,
  "updated_by" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "rdv_kit_documents_category_check" CHECK ((category = ANY (ARRAY['toujours'::text, 'sst'::text, 'incendie'::text, 'electrique'::text, 'conduite'::text, 'gestes_postures'::text, 'duerp'::text, 'opco'::text, 'autre'::text]))),
  constraint "rdv_kit_documents_pkey" PRIMARY KEY (id)
);

create table public."reclamations" (
  "id" uuid default gen_random_uuid() not null,
  "reference" text,
  "source" text default 'client'::text not null,
  "canal" text default 'email'::text not null,
  "subject" text not null,
  "description" text,
  "session_id" uuid,
  "date_reception" timestamp with time zone default now() not null,
  "date_accuse" timestamp with time zone,
  "date_analyse" timestamp with time zone,
  "date_resolution" timestamp with time zone,
  "date_cloture" timestamp with time zone,
  "cause_analysis" text,
  "solution_proposed" text,
  "action_taken" text,
  "preventive_action" text,
  "responsable" text default 'Hicham SAIDI'::text,
  "status" text default 'open'::text not null,
  "satisfaction_resolved" boolean,
  "created_by" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  constraint "reclamations_pkey" PRIMARY KEY (id),
  constraint "reclamations_reference_key" UNIQUE (reference)
);

create table public."rgpd_traitements" (
  "id" uuid default gen_random_uuid() not null,
  "nom_traitement" character varying(255) not null,
  "finalite" text not null,
  "base_legale" character varying(100) not null,
  "categories_personnes" text[],
  "categories_donnees" text[],
  "destinataires" text[],
  "transfert_hors_ue" boolean default false,
  "duree_conservation" character varying(100),
  "mesures_securite" text,
  "responsable" character varying(100),
  "date_creation" date default CURRENT_DATE,
  "date_mise_a_jour" date default CURRENT_DATE,
  "actif" boolean default true,
  "created_at" timestamp with time zone default now(),
  constraint "rgpd_traitements_pkey" PRIMARY KEY (id)
);

create table public."session_checklists" (
  "id" uuid default gen_random_uuid() not null,
  "session_id" uuid not null,
  "item_code" character varying(100) not null,
  "is_checked" boolean default false,
  "checked_at" timestamp with time zone,
  "checked_by" uuid,
  "date_realized" date,
  "comment" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  constraint "session_checklists_pkey" PRIMARY KEY (id),
  constraint "session_checklists_session_id_item_code_key" UNIQUE (session_id, item_code)
);
comment on table public."session_checklists" is 'Fiche de contrôle formation pour chaque session';

create table public."session_costs" (
  "id" uuid default gen_random_uuid() not null,
  "session_id" uuid not null,
  "cost_type" text not null,
  "label" text not null,
  "amount" numeric(10,2) default 0 not null,
  "per_trainee" boolean default false,
  "notes" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  constraint "session_costs_pkey" PRIMARY KEY (id)
);

create table public."session_document_access" (
  "id" uuid default uuid_generate_v4() not null,
  "session_id" uuid not null,
  "document_id" uuid not null,
  "is_active" boolean default false,
  "activated_at" timestamp with time zone,
  "activated_by" uuid,
  "created_at" timestamp with time zone default now(),
  constraint "session_document_access_pkey" PRIMARY KEY (id),
  constraint "session_document_access_session_id_document_id_key" UNIQUE (session_id, document_id)
);
comment on table public."session_document_access" is 'Activation des documents par session (contrôle accès stagiaires)';

create table public."session_documents" (
  "id" uuid default gen_random_uuid() not null,
  "session_id" uuid,
  "document_type" text,
  "file_name" text,
  "file_url" text,
  "file_path" text,
  "uploaded_by" text,
  "notes" text,
  "created_at" timestamp with time zone default now(),
  constraint "session_documents_pkey" PRIMARY KEY (id)
);

create table public."session_emails_sent" (
  "id" uuid default gen_random_uuid() not null,
  "session_id" uuid,
  "email_type" character varying(20) not null,
  "to_email" character varying(255) not null,
  "to_name" character varying(255),
  "subject" text not null,
  "body" text not null,
  "attachments" jsonb default '[]'::jsonb,
  "resend_email_id" character varying(255),
  "status" character varying(50) default 'sent'::character varying,
  "created_by" uuid,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  constraint "session_emails_sent_email_type_check" CHECK (((email_type)::text = ANY ((ARRAY['before'::character varying, 'after'::character varying])::text[]))),
  constraint "session_emails_sent_pkey" PRIMARY KEY (id)
);
comment on table public."session_emails_sent" is 'Historique des emails envoyés pour les sessions (documents avant/après formation)';

create table public."session_equipment" (
  "id" uuid default gen_random_uuid() not null,
  "session_id" uuid,
  "equipment_id" uuid,
  "quantity_required" integer default 1,
  "is_prepared" boolean default false,
  "notes" text,
  "created_at" timestamp with time zone default now(),
  "prepared_by" text,
  "prepared_at" timestamp with time zone,
  constraint "session_equipment_pkey" PRIMARY KEY (id),
  constraint "session_equipment_session_id_equipment_id_key" UNIQUE (session_id, equipment_id)
);

create table public."session_fundings" (
  "id" uuid default gen_random_uuid() not null,
  "session_id" uuid not null,
  "funder_type" text default 'entreprise'::text not null,
  "funder_name" text,
  "funder_client_id" uuid,
  "funder_contact_name" text,
  "funder_contact_email" text,
  "funder_address" text,
  "funder_siret" text,
  "amount_ht" numeric(10,2) default 0 not null,
  "percentage" numeric(5,2),
  "invoice_id" uuid,
  "status" text default 'pending'::text not null,
  "dossier_number" text,
  "notes" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  constraint "session_fundings_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'invoiced'::text, 'paid'::text, 'refused'::text, 'cancelled'::text]))),
  constraint "session_fundings_pkey" PRIMARY KEY (id)
);

create table public."session_groups" (
  "id" uuid default uuid_generate_v4() not null,
  "session_id" uuid not null,
  "client_id" uuid,
  "contact_id" uuid,
  "is_individual" boolean default false,
  "group_name" text,
  "price_total" numeric(10,2) default 0 not null,
  "payment_status" text default 'pending'::text,
  "payment_method" text,
  "payment_date" date,
  "penalty_amount" numeric(10,2) default 0,
  "status" text default 'pending'::text,
  "notes" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "nb_personnes" integer,
  "price_per_person" numeric(10,2),
  constraint "session_groups_payment_method_check" CHECK ((payment_method = ANY (ARRAY['cheque'::text, 'virement'::text, NULL::text]))),
  constraint "session_groups_payment_status_check" CHECK ((payment_status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'cancelled'::text]))),
  constraint "session_groups_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'cancelled'::text]))),
  constraint "session_groups_pkey" PRIMARY KEY (id)
);

create table public."session_needs_analysis" (
  "id" uuid default gen_random_uuid() not null,
  "session_id" uuid not null,
  "context_reasons" text[],
  "context_other" text,
  "context_stakes" text,
  "objectives_description" text,
  "objectives_measurable" text,
  "participants_count" integer,
  "participants_profiles" text[],
  "prerequisites_validated" boolean,
  "level" text,
  "particularities_psh" text,
  "particularities_non_french" boolean,
  "particularities_other" text,
  "location_type" text,
  "location_client_address" text,
  "preferred_schedule" text,
  "preferred_dates" text,
  "company_equipment" boolean,
  "company_equipment_details" text,
  "ppe_provided" boolean,
  "other_constraints" text,
  "filled_by" uuid,
  "filled_at" timestamp with time zone,
  "validated_by_client" boolean default false,
  "validated_at" timestamp with time zone,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "analysis_date" date,
  "signature_client" text,
  "signature_trainer" text,
  "signed_at" timestamp with time zone,
  constraint "session_needs_analysis_pkey" PRIMARY KEY (id),
  constraint "session_needs_analysis_session_id_key" UNIQUE (session_id)
);
comment on table public."session_needs_analysis" is 'Analyse du besoin de formation (Qualiopi Indicateur 4)';

create table public."session_qualiopi" (
  "id" uuid default gen_random_uuid() not null,
  "session_id" uuid not null,
  "ind_3_certification" boolean default false,
  "ind_7_adequation" boolean default false,
  "ind_12_engagement" boolean default false,
  "ind_13_apprentis" boolean default false,
  "ind_16_certification" boolean default false,
  "ind_27_sous_traitance" boolean default false,
  "ind_28_formation_situation" boolean default false,
  "has_analyse_besoin" boolean default false,
  "has_convention" boolean default false,
  "has_programme" boolean default false,
  "has_positionnement" boolean default false,
  "has_emargement" boolean default false,
  "has_evaluation" boolean default false,
  "has_certificat" boolean default false,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  constraint "session_qualiopi_pkey" PRIMARY KEY (id),
  constraint "session_qualiopi_session_id_key" UNIQUE (session_id)
);

create table public."session_trainees" (
  "id" uuid default gen_random_uuid() not null,
  "session_id" uuid,
  "trainee_id" uuid,
  "registration_date" timestamp with time zone default now(),
  "result" character varying(50),
  "notes" text,
  "result_forced_reason" text,
  "result_forced_at" timestamp with time zone,
  "remediation_proposal" text,
  "presence_complete" boolean default false,
  "forprev_card_url" text,
  "forprev_card_sent" boolean default false,
  "forprev_card_sent_date" timestamp with time zone,
  "certificate_sent_individual" boolean default false,
  "certificate_sent_individual_date" timestamp with time zone,
  "cold_eval_sent_individual" boolean default false,
  "cold_eval_sent_individual_date" timestamp with time zone,
  "situation" text,
  "funding_type" text,
  "early_departure" boolean default false not null,
  "departure_date" date,
  "departure_reason" text,
  "access_code" text,
  "access_code_attempts" integer default 0 not null,
  "access_code_locked" boolean default false not null,
  "access_code_locked_at" timestamp with time zone,
  "access_code_updated_at" timestamp with time zone default now(),
  "code_generated_at" timestamp with time zone,
  "failed_attempts" integer default 0,
  "locked_until" timestamp with time zone,
  "admin_observation" text,
  "expectations_notification_sent" boolean default false,
  "group_id" uuid,
  "trainee_status" text default 'registered'::text,
  "info_completed_at" timestamp with time zone,
  "convocation_sent_at" timestamp with time zone,
  "portal_last_access" timestamp with time zone,
  "info_sheet_data" jsonb,
  "info_sheet_completed" boolean default false,
  "info_sheet_completed_at" timestamp with time zone,
  "attendance_day_1" jsonb,
  "attendance_day_2" jsonb,
  "attendance_day_3" jsonb,
  "attendance_day_4" jsonb,
  "attendance_day_5" jsonb,
  "evaluation_data" jsonb,
  "evaluation_completed" boolean default false,
  "evaluation_completed_at" timestamp with time zone,
  "google_review_clicked" boolean default false,
  "positioning_test_completed" boolean default false,
  "positioning_test_completed_at" timestamp with time zone,
  "absent" boolean default false not null,
  "absent_at" timestamp with time zone,
  "absent_by" text,
  "absent_reason" text,
  constraint "session_trainees_access_code_format" CHECK (((access_code IS NULL) OR (access_code ~ '^[0-9]{6}$'::text))),
  constraint "session_trainees_trainee_status_check" CHECK ((trainee_status = ANY (ARRAY['registered'::text, 'confirmed'::text, 'convoked'::text, 'info_completed'::text, 'present'::text, 'absent'::text, 'certified'::text, 'cancelled'::text]))),
  constraint "session_trainees_pkey" PRIMARY KEY (id),
  constraint "session_trainees_session_id_trainee_id_key" UNIQUE (session_id, trainee_id),
  constraint "session_trainees_unique" UNIQUE (session_id, trainee_id)
);

create table public."session_trainers" (
  "session_id" uuid not null,
  "trainer_id" uuid not null,
  constraint "session_trainers_pkey" PRIMARY KEY (session_id, trainer_id),
  constraint "session_trainers_unique" UNIQUE (session_id, trainer_id)
);

create table public."sessions" (
  "id" uuid default gen_random_uuid() not null,
  "reference" character varying(50) not null,
  "course_id" uuid,
  "client_id" uuid,
  "trainer_id" uuid,
  "start_date" date not null,
  "end_date" date not null,
  "start_time" time without time zone default '09:00:00'::time without time zone,
  "end_time" time without time zone default '17:00:00'::time without time zone,
  "location_name" character varying(255),
  "location_address" text,
  "location_postal_code" character varying(10),
  "location_city" character varying(100),
  "is_intra" boolean default false,
  "is_remote" boolean default false,
  "remote_link" text,
  "use_custom_price" boolean default false,
  "custom_price_ht" numeric(10,2),
  "status" character varying(50) default 'planned'::character varying,
  "notes" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "total_price" numeric(10,2),
  "contact_id" uuid,
  "requires_forprev" boolean default false,
  "forprev_done" boolean default false,
  "forprev_date" date,
  "info_sheet_token" text,
  "attendance_token" text default encode(gen_random_bytes(32), 'hex'::text) not null,
  "status_locked" boolean default false,
  "room" text,
  "day_type" text default 'full'::text,
  "funding_type" text default 'none'::text,
  "funding_details" text,
  "convention_sent" boolean default false,
  "convention_sent_date" timestamp with time zone,
  "convention_signed" boolean default false,
  "convention_signed_date" timestamp with time zone,
  "convention_signed_file_url" text,
  "session_type" text default 'intra'::text,
  "min_participants" integer default 4,
  "max_participants" integer default 10,
  "is_public" boolean default false,
  "public_price_per_person" numeric(10,2),
  "location_type" character varying(50),
  "location_details" text,
  "host_company_name" text,
  "signatory_name" text,
  "signatory_role" text,
  "inter_group_id" uuid,
  "inter_total_price" numeric,
  "price_mode" text default 'global'::text,
  "quote_id" uuid,
  "subcontract_client_ref" text,
  "subcontract_nb_trainees" integer default 0,
  "subcontract_daily_rate" numeric(10,2),
  "subcontract_convention_url" text,
  "subcontract_course_title" text,
  "subcontract_satisfaction_sent_at" timestamp with time zone,
  "subcontract_invoiced" boolean default false,
  "subcontract_invoice_id" uuid,
  "signature_mode" text default 'auto'::text not null,
  constraint "sessions_day_type_check" CHECK ((day_type = ANY (ARRAY['full'::text, 'half'::text]))),
  constraint "sessions_funding_type_check" CHECK ((funding_type = ANY (ARRAY['none'::text, 'opco'::text, 'cpf'::text, 'faf'::text, 'region'::text, 'france_travail'::text, 'ptp'::text, 'fne'::text, 'direct'::text, 'other'::text]))),
  constraint "sessions_location_type_check" CHECK (((location_type)::text = ANY (ARRAY['client_site'::text, 'rented_space'::text, 'coworking'::text, 'host_company'::text, NULL::text]))),
  constraint "sessions_price_mode_check" CHECK ((price_mode = ANY (ARRAY['global'::text, 'per_trainee'::text]))),
  constraint "sessions_session_type_check" CHECK ((session_type = ANY (ARRAY['intra'::text, 'inter'::text, 'subcontract'::text]))),
  constraint "sessions_signature_mode_check" CHECK ((signature_mode = ANY (ARRAY['auto'::text, 'ouvert'::text, 'ferme'::text]))),
  constraint "sessions_pkey" PRIMARY KEY (id),
  constraint "sessions_reference_key" UNIQUE (reference)
);

create table public."signature_alerts_sent" (
  "session_id" uuid not null,
  "alert_date" date not null,
  "sent_at" timestamp with time zone default now() not null,
  constraint "signature_alerts_sent_pkey" PRIMARY KEY (session_id, alert_date)
);

create table public."social_media_library" (
  "id" uuid default gen_random_uuid() not null,
  "created_at" timestamp with time zone default now(),
  "file_url" text not null,
  "file_name" text,
  "file_type" text,
  "file_size" integer,
  "description" text,
  "tags" text[] default '{}'::text[],
  "session_id" uuid,
  "created_by" uuid,
  constraint "social_media_library_pkey" PRIMARY KEY (id)
);

create table public."social_posts" (
  "id" uuid default gen_random_uuid() not null,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "title" text,
  "content_linkedin" text,
  "content_facebook" text,
  "content_instagram" text,
  "content_gmb" text,
  "media_urls" text[] default '{}'::text[],
  "scheduled_at" timestamp with time zone,
  "status" text default 'draft'::text,
  "platforms" text[] default '{}'::text[],
  "published_linkedin_at" timestamp with time zone,
  "published_facebook_at" timestamp with time zone,
  "published_instagram_at" timestamp with time zone,
  "published_gmb_at" timestamp with time zone,
  "external_id_linkedin" text,
  "external_id_facebook" text,
  "external_id_instagram" text,
  "external_id_gmb" text,
  "source_type" text,
  "source_id" uuid,
  "ai_prompt" text,
  "post_type" text,
  "created_by" uuid,
  "content_linkedin_hicham" text,
  "content_story" text,
  constraint "social_posts_pkey" PRIMARY KEY (id)
);

create table public."social_tokens" (
  "id" uuid default gen_random_uuid() not null,
  "platform" text not null,
  "access_token" text,
  "refresh_token" text,
  "token_expires_at" timestamp with time zone,
  "page_id" text,
  "account_id" text,
  "metadata" jsonb default '{}'::jsonb,
  "updated_at" timestamp with time zone default now(),
  constraint "social_tokens_pkey" PRIMARY KEY (id),
  constraint "social_tokens_platform_key" UNIQUE (platform)
);

create table public."sst_certifications" (
  "id" uuid default gen_random_uuid() not null,
  "session_id" uuid not null,
  "trainee_id" uuid not null,
  "formation_type" text not null,
  "c1_acquis" boolean,
  "c2_acquis" boolean,
  "c3_acquis" boolean,
  "c4_acquis" boolean,
  "c5_acquis" boolean,
  "c6_acquis" boolean,
  "c7_acquis" boolean,
  "c8_acquis" boolean,
  "candidat_certifie" boolean default false not null,
  "date_certification" date not null,
  "formateur_id" uuid not null,
  "formateur_nom" text not null,
  "formateur_prenom" text not null,
  "formateur_signature_url" text,
  "pdf_generated" boolean default false not null,
  "pdf_url" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "c1_ind1" boolean,
  "c2_ind1" boolean,
  "c2_ind2" boolean,
  "c2_ind3" boolean,
  "c2_ind4" boolean,
  "c2_ind5" boolean,
  "c3_ind1" boolean,
  "c3_ind2" boolean,
  "c4_ind1" boolean,
  "c4_ind2" boolean,
  "c5_ind1" boolean,
  "c5_ind2" boolean,
  "c5_ind3" boolean,
  "c6_ind1" boolean,
  "c7_ind1" boolean,
  "c8_ind1" boolean,
  "c8_ind2" boolean,
  constraint "sst_certifications_formation_type_check" CHECK ((formation_type = ANY (ARRAY['FI'::text, 'MAC'::text]))),
  constraint "sst_certifications_pkey" PRIMARY KEY (id),
  constraint "sst_certifications_unique" UNIQUE (session_id, trainee_id)
);
comment on table public."sst_certifications" is 'Grilles de certification SST (Formation Initiale et MAC) selon référentiel INRS';

create table public."theme_questions" (
  "id" uuid default gen_random_uuid() not null,
  "theme_id" uuid not null,
  "question_text" text not null,
  "question_type" character varying(20) default 'qcm'::character varying,
  "option_a" text,
  "option_b" text,
  "option_c" text,
  "option_d" text,
  "correct_answer" character varying(1),
  "position" integer default 0,
  "created_at" timestamp with time zone default now(),
  "options" jsonb default '[]'::jsonb,
  "correct_index" integer default 0,
  "score" integer default 1,
  "critical" boolean default false,
  "scoring_rubric" text,
  "updated_at" timestamp with time zone default now(),
  constraint "theme_questions_pkey" PRIMARY KEY (id)
);

create table public."trainee_documents" (
  "id" uuid default gen_random_uuid() not null,
  "trainee_id" uuid,
  "name" character varying(255) not null,
  "category" character varying(100) default 'Autre'::character varying,
  "document_url" text,
  "uploaded_at" timestamp with time zone default now(),
  constraint "trainee_documents_pkey" PRIMARY KEY (id)
);

create table public."trainee_evaluations" (
  "id" uuid default gen_random_uuid() not null,
  "session_id" uuid not null,
  "trainee_id" uuid not null,
  "questionnaire_submitted" boolean default false,
  "q1_objectives" integer,
  "q2_content" integer,
  "q3_trainer" integer,
  "q4_methods" integer,
  "q5_materials" integer,
  "q6_organization" integer,
  "q7_duration" integer,
  "q8_applicability" integer,
  "satisfaction_score" integer,
  "would_recommend" boolean,
  "strengths" text,
  "improvements" text,
  "comments" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "q_org_documents" integer default 5,
  "q_org_accueil" integer default 5,
  "q_org_locaux" integer default 5,
  "q_org_materiel" integer default 5,
  "q_contenu_organisation" integer default 5,
  "q_contenu_supports" integer default 5,
  "q_contenu_duree" integer default 5,
  "q_contenu_programme" integer default 5,
  "q_formateur_pedagogie" integer default 5,
  "q_formateur_expertise" integer default 5,
  "q_formateur_progression" integer default 5,
  "q_formateur_moyens" integer default 5,
  "q_global_adequation" integer default 5,
  "q_global_competences" integer default 5,
  "comment_general" text,
  "comment_projet" text,
  "submitted_online" boolean default false,
  "submitted_at" timestamp with time zone,
  constraint "trainee_evaluations_pkey" PRIMARY KEY (id),
  constraint "trainee_evaluations_session_id_trainee_id_key" UNIQUE (session_id, trainee_id),
  constraint "trainee_evaluations_session_trainee_unique" UNIQUE (session_id, trainee_id)
);

create table public."trainee_info_sheets" (
  "id" uuid default gen_random_uuid() not null,
  "session_id" uuid,
  "trainee_id" uuid,
  "email" text,
  "ssn" text,
  "ssn_refused" boolean default false,
  "last_training_year" integer,
  "highest_diploma" text,
  "rgpd_consent" boolean default false,
  "rgpd_consent_date" timestamp with time zone,
  "filled_at" timestamp with time zone,
  "filled_online" boolean default false,
  "created_at" timestamp with time zone default now(),
  "csp" text,
  "job_title" text,
  "training_expectations" text,
  "email_refused" boolean default false not null,
  constraint "trainee_info_sheets_pkey" PRIMARY KEY (id),
  constraint "trainee_info_sheets_session_id_trainee_id_key" UNIQUE (session_id, trainee_id)
);

create table public."trainee_objectives" (
  "id" uuid default gen_random_uuid() not null,
  "session_id" uuid,
  "trainee_id" uuid,
  "objective_index" integer default 0,
  "objective_text" text,
  "validated" boolean default false,
  "validated_at" timestamp with time zone,
  "updated_at" timestamp with time zone default now(),
  "created_at" timestamp with time zone default now(),
  "remediation_comment" text,
  constraint "trainee_objectives_pkey" PRIMARY KEY (id),
  constraint "trainee_objectives_unique" UNIQUE (session_id, trainee_id, objective_index)
);

create table public."trainee_positioning_tests" (
  "id" uuid default gen_random_uuid() not null,
  "session_id" uuid not null,
  "trainee_id" uuid not null,
  "question_id" uuid not null,
  "question_type" text not null,
  "selected_option_index" integer,
  "text_answer" text,
  "is_correct" boolean,
  "score_obtained" integer default 0,
  "answered_at" timestamp with time zone default now(),
  "created_at" timestamp with time zone default now(),
  constraint "trainee_positioning_tests_pkey" PRIMARY KEY (id),
  constraint "trainee_positioning_tests_session_id_trainee_id_question_id_key" UNIQUE (session_id, trainee_id, question_id)
);

create table public."trainees" (
  "id" uuid default gen_random_uuid() not null,
  "first_name" character varying(100) not null,
  "last_name" character varying(100) not null,
  "email" character varying(255),
  "phone" character varying(20),
  "birth_date" date,
  "birth_place" character varying(255),
  "address" text,
  "postal_code" character varying(10),
  "city" character varying(100),
  "social_security_number" character varying(15),
  "client_id" uuid,
  "job_title" character varying(255),
  "notes" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "refused_ssn" boolean default false,
  "has_disability" boolean default false,
  "disability_details" text,
  "disability_adaptations" text,
  "ssn_encrypted" bytea,
  "last_session_date" date,
  "csp" text,
  "gender" text,
  "email_refused" boolean default false not null,
  constraint "trainees_gender_check" CHECK ((gender = ANY (ARRAY['male'::text, 'female'::text, 'non_binary'::text]))),
  constraint "trainees_pkey" PRIMARY KEY (id)
);

create table public."trainees_archive" (
  "id" uuid not null,
  "reference" text not null,
  "last_session_date" date,
  "sessions_count" integer,
  "archived_at" timestamp with time zone default now(),
  "archived_by" text,
  constraint "trainees_archive_pkey" PRIMARY KEY (id)
);

create table public."trainer_certificates" (
  "id" uuid default gen_random_uuid() not null,
  "trainer_id" uuid,
  "name" text not null,
  "certificate_type" text,
  "issuer" text,
  "certificate_number" text,
  "issue_date" date,
  "expiry_date" date,
  "no_expiry" boolean default false,
  "file_path" text,
  "file_name" text,
  "notes" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "obtained_date" date,
  "custom_type" text,
  constraint "trainer_certificates_pkey" PRIMARY KEY (id)
);

create table public."trainer_evaluations" (
  "id" uuid default gen_random_uuid() not null,
  "session_id" uuid not null,
  "trainer_id" uuid,
  "group_motivation" integer,
  "group_level" integer,
  "material_conditions" integer,
  "organization" integer,
  "documentation" integer,
  "overall_score" integer,
  "comments" text,
  "difficulties" text,
  "successes" text,
  "recommendations" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  constraint "trainer_evaluations_pkey" PRIMARY KEY (id),
  constraint "trainer_evaluations_session_id_key" UNIQUE (session_id)
);

create table public."trainer_interviews" (
  "id" uuid default gen_random_uuid() not null,
  "trainer_id" uuid not null,
  "interview_date" date not null,
  "interviewer_name" character varying(255) not null,
  "interview_type" character varying(50) default 'annuel'::character varying,
  "themes_discussed" text,
  "skills_assessment" text,
  "identified_needs" text,
  "actions_planned" text,
  "next_interview_date" date,
  "document_url" text,
  "notes" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "created_by" uuid,
  constraint "trainer_interviews_interview_type_check" CHECK (((interview_type)::text = ANY ((ARRAY['annuel'::character varying, 'semestriel'::character varying, 'ponctuel'::character varying])::text[]))),
  constraint "trainer_interviews_pkey" PRIMARY KEY (id)
);
comment on table public."trainer_interviews" is 'Entretiens professionnels formateurs (Qualiopi Ind. 23)';

create table public."trainer_qualifications" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "description" text,
  "created_at" timestamp with time zone default now(),
  constraint "trainer_qualifications_pkey" PRIMARY KEY (id),
  constraint "trainer_qualifications_name_key" UNIQUE (name)
);

create table public."trainer_trainings" (
  "id" uuid default gen_random_uuid() not null,
  "trainer_id" uuid not null,
  "training_date" date not null,
  "training_name" character varying(255) not null,
  "training_type" character varying(50) not null,
  "organizer" character varying(255),
  "duration_days" numeric(4,2),
  "duration_hours" numeric(4,2),
  "certificate_obtained" boolean default false,
  "certificate_url" text,
  "notes" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "created_by" uuid,
  constraint "trainer_trainings_training_type_check" CHECK (((training_type)::text = ANY ((ARRAY['externe'::character varying, 'interne'::character varying, 'echange_pratiques'::character varying])::text[]))),
  constraint "trainer_trainings_pkey" PRIMARY KEY (id)
);
comment on table public."trainer_trainings" is 'Formations suivies par les formateurs (Qualiopi Ind. 22)';

create table public."trainers" (
  "id" uuid default gen_random_uuid() not null,
  "first_name" character varying(100) not null,
  "last_name" character varying(100) not null,
  "email" character varying(255),
  "phone" character varying(20),
  "specialties" text,
  "bio" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "certifications" text,
  "hourly_rate" numeric(10,2),
  "notes" text,
  "qualifications" text,
  "certification_number" character varying(100),
  "qualifications_list" text[] default '{}'::text[],
  "is_internal" boolean default true,
  "signature_url" text,
  constraint "trainers_pkey" PRIMARY KEY (id)
);

create table public."training_themes" (
  "id" uuid default gen_random_uuid() not null,
  "code" character varying(20) not null,
  "name" character varying(100) not null,
  "description" text,
  "color" character varying(7) default '#3B82F6'::character varying,
  "position" integer default 0,
  "created_at" timestamp with time zone default now(),
  constraint "training_themes_pkey" PRIMARY KEY (id),
  constraint "training_themes_code_key" UNIQUE (code)
);

create table public."uploaded_documents" (
  "id" uuid default uuid_generate_v4() not null,
  "name" character varying(255) not null,
  "filename" character varying(255),
  "file_url" text,
  "file_size" integer,
  "mime_type" character varying(100),
  "category" character varying(50) default 'other'::character varying,
  "session_id" uuid,
  "course_id" uuid,
  "client_id" uuid,
  "notes" text,
  "created_at" timestamp with time zone default now(),
  constraint "uploaded_documents_pkey" PRIMARY KEY (id)
);

create table public."uploaded_files" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "filename" text not null,
  "file_path" text not null,
  "file_url" text,
  "mime_type" text default 'application/pdf'::text,
  "file_size" integer,
  "category" text default 'autre'::text,
  "notes" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  constraint "uploaded_files_pkey" PRIMARY KEY (id)
);

create table public."user_email_configs" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "email" character varying(255) not null,
  "smtp_password_encrypted" text not null,
  "smtp_host" character varying(255) default 'smtp.exchange.ionos.eu'::character varying,
  "smtp_port" integer default 587,
  "smtp_secure" boolean default false,
  "is_active" boolean default true,
  "last_tested_at" timestamp with time zone,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "signature_image" text,
  constraint "user_email_configs_pkey" PRIMARY KEY (id),
  constraint "user_email_configs_user_id_key" UNIQUE (user_id)
);
comment on table public."user_email_configs" is 'Configuration SMTP individuelle pour chaque utilisateur (Access Formation)';

create table public."user_planning_events" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "event_type" text not null,
  "event_date" date not null,
  "start_time" time without time zone not null,
  "end_time" time without time zone not null,
  "title" text not null,
  "description" text,
  "color" text default '#6B7280'::text,
  "is_recurring" boolean default false,
  "recurrence_rule" text,
  "recurrence_end" date,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "google_event_id" text,
  "location" text,
  "linked_entity_type" text,
  "linked_entity_id" uuid,
  constraint "user_planning_events_event_type_check" CHECK ((event_type = ANY (ARRAY['indispo'::text, 'adm'::text, 'phoning_manual'::text, 'task'::text, 'conges'::text, 'perso'::text, 'prospection_terrain'::text, 'reunion'::text, 'preparation'::text, 'deadline'::text]))),
  constraint "user_planning_events_pkey" PRIMARY KEY (id)
);

create table public."veille_qualiopi" (
  "id" uuid default gen_random_uuid() not null,
  "type" character varying(50) not null,
  "date" date default CURRENT_DATE not null,
  "source" character varying(255),
  "sujet" text not null,
  "description" text,
  "action_menee" text,
  "impact" character varying(100),
  "statut" character varying(50) default 'a_traiter'::character varying,
  "responsable" character varying(255),
  "date_traitement" date,
  "pieces_jointes" text[],
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  constraint "veille_qualiopi_statut_check" CHECK (((statut)::text = ANY ((ARRAY['a_traiter'::character varying, 'en_cours'::character varying, 'traite'::character varying, 'archive'::character varying])::text[]))),
  constraint "veille_qualiopi_type_check" CHECK (((type)::text = ANY ((ARRAY['legale'::character varying, 'metiers'::character varying, 'pedagogique'::character varying])::text[]))),
  constraint "veille_qualiopi_pkey" PRIMARY KEY (id)
);

create table public."veille_sources" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "url" text not null,
  "type" text default 'legale'::text not null,
  "description" text,
  "active" boolean default true,
  "created_at" timestamp with time zone default now(),
  constraint "veille_sources_pkey" PRIMARY KEY (id)
);

-- Cles etrangeres
alter table public."attendance_halfdays" add constraint "attendance_halfdays_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public."attendance_halfdays" add constraint "attendance_halfdays_trainee_id_fkey" FOREIGN KEY (trainee_id) REFERENCES trainees(id) ON DELETE CASCADE;
alter table public."attendance_proxy_signatures" add constraint "attendance_proxy_signatures_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public."attendance_proxy_signatures" add constraint "attendance_proxy_signatures_trainee_id_fkey" FOREIGN KEY (trainee_id) REFERENCES trainees(id) ON DELETE CASCADE;
alter table public."attendances" add constraint "fk_attendances_session" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public."budget_meal_guests" add constraint "budget_meal_guests_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;
alter table public."budget_meal_guests" add constraint "budget_meal_guests_transaction_id_fkey" FOREIGN KEY (transaction_id) REFERENCES budget_transactions(id) ON DELETE CASCADE;
alter table public."budget_receipts" add constraint "budget_receipts_transaction_id_fkey" FOREIGN KEY (transaction_id) REFERENCES budget_transactions(id) ON DELETE CASCADE;
alter table public."budget_rules" add constraint "budget_rules_category_id_fkey" FOREIGN KEY (category_id) REFERENCES budget_categories(id) ON DELETE CASCADE;
alter table public."budget_transaction_invoices" add constraint "budget_transaction_invoices_invoice_id_fkey" FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;
alter table public."budget_transaction_invoices" add constraint "budget_transaction_invoices_transaction_id_fkey" FOREIGN KEY (transaction_id) REFERENCES budget_transactions(id) ON DELETE CASCADE;
alter table public."budget_transactions" add constraint "budget_transactions_category_id_fkey" FOREIGN KEY (category_id) REFERENCES budget_categories(id);
alter table public."budget_transactions" add constraint "budget_transactions_linked_invoice_id_fkey" FOREIGN KEY (linked_invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;
alter table public."budget_transactions" add constraint "budget_transactions_linked_transaction_id_fkey" FOREIGN KEY (linked_transaction_id) REFERENCES budget_transactions(id);
alter table public."client_contacts" add constraint "client_contacts_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
alter table public."client_interactions" add constraint "client_interactions_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
alter table public."client_providers" add constraint "client_providers_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
alter table public."course_document_downloads" add constraint "course_document_downloads_document_id_fkey" FOREIGN KEY (document_id) REFERENCES course_documents(id) ON DELETE CASCADE;
alter table public."course_document_downloads" add constraint "course_document_downloads_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public."course_document_downloads" add constraint "course_document_downloads_trainee_id_fkey" FOREIGN KEY (trainee_id) REFERENCES trainees(id) ON DELETE CASCADE;
alter table public."course_documents" add constraint "course_documents_course_id_fkey" FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE;
alter table public."course_equipment" add constraint "course_equipment_course_id_fkey" FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE;
alter table public."course_equipment" add constraint "course_equipment_equipment_id_fkey" FOREIGN KEY (equipment_id) REFERENCES equipment_catalog(id) ON DELETE CASCADE;
alter table public."courses" add constraint "courses_default_trainer_id_fkey" FOREIGN KEY (default_trainer_id) REFERENCES trainers(id) ON DELETE SET NULL;
alter table public."courses" add constraint "courses_theme_id_fkey" FOREIGN KEY (theme_id) REFERENCES training_themes(id);
alter table public."document_signatures" add constraint "document_signatures_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;
alter table public."document_signatures" add constraint "document_signatures_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public."document_signatures" add constraint "document_signatures_trainee_id_fkey" FOREIGN KEY (trainee_id) REFERENCES trainees(id) ON DELETE SET NULL;
alter table public."duerp_actions" add constraint "duerp_actions_course_id_fkey" FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL;
alter table public."duerp_actions" add constraint "duerp_actions_project_id_fkey" FOREIGN KEY (project_id) REFERENCES duerp_projects(id) ON DELETE CASCADE;
alter table public."duerp_actions" add constraint "duerp_actions_risk_id_fkey" FOREIGN KEY (risk_id) REFERENCES duerp_risks(id) ON DELETE SET NULL;
alter table public."duerp_equipements" add constraint "duerp_equipements_project_id_fkey" FOREIGN KEY (project_id) REFERENCES duerp_projects(id) ON DELETE CASCADE;
alter table public."duerp_equipements" add constraint "duerp_equipements_unit_id_fkey" FOREIGN KEY (unit_id) REFERENCES duerp_units(id) ON DELETE SET NULL;
alter table public."duerp_formations_reglementaires" add constraint "duerp_formations_reglementaires_category_code_fkey" FOREIGN KEY (category_code) REFERENCES duerp_risk_categories(code);
alter table public."duerp_habilitations" add constraint "duerp_habilitations_project_id_fkey" FOREIGN KEY (project_id) REFERENCES duerp_projects(id) ON DELETE CASCADE;
alter table public."duerp_projects" add constraint "duerp_projects_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;
alter table public."duerp_risk_templates" add constraint "duerp_risk_templates_category_code_fkey" FOREIGN KEY (category_code) REFERENCES duerp_risk_categories(code);
alter table public."duerp_risks" add constraint "duerp_risks_category_code_fkey" FOREIGN KEY (category_code) REFERENCES duerp_risk_categories(code);
alter table public."duerp_risks" add constraint "duerp_risks_project_id_fkey" FOREIGN KEY (project_id) REFERENCES duerp_projects(id) ON DELETE CASCADE;
alter table public."duerp_risks" add constraint "duerp_risks_template_id_fkey" FOREIGN KEY (template_id) REFERENCES duerp_risk_templates(id) ON DELETE SET NULL;
alter table public."duerp_risks" add constraint "duerp_risks_unit_id_fkey" FOREIGN KEY (unit_id) REFERENCES duerp_units(id) ON DELETE CASCADE;
alter table public."duerp_units" add constraint "duerp_units_project_id_fkey" FOREIGN KEY (project_id) REFERENCES duerp_projects(id) ON DELETE CASCADE;
alter table public."duerp_verifications" add constraint "duerp_verifications_project_id_fkey" FOREIGN KEY (project_id) REFERENCES duerp_projects(id) ON DELETE CASCADE;
alter table public."evaluations_cold" add constraint "fk_evaluations_cold_session" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public."invoice_items" add constraint "invoice_items_course_id_fkey" FOREIGN KEY (course_id) REFERENCES courses(id);
alter table public."invoice_items" add constraint "invoice_items_invoice_id_fkey" FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;
alter table public."invoice_payments" add constraint "invoice_payments_invoice_id_fkey" FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;
alter table public."invoice_relances" add constraint "invoice_relances_invoice_id_fkey" FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;
alter table public."invoice_sessions" add constraint "invoice_sessions_invoice_id_fkey" FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;
alter table public."invoice_sessions" add constraint "invoice_sessions_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public."invoices" add constraint "invoices_billing_client_id_fkey" FOREIGN KEY (billing_client_id) REFERENCES clients(id);
alter table public."invoices" add constraint "invoices_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id);
alter table public."invoices" add constraint "invoices_contact_id_fkey" FOREIGN KEY (contact_id) REFERENCES client_contacts(id);
alter table public."invoices" add constraint "invoices_parent_invoice_id_fkey" FOREIGN KEY (parent_invoice_id) REFERENCES invoices(id);
alter table public."invoices" add constraint "invoices_quote_id_fkey" FOREIGN KEY (quote_id) REFERENCES quotes(id);
alter table public."invoices" add constraint "invoices_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id);
alter table public."mailing_sends" add constraint "mailing_sends_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES mailing_campaigns(id) ON DELETE CASCADE;
alter table public."non_conformities" add constraint "non_conformities_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;
alter table public."positioning_questions_ref" add constraint "positioning_questions_ref_positioning_theme_id_fkey" FOREIGN KEY (positioning_theme_id) REFERENCES positioning_themes(theme_id);
alter table public."positioning_results" add constraint "positioning_results_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public."positioning_results" add constraint "positioning_results_trainee_id_fkey" FOREIGN KEY (trainee_id) REFERENCES trainees(id) ON DELETE CASCADE;
alter table public."process_connections" add constraint "process_connections_from_step_id_fkey" FOREIGN KEY (from_step_id) REFERENCES process_steps(id) ON DELETE CASCADE;
alter table public."process_connections" add constraint "process_connections_process_id_fkey" FOREIGN KEY (process_id) REFERENCES processes(id) ON DELETE CASCADE;
alter table public."process_connections" add constraint "process_connections_to_step_id_fkey" FOREIGN KEY (to_step_id) REFERENCES process_steps(id) ON DELETE CASCADE;
alter table public."process_steps" add constraint "process_steps_category_id_fkey" FOREIGN KEY (category_id) REFERENCES process_categories(id);
alter table public."process_steps" add constraint "process_steps_linked_process_id_fkey" FOREIGN KEY (linked_process_id) REFERENCES processes(id);
alter table public."process_steps" add constraint "process_steps_process_id_fkey" FOREIGN KEY (process_id) REFERENCES processes(id) ON DELETE CASCADE;
alter table public."process_steps" add constraint "process_steps_responsible_id_fkey" FOREIGN KEY (responsible_id) REFERENCES process_responsibles(id);
alter table public."process_versions" add constraint "process_versions_process_id_fkey" FOREIGN KEY (process_id) REFERENCES processes(id) ON DELETE CASCADE;
alter table public."processes" add constraint "processes_category_id_fkey" FOREIGN KEY (category_id) REFERENCES process_categories(id);
alter table public."prospect_calls" add constraint "prospect_calls_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
alter table public."prospect_calls" add constraint "prospect_calls_phoning_session_id_fkey" FOREIGN KEY (phoning_session_id) REFERENCES phoning_sessions(id) ON DELETE SET NULL;
alter table public."prospect_calls" add constraint "prospect_calls_previous_call_id_fkey" FOREIGN KEY (previous_call_id) REFERENCES prospect_calls(id) ON DELETE SET NULL;
alter table public."prospect_calls" add constraint "prospect_calls_rdv_id_fkey" FOREIGN KEY (rdv_id) REFERENCES prospect_rdv(id) ON DELETE SET NULL;
alter table public."prospect_email_logs" add constraint "prospect_email_logs_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id);
alter table public."prospect_needs_analysis" add constraint "prospect_needs_analysis_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
alter table public."prospect_needs_analysis" add constraint "prospect_needs_analysis_rdv_id_fkey" FOREIGN KEY (rdv_id) REFERENCES prospect_rdv(id) ON DELETE SET NULL;
alter table public."prospect_rdv" add constraint "prospect_rdv_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
alter table public."prospect_rdv" add constraint "prospect_rdv_contact_id_fkey" FOREIGN KEY (contact_id) REFERENCES client_contacts(id) ON DELETE SET NULL;
alter table public."prospect_rdv" add constraint "prospect_rdv_quote_id_fkey" FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE SET NULL;
alter table public."prospect_rdv" add constraint "prospect_rdv_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;
alter table public."prospection_massive" add constraint "prospection_massive_gere_par_id_fkey" FOREIGN KEY (gere_par_id) REFERENCES prospection_massive(id) ON DELETE SET NULL;
alter table public."psh_requests" add constraint "psh_requests_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;
alter table public."psh_requests" add constraint "psh_requests_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;
alter table public."psh_requests" add constraint "psh_requests_trainee_id_fkey" FOREIGN KEY (trainee_id) REFERENCES trainees(id) ON DELETE SET NULL;
alter table public."quality_alerts" add constraint "quality_alerts_non_conformite_id_fkey" FOREIGN KEY (non_conformite_id) REFERENCES non_conformites(id) ON DELETE SET NULL;
alter table public."quality_alerts" add constraint "quality_alerts_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public."quality_alerts" add constraint "quality_alerts_trainee_id_fkey" FOREIGN KEY (trainee_id) REFERENCES trainees(id) ON DELETE SET NULL;
alter table public."quote_items" add constraint "quote_items_course_id_fkey" FOREIGN KEY (course_id) REFERENCES courses(id);
alter table public."quote_items" add constraint "quote_items_quote_id_fkey" FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE;
alter table public."quotes" add constraint "quotes_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id);
alter table public."quotes" add constraint "quotes_contact_id_fkey" FOREIGN KEY (contact_id) REFERENCES client_contacts(id);
alter table public."quotes" add constraint "quotes_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id);
alter table public."rdv_emails_sent" add constraint "fk_rdv" FOREIGN KEY (rdv_id) REFERENCES prospect_rdv(id) ON DELETE CASCADE;
alter table public."rdv_emails_sent" add constraint "rdv_emails_sent_rdv_id_fkey" FOREIGN KEY (rdv_id) REFERENCES prospect_rdv(id) ON DELETE CASCADE;
alter table public."reclamations" add constraint "reclamations_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;
alter table public."session_checklists" add constraint "session_checklists_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public."session_costs" add constraint "session_costs_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public."session_document_access" add constraint "session_document_access_document_id_fkey" FOREIGN KEY (document_id) REFERENCES course_documents(id) ON DELETE CASCADE;
alter table public."session_document_access" add constraint "session_document_access_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public."session_documents" add constraint "session_documents_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public."session_emails_sent" add constraint "session_emails_sent_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public."session_equipment" add constraint "session_equipment_equipment_id_fkey" FOREIGN KEY (equipment_id) REFERENCES equipment_catalog(id) ON DELETE CASCADE;
alter table public."session_equipment" add constraint "session_equipment_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public."session_fundings" add constraint "session_fundings_funder_client_id_fkey" FOREIGN KEY (funder_client_id) REFERENCES clients(id) ON DELETE SET NULL;
alter table public."session_fundings" add constraint "session_fundings_invoice_id_fkey" FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;
alter table public."session_fundings" add constraint "session_fundings_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public."session_groups" add constraint "session_groups_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;
alter table public."session_groups" add constraint "session_groups_contact_id_fkey" FOREIGN KEY (contact_id) REFERENCES client_contacts(id) ON DELETE SET NULL;
alter table public."session_groups" add constraint "session_groups_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public."session_needs_analysis" add constraint "session_needs_analysis_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public."session_trainees" add constraint "session_trainees_group_id_fkey" FOREIGN KEY (group_id) REFERENCES session_groups(id) ON DELETE CASCADE;
alter table public."session_trainees" add constraint "session_trainees_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public."session_trainees" add constraint "session_trainees_trainee_id_fkey" FOREIGN KEY (trainee_id) REFERENCES trainees(id) ON DELETE CASCADE;
alter table public."sessions" add constraint "sessions_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;
alter table public."sessions" add constraint "sessions_contact_id_fkey" FOREIGN KEY (contact_id) REFERENCES client_contacts(id) ON DELETE SET NULL;
alter table public."sessions" add constraint "sessions_course_id_fkey" FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE;
alter table public."sessions" add constraint "sessions_quote_id_fkey" FOREIGN KEY (quote_id) REFERENCES quotes(id);
alter table public."sessions" add constraint "sessions_trainer_id_fkey" FOREIGN KEY (trainer_id) REFERENCES trainers(id) ON DELETE SET NULL;
alter table public."signature_alerts_sent" add constraint "signature_alerts_sent_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public."sst_certifications" add constraint "sst_certifications_formateur_fkey" FOREIGN KEY (formateur_id) REFERENCES trainers(id) ON DELETE RESTRICT;
alter table public."sst_certifications" add constraint "sst_certifications_session_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public."sst_certifications" add constraint "sst_certifications_trainee_fkey" FOREIGN KEY (trainee_id) REFERENCES trainees(id) ON DELETE CASCADE;
alter table public."theme_questions" add constraint "theme_questions_theme_id_fkey" FOREIGN KEY (theme_id) REFERENCES training_themes(id) ON DELETE CASCADE;
alter table public."trainee_documents" add constraint "trainee_documents_trainee_id_fkey" FOREIGN KEY (trainee_id) REFERENCES trainees(id) ON DELETE CASCADE;
alter table public."trainee_evaluations" add constraint "fk_trainee_evaluations_session" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public."trainee_evaluations" add constraint "fk_trainee_evaluations_trainee" FOREIGN KEY (trainee_id) REFERENCES trainees(id) ON DELETE CASCADE;
alter table public."trainee_info_sheets" add constraint "trainee_info_sheets_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public."trainee_info_sheets" add constraint "trainee_info_sheets_trainee_id_fkey" FOREIGN KEY (trainee_id) REFERENCES trainees(id) ON DELETE CASCADE;
alter table public."trainee_objectives" add constraint "trainee_objectives_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public."trainee_objectives" add constraint "trainee_objectives_trainee_id_fkey" FOREIGN KEY (trainee_id) REFERENCES trainees(id) ON DELETE CASCADE;
alter table public."trainee_positioning_tests" add constraint "trainee_positioning_tests_question_id_fkey" FOREIGN KEY (question_id) REFERENCES theme_questions(id) ON DELETE CASCADE;
alter table public."trainee_positioning_tests" add constraint "trainee_positioning_tests_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public."trainee_positioning_tests" add constraint "trainee_positioning_tests_trainee_id_fkey" FOREIGN KEY (trainee_id) REFERENCES trainees(id) ON DELETE CASCADE;
alter table public."trainees" add constraint "trainees_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;
alter table public."trainer_evaluations" add constraint "fk_trainer_evaluations_session" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public."trainer_interviews" add constraint "trainer_interviews_trainer_id_fkey" FOREIGN KEY (trainer_id) REFERENCES trainers(id) ON DELETE CASCADE;
alter table public."trainer_trainings" add constraint "trainer_trainings_trainer_id_fkey" FOREIGN KEY (trainer_id) REFERENCES trainers(id) ON DELETE CASCADE;
alter table public."uploaded_documents" add constraint "uploaded_documents_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;
alter table public."uploaded_documents" add constraint "uploaded_documents_course_id_fkey" FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL;
alter table public."uploaded_documents" add constraint "uploaded_documents_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;

-- Index
CREATE UNIQUE INDEX attendance_halfdays_unique ON public.attendance_halfdays USING btree (session_id, trainee_id, date);
CREATE UNIQUE INDEX attendance_proxy_unique ON public.attendance_proxy_signatures USING btree (session_id, trainee_id, date, period);
CREATE INDEX idx_attendances_date ON public.attendances USING btree (session_id, trainee_id, date);
CREATE INDEX idx_attendances_session ON public.attendances USING btree (session_id);
CREATE INDEX idx_attendances_trainee ON public.attendances USING btree (trainee_id);
CREATE INDEX idx_audit_logs_action ON public.audit_logs USING btree (action);
CREATE INDEX idx_audit_logs_entity ON public.audit_logs USING btree (entity_type, entity_id);
CREATE INDEX idx_audit_logs_timestamp ON public.audit_logs USING btree ("timestamp" DESC);
CREATE INDEX idx_audit_logs_user ON public.audit_logs USING btree (user_id);
CREATE INDEX bank_statements_period_end_idx ON public.bank_statements USING btree (period_end DESC);
CREATE UNIQUE INDEX bank_statements_unique_num ON public.bank_statements USING btree (statement_year, statement_number) WHERE (statement_number IS NOT NULL);
CREATE INDEX idx_bpf_year ON public.bpf_declarations USING btree (year);
CREATE INDEX idx_meal_guests_tx ON public.budget_meal_guests USING btree (transaction_id);
CREATE INDEX idx_pipeline_month ON public.budget_pipeline USING btree (expected_month);
CREATE INDEX idx_pipeline_status ON public.budget_pipeline USING btree (status);
CREATE INDEX idx_budget_receipts_tx ON public.budget_receipts USING btree (transaction_id);
CREATE INDEX idx_budget_rules_keyword ON public.budget_rules USING btree (keyword);
CREATE INDEX idx_bti_invoice ON public.budget_transaction_invoices USING btree (invoice_id);
CREATE INDEX idx_bti_transaction ON public.budget_transaction_invoices USING btree (transaction_id);
CREATE INDEX budget_transactions_private_idx ON public.budget_transactions USING btree (is_private) WHERE (is_private = true);
CREATE INDEX idx_bt_linked_invoice ON public.budget_transactions USING btree (linked_invoice_id) WHERE (linked_invoice_id IS NOT NULL);
CREATE INDEX idx_budget_tx_category ON public.budget_transactions USING btree (category_id);
CREATE INDEX idx_budget_tx_date ON public.budget_transactions USING btree (date);
CREATE INDEX idx_budget_tx_month ON public.budget_transactions USING btree (month);
CREATE INDEX idx_budget_tx_payer ON public.budget_transactions USING btree (payer);
CREATE INDEX idx_budget_tx_personal ON public.budget_transactions USING btree (is_personal);
CREATE INDEX idx_client_contacts_client ON public.client_contacts USING btree (client_id);
CREATE INDEX idx_client_contacts_primary ON public.client_contacts USING btree (client_id, is_primary) WHERE (is_primary = true);
CREATE INDEX idx_interactions_client ON public.client_interactions USING btree (client_id);
CREATE INDEX idx_interactions_date ON public.client_interactions USING btree (interaction_date DESC);
CREATE INDEX idx_client_providers_client ON public.client_providers USING btree (client_id);
CREATE INDEX idx_clients_billing_mode ON public.clients USING btree (billing_mode) WHERE (client_type = 'organisme_formation'::text);
CREATE INDEX idx_clients_group_name ON public.clients USING btree (group_name) WHERE (group_name IS NOT NULL);
CREATE INDEX idx_clients_proprietaire ON public.clients USING btree (proprietaire);
CREATE INDEX idx_clients_sellsy ON public.clients USING btree (sellsy_id);
CREATE INDEX idx_clients_siren ON public.clients USING btree (siren) WHERE (siren IS NOT NULL);
CREATE INDEX idx_clients_siret ON public.clients USING btree (siret) WHERE (siret IS NOT NULL);
CREATE INDEX idx_clients_taille ON public.clients USING btree (taille_entreprise);
CREATE INDEX idx_completude_alerts_category ON public.completude_alerts USING btree (category);
CREATE INDEX idx_completude_alerts_priority ON public.completude_alerts USING btree (priority);
CREATE INDEX idx_completude_alerts_unresolved ON public.completude_alerts USING btree (resolved_at) WHERE (resolved_at IS NULL);
CREATE INDEX idx_document_downloads_document ON public.course_document_downloads USING btree (document_id);
CREATE INDEX idx_document_downloads_session ON public.course_document_downloads USING btree (session_id);
CREATE INDEX idx_document_downloads_trainee ON public.course_document_downloads USING btree (trainee_id);
CREATE INDEX idx_course_documents_course ON public.course_documents USING btree (course_id);
CREATE INDEX idx_course_documents_type ON public.course_documents USING btree (type);
CREATE INDEX idx_course_equipment_course ON public.course_equipment USING btree (course_id);
CREATE INDEX idx_course_questions_course ON public.course_questions USING btree (course_id);
CREATE INDEX idx_course_questions_position ON public.course_questions USING btree (course_id, "position");
CREATE INDEX idx_courses_sellsy_id ON public.courses USING btree (sellsy_id) WHERE (sellsy_id IS NOT NULL);
CREATE INDEX idx_courses_theme ON public.courses USING btree (theme_id);
CREATE INDEX idx_dwc_user_id ON public.dashboard_widget_configs USING btree (user_id);
CREATE INDEX idx_doc_sig_session ON public.document_signatures USING btree (session_id);
CREATE INDEX idx_doc_sig_session_type ON public.document_signatures USING btree (session_id, document_type);
CREATE INDEX idx_doc_sig_signed ON public.document_signatures USING btree (signed_at);
CREATE INDEX idx_doc_sig_trainee ON public.document_signatures USING btree (trainee_id);
CREATE INDEX idx_doc_sig_type ON public.document_signatures USING btree (document_type);
CREATE INDEX idx_duerp_actions_project ON public.duerp_actions USING btree (project_id);
CREATE INDEX idx_duerp_equip_project ON public.duerp_equipements USING btree (project_id);
CREATE INDEX idx_duerp_hab_expiry ON public.duerp_habilitations USING btree (expiry_date) WHERE (expiry_date IS NOT NULL);
CREATE INDEX idx_duerp_hab_project ON public.duerp_habilitations USING btree (project_id);
CREATE INDEX idx_duerp_projects_client ON public.duerp_projects USING btree (client_id);
CREATE INDEX idx_duerp_projects_status ON public.duerp_projects USING btree (status);
CREATE INDEX idx_duerp_risks_project ON public.duerp_risks USING btree (project_id);
CREATE INDEX idx_duerp_risks_unit ON public.duerp_risks USING btree (unit_id);
CREATE INDEX idx_duerp_units_project ON public.duerp_units USING btree (project_id);
CREATE INDEX idx_duerp_verif_project ON public.duerp_verifications USING btree (project_id);
CREATE INDEX idx_equipment_catalog_theme ON public.equipment_catalog USING btree (theme);
CREATE INDEX idx_invoice_items_invoice ON public.invoice_items USING btree (invoice_id);
CREATE INDEX idx_invoice_payments_invoice ON public.invoice_payments USING btree (invoice_id);
CREATE INDEX idx_invoice_relances_invoice_id ON public.invoice_relances USING btree (invoice_id);
CREATE INDEX idx_invoice_sessions_session ON public.invoice_sessions USING btree (session_id);
CREATE INDEX idx_invoices_client ON public.invoices USING btree (client_id);
CREATE INDEX idx_invoices_parent ON public.invoices USING btree (parent_invoice_id);
CREATE INDEX idx_invoices_parent_invoice_id ON public.invoices USING btree (parent_invoice_id);
CREATE INDEX idx_invoices_quote ON public.invoices USING btree (quote_id);
CREATE INDEX idx_invoices_sent_comptable ON public.invoices USING btree (sent_to_comptable) WHERE (sent_to_comptable = false);
CREATE INDEX idx_invoices_session ON public.invoices USING btree (session_id);
CREATE INDEX idx_invoices_status ON public.invoices USING btree (status);
CREATE INDEX idx_invoices_type ON public.invoices USING btree (type);
CREATE INDEX idx_mailing_campaigns_status ON public.mailing_campaigns USING btree (status);
CREATE INDEX idx_mailing_sends_campaign ON public.mailing_sends USING btree (campaign_id);
CREATE INDEX idx_mailing_sends_campaign_status ON public.mailing_sends USING btree (campaign_id, status);
CREATE UNIQUE INDEX idx_mailing_sends_dedup ON public.mailing_sends USING btree (campaign_id, email);
CREATE INDEX idx_mailing_sends_email_norm ON public.mailing_sends USING btree (lower(TRIM(BOTH FROM email)));
CREATE INDEX idx_mailing_sends_token ON public.mailing_sends USING btree (unsubscribe_token);
CREATE INDEX idx_nc_source ON public.non_conformites USING btree (source);
CREATE INDEX idx_nc_session ON public.non_conformities USING btree (session_id);
CREATE INDEX idx_nc_status ON public.non_conformities USING btree (status);
CREATE INDEX idx_notifications_created ON public.notifications USING btree (created_at DESC);
CREATE INDEX idx_notifications_unread ON public.notifications USING btree (read_at) WHERE (read_at IS NULL);
CREATE INDEX idx_process_connections_process_id ON public.process_connections USING btree (process_id);
CREATE INDEX idx_process_steps_process_id ON public.process_steps USING btree (process_id);
CREATE INDEX idx_process_versions_process_id ON public.process_versions USING btree (process_id);
CREATE INDEX idx_prog_versions_date ON public.programme_versions USING btree (date_maj DESC);
CREATE INDEX idx_prog_versions_ref ON public.programme_versions USING btree (ref_doc);
CREATE INDEX idx_prospect_calls_callback ON public.prospect_calls USING btree (needs_callback, callback_date) WHERE (needs_callback = true);
CREATE INDEX idx_prospect_calls_called_by ON public.prospect_calls USING btree (called_by);
CREATE INDEX idx_prospect_calls_client ON public.prospect_calls USING btree (client_id);
CREATE INDEX idx_prospect_calls_client_result ON public.prospect_calls USING btree (client_id, called_at DESC);
CREATE INDEX idx_prospect_calls_date ON public.prospect_calls USING btree (called_at DESC);
CREATE INDEX idx_prospect_calls_result ON public.prospect_calls USING btree (call_result);
CREATE INDEX idx_pel_client ON public.prospect_email_logs USING btree (client_id);
CREATE INDEX idx_pel_message_id ON public.prospect_email_logs USING btree (message_id) WHERE (message_id IS NOT NULL);
CREATE INDEX idx_pel_sent_at ON public.prospect_email_logs USING btree (sent_at);
CREATE INDEX idx_pel_siren ON public.prospect_email_logs USING btree (prospect_siren);
CREATE INDEX idx_prospect_analysis_client ON public.prospect_needs_analysis USING btree (client_id);
CREATE INDEX idx_prospect_analysis_rdv ON public.prospect_needs_analysis USING btree (rdv_id);
CREATE INDEX idx_prospect_rdv_client ON public.prospect_rdv USING btree (client_id);
CREATE INDEX idx_prospect_rdv_conducted_by ON public.prospect_rdv USING btree (conducted_by);
CREATE INDEX idx_prospect_rdv_date ON public.prospect_rdv USING btree (rdv_date);
CREATE INDEX idx_prospect_rdv_is_urgent ON public.prospect_rdv USING btree (is_urgent);
CREATE INDEX idx_prospect_rdv_next_action_date ON public.prospect_rdv USING btree (next_action_date) WHERE (next_action_date IS NOT NULL);
CREATE INDEX idx_prospect_rdv_quote_id ON public.prospect_rdv USING btree (quote_id);
CREATE INDEX idx_prospect_rdv_status ON public.prospect_rdv USING btree (status);
CREATE INDEX idx_prospect_rdv_temperature ON public.prospect_rdv USING btree (temperature);
CREATE INDEX idx_prospect_rdv_timeline ON public.prospect_rdv USING btree (timeline);
CREATE INDEX idx_pm_api_not_enriched ON public.prospection_massive USING btree (quality_score DESC) WHERE ((api_enriched_at IS NULL) AND (prospection_status IS DISTINCT FROM 'pas_interesse'::text));
CREATE INDEX idx_pm_dirigeant_nom ON public.prospection_massive USING btree (dirigeant_nom) WHERE (dirigeant_nom IS NOT NULL);
CREATE INDEX idx_pm_email ON public.prospection_massive USING btree (email) WHERE (email IS NOT NULL);
CREATE INDEX idx_pm_email_norm ON public.prospection_massive USING btree (lower(TRIM(BOTH FROM email))) WHERE (email IS NOT NULL);
CREATE INDEX idx_pm_hot_prospects ON public.prospection_massive USING btree (recrute_score DESC, quality_score DESC) WHERE ((recrute_score > 0) AND (prospection_status IS DISTINCT FROM 'pas_interesse'::text) AND (prospection_status IS DISTINCT FROM 'rdv_pris'::text));
CREATE INDEX idx_pm_recrute_score ON public.prospection_massive USING btree (recrute_score DESC) WHERE (recrute_score > 0);
CREATE INDEX idx_pm_site_web ON public.prospection_massive USING btree (site_web) WHERE (site_web IS NOT NULL);
CREATE INDEX idx_prospection_contacted ON public.prospection_massive USING btree (contacted);
CREATE INDEX idx_prospection_contacts ON public.prospection_massive USING btree (phone, email) WHERE ((phone IS NULL) OR (email IS NULL));
CREATE INDEX idx_prospection_departement ON public.prospection_massive USING btree (departement);
CREATE INDEX idx_prospection_dept_effectif ON public.prospection_massive USING btree (departement, effectif);
CREATE INDEX idx_prospection_effectif ON public.prospection_massive USING btree (effectif);
CREATE INDEX idx_prospection_enrichment_status ON public.prospection_massive USING btree (enrichment_status) WHERE (enrichment_status = ANY (ARRAY['pending'::text, 'failed'::text]));
CREATE INDEX idx_prospection_gere_par ON public.prospection_massive USING btree (gere_par_id) WHERE (gere_par_id IS NOT NULL);
CREATE INDEX idx_prospection_quality ON public.prospection_massive USING btree (quality_score DESC);
CREATE INDEX idx_prospection_siren ON public.prospection_massive USING btree (siren);
CREATE INDEX idx_prospection_siret ON public.prospection_massive USING btree (siret);
CREATE INDEX idx_prospection_status ON public.prospection_massive USING btree (prospection_status);
CREATE INDEX idx_psh_client ON public.psh_requests USING btree (client_id);
CREATE INDEX idx_psh_session ON public.psh_requests USING btree (session_id);
CREATE INDEX idx_psh_status ON public.psh_requests USING btree (status);
CREATE INDEX idx_psh_trainee ON public.psh_requests USING btree (trainee_id);
CREATE INDEX idx_qualiopi_documents_type ON public.qualiopi_documents USING btree (type);
CREATE INDEX idx_quality_alerts_created ON public.quality_alerts USING btree (created_at DESC);
CREATE INDEX idx_quality_alerts_session ON public.quality_alerts USING btree (session_id);
CREATE INDEX idx_quality_alerts_status ON public.quality_alerts USING btree (status);
CREATE INDEX idx_quality_documents_code ON public.quality_documents USING btree (code);
CREATE INDEX idx_quality_documents_doc_id ON public.quality_documents USING btree (doc_id);
CREATE INDEX idx_quote_items_quote ON public.quote_items USING btree (quote_id);
CREATE INDEX idx_quotes_client ON public.quotes USING btree (client_id);
CREATE INDEX idx_quotes_date ON public.quotes USING btree (quote_date DESC);
CREATE INDEX idx_quotes_status ON public.quotes USING btree (status);
CREATE INDEX idx_quotes_status_followup ON public.quotes USING btree (status, followup_state);
CREATE INDEX idx_rdv_emails_rdv_id ON public.rdv_emails_sent USING btree (rdv_id);
CREATE INDEX idx_rdv_emails_sent_at ON public.rdv_emails_sent USING btree (sent_at DESC);
CREATE INDEX idx_rdv_emails_status ON public.rdv_emails_sent USING btree (status);
CREATE INDEX idx_reclamations_date ON public.reclamations USING btree (date_reception);
CREATE INDEX idx_reclamations_status ON public.reclamations USING btree (status);
CREATE INDEX idx_session_checklists_checked ON public.session_checklists USING btree (is_checked);
CREATE INDEX idx_session_checklists_session ON public.session_checklists USING btree (session_id);
CREATE INDEX idx_session_costs_session ON public.session_costs USING btree (session_id);
CREATE INDEX idx_session_document_access_document ON public.session_document_access USING btree (document_id);
CREATE INDEX idx_session_document_access_session ON public.session_document_access USING btree (session_id);
CREATE INDEX idx_session_emails_created ON public.session_emails_sent USING btree (created_at DESC);
CREATE INDEX idx_session_emails_session ON public.session_emails_sent USING btree (session_id);
CREATE INDEX idx_session_emails_type ON public.session_emails_sent USING btree (email_type);
CREATE INDEX idx_session_equipment_session ON public.session_equipment USING btree (session_id);
CREATE INDEX idx_session_fundings_invoice ON public.session_fundings USING btree (invoice_id);
CREATE INDEX idx_session_fundings_session ON public.session_fundings USING btree (session_id);
CREATE INDEX idx_session_fundings_status ON public.session_fundings USING btree (status);
CREATE INDEX idx_session_groups_client ON public.session_groups USING btree (client_id);
CREATE INDEX idx_session_groups_payment ON public.session_groups USING btree (payment_status);
CREATE INDEX idx_session_groups_session ON public.session_groups USING btree (session_id);
CREATE INDEX idx_session_groups_status ON public.session_groups USING btree (status);
CREATE INDEX idx_needs_analysis_session ON public.session_needs_analysis USING btree (session_id);
CREATE INDEX idx_session_qualiopi_session ON public.session_qualiopi USING btree (session_id);
CREATE INDEX idx_session_trainees_access_code ON public.session_trainees USING btree (access_code) WHERE (access_code IS NOT NULL);
CREATE UNIQUE INDEX idx_session_trainees_access_code_unique ON public.session_trainees USING btree (session_id, access_code) WHERE (access_code IS NOT NULL);
CREATE INDEX idx_session_trainees_convocation ON public.session_trainees USING btree (convocation_sent_at);
CREATE INDEX idx_session_trainees_early_departure ON public.session_trainees USING btree (early_departure) WHERE (early_departure = true);
CREATE INDEX idx_session_trainees_funding ON public.session_trainees USING btree (funding_type);
CREATE INDEX idx_session_trainees_group ON public.session_trainees USING btree (group_id);
CREATE INDEX idx_session_trainees_observation ON public.session_trainees USING btree (session_id, trainee_id) WHERE (admin_observation IS NOT NULL);
CREATE INDEX idx_session_trainees_session ON public.session_trainees USING btree (session_id);
CREATE INDEX idx_session_trainees_situation ON public.session_trainees USING btree (situation);
CREATE INDEX idx_session_trainees_status ON public.session_trainees USING btree (trainee_status);
CREATE UNIQUE INDEX idx_st_session_code_unique ON public.session_trainees USING btree (session_id, access_code) WHERE (access_code IS NOT NULL);
CREATE INDEX idx_st_session_earlydep_true ON public.session_trainees USING btree (session_id) WHERE (early_departure = true);
CREATE INDEX idx_sessions_client ON public.sessions USING btree (client_id);
CREATE INDEX idx_sessions_course ON public.sessions USING btree (course_id);
CREATE INDEX idx_sessions_dates ON public.sessions USING btree (start_date, end_date);
CREATE INDEX idx_sessions_inter_group ON public.sessions USING btree (inter_group_id) WHERE (inter_group_id IS NOT NULL);
CREATE INDEX idx_sessions_public ON public.sessions USING btree (is_public) WHERE (is_public = true);
CREATE INDEX idx_sessions_quote ON public.sessions USING btree (quote_id);
CREATE INDEX idx_sessions_session_type ON public.sessions USING btree (session_type);
CREATE INDEX idx_sessions_status ON public.sessions USING btree (status);
CREATE INDEX idx_sessions_subcontract_period ON public.sessions USING btree (session_type, client_id, start_date) WHERE (session_type = 'subcontract'::text);
CREATE INDEX idx_sessions_subcontract_uninvoiced ON public.sessions USING btree (session_type, subcontract_invoiced, client_id) WHERE ((session_type = 'subcontract'::text) AND (subcontract_invoiced = false));
CREATE INDEX idx_sessions_trainer ON public.sessions USING btree (trainer_id);
CREATE INDEX idx_sessions_type ON public.sessions USING btree (session_type);
CREATE INDEX idx_social_media_tags ON public.social_media_library USING gin (tags);
CREATE INDEX idx_social_posts_scheduled ON public.social_posts USING btree (scheduled_at);
CREATE INDEX idx_social_posts_status ON public.social_posts USING btree (status);
CREATE INDEX idx_sst_certifications_formateur ON public.sst_certifications USING btree (formateur_id);
CREATE INDEX idx_sst_certifications_session ON public.sst_certifications USING btree (session_id);
CREATE INDEX idx_sst_certifications_trainee ON public.sst_certifications USING btree (trainee_id);
CREATE INDEX idx_sst_certifications_type ON public.sst_certifications USING btree (formation_type);
CREATE INDEX idx_theme_questions_theme ON public.theme_questions USING btree (theme_id);
CREATE INDEX idx_trainee_evaluations_session ON public.trainee_evaluations USING btree (session_id);
CREATE INDEX idx_positioning_tests_session ON public.trainee_positioning_tests USING btree (session_id);
CREATE INDEX idx_positioning_tests_trainee ON public.trainee_positioning_tests USING btree (trainee_id);
CREATE INDEX idx_trainees_client ON public.trainees USING btree (client_id);
CREATE INDEX idx_trainer_certificates_expiry ON public.trainer_certificates USING btree (expiry_date);
CREATE INDEX idx_trainer_certificates_trainer ON public.trainer_certificates USING btree (trainer_id);
CREATE INDEX idx_trainer_interviews_date ON public.trainer_interviews USING btree (interview_date DESC);
CREATE INDEX idx_trainer_interviews_trainer_id ON public.trainer_interviews USING btree (trainer_id);
CREATE INDEX idx_trainer_trainings_date ON public.trainer_trainings USING btree (training_date DESC);
CREATE INDEX idx_trainer_trainings_trainer_id ON public.trainer_trainings USING btree (trainer_id);
CREATE INDEX idx_uploaded_docs_session ON public.uploaded_documents USING btree (session_id);
CREATE INDEX idx_user_email_configs_user_id ON public.user_email_configs USING btree (user_id);
CREATE INDEX idx_planning_events_date_range ON public.user_planning_events USING btree (event_date, start_time);
CREATE INDEX idx_planning_events_google_id ON public.user_planning_events USING btree (google_event_id) WHERE (google_event_id IS NOT NULL);
CREATE INDEX idx_planning_events_linked_entity ON public.user_planning_events USING btree (linked_entity_type, linked_entity_id) WHERE (linked_entity_id IS NOT NULL);
CREATE INDEX idx_planning_events_user_date ON public.user_planning_events USING btree (user_id, event_date);
CREATE INDEX idx_veille_date ON public.veille_qualiopi USING btree (date DESC);
CREATE INDEX idx_veille_statut ON public.veille_qualiopi USING btree (statut);
CREATE INDEX idx_veille_type ON public.veille_qualiopi USING btree (type);

-- Fonctions
--FN-- admin_logout_user
CREATE OR REPLACE FUNCTION public.admin_logout_user(user_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
DECLARE
  target_user_id UUID;
BEGIN
  -- Trouver l'utilisateur
  SELECT id INTO target_user_id 
  FROM auth.users 
  WHERE email = user_email;
  
  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non trouvé';
  END IF;
  
  -- Supprimer ses sessions (le déconnecte)
  DELETE FROM auth.sessions 
  WHERE user_id = target_user_id;
END;
$function$;

--FN-- admin_regenerate_access_code
CREATE OR REPLACE FUNCTION public.admin_regenerate_access_code(p_session_trainee_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_new_code VARCHAR(6);
BEGIN
    v_new_code := generate_access_code();
    
    UPDATE session_trainees
    SET access_code = v_new_code,
        code_generated_at = NOW(),
        access_code_attempts = 0,
        access_code_locked = false,
        access_code_locked_at = NULL
    WHERE id = p_session_trainee_id;
    
    RETURN json_build_object('success', true, 'code', v_new_code);
EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$function$;

--FN-- auto_activate_client_on_invoice
CREATE OR REPLACE FUNCTION public.auto_activate_client_on_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_client_id uuid;
  v_current_status text;
BEGIN
  v_client_id := NEW.client_id;
  IF v_client_id IS NULL THEN RETURN NEW; END IF;
  SELECT status INTO v_current_status FROM clients WHERE id = v_client_id;
  IF v_current_status IN ('prospect', 'en_discussion', 'a_completer') THEN
    UPDATE clients SET status = 'actif', updated_at = NOW() WHERE id = v_client_id;
  END IF;
  RETURN NEW;
END;
$function$;

--FN-- auto_activate_client_on_session
CREATE OR REPLACE FUNCTION public.auto_activate_client_on_session()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_current_status text;
BEGIN
  IF NEW.client_id IS NULL THEN RETURN NEW; END IF;
  SELECT status INTO v_current_status FROM clients WHERE id = NEW.client_id;
  IF v_current_status IN ('prospect', 'en_discussion', 'a_completer') THEN
    UPDATE clients SET status = 'actif', updated_at = NOW() WHERE id = NEW.client_id;
  END IF;
  RETURN NEW;
END;
$function$;

--FN-- auto_create_info_sheet
CREATE OR REPLACE FUNCTION public.auto_create_info_sheet()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    INSERT INTO trainee_info_sheets (
        session_id,
        trainee_id,
        email,
        job_title,
        csp,
        ssn,
        ssn_refused,
        rgpd_consent,
        filled_at,
        filled_online
    )
    SELECT 
        NEW.session_id,
        NEW.trainee_id,
        t.email,
        t.job_title,
        t.csp,
        t.social_security_number,
        t.refused_ssn,
        false,
        NULL,
        false
    FROM trainees t
    WHERE t.id = NEW.trainee_id
    ON CONFLICT (trainee_id, session_id) DO NOTHING;
    
    RETURN NEW;
END;
$function$;

--FN-- auto_mark_gere_par
CREATE OR REPLACE FUNCTION public.auto_mark_gere_par()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  central_id UUID;
  central_city TEXT;
BEGIN
  -- Seulement pour les INSERT (nouveaux prospects importés)
  -- et seulement si le nouveau prospect n'a pas déjà un gere_par
  IF NEW.gere_par_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Chercher un frère du même SIREN qui a un gere_par_id
  SELECT gere_par_id, gere_par_city 
  INTO central_id, central_city
  FROM prospection_massive
  WHERE siren = NEW.siren 
    AND gere_par_id IS NOT NULL
    AND id != NEW.id
  LIMIT 1;

  -- Si trouvé, marquer le nouveau prospect comme "géré par" aussi
  IF central_id IS NOT NULL THEN
    NEW.gere_par_id := central_id;
    NEW.gere_par_city := central_city;
    NEW.gere_par_at := NOW();
    NEW.prospection_status := 'redirige';
    NEW.prospection_notes := 'Auto-redirigé vers ' || central_city || ' (import)';
    NEW.contacted := TRUE;
    NEW.contacted_at := NOW();
  END IF;

  RETURN NEW;
END;
$function$;

--FN-- auto_validate_sst_certification
CREATE OR REPLACE FUNCTION public.auto_validate_sst_certification()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  competences_acquises INTEGER;
  competences_requises INTEGER;
BEGIN
  -- Compter les compétences acquises
  IF NEW.formation_type = 'FI' THEN
    -- Formation Initiale : 8 compétences (C1 à C8)
    competences_requises := 8;
    competences_acquises := 
      COALESCE((NEW.c1_acquis)::INTEGER, 0) +
      COALESCE((NEW.c2_acquis)::INTEGER, 0) +
      COALESCE((NEW.c3_acquis)::INTEGER, 0) +
      COALESCE((NEW.c4_acquis)::INTEGER, 0) +
      COALESCE((NEW.c5_acquis)::INTEGER, 0) +
      COALESCE((NEW.c6_acquis)::INTEGER, 0) +
      COALESCE((NEW.c7_acquis)::INTEGER, 0) +
      COALESCE((NEW.c8_acquis)::INTEGER, 0);
  ELSE
    -- MAC : 7 compétences (C2 à C8, pas de C1)
    competences_requises := 7;
    competences_acquises := 
      COALESCE((NEW.c2_acquis)::INTEGER, 0) +
      COALESCE((NEW.c3_acquis)::INTEGER, 0) +
      COALESCE((NEW.c4_acquis)::INTEGER, 0) +
      COALESCE((NEW.c5_acquis)::INTEGER, 0) +
      COALESCE((NEW.c6_acquis)::INTEGER, 0) +
      COALESCE((NEW.c7_acquis)::INTEGER, 0) +
      COALESCE((NEW.c8_acquis)::INTEGER, 0);
  END IF;
  
  -- Validation automatique si toutes les compétences sont acquises
  IF competences_acquises >= competences_requises THEN
    NEW.candidat_certifie := TRUE;
  ELSE
    NEW.candidat_certifie := FALSE;
  END IF;
  
  RETURN NEW;
END;
$function$;

--FN-- check_siren_exists
CREATE OR REPLACE FUNCTION public.check_siren_exists(p_siren text)
 RETURNS TABLE(id uuid, name text, city text, siret text, status text, is_decisionnaire boolean, sessions_count bigint, invoices_count bigint)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT 
    c.id,
    c.name::text,
    c.city::text,
    c.siret::text,
    c.status::text,
    c.is_decisionnaire,
    COUNT(DISTINCT s.id) AS sessions_count,
    COUNT(DISTINCT i.id) AS invoices_count
  FROM clients c
  LEFT JOIN sessions s ON s.client_id = c.id
  LEFT JOIN invoices i ON i.client_id = c.id
  WHERE c.siren = p_siren
    AND c.status != 'archive'
  GROUP BY c.id, c.name, c.city, c.siret, c.status, c.is_decisionnaire
  ORDER BY c.is_decisionnaire DESC, sessions_count DESC, c.created_at ASC;
$function$;

--FN-- compute_commission_end_date
CREATE OR REPLACE FUNCTION public.compute_commission_end_date()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.commission_start_date IS NOT NULL THEN
    NEW.commission_end_date := NEW.commission_start_date + INTERVAL '1 year';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

--FN-- cron_call_vercel
CREATE OR REPLACE FUNCTION public.cron_call_vercel(p_path text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_secret text;
  v_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'cron_secret';

  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'Clé cron_secret absente du coffre-fort Supabase';
  END IF;

  SELECT net.http_get(
    url := 'https://app.accessformation.pro' || p_path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 60000
  ) INTO v_id;

  RETURN v_id;
END;
$function$;

--FN-- decrypt_ssn
CREATE OR REPLACE FUNCTION public.decrypt_ssn(encrypted_ssn bytea)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  encryption_key TEXT;
BEGIN
  IF encrypted_ssn IS NULL THEN
    RETURN NULL;
  END IF;
  
  SELECT key_value INTO encryption_key FROM _encryption_keys WHERE id = 'ssn_key';
  
  RETURN pgp_sym_decrypt(encrypted_ssn, encryption_key);
END;
$function$;

--FN-- detect_client_links
CREATE OR REPLACE FUNCTION public.detect_client_links(p_client_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_client RECORD;
  v_siren TEXT;
  v_domain TEXT;
  v_dirigeant_nom TEXT;
  v_group_name TEXT;
  v_result JSON;
BEGIN
  SELECT id, name, siren, siret, contact_name, contact_email, website, group_name
  INTO v_client
  FROM clients
  WHERE id = p_client_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Client not found');
  END IF;

  v_siren := COALESCE(v_client.siren, LEFT(v_client.siret, 9));
  
  v_domain := NULL;
  IF v_client.website IS NOT NULL AND v_client.website != '' THEN
    v_domain := regexp_replace(
      regexp_replace(v_client.website, '^https?://(www\.)?', ''),
      '/.*$', ''
    );
    v_domain := trim(BOTH '.' FROM trim(BOTH '/' FROM v_domain));
  END IF;
  IF v_domain IS NULL AND v_client.contact_email IS NOT NULL AND v_client.contact_email LIKE '%@%' THEN
    v_domain := split_part(v_client.contact_email, '@', 2);
    IF v_domain IN ('gmail.com','yahoo.fr','hotmail.com','hotmail.fr','outlook.com','outlook.fr','orange.fr','free.fr','sfr.fr','wanadoo.fr','laposte.net','live.fr','aol.com','icloud.com','protonmail.com') THEN
      v_domain := NULL;
    END IF;
  END IF;

  v_dirigeant_nom := NULL;
  IF v_client.contact_name IS NOT NULL AND length(trim(v_client.contact_name)) > 2 THEN
    v_dirigeant_nom := upper(trim(split_part(trim(v_client.contact_name), ' ', 
      array_length(string_to_array(trim(v_client.contact_name), ' '), 1)
    )));
    IF length(v_dirigeant_nom) < 3 THEN v_dirigeant_nom := NULL; END IF;
  END IF;

  v_group_name := v_client.group_name;

  SELECT json_build_object(
    'client_siren', v_siren,
    'client_domain', v_domain,
    'client_dirigeant', v_dirigeant_nom,
    'client_group', v_group_name,
    
    -- 1. SIREN
    'siren_matches', COALESCE((
      SELECT json_agg(row_to_json(sub))
      FROM (
        SELECT id, name, siret, siren, city, postal_code, phone, email, site_web,
               dirigeant_nom, dirigeant_prenom, prospection_status, contacted, quality_score
        FROM prospection_massive
        WHERE v_siren IS NOT NULL AND siren = v_siren
          AND prospection_status IS DISTINCT FROM 'deja_client'
        ORDER BY quality_score DESC LIMIT 20
      ) sub
    ), '[]'::json),

    -- 2. DOMAINE
    'domain_matches', COALESCE((
      SELECT json_agg(row_to_json(sub))
      FROM (
        SELECT id, name, siret, siren, city, postal_code, phone, email, site_web,
               dirigeant_nom, dirigeant_prenom, prospection_status, contacted, quality_score
        FROM prospection_massive
        WHERE v_domain IS NOT NULL
          AND (v_siren IS NULL OR siren IS DISTINCT FROM v_siren)
          AND prospection_status IS DISTINCT FROM 'deja_client'
          AND (site_web ILIKE '%' || v_domain || '%' OR email ILIKE '%@' || v_domain)
        ORDER BY quality_score DESC LIMIT 20
      ) sub
    ), '[]'::json),

    -- 3. DIRIGEANT
    'dirigeant_matches', COALESCE((
      SELECT json_agg(row_to_json(sub))
      FROM (
        SELECT id, name, siret, siren, city, postal_code, phone, email, site_web,
               dirigeant_nom, dirigeant_prenom, prospection_status, contacted, quality_score
        FROM prospection_massive
        WHERE v_dirigeant_nom IS NOT NULL
          AND (v_siren IS NULL OR siren IS DISTINCT FROM v_siren)
          AND prospection_status IS DISTINCT FROM 'deja_client'
          AND upper(dirigeant_nom) = v_dirigeant_nom
        ORDER BY quality_score DESC LIMIT 20
      ) sub
    ), '[]'::json),

    -- 4. GROUPE (autres clients même group_name)
    'group_clients', COALESCE((
      SELECT json_agg(row_to_json(sub))
      FROM (
        SELECT id, name, siren, siret, city, status, group_name
        FROM clients
        WHERE v_group_name IS NOT NULL AND group_name = v_group_name AND id != p_client_id
        ORDER BY name LIMIT 20
      ) sub
    ), '[]'::json),

    -- 5. NOM GROUPE (prospects dont le nom contient group_name)
    'group_prospect_matches', COALESCE((
      SELECT json_agg(row_to_json(sub))
      FROM (
        SELECT DISTINCT ON (siren) id, name, siret, siren, city, postal_code, phone, email, site_web,
               dirigeant_nom, dirigeant_prenom, prospection_status, contacted, quality_score
        FROM prospection_massive
        WHERE v_group_name IS NOT NULL
          AND length(v_group_name) >= 4
          AND name ILIKE '%' || v_group_name || '%'
          AND (v_siren IS NULL OR siren IS DISTINCT FROM v_siren)
          AND prospection_status IS DISTINCT FROM 'deja_client'
        ORDER BY siren, quality_score DESC
        LIMIT 30
      ) sub
    ), '[]'::json)
    
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

--FN-- detect_completude_blockers
CREATE OR REPLACE FUNCTION public.detect_completude_blockers()
 RETURNS TABLE(new_blockers_count integer, new_notifications_count integer, previous_count integer, current_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_new_blockers INTEGER := 0;
    v_new_notifications INTEGER := 0;
    v_row_count INTEGER;
    v_previous_count INTEGER;
    v_current_blocker_count INTEGER;
BEGIN
    -- ========================================
    -- STAGIAIRES : Numéro SS manquant (BLOQUANT)
    -- ========================================
    INSERT INTO completude_alerts (category, element, detail, priority, entity_id, link)
    SELECT 
        'stagiaires',
        t.first_name || ' ' || t.last_name,
        'Numéro SS manquant',
        'bloquant',
        t.id,
        '/stagiaires/' || t.id
    FROM trainees t
    WHERE (t.refused_ssn = false OR t.refused_ssn IS NULL)
    AND (t.social_security_number IS NULL OR t.social_security_number = '')
    AND NOT EXISTS (
        SELECT 1 FROM completude_alerts ca 
        WHERE ca.category = 'stagiaires' 
        AND ca.entity_id = t.id 
        AND ca.detail = 'Numéro SS manquant' 
        AND ca.resolved_at IS NULL
    );
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    v_new_blockers := v_new_blockers + v_row_count;
    
    -- ========================================
    -- STAGIAIRES : Date de naissance manquante (IMPORTANT)
    -- ========================================
    INSERT INTO completude_alerts (category, element, detail, priority, entity_id, link)
    SELECT 
        'stagiaires',
        t.first_name || ' ' || t.last_name,
        'Date de naissance manquante',
        'important',
        t.id,
        '/stagiaires/' || t.id
    FROM trainees t
    WHERE t.birth_date IS NULL
    AND NOT EXISTS (
        SELECT 1 FROM completude_alerts ca 
        WHERE ca.category = 'stagiaires' 
        AND ca.entity_id = t.id 
        AND ca.detail = 'Date de naissance manquante' 
        AND ca.resolved_at IS NULL
    );
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    v_new_blockers := v_new_blockers + v_row_count;
    
    -- ========================================
    -- STAGIAIRES : CSP manquante (IMPORTANT)
    -- ========================================
    INSERT INTO completude_alerts (category, element, detail, priority, entity_id, link)
    SELECT 
        'stagiaires',
        t.first_name || ' ' || t.last_name,
        'CSP manquante',
        'important',
        t.id,
        '/stagiaires/' || t.id
    FROM trainees t
    WHERE (t.csp IS NULL OR t.csp = '')
    AND NOT EXISTS (
        SELECT 1 FROM completude_alerts ca 
        WHERE ca.category = 'stagiaires' 
        AND ca.entity_id = t.id 
        AND ca.detail = 'CSP manquante' 
        AND ca.resolved_at IS NULL
    );
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    v_new_blockers := v_new_blockers + v_row_count;
    
    -- ========================================
    -- STAGIAIRES : Genre manquant (IMPORTANT)
    -- ========================================
    INSERT INTO completude_alerts (category, element, detail, priority, entity_id, link)
    SELECT 
        'stagiaires',
        t.first_name || ' ' || t.last_name,
        'Genre manquant',
        'important',
        t.id,
        '/stagiaires/' || t.id
    FROM trainees t
    WHERE (t.gender IS NULL OR t.gender = '')
    AND NOT EXISTS (
        SELECT 1 FROM completude_alerts ca 
        WHERE ca.category = 'stagiaires' 
        AND ca.entity_id = t.id 
        AND ca.detail = 'Genre manquant' 
        AND ca.resolved_at IS NULL
    );
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    v_new_blockers := v_new_blockers + v_row_count;
    
    -- ========================================
    -- SESSIONS : Convention non envoyée (BLOQUANT)
    -- ========================================
    INSERT INTO completude_alerts (category, element, detail, priority, entity_id, link)
    SELECT 
        'sessions',
        s.reference,
        'Convention non envoyée',
        'bloquant',
        s.id,
        '/sessions/' || s.id
    FROM sessions s
    WHERE s.status = 'completed'
    AND (s.convention_sent = false OR s.convention_sent IS NULL)
    AND NOT EXISTS (
        SELECT 1 FROM completude_alerts ca 
        WHERE ca.category = 'sessions' 
        AND ca.entity_id = s.id 
        AND ca.detail = 'Convention non envoyée' 
        AND ca.resolved_at IS NULL
    );
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    v_new_blockers := v_new_blockers + v_row_count;
    
    -- ========================================
    -- SESSIONS : Convention non signée (BLOQUANT)
    -- ========================================
    INSERT INTO completude_alerts (category, element, detail, priority, entity_id, link)
    SELECT 
        'sessions',
        s.reference,
        'Convention non signée',
        'bloquant',
        s.id,
        '/sessions/' || s.id
    FROM sessions s
    WHERE s.status = 'completed'
    AND s.convention_sent = true
    AND (s.convention_signed = false OR s.convention_signed IS NULL)
    AND NOT EXISTS (
        SELECT 1 FROM completude_alerts ca 
        WHERE ca.category = 'sessions' 
        AND ca.entity_id = s.id 
        AND ca.detail = 'Convention non signée' 
        AND ca.resolved_at IS NULL
    );
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    v_new_blockers := v_new_blockers + v_row_count;
    
    -- ========================================
    -- RÉCLAMATIONS : Non clôturées >5 jours (BLOQUANT)
    -- ========================================
    INSERT INTO completude_alerts (category, element, detail, priority, entity_id, link)
    SELECT 
        'qualite',
        nc.title,
        'Réclamation non clôturée (>' || EXTRACT(DAY FROM NOW() - nc.created_at) || ' jours)',
        'bloquant',
        nc.id,
        '/non-conformites'
    FROM non_conformites nc
    WHERE nc.source = 'reclamation'
    AND nc.status IN ('open', 'analyse', 'action')
    AND nc.created_at < NOW() - INTERVAL '5 days'
    AND NOT EXISTS (
        SELECT 1 FROM completude_alerts ca 
        WHERE ca.category = 'qualite' 
        AND ca.entity_id = nc.id 
        AND ca.detail LIKE 'Réclamation non clôturée%' 
        AND ca.resolved_at IS NULL
    );
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    v_new_blockers := v_new_blockers + v_row_count;
    
    -- ========================================
    -- RÉSOLUTION AUTOMATIQUE
    -- ========================================
    
    UPDATE completude_alerts ca SET resolved_at = NOW()
    WHERE ca.category = 'stagiaires' 
    AND ca.detail = 'Numéro SS manquant' 
    AND ca.resolved_at IS NULL
    AND EXISTS (
        SELECT 1 FROM trainees t 
        WHERE t.id = ca.entity_id 
        AND (
            (t.social_security_number IS NOT NULL AND t.social_security_number != '')
            OR t.refused_ssn = true
        )
    );
    
    UPDATE completude_alerts ca SET resolved_at = NOW()
    WHERE ca.category = 'stagiaires' 
    AND ca.detail = 'Date de naissance manquante' 
    AND ca.resolved_at IS NULL
    AND EXISTS (
        SELECT 1 FROM trainees t 
        WHERE t.id = ca.entity_id 
        AND t.birth_date IS NOT NULL
    );
    
    UPDATE completude_alerts ca SET resolved_at = NOW()
    WHERE ca.category = 'stagiaires' 
    AND ca.detail = 'CSP manquante' 
    AND ca.resolved_at IS NULL
    AND EXISTS (
        SELECT 1 FROM trainees t 
        WHERE t.id = ca.entity_id 
        AND t.csp IS NOT NULL
        AND t.csp != ''
    );
    
    UPDATE completude_alerts ca SET resolved_at = NOW()
    WHERE ca.category = 'stagiaires' 
    AND ca.detail = 'Genre manquant' 
    AND ca.resolved_at IS NULL
    AND EXISTS (
        SELECT 1 FROM trainees t 
        WHERE t.id = ca.entity_id 
        AND t.gender IS NOT NULL
        AND t.gender != ''
    );
    
    UPDATE completude_alerts ca SET resolved_at = NOW()
    WHERE ca.category = 'sessions' 
    AND ca.detail = 'Convention non envoyée' 
    AND ca.resolved_at IS NULL
    AND EXISTS (
        SELECT 1 FROM sessions s 
        WHERE s.id = ca.entity_id 
        AND s.convention_sent = true
    );
    
    UPDATE completude_alerts ca SET resolved_at = NOW()
    WHERE ca.category = 'sessions' 
    AND ca.detail = 'Convention non signée' 
    AND ca.resolved_at IS NULL
    AND EXISTS (
        SELECT 1 FROM sessions s 
        WHERE s.id = ca.entity_id 
        AND s.convention_signed = true
    );
    
    UPDATE completude_alerts ca SET resolved_at = NOW()
    WHERE ca.category = 'qualite' 
    AND ca.detail LIKE 'Réclamation non clôturée%' 
    AND ca.resolved_at IS NULL
    AND EXISTS (
        SELECT 1 FROM non_conformites nc 
        WHERE nc.id = ca.entity_id 
        AND nc.status = 'closed'
    );
    
    -- ========================================
    -- LOGIQUE INCRÉMENTALE : CRÉER NOTIFICATION UNIQUEMENT SI AUGMENTATION
    -- ========================================
    
    -- Récupérer le dernier comptage
    SELECT last_blocker_count INTO v_previous_count
    FROM completude_tracking
    WHERE id = 1;
    
    -- Compter les bloquants actuels (toutes priorités confondues)
    SELECT COUNT(*) INTO v_current_blocker_count
    FROM completude_alerts
    WHERE resolved_at IS NULL;
    
    -- SI le nombre a AUGMENTÉ → Créer notification
    IF v_current_blocker_count > v_previous_count THEN
        
        -- Supprimer l'ancienne notification
        DELETE FROM notifications 
        WHERE type = 'completude' 
        AND metadata->>'category' = 'completude_global';
        
        -- Créer la nouvelle notification
        WITH blocker_stats AS (
            SELECT 
                COUNT(*) FILTER (WHERE category = 'sessions') as sessions_count,
                COUNT(*) FILTER (WHERE category = 'stagiaires') as stagiaires_count,
                COUNT(*) FILTER (WHERE category = 'qualite') as qualite_count,
                COUNT(*) as total_count,
                CASE 
                    WHEN COUNT(*) FILTER (WHERE priority = 'bloquant') > 0 THEN 'bloquant'
                    WHEN COUNT(*) FILTER (WHERE priority = 'important') > 0 THEN 'important'
                    WHEN COUNT(*) FILTER (WHERE priority = 'mineur') > 0 THEN 'mineur'
                    ELSE 'mineur'
                END as highest_priority
            FROM completude_alerts
            WHERE resolved_at IS NULL
        )
        INSERT INTO notifications (type, title, message, link, metadata)
        SELECT 
            'completude',
            'Complétude à mettre à jour',
            CASE 
                WHEN sessions_count > 0 AND stagiaires_count > 0 AND qualite_count > 0 THEN 
                    sessions_count || ' sessions, ' || stagiaires_count || ' stagiaires, ' || qualite_count || ' réclamations'
                WHEN sessions_count > 0 AND stagiaires_count > 0 THEN 
                    sessions_count || ' sessions, ' || stagiaires_count || ' stagiaires'
                WHEN sessions_count > 0 AND qualite_count > 0 THEN 
                    sessions_count || ' sessions, ' || qualite_count || ' réclamations'
                WHEN stagiaires_count > 0 AND qualite_count > 0 THEN 
                    stagiaires_count || ' stagiaires, ' || qualite_count || ' réclamations'
                WHEN sessions_count > 0 THEN sessions_count || ' sessions'
                WHEN stagiaires_count > 0 THEN stagiaires_count || ' stagiaires'
                WHEN qualite_count > 0 THEN qualite_count || ' réclamations'
                ELSE 'Vérifiez la page Complétude'
            END,
            '/qualite/completude',
            jsonb_build_object(
                'category', 'completude_global',
                'priority', highest_priority,
                'sessions', sessions_count,
                'stagiaires', stagiaires_count,
                'qualite', qualite_count,
                'total', total_count,
                'previous_count', v_previous_count,
                'delta', total_count - v_previous_count
            )
        FROM blocker_stats
        WHERE total_count > 0;
        
        GET DIAGNOSTICS v_new_notifications = ROW_COUNT;
    END IF;
    
    -- Mettre à jour le tracking
    UPDATE completude_tracking
    SET last_blocker_count = v_current_blocker_count,
        last_check_at = NOW()
    WHERE id = 1;
    
    RETURN QUERY SELECT v_new_blockers, v_new_notifications, v_previous_count, v_current_blocker_count;
END;
$function$;

--FN-- export_trainee_data
CREATE OR REPLACE FUNCTION public.export_trainee_data(p_trainee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
  v_trainee JSONB;
  v_sessions JSONB;
  v_attendances JSONB;
  v_evaluations JSONB;
  v_documents JSONB;
BEGIN
  -- Données personnelles du stagiaire
  SELECT jsonb_build_object(
    'id', t.id,
    'first_name', t.first_name,
    'last_name', t.last_name,
    'email', t.email,
    'phone', t.phone,
    'birth_date', t.birth_date,
    'social_security_number', COALESCE(decrypt_ssn(t.ssn_encrypted), t.social_security_number),
    'has_disability', t.has_disability,
    'disability_details', t.disability_details,
    'disability_adaptations', t.disability_adaptations,
    'notes', t.notes,
    'created_at', t.created_at,
    'client', (SELECT jsonb_build_object('id', c.id, 'name', c.name) FROM clients c WHERE c.id = t.client_id)
  )
  INTO v_trainee
  FROM trainees t
  WHERE t.id = p_trainee_id;
  
  IF v_trainee IS NULL THEN
    RETURN jsonb_build_object('error', 'Stagiaire non trouvé');
  END IF;
  
  -- Sessions suivies
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'session_id', s.id,
    'reference', s.reference,
    'course', co.name,
    'start_date', s.start_date,
    'end_date', s.end_date,
    'location', s.location,
    'status', s.status,
    'result', st.result,
    'registration_date', st.registration_date
  )), '[]'::jsonb)
  INTO v_sessions
  FROM session_trainees st
  JOIN sessions s ON s.id = st.session_id
  LEFT JOIN courses co ON co.id = s.course_id
  WHERE st.trainee_id = p_trainee_id;
  
  -- Émargements
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'session_id', a.session_id,
    'date', a.date,
    'am_present', a.am_present,
    'pm_present', a.pm_present,
    'signature_am', a.signature_am IS NOT NULL,
    'signature_pm', a.signature_pm IS NOT NULL
  )), '[]'::jsonb)
  INTO v_attendances
  FROM attendances a
  WHERE a.trainee_id = p_trainee_id;
  
  -- Évaluations
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'session_id', e.session_id,
    'type', e.type,
    'score', e.score,
    'created_at', e.created_at
  )), '[]'::jsonb)
  INTO v_evaluations
  FROM evaluations e
  WHERE e.trainee_id = p_trainee_id;
  
  -- Documents associés
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', d.id,
    'name', d.name,
    'type', d.type,
    'uploaded_at', d.created_at
  )), '[]'::jsonb)
  INTO v_documents
  FROM trainee_documents d
  WHERE d.trainee_id = p_trainee_id;
  
  -- Assembler le résultat
  v_result := jsonb_build_object(
    'export_date', NOW(),
    'export_type', 'RGPD_DATA_EXPORT',
    'trainee', v_trainee,
    'sessions', v_sessions,
    'attendances', v_attendances,
    'evaluations', v_evaluations,
    'documents', v_documents
  );
  
  -- Logger l'export
  PERFORM log_audit(
    NULL,
    'system',
    'export',
    'trainee',
    p_trainee_id,
    v_trainee->>'first_name' || ' ' || v_trainee->>'last_name',
    jsonb_build_object('type', 'RGPD_DATA_EXPORT')
  );
  
  RETURN v_result;
END;
$function$;

--FN-- generate_access_code
CREATE OR REPLACE FUNCTION public.generate_access_code()
 RETURNS character varying
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    code VARCHAR(6);
    exists_code BOOLEAN;
BEGIN
    LOOP
        code := LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');
        SELECT EXISTS(SELECT 1 FROM session_trainees WHERE access_code = code) INTO exists_code;
        EXIT WHEN NOT exists_code;
    END LOOP;
    RETURN code;
END;
$function$;

--FN-- generate_inter_session_reference
CREATE OR REPLACE FUNCTION public.generate_inter_session_reference()
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_code TEXT;
  v_chars TEXT := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  v_exists BOOLEAN;
BEGIN
  LOOP
    -- Générer SES- + 8 caractères aléatoires
    v_code := 'SES-';
    FOR i IN 1..8 LOOP
      v_code := v_code || substring(v_chars FROM floor(random() * length(v_chars) + 1)::int FOR 1);
    END LOOP;
    
    -- Vérifier si le code existe déjà
    SELECT EXISTS(SELECT 1 FROM sessions WHERE reference = v_code) INTO v_exists;
    
    -- Si le code n'existe pas, on sort de la boucle
    EXIT WHEN NOT v_exists;
  END LOOP;
  
  RETURN v_code;
END;
$function$;

--FN-- generate_nc_reference
CREATE OR REPLACE FUNCTION public.generate_nc_reference()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
DECLARE
  year_str TEXT;
  next_num INTEGER;
BEGIN
  year_str := EXTRACT(YEAR FROM CURRENT_DATE)::TEXT;
  
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(reference FROM 'NC-' || year_str || '-(\d+)') AS INTEGER)
  ), 0) + 1
  INTO next_num
  FROM non_conformities
  WHERE reference LIKE 'NC-' || year_str || '-%';
  
  NEW.reference := 'NC-' || year_str || '-' || LPAD(next_num::TEXT, 4, '0');
  RETURN NEW;
END;
$function$;

--FN-- generate_psh_reference
CREATE OR REPLACE FUNCTION public.generate_psh_reference()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  year_str text;
  seq_num  int;
BEGIN
  year_str := to_char(now(), 'YYYY');

  SELECT COALESCE(MAX(
    CAST(SUBSTRING(reference FROM 'PSH-' || year_str || '-(\d+)') AS int)
  ), 0) + 1
  INTO seq_num
  FROM psh_requests
  WHERE reference LIKE 'PSH-' || year_str || '-%';

  NEW.reference := 'PSH-' || year_str || '-' || LPAD(seq_num::text, 3, '0');
  RETURN NEW;
END;
$function$;

--FN-- generate_reclamation_reference
CREATE OR REPLACE FUNCTION public.generate_reclamation_reference()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
DECLARE
  year_str TEXT;
  seq_num INTEGER;
BEGIN
  year_str := TO_CHAR(NOW(), 'YYYY');
  SELECT COALESCE(MAX(CAST(SUBSTRING(reference FROM 'REC-' || year_str || '-(\d+)') AS INTEGER)), 0) + 1
  INTO seq_num FROM reclamations WHERE reference LIKE 'REC-' || year_str || '-%';
  NEW.reference := 'REC-' || year_str || '-' || LPAD(seq_num::TEXT, 3, '0');
  RETURN NEW;
END;
$function$;

--FN-- generate_session_reference
CREATE OR REPLACE FUNCTION public.generate_session_reference()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
DECLARE
  year_str TEXT;
  next_num INTEGER;
BEGIN
  year_str := EXTRACT(YEAR FROM NEW.start_date)::TEXT;
  
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(reference FROM 'SES-' || year_str || '-(\d+)') AS INTEGER)
  ), 0) + 1
  INTO next_num
  FROM sessions
  WHERE reference LIKE 'SES-' || year_str || '-%';
  
  NEW.reference := 'SES-' || year_str || '-' || LPAD(next_num::TEXT, 4, '0');
  RETURN NEW;
END;
$function$;

--FN-- generate_session_reference_v3
CREATE OR REPLACE FUNCTION public.generate_session_reference_v3()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_course_code TEXT;
  v_date_str TEXT;
  v_counter INTEGER;
  v_reference TEXT;
BEGIN
  -- Récupérer le code de la formation
  SELECT code INTO v_course_code
  FROM courses
  WHERE id = NEW.course_id;
  
  -- Si pas de code, utiliser un code par défaut
  IF v_course_code IS NULL OR v_course_code = '' THEN
    v_course_code := 'FORM';
  END IF;
  
  -- Formater la date AAMMJJ (Année sur 2 chiffres, Mois, Jour)
  v_date_str := TO_CHAR(NEW.start_date, 'YYMMDD');
  
  -- Trouver le prochain numéro pour cette formation + date
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(reference FROM '-(\d{3})$') AS INTEGER)
  ), 0) + 1
  INTO v_counter
  FROM sessions
  WHERE reference LIKE 'AF-' || v_course_code || '-%' || v_date_str || '-%';
  
  -- Générer la référence : AF-{CODE}-{AAMMJJ}-{NNN}
  v_reference := 'AF-' || v_course_code || '-' || v_date_str || '-' || LPAD(v_counter::TEXT, 3, '0');
  
  -- Assigner la référence
  NEW.reference := v_reference;
  
  RETURN NEW;
END;
$function$;

--FN-- get_audit_logs
CREATE OR REPLACE FUNCTION public.get_audit_logs(p_entity_type text DEFAULT NULL::text, p_entity_id uuid DEFAULT NULL::uuid, p_action text DEFAULT NULL::text, p_user_email text DEFAULT NULL::text, p_from_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, log_timestamp timestamp with time zone, user_email text, action text, entity_type text, entity_id uuid, entity_name text, details jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    al.id,
    al.timestamp as log_timestamp,
    al.user_email,
    al.action,
    al.entity_type,
    al.entity_id,
    al.entity_name,
    al.details
  FROM audit_logs al
  WHERE 
    (p_entity_type IS NULL OR al.entity_type = p_entity_type)
    AND (p_entity_id IS NULL OR al.entity_id = p_entity_id)
    AND (p_action IS NULL OR al.action = p_action)
    AND (p_user_email IS NULL OR al.user_email ILIKE '%' || p_user_email || '%')
    AND (p_from_date IS NULL OR al.timestamp >= p_from_date)
    AND (p_to_date IS NULL OR al.timestamp <= p_to_date)
  ORDER BY al.timestamp DESC
  LIMIT p_limit;
END;
$function$;

--FN-- get_budget_kpis
CREATE OR REPLACE FUNCTION public.get_budget_kpis()
 RETURNS TABLE(solde_compte numeric, solde_date date, total_credit numeric, total_debit numeric, cca_hicham numeric, cca_maxime numeric, nb_transactions bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    ROUND(COALESCE(SUM(COALESCE(credit,0) - COALESCE(debit,0))
      FILTER (WHERE is_manual = false), 0)::numeric, 2)                       AS solde_compte,
 
    MAX(date) FILTER (WHERE is_manual = false)                                AS solde_date,
 
    ROUND(COALESCE(SUM(COALESCE(credit,0))
      FILTER (WHERE is_personal = false AND linked_transaction_id IS NULL), 0)::numeric, 2) AS total_credit,
 
    ROUND(COALESCE(SUM(COALESCE(debit,0))
      FILTER (WHERE is_personal = false AND linked_transaction_id IS NULL), 0)::numeric, 2) AS total_debit,
 
    ROUND(COALESCE(SUM(COALESCE(debit,0) - COALESCE(credit,0))
      FILTER (WHERE is_personal = true AND payer = 'hicham_perso'), 0)::numeric, 2)         AS cca_hicham,
 
    ROUND(COALESCE(SUM(COALESCE(debit,0) - COALESCE(credit,0))
      FILTER (WHERE is_personal = true AND payer = 'maxime_perso'), 0)::numeric, 2)         AS cca_maxime,
 
    COUNT(*)                                                                  AS nb_transactions
  FROM budget_transactions;
$function$;

--FN-- get_portal_session
CREATE OR REPLACE FUNCTION public.get_portal_session(token_param text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  session_record RECORD;
  result json;
BEGIN
  SELECT s.*,
         row_to_json(c.*) AS course_data,
         row_to_json(cl.*) AS client_data
  INTO session_record
  FROM sessions s
  LEFT JOIN courses c ON c.id = s.course_id
  LEFT JOIN clients cl ON cl.id = s.client_id
  WHERE s.attendance_token = token_param;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session non trouvée';
  END IF;

  SELECT json_build_object(
    'id', session_record.id,
    'reference', session_record.reference,
    'start_date', session_record.start_date,
    'end_date', session_record.end_date,
    'start_time', session_record.start_time,
    'end_time', session_record.end_time,
    'status', session_record.status,
    'day_type', session_record.day_type,
    'signature_mode', session_record.signature_mode,
    'course_id', session_record.course_id,
    'client_id', session_record.client_id,
    'courses', session_record.course_data,
    'clients', session_record.client_data,
    'trainees', (
      SELECT json_agg(json_build_object(
        'id', t.id,
        'first_name', t.first_name,
        'last_name', t.last_name,
        'email', t.email,
        'session_trainee_id', st.id,
        'has_access_code', (st.access_code IS NOT NULL),
        'access_code_attempts', st.access_code_attempts,
        'access_code_locked', coalesce(st.access_code_locked, false),
        'absent', coalesce(st.absent, false)
      ))
      FROM session_trainees st
      JOIN trainees t ON t.id = st.trainee_id
      WHERE st.session_id = session_record.id
    )
  ) INTO result;

  RETURN result;
END;
$function$;

--FN-- get_purge_stats
CREATE OR REPLACE FUNCTION public.get_purge_stats()
 RETURNS TABLE(total_trainees bigint, trainees_to_purge bigint, oldest_trainee_years numeric, purge_threshold_years integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    (SELECT COUNT(*) FROM trainees)::BIGINT as total_trainees,
    (SELECT COUNT(*) FROM trainees_to_purge)::BIGINT as trainees_to_purge,
    COALESCE((SELECT MAX(years_since_activity) FROM trainees_to_purge), 0)::NUMERIC as oldest_trainee_years,
    5::INTEGER as purge_threshold_years;
END;
$function$;

--FN-- get_trainee_positioning_test
CREATE OR REPLACE FUNCTION public.get_trainee_positioning_test(p_session_id uuid, p_trainee_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_result json;
BEGIN
  SELECT json_build_object(
    'completed', COALESCE(st.positioning_test_completed, false),
    'completed_at', st.positioning_test_completed_at,
    'answers', COALESCE((
      SELECT json_agg(
        json_build_object(
          'question_id', tpt.question_id,
          'question_text', tq.question_text,
          'question_type', tpt.question_type,
          'selected_option_index', tpt.selected_option_index,
          'text_answer', tpt.text_answer,
          'is_correct', tpt.is_correct,
          'score_obtained', tpt.score_obtained,
          'options', tq.options,
          'correct_index', tq.correct_index,
          'critical', tq.critical,
          'position', tq.position
        ) ORDER BY tq.position
      )
      FROM trainee_positioning_tests tpt
      LEFT JOIN theme_questions tq ON tq.id = tpt.question_id
      WHERE tpt.session_id = p_session_id
      AND tpt.trainee_id = p_trainee_id
    ), '[]'::json)
  ) INTO v_result
  FROM session_trainees st
  WHERE st.session_id = p_session_id
  AND st.trainee_id = p_trainee_id;
  
  RETURN v_result;
END;
$function$;

--FN-- get_trainee_with_ssn
CREATE OR REPLACE FUNCTION public.get_trainee_with_ssn(p_id uuid)
 RETURNS TABLE(id uuid, first_name text, last_name text, email text, phone text, social_security_number text, client_id uuid, notes text, birth_date date, refused_ssn boolean, has_disability boolean, disability_details text, disability_adaptations text, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    t.id,
    t.first_name,
    t.last_name,
    t.email,
    t.phone,
    decrypt_ssn(t.ssn_encrypted) as social_security_number,
    t.client_id,
    t.notes,
    t.birth_date,
    t.refused_ssn,
    t.has_disability,
    t.disability_details,
    t.disability_adaptations,
    t.created_at,
    t.updated_at
  FROM trainees t
  WHERE t.id = p_id;
END;
$function$;

--FN-- get_trainer_sign_data
CREATE OR REPLACE FUNCTION public.get_trainer_sign_data(p_session_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v json;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Connexion Campus requise');
  END IF;

  SELECT json_build_object(
    'ok', true,
    'today', paris_today(),
    'now_time', to_char(paris_time(), 'HH24:MI'),
    'session', json_build_object(
      'id', s.id, 'reference', s.reference,
      'course', c.title, 'client', cl.name,
      'start_date', s.start_date, 'end_date', s.end_date,
      'start_time', to_char(s.start_time, 'HH24:MI'), 'end_time', to_char(s.end_time, 'HH24:MI'),
      'day_type', s.day_type, 'signature_mode', s.signature_mode,
      'location', coalesce(s.location_name, s.location_city),
      'is_admin', is_signature_admin()
    ),
    'half_days', (
      SELECT coalesce(json_agg(json_build_object('date', hd.d, 'period', hd.period, 'label', hd.label)
                               ORDER BY hd.d, CASE WHEN hd.period = 'morning' THEN 0 ELSE 1 END), '[]'::json)
      FROM session_half_days(s.id) hd
    ),
    'trainees', (
      SELECT coalesce(json_agg(t ORDER BY t->>'last_name', t->>'first_name'), '[]'::json)
      FROM (
        SELECT json_build_object(
          'trainee_id', tr.id,
          'first_name', tr.first_name,
          'last_name', tr.last_name,
          'absent', st.absent,
          'early_departure', coalesce(st.early_departure, false),
          'departure_date', st.departure_date,
          'half_days', (
            SELECT coalesce(json_agg(json_build_object(
              'date', hd.d, 'period', hd.period,
              'statut', CASE
                WHEN EXISTS (SELECT 1 FROM attendance_proxy_signatures p
                              WHERE p.session_id = s.id AND p.trainee_id = tr.id
                                AND p.date = hd.d AND p.period = hd.period) THEN 'tiers'
                WHEN (hd.period = 'morning'   AND a.signature_morning IS NOT NULL)
                  OR (hd.period = 'afternoon' AND a.signature_afternoon IS NOT NULL) THEN 'signe'
                WHEN (hd.period = 'morning'   AND coalesce(a.morning, false))
                  OR (hd.period = 'afternoon' AND coalesce(a.afternoon, false)) THEN 'valide'
                ELSE 'vide' END,
              'signed_at', CASE WHEN hd.period = 'morning' THEN a.signed_morning_at ELSE a.signed_afternoon_at END
            ) ORDER BY hd.d, CASE WHEN hd.period = 'morning' THEN 0 ELSE 1 END), '[]'::json)
            FROM session_half_days(s.id) hd
            LEFT JOIN attendance_halfdays a
              ON a.session_id = s.id AND a.trainee_id = tr.id AND a.date = hd.d
          )
        ) AS t
        FROM session_trainees st
        JOIN trainees tr ON tr.id = st.trainee_id
        WHERE st.session_id = s.id
      ) x
    )
  ) INTO v
  FROM sessions s
  LEFT JOIN courses c ON c.id = s.course_id
  LEFT JOIN clients cl ON cl.id = s.client_id
  WHERE s.id = p_session_id;

  RETURN coalesce(v, json_build_object('ok', false, 'error', 'Session introuvable'));
END;
$function$;

--FN-- get_ungeo_postal_codes
CREATE OR REPLACE FUNCTION public.get_ungeo_postal_codes()
 RETURNS TABLE(postal_code text)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT DISTINCT postal_code
  FROM prospection_massive
  WHERE latitude IS NULL AND postal_code IS NOT NULL
$function$;

--FN-- init_dashboard_widgets
CREATE OR REPLACE FUNCTION public.init_dashboard_widgets(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- Ne rien faire si l'utilisateur a déjà des configs
  IF EXISTS (SELECT 1 FROM dashboard_widget_configs WHERE user_id = p_user_id LIMIT 1) THEN
    RETURN;
  END IF;

  INSERT INTO dashboard_widget_configs (user_id, widget_id, position, size, visible) VALUES
    (p_user_id, 'sessions_today',        0,  'md', true),
    (p_user_id, 'sessions_upcoming',     1,  'md', true),
    (p_user_id, 'quality_indicators',    2,  'lg', true),
    (p_user_id, 'attendance_incomplete',  3,  'md', true),
    (p_user_id, 'evaluations_pending',   4,  'md', true),
    (p_user_id, 'certif_expiring',       5,  'md', true),
    (p_user_id, 'positioning_pending',   6,  'sm', true),
    (p_user_id, 'documents_missing',     7,  'md', true),
    (p_user_id, 'quotes_pipeline',       8,  'lg', true),
    (p_user_id, 'monthly_revenue',       9,  'md', true),
    (p_user_id, 'rdv_week',             10,  'md', true),
    (p_user_id, 'hot_prospects',        11,  'md', true),
    (p_user_id, 'new_clients',          12,  'sm', true),
    (p_user_id, 'conversion_rate',      13,  'sm', true),
    (p_user_id, 'top_courses',          14,  'md', true),
    (p_user_id, 'reclamations_open',    15,  'md', true),
    (p_user_id, 'non_conformites',      16,  'md', true),
    (p_user_id, 'auto_reminders',       17,  'lg', true),
    (p_user_id, 'recent_messages',      18,  'md', false),
    (p_user_id, 'qualiopi_audit',       19,  'md', true),
    (p_user_id, 'bpf_status',           20,  'sm', true),
    (p_user_id, 'revenue_12m',          21,  'xl', true),
    (p_user_id, 'theme_distribution',   22,  'md', true),
    (p_user_id, 'hours_realized',       23,  'md', true),
    (p_user_id, 'trainee_stats',        24,  'md', true)
  ON CONFLICT (user_id, widget_id) DO NOTHING;
END;
$function$;

--FN-- is_signature_admin
CREATE OR REPLACE FUNCTION public.is_signature_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT lower(coalesce(current_setting('request.jwt.claims', true)::json ->> 'email', ''))
         = 'hicham.saidi@accessformation.pro';
$function$;

--FN-- load_trainee_data
CREATE OR REPLACE FUNCTION public.load_trainee_data(p_token text, p_trainee_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_session_id uuid;
  v_result json;
  v_trainee record;
  v_info_sheet record;
  v_theme_id uuid;
BEGIN
  -- Vérifier que le token est valide
  SELECT id INTO v_session_id
  FROM sessions
  WHERE attendance_token = p_token;
  
  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'Token invalide';
  END IF;
  
  -- Vérifier que le trainee appartient à cette session
  IF NOT EXISTS (
    SELECT 1 FROM session_trainees
    WHERE session_id = v_session_id AND trainee_id = p_trainee_id
  ) THEN
    RAISE EXCEPTION 'Stagiaire non trouvé dans cette session';
  END IF;
  
  -- Charger les données du stagiaire depuis trainees
  SELECT * INTO v_trainee
  FROM trainees
  WHERE id = p_trainee_id;
  
  -- Charger la fiche de renseignements (pour les champs supplémentaires)
  SELECT * INTO v_info_sheet
  FROM trainee_info_sheets
  WHERE session_id = v_session_id AND trainee_id = p_trainee_id;
  
  -- Récupérer le theme_id de la formation
  SELECT c.theme_id INTO v_theme_id
  FROM sessions s
  JOIN courses c ON c.id = s.course_id
  WHERE s.id = v_session_id;
  
  -- Récupérer toutes les données
  SELECT json_build_object(
    'gender', v_trainee.gender,
    'info_sheet', json_build_object(
      'id', v_info_sheet.id,
      'session_id', v_session_id,
      'trainee_id', p_trainee_id,
      'email', COALESCE(v_trainee.email, v_info_sheet.email),
      'ssn', COALESCE(v_trainee.social_security_number, v_info_sheet.ssn),
      'ssn_refused', COALESCE(v_trainee.refused_ssn, v_info_sheet.ssn_refused, false),
      'csp', COALESCE(v_trainee.csp, v_info_sheet.csp),
      'job_title', COALESCE(v_trainee.job_title, v_info_sheet.job_title),
      'last_training_year', v_info_sheet.last_training_year,
      'highest_diploma', v_info_sheet.highest_diploma,
      'training_expectations', v_info_sheet.training_expectations,
      'rgpd_consent', v_info_sheet.rgpd_consent,
      'rgpd_consent_date', v_info_sheet.rgpd_consent_date,
      'filled_at', v_info_sheet.filled_at,
      'filled_online', v_info_sheet.filled_online
    ),
    'attendance', (
      SELECT json_agg(row_to_json(a.*))
      FROM attendance_halfdays a
      WHERE a.session_id = v_session_id AND a.trainee_id = p_trainee_id
    ),
    'evaluation', (
      SELECT row_to_json(e.*)
      FROM trainee_evaluations e
      WHERE e.session_id = v_session_id AND e.trainee_id = p_trainee_id
    ),
    'positioning_questions', (
      SELECT json_agg(
        json_build_object(
          'id', tq.id,
          'question_text', tq.question_text,
          'question_type', tq.question_type,
          'options', tq.options,
          'position', tq.position,
          'score', tq.score,
          'critical', tq.critical
        ) ORDER BY tq.position
      )
      FROM theme_questions tq
      WHERE tq.theme_id = v_theme_id
    ),
    'positioning_test_completed', (
      SELECT positioning_test_completed
      FROM session_trainees
      WHERE session_id = v_session_id AND trainee_id = p_trainee_id
    )
  ) INTO v_result;
  
  RETURN v_result;
END;
$function$;

--FN-- log_audit
CREATE OR REPLACE FUNCTION public.log_audit(p_user_id uuid, p_user_email text, p_action text, p_entity_type text, p_entity_id uuid DEFAULT NULL::uuid, p_entity_name text DEFAULT NULL::text, p_details jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO audit_logs (
    user_id, user_email, action, entity_type, 
    entity_id, entity_name, details
  ) VALUES (
    p_user_id, p_user_email, p_action, p_entity_type,
    p_entity_id, p_entity_name, p_details
  )
  RETURNING id INTO v_id;
  
  RETURN v_id;
END;
$function$;

--FN-- mailing_claim_campaign_slot
CREATE OR REPLACE FUNCTION public.mailing_claim_campaign_slot(p_campaign uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ok boolean;
BEGIN
  UPDATE mailing_campaigns
  SET next_send_at = now() + make_interval(secs => GREATEST(COALESCE(cadence_seconds, 90), 30)),
      updated_at = now()
  WHERE id = p_campaign
    AND status = 'en_cours'
    AND send_mode = 'serveur'
    AND (next_send_at IS NULL OR next_send_at <= now())
  RETURNING true INTO v_ok;
  RETURN COALESCE(v_ok, false);
END;
$function$;

--FN-- mailing_claim_next_send
CREATE OR REPLACE FUNCTION public.mailing_claim_next_send(p_campaign uuid)
 RETURNS SETOF mailing_sends
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  UPDATE mailing_sends
  SET status = 'sending', claimed_at = now()
  WHERE id = (
    SELECT id FROM mailing_sends
    WHERE campaign_id = p_campaign AND status = 'pending'
    ORDER BY created_at, id
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$function$;

--FN-- mailing_clean_email
CREATE OR REPLACE FUNCTION public.mailing_clean_email(p_email text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT lower(regexp_replace(COALESCE(p_email, ''), '[\s\u00a0\u200b\u200c\u200d\u2060\ufeff]', '', 'g'));
$function$;

--FN-- mailing_email_flags
CREATE OR REPLACE FUNCTION public.mailing_email_flags(p_email text)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_raw   text := lower(trim(COALESCE(p_email, '')));
  v_clean text := public.mailing_clean_email(p_email);
  v_loc   text;
  v_dom   text;
  v_tld   text;
  v_flags text[] := '{}';
BEGIN
  IF v_clean <> v_raw THEN
    v_flags := array_append(v_flags, 'caractere_invisible');
  END IF;

  v_loc := split_part(v_clean, '@', 1);
  v_dom := split_part(v_clean, '@', 2);
  v_tld := substring(v_clean from '\.([a-z0-9-]+)$');

  IF v_clean !~ '^[a-z0-9._%+''-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$' THEN
    v_flags := array_append(v_flags, 'syntaxe');
  ELSIF public.mailing_file_tld(v_tld) THEN
    v_flags := array_append(v_flags, 'fichier');
  ELSIF NOT public.mailing_known_tld(v_tld) THEN
    v_flags := array_append(v_flags, 'extension_inconnue');
  END IF;

  IF v_loc ~ '^(vous|votre|your|exemple|example|test|xxx+|abc|nom|prenom|nom\.prenom|prenom\.nom|email|mail|adresse|votre\.?email|monmail)$'
     OR v_dom ~ '^(fournisseur|domaine|domain|example|exemple|votresite|monsite|votre-?site|test|societe|entreprise|xyz)\.' THEN
    v_flags := array_append(v_flags, 'modele');
  END IF;

  IF v_loc ~ '^(dpo|dpd|rgpd|cnil|privacy|donnees|donnees-?personnelles|abuse|postmaster|hostmaster|webmaster|noreply|no-?reply|ne-?pas-?repondre|mailer-daemon)$' THEN
    v_flags := array_append(v_flags, 'rgpd');
  END IF;

  IF v_loc ~ '^(communication|com|presse|press|media|medias|recrutement|recrute|jobs?|emploi|candidatures?|careers?|carrieres?|stages?|factur|facturation|factures?|comptabilite|compta|invoices?|sav|support|marketing|newsletter)$' THEN
    v_flags := array_append(v_flags, 'service');
  END IF;

  RETURN v_flags;
END;
$function$;

--FN-- mailing_email_suggestion
CREATE OR REPLACE FUNCTION public.mailing_email_suggestion(p_email text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_raw   text := lower(trim(COALESCE(p_email, '')));
  v_clean text := public.mailing_clean_email(p_email);
  v_rot   text;
  v_tld   text;
BEGIN
  v_tld := substring(v_clean from '\.([a-z0-9-]+)$');
  IF v_tld IS NOT NULL AND NOT public.mailing_known_tld(v_tld) AND NOT public.mailing_file_tld(v_tld) THEN
    v_rot := translate(v_clean, 'abcdefghijklmnopqrstuvwxyz', 'nopqrstuvwxyzabcdefghijklm');
    IF public.mailing_known_tld(substring(v_rot from '\.([a-z0-9-]+)$'))
       AND v_rot ~ '^[a-z0-9._%+''-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$' THEN
      RETURN v_rot;
    END IF;
  END IF;
  IF v_clean <> v_raw AND v_clean ~ '^[a-z0-9._%+''-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$' THEN
    RETURN v_clean;
  END IF;
  RETURN NULL;
END;
$function$;

--FN-- mailing_file_tld
CREATE OR REPLACE FUNCTION public.mailing_file_tld(p_tld text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT p_tld = ANY (ARRAY['js','mjs','css','png','jpg','jpeg','gif','svg','webp','pdf','php',
                            'html','htm','json','xml','ico','avif','mp4','woff','woff2']);
$function$;

--FN-- mailing_fix_email
CREATE OR REPLACE FUNCTION public.mailing_fix_email(p_old text, p_new text, p_by text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old text := lower(trim(p_old));
  v_new text := public.mailing_clean_email(p_new);
  v_n   int;
BEGIN
  IF v_new !~ '^[a-z0-9._%+''-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$' THEN
    RAISE EXCEPTION 'Adresse corrigée invalide : %', p_new;
  END IF;
  IF EXISTS (SELECT 1 FROM clients c WHERE v_old IN (lower(trim(c.contact_email)), lower(trim(c.email)), lower(trim(c.billing_email))))
     OR EXISTS (SELECT 1 FROM client_contacts cc WHERE lower(trim(cc.email)) = v_old) THEN
    RAISE EXCEPTION 'Adresse utilisée par un client ou un contact : à corriger depuis la fiche client';
  END IF;

  UPDATE prospection_massive
  SET email = v_new, updated_at = now(),
      enrichment_notes = trim(COALESCE(enrichment_notes, '') || ' [Email corrigé ' || to_char(now(), 'DD/MM/YYYY') || ' : ' || v_old || ' → ' || v_new || ']')
  WHERE lower(trim(email)) = v_old;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  DELETE FROM mailing_email_status WHERE email = v_old;
  INSERT INTO mailing_email_status (email, status, flags, suggestion, manual, decided_by, decided_at, note, analysed_at)
  VALUES (v_new, 'ok', public.mailing_email_flags(v_new), NULL, true, p_by, now(), 'Corrigée depuis ' || v_old, now())
  ON CONFLICT (email) DO UPDATE
    SET status = 'ok', manual = true, decided_by = p_by, decided_at = now(),
        note = 'Corrigée depuis ' || v_old, updated_at = now();

  RETURN v_n;
END;
$function$;

--FN-- mailing_known_tld
CREATE OR REPLACE FUNCTION public.mailing_known_tld(p_tld text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT p_tld = ANY (ARRAY[
    'fr','com','net','org','eu','bzh','info','biz','pro','coop','bio','care','cloud','leclerc',
    'io','co','de','be','ch','lu','uk','es','it','pt','nl','ie','at','dk','se','no','fi','pl',
    're','gp','mq','gf','yt','nc','pf','pm','wf','mc',
    'paris','bretagne','alsace','corsica','immo','site','online','tech','email','app','dev',
    'group','shop','store','fm','tv','me','us','ca','ma','tn','dz','sn','ci','asia','travel',
    'restaurant','agency','services','company','solutions','consulting','expert','club',
    'sport','events','studio','design','media','news','fun','world','life','bzh','ovh','fitness',
    'camp','golf','farm','bike','auto','immobilier','energy','green','eco','gmbh','ltd','sarl'
  ]);
$function$;

--FN-- mailing_refresh_email_status
CREATE OR REPLACE FUNCTION public.mailing_refresh_email_status()
 RETURNS json
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result json;
BEGIN
  WITH src AS (
    SELECT lower(trim(email)) AS em, siren, false AS prot FROM prospection_massive
    WHERE email IS NOT NULL AND trim(email) <> ''
    UNION ALL
    SELECT lower(trim(contact_email)), siren, true FROM clients
    WHERE contact_email IS NOT NULL AND trim(contact_email) <> ''
    UNION ALL
    SELECT lower(trim(email)), siren, true FROM clients
    WHERE email IS NOT NULL AND trim(email) <> ''
    UNION ALL
    SELECT lower(trim(billing_email)), siren, true FROM clients
    WHERE billing_email IS NOT NULL AND trim(billing_email) <> ''
    UNION ALL
    SELECT lower(trim(cc.email)), c.siren, true FROM client_contacts cc
    LEFT JOIN clients c ON c.id = cc.client_id
    WHERE cc.email IS NOT NULL AND trim(cc.email) <> ''
  ),
  u AS (
    SELECT em, bool_or(prot) AS prot, count(DISTINCT NULLIF(siren, '')) AS nsiren
    FROM src GROUP BY em
  ),
  bounces AS (
    SELECT DISTINCT lower(trim(email)) AS em FROM mailing_sends
    WHERE status = 'error' AND error_message ~ '(^|\D)55[0-4](\D|$)'
  ),
  calc AS (
    SELECT u.em, u.prot,
           mailing_email_flags(u.em)
             || CASE WHEN u.nsiren > 1 THEN ARRAY['multi_siren'] ELSE '{}'::text[] END
             || CASE WHEN b.em IS NOT NULL THEN ARRAY['rejet_serveur'] ELSE '{}'::text[] END AS flags,
           mailing_email_suggestion(u.em) AS sugg
    FROM u LEFT JOIN bounces b ON b.em = u.em
  ),
  st AS (
    SELECT c.*,
      CASE
        WHEN c.flags && ARRAY['syntaxe', 'fichier', 'modele', 'rejet_serveur']
          THEN CASE WHEN c.prot THEN 'a_verifier' ELSE 'invalide' END
        WHEN c.flags && ARRAY['extension_inconnue', 'caractere_invisible']
          THEN 'a_verifier'
        ELSE 'ok'
      END AS auto_status
    FROM calc c
  ),
  up AS (
    INSERT INTO mailing_email_status AS m (email, status, flags, suggestion, is_protected, analysed_at, updated_at)
    SELECT em, auto_status, flags, sugg, prot, now(), now() FROM st
    ON CONFLICT (email) DO UPDATE
      SET flags        = EXCLUDED.flags,
          suggestion   = EXCLUDED.suggestion,
          is_protected = EXCLUDED.is_protected,
          analysed_at  = now(),
          updated_at   = now(),
          status       = CASE WHEN m.manual THEN m.status ELSE EXCLUDED.status END
    RETURNING m.status
  )
  SELECT json_build_object(
    'total',      count(*),
    'ok',         count(*) FILTER (WHERE status = 'ok'),
    'a_verifier', count(*) FILTER (WHERE status = 'a_verifier'),
    'invalide',   count(*) FILTER (WHERE status = 'invalide')
  ) INTO v_result FROM up;

  -- Adresses disparues des fiches (hors décisions manuelles)
  DELETE FROM mailing_email_status m
  WHERE NOT m.manual
    AND NOT EXISTS (SELECT 1 FROM prospection_massive p WHERE lower(trim(p.email)) = m.email)
    AND NOT EXISTS (SELECT 1 FROM clients c WHERE m.email IN (lower(trim(c.contact_email)), lower(trim(c.email)), lower(trim(c.billing_email))))
    AND NOT EXISTS (SELECT 1 FROM client_contacts cc WHERE lower(trim(cc.email)) = m.email);

  RETURN v_result;
END;
$function$;

--FN-- mailing_tick
CREATE OR REPLACE FUNCTION public.mailing_tick()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_activated int := 0;
  v_unstuck int := 0;
  v_sends int := 0;
  v_reports int := 0;
BEGIN
  -- a) Campagnes programmées dont l'heure est arrivée
  UPDATE mailing_campaigns
  SET status = 'en_cours', started_at = now(), next_send_at = now(), updated_at = now()
  WHERE status = 'planifiée' AND scheduled_at <= now();
  GET DIAGNOSTICS v_activated = ROW_COUNT;

  -- b) Envois bloqués depuis plus de 10 min → à re-tenter
  UPDATE mailing_sends
  SET status = 'error', error_message = 'Envoi interrompu — à re-tenter'
  WHERE status = 'sending' AND claimed_at < now() - interval '10 minutes';
  GET DIAGNOSTICS v_unstuck = ROW_COUNT;

  -- c) Campagnes en cours, mode serveur
  FOR r IN
    SELECT c.id, c.report_requested_at,
           EXISTS (SELECT 1 FROM mailing_sends s WHERE s.campaign_id = c.id AND s.status = 'pending') AS has_pending,
           EXISTS (SELECT 1 FROM mailing_sends s WHERE s.campaign_id = c.id AND s.status = 'sending') AS has_sending
    FROM mailing_campaigns c
    WHERE c.status = 'en_cours' AND c.send_mode = 'serveur'
  LOOP
    IF r.has_pending THEN
      -- Réserve le créneau (next_send_at = maintenant + cadence) ; faux si pas encore l'heure
      IF mailing_claim_campaign_slot(r.id) THEN
        IF r.report_requested_at IS NOT NULL THEN
          UPDATE mailing_campaigns SET report_requested_at = NULL WHERE id = r.id;
        END IF;
        PERFORM cron_call_vercel('/api/mailing-cron?campaign=' || r.id);
        v_sends := v_sends + 1;
      END IF;
    ELSIF NOT r.has_sending
          AND (r.report_requested_at IS NULL OR r.report_requested_at < now() - interval '15 minutes') THEN
      -- Plus rien à envoyer : rapport de fin (redemandé 15 min plus tard s'il n'a pas abouti)
      UPDATE mailing_campaigns SET report_requested_at = now() WHERE id = r.id;
      PERFORM cron_call_vercel('/api/mailing-cron?campaign=' || r.id || '&finish=1');
      v_reports := v_reports + 1;
    END IF;
  END LOOP;

  RETURN json_build_object('activees', v_activated, 'debloques', v_unstuck, 'envois', v_sends, 'rapports', v_reports);
END;
$function$;

--FN-- notify_new_reclamation
CREATE OR REPLACE FUNCTION public.notify_new_reclamation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  reclamation_data jsonb;
  session_ref text;
  formation_title text;
  trainee_name text;
BEGIN
  -- Récupérer les infos de session
  SELECT reference INTO session_ref
  FROM sessions
  WHERE id = NEW.session_id;
  
  -- Récupérer le nom de la formation
  SELECT c.title INTO formation_title
  FROM sessions s
  JOIN courses c ON c.id = s.course_id
  WHERE s.id = NEW.session_id;
  
  -- Extraire le nom depuis created_by OU subject
  IF NEW.created_by IS NOT NULL AND NEW.created_by != '' THEN
    trainee_name := NEW.created_by;
  ELSIF NEW.subject IS NOT NULL THEN
    trainee_name := regexp_replace(NEW.subject, '^Réclamation de ([^(]+).*', '\1');
    trainee_name := TRIM(trainee_name);
  ELSE
    trainee_name := 'Anonyme';
  END IF;
  
  -- ============================================================
  -- CRÉER NOTIFICATION AVEC BON LIEN
  -- ============================================================
  INSERT INTO notifications (
    type,
    title,
    message,
    link,
    metadata,
    created_at
  ) VALUES (
    'reclamation',
    '🔴 Nouvelle réclamation reçue',
    trainee_name || ' - ' || COALESCE(formation_title, 'Formation') || ' (' || COALESCE(session_ref, 'N/A') || ')',
    '/non-conformites',  -- ✅ CORRIGÉ ICI
    jsonb_build_object(
      'reclamation_id', NEW.id,
      'session_ref', session_ref,
      'formation', formation_title,
      'trainee', trainee_name
    ),
    NOW()
  );
  
  RETURN NEW;
END;
$function$;

--FN-- paris_time
CREATE OR REPLACE FUNCTION public.paris_time()
 RETURNS time without time zone
 LANGUAGE sql
 STABLE
AS $function$
  SELECT (now() AT TIME ZONE 'Europe/Paris')::time;
$function$;

--FN-- paris_today
CREATE OR REPLACE FUNCTION public.paris_today()
 RETURNS date
 LANGUAGE sql
 STABLE
AS $function$
  SELECT (now() AT TIME ZONE 'Europe/Paris')::date;
$function$;

--FN-- phoning_set_updated_at
CREATE OR REPLACE FUNCTION public.phoning_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$function$;

--FN-- portal_set_email_refused
CREATE OR REPLACE FUNCTION public.portal_set_email_refused(p_token text, p_trainee_id uuid, p_refused boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_session_id uuid;
BEGIN
  SELECT id INTO v_session_id FROM sessions WHERE attendance_token = p_token;
  IF v_session_id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'Lien invalide'); END IF;

  IF NOT EXISTS (SELECT 1 FROM session_trainees
                 WHERE session_id = v_session_id AND trainee_id = p_trainee_id) THEN
    RETURN json_build_object('ok', false, 'error', 'Stagiaire non inscrit à cette session');
  END IF;

  UPDATE trainees SET email_refused = p_refused WHERE id = p_trainee_id;
  UPDATE trainee_info_sheets SET email_refused = p_refused
  WHERE session_id = v_session_id AND trainee_id = p_trainee_id;

  RETURN json_build_object('ok', true, 'email_refused', p_refused);
END;
$function$;

--FN-- portal_sign_halfday
CREATE OR REPLACE FUNCTION public.portal_sign_halfday(p_token text, p_trainee_id uuid, p_period text, p_signature text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s record;
  v_refus text;
  v_date date;
  v_name text;
BEGIN
  SELECT id, signature_mode, day_type, start_time INTO s
  FROM sessions WHERE attendance_token = p_token;
  IF s.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'Lien invalide'); END IF;

  IF s.signature_mode = 'ferme' THEN
    RETURN json_build_object('ok', false, 'error', 'Les signatures sont fermées : voyez avec votre formateur');
  END IF;

  v_date := paris_today();

  -- Créneaux : l'après-midi ne se signe pas avant 13h ; le matin reste signable
  -- toute la journée. Le mode « ouvert » lève cette règle.
  IF s.signature_mode <> 'ouvert' AND p_period = 'afternoon' AND paris_time() < '13:00'::time THEN
    RETURN json_build_object('ok', false, 'error', 'L''après-midi se signe à partir de 13h');
  END IF;

  v_refus := signature_refusal(s.id, p_trainee_id, v_date, p_period, p_signature);
  IF v_refus IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', v_refus);
  END IF;

  SELECT trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) INTO v_name
  FROM trainees WHERE id = p_trainee_id;

  PERFORM write_halfday_signature(s.id, p_trainee_id, v_date, p_period, p_signature, now(), v_name);

  RETURN json_build_object('ok', true, 'date', v_date, 'period', p_period);
END;
$function$;

--FN-- purge_trainee
CREATE OR REPLACE FUNCTION public.purge_trainee(p_trainee_id uuid, p_archived_by text DEFAULT 'system'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_trainee RECORD;
  v_sessions_count INTEGER;
  v_reference TEXT;
BEGIN
  -- Récupérer le stagiaire
  SELECT * INTO v_trainee FROM trainees WHERE id = p_trainee_id;
  
  IF v_trainee IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Stagiaire non trouvé');
  END IF;
  
  -- Compter les sessions
  SELECT COUNT(*) INTO v_sessions_count
  FROM session_trainees WHERE trainee_id = p_trainee_id;
  
  -- Créer une référence anonymisée
  v_reference := 'ARCH-' || TO_CHAR(NOW(), 'YYYY') || '-' || SUBSTRING(p_trainee_id::TEXT, 1, 8);
  
  -- Archiver
  INSERT INTO trainees_archive (id, reference, last_session_date, sessions_count, archived_by)
  VALUES (p_trainee_id, v_reference, v_trainee.last_session_date, v_sessions_count, p_archived_by)
  ON CONFLICT (id) DO NOTHING;
  
  -- Supprimer les données associées
  DELETE FROM trainee_documents WHERE trainee_id = p_trainee_id;
  DELETE FROM evaluations WHERE trainee_id = p_trainee_id;
  DELETE FROM attendances WHERE trainee_id = p_trainee_id;
  DELETE FROM session_trainees WHERE trainee_id = p_trainee_id;
  DELETE FROM trainees WHERE id = p_trainee_id;
  
  -- Logger la purge
  PERFORM log_audit(
    NULL,
    p_archived_by,
    'delete',
    'trainee',
    p_trainee_id,
    v_reference,
    jsonb_build_object('type', 'RGPD_PURGE', 'original_name', v_trainee.first_name || ' ' || v_trainee.last_name)
  );
  
  RETURN jsonb_build_object(
    'success', true,
    'reference', v_reference,
    'sessions_count', v_sessions_count
  );
END;
$function$;

--FN-- rdv_kit_documents_set_updated_at
CREATE OR REPLACE FUNCTION public.rdv_kit_documents_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$function$;

--FN-- recompute_invoice_credits
CREATE OR REPLACE FUNCTION public.recompute_invoice_credits(p_invoice_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  inv          invoices%ROWTYPE;
  v_ttc        numeric;
  v_paid       numeric;
  v_credited   numeric;
  v_due        numeric;
  v_status     text;
  v_remaining  numeric;
  v_imputed    numeric;
  v_refund_due numeric;
  v_cn_status  text;
  r            record;
BEGIN
  IF p_invoice_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO inv FROM invoices WHERE id = p_invoice_id;
  IF NOT FOUND OR inv.type <> 'invoice' THEN
    RETURN;
  END IF;

  v_ttc  := COALESCE(inv.total_ttc, 0);
  v_paid := COALESCE(inv.amount_paid, 0);

  SELECT COALESCE(round(sum(total_ttc), 2), 0) INTO v_credited
  FROM invoices
  WHERE parent_invoice_id = p_invoice_id
    AND type = 'credit_note'
    AND status <> 'draft';

  -- Facture sans avoir (ni passé ni présent) : on ne touche à rien
  IF v_credited = 0 AND COALESCE(inv.amount_credited, 0) = 0 AND inv.status <> 'credited' THEN
    RETURN;
  END IF;

  IF v_credited > v_ttc + 0.01 THEN
    RAISE EXCEPTION 'Le total des avoirs (% €) dépasse le montant de la facture % (% €)',
      v_credited, inv.reference, v_ttc;
  END IF;

  -- ── Facture ──
  v_due    := greatest(0, round(v_ttc - v_paid - v_credited, 2));
  v_status := inv.status;

  IF inv.status IN ('draft', 'cancelled') THEN
    NULL;  -- statut laissé tel quel
  ELSIF v_credited > 0 AND v_credited >= v_ttc - 0.01 THEN
    v_status := 'credited';
  ELSIF v_due <= 0.01 THEN
    v_status := 'paid';
  ELSIF inv.status IN ('paid', 'credited') THEN
    v_status := CASE
      WHEN v_paid > 0.01 THEN 'partial'
      WHEN inv.due_date IS NOT NULL AND inv.due_date < CURRENT_DATE THEN 'overdue'
      ELSE 'due'
    END;
  END IF;

  UPDATE invoices
  SET amount_credited = v_credited,
      amount_due      = v_due,
      status          = v_status,
      updated_at      = now()
  WHERE id = p_invoice_id
    AND (amount_credited IS DISTINCT FROM v_credited
      OR amount_due      IS DISTINCT FROM v_due
      OR status          IS DISTINCT FROM v_status);

  -- ── Avoirs validés : imputation chronologique sur le reste dû ──
  v_remaining := greatest(0, v_ttc - v_paid);

  FOR r IN
    SELECT id, total_ttc, amount_paid
    FROM invoices
    WHERE parent_invoice_id = p_invoice_id
      AND type = 'credit_note'
      AND status <> 'draft'
    ORDER BY invoice_date, created_at, id
  LOOP
    v_imputed    := round(least(COALESCE(r.total_ttc, 0), v_remaining), 2);
    v_remaining  := v_remaining - v_imputed;
    v_refund_due := greatest(0, round(COALESCE(r.total_ttc, 0) - v_imputed - COALESCE(r.amount_paid, 0), 2));
    v_cn_status  := CASE WHEN v_refund_due > 0.01 THEN 'due' ELSE 'paid' END;

    UPDATE invoices
    SET amount_credited = v_imputed,
        amount_due      = v_refund_due,
        status          = v_cn_status,
        updated_at      = now()
    WHERE id = r.id
      AND (amount_credited IS DISTINCT FROM v_imputed
        OR amount_due      IS DISTINCT FROM v_refund_due
        OR status          IS DISTINCT FROM v_cn_status);
  END LOOP;
END;
$function$;

--FN-- refresh_presence_complete
CREATE OR REPLACE FUNCTION public.refresh_presence_complete(p_session_id uuid, p_trainee_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total int;
  v_present int;
  v_complete boolean;
BEGIN
  SELECT count(*) INTO v_total FROM session_half_days(p_session_id);

  SELECT count(*) INTO v_present
  FROM session_half_days(p_session_id) hd
  JOIN attendance_halfdays a
    ON a.session_id = p_session_id AND a.trainee_id = p_trainee_id AND a.date = hd.d
  WHERE (hd.period = 'morning' AND a.morning) OR (hd.period = 'afternoon' AND a.afternoon);

  v_complete := (v_total > 0 AND v_present >= v_total);

  UPDATE session_trainees
  SET presence_complete = v_complete
  WHERE session_id = p_session_id AND trainee_id = p_trainee_id;

  RETURN v_complete;
END;
$function$;

--FN-- save_evaluation
CREATE OR REPLACE FUNCTION public.save_evaluation(p_token text, p_trainee_id uuid, p_eval_data jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_session_id uuid;
  v_result json;
BEGIN
  SELECT id INTO v_session_id FROM sessions WHERE attendance_token = p_token;
  IF v_session_id IS NULL THEN RAISE EXCEPTION 'Token invalide'; END IF;
  IF NOT EXISTS (SELECT 1 FROM session_trainees WHERE session_id = v_session_id AND trainee_id = p_trainee_id) THEN
    RAISE EXCEPTION 'Stagiaire non trouvé dans cette session';
  END IF;
  
  INSERT INTO trainee_evaluations (
    session_id, trainee_id, q_org_documents, q_org_accueil, q_org_locaux, q_org_materiel,
    q_contenu_organisation, q_contenu_supports, q_contenu_duree, q_contenu_programme,
    q_formateur_pedagogie, q_formateur_expertise, q_formateur_progression, q_formateur_moyens,
    q_global_adequation, q_global_competences, would_recommend, comment_general, comment_projet,
    questionnaire_submitted, submitted_at, submitted_online
  ) VALUES (
    v_session_id, p_trainee_id,
    (p_eval_data->>'q_org_documents')::integer, (p_eval_data->>'q_org_accueil')::integer,
    (p_eval_data->>'q_org_locaux')::integer, (p_eval_data->>'q_org_materiel')::integer,
    (p_eval_data->>'q_contenu_organisation')::integer, (p_eval_data->>'q_contenu_supports')::integer,
    (p_eval_data->>'q_contenu_duree')::integer, (p_eval_data->>'q_contenu_programme')::integer,
    (p_eval_data->>'q_formateur_pedagogie')::integer, (p_eval_data->>'q_formateur_expertise')::integer,
    (p_eval_data->>'q_formateur_progression')::integer, (p_eval_data->>'q_formateur_moyens')::integer,
    (p_eval_data->>'q_global_adequation')::integer, (p_eval_data->>'q_global_competences')::integer,
    (p_eval_data->>'would_recommend')::boolean, p_eval_data->>'comment_general',
    p_eval_data->>'comment_projet', true, now(), true
  )
  ON CONFLICT (session_id, trainee_id)
  DO UPDATE SET
    q_org_documents = EXCLUDED.q_org_documents, q_org_accueil = EXCLUDED.q_org_accueil,
    q_org_locaux = EXCLUDED.q_org_locaux, q_org_materiel = EXCLUDED.q_org_materiel,
    q_contenu_organisation = EXCLUDED.q_contenu_organisation, q_contenu_supports = EXCLUDED.q_contenu_supports,
    q_contenu_duree = EXCLUDED.q_contenu_duree, q_contenu_programme = EXCLUDED.q_contenu_programme,
    q_formateur_pedagogie = EXCLUDED.q_formateur_pedagogie, q_formateur_expertise = EXCLUDED.q_formateur_expertise,
    q_formateur_progression = EXCLUDED.q_formateur_progression, q_formateur_moyens = EXCLUDED.q_formateur_moyens,
    q_global_adequation = EXCLUDED.q_global_adequation, q_global_competences = EXCLUDED.q_global_competences,
    would_recommend = EXCLUDED.would_recommend, comment_general = EXCLUDED.comment_general,
    comment_projet = EXCLUDED.comment_projet, questionnaire_submitted = true,
    submitted_at = now(), submitted_online = true
  RETURNING to_json(trainee_evaluations.*) INTO v_result;
  
  RETURN v_result;
END;
$function$;

--FN-- save_positioning_test_answers
CREATE OR REPLACE FUNCTION public.save_positioning_test_answers(p_token text, p_trainee_id uuid, p_answers jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_session_id uuid;
  v_answer jsonb;
  v_question record;
  v_is_correct boolean;
  v_score integer;
BEGIN
  -- Vérifier le token
  SELECT id INTO v_session_id
  FROM sessions
  WHERE attendance_token = p_token;
  
  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'Token invalide';
  END IF;
  
  -- Parcourir les réponses
  FOR v_answer IN SELECT * FROM jsonb_array_elements(p_answers)
  LOOP
    -- Récupérer les infos de la question
    SELECT * INTO v_question
    FROM theme_questions
    WHERE id = (v_answer->>'question_id')::uuid;
    
    -- Calculer si correct (pour QCM)
    v_is_correct := NULL;
    v_score := 0;
    
    IF v_question.question_type = 'single_choice' THEN
      v_is_correct := (v_answer->>'selected_option_index')::integer = v_question.correct_index;
      IF v_is_correct THEN
        v_score := v_question.score;
      END IF;
    END IF;
    
    -- Insérer ou mettre à jour la réponse
    INSERT INTO trainee_positioning_tests (
      session_id,
      trainee_id,
      question_id,
      question_type,
      selected_option_index,
      text_answer,
      is_correct,
      score_obtained
    ) VALUES (
      v_session_id,
      p_trainee_id,
      (v_answer->>'question_id')::uuid,
      v_question.question_type,
      (v_answer->>'selected_option_index')::integer,
      v_answer->>'text_answer',
      v_is_correct,
      v_score
    )
    ON CONFLICT (session_id, trainee_id, question_id)
    DO UPDATE SET
      selected_option_index = EXCLUDED.selected_option_index,
      text_answer = EXCLUDED.text_answer,
      is_correct = EXCLUDED.is_correct,
      score_obtained = EXCLUDED.score_obtained,
      answered_at = now();
  END LOOP;
  
  -- Marquer le test comme complété
  UPDATE session_trainees
  SET 
    positioning_test_completed = true,
    positioning_test_completed_at = now()
  WHERE session_id = v_session_id
  AND trainee_id = p_trainee_id;
  
  RETURN json_build_object('success', true);
END;
$function$;

--FN-- save_trainee_info
CREATE OR REPLACE FUNCTION public.save_trainee_info(p_token text, p_trainee_id uuid, p_data jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_session_id uuid;
  v_result json;
BEGIN
  SELECT id INTO v_session_id FROM sessions WHERE attendance_token = p_token;
  IF v_session_id IS NULL THEN RAISE EXCEPTION 'Token invalide'; END IF;
  IF NOT EXISTS (SELECT 1 FROM session_trainees WHERE session_id = v_session_id AND trainee_id = p_trainee_id) THEN
    RAISE EXCEPTION 'Stagiaire non trouvé dans cette session';
  END IF;
  
  INSERT INTO trainee_info_sheets (
    session_id, trainee_id, email, ssn, ssn_refused, last_training_year,
    highest_diploma, csp, job_title, training_expectations, rgpd_consent,
    rgpd_consent_date, filled_at, filled_online
  ) VALUES (
    v_session_id, p_trainee_id, p_data->>'email', p_data->>'ssn',
    COALESCE((p_data->>'ssn_refused')::boolean, false),
    (p_data->>'last_training_year')::integer, p_data->>'highest_diploma',
    p_data->>'csp', p_data->>'job_title', p_data->>'training_expectations',
    COALESCE((p_data->>'rgpd_consent')::boolean, false),
    COALESCE((p_data->>'rgpd_consent_date')::timestamptz, now()),
    COALESCE((p_data->>'filled_at')::timestamptz, now()),
    COALESCE((p_data->>'filled_online')::boolean, true)
  )
  ON CONFLICT (session_id, trainee_id)
  DO UPDATE SET
    email = EXCLUDED.email, ssn = EXCLUDED.ssn, ssn_refused = EXCLUDED.ssn_refused,
    last_training_year = EXCLUDED.last_training_year, highest_diploma = EXCLUDED.highest_diploma,
    csp = EXCLUDED.csp, job_title = EXCLUDED.job_title,
    training_expectations = EXCLUDED.training_expectations, rgpd_consent = EXCLUDED.rgpd_consent,
    rgpd_consent_date = EXCLUDED.rgpd_consent_date, filled_at = EXCLUDED.filled_at,
    filled_online = EXCLUDED.filled_online
  RETURNING to_json(trainee_info_sheets.*) INTO v_result;
  
  RETURN v_result;
END;
$function$;

--FN-- save_trainee_with_ssn
CREATE OR REPLACE FUNCTION public.save_trainee_with_ssn(p_id uuid, p_first_name text, p_last_name text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_ssn text DEFAULT NULL::text, p_client_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_birth_date date DEFAULT NULL::date, p_refused_ssn boolean DEFAULT false, p_has_disability boolean DEFAULT false, p_disability_details text DEFAULT NULL::text, p_disability_adaptations text DEFAULT NULL::text, p_csp text DEFAULT NULL::text, p_job_title text DEFAULT NULL::text, p_gender text DEFAULT 'male'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- Mettre à jour le stagiaire
  UPDATE trainees
  SET
    first_name = p_first_name,
    last_name = p_last_name,
    email = p_email,
    phone = p_phone,
    social_security_number = CASE 
      WHEN p_ssn IS NOT NULL THEN encode(encrypt(p_ssn::bytea, 'votre_clé_secrète'::bytea, 'aes'), 'base64')
      ELSE NULL
    END,
    client_id = p_client_id,
    notes = p_notes,
    birth_date = p_birth_date,
    refused_ssn = p_refused_ssn,
    has_disability = p_has_disability,
    disability_details = p_disability_details,
    disability_adaptations = p_disability_adaptations,
    csp = p_csp,
    job_title = p_job_title,
    gender = p_gender,
    updated_at = NOW()
  WHERE id = p_id;
END;
$function$;

--FN-- save_widget_configs
CREATE OR REPLACE FUNCTION public.save_widget_configs(p_user_id uuid, p_configs jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  config JSONB;
BEGIN
  FOR config IN SELECT * FROM jsonb_array_elements(p_configs)
  LOOP
    INSERT INTO dashboard_widget_configs (user_id, widget_id, position, size, visible, updated_at)
    VALUES (
      p_user_id,
      config->>'widget_id',
      (config->>'position')::INTEGER,
      COALESCE(config->>'size', 'md'),
      COALESCE((config->>'visible')::BOOLEAN, true),
      now()
    )
    ON CONFLICT (user_id, widget_id)
    DO UPDATE SET
      position = EXCLUDED.position,
      size = EXCLUDED.size,
      visible = EXCLUDED.visible,
      updated_at = now();
  END LOOP;
END;
$function$;

--FN-- session_half_days
CREATE OR REPLACE FUNCTION public.session_half_days(p_session_id uuid)
 RETURNS TABLE(d date, period text, label text)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  s record;
  v_days date[];
  v_total int;
  v_remaining int;
  v_half_period text;
  v_day date;
BEGIN
  SELECT se.start_date, se.end_date, se.day_type, se.start_time,
         coalesce(c.duration_hours, c.duration, 7) AS duration_hours
  INTO s
  FROM sessions se LEFT JOIN courses c ON c.id = se.course_id
  WHERE se.id = p_session_id;

  IF s.start_date IS NULL OR s.end_date IS NULL THEN RETURN; END IF;

  SELECT array_agg(g::date ORDER BY g) INTO v_days
  FROM generate_series(s.start_date, s.end_date, interval '1 day') g;

  v_half_period := CASE WHEN s.day_type = 'half' AND extract(hour FROM coalesce(s.start_time, '09:00'::time)) >= 12
                        THEN 'afternoon' ELSE 'morning' END;

  v_total := CASE WHEN s.day_type = 'half'
                  THEN array_length(v_days, 1)
                  ELSE ceil(s.duration_hours / 3.5)::int END;
  v_remaining := v_total;

  FOREACH v_day IN ARRAY v_days LOOP
    EXIT WHEN v_remaining <= 0;
    IF s.day_type = 'half' THEN
      d := v_day; period := v_half_period;
      label := CASE WHEN v_half_period = 'afternoon' THEN 'Après-midi' ELSE 'Matin' END;
      v_remaining := v_remaining - 1;
      RETURN NEXT;
    ELSE
      IF v_remaining > 0 THEN
        d := v_day; period := 'morning'; label := 'Matin';
        v_remaining := v_remaining - 1;
        RETURN NEXT;
      END IF;
      IF v_remaining > 0 THEN
        d := v_day; period := 'afternoon'; label := 'Après-midi';
        v_remaining := v_remaining - 1;
        RETURN NEXT;
      END IF;
    END IF;
  END LOOP;
END;
$function$;

--FN-- session_missing_signatures
CREATE OR REPLACE FUNCTION public.session_missing_signatures(p_session_id uuid, p_date date)
 RETURNS TABLE(trainee_id uuid, trainee_name text, period text, label text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT tr.id,
         tr.first_name || ' ' || upper(coalesce(tr.last_name, '')),
         hd.period,
         hd.label
  FROM session_half_days(p_session_id) hd
  JOIN session_trainees st ON st.session_id = p_session_id AND NOT coalesce(st.absent, false)
  JOIN trainees tr ON tr.id = st.trainee_id
  LEFT JOIN attendance_halfdays a
    ON a.session_id = p_session_id AND a.trainee_id = tr.id AND a.date = hd.d
  LEFT JOIN attendance_proxy_signatures p
    ON p.session_id = p_session_id AND p.trainee_id = tr.id AND p.date = hd.d AND p.period = hd.period
  WHERE hd.d = p_date
    AND p.id IS NULL
    AND CASE WHEN hd.period = 'morning' THEN a.signature_morning ELSE a.signature_afternoon END IS NULL
  ORDER BY tr.last_name, tr.first_name, CASE WHEN hd.period = 'morning' THEN 0 ELSE 1 END;
$function$;

--FN-- set_bank_statements_updated_at
CREATE OR REPLACE FUNCTION public.set_bank_statements_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

--FN-- set_trainee_absent
CREATE OR REPLACE FUNCTION public.set_trainee_absent(p_session_id uuid, p_trainee_id uuid, p_absent boolean, p_reason text DEFAULT NULL::text, p_by text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Connexion Campus requise');
  END IF;

  UPDATE session_trainees
  SET absent = p_absent,
      absent_at = CASE WHEN p_absent THEN now() END,
      absent_by = CASE WHEN p_absent THEN p_by END,
      absent_reason = CASE WHEN p_absent THEN nullif(trim(p_reason), '') END
  WHERE session_id = p_session_id AND trainee_id = p_trainee_id;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'Stagiaire non inscrit à cette session');
  END IF;

  RETURN json_build_object('ok', true, 'absent', p_absent);
END;
$function$;

--FN-- signature_alert_mark_sent
CREATE OR REPLACE FUNCTION public.signature_alert_mark_sent(p_session_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  INSERT INTO signature_alerts_sent (session_id, alert_date)
  VALUES (p_session_id, paris_today())
  ON CONFLICT (session_id, alert_date) DO NOTHING
  RETURNING true;
$function$;

--FN-- signature_alerts_due
CREATE OR REPLACE FUNCTION public.signature_alerts_due()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v json;
  v_today date := paris_today();
  v_now time := paris_time();
BEGIN
  SELECT coalesce(json_agg(x), '[]'::json) INTO v
  FROM (
    SELECT json_build_object(
      'session_id', s.id,
      'reference', s.reference,
      'course', c.title,
      'client', cl.name,
      'date', v_today,
      'end_time', to_char(s.end_time, 'HH24:MI'),
      'trainer_name', trim(coalesce(tr.first_name, '') || ' ' || coalesce(tr.last_name, '')),
      'trainer_email', tr.email,
      'manquants', (
        SELECT coalesce(json_agg(json_build_object(
          'stagiaire', m.trainee_name, 'demi_journee', m.label) ORDER BY m.trainee_name), '[]'::json)
        FROM session_missing_signatures(s.id, v_today) m
      )
    ) AS x
    FROM sessions s
    LEFT JOIN courses c ON c.id = s.course_id
    LEFT JOIN clients cl ON cl.id = s.client_id
    LEFT JOIN trainers tr ON tr.id = s.trainer_id
    WHERE coalesce(s.status, 'planned') <> 'cancelled'
      AND coalesce(s.session_type, 'intra') <> 'subcontract'
      AND v_today BETWEEN s.start_date AND s.end_date
      -- fenêtre : 30 min avant la fin, jusqu'à la fin
      AND v_now >= coalesce(s.end_time, '17:00'::time) - interval '30 minutes'
      AND v_now <  coalesce(s.end_time, '17:00'::time)
      -- alerte pas encore envoyée aujourd'hui
      AND NOT EXISTS (SELECT 1 FROM signature_alerts_sent a
                      WHERE a.session_id = s.id AND a.alert_date = v_today)
      -- il reste au moins une signature à recueillir
      AND EXISTS (SELECT 1 FROM session_missing_signatures(s.id, v_today))
  ) z;

  RETURN v;
END;
$function$;

--FN-- signature_refusal
CREATE OR REPLACE FUNCTION public.signature_refusal(p_session_id uuid, p_trainee_id uuid, p_date date, p_period text, p_signature text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s record;
  st record;
  v_start timestamptz;
  v_signed boolean;
BEGIN
  IF p_period NOT IN ('morning', 'afternoon') THEN RETURN 'Demi-journée inconnue'; END IF;
  IF p_signature IS NULL OR length(p_signature) < 100 OR p_signature NOT LIKE 'data:image/%' THEN
    RETURN 'Signature manquante ou illisible';
  END IF;

  SELECT id, start_date, end_date, start_time, day_type INTO s
  FROM sessions WHERE id = p_session_id;
  IF s.id IS NULL THEN RETURN 'Session introuvable'; END IF;

  SELECT absent, early_departure, departure_date INTO st
  FROM session_trainees WHERE session_id = p_session_id AND trainee_id = p_trainee_id;
  IF st IS NULL THEN RETURN 'Stagiaire non inscrit à cette session'; END IF;
  IF st.absent THEN RETURN 'Stagiaire noté absent sur cette session'; END IF;
  IF st.early_departure AND st.departure_date IS NOT NULL AND p_date > st.departure_date THEN
    RETURN 'Stagiaire parti le ' || to_char(st.departure_date, 'DD/MM/YYYY');
  END IF;

  IF p_date < s.start_date OR p_date > s.end_date THEN RETURN 'Date hors de la session'; END IF;
  IF p_date > paris_today() THEN RETURN 'Impossible de signer une demi-journée à venir'; END IF;

  IF NOT EXISTS (SELECT 1 FROM session_half_days(p_session_id) hd WHERE hd.d = p_date AND hd.period = p_period) THEN
    RETURN 'Cette demi-journée ne fait pas partie de la formation';
  END IF;

  v_start := (s.start_date + coalesce(s.start_time, '09:00'::time)) AT TIME ZONE 'Europe/Paris';
  IF now() < v_start - interval '1 hour' THEN
    RETURN 'La formation n''a pas encore commencé';
  END IF;

  SELECT CASE WHEN p_period = 'morning' THEN signature_morning IS NOT NULL
              ELSE signature_afternoon IS NOT NULL END
  INTO v_signed
  FROM attendance_halfdays
  WHERE session_id = p_session_id AND trainee_id = p_trainee_id AND date = p_date;
  IF coalesce(v_signed, false) THEN RETURN 'Cette demi-journée est déjà signée'; END IF;

  RETURN NULL;
END;
$function$;

--FN-- signature_tick
CREATE OR REPLACE FUNCTION public.signature_tick()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_due json := signature_alerts_due();
BEGIN
  IF json_array_length(v_due) > 0 THEN
    PERFORM cron_call_vercel('/api/signature-alert');
    RETURN json_build_object('appel', true, 'sessions', json_array_length(v_due));
  END IF;
  RETURN json_build_object('appel', false);
END;
$function$;

--FN-- signature_weekly_report
CREATE OR REPLACE FUNCTION public.signature_weekly_report(p_days integer DEFAULT 90)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v json;
BEGIN
  WITH manquants AS (
    SELECT s.id AS session_id, s.reference, s.start_date, s.end_date,
           c.title AS course, cl.name AS client,
           cl.contact_name, cl.contact_email, cl.contact_phone,
           m.trainee_name, m.label, hd.d AS jour
    FROM sessions s
    LEFT JOIN courses c ON c.id = s.course_id
    LEFT JOIN clients cl ON cl.id = s.client_id
    CROSS JOIN LATERAL session_half_days(s.id) hd
    CROSS JOIN LATERAL session_missing_signatures(s.id, hd.d) m
    WHERE coalesce(s.status, 'planned') <> 'cancelled'
      AND coalesce(s.session_type, 'intra') <> 'subcontract'
      AND s.end_date < paris_today()
      AND s.end_date >= paris_today() - p_days
  )
  SELECT coalesce(json_agg(x ORDER BY x->>'client'), '[]'::json) INTO v
  FROM (
    SELECT json_build_object(
      'client', coalesce(client, 'Sans client'),
      'contact', contact_name,
      'contact_email', contact_email,
      'contact_phone', contact_phone,
      'sessions', json_agg(DISTINCT jsonb_build_object(
        'session_id', session_id, 'reference', reference, 'course', course,
        'start_date', start_date, 'end_date', end_date))
    ) AS x,
    (SELECT count(*) FROM manquants m2 WHERE coalesce(m2.client, 'Sans client') = coalesce(m.client, 'Sans client')) AS nb
    FROM manquants m
    GROUP BY client, contact_name, contact_email, contact_phone
  ) z;

  RETURN v;
END;
$function$;

--FN-- signature_weekly_tick
CREATE OR REPLACE FUNCTION public.signature_weekly_tick()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v json := signature_weekly_report();
BEGIN
  IF json_array_length(v) > 0 THEN
    PERFORM cron_call_vercel('/api/signature-weekly');
    RETURN json_build_object('appel', true, 'entreprises', json_array_length(v));
  END IF;
  RETURN json_build_object('appel', false);
END;
$function$;

--FN-- social_tick
CREATE OR REPLACE FUNCTION public.social_tick()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM social_posts WHERE status = 'scheduled' AND scheduled_at <= now()) THEN
    PERFORM cron_call_vercel('/api/social/cron-publish');
    RETURN true;
  END IF;
  RETURN false;
END;
$function$;

--FN-- sync_info_sheet_to_trainee
CREATE OR REPLACE FUNCTION public.sync_info_sheet_to_trainee()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- Mise à jour de la table trainees
    UPDATE trainees
    SET
        email = COALESCE(NULLIF(NEW.email, ''), trainees.email),
        job_title = COALESCE(NULLIF(NEW.job_title, ''), trainees.job_title),
        csp = COALESCE(NULLIF(NEW.csp, ''), trainees.csp),
        social_security_number = COALESCE(NULLIF(NEW.ssn, ''), trainees.social_security_number),
        refused_ssn = COALESCE(NEW.ssn_refused, trainees.refused_ssn),
        updated_at = NOW()
    WHERE id = NEW.trainee_id;
    
    RETURN NEW;
END;
$function$;

--FN-- sync_trainee_to_info_sheets
CREATE OR REPLACE FUNCTION public.sync_trainee_to_info_sheets()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- Mise à jour de toutes les fiches trainee_info_sheets
    UPDATE trainee_info_sheets
    SET
        email = NEW.email,
        job_title = NEW.job_title,
        csp = NEW.csp,
        ssn = NEW.social_security_number,
        ssn_refused = NEW.refused_ssn
    WHERE trainee_id = NEW.id
        AND (
            -- Seulement si les valeurs sont vraiment différentes
            COALESCE(email, '') != COALESCE(NEW.email, '')
            OR COALESCE(job_title, '') != COALESCE(NEW.job_title, '')
            OR COALESCE(csp, '') != COALESCE(NEW.csp, '')
            OR COALESCE(ssn, '') != COALESCE(NEW.social_security_number, '')
            OR COALESCE(ssn_refused, false) != COALESCE(NEW.refused_ssn, false)
        );
    
    RETURN NEW;
END;
$function$;

--FN-- trainer_proxy_sign
CREATE OR REPLACE FUNCTION public.trainer_proxy_sign(p_session_id uuid, p_trainee_id uuid, p_date date, p_period text, p_reason text, p_proxy_last_name text, p_proxy_first_name text, p_proxy_role text, p_proxy_signature text, p_trainer_signature text, p_validated_by text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_refus text;
  v_end date;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Connexion Campus requise');
  END IF;

  IF coalesce(trim(p_reason), '') = '' THEN
    RETURN json_build_object('ok', false, 'error', 'Motif obligatoire');
  END IF;
  IF coalesce(trim(p_proxy_last_name), '') = '' OR coalesce(trim(p_proxy_first_name), '') = ''
     OR coalesce(trim(p_proxy_role), '') = '' THEN
    RETURN json_build_object('ok', false, 'error', 'Nom, prénom et qualité du tiers obligatoires');
  END IF;
  IF p_trainer_signature IS NULL OR length(p_trainer_signature) < 100
     OR p_trainer_signature NOT LIKE 'data:image/%' THEN
    RETURN json_build_object('ok', false, 'error', 'Signature du formateur manquante');
  END IF;

  v_refus := signature_refusal(p_session_id, p_trainee_id, p_date, p_period, p_proxy_signature);
  IF v_refus IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', v_refus);
  END IF;

  SELECT end_date INTO v_end FROM sessions WHERE id = p_session_id;
  IF paris_today() > v_end AND NOT is_signature_admin() THEN
    RETURN json_build_object('ok', false,
      'error', 'Session terminée : la régularisation se fait depuis le compte de Hicham SAIDI');
  END IF;

  INSERT INTO attendance_proxy_signatures (
    session_id, trainee_id, date, period, reason,
    proxy_last_name, proxy_first_name, proxy_role,
    proxy_signature, trainer_signature, created_by)
  VALUES (
    p_session_id, p_trainee_id, p_date, p_period, trim(p_reason),
    upper(trim(p_proxy_last_name)), trim(p_proxy_first_name), trim(p_proxy_role),
    p_proxy_signature, p_trainer_signature,
    coalesce(nullif(trim(p_validated_by), ''), 'Signature par un tiers'))
  ON CONFLICT (session_id, trainee_id, date, period) DO UPDATE SET
    reason = EXCLUDED.reason,
    proxy_last_name = EXCLUDED.proxy_last_name,
    proxy_first_name = EXCLUDED.proxy_first_name,
    proxy_role = EXCLUDED.proxy_role,
    proxy_signature = EXCLUDED.proxy_signature,
    trainer_signature = EXCLUDED.trainer_signature,
    created_by = EXCLUDED.created_by,
    created_at = now();

  PERFORM write_halfday_signature(
    p_session_id, p_trainee_id, p_date, p_period, p_proxy_signature, now(),
    coalesce(nullif(trim(p_validated_by), ''), 'Signature par un tiers'));

  RETURN json_build_object('ok', true);
END;
$function$;

--FN-- trainer_sign_halfday
CREATE OR REPLACE FUNCTION public.trainer_sign_halfday(p_session_id uuid, p_trainee_id uuid, p_date date, p_period text, p_signature text, p_signed_at timestamp with time zone DEFAULT now(), p_validated_by text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_refus text;
  v_end date;
  v_at timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Connexion Campus requise');
  END IF;

  v_refus := signature_refusal(p_session_id, p_trainee_id, p_date, p_period, p_signature);
  IF v_refus IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', v_refus);
  END IF;

  SELECT end_date INTO v_end FROM sessions WHERE id = p_session_id;
  IF paris_today() > v_end AND NOT is_signature_admin() THEN
    RETURN json_build_object('ok', false,
      'error', 'Session terminée : la régularisation se fait depuis le compte de Hicham SAIDI');
  END IF;

  -- Heure réelle de la signature, bornée : jamais dans le futur, jamais avant la demi-journée
  v_at := least(coalesce(p_signed_at, now()), now());
  IF v_at < (p_date::timestamp AT TIME ZONE 'Europe/Paris') THEN
    v_at := now();
  END IF;

  PERFORM write_halfday_signature(
    p_session_id, p_trainee_id, p_date, p_period, p_signature, v_at,
    coalesce(nullif(trim(p_validated_by), ''), 'Signature sur téléphone'));

  RETURN json_build_object('ok', true, 'signed_at', v_at);
END;
$function$;

--FN-- trg_invoices_credit_sync
CREATE OR REPLACE FUNCTION public.trg_invoices_credit_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Les mises à jour faites par recompute_invoice_credits ne relancent rien
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.type = 'credit_note' THEN
      PERFORM recompute_invoice_credits(OLD.parent_invoice_id);
    END IF;
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.type = 'credit_note'
     AND OLD.parent_invoice_id IS DISTINCT FROM NEW.parent_invoice_id THEN
    PERFORM recompute_invoice_credits(OLD.parent_invoice_id);
  END IF;

  IF NEW.type = 'credit_note' THEN
    PERFORM recompute_invoice_credits(NEW.parent_invoice_id);
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM recompute_invoice_credits(NEW.id);
  END IF;

  RETURN NULL;
END;
$function$;

--FN-- trg_mailing_unsubscribe_blocklist
CREATE OR REPLACE FUNCTION public.trg_mailing_unsubscribe_blocklist()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.unsubscribed_at IS NOT NULL AND NEW.email IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.unsubscribed_at IS NULL) THEN
    INSERT INTO mailing_blocklist (kind, value, category, note, created_by)
    VALUES ('email', lower(trim(NEW.email)), 'desabonne',
            'Désabonnement du ' || to_char(NEW.unsubscribed_at, 'DD/MM/YYYY'), 'lien de désabonnement')
    ON CONFLICT (kind, value) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

--FN-- trg_psh_updated_at
CREATE OR REPLACE FUNCTION public.trg_psh_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

--FN-- trigger_generate_code
CREATE OR REPLACE FUNCTION public.trigger_generate_code()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.access_code IS NULL THEN
        NEW.access_code := generate_access_code();
        NEW.code_generated_at := NOW();
    END IF;
    RETURN NEW;
END;
$function$;

--FN-- trigger_generate_inter_reference
CREATE OR REPLACE FUNCTION public.trigger_generate_inter_reference()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Si c'est une session INTER et pas de référence
  IF NEW.session_type = 'inter' AND (NEW.reference IS NULL OR NEW.reference = '') THEN
    NEW.reference := generate_inter_session_reference();
  END IF;
  
  RETURN NEW;
END;
$function$;

--FN-- update_client_on_invoice_created
CREATE OR REPLACE FUNCTION public.update_client_on_invoice_created()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status = 'draft' AND NEW.session_id IS NOT NULL THEN
    UPDATE clients 
    SET status = 'actif', updated_at = now()
    WHERE id = NEW.client_id 
    AND status IN ('prospect', 'en_discussion', 'a_completer');
  END IF;
  RETURN NEW;
END;
$function$;

--FN-- update_client_on_quote_accepted
CREATE OR REPLACE FUNCTION public.update_client_on_quote_accepted()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status = 'accepted' AND OLD.status != 'accepted' THEN
    UPDATE clients 
    SET status = CASE 
      WHEN status = 'prospect' THEN 'en_discussion'
      ELSE status 
    END,
    updated_at = now()
    WHERE id = NEW.client_id;
  END IF;
  RETURN NEW;
END;
$function$;

--FN-- update_client_on_session_created
CREATE OR REPLACE FUNCTION public.update_client_on_session_created()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE clients 
  SET status = 'actif', updated_at = now()
  WHERE id = NEW.client_id 
  AND status IN ('prospect', 'en_discussion', 'a_completer');
  RETURN NEW;
END;
$function$;

--FN-- update_course_documents_updated_at
CREATE OR REPLACE FUNCTION public.update_course_documents_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

--FN-- update_needs_analysis_updated_at
CREATE OR REPLACE FUNCTION public.update_needs_analysis_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

--FN-- update_prospect_calls_updated_at
CREATE OR REPLACE FUNCTION public.update_prospect_calls_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

--FN-- update_prospect_needs_analysis_updated_at
CREATE OR REPLACE FUNCTION public.update_prospect_needs_analysis_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$;

--FN-- update_prospect_rdv_updated_at
CREATE OR REPLACE FUNCTION public.update_prospect_rdv_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$;

--FN-- update_prospection_updated_at
CREATE OR REPLACE FUNCTION public.update_prospection_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

--FN-- update_qualiopi_documents_updated_at
CREATE OR REPLACE FUNCTION public.update_qualiopi_documents_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

--FN-- update_quality_documents_updated_at
CREATE OR REPLACE FUNCTION public.update_quality_documents_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

--FN-- update_session_checklists_updated_at
CREATE OR REPLACE FUNCTION public.update_session_checklists_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

--FN-- update_session_fundings_timestamp
CREATE OR REPLACE FUNCTION public.update_session_fundings_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

--FN-- update_session_groups_updated_at
CREATE OR REPLACE FUNCTION public.update_session_groups_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

--FN-- update_sst_certifications_updated_at
CREATE OR REPLACE FUNCTION public.update_sst_certifications_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

--FN-- update_trainee_data
CREATE OR REPLACE FUNCTION public.update_trainee_data(p_token text, p_trainee_id uuid, p_data jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_session_id uuid;
  v_result json;
BEGIN
  -- Vérifier que le token est valide
  SELECT id INTO v_session_id
  FROM sessions
  WHERE attendance_token = p_token;
  
  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'Token invalide';
  END IF;
  
  -- Vérifier que le trainee appartient à cette session
  IF NOT EXISTS (
    SELECT 1 FROM session_trainees
    WHERE session_id = v_session_id AND trainee_id = p_trainee_id
  ) THEN
    RAISE EXCEPTION 'Stagiaire non trouvé dans cette session';
  END IF;
  
  -- Mettre à jour les données du stagiaire
  UPDATE trainees SET
    first_name = COALESCE(p_data->>'first_name', first_name),
    last_name = COALESCE(p_data->>'last_name', last_name),
    email = COALESCE(p_data->>'email', email),
    phone = COALESCE(p_data->>'phone', phone),
    birth_date = COALESCE((p_data->>'birth_date')::date, birth_date),
    social_security_number = COALESCE(p_data->>'social_security_number', social_security_number),
    refused_ssn = COALESCE((p_data->>'refused_ssn')::boolean, refused_ssn),
    csp = COALESCE(p_data->>'csp', csp),
    job_title = COALESCE(p_data->>'job_title', job_title),
    gender = COALESCE(p_data->>'gender', gender),
    updated_at = now()
  WHERE id = p_trainee_id
  RETURNING to_json(trainees.*) INTO v_result;
  
  RETURN v_result;
END;
$function$;

--FN-- update_trainee_last_session
CREATE OR REPLACE FUNCTION public.update_trainee_last_session()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
BEGIN
  -- Mettre à jour la date de dernière session pour le stagiaire
  UPDATE trainees t
  SET last_session_date = (
    SELECT MAX(s.end_date)
    FROM session_trainees st
    JOIN sessions s ON s.id = st.session_id
    WHERE st.trainee_id = t.id
    AND s.end_date IS NOT NULL
  )
  WHERE t.id = NEW.trainee_id;
  
  RETURN NEW;
END;
$function$;

--FN-- update_updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

--FN-- update_updated_at_column
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$;

--FN-- update_user_email_configs_updated_at
CREATE OR REPLACE FUNCTION public.update_user_email_configs_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$function$;

--FN-- verify_trainee_access_code
CREATE OR REPLACE FUNCTION public.verify_trainee_access_code(p_session_trainee_id uuid, p_access_code character varying)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_session_trainee RECORD;
BEGIN
    SELECT * INTO v_session_trainee
    FROM session_trainees
    WHERE id = p_session_trainee_id
    FOR UPDATE;
    
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Stagiaire non trouvé');
    END IF;
    
    IF v_session_trainee.access_code_locked = true THEN
        RETURN json_build_object(
            'success', false, 
            'error', 'Compte verrouillé. Contactez l''administrateur.'
        );
    END IF;
    
    IF v_session_trainee.access_code = p_access_code THEN
        UPDATE session_trainees
        SET access_code_attempts = 0,
            access_code_locked = false
        WHERE id = p_session_trainee_id;
        
        RETURN json_build_object('success', true);
    ELSE
        UPDATE session_trainees
        SET access_code_attempts = COALESCE(access_code_attempts, 0) + 1,
            access_code_locked = CASE 
                WHEN COALESCE(access_code_attempts, 0) + 1 >= 5 
                THEN true
                ELSE false
            END,
            access_code_locked_at = CASE 
                WHEN COALESCE(access_code_attempts, 0) + 1 >= 5 
                THEN NOW()
                ELSE NULL
            END
        WHERE id = p_session_trainee_id;
        
        IF COALESCE(v_session_trainee.access_code_attempts, 0) + 1 >= 5 THEN
            RETURN json_build_object(
                'success', false,
                'error', 'Trop de tentatives. Compte verrouillé.'
            );
        ELSE
            RETURN json_build_object(
                'success', false,
                'error', 'Code incorrect',
                'attempts_remaining', 5 - (COALESCE(v_session_trainee.access_code_attempts, 0) + 1)
            );
        END IF;
    END IF;
END;
$function$;

--FN-- write_halfday_signature
CREATE OR REPLACE FUNCTION public.write_halfday_signature(p_session_id uuid, p_trainee_id uuid, p_date date, p_period text, p_signature text, p_signed_at timestamp with time zone, p_validated_by text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO attendance_halfdays (
    session_id, trainee_id, date, morning, afternoon,
    signature_morning, signature_afternoon, signed_morning_at, signed_afternoon_at,
    validated_by, validated_at)
  VALUES (
    p_session_id, p_trainee_id, p_date,
    p_period = 'morning', p_period = 'afternoon',
    CASE WHEN p_period = 'morning'   THEN p_signature END,
    CASE WHEN p_period = 'afternoon' THEN p_signature END,
    CASE WHEN p_period = 'morning'   THEN p_signed_at END,
    CASE WHEN p_period = 'afternoon' THEN p_signed_at END,
    p_validated_by, now())
  ON CONFLICT (session_id, trainee_id, date) DO UPDATE SET
    morning             = CASE WHEN p_period = 'morning'   THEN true ELSE attendance_halfdays.morning END,
    afternoon           = CASE WHEN p_period = 'afternoon' THEN true ELSE attendance_halfdays.afternoon END,
    signature_morning   = CASE WHEN p_period = 'morning'   THEN p_signature ELSE attendance_halfdays.signature_morning END,
    signature_afternoon = CASE WHEN p_period = 'afternoon' THEN p_signature ELSE attendance_halfdays.signature_afternoon END,
    signed_morning_at   = CASE WHEN p_period = 'morning'   THEN p_signed_at ELSE attendance_halfdays.signed_morning_at END,
    signed_afternoon_at = CASE WHEN p_period = 'afternoon' THEN p_signed_at ELSE attendance_halfdays.signed_afternoon_at END,
    validated_by        = p_validated_by,
    validated_at        = now();

  PERFORM refresh_presence_complete(p_session_id, p_trainee_id);
END;
$function$;

-- Triggers
CREATE TRIGGER trg_bank_statements_updated_at BEFORE UPDATE ON public.bank_statements FOR EACH ROW EXECUTE FUNCTION set_bank_statements_updated_at();
CREATE TRIGGER trg_call_arguments_updated_at BEFORE UPDATE ON public.call_arguments FOR EACH ROW EXECUTE FUNCTION phoning_set_updated_at();
CREATE TRIGGER trg_call_objections_updated_at BEFORE UPDATE ON public.call_objections FOR EACH ROW EXECUTE FUNCTION phoning_set_updated_at();
CREATE TRIGGER trg_client_providers_updated_at BEFORE UPDATE ON public.client_providers FOR EACH ROW EXECUTE FUNCTION phoning_set_updated_at();
CREATE TRIGGER trigger_clients_updated BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trigger_course_documents_updated_at BEFORE UPDATE ON public.course_documents FOR EACH ROW EXECUTE FUNCTION update_course_documents_updated_at();
CREATE TRIGGER trigger_courses_updated BEFORE UPDATE ON public.courses FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_duerp_actions_updated_at BEFORE UPDATE ON public.duerp_actions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_duerp_projects_updated_at BEFORE UPDATE ON public.duerp_projects FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_duerp_risks_updated_at BEFORE UPDATE ON public.duerp_risks FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_invoice_activate_client AFTER INSERT ON public.invoices FOR EACH ROW EXECUTE FUNCTION auto_activate_client_on_invoice();
CREATE TRIGGER trg_invoice_client_actif AFTER INSERT ON public.invoices FOR EACH ROW EXECUTE FUNCTION update_client_on_invoice_created();
CREATE TRIGGER trg_invoices_credit_sync AFTER INSERT OR DELETE OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION trg_invoices_credit_sync();
CREATE TRIGGER trg_mailing_unsubscribe_blocklist AFTER INSERT OR UPDATE OF unsubscribed_at ON public.mailing_sends FOR EACH ROW EXECUTE FUNCTION trg_mailing_unsubscribe_blocklist();
CREATE TRIGGER trigger_nc_reference BEFORE INSERT ON public.non_conformities FOR EACH ROW WHEN ((new.reference IS NULL)) EXECUTE FUNCTION generate_nc_reference();
CREATE TRIGGER trigger_nc_updated BEFORE UPDATE ON public.non_conformities FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trigger_org_updated BEFORE UPDATE ON public.organization_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_phoning_sessions_updated_at BEFORE UPDATE ON public.phoning_sessions FOR EACH ROW EXECUTE FUNCTION phoning_set_updated_at();
CREATE TRIGGER prospect_calls_updated_at BEFORE UPDATE ON public.prospect_calls FOR EACH ROW EXECUTE FUNCTION update_prospect_calls_updated_at();
CREATE TRIGGER trigger_prospect_needs_analysis_updated BEFORE UPDATE ON public.prospect_needs_analysis FOR EACH ROW EXECUTE FUNCTION update_prospect_needs_analysis_updated_at();
CREATE TRIGGER trigger_prospect_rdv_updated BEFORE UPDATE ON public.prospect_rdv FOR EACH ROW EXECUTE FUNCTION update_prospect_rdv_updated_at();
CREATE TRIGGER trg_auto_gere_par BEFORE INSERT ON public.prospection_massive FOR EACH ROW EXECUTE FUNCTION auto_mark_gere_par();
CREATE TRIGGER trigger_prospection_updated_at BEFORE UPDATE ON public.prospection_massive FOR EACH ROW EXECUTE FUNCTION update_prospection_updated_at();
CREATE TRIGGER psh_updated_at BEFORE UPDATE ON public.psh_requests FOR EACH ROW EXECUTE FUNCTION trg_psh_updated_at();
CREATE TRIGGER trg_psh_reference BEFORE INSERT ON public.psh_requests FOR EACH ROW WHEN ((new.reference IS NULL)) EXECUTE FUNCTION generate_psh_reference();
CREATE TRIGGER trigger_qualiopi_documents_updated_at BEFORE UPDATE ON public.qualiopi_documents FOR EACH ROW EXECUTE FUNCTION update_qualiopi_documents_updated_at();
CREATE TRIGGER trigger_quality_documents_updated_at BEFORE UPDATE ON public.quality_documents FOR EACH ROW EXECUTE FUNCTION update_quality_documents_updated_at();
CREATE TRIGGER trg_quote_accepted AFTER UPDATE ON public.quotes FOR EACH ROW EXECUTE FUNCTION update_client_on_quote_accepted();
CREATE TRIGGER trg_rdv_kit_documents_updated_at BEFORE UPDATE ON public.rdv_kit_documents FOR EACH ROW EXECUTE FUNCTION rdv_kit_documents_set_updated_at();
CREATE TRIGGER on_new_reclamation AFTER INSERT ON public.reclamations FOR EACH ROW EXECUTE FUNCTION notify_new_reclamation();
CREATE TRIGGER trg_reclamation_reference BEFORE INSERT ON public.reclamations FOR EACH ROW WHEN ((new.reference IS NULL)) EXECUTE FUNCTION generate_reclamation_reference();
CREATE TRIGGER session_checklists_updated_at BEFORE UPDATE ON public.session_checklists FOR EACH ROW EXECUTE FUNCTION update_session_checklists_updated_at();
CREATE TRIGGER session_emails_updated_at BEFORE UPDATE ON public.session_emails_sent FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_session_fundings_updated BEFORE UPDATE ON public.session_fundings FOR EACH ROW EXECUTE FUNCTION update_session_fundings_timestamp();
CREATE TRIGGER session_groups_updated_at BEFORE UPDATE ON public.session_groups FOR EACH ROW EXECUTE FUNCTION update_session_groups_updated_at();
CREATE TRIGGER needs_analysis_updated_at BEFORE UPDATE ON public.session_needs_analysis FOR EACH ROW EXECUTE FUNCTION update_needs_analysis_updated_at();
CREATE TRIGGER trg_auto_create_info_sheet AFTER INSERT ON public.session_trainees FOR EACH ROW EXECUTE FUNCTION auto_create_info_sheet();
CREATE TRIGGER trg_generate_access_code BEFORE INSERT ON public.session_trainees FOR EACH ROW EXECUTE FUNCTION trigger_generate_code();
CREATE TRIGGER trigger_update_trainee_last_session AFTER INSERT OR UPDATE ON public.session_trainees FOR EACH ROW EXECUTE FUNCTION update_trainee_last_session();
CREATE TRIGGER set_session_reference BEFORE INSERT ON public.sessions FOR EACH ROW WHEN ((new.reference IS NULL)) EXECUTE FUNCTION generate_session_reference_v3();
CREATE TRIGGER trg_session_activate_client AFTER INSERT ON public.sessions FOR EACH ROW EXECUTE FUNCTION auto_activate_client_on_session();
CREATE TRIGGER trg_session_client_actif AFTER INSERT ON public.sessions FOR EACH ROW EXECUTE FUNCTION update_client_on_session_created();
CREATE TRIGGER trigger_generate_inter_reference BEFORE INSERT OR UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION trigger_generate_inter_reference();
CREATE TRIGGER trigger_session_reference BEFORE INSERT ON public.sessions FOR EACH ROW WHEN ((new.reference IS NULL)) EXECUTE FUNCTION generate_session_reference();
CREATE TRIGGER trigger_sessions_updated BEFORE UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trigger_auto_validate_sst BEFORE INSERT OR UPDATE ON public.sst_certifications FOR EACH ROW EXECUTE FUNCTION auto_validate_sst_certification();
CREATE TRIGGER trigger_sst_certifications_updated BEFORE UPDATE ON public.sst_certifications FOR EACH ROW EXECUTE FUNCTION update_sst_certifications_updated_at();
CREATE TRIGGER trg_sync_info_sheet_to_trainee AFTER INSERT OR UPDATE ON public.trainee_info_sheets FOR EACH ROW EXECUTE FUNCTION sync_info_sheet_to_trainee();
CREATE TRIGGER sync_trainee_data AFTER UPDATE ON public.trainees FOR EACH ROW WHEN ((((old.email)::text IS DISTINCT FROM (new.email)::text) OR ((old.social_security_number)::text IS DISTINCT FROM (new.social_security_number)::text) OR (old.refused_ssn IS DISTINCT FROM new.refused_ssn) OR (old.csp IS DISTINCT FROM new.csp) OR ((old.job_title)::text IS DISTINCT FROM (new.job_title)::text))) EXECUTE FUNCTION sync_trainee_to_info_sheets();
CREATE TRIGGER trg_sync_trainee_to_info_sheets AFTER UPDATE ON public.trainees FOR EACH ROW WHEN ((((old.email)::text IS DISTINCT FROM (new.email)::text) OR ((old.job_title)::text IS DISTINCT FROM (new.job_title)::text) OR (old.csp IS DISTINCT FROM new.csp) OR ((old.social_security_number)::text IS DISTINCT FROM (new.social_security_number)::text) OR (old.refused_ssn IS DISTINCT FROM new.refused_ssn))) EXECUTE FUNCTION sync_trainee_to_info_sheets();
CREATE TRIGGER trigger_trainees_updated BEFORE UPDATE ON public.trainees FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trigger_trainer_interviews_updated BEFORE UPDATE ON public.trainer_interviews FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trigger_trainer_trainings_updated BEFORE UPDATE ON public.trainer_trainings FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trigger_trainers_updated BEFORE UPDATE ON public.trainers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trigger_uploaded_files_updated BEFORE UPDATE ON public.uploaded_files FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trigger_user_email_configs_updated_at BEFORE UPDATE ON public.user_email_configs FOR EACH ROW EXECUTE FUNCTION update_user_email_configs_updated_at();
CREATE TRIGGER update_veille_qualiopi_updated_at BEFORE UPDATE ON public.veille_qualiopi FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Vues
--VIEW-- audit_logs_view
create view public."audit_logs_view" as
 SELECT id,
    "timestamp",
    user_email,
        CASE action
            WHEN 'view'::text THEN '👁️ Consultation'::character varying
            WHEN 'create'::text THEN '➕ Création'::character varying
            WHEN 'update'::text THEN '✏️ Modification'::character varying
            WHEN 'delete'::text THEN '🗑️ Suppression'::character varying
            WHEN 'export'::text THEN '📤 Export'::character varying
            WHEN 'login'::text THEN '🔑 Connexion'::character varying
            WHEN 'logout'::text THEN '🚪 Déconnexion'::character varying
            WHEN 'print'::text THEN '🖨️ Impression'::character varying
            WHEN 'download'::text THEN '⬇️ Téléchargement'::character varying
            ELSE action
        END AS action_label,
        CASE entity_type
            WHEN 'trainee'::text THEN '👤 Stagiaire'::character varying
            WHEN 'session'::text THEN '📅 Session'::character varying
            WHEN 'client'::text THEN '🏢 Client'::character varying
            WHEN 'trainer'::text THEN '👨‍🏫 Formateur'::character varying
            WHEN 'course'::text THEN '📚 Formation'::character varying
            WHEN 'document'::text THEN '📄 Document'::character varying
            WHEN 'nc'::text THEN '⚠️ NC'::character varying
            WHEN 'veille'::text THEN '👁️ Veille'::character varying
            WHEN 'evaluation'::text THEN '📊 Évaluation'::character varying
            WHEN 'attendance'::text THEN '✍️ Émargement'::character varying
            WHEN 'system'::text THEN '⚙️ Système'::character varying
            ELSE entity_type
        END AS entity_label,
    entity_name,
    details,
    action,
    entity_type,
    entity_id
   FROM audit_logs
  ORDER BY "timestamp" DESC;

--VIEW-- budget_compte_courant
create view public."budget_compte_courant" as
 SELECT payer,
        CASE
            WHEN payer = 'hicham_perso'::text THEN 'Hicham SAIDI'::text
            WHEN payer = 'maxime_perso'::text THEN 'Maxime LANGLAIS'::text
            ELSE 'Entreprise'::text
        END AS associe_nom,
    count(*) AS nb_operations,
    sum(debit) AS total_debit,
    sum(credit) AS total_credit,
    sum(debit) - sum(credit) AS dette_gerant
   FROM budget_transactions
  WHERE is_personal = true
  GROUP BY payer;

--VIEW-- mailing_audience_v
create view public."mailing_audience_v" as
 WITH rows AS (
         SELECT lower(TRIM(BOTH FROM p.email)) AS email,
            'prospect'::text AS source_type,
            'prospection_massive'::text AS send_source,
            p.id AS source_id,
            p.name,
            NULLIF(TRIM(BOTH FROM p.groupe), ''::text) AS groupe,
            p.city,
            "left"(regexp_replace(COALESCE(p.postal_code, ''::text), '\s'::text, ''::text, 'g'::text), 2) AS dep,
            upper(replace(COALESCE(p.naf, ''::text), '.'::text, ''::text)) AS naf,
            p.effectif,
            NULLIF(TRIM(BOTH FROM p.mailing_groupe), ''::text) AS etiquette,
            p.prospection_status,
            COALESCE(p.is_siege, false) AS is_siege,
            NULL::text AS client_status,
            NULL::text AS client_type,
            false AS do_not_mail,
            NULLIF(TRIM(BOTH FROM p.dirigeant_prenom), ''::text) AS prenom,
            NULLIF(TRIM(BOTH FROM p.dirigeant_nom), ''::text) AS nom,
            NULL::text AS civilite,
            3 AS rank_src
           FROM prospection_massive p
          WHERE p.email IS NOT NULL AND TRIM(BOTH FROM p.email) <> ''::text
        UNION ALL
         SELECT lower(TRIM(BOTH FROM x.em)) AS lower,
                CASE
                    WHEN c.status::text = ANY (ARRAY['actif'::character varying, 'inactif'::character varying, 'archive'::character varying]::text[]) THEN 'client'::text
                    ELSE 'crm'::text
                END AS "case",
            'clients'::text,
            c.id,
            c.name,
            NULLIF(TRIM(BOTH FROM c.group_name), ''::text) AS "nullif",
            c.city,
            "left"(regexp_replace(COALESCE(c.postal_code, ''::character varying)::text, '\s'::text, ''::text, 'g'::text), 2) AS "left",
            upper(replace(COALESCE(c.naf_code, c.naf, ''::character varying)::text, '.'::text, ''::text)) AS upper,
            c.effectif,
            NULL::text,
            NULL::text,
            false,
            c.status,
            c.client_type,
            COALESCE(c.do_not_mail, false) AS "coalesce",
            NULL::text,
            NULL::text,
            NULL::text,
            1
           FROM clients c
             CROSS JOIN LATERAL ( VALUES (c.contact_email), (c.email)) x(em)
          WHERE x.em IS NOT NULL AND TRIM(BOTH FROM x.em) <> ''::text
        UNION ALL
         SELECT lower(TRIM(BOTH FROM cc.email)) AS lower,
            'contact'::text,
            'client_contacts'::text,
            cc.id,
            c.name,
            NULLIF(TRIM(BOTH FROM c.group_name), ''::text) AS "nullif",
            c.city,
            "left"(regexp_replace(COALESCE(c.postal_code, ''::character varying)::text, '\s'::text, ''::text, 'g'::text), 2) AS "left",
            upper(replace(COALESCE(c.naf_code, c.naf, ''::character varying)::text, '.'::text, ''::text)) AS upper,
            c.effectif,
            NULL::text,
            NULL::text,
            false,
            c.status,
            c.client_type,
            COALESCE(c.do_not_mail, false) AS "coalesce",
            NULLIF(TRIM(BOTH FROM cc.first_name), ''::text) AS "nullif",
            NULLIF(TRIM(BOTH FROM cc.last_name), ''::text) AS "nullif",
            NULLIF(TRIM(BOTH FROM cc.civilite), ''::text) AS "nullif",
            2
           FROM client_contacts cc
             JOIN clients c ON c.id = cc.client_id
          WHERE cc.email IS NOT NULL AND TRIM(BOTH FROM cc.email) <> ''::text
        ), agg AS (
         SELECT rows.email,
            COALESCE((array_agg(rows.groupe ORDER BY rows.rank_src, rows.is_siege DESC) FILTER (WHERE rows.groupe IS NOT NULL))[1], (array_agg(rows.name ORDER BY rows.rank_src, rows.is_siege DESC) FILTER (WHERE rows.name IS NOT NULL))[1], rows.email) AS display_name,
            (array_agg(rows.send_source ORDER BY rows.rank_src, rows.is_siege DESC))[1] AS send_source,
            (array_agg(rows.source_id ORDER BY rows.rank_src, rows.is_siege DESC))[1] AS source_id,
            (array_agg(rows.city ORDER BY rows.rank_src, rows.is_siege DESC) FILTER (WHERE rows.city IS NOT NULL))[1] AS city,
            count(*)::integer AS nb_lignes,
            array_agg(DISTINCT rows.source_type) AS source_types,
            array_agg(DISTINCT rows.name) FILTER (WHERE rows.name IS NOT NULL) AS noms,
            array_agg(DISTINCT rows.city) FILTER (WHERE rows.city IS NOT NULL) AS villes,
            array_agg(DISTINCT rows.dep) FILTER (WHERE rows.dep ~ '^[0-9][0-9AB]$'::text) AS departements,
            array_agg(DISTINCT rows.naf) FILTER (WHERE rows.naf <> ''::text) AS nafs,
            array_agg(DISTINCT rows.effectif) FILTER (WHERE rows.effectif IS NOT NULL AND rows.effectif <> ''::text) AS effectifs,
            array_agg(DISTINCT rows.etiquette) FILTER (WHERE rows.etiquette IS NOT NULL) AS etiquettes,
            array_agg(DISTINCT rows.prospection_status) FILTER (WHERE rows.prospection_status IS NOT NULL) AS statuts_prospection,
            array_agg(DISTINCT rows.client_status) FILTER (WHERE rows.client_status IS NOT NULL) AS statuts_client,
            array_agg(DISTINCT rows.client_type) FILTER (WHERE rows.client_type IS NOT NULL) AS types_client,
            bool_or(rows.do_not_mail) AS do_not_mail,
            (array_agg(rows.prenom ORDER BY rows.rank_src) FILTER (WHERE rows.prenom IS NOT NULL))[1] AS prenom,
            (array_agg(rows.nom ORDER BY rows.rank_src) FILTER (WHERE rows.nom IS NOT NULL))[1] AS nom,
            (array_agg(rows.civilite ORDER BY rows.rank_src) FILTER (WHERE rows.civilite IS NOT NULL))[1] AS civilite
           FROM rows
          GROUP BY rows.email
        ), sends AS (
         SELECT lower(TRIM(BOTH FROM mailing_sends.email)) AS email,
            max(mailing_sends.sent_at) AS last_sent_at,
            count(DISTINCT mailing_sends.campaign_id)::integer AS nb_campagnes,
            array_agg(DISTINCT mailing_sends.campaign_id) AS campagnes,
            max(mailing_sends.replied_at) AS last_replied_at
           FROM mailing_sends
          WHERE mailing_sends.status = 'sent'::text AND mailing_sends.campaign_id IS NOT NULL
          GROUP BY (lower(TRIM(BOTH FROM mailing_sends.email)))
        )
 SELECT a.email,
    a.display_name,
    a.send_source,
    a.source_id,
    a.city,
    a.nb_lignes,
    a.source_types,
    a.noms,
    a.villes,
    a.departements,
    a.nafs,
    a.effectifs,
    a.etiquettes,
    a.statuts_prospection,
    a.statuts_client,
    a.types_client,
    a.do_not_mail,
    a.prenom,
    a.nom,
    a.civilite,
    COALESCE(st.status, 'ok'::text) AS email_status,
    COALESCE(st.flags, '{}'::text[]) AS email_flags,
    bl.category AS blocage,
    s.last_sent_at,
    COALESCE(s.nb_campagnes, 0) AS nb_campagnes,
    COALESCE(s.campagnes, '{}'::uuid[]) AS campagnes,
    s.last_replied_at
   FROM agg a
     LEFT JOIN mailing_email_status st ON st.email = a.email
     LEFT JOIN LATERAL ( SELECT b.category
           FROM mailing_blocklist b
          WHERE b.kind = 'email'::text AND b.value = a.email OR b.kind = 'domaine'::text AND b.value = split_part(a.email, '@'::text, 2)
          ORDER BY (
                CASE b.category
                    WHEN 'concurrent'::text THEN 0
                    WHEN 'desabonne'::text THEN 1
                    ELSE 2
                END)
         LIMIT 1) bl ON true
     LEFT JOIN sends s ON s.email = a.email;

--VIEW-- mailing_campaign_stats_v
create view public."mailing_campaign_stats_v" as
 SELECT campaign_id,
    count(*)::integer AS total,
    count(*) FILTER (WHERE status = 'sent'::text)::integer AS envoyes,
    count(*) FILTER (WHERE status = 'error'::text)::integer AS erreurs,
    count(*) FILTER (WHERE status = ANY (ARRAY['pending'::text, 'sending'::text]))::integer AS en_attente,
    count(*) FILTER (WHERE status = 'skipped'::text)::integer AS ignores,
    count(*) FILTER (WHERE unsubscribed_at IS NOT NULL)::integer AS desabonnes,
    count(*) FILTER (WHERE replied_at IS NOT NULL)::integer AS reponses,
    max(sent_at) AS dernier_envoi
   FROM mailing_sends s
  WHERE campaign_id IS NOT NULL
  GROUP BY campaign_id;

--VIEW-- mailing_email_status_v
create view public."mailing_email_status_v" as
 SELECT email,
    status,
    flags,
    suggestion,
    is_protected,
    manual,
    note,
    decided_by,
    decided_at,
    analysed_at,
    created_at,
    updated_at,
    ( SELECT count(*) AS count
           FROM prospection_massive p
          WHERE lower(TRIM(BOTH FROM p.email)) = s.email) AS nb_prospects,
    ( SELECT "left"(string_agg(DISTINCT p.name, ' / '::text), 200) AS "left"
           FROM prospection_massive p
          WHERE lower(TRIM(BOTH FROM p.email)) = s.email) AS noms_prospects,
    ( SELECT "left"(string_agg(DISTINCT c.name::text, ' / '::text), 200) AS "left"
           FROM clients c
          WHERE s.email = lower(TRIM(BOTH FROM c.contact_email)) OR s.email = lower(TRIM(BOTH FROM c.email)) OR s.email = lower(TRIM(BOTH FROM c.billing_email))) AS noms_clients,
    ( SELECT "left"(string_agg(DISTINCT (cl.name::text || ' — '::text) || COALESCE(NULLIF(cc.name, ''::text), TRIM(BOTH FROM (COALESCE(cc.first_name, ''::character varying)::text || ' '::text) || COALESCE(cc.last_name, ''::character varying)::text)), ' / '::text), 200) AS "left"
           FROM client_contacts cc
             JOIN clients cl ON cl.id = cc.client_id
          WHERE lower(TRIM(BOTH FROM cc.email)) = s.email) AS noms_contacts,
    ( SELECT min(c.id::text) AS min
           FROM clients c
          WHERE s.email = lower(TRIM(BOTH FROM c.contact_email)) OR s.email = lower(TRIM(BOTH FROM c.email)) OR s.email = lower(TRIM(BOTH FROM c.billing_email))) AS client_id_direct,
    ( SELECT min(cc.client_id::text) AS min
           FROM client_contacts cc
          WHERE lower(TRIM(BOTH FROM cc.email)) = s.email) AS client_id_contact
   FROM mailing_email_status s;

--VIEW-- prospection_groupes_siren
create view public."prospection_groupes_siren" as
 SELECT siren,
    name,
    count(*) AS nb_etablissements,
    array_agg(siret ORDER BY is_siege DESC, city) AS sirets,
    array_agg(city ORDER BY is_siege DESC, city) AS villes,
    array_agg(departement ORDER BY is_siege DESC, city) AS departements,
    array_agg(effectif_label ORDER BY is_siege DESC, city) AS effectifs,
    max(
        CASE
            WHEN is_siege = true THEN siret
            ELSE NULL::text
        END) AS siret_siege,
    string_agg(DISTINCT departement, ', '::text ORDER BY departement) AS departements_list,
        CASE
            WHEN count(DISTINCT city) = 1 THEN 'call_siege_only'::text
            WHEN count(DISTINCT departement) >= 3 THEN 'call_all'::text
            WHEN count(*) <= 2 THEN 'verify_first'::text
            ELSE 'call_all'::text
        END AS recommendation
   FROM prospection_massive
  GROUP BY siren, name
 HAVING count(*) > 1
  ORDER BY (count(*)) DESC, name;

--VIEW-- prospection_stats
create view public."prospection_stats" as
 SELECT count(*) AS total,
    count(
        CASE
            WHEN phone IS NOT NULL THEN 1
            ELSE NULL::integer
        END) AS with_phone,
    count(
        CASE
            WHEN email IS NOT NULL THEN 1
            ELSE NULL::integer
        END) AS with_email,
    count(
        CASE
            WHEN phone IS NOT NULL AND email IS NOT NULL THEN 1
            ELSE NULL::integer
        END) AS with_both,
    count(
        CASE
            WHEN enrichment_status = 'pending'::text THEN 1
            ELSE NULL::integer
        END) AS pending,
    count(
        CASE
            WHEN enrichment_status = 'enriching'::text THEN 1
            ELSE NULL::integer
        END) AS enriching,
    count(
        CASE
            WHEN enrichment_status = 'done'::text THEN 1
            ELSE NULL::integer
        END) AS done,
    count(
        CASE
            WHEN enrichment_status = 'failed'::text THEN 1
            ELSE NULL::integer
        END) AS failed,
    departement
   FROM prospection_massive
  GROUP BY departement
  ORDER BY departement;

--VIEW-- public_sessions_view
create view public."public_sessions_view" as
 SELECT s.id,
    s.reference,
    s.start_date,
    s.end_date,
    c.title AS course_title
   FROM sessions s
     LEFT JOIN courses c ON s.course_id = c.id;

--VIEW-- sessions_inter_stats
create view public."sessions_inter_stats" as
 SELECT s.id,
    s.reference,
    s.start_date,
    s.end_date,
    s.session_type,
    s.min_participants,
    s.max_participants,
    c.title AS course_name,
    count(DISTINCT sg.id) AS nb_groups,
    count(DISTINCT st.trainee_id) FILTER (WHERE sg.status = 'confirmed'::text) AS nb_confirmed,
    count(DISTINCT st.trainee_id) AS nb_total,
    COALESCE(sum(sg.price_total) FILTER (WHERE sg.status = 'confirmed'::text AND sg.payment_status = 'confirmed'::text), 0::numeric) AS ca_confirmed,
    COALESCE(sum(sg.price_total) FILTER (WHERE sg.status = 'confirmed'::text), 0::numeric) AS ca_total,
    count(DISTINCT st.trainee_id) FILTER (WHERE st.info_completed_at IS NOT NULL) AS nb_infos_completed
   FROM sessions s
     LEFT JOIN courses c ON s.course_id = c.id
     LEFT JOIN session_groups sg ON s.id = sg.session_id
     LEFT JOIN session_trainees st ON sg.id = st.group_id
  WHERE s.session_type = ANY (ARRAY['inter'::text, 'public'::text])
  GROUP BY s.id, s.reference, s.start_date, s.end_date, s.session_type, s.min_participants, s.max_participants, c.title;

--VIEW-- trainees_safe
create view public."trainees_safe" as
 SELECT id,
    first_name,
    last_name,
    email,
    phone,
        CASE
            WHEN ssn_encrypted IS NOT NULL THEN '***-**-*****'::text
            ELSE NULL::text
        END AS social_security_number_masked,
    ssn_encrypted IS NOT NULL AS has_ssn,
    client_id,
    notes,
    birth_date,
    refused_ssn,
    has_disability,
    disability_details,
    disability_adaptations,
    created_at,
    updated_at
   FROM trainees;

--VIEW-- trainees_to_purge
create view public."trainees_to_purge" as
 SELECT t.id,
    t.first_name,
    t.last_name,
    t.email,
    t.last_session_date,
    t.created_at,
    COALESCE(t.last_session_date, t.created_at::date) AS reference_date,
    EXTRACT(days FROM now() - COALESCE(t.last_session_date, t.created_at::date)::timestamp with time zone) / 365.25 AS years_since_activity,
    c.name AS client_name
   FROM trainees t
     LEFT JOIN clients c ON c.id = t.client_id
  WHERE COALESCE(t.last_session_date, t.created_at::date) < (now() - '5 years'::interval)
  ORDER BY (COALESCE(t.last_session_date, t.created_at::date));

--VIEW-- v_trainee_session_complete
create view public."v_trainee_session_complete" as
 SELECT st.id AS session_trainee_id,
    st.session_id,
    st.trainee_id,
    t.first_name,
    t.last_name,
    (t.first_name::text || ' '::text) || t.last_name::text AS full_name,
    t.email,
    t.phone,
    t.birth_date,
    t.birth_place,
    t.address,
    t.postal_code,
    t.city,
    t.social_security_number,
    t.refused_ssn,
    t.job_title,
    t.csp,
    t.gender,
    t.has_disability,
    t.disability_details,
    t.disability_adaptations,
    t.client_id,
    c.name AS client_name,
    s.reference AS session_reference,
    s.start_date,
    s.end_date,
    s.status AS session_status,
    s.location_name,
    s.course_id,
    co.title AS course_title,
    co.duration_hours,
    st.registration_date,
    st.result,
    st.presence_complete,
    st.early_departure,
    st.departure_date,
    st.departure_reason,
    st.admin_observation,
    st.remediation_proposal,
    st.access_code,
    st.forprev_card_sent,
    st.certificate_sent_individual,
    st.cold_eval_sent_individual,
    tis.id AS info_sheet_id,
    tis.training_expectations,
    tis.last_training_year,
    tis.highest_diploma,
    tis.rgpd_consent,
    tis.rgpd_consent_date,
    tis.filled_at AS info_sheet_filled_at,
    tis.filled_online AS info_sheet_filled_online
   FROM session_trainees st
     JOIN trainees t ON t.id = st.trainee_id
     JOIN sessions s ON s.id = st.session_id
     LEFT JOIN clients c ON c.id = t.client_id
     LEFT JOIN courses co ON co.id = s.course_id
     LEFT JOIN trainee_info_sheets tis ON tis.trainee_id = st.trainee_id AND tis.session_id = st.session_id;
