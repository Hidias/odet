#!/usr/bin/env python3
"""Matrice des droits d'odet (chantier 2, puis droits composés C1b) et génération des migrations des règles d'accès.

La matrice validée le 14/10/2026 est décrite ci-dessous, table par table. Depuis le chantier C1b, chaque case
de la matrice porte aussi le NOM DU DROIT élémentaire qu'elle demande (catalogue : scripts/securite/droits.py).
Une même matrice produit donc deux écritures équivalentes :
  * « rôles » (chantier 2) : (select app.grp('mgr')) ou (select app.role()) = 'formateur' ;
  * « droits » (C1b) : (select app.a_le_droit('formation.sessions.supprimer')).
Les profils qui reprennent un rôle actuel reçoivent exactement les droits que la matrice donnait à ce rôle :
aucun compte actuel ne change d'accès (seule exception voulue : le technicien ne lit plus aucun prix, il lit
les vues « terrain » sans prix de 0374).

Lancer `python3 scripts/securite/regles.py` réécrit :
  supabase/migrations/0082_securite_regles.sql (matrice M, écriture « rôles », inchangée depuis le 17/10) ;
  supabase/migrations/0273_societes_regles.sql (tables du socle multi-sociétés, matrice MS, chantier C1a) ;
  supabase/migrations/0372_droits_catalogue.sql (catalogue des droits et modèles de profils, C1b) ;
  supabase/migrations/0373_droits_regles.sql (matrice M en écriture « droits », tables C1b, C1b) ;
  supabase/rollback/0370-0375_droits_regles_retour.sql (règles « rôles » remises, retour arrière de C1b) ;
  docs/droits-catalogue.md (catalogue lisible, profils types et droits de chacun).
Ne pas modifier ces fichiers à la main : modifier la matrice ou le catalogue ici, relancer, relire la différence.

Rôles effectifs (fonction app.role()) :
  superadmin, admin, direction, gestionnaire, formateur, commercial, comptable, lecture,
  technicien (compte lecture coché technicien actif, module Interventions actif),
  membre (C1b : rôle de base vide, droits seulement par profils attribués dans la société),
  entreprise, formateur_externe, stagiaire (prévus, aucun accès direct aux tables).
"""
import re
from pathlib import Path

import droits as catalogue

# ---------------------------------------------------------------- groupes de rôles
SA = ['superadmin']
ADM = SA + ['admin']
MGR = ADM + ['direction', 'gestionnaire']
SALES = MGR + ['commercial']
FIN = ADM + ['direction', 'comptable']
STAFF = MGR + ['formateur', 'commercial', 'lecture']          # menu « personnel » (sans comptable)
INT = STAFF + ['comptable']                                   # tous les comptes internes de bureau
EDIT = MGR + ['formateur', 'commercial']                      # personnel qui modifie (sans lecture)
ALL = INT + ['technicien']                                    # tout le personnel


# Groupes nommés : la fonction app.grp(nom) est générée à partir de cette liste (début de 0082).
# Un groupe est enregistré quand l'écriture « rôles » d'une règle l'utilise.
GROUPS = {}

