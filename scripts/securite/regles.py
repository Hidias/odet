#!/usr/bin/env python3
"""Matrice des droits d'odet (chantier 2) et génération de la migration des règles d'accès.

La matrice validée le 14/10/2026 est décrite ci-dessous, table par table.
Lancer `python3 scripts/securite/regles.py` réécrit
supabase/migrations/0082_securite_regles.sql. Ne pas modifier ce fichier SQL à la main :
modifier la matrice ici, relancer, relire la différence.

Rôles effectifs (fonction app.role()) :
  superadmin, admin, direction, gestionnaire, formateur, commercial, comptable, lecture,
  technicien (compte lecture coché technicien actif, module Interventions actif),
  entreprise, formateur_externe, stagiaire (prévus, aucun accès direct aux tables).
"""
from pathlib import Path

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
GROUPS = {}


def roles(lst):
    lst = list(dict.fromkeys(lst))
    key = tuple(sorted(lst))
    if key not in GROUPS:
        GROUPS[key] = None
    return f"(select app.grp('{group_name(key)}'))"


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


def is_role(r):
    return f"(select app.role()) = '{r}'"


def any_of(*parts):
    parts = [p for p in parts if p]
    if len(parts) == 1:
        return parts[0]
    return "(" + " or ".join(parts) + ")"


def trainer(col='session_id'):
    return f"({is_role('formateur')} and {col} in (select app.trainer_session_ids()))"


def trainer_trainee(col='trainee_id'):
    return f"({is_role('formateur')} and {col} in (select app.trainer_trainee_ids()))"


def tech_client(col='client_id'):
    return f"({is_role('technicien')} and {col} in (select app.tech_client_ids()))"


def own(col='user_id'):
    return f"{col} = (select auth.uid())"


# --------------------------------------------------------------- matrice
# Pour chaque table : module qui la coupe (ou None), puis l'expression de chaque action.
# None = action interdite (aucune règle). Les tables non listées n'ont aucune règle.
M = {}


def t(name, module=None, sel=None, ins=None, upd=None, dele=None, check=None):
    M[name] = dict(module=module, sel=sel, ins=ins, upd=upd, dele=dele, check=check)


# Organisation et comptes
for n in ['organization_settings', 'org_settings']:
    t(n, sel=roles(ALL), ins=roles(ADM), upd=roles(ADM), dele=roles(SA))
t('org_modules', sel=roles(ALL), ins=roles(ADM), upd=roles(ADM), dele=roles(ADM))
t('quality_roles', sel=roles(ALL), ins=roles(ADM), upd=roles(ADM), dele=roles(ADM))
profile_admin = any_of(own('id'), is_role('superadmin'), f"({is_role('admin')} and role <> 'superadmin')")
t('profiles', sel=roles(ALL), ins=roles(ADM), upd=profile_admin,
  dele=any_of(is_role('superadmin'), f"({is_role('admin')} and role <> 'superadmin')"))
t('app_versions', sel=roles(ALL), ins=roles(SA), upd=roles(SA), dele=roles(SA))
t('dashboard_widget_configs', sel=f"({roles(ALL)} and {own()})", ins=f"({roles(ALL)} and {own()})",
  upd=f"({roles(ALL)} and {own()})", dele=f"({roles(ALL)} and {own()})")
t('user_planning_events', sel=roles(INT), ins=any_of(f"({roles(INT)} and {own()})", roles(MGR)),
  upd=any_of(f"({roles(INT)} and {own()})", roles(MGR)), dele=any_of(f"({roles(INT)} and {own()})", roles(MGR)))
t('user_email_configs', sel=f"({roles(ALL)} and {own()})", ins=f"({roles(ALL)} and {own()})",
  upd=f"({roles(ALL)} and {own()})", dele=f"({roles(ALL)} and {own()})")
t('social_tokens', module='social', sel=roles(ADM))
t('audit_logs', sel=roles(ADM), ins=roles(ALL))
t('demo_records', sel=roles(SA))
t('schema_migrations', sel=roles(SA))
t('notifications', sel=roles(INT), ins=roles(INT), upd=roles(INT), dele=roles(ADM))
t('completude_alerts', sel=roles(INT), ins=roles(INT), upd=roles(INT), dele=roles(MGR))
t('completude_tracking', sel=roles(INT), ins=roles(INT), upd=roles(INT), dele=roles(MGR))
t('signature_alerts_sent', sel=roles(MGR))
# Serveur seulement : toutes les règles retirées, aucune remise (_encryption_keys : traité par 0080)
NO_POLICY = ['email_sync_cursors', 'mailing_reply_cursors']

# Catalogue, formateurs, banque de questions
for n in ['courses', 'training_themes', 'course_equipment', 'equipment_catalog', 'programme_versions',
          'trainer_qualifications', 'course_documents']:
    t(n, sel=roles(INT), ins=roles(MGR), upd=roles(MGR), dele=roles(MGR))
for n in ['course_questions', 'theme_questions', 'positioning_questions_ref', 'positioning_themes']:
    t(n, sel=roles(INT), ins=roles(EDIT), upd=roles(EDIT), dele=roles(MGR))
own_trainer = f"({is_role('formateur')} and id = (select p.trainer_id from public.profiles p where p.id = (select auth.uid())))"
t('trainers', sel=roles(INT), ins=roles(MGR), upd=any_of(roles(MGR), own_trainer), dele=roles(MGR))
for n in ['trainer_interviews', 'trainer_trainings', 'trainer_certificates']:
    t(n, sel=roles(MGR), ins=roles(MGR), upd=roles(MGR), dele=roles(MGR))

# Sessions (formateur : ses sessions seulement)
SESS_READ = MGR + ['commercial', 'lecture', 'comptable']
t('sessions', sel=any_of(roles(SESS_READ), trainer('id')), ins=roles(SALES),
  upd=any_of(roles(SALES), trainer('id')), dele=roles(MGR))
for n in ['session_checklists', 'session_documents', 'session_document_access', 'session_emails_sent',
          'session_equipment', 'session_needs_analysis', 'session_qualiopi']:
    t(n, sel=any_of(roles(MGR + ['commercial', 'lecture']), trainer()), ins=any_of(roles(SALES), trainer()),
      upd=any_of(roles(SALES), trainer()), dele=any_of(roles(MGR), trainer()))
for n in ['session_fundings', 'session_groups', 'session_trainers']:
    t(n, sel=any_of(roles(SESS_READ), trainer()), ins=roles(SALES), upd=roles(SALES), dele=roles(SALES))
t('session_costs', sel=roles(MGR), ins=roles(MGR), upd=roles(MGR), dele=roles(MGR))
for n in ['attendance_halfdays', 'attendance_proxy_signatures', 'attendances', 'document_signatures']:
    t(n, sel=any_of(roles(MGR + ['commercial', 'lecture']), trainer()), ins=any_of(roles(MGR), trainer()),
      upd=any_of(roles(MGR), trainer()), dele=roles(MGR))
t('course_document_downloads', sel=any_of(roles(MGR + ['commercial', 'lecture']), trainer()),
  ins=any_of(roles(SALES), trainer()), dele=roles(MGR))
for n in ['documents', 'uploaded_documents', 'uploaded_files']:
    t(n, sel=roles(STAFF), ins=roles(EDIT), upd=roles(EDIT), dele=roles(MGR))

# Stagiaires (formateur : stagiaires de ses sessions)
TRAINEE_READ = MGR + ['commercial', 'lecture', 'comptable']
t('trainees', sel=any_of(roles(TRAINEE_READ), trainer_trainee('id')), ins=roles(EDIT),
  upd=any_of(roles(SALES), trainer_trainee('id')), dele=roles(MGR))
t('session_trainees', sel=any_of(roles(TRAINEE_READ), trainer()), ins=any_of(roles(SALES), trainer()),
  upd=any_of(roles(SALES), trainer()), dele=any_of(roles(SALES), trainer()))
for n in ['trainee_info_sheets', 'trainee_objectives', 'trainee_positioning_tests', 'positioning_results',
          'sst_certifications']:
    t(n, sel=any_of(roles(MGR + ['commercial', 'lecture']), trainer()), ins=any_of(roles(MGR), trainer()),
      upd=any_of(roles(MGR), trainer()), dele=any_of(roles(MGR), trainer()))
t('quiz_attempts', sel=any_of(roles(MGR + ['commercial', 'lecture']), trainer()),
  upd=roles(SA), dele=roles(SA))