GROUP_NAMES = {
    tuple(sorted(['superadmin'])): 'sa',
    tuple(sorted(['superadmin', 'admin'])): 'adm',
    tuple(sorted(['superadmin', 'admin', 'direction', 'gestionnaire'])): 'mgr',
    tuple(sorted(['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial'])): 'sales',
    tuple(sorted(['superadmin', 'admin', 'direction', 'comptable'])): 'fin',
    tuple(sorted(['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'lecture'])): 'staff',
    tuple(sorted(['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'lecture', 'comptable'])): 'int',
    tuple(sorted(['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial'])): 'edit',
    tuple(sorted(['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'lecture', 'comptable', 'technicien'])): 'all',
    tuple(sorted(['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial', 'lecture', 'comptable'])): 'sess_read',
    tuple(sorted(['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial', 'lecture'])): 'suivi',
    tuple(sorted(['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial', 'comptable'])): 'factu',
    tuple(sorted(['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'lecture', 'technicien'])): 'itv_terrain',
    tuple(sorted(['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable'])): 'edit_cpt',
    tuple(sorted(['commercial', 'comptable'])): 'com_cpt',
    tuple(sorted(['superadmin', 'admin', 'direction'])): 'validation',
}


def group_name(key):
    if key not in GROUP_NAMES:
        raise SystemExit(f"Groupe sans nom : {key} (ajouter une entrée dans GROUP_NAMES)")
    return GROUP_NAMES[key]


def grp_function():
    used = sorted({group_name(k) for k in GROUPS})
    cases = []
    for key, name in sorted(GROUP_NAMES.items(), key=lambda kv: kv[1]):
        if name in used:
            arr = ", ".join(f"'{r}'" for r in key)
            cases.append(f"    when '{name}' then array[{arr}]")
    return """-- Groupes de rôles de la matrice : (select app.grp('mgr')) vaut vrai si le rôle effectif est dans le groupe.
create or replace function app.grp(p_group text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.role() = any (case p_group
""" + "\n".join(cases) + """
    else array[]::text[] end), false)
$$;
revoke all on function app.grp(text) from public, anon;
grant execute on function app.grp(text) to authenticated, service_role;
"""


# ---------------------------------------------------------------- droits nommés (C1b)
# Une case de la matrice est écrite avec des jetons, rendus selon l'écriture voulue :
#   D(code, rôles)        : droit élémentaire ; « rôles » = (select app.grp(...)) ; « droits » = app.a_le_droit(code)
#   S(code, rôle)         : droit limité au périmètre ; « rôles » = (select app.role()) = 'rôle'
#   RAW(texte_rôles, texte_droits) : écriture libre, chacune donnée explicitement (cas justifié en commentaire)
# USAGE[code] = ensemble des rôles qui ont ce droit : il doit être le même partout où le code est utilisé.
USAGE = {}
LISTS = []
RAWS = []
TOKEN = re.compile(r'⟦([DSX]):([^⟧]*)⟧')


def _usage(code, roles_set):
    roles_set = frozenset(roles_set)
    if code in USAGE and USAGE[code] != roles_set:
        raise SystemExit(f"Droit {code} utilisé avec deux ensembles de rôles : {sorted(USAGE[code])} et {sorted(roles_set)}")
    USAGE[code] = roles_set


def D(code, lst, droits=None):
    """Droit élémentaire. `droits` : ensemble de rôles du droit si l'écriture « droits » diffère (cas voulu)."""
    lst = list(dict.fromkeys(lst))
    _usage(code, droits if droits is not None else lst)
    LISTS.append(lst)
    return f"⟦D:{code}:{len(LISTS) - 1}⟧"


def S(code, role):
    _usage(code, [role])
    return f"⟦S:{code}:{role}⟧"


def RAW(roles_text, droits_text):
    RAWS.append((roles_text, droits_text))
    return f"⟦X:{len(RAWS) - 1}⟧"


def render(text, mode):
    if text is None:
        return None

    def rep(m):
        kind, arg = m.group(1), m.group(2)
        if kind == 'X':
            r, d = RAWS[int(arg)]
            return render(r if mode == 'roles' else d, mode)
        code, extra = arg.split(':')
        if mode == 'droits':
            return f"(select app.a_le_droit('{code}'))"
        if kind == 'S':
            return f"(select app.role()) = '{extra}'"
        lst = LISTS[int(extra)]
        key = tuple(sorted(lst))
        GROUPS.setdefault(key, None)
        return f"(select app.grp('{group_name(key)}'))"
    return TOKEN.sub(rep, text)


def roles(lst):
    """Écriture « rôles » seule (sans droit nommé) : réservée aux cas hors catalogue."""
    lst = list(dict.fromkeys(lst))
    key = tuple(sorted(lst))
    GROUPS.setdefault(key, None)
    return f"(select app.grp('{group_name(key)}'))"


def is_role(r):
    return f"(select app.role()) = '{r}'"


def any_of(*parts):
    parts = [p for p in parts if p]
    if len(parts) == 1:
        return parts[0]
    return "(" + " or ".join(parts) + ")"


def trainer(col='session_id', w=False):
    code = 'formation.sessions.modifier_siennes' if w else 'formation.sessions.voir_siennes'
    return f"({S(code, 'formateur')} and {col} in (select app.trainer_session_ids()))"


def trainer_trainee(col='trainee_id', w=False):
    code = 'formation.stagiaires.modifier_siens' if w else 'formation.stagiaires.voir_siens'
    return f"({S(code, 'formateur')} and {col} in (select app.trainer_trainee_ids()))"


def tech_client(col='client_id', code='interventions.missions.voir'):
    return f"({S(code, 'technicien')} and {col} in (select app.tech_client_ids()))"


def own(col='user_id'):
    return f"{col} = (select auth.uid())"


# --------------------------------------------------------------- matrice
# Pour chaque table : module qui la coupe (ou None), puis l'expression de chaque action.
# None = action interdite (aucune règle). Les tables non listées n'ont aucune règle.
# `droits` : expressions propres à l'écriture « droits » (C1b), quand elle diffère volontairement.
M = {}


def t(name, module=None, sel=None, ins=None, upd=None, dele=None, check=None, droits=None):
    M[name] = dict(module=module, sel=sel, ins=ins, upd=upd, dele=dele, check=check, droits=droits or {})


# Organisation et comptes
REGL = lambda: D('organisation.reglages.voir', ALL)  # noqa: E731
for n in ['organization_settings', 'org_settings']:
    t(n, sel=REGL(), ins=D('parametres.organisme.modifier', ADM), upd=D('parametres.organisme.modifier', ADM),
      dele=D('plateforme.administrer', SA))
t('org_modules', sel=REGL(), ins=D('parametres.modules.gerer', ADM), upd=D('parametres.modules.gerer', ADM),
  dele=D('parametres.modules.gerer', ADM))
t('quality_roles', sel=REGL(), ins=D('parametres.referents.gerer', ADM), upd=D('parametres.referents.gerer', ADM),
  dele=D('parametres.referents.gerer', ADM))
# Comptes : le super administrateur (droit de plateforme) ; l'administrateur sauf sur un super administrateur.
# Écriture « droits » : « gérer les comptes » (super administrateur et administrateur) remplace le test du rôle
# administrateur ; équivalent, car le super administrateur passe déjà par la première branche.
ADMIN_COMPTES = RAW(is_role('admin'), "(select app.a_le_droit('parametres.utilisateurs.gerer'))")
SUPERADMIN_COMPTES = RAW(is_role('superadmin'), "(select app.a_le_droit('plateforme.administrer'))")
profile_admin = any_of(own('id'), SUPERADMIN_COMPTES, f"({ADMIN_COMPTES} and role <> 'superadmin')")
# Lecture : sa propre ligne (comptes externes, 0047 : sans elle, la connexion échoue) ou le droit de voir les comptes.
t('profiles', sel=any_of(own('id'), D('organisation.comptes.voir', ALL)), ins=D('parametres.utilisateurs.gerer', ADM), upd=profile_admin,
  dele=any_of(SUPERADMIN_COMPTES, f"({ADMIN_COMPTES} and role <> 'superadmin')"))
t('app_versions', sel=REGL(), ins=D('plateforme.administrer', SA), upd=D('plateforme.administrer', SA),
  dele=D('plateforme.administrer', SA))
PREF = lambda: f"({D('organisation.preferences.gerer', ALL)} and {own()})"  # noqa: E731
t('dashboard_widget_configs', sel=PREF(), ins=PREF(), upd=PREF(), dele=PREF())
AGENDA_SIEN = lambda: f"({D('planning.agenda.gerer_siens', INT)} and {own()})"  # noqa: E731
t('user_planning_events', sel=D('planning.agenda.voir', INT),
  ins=any_of(AGENDA_SIEN(), D('planning.agenda.gerer_equipe', MGR)),
  upd=any_of(AGENDA_SIEN(), D('planning.agenda.gerer_equipe', MGR)),
  dele=any_of(AGENDA_SIEN(), D('planning.agenda.gerer_equipe', MGR)))
t('user_email_configs', sel=PREF(), ins=PREF(), upd=PREF(), dele=PREF())
t('social_tokens', module='social', sel=D('parametres.reseaux_sociaux.voir', ADM))
t('audit_logs', sel=D('conformite.journal.voir', ADM), ins=D('organisation.journal.ecrire', ALL))
t('demo_records', sel=D('plateforme.administrer', SA))
t('schema_migrations', sel=D('plateforme.administrer', SA))
t('notifications', sel=D('organisation.notifications.gerer', INT), ins=D('organisation.notifications.gerer', INT),
  upd=D('organisation.notifications.gerer', INT), dele=D('organisation.notifications.supprimer', ADM))
t('completude_alerts', sel=D('qualite.completude.suivre', INT), ins=D('qualite.completude.suivre', INT),
  upd=D('qualite.completude.suivre', INT), dele=D('qualite.completude.supprimer', MGR))
t('completude_tracking', sel=D('qualite.completude.suivre', INT), ins=D('qualite.completude.suivre', INT),
  upd=D('qualite.completude.suivre', INT), dele=D('qualite.completude.supprimer', MGR))
t('signature_alerts_sent', sel=D('formation.signatures.suivre', MGR))
# Serveur seulement : toutes les règles retirées, aucune remise (_encryption_keys : traité par 0080)
NO_POLICY = ['email_sync_cursors', 'mailing_reply_cursors']
# user_feedback (0260, post-it) : serveur seulement par /api/retours ; aucune règle, aucun droit pour anon
# ni authenticated, posés par 0260 elle-même (non listée ici : 0082 passe avant 0260 sur une base neuve).
# Contrôlé par droits_chantier2.sql.

# Catalogue, formateurs, banque de questions
CAT_V = lambda: D('formation.catalogue.voir', INT)  # noqa: E731
CAT_G = lambda: D('formation.catalogue.gerer', MGR)  # noqa: E731
for n in ['courses', 'training_themes', 'course_equipment', 'equipment_catalog', 'programme_versions',
          'trainer_qualifications', 'course_documents']:
    t(n, sel=CAT_V(), ins=CAT_G(), upd=CAT_G(), dele=CAT_G())
for n in ['course_questions', 'theme_questions', 'positioning_questions_ref', 'positioning_themes']:
    t(n, sel=CAT_V(), ins=D('formation.questions.modifier', EDIT), upd=D('formation.questions.modifier', EDIT),
      dele=CAT_G())
own_trainer = (f"({S('formation.formateurs.modifier_sa_fiche', 'formateur')} and id = (select p.trainer_id from "
               f"public.profiles p where p.id = (select auth.uid())))")
t('trainers', sel=D('formation.formateurs.voir', INT), ins=D('formation.formateurs.gerer', MGR),
  upd=any_of(D('formation.formateurs.gerer', MGR), own_trainer), dele=D('formation.formateurs.gerer', MGR))
for n in ['trainer_interviews', 'trainer_trainings', 'trainer_certificates']:
    t(n, sel=D('formation.formateurs.dossier', MGR), ins=D('formation.formateurs.dossier', MGR),
      upd=D('formation.formateurs.dossier', MGR), dele=D('formation.formateurs.dossier', MGR))

# Sessions (formateur : ses sessions seulement)
SESS_READ = MGR + ['commercial', 'lecture', 'comptable']
SUIVI = MGR + ['commercial', 'lecture']
S_VOIR = lambda: D('formation.sessions.voir', SESS_READ)  # noqa: E731
S_MOD = lambda: D('formation.sessions.modifier', SALES)  # noqa: E731
SV_VOIR = lambda: D('formation.suivi.voir', SUIVI)  # noqa: E731
SV_GER = lambda: D('formation.suivi.gerer', MGR)  # noqa: E731
PREP = lambda: D('formation.sessions.preparer', SALES)  # noqa: E731
t('sessions', sel=any_of(S_VOIR(), trainer('id')), ins=D('formation.sessions.creer', SALES),
  upd=any_of(S_MOD(), trainer('id', w=True)), dele=D('formation.sessions.supprimer', MGR))
for n in ['session_checklists', 'session_documents', 'session_document_access', 'session_emails_sent',
          'session_equipment', 'session_needs_analysis', 'session_qualiopi']:
    t(n, sel=any_of(SV_VOIR(), trainer()), ins=any_of(PREP(), trainer(w=True)),
      upd=any_of(PREP(), trainer(w=True)), dele=any_of(SV_GER(), trainer(w=True)))
for n in ['session_fundings', 'session_groups', 'session_trainers']:
    t(n, sel=any_of(S_VOIR(), trainer()), ins=S_MOD(), upd=S_MOD(), dele=S_MOD())
t('session_costs', sel=D('formation.couts.gerer', MGR), ins=D('formation.couts.gerer', MGR),
  upd=D('formation.couts.gerer', MGR), dele=D('formation.couts.gerer', MGR))
for n in ['attendance_halfdays', 'attendance_proxy_signatures', 'attendances', 'document_signatures']:
    t(n, sel=any_of(SV_VOIR(), trainer()), ins=any_of(SV_GER(), trainer(w=True)),
      upd=any_of(SV_GER(), trainer(w=True)), dele=SV_GER())
t('course_document_downloads', sel=any_of(SV_VOIR(), trainer()),
  ins=any_of(PREP(), trainer(w=True)), dele=SV_GER())
for n in ['documents', 'uploaded_documents', 'uploaded_files']:
    t(n, sel=D('formation.documents.voir', STAFF), ins=D('formation.documents.modifier', EDIT),
      upd=D('formation.documents.modifier', EDIT), dele=D('formation.documents.supprimer', MGR))

# Stagiaires (formateur : stagiaires de ses sessions)
TRAINEE_READ = MGR + ['commercial', 'lecture', 'comptable']
ST_VOIR = lambda: D('formation.stagiaires.voir', TRAINEE_READ)  # noqa: E731
t('trainees', sel=any_of(ST_VOIR(), trainer_trainee('id')), ins=D('formation.stagiaires.creer', EDIT),
  upd=any_of(D('formation.stagiaires.modifier', SALES), trainer_trainee('id', w=True)),
  dele=D('formation.stagiaires.supprimer', MGR))
INSCR = lambda: D('formation.inscriptions.gerer', SALES)  # noqa: E731
t('session_trainees', sel=any_of(ST_VOIR(), trainer()), ins=any_of(INSCR(), trainer(w=True)),
  upd=any_of(INSCR(), trainer(w=True)), dele=any_of(INSCR(), trainer(w=True)))
for n in ['trainee_info_sheets', 'trainee_objectives', 'trainee_positioning_tests', 'positioning_results',
          'sst_certifications']:
    t(n, sel=any_of(SV_VOIR(), trainer()), ins=any_of(SV_GER(), trainer(w=True)),
      upd=any_of(SV_GER(), trainer(w=True)), dele=any_of(SV_GER(), trainer(w=True)))
t('quiz_attempts', sel=any_of(SV_VOIR(), trainer()),
  upd=D('plateforme.administrer', SA), dele=D('plateforme.administrer', SA))
for n in ['trainee_evaluations', 'evaluations_cold', 'trainer_evaluations']:
    t(n, sel=any_of(SV_VOIR(), trainer()), ins=any_of(SV_GER(), trainer(w=True)),
      upd=D('plateforme.administrer', SA), dele=D('plateforme.administrer', SA))
t('trainee_documents', sel=any_of(SV_VOIR(), trainer_trainee()),
  ins=any_of(SV_GER(), trainer_trainee(w=True)), upd=any_of(SV_GER(), trainer_trainee(w=True)), dele=SV_GER())
t('trainees_archive', sel=D('formation.stagiaires.archives', MGR), ins=D('formation.stagiaires.archives', MGR),
  upd=D('formation.stagiaires.archives', MGR), dele=D('formation.stagiaires.archives', MGR))

# Clients (technicien : clients de ses visites)
CL_VOIR = lambda: D('clients.fiches.voir', INT)  # noqa: E731
CL_MOD = lambda: D('clients.fiches.modifier', SALES)  # noqa: E731
t('clients', sel=any_of(CL_VOIR(), tech_client('id')), ins=CL_MOD(), upd=CL_MOD(),
  dele=D('clients.fiches.supprimer', MGR))
for n in ['client_contacts', 'sites']:
    t(n, sel=any_of(CL_VOIR(), tech_client()), ins=CL_MOD(), upd=CL_MOD(), dele=CL_MOD())
t('client_interactions', sel=CL_VOIR(), ins=D('clients.historique.ecrire', EDIT + ['comptable']), upd=CL_MOD(),
  dele=D('clients.fiches.supprimer', MGR))
for n in ['client_portal_access', 'client_providers']:
    t(n, sel=D('clients.espace.gerer', SALES), ins=D('clients.espace.gerer', SALES),
      upd=D('clients.espace.gerer', SALES), dele=D('clients.espace.gerer', SALES))

# Devis et factures (formateur, lecture, technicien : aucun accès)
BILL = SALES + ['comptable']
DV_VOIR = lambda: D('commercial.devis.voir', BILL)  # noqa: E731
DV_MOD = lambda: D('commercial.devis.modifier', SALES)  # noqa: E731
t('quotes', sel=DV_VOIR(), ins=DV_MOD(), upd=DV_MOD(), dele=D('commercial.devis.supprimer', MGR))
t('quote_items', sel=DV_VOIR(), ins=DV_MOD(), upd=DV_MOD(), dele=DV_MOD())
FA_VOIR = lambda: D('facturation.factures.voir', BILL)  # noqa: E731
FA_MOD = lambda: D('facturation.factures.modifier', BILL)  # noqa: E731
FA_SUP = lambda: D('facturation.factures.supprimer', MGR)  # noqa: E731
draft_only = f"({D('facturation.brouillons.supprimer', ['commercial', 'comptable'])} and status = 'draft')"
t('invoices', sel=FA_VOIR(), ins=FA_MOD(), upd=FA_MOD(), dele=any_of(FA_SUP(), draft_only))
for n in ['invoice_items', 'invoice_sessions', 'invoice_payments']:
    t(n, sel=FA_VOIR(), ins=FA_MOD(), upd=FA_MOD(), dele=FA_MOD())
for n in ['invoice_relances', 'invoice_emails_sent']:
    t(n, sel=FA_VOIR(), ins=FA_MOD(), upd=FA_MOD(), dele=FA_SUP())

# Prospection
PR_VOIR = lambda: D('commercial.prospection.voir', SALES)  # noqa: E731
PR_GER = lambda: D('commercial.prospection.gerer', SALES)  # noqa: E731
for n in ['prospect_calls', 'prospect_email_logs', 'prospect_needs_analysis', 'prospect_rdv', 'phoning_sessions',
          'call_arguments', 'call_objections', 'rdv_kit_documents', 'rdv_emails_sent', 'import_logs']:
    t(n, module='prospection', sel=PR_VOIR(), ins=PR_GER(), upd=PR_GER(), dele=PR_GER())
t('prospection_massive', module='prospection', sel=PR_VOIR(), ins=PR_GER(), upd=PR_GER(),
  dele=D('commercial.prospection.supprimer', MGR))

# Campagnes email
CAMP = lambda: D('communication.campagnes.gerer', SALES)  # noqa: E731
for n in ['mailing_blocklist', 'mailing_campaigns', 'mailing_email_status', 'mailing_segments', 'mailing_sends',
          'mailing_templates']:
    t(n, module='mailing', sel=CAMP(), ins=CAMP(), upd=CAMP(), dele=CAMP())

# Réseaux sociaux
SOC = lambda: D('communication.reseaux.gerer', SALES)  # noqa: E731
for n in ['social_posts', 'social_media_library']:
    t(n, module='social', sel=SOC(), ins=SOC(), upd=SOC(), dele=SOC())

# Budget et comptabilité (module Budget ou module Espace comptable)
FIN_MOD = 'finance|comptabilite'
BUD = lambda: D('finance.budget.gerer', FIN)  # noqa: E731
for n in ['budget_actions', 'budget_categories', 'budget_emails_sent', 'budget_meal_guests', 'budget_pipeline',
          'budget_receipts', 'budget_rules', 'budget_settings', 'budget_transaction_invoices', 'bank_statements',
          'accounting_periods']:
    t(n, module=FIN_MOD, sel=BUD(), ins=BUD(), upd=BUD(), dele=BUD())
private_ok = "(is_private = false or private_owner = ((select auth.jwt()) ->> 'email'))"
t('budget_transactions', module=FIN_MOD, sel=f"({BUD()} and {private_ok})",
  ins=f"({BUD()} and {private_ok})", upd=f"({BUD()} and {private_ok})",
  dele=f"({BUD()} and {private_ok})")

# Qualité (registres coupés avec le module ; documents qualité toujours lisibles)
for n in ['non_conformites', 'non_conformities', 'reclamations', 'quality_alerts', 'veille_qualiopi',
          'veille_sources', 'processes', 'process_categories', 'process_connections', 'process_responsibles',
          'process_steps', 'process_versions', 'audits_internes', 'rgpd_traitements', 'bpf_declarations',
          'qualiopi_indicators']:
    t(n, module='qualite', sel=D('qualite.registres.voir', STAFF), ins=D('qualite.registres.signaler', EDIT),
      upd=D('qualite.registres.gerer', MGR), dele=D('qualite.registres.gerer', MGR))
# Registre PSH (handicap, donnée de santé) : direction et référent handicap seulement (ajout du chantier F, 17/10)
# Règle propre (app.can_see_disability) gardée telle quelle dans les deux écritures.
HANDI = "(select app.can_see_disability())"
t('psh_requests', module='qualite', sel=HANDI, ins=HANDI, upd=HANDI, dele=HANDI)
for n in ['quality_documents', 'qualiopi_documents']:
    t(n, sel=D('qualite.documents.voir', INT), ins=D('qualite.documents.gerer', MGR),
      upd=D('qualite.documents.gerer', MGR), dele=D('qualite.documents.gerer', MGR))
t('quality_doc_versions', sel=D('qualite.documents.voir', INT),
  ins=D('qualite.documents.valider', ['superadmin', 'admin', 'direction']))

# Certification (NDA et Qualiopi)
CERT = lambda: D('qualite.certification.gerer', MGR)  # noqa: E731
for n in ['cert_audit_findings', 'cert_criteria', 'cert_documents', 'cert_indicator_status', 'cert_indicators',
          'cert_proofs', 'cert_referentials', 'cert_settings']:
    t(n, module='certification', sel=CERT(), ins=CERT(), upd=CERT(), dele=CERT())

# DUERP
DUERP = lambda: D('prestations.duerp.gerer', MGR)  # noqa: E731
for n in ['duerp_actions', 'duerp_equipements', 'duerp_formations_reglementaires', 'duerp_habilitations',
          'duerp_projects', 'duerp_risk_categories', 'duerp_risk_templates', 'duerp_risks', 'duerp_sector_templates',
          'duerp_units', 'duerp_verifications']:
    t(n, module='duerp', sel=DUERP(), ins=DUERP(), upd=DUERP(), dele=DUERP())

# Interventions (technicien : ses visites et les clients de ses visites, aucun prix de contrat)
# C1b : le technicien ne lit plus aucun prix en base. itv_parts, itv_settings et itv_visit_parts portent des prix :
# dans l'écriture « droits », leur lecture demande « Voir les prix des interventions » (pas le technicien), et le
# technicien lit les vues sans prix de 0374 (itv_parts_terrain, itv_settings_terrain, itv_visit_parts_terrain).
ITV_READ = MGR + ['formateur', 'commercial', 'lecture']
ITV_REGL = lambda: D('interventions.reglages.gerer', MGR)  # noqa: E731
for n in ['itv_equipment_types', 'itv_technicians']:
    t(n, module='interventions', sel=D('interventions.referentiel.voir', ITV_READ + ['technicien']),
      ins=ITV_REGL(), upd=ITV_REGL(), dele=ITV_REGL())
for n in ['itv_settings', 'itv_parts']:
    t(n, module='interventions', sel=D('interventions.tarifs.voir', ITV_READ + ['technicien'], droits=ITV_READ),
      ins=ITV_REGL(), upd=ITV_REGL(), dele=ITV_REGL())
t('itv_contracts', module='interventions', sel=D('interventions.contrats.voir', ITV_READ),
  ins=D('interventions.contrats.gerer', MGR), upd=D('interventions.contrats.gerer', MGR),
  dele=D('interventions.contrats.gerer', MGR))
VI_GER = lambda: D('interventions.visites.gerer', MGR)  # noqa: E731
tech_own_visit = f"({S('interventions.missions.realiser', 'technicien')} and technician_id = (select auth.uid()))"
t('itv_visits', module='interventions', sel=any_of(D('interventions.visites.voir', ITV_READ), tech_client()),
  ins=any_of(VI_GER(), f"({tech_own_visit} and client_id in (select app.tech_client_ids()))"),
  upd=any_of(VI_GER(), tech_own_visit), dele=VI_GER())
t('itv_equipment', module='interventions', sel=any_of(D('interventions.parc.voir', ITV_READ), tech_client()),
  ins=any_of(D('interventions.parc.gerer', MGR), tech_client(code='interventions.parc.annoter')),
  upd=any_of(D('interventions.parc.gerer', MGR), tech_client(code='interventions.parc.annoter')),
  dele=D('interventions.parc.gerer', MGR))
tech_scope_item = f"({S('interventions.missions.voir', 'technicien')} and visit_id in (select app.tech_scope_visit_ids()))"
tech_own_item = f"({S('interventions.missions.realiser', 'technicien')} and visit_id in (select app.tech_visit_ids()))"
t('itv_visit_items', module='interventions', sel=any_of(D('interventions.visites.voir', ITV_READ), tech_scope_item),
  ins=any_of(VI_GER(), tech_own_item), upd=any_of(VI_GER(), tech_own_item), dele=any_of(VI_GER(), tech_own_item))
# Pièces fournies : prix unitaire. Écriture « droits » : lecture par « Voir les prix des interventions » seulement ;
# le technicien lit itv_visit_parts_terrain et écrit par les fonctions itv_visit_part_* de 0374.
t('itv_visit_parts', module='interventions',
  sel=any_of(D('interventions.visites.voir', ITV_READ), tech_scope_item),
  ins=any_of(VI_GER(), tech_own_item), upd=any_of(VI_GER(), tech_own_item), dele=any_of(VI_GER(), tech_own_item),
  droits={'sel': D('interventions.tarifs.voir', ITV_READ + ['technicien'], droits=ITV_READ)})


def rendered(mode):
    """Matrice M rendue dans une écriture (« roles » ou « droits »)."""
    out = {}
    for n, spec in M.items():
        r = {'module': spec['module'], 'check': spec['check']}
        for a in ('sel', 'ins', 'upd', 'dele'):
            expr = spec['droits'].get(a, spec[a]) if mode == 'droits' else spec[a]
            r[a] = render(expr, mode)
        out[n] = r
    return out


# --------------------------------------------------------------- sociétés (chantier C1a, migration 0273)
# Tables du socle multi-sociétés. Fonctions d'aide : 0271 (app.visible_companies, app.is_company_admin…).
# Le super administrateur est un rôle de plateforme : il voit la liste des sociétés (réglages) mais pas
# leurs données métier hors accès de support (C2 posera la condition de société sur les tables métier).
MS = {}


def ts(name, sel=None, ins=None, upd=None, dele=None):
    MS[name] = dict(module=None, sel=sel, ins=ins, upd=upd, dele=dele, check=None)


SA_ON = "(select app.is_superadmin())"
VISIBLE_ID = "id in (select app.visible_companies())"
VISIBLE = "company_id in (select app.visible_companies())"
CO_ADMIN = "app.is_company_admin(company_id)"
FULL_LICENSE = "exists (select 1 from public.companies c where c.id = company_id and c.full_license)"
ts('companies', sel=any_of(VISIBLE_ID, SA_ON), ins=SA_ON,
   upd=any_of(SA_ON, "(app.is_company_admin(id) and full_license)"))
ts('company_establishments', sel=any_of(VISIBLE, SA_ON), ins=any_of(SA_ON, f"({CO_ADMIN} and {FULL_LICENSE})"),
   upd=any_of(SA_ON, f"({CO_ADMIN} and {FULL_LICENSE})"), dele=SA_ON)
ts('company_members', sel=any_of(own('profile_id'), CO_ADMIN), ins=CO_ADMIN, upd=CO_ADMIN, dele=CO_ADMIN)
ts('company_member_roles', sel="member_id in (select m.id from public.company_members m)",
   ins="member_id in (select m.id from public.company_members m where app.is_company_admin(m.company_id))",
   upd="member_id in (select m.id from public.company_members m where app.is_company_admin(m.company_id))",
   dele="member_id in (select m.id from public.company_members m where app.is_company_admin(m.company_id))")
ts('company_modules', sel=any_of(VISIBLE, SA_ON), ins=CO_ADMIN, upd=CO_ADMIN, dele=SA_ON)
# Fenêtres d'accès de support : lues par la direction de la société et le super administrateur ;
# écrites seulement par les fonctions support_access_open et support_access_close
ts('support_access_grants', sel=any_of(SA_ON, "coalesce(app.company_role(company_id) = any (array['admin', 'direction']), false)"))


# --------------------------------------------------------------- génération
def guard(expr, module, read):
    if not module:
        return expr
    mods = module.split('|')
    on = " or ".join(f"(select app.module_on('{m}'))" for m in mods)
    if len(mods) > 1:
        on = f"({on})"
    if read:
        return f"(({on} and {expr}) or (select app.is_superadmin()))"
    return f"({on} and {expr})"


REGLES_FN = """
-- Pose des règles d'une liste de tables : une règle par action, garde du module ajoutée ici.
-- Lecture : module actif, ou super administrateur. Écriture : module actif.
create or replace function pg_temp.regles(p_tables text[], p_module text, p_sel text, p_ins text, p_upd text, p_del text)
returns void
language plpgsql
as $f$
declare
  t text;
  v_on text;
  v_sel text := p_sel; v_ins text := p_ins; v_upd text := p_upd; v_del text := p_del;
begin
  if p_module is not null then
    select '(' || string_agg(format('(select app.module_on(%L))', m), ' or ') || ')' into v_on
    from unnest(string_to_array(p_module, '|')) m;
    if v_sel is not null then v_sel := format('((%s and %s) or (select app.is_superadmin()))', v_on, v_sel); end if;
    if v_ins is not null then v_ins := format('(%s and %s)', v_on, v_ins); end if;
    if v_upd is not null then v_upd := format('(%s and %s)', v_on, v_upd); end if;
    if v_del is not null then v_del := format('(%s and %s)', v_on, v_del); end if;
  end if;
  foreach t in array p_tables loop
    execute format('alter table public.%I enable row level security', t);
    if v_sel is not null then
      execute format('create policy %I on public.%I for select to authenticated using (%s)', t || '_lire', t, v_sel);
    end if;
    if v_ins is not null then
      execute format('create policy %I on public.%I for insert to authenticated with check (%s)', t || '_creer', t, v_ins);
    end if;
    if v_upd is not null then
      execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', t || '_modifier', t, v_upd, v_upd);
    end if;
    if v_del is not null then
      execute format('create policy %I on public.%I for delete to authenticated using (%s)', t || '_supprimer', t, v_del);
    end if;
  end loop;
end
$f$;
"""


def build():
    MR = rendered('roles')
    out = []
    out.append("""-- 0082_securite_regles.sql : règles d'accès par rôle, une règle par action et par table (chantier 2).
-- FICHIER GÉNÉRÉ par scripts/securite/regles.py à partir de la matrice validée le 14/10/2026.
-- Ne pas modifier à la main : modifier la matrice, relancer le script.
--
-- Principe :
--   * chaque table listée perd toutes ses règles et en reçoit au plus quatre (lire, créer, modifier, supprimer),
--     pour le rôle authenticated ; une action sans règle est interdite ;
--   * les rôles sont lus par app.role(), évaluée une fois par requête ;
--   * un module désactivé rend ses tables inaccessibles, sauf au super administrateur en lecture ;
--   * anon ne lit et n'écrit plus aucune table : les portails passent par des fonctions à jeton.
-- Migration idempotente. Retour arrière : supabase/rollback/0080-0087_securite_retour.sql (les huit migrations ensemble)

@@GRP@@
-- Aucune table pour anon ; les nouvelles tables non plus
do $$
declare r record;
begin
  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
  loop
    execute format('revoke all on table public.%I from anon', r.relname);
  end loop;
end $$;
alter default privileges for role postgres in schema public revoke all on tables from anon;

-- Suppression de toutes les règles existantes des tables couvertes par la matrice
do $$
declare r record;
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename = any (array[""")
    names = sorted(MR)
    drop = sorted(set(names) | set(NO_POLICY))
    lines, cur = [], []
    for n in drop:
        cur.append(f"'{n}'")
        if len(", ".join(cur)) > 100:
            lines.append("      " + ", ".join(cur))
            cur = []
    if cur:
        lines.append("      " + ", ".join(cur))
    out.append(",\n".join(lines))
    out.append("""    ])
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;
""")
    out.append(REGLES_FN)
    # Regroupement des tables aux règles identiques
    groups = {}
    for n in names:
        spec = MR[n]
        key = (spec['module'], spec['sel'], spec['ins'], spec['upd'], spec['dele'])
        groups.setdefault(key, []).append(n)

    def lit(v):
        return 'null' if v is None else "$r$" + v + "$r$"

    out.append("\n-- Tables réservées au serveur (clé service_role) : aucune règle\n"
               + "\n".join(f"alter table public.{n} enable row level security;" for n in NO_POLICY))
    for key, tbls in sorted(groups.items(), key=lambda kv: kv[1][0]):
        module, sel, ins, upd, dele = key
        out.append("\n-- " + ", ".join(tbls) + (f" (module {module.replace('|', ' ou ')})" if module else ""))
        arr = "array[" + ", ".join(f"'{t}'" for t in tbls) + "]"
        out.append(f"select pg_temp.regles({arr}, {lit(module)},\n"
                   f"  {lit(sel)},\n  {lit(ins)},\n  {lit(upd)},\n  {lit(dele)});")
    # Passeport de prévention (module passeport, chantier 16) : tables pp_* créées par 0190.
    # Ligne de matrice du 14/10 : SA·AD et DIR·GES ; tous les autres : aucun accès ; pp_nir : serveur seulement.
    # On garde le modèle du Passeport (17/10) : lecture par pp_can_read(), écritures par ses fonctions
    # contrôlées, sauf pp_course_settings (réglages par formation) écrit directement par pp_can().
    # Seuls changements : une règle par action (pp_course_settings avait deux règles de lecture),
    # appels en (select ...), et compte désactivé exclu.
    out.append("""
-- pp_* : Passeport de prévention (module passeport) ; pp_nir : serveur seulement
do $$
declare r record;
begin
  if to_regprocedure('public.pp_can()') is null then
    return;
  end if;
  for r in select p.tablename, p.policyname from pg_policies p
           where p.schemaname = 'public' and p.tablename like 'pp\\_%' loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
  for r in select tablename from pg_tables where schemaname = 'public' and tablename like 'pp\\_%' loop
    execute format('alter table public.%I enable row level security', r.tablename);
    execute format('revoke all on table public.%I from anon', r.tablename);
    if r.tablename = 'pp_nir' then
      execute 'revoke all on table public.pp_nir from authenticated';
      continue;
    end if;
    execute format('create policy %I on public.%I for select to authenticated using ((select public.pp_can_read()) and (select app.role()) is not null)',
                   r.tablename || '_lire', r.tablename);
    if r.tablename = 'pp_course_settings' then
      execute format('create policy %I on public.%I for insert to authenticated with check ((select public.pp_can()) and (select app.role()) is not null)',
                     r.tablename || '_creer', r.tablename);
      execute format('create policy %I on public.%I for update to authenticated using ((select public.pp_can()) and (select app.role()) is not null) with check ((select public.pp_can()) and (select app.role()) is not null)',
                     r.tablename || '_modifier', r.tablename);
      execute format('create policy %I on public.%I for delete to authenticated using ((select public.pp_can()) and (select app.role()) is not null)',
                     r.tablename || '_supprimer', r.tablename);
    end if;
  end loop;
end $$;""")
    out[0] = out[0].replace('@@GRP@@', grp_function())
    out.append("\ninsert into public.schema_migrations (version) values ('0082_securite_regles') on conflict (version) do nothing;\n")
    return "\n".join(out)


def build_societes():
    """Migration 0273 : règles d'accès des tables du socle multi-sociétés (chantier C1a)."""
    out = ["""-- 0273_societes_regles.sql : règles d'accès des tables du socle multi-sociétés (chantier C1a).
-- FICHIER GÉNÉRÉ par scripts/securite/regles.py (matrice MS). Ne pas modifier à la main.
--
-- Même principe que 0082 : une règle par action et par table pour authenticated ; aucune pour anon.
-- Termine par la photographie des tables existantes (app.tables_avant_societes) : toute table créée après
-- cette migration doit naître avec une colonne company_id (contrôlé par supabase/tests/droits_chantier2.sql).
-- Migration idempotente. Retour arrière : supabase/rollback/0270-0273_societes_retour.sql
"""]
    names = sorted(MS)
    arr_all = "array[" + ", ".join(f"'{n}'" for n in names) + "]"
    out.append(f"""-- Droits des tables : rien pour anon ; ni TRUNCATE, ni TRIGGER, ni REFERENCES pour les comptes connectés
do $$
declare t text;
begin
  foreach t in array {arr_all} loop
    execute format('revoke all on table public.%I from anon', t);
    execute format('revoke truncate, trigger, references on table public.%I from authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
  end loop;
end $$;

-- Suppression des règles existantes de ces tables
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and tablename = any ({arr_all}) loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;
""")
    out.append(REGLES_FN)

    def lit(v):
        return 'null' if v is None else "$r$" + v + "$r$"

    for n in names:
        spec = MS[n]
        out.append(f"\n-- {n}")
        out.append(f"select pg_temp.regles(array['{n}'], null,\n"
                   f"  {lit(spec['sel'])},\n  {lit(spec['ins'])},\n  {lit(spec['upd'])},\n  {lit(spec['dele'])});")
    out.append("""
-- Photographie des tables existantes : elles seront rattachées aux sociétés par C2.
-- Toute table créée après 0273 doit naître avec une colonne company_id.
create table if not exists app.tables_avant_societes (table_name text primary key);
revoke all on table app.tables_avant_societes from public, anon, authenticated;
insert into app.tables_avant_societes (table_name)
select c.relname from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
on conflict (table_name) do nothing;

insert into public.schema_migrations (version) values ('0273_societes_regles') on conflict (version) do nothing;
""")
    return "\n".join(out)





# --------------------------------------------------------------- droits composés (chantier C1b, 0372 et 0373)
# Tables créées par C1b (0370) et company_member_roles (C1a) : écriture « droits » seulement.
REGL_D = "(select app.a_le_droit('organisation.reglages.voir'))"
PLAT_D = "(select app.a_le_droit('plateforme.administrer'))"


def societes(code):
    return f"(select app.societes_avec_droit('{code}'))"


MD = {}


def td(name, sel=None, ins=None, upd=None, dele=None):
    MD[name] = dict(module=None, sel=sel, ins=ins, upd=upd, dele=dele, check=None)


td('permissions', sel=REGL_D, ins=PLAT_D, upd=PLAT_D, dele=PLAT_D)
PROFIL_LIRE = f"((company_id is null and {REGL_D}) or company_id in {societes('organisation.reglages.voir')})"
PROFIL_ECRIRE = f"((company_id is null and {PLAT_D}) or company_id in {societes('parametres.profils.gerer')})"
for n in ['permission_profiles', 'permission_profile_rights']:
    td(n, sel=PROFIL_LIRE, ins=PROFIL_ECRIRE, upd=PROFIL_ECRIRE, dele=PROFIL_ECRIRE)
ATTRIBUER = f"company_id in {societes('parametres.droits.attribuer')}"
td('company_member_rights',
   sel=f"(member_id in (select m.id from public.company_members m where m.profile_id = (select auth.uid())) or {ATTRIBUER})",
   ins=ATTRIBUER, upd=ATTRIBUER, dele=ATTRIBUER)
MEMBRE_ATTRIBUER = (f"member_id in (select m.id from public.company_members m where m.company_id in "
                    f"{societes('parametres.droits.attribuer')})")
td('company_member_roles', sel="member_id in (select m.id from public.company_members m)",
   ins=MEMBRE_ATTRIBUER, upd=MEMBRE_ATTRIBUER, dele=MEMBRE_ATTRIBUER)
for n in ['offers', 'offer_items', 'offer_restrictions']:
    td(n, sel=REGL_D, ins=PLAT_D, upd=PLAT_D, dele=PLAT_D)
CIRCUITS = f"company_id in {societes('validations.circuits.configurer')}"
td('approval_rules', sel=f"company_id in {societes('organisation.reglages.voir')}", ins=CIRCUITS, upd=CIRCUITS,
   dele=CIRCUITS)
# Demandes et délégations : écrites seulement par les fonctions approval_* (0375) ; lues par le demandeur, celui qui
# peut décider (droit de l'étape ou délégation), et le centre de validations.
td('approval_requests',
   sel=("(requested_by = (select auth.uid()) or company_id in " + societes('manager.validations.voir')
        + " or app.approval_can_decide(company_id, scope, steps ->> current_step, requested_by, status))"))
td('approval_delegations',
   sel=("(from_profile = (select auth.uid()) or to_profile = (select auth.uid()) or company_id in "
        + societes('manager.validations.voir') + ")"))


# Tables créées après C1b (0360 et suivantes) : même écriture « droits », posée par la migration de leur chantier
# (0373 n'est jamais régénérée pour elles : elles n'existent pas encore à ce moment-là de l'ordre des migrations).
# build_suite(migration) écrit le bloc SQL à placer dans la migration ; la ligne de la matrice reste ici.
MD_SUITE = {}


def tdx(migration, name, sel=None, ins=None, upd=None, dele=None):
    MD_SUITE[name] = (migration, dict(module=None, sel=sel, ins=ins, upd=upd, dele=dele, check=None))


# Facturation fiable (0360) : réglages lus par tous, modifiés avec la configuration de l'organisme ; compteurs lus
# avec les factures, écrits seulement par les fonctions d'émission (aucune règle d'écriture).
tdx('0360', 'billing_settings', sel=f"company_id in {societes('organisation.reglages.voir')}",
    ins=f"company_id in {societes('parametres.organisme.modifier')}",
    upd=f"company_id in {societes('parametres.organisme.modifier')}", dele=PLAT_D)
tdx('0360', 'billing_sequences', sel=f"company_id in {societes('facturation.factures.voir')}")
# Acomptes (0368) : liens entre facture de solde et factures d'acompte, lus avec les factures, écrits seulement par
# billing_create_final (aucune règle d'écriture).
tdx('0368', 'invoice_deposit_links', sel=f"company_id in {societes('facturation.factures.voir')}")
# Mise en service (0262) : bandeau d'information et entrées « Quoi de neuf ». Une ligne sans société (company_id
# vide) vaut pour toutes les sociétés. Lues publiées par tout compte qui voit les réglages de l'organisme ; brouillons,
# écriture et suppression réservées au super administrateur. L'isolement par société est posé par 0262 (règles
# restrictives qui laissent passer les lignes sans société).
tdx('0262', 'platform_notices', sel=f"((status = 'publie' and {REGL_D}) or {PLAT_D})", ins=PLAT_D, upd=PLAT_D,
    dele=PLAT_D)
# Lot 2, obligations (0042) : référentiel par société, formations suivies ailleurs (données des stagiaires),
# exercices et essais de l'exploitant (fiche client).
tdx('0042', 'obligation_rules', sel=f"company_id in {societes('organisation.reglages.voir')}",
    ins=f"company_id in {societes('formation.catalogue.gerer')}", upd=f"company_id in {societes('formation.catalogue.gerer')}",
    dele=f"company_id in {societes('formation.catalogue.gerer')}")
tdx('0042', 'external_trainings', sel=f"company_id in {societes('formation.stagiaires.voir')}",
    ins=f"company_id in {societes('formation.stagiaires.modifier')}", upd=f"company_id in {societes('formation.stagiaires.modifier')}",
    dele=f"company_id in {societes('formation.stagiaires.modifier')}")
tdx('0042', 'client_safety_checks', sel=f"company_id in {societes('clients.fiches.voir')}",
    ins=f"company_id in {societes('clients.fiches.modifier')}", upd=f"company_id in {societes('clients.fiches.modifier')}",
    dele=f"company_id in {societes('clients.fiches.modifier')}")
# Lot 2, relances (0043) : actions préparées par la base chaque nuit, validées à la main par qui envoie aux clients ;
# aucune création ni suppression par un compte (seulement la tâche de nuit), modification = valider, ignorer, corriger.
tdx('0043', 'scheduled_actions', sel=f"company_id in {societes('formation.convocations.envoyer')}",
    upd=f"company_id in {societes('formation.convocations.envoyer')}")
# Lot 2, sessions inter (0044) : demandes d'inscription de la page publique (écrites par une fonction publique à venir),
# lues et traitées par qui inscrit les stagiaires.
tdx('0044', 'inter_requests', sel=f"company_id in {societes('formation.inscriptions.gerer')}",
    upd=f"company_id in {societes('formation.inscriptions.gerer')}", dele=f"company_id in {societes('formation.inscriptions.gerer')}")
# Lot 2, sous-traitance (0045) : prestataires et leurs justificatifs, bons de commande ; gérés avec les formateurs
# (dossier des formateurs), montants des commandes avec les coûts des sessions.
_ST_VOIR = f"company_id in {societes('formation.formateurs.voir')}"
_ST_GERER = f"company_id in {societes('formation.formateurs.dossier')}"
for _n in ['subcontractors', 'subcontractor_doc_types', 'subcontractor_documents']:
    tdx('0045', _n, sel=_ST_VOIR, ins=_ST_GERER, upd=_ST_GERER, dele=_ST_GERER)
tdx('0045', 'subcontract_orders', sel=f"company_id in {societes('formation.couts.gerer')}",
    ins=f"company_id in {societes('formation.couts.gerer')}", upd=f"company_id in {societes('formation.couts.gerer')}",
    dele=f"company_id in {societes('formation.couts.gerer')}")
# Lot 2, espace entreprise (0046) : comptes et sites des comptes gérés avec l'espace entreprise ; demandes lues avec
# les clients, traitées par qui modifie les clients (créées seulement par ent_demander) ; actualités lues avec les
# clients, rédigées avec l'espace entreprise. Les comptes entreprise n'ont aucun droit : ils passent par les ent_*.
_ENT = f"company_id in {societes('clients.espace.gerer')}"
_CLI_VOIR = f"company_id in {societes('clients.fiches.voir')}"
for _n in ['client_accounts', 'client_account_sites']:
    tdx('0046', _n, sel=_ENT, ins=_ENT, upd=_ENT, dele=_ENT)
tdx('0046', 'client_requests', sel=_CLI_VOIR, upd=f"company_id in {societes('clients.fiches.modifier')}", dele=_ENT)
tdx('0046', 'client_news', sel=_CLI_VOIR, ins=_ENT, upd=_ENT, dele=_ENT)
# Fonction 10, pont formation et maintenance (0130) : pistes lues avec les clients, tenues par qui modifie les
# clients ; le technicien n'y écrit que par pont_signaler_besoin (fonction).
_CLI_MOD = f"company_id in {societes('clients.fiches.modifier')}"
tdx('0130', 'cross_sell_leads', sel=_CLI_VOIR, ins=_CLI_MOD, upd=_CLI_MOD, dele=_CLI_MOD)
# Fonction 11, registre de sécurité (0140) : documents du client lus avec les clients, tenus par qui modifie les
# clients ; l'entreprise dépose par ent_document_ajouter (fonction).
tdx('0140', 'client_documents', sel=_CLI_VOIR, ins=_CLI_MOD, upd=_CLI_MOD, dele=_CLI_MOD)
# Chantier 10, suivi des affaires (0380) : listes lues avec les clients, réglées par qui prépare les devis ; affaires
# (montants) lues avec les devis, tenues par qui prépare les devis ; objectifs de cadence lus avec les clients, réglés
# par qui prépare les devis.
_DEV_VOIR = f"company_id in {societes('commercial.devis.voir')}"
_DEV_MOD = f"company_id in {societes('commercial.devis.modifier')}"
tdx('0380', 'commercial_lists', sel=_CLI_VOIR, ins=_DEV_MOD, upd=_DEV_MOD, dele=_DEV_MOD)
tdx('0380', 'opportunities', sel=_DEV_VOIR, ins=_DEV_MOD, upd=_DEV_MOD, dele=_DEV_MOD)
tdx('0380', 'activity_targets', sel=_CLI_VOIR, ins=_DEV_MOD, upd=_DEV_MOD, dele=_DEV_MOD)


def build_suite(migration):
    specs = {n: spec for n, (m, spec) in MD_SUITE.items() if m == migration}
    out = [REGLES_FN, _drop_named(set(specs))]
    out += _calls(specs)
    return "\n".join(out) + "\n"


def _flags(f):
    return {'own': 'siens' in f, 'prix': 'prix' in f, 'licence': 'licence' in f, 'plateforme': 'plateforme' in f}


def profils_droits():
    """Droits de chaque modèle de profil. Les modèles qui reprennent un rôle reçoivent exactement les droits
    que la matrice donnait à ce rôle (USAGE), plus des droits sans règle aujourd'hui (modules prévus)."""
    rendered('droits')  # enregistre l'usage complet
    cat = catalogue.catalogue_par_code()
    inconnus = sorted(c for c in USAGE if c not in cat)
    if inconnus:
        raise SystemExit(f"Droits utilisés par les règles, absents du catalogue : {inconnus}")
    out = {}
    for key, (label, desc, base, extras) in catalogue.PROFILS.items():
        if base is not None:
            derives = {c for c, rs in USAGE.items() if base in rs}
        else:
            derives = set()
        if extras is None:  # super administrateur : tous les droits qui ne sont pas limités au périmètre
            extras = [c for c, v in cat.items() if c not in USAGE and not _flags(v[5])['own']]
        for c in extras:
            if c not in cat:
                raise SystemExit(f"Profil {key} : droit inconnu {c}")
            # Un modèle qui reprend un rôle ne reçoit aucun droit de règle que la matrice ne lui donnait pas
            if base is not None and c in USAGE and c not in derives:
                raise SystemExit(f"Profil {key} : {c} changerait les accès actuels du rôle {base}")
        droits = sorted(derives | set(extras))
        for c in droits:
            if _flags(cat[c][5])['plateforme'] and key != 'superadmin':
                raise SystemExit(f"Profil {key} : droit de plateforme {c}")
        if key == 'technicien':
            prix = [c for c in droits if _flags(cat[c][5])['prix']]
            if prix:
                raise SystemExit(f"Le technicien ne doit voir aucun prix : {prix}")
        out[key] = droits
    return out


def q(v):
    return "'" + str(v).replace("'", "''") + "'"


def build_catalogue():
    cat = catalogue.CATALOGUE
    prof = profils_droits()
    out = ["""-- 0372_droits_catalogue.sql : catalogue des droits et modèles de profils (chantier C1b).
-- FICHIER GÉNÉRÉ par scripts/securite/regles.py (catalogue : scripts/securite/droits.py ; droits des modèles qui
-- reprennent un rôle : calculés depuis la matrice du chantier 2). Ne pas modifier à la main.
--
-- Reprise de l'existant sans perte : chaque rôle actuel (profiles.role, et « lecture » coché technicien) devient un
-- modèle de profil qui contient exactement ses droits d'aujourd'hui. Les comptes ne sont pas modifiés : leur profil
-- de base reste leur rôle d'appartenance (company_members.role, recopié par C1a).
-- Migration idempotente (les droits retirés d'un modèle par le super administrateur ne sont pas remis, sauf en
-- rejouant la migration). Retour arrière : supabase/rollback/0370-0375_droits_retour.sql
"""]
    rows = []
    for i, (code, module, label, desc, data, flags) in enumerate(cat):
        f = _flags(flags)
        rows.append(f"  ({q(code)}, {q(module) if module else 'null'}, {q(label)}, {q(desc)}, {q(data)}, "
                    f"{str(f['own']).lower()}, {str(f['prix']).lower()}, {str(f['licence']).lower()}, "
                    f"{str(f['plateforme']).lower()}, {(i + 1) * 10})")
    out.append("insert into public.permissions (code, module, label, description, data_scope, own_scope, shows_prices,\n"
               "  full_license_only, platform_only, position) values\n" + ",\n".join(rows) + "\n"
               "on conflict (code) do update set module = excluded.module, label = excluded.label,\n"
               "  description = excluded.description, data_scope = excluded.data_scope, own_scope = excluded.own_scope,\n"
               "  shows_prices = excluded.shows_prices, full_license_only = excluded.full_license_only,\n"
               "  platform_only = excluded.platform_only, position = excluded.position, updated_at = now();\n")
    rows = []
    for i, (key, (label, desc, base, _)) in enumerate(catalogue.PROFILS.items()):
        rows.append(f"  ({q(key)}, {q(label)}, {q(desc)}, {q(base) if base else 'null'}, true, {(i + 1) * 10})")
    out.append("-- Modèles de profils (plateforme)\n"
               "insert into public.permission_profiles (key, label, description, base_role, is_system, position) values\n"
               + ",\n".join(rows) + "\n"
               "on conflict (key) where company_id is null do update set label = excluded.label,\n"
               "  description = excluded.description, position = excluded.position;\n")
    out.append("-- Droits des modèles")
    for key, droits in prof.items():
        if not droits:
            out.append(f"-- {key} : aucun droit (rôle de base vide)")
            continue
        vals = ", ".join(f"({q(c)})" for c in droits)
        out.append(f"insert into public.permission_profile_rights (profile_id, right_code)\n"
                   f"select p.id, x.code from public.permission_profiles p, (values {vals}) x(code)\n"
                   f"where p.company_id is null and p.key = {q(key)}\non conflict do nothing;")
    out.append("\ninsert into public.schema_migrations (version) values ('0372_droits_catalogue') on conflict (version) do nothing;\n")
    return "\n".join(out)


def _drop_named(tables):
    arr = "array[" + ", ".join(f"'{n}'" for n in sorted(tables)) + "]"
    return f"""-- Suppression des règles nommées du générateur (lire, créer, modifier, supprimer) ; les autres règles
-- (règle restrictive des notifications de 0070, etc.) ne sont pas touchées
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and tablename = any ({arr})
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;
"""


def _lit(v):
    return 'null' if v is None else "$r$" + v + "$r$"


def _calls(specs):
    out = []
    groups = {}
    for n in sorted(specs):
        spec = specs[n]
        key = (spec['module'], spec['sel'], spec['ins'], spec['upd'], spec['dele'])
        groups.setdefault(key, []).append(n)
    for key, tbls in sorted(groups.items(), key=lambda kv: kv[1][0]):
        module, sel, ins, upd, dele = key
        out.append("\n-- " + ", ".join(tbls) + (f" (module {module.replace('|', ' ou ')})" if module else ""))
        arr = "array[" + ", ".join(f"'{t}'" for t in tbls) + "]"
        out.append(f"select pg_temp.regles({arr}, {_lit(module)},\n  {_lit(sel)},\n  {_lit(ins)},\n  {_lit(upd)},\n  {_lit(dele)});")
    return out


def build_droits():
    MDR = rendered('droits')
    out = ["""-- 0373_droits_regles.sql : règles d'accès par droits élémentaires (chantier C1b).
-- FICHIER GÉNÉRÉ par scripts/securite/regles.py : même matrice que 0082, écriture « droits ».
-- Ne pas modifier à la main : modifier la matrice ou le catalogue, relancer le script.
--
-- Chaque règle demande un droit nommé à la fonction unique app.a_le_droit(code) (0371), évaluée une fois par requête.
-- Les modèles de profils qui reprennent un rôle (0372) ont exactement les droits que la matrice donnait à ce rôle :
-- aucun compte ne change d'accès, sauf le technicien qui ne lit plus aucun prix en base (itv_parts, itv_settings,
-- itv_visit_parts : lecture réservée à « Voir les prix des interventions » ; vues sans prix en 0374).
-- Les gardes de module, les règles propres (handicap, budget privé, Passeport, suivi formatif, stockage) et la règle
-- restrictive des notifications (0070) sont inchangées.
-- Migration idempotente. Retour arrière : supabase/rollback/0370-0375_droits_retour.sql
"""]
    out.append(_drop_named(set(MDR) | set(MD)))
    out.append(REGLES_FN)
    out.append("-- ===== Tables de la matrice du chantier 2 =====")
    out += _calls(MDR)
    out.append("\n-- ===== Tables des droits composés et des validations (C1b) =====")
    out += _calls(MD)
    out.append("\ninsert into public.schema_migrations (version) values ('0373_droits_regles') on conflict (version) do nothing;\n")
    return "\n".join(out)


def build_retour():
    """Retour arrière complet de C1b (0370 à 0375) : règles « rôles » de 0082 et de C1a remises, puis suppression
    des vues, fonctions, tables, colonne et contraintes de C1b, fonctions de C1a remises dans leur version d'origine."""
    MR = rendered('roles')
    out = ["""-- 0370-0375_droits_retour.sql : retour arrière des droits composés (chantier C1b, migrations 0370 à 0375).
-- FICHIER GÉNÉRÉ par scripts/securite/regles.py. Ne pas modifier à la main.
-- Remet exactement l'état d'après C1a : règles d'accès de 0082 (écriture « rôles ») et de 0273, fonctions
-- app.member_role et app.companies_guard d'origine, contraintes de rôle d'origine ; supprime les tables, vues et
-- fonctions de C1b. Les profils attribués dans company_member_roles (table de C1a) sont gardés.
-- Refuse de s'exécuter si un compte a le rôle de base « membre » (lui donner un autre rôle d'abord).

do $$
begin
  if exists (select 1 from public.profiles where role = 'membre')
     or exists (select 1 from public.company_members where role = 'membre') then
    raise exception 'Retour arrière impossible : des comptes ont le rôle de base « membre » ; leur donner un autre rôle d''abord';
  end if;
end $$;

-- 1. Règles d'accès d'avant C1b"""]
    out.append(_drop_named(set(MR) | set(MD)))
    out.append(REGLES_FN)
    out += _calls(MR)
    out += _calls({'company_member_roles': MS['company_member_roles']})
    out.append("""
-- 2. Vues et fonctions de C1b
drop view if exists public.itv_parts_terrain, public.itv_settings_terrain, public.itv_visit_parts_terrain;
drop function if exists public.itv_visit_part_add(uuid, uuid, text, numeric), public.itv_visit_part_set_quantity(uuid, numeric),
  public.itv_visit_part_remove(uuid), app.itv_can_edit_visit_parts(uuid), app.itv_visit_part_json(uuid);
drop function if exists public.approval_required(text, numeric, uuid), public.approval_submit(text, text, uuid, numeric, uuid, text),
  public.approval_decide(uuid, text, text), public.approval_cancel(uuid),
  public.approval_delegate(uuid, timestamptz, text, text, timestamptz), public.approval_delegation_revoke(uuid),
  app.approval_rule_for(uuid, text, uuid);
drop trigger if exists company_member_roles_guard on public.company_member_roles;
drop index if exists public.company_member_roles_member_idx;

-- 3. Tables de C1b
drop table if exists public.approval_requests, public.approval_delegations, public.approval_rules,
  public.company_member_rights, public.permission_profile_rights, public.permission_profiles,
  public.offer_items, public.offer_restrictions;
alter table public.companies drop column if exists offer_id;
drop table if exists public.offers, public.permissions;

drop function if exists public.my_rights(), public.external_accountant_set_quotes(boolean), app.approval_can_decide(uuid, text, text, uuid, text), app.offer_allows(uuid, text, text),
  app.societes_avec_droit(text), app.a_le_droit_dans(uuid, text), app.a_le_droit(text), app.rights(),
  app.rights_for(uuid, uuid), app.profiles_for(uuid, uuid), app.role_of(uuid),
  app.profile_rights_company(), app.permission_profiles_guard(), app.profile_rights_guard(),
  app.member_rights_guard(), app.member_roles_guard();

-- 4. Fonctions de C1a dans leur version d'origine (0271, 0272)
create or replace function app.member_role(p_role text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_role in ('admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable', 'lecture')
              then p_role end
$$;

create or replace function app.companies_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    if (new.support_access_mode, new.support_access_hours) is distinct from (old.support_access_mode, old.support_access_hours)
       and coalesce(current_setting('odet.changement_acces_support', true), '') <> 'oui' then
      raise exception 'Le mode d''accès de support ne se change que par l''administrateur de la société'
        using errcode = '42501';
    end if;
    if (new.full_license, new.is_instance_owner) is distinct from (old.full_license, old.is_instance_owner)
       and not app.is_superadmin() then
      raise exception 'Licence et société n° 1 : réservées au super administrateur' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end
$$;

-- 5. Contraintes de rôle d'origine (0080, 0270)
alter table public.company_members drop constraint if exists company_members_role_check;
alter table public.company_members add constraint company_members_role_check
  check (role in ('admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable', 'lecture'));
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role = any (array[
  'superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable', 'lecture',
  'entreprise', 'formateur_externe', 'stagiaire'
]::text[]));

-- 6. Registre des migrations
delete from public.schema_migrations where version in ('0370_droits_tables', '0371_droits_fonctions',
  '0372_droits_catalogue', '0373_droits_regles', '0374_droits_prix_terrain', '0375_droits_validations');
""")
    return "\n".join(out)


def build_doc():
    cat = catalogue.CATALOGUE
    prof = profils_droits()
    keys = list(catalogue.PROFILS)
    abr = {'superadmin': 'SA', 'admin': 'AD', 'direction': 'DIR', 'gestionnaire': 'GES', 'formateur': 'FOR',
           'commercial': 'COM', 'technicien': 'TEC', 'comptable': 'CPI', 'comptable_externe': 'CPE', 'rh': 'RH',
           'salarie': 'SAL', 'lecture': 'LEC', 'ecran': 'ECR', 'membre': 'MBR'}
    out = ["# Catalogue des droits et profils types (GLD Solutions, chantier C1b)", "",
           "FICHIER GÉNÉRÉ par `scripts/securite/regles.py` à partir de `scripts/securite/droits.py` et de la matrice "
           "des règles d'accès. Ne pas modifier à la main.", "",
           "Drapeaux : **P** périmètre de la personne (ses sessions, ses visites…) ; **€** montre des prix ; "
           "**L** licence totale de la société (**L (0379)** : drapeau posé par la migration 0379, après 0372) ; "
           "**Pf** plateforme (super administrateur). "
           "« Règle » : le droit est demandé aujourd'hui par une règle d'accès en base ; sinon il est prêt pour un module "
           "ou un écran à venir.", "",
           "## Profils types", "",
           "| Clé | Profil | Rôle actuel repris | Droits | Description |", "|---|---|---|---|---|"]
    for k in keys:
        label, desc, base, _ = catalogue.PROFILS[k]
        out.append(f"| {abr[k]} `{k}` | {label} | {base or '—'} | {len(prof[k])} | {desc} |")
    out += ["", "## Catalogue", "",
            "| Droit | Ce qu'il permet | Données | Drapeaux | Règle | " + " | ".join(abr[k] for k in keys) + " |",
            "|---|---|---|---|---|" + "---|" * len(keys)]
    module = None
    for code, mod, label, desc, data, flags in cat:
        dom = code.split('.')[0]
        if dom != module:
            module = dom
            out.append(f"| **{dom}** | | | | |" + " |" * len(keys))
        f = _flags(flags)
        fl = " ".join(x for x, on in (('P', f['own']), ('€', f['prix']), ('L', f['licence']),
                                      ('L (0379)', code in catalogue.LICENCE_0379), ('Pf', f['plateforme'])) if on)
        cells = " | ".join('x' if code in prof[k] else '' for k in keys)
        out.append(f"| **{label}** `{code}` | {desc} | {data} | {fl} | {'oui' if code in USAGE else ''} | {cells} |")
    out.append("")
    return "\n".join(out)


def tables():
    return sorted(M)


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[2]
    target = root / 'supabase' / 'migrations' / '0082_securite_regles.sql'
    target.write_text(build(), encoding='utf-8')
    print(f"{target.relative_to(root)} : {len(M)} tables")
    target2 = root / 'supabase' / 'migrations' / '0273_societes_regles.sql'
    target2.write_text(build_societes(), encoding='utf-8')
    print(f"{target2.relative_to(root)} : {len(MS)} tables")
    for rel, fn in (('supabase/migrations/0372_droits_catalogue.sql', build_catalogue),
                    ('supabase/migrations/0373_droits_regles.sql', build_droits),
                    ('supabase/rollback/0370-0375_droits_retour.sql', build_retour),
                    ('docs/droits-catalogue.md', build_doc)):
        f = root / rel
        f.write_text(fn(), encoding='utf-8')
        print(f"{rel} : écrit")
    print(f"droits utilisés par les règles : {len(USAGE)} ; catalogue : {len(catalogue.CATALOGUE)}")