for n in ['trainee_evaluations', 'evaluations_cold', 'trainer_evaluations']:
    t(n, sel=any_of(roles(MGR + ['commercial', 'lecture']), trainer()), ins=any_of(roles(MGR), trainer()),
      upd=roles(SA), dele=roles(SA))
t('trainee_documents', sel=any_of(roles(MGR + ['commercial', 'lecture']), trainer_trainee()),
  ins=any_of(roles(MGR), trainer_trainee()), upd=any_of(roles(MGR), trainer_trainee()), dele=roles(MGR))
t('trainees_archive', sel=roles(MGR), ins=roles(MGR), upd=roles(MGR), dele=roles(MGR))

# Clients (technicien : clients de ses visites)
t('clients', sel=any_of(roles(INT), tech_client('id')), ins=roles(SALES), upd=roles(SALES), dele=roles(MGR))
for n in ['client_contacts', 'sites']:
    t(n, sel=any_of(roles(INT), tech_client()), ins=roles(SALES), upd=roles(SALES), dele=roles(SALES))
t('client_interactions', sel=roles(INT), ins=roles(EDIT + ['comptable']), upd=roles(SALES), dele=roles(MGR))
for n in ['client_portal_access', 'client_providers']:
    t(n, sel=roles(SALES), ins=roles(SALES), upd=roles(SALES), dele=roles(SALES))

# Devis et factures (formateur, lecture, technicien : aucun accès)
BILL = SALES + ['comptable']
t('quotes', sel=roles(BILL), ins=roles(SALES), upd=roles(SALES), dele=roles(MGR))
t('quote_items', sel=roles(BILL), ins=roles(SALES), upd=roles(SALES), dele=roles(SALES))
draft_only = f"({roles(['commercial', 'comptable'])} and status = 'draft')"
t('invoices', sel=roles(BILL), ins=roles(BILL), upd=roles(BILL), dele=any_of(roles(MGR), draft_only))
for n in ['invoice_items', 'invoice_sessions', 'invoice_payments']:
    t(n, sel=roles(BILL), ins=roles(BILL), upd=roles(BILL), dele=roles(BILL))
for n in ['invoice_relances', 'invoice_emails_sent']:
    t(n, sel=roles(BILL), ins=roles(BILL), upd=roles(BILL), dele=roles(MGR))

# Prospection
for n in ['prospect_calls', 'prospect_email_logs', 'prospect_needs_analysis', 'prospect_rdv', 'phoning_sessions',
          'call_arguments', 'call_objections', 'rdv_kit_documents', 'rdv_emails_sent', 'import_logs']:
    t(n, module='prospection', sel=roles(SALES), ins=roles(SALES), upd=roles(SALES), dele=roles(SALES))
t('prospection_massive', module='prospection', sel=roles(SALES), ins=roles(SALES), upd=roles(SALES), dele=roles(MGR))

# Campagnes email
for n in ['mailing_blocklist', 'mailing_campaigns', 'mailing_email_status', 'mailing_segments', 'mailing_sends',
          'mailing_templates']:
    t(n, module='mailing', sel=roles(SALES), ins=roles(SALES), upd=roles(SALES), dele=roles(SALES))

# Réseaux sociaux
for n in ['social_posts', 'social_media_library']:
    t(n, module='social', sel=roles(SALES), ins=roles(SALES), upd=roles(SALES), dele=roles(SALES))

# Budget et comptabilité (module Budget ou module Espace comptable)
FIN_MOD = 'finance|comptabilite'
for n in ['budget_actions', 'budget_categories', 'budget_emails_sent', 'budget_meal_guests', 'budget_pipeline',
          'budget_receipts', 'budget_rules', 'budget_settings', 'budget_transaction_invoices', 'bank_statements',
          'accounting_periods']:
    t(n, module=FIN_MOD, sel=roles(FIN), ins=roles(FIN), upd=roles(FIN), dele=roles(FIN))
private_ok = "(is_private = false or private_owner = ((select auth.jwt()) ->> 'email'))"
t('budget_transactions', module=FIN_MOD, sel=f"({roles(FIN)} and {private_ok})",
  ins=f"({roles(FIN)} and {private_ok})", upd=f"({roles(FIN)} and {private_ok})",
  dele=f"({roles(FIN)} and {private_ok})")

# Qualité (registres coupés avec le module ; documents qualité toujours lisibles)
for n in ['non_conformites', 'non_conformities', 'reclamations', 'quality_alerts', 'veille_qualiopi',
          'veille_sources', 'processes', 'process_categories', 'process_connections', 'process_responsibles',
          'process_steps', 'process_versions', 'audits_internes', 'rgpd_traitements', 'bpf_declarations',
          'qualiopi_indicators']:
    t(n, module='qualite', sel=roles(STAFF), ins=roles(EDIT), upd=roles(MGR), dele=roles(MGR))
# Registre PSH (handicap, donnée de santé) : direction et référent handicap seulement (ajout du chantier F, 17/10)
HANDI = "(select app.can_see_disability())"
t('psh_requests', module='qualite', sel=HANDI, ins=HANDI, upd=HANDI, dele=HANDI)
for n in ['quality_documents', 'qualiopi_documents']:
    t(n, sel=roles(INT), ins=roles(MGR), upd=roles(MGR), dele=roles(MGR))
t('quality_doc_versions', sel=roles(INT), ins=roles(['superadmin', 'admin', 'direction']))

# Certification (NDA et Qualiopi)
for n in ['cert_audit_findings', 'cert_criteria', 'cert_documents', 'cert_indicator_status', 'cert_indicators',
          'cert_proofs', 'cert_referentials', 'cert_settings']:
    t(n, module='certification', sel=roles(MGR), ins=roles(MGR), upd=roles(MGR), dele=roles(MGR))

# DUERP
for n in ['duerp_actions', 'duerp_equipements', 'duerp_formations_reglementaires', 'duerp_habilitations',
          'duerp_projects', 'duerp_risk_categories', 'duerp_risk_templates', 'duerp_risks', 'duerp_sector_templates',
          'duerp_units', 'duerp_verifications']:
    t(n, module='duerp', sel=roles(MGR), ins=roles(MGR), upd=roles(MGR), dele=roles(MGR))

# Interventions (technicien : ses visites et les clients de ses visites, aucun prix de contrat)
ITV_READ = MGR + ['formateur', 'commercial', 'lecture']
for n in ['itv_settings', 'itv_equipment_types', 'itv_parts', 'itv_technicians']:
    t(n, module='interventions', sel=roles(ITV_READ + ['technicien']), ins=roles(MGR), upd=roles(MGR), dele=roles(MGR))
t('itv_contracts', module='interventions', sel=roles(ITV_READ), ins=roles(MGR), upd=roles(MGR), dele=roles(MGR))
tech_own_visit = f"({is_role('technicien')} and technician_id = (select auth.uid()))"
t('itv_visits', module='interventions', sel=any_of(roles(ITV_READ), tech_client()),
  ins=any_of(roles(MGR), f"({tech_own_visit} and client_id in (select app.tech_client_ids()))"),
  upd=any_of(roles(MGR), tech_own_visit), dele=roles(MGR))
t('itv_equipment', module='interventions', sel=any_of(roles(ITV_READ), tech_client()),
  ins=any_of(roles(MGR), tech_client()), upd=any_of(roles(MGR), tech_client()), dele=roles(MGR))
tech_scope_item = f"({is_role('technicien')} and visit_id in (select app.tech_scope_visit_ids()))"
tech_own_item = f"({is_role('technicien')} and visit_id in (select app.tech_visit_ids()))"
for n in ['itv_visit_items', 'itv_visit_parts']:
    t(n, module='interventions', sel=any_of(roles(ITV_READ), tech_scope_item),
      ins=any_of(roles(MGR), tech_own_item), upd=any_of(roles(MGR), tech_own_item),
      dele=any_of(roles(MGR), tech_own_item))


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


def build():
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
    names = sorted(M)
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
    out.append("""
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
""")
    # Regroupement des tables aux règles identiques
    groups = {}
    for n in names:
        spec = M[n]
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


def tables():
    return sorted(M)


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[2]
    target = root / 'supabase' / 'migrations' / '0082_securite_regles.sql'
    target.write_text(build(), encoding='utf-8')
    print(f"{target.relative_to(root)} : {len(M)} tables")
