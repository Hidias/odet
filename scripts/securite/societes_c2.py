#!/usr/bin/env python3
"""Chantier C2 : rattachement des tables existantes aux sociétés (migrations 0274 et 0275).

Classes de la spec multi-sociétés (§ 3) :
  A  propre à une société      : company_id (société courante à la création)
  B  fille                     : company_id recopié du parent par déclencheur (le parent fait foi)
  C  partageable               : company_id (société d'origine) et company_ids (sociétés qui voient la fiche)
  D  plateforme                : rien (tables non citées ici)

Isolement (0275) : quatre règles restrictives par table de classe A, B ou C, ajoutées aux règles existantes (qui
restent celles du chantier 2 et de C1b) : lecture des seules sociétés lisibles, écriture dans la société courante.
Avec une seule société, aucun accès ne change.

Utilisation : python3 scripts/securite/societes_c2.py   (écrit les deux migrations et le retour arrière)
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# Classe A : propres à une société
A = """
sessions trainees invoices quotes invoice_emails_sent itv_visits itv_contracts itv_equipment
budget_actions budget_categories budget_emails_sent budget_meal_guests budget_pipeline budget_rules budget_settings
budget_transactions bank_statements accounting_periods bpf_declarations
cert_audit_findings cert_documents cert_indicator_status cert_proofs cert_settings duerp_projects
pp_envois pp_accuses pp_fichiers prospection_massive prospect_calls prospect_rdv prospect_email_logs
prospect_needs_analysis phoning_sessions rdv_emails_sent rdv_kit_documents mailing_campaigns mailing_segments
mailing_email_status mailing_blocklist social_posts social_media_library social_tokens non_conformites
non_conformities reclamations quality_alerts completude_alerts completude_tracking notifications audit_logs
error_logs rgpd_traitements veille_qualiopi veille_sources processes process_categories process_responsibles
qualiopi_indicators audits_internes documents uploaded_documents uploaded_files import_logs
signature_alerts_sent trainees_archive psh_requests client_interactions client_portal_access client_providers
""".split()

# Classe B : filles, (parent, colonne de la clé vers le parent)
B = {
    'quote_items': ('quotes', 'quote_id'),
    'invoice_items': ('invoices', 'invoice_id'),
    'invoice_sessions': ('invoices', 'invoice_id'),
    'invoice_payments': ('invoices', 'invoice_id'),
    'invoice_relances': ('invoices', 'invoice_id'),
    'session_trainees': ('sessions', 'session_id'),
    'session_trainers': ('sessions', 'session_id'),
    'session_checklists': ('sessions', 'session_id'),
    'session_costs': ('sessions', 'session_id'),
    'session_document_access': ('sessions', 'session_id'),
    'session_documents': ('sessions', 'session_id'),
    'session_emails_sent': ('sessions', 'session_id'),
    'session_equipment': ('sessions', 'session_id'),
    'session_fundings': ('sessions', 'session_id'),
    'session_groups': ('sessions', 'session_id'),
    'session_needs_analysis': ('sessions', 'session_id'),
    'session_qualiopi': ('sessions', 'session_id'),
    'session_sequences': ('sessions', 'session_id'),
    'attendance_halfdays': ('sessions', 'session_id'),
    'attendance_proxy_signatures': ('sessions', 'session_id'),
    'attendances': ('sessions', 'session_id'),
    'document_signatures': ('sessions', 'session_id'),
    'trainee_evaluations': ('sessions', 'session_id'),
    'evaluations_cold': ('sessions', 'session_id'),
    'trainer_evaluations': ('sessions', 'session_id'),
    'trainee_info_sheets': ('sessions', 'session_id'),
    'trainee_objectives': ('sessions', 'session_id'),
    'trainee_positioning_tests': ('sessions', 'session_id'),
    'positioning_results': ('sessions', 'session_id'),
    'quiz_attempts': ('sessions', 'session_id'),
    'sst_certifications': ('sessions', 'session_id'),
    'formative_evaluations': ('sessions', 'session_id'),
    'formative_sheets': ('sessions', 'session_id'),
    'course_document_downloads': ('sessions', 'session_id'),
    'pp_lignes': ('sessions', 'session_id'),
    'trainee_documents': ('trainees', 'trainee_id'),
    'trainee_disability': ('trainees', 'trainee_id'),
    'trainee_ssn': ('trainees', 'trainee_id'),
    'pp_nir': ('trainees', 'trainee_id'),
    'itv_visit_items': ('itv_visits', 'visit_id'),
    'itv_visit_parts': ('itv_visits', 'visit_id'),
    'duerp_actions': ('duerp_projects', 'project_id'),
    'duerp_risks': ('duerp_projects', 'project_id'),
    'duerp_units': ('duerp_projects', 'project_id'),
    'duerp_equipements': ('duerp_projects', 'project_id'),
    'duerp_habilitations': ('duerp_projects', 'project_id'),
    'duerp_verifications': ('duerp_projects', 'project_id'),
    'budget_receipts': ('budget_transactions', 'transaction_id'),
    'budget_transaction_invoices': ('budget_transactions', 'transaction_id'),
    'mailing_sends': ('mailing_campaigns', 'campaign_id'),
    'process_steps': ('processes', 'process_id'),
    'process_versions': ('processes', 'process_id'),
    'process_connections': ('processes', 'process_id'),
}

# Classe C : partageables entre sociétés
C = """
clients client_contacts sites trainers trainer_certificates trainer_interviews trainer_qualifications trainer_trainings
courses course_documents course_equipment course_questions course_sequences training_themes theme_questions
positioning_questions_ref positioning_themes programme_versions equipment_catalog itv_equipment_types itv_parts
itv_technicians mailing_templates call_arguments call_objections quality_documents quality_doc_versions
qualiopi_documents pp_course_settings pp_presets
""".split()

# Table déjà dotée d'une colonne company_id facultative sans clé étrangère (0260) : rattachée comme une table A
DEJA = ['user_feedback']

EXTERNES = "array['entreprise', 'formateur_externe', 'stagiaire']"


def classes():
    assert not (set(A) & set(B)) and not (set(A) & set(C)) and not (set(B) & set(C)), "table dans deux classes"
    return A + DEJA, B, C


def guard_exists(t, body):
    return f"""do $$
begin
  if to_regclass('public.{t}') is not null then
{body}
  end if;
end
$$;"""


def build_0274():
    a, b, c = classes()
    out = ["""-- 0274_societes_colonnes.sql : société propriétaire sur chaque donnée existante (chantier C2).
-- FICHIER GÉNÉRÉ par scripts/securite/societes_c2.py. Ne pas modifier à la main.
--
-- Spec multi-sociétés § 3 et § 8 : colonne company_id (et company_ids pour les fiches partageables), remplie par la
-- société qui porte l'instance (société n° 1), non nulle, clé étrangère vers companies, index.
--   A  propre à une société : défaut app.company_default() (société courante, sinon société n° 1) ;
--   B  fille : company_id recopié du parent par déclencheur (app.societe_du_parent) : le parent fait foi ;
--   C  partageable : company_ids (sociétés qui voient la fiche, contient toujours la société d'origine).
-- L'ajout d'une colonne avec valeur par défaut remplit les lignes existantes sans passer par les déclencheurs : les
-- verrous (factures émises) ne sont ni levés ni contournés.
-- Les tables absentes d'une instance sont ignorées. Idempotente.
-- Retour arrière : supabase/rollback/0274-0275_societes_retour.sql

-- Société par défaut d'une écriture : société courante, sinon celle qui porte l'instance (tâches, portails)
create or replace function app.company_default()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.current_company(), (select c.id from public.companies c where c.is_instance_owner limit 1))
$$;
revoke all on function app.company_default() from public, anon;
grant execute on function app.company_default() to authenticated, service_role;

-- Fille : société du parent (le parent fait foi) ; sans parent, la valeur reçue ou la société par défaut
create or replace function app.societe_du_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent uuid := (to_jsonb(new) ->> tg_argv[1])::uuid;
  v_company uuid;
begin
  if v_parent is not null then
    execute format('select company_id from public.%I where id = $1', tg_argv[0]) into v_company using v_parent;
  end if;
  new.company_id := coalesce(v_company, new.company_id, app.company_default());
  return new;
end
$$;
revoke all on function app.societe_du_parent() from public, anon, authenticated;

-- Partageable : la société d'origine figure toujours parmi les sociétés qui voient la fiche
create or replace function app.societes_partage()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.company_id := coalesce(new.company_id, app.company_default());
  if new.company_ids is null or not (new.company_id = any (new.company_ids)) then
    new.company_ids := array_append(coalesce(new.company_ids, '{}'::uuid[]), new.company_id);
  end if;
  return new;
end
$$;
revoke all on function app.societes_partage() from public, anon, authenticated;
"""]
    col = """    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = '{t}' and column_name = 'company_id') then
      alter table public.{t} add column company_id uuid not null default app.company_default();
    else
      update public.{t} set company_id = app.company_default() where company_id is null;
      alter table public.{t} alter column company_id set default app.company_default();
      alter table public.{t} alter column company_id set not null;
    end if;
    if not exists (select 1 from pg_constraint where conname = '{t}_company_fk') then
      alter table public.{t} add constraint {t}_company_fk foreign key (company_id) references public.companies (id);
    end if;
    create index if not exists {t}_company_idx on public.{t} (company_id);"""
    out.append("\n-- ===== Classe A : propres à une société =====")
    for t in a:
        out.append(f"\n-- {t}\n" + guard_exists(t, col.format(t=t)))
    out.append("\n-- ===== Classe B : filles, société du parent =====")
    for t, (parent, fk) in b.items():
        body = col.format(t=t) + f"""
    drop trigger if exists {t}_societe on public.{t};
    create trigger {t}_societe before insert or update of {fk} on public.{t}
      for each row execute function app.societe_du_parent('{parent}', '{fk}');"""
        out.append(f"\n-- {t} (parent {parent}.{fk})\n" + guard_exists(t, body))
    out.append("\n-- ===== Classe C : partageables =====")
    for t in c:
        body = col.format(t=t) + f"""
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = '{t}' and column_name = 'company_ids') then
      alter table public.{t} add column company_ids uuid[] not null default array[app.company_default()];
    end if;
    create index if not exists {t}_company_ids_idx on public.{t} using gin (company_ids);
    drop trigger if exists {t}_societes on public.{t};
    create trigger {t}_societes before insert or update of company_id, company_ids on public.{t}
      for each row execute function app.societes_partage();"""
        out.append(f"\n-- {t}\n" + guard_exists(t, body))
    out.append("\ninsert into public.schema_migrations (version) values ('0274_societes_colonnes') on conflict (version) do nothing;\n")
    return "\n".join(out)


def build_0275():
    a, b, c = classes()
    out = [f"""-- 0275_societes_isolement.sql : isolement des données entre sociétés (chantier C2).
-- FICHIER GÉNÉRÉ par scripts/securite/societes_c2.py. Ne pas modifier à la main.
--
-- Quatre règles restrictives par table de classe A, B ou C, en plus des règles existantes (chantier 2 et C1b, qui
-- décident toujours qui voit et modifie quoi) : une ligne n'est lue que si sa société est lisible pour le compte, et
-- n'est créée, modifiée ou supprimée que dans la société courante.
--   app.societes_lisibles() : sociétés de ses appartenances (super administrateur : sociétés ouvertes au support) ;
--     comptes externes (entreprise, formateur externe, stagiaire) : toutes, leurs règles les limitant à leurs objets ;
--   app.societes_ecriture() : la société courante (aucune en vue groupe) ; comptes externes : toutes.
-- Avec une seule société, aucun accès ne change. Les portails (anonymes) et les tâches (clé de service) ne sont pas
-- concernés : ils passent par des fonctions qui déduisent la société de l'objet.
-- Idempotente. Retour arrière : supabase/rollback/0274-0275_societes_retour.sql

create or replace function app.societes_lisibles()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.companies c where (select app.role()) = any ({EXTERNES})
  union
  select v from app.visible_companies() v where not coalesce((select app.role()) = any ({EXTERNES}), false)
$$;

create or replace function app.societes_ecriture()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.companies c where (select app.role()) = any ({EXTERNES})
  union
  select app.current_company() where app.current_company() is not null
    and not coalesce((select app.role()) = any ({EXTERNES}), false)
$$;

revoke all on function app.societes_lisibles(), app.societes_ecriture() from public, anon;
grant execute on function app.societes_lisibles(), app.societes_ecriture() to authenticated, service_role;

create or replace function pg_temp.isoler(p_table text, p_partage boolean)
returns void
language plpgsql
as $f$
declare
  v_lire text := case when p_partage then 'company_ids && array(select app.societes_lisibles())'
                      else 'company_id in (select app.societes_lisibles())' end;
  v_ecrire text := case when p_partage then 'company_ids && array(select app.societes_ecriture())'
                        else 'company_id in (select app.societes_ecriture())' end;
begin
  if to_regclass('public.' || p_table) is null then
    return;
  end if;
  -- Table du serveur seul (aucune règle pour les comptes connectés) : rien à isoler, elle reste fermée
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = p_table
                 and policyname not like '%\\_societe\\_%' and 'authenticated' = any (roles)) then
    return;
  end if;
  execute format('alter table public.%I enable row level security', p_table);
  execute format('drop policy if exists %I on public.%I', p_table || '_societe_lire', p_table);
  execute format('drop policy if exists %I on public.%I', p_table || '_societe_creer', p_table);
  execute format('drop policy if exists %I on public.%I', p_table || '_societe_modifier', p_table);
  execute format('drop policy if exists %I on public.%I', p_table || '_societe_supprimer', p_table);
  execute format('create policy %I on public.%I as restrictive for select to authenticated using (%s)', p_table || '_societe_lire', p_table, v_lire);
  execute format('create policy %I on public.%I as restrictive for insert to authenticated with check (%s)', p_table || '_societe_creer', p_table, v_ecrire);
  execute format('create policy %I on public.%I as restrictive for update to authenticated using (%s) with check (%s)', p_table || '_societe_modifier', p_table, v_ecrire, v_ecrire);
  execute format('create policy %I on public.%I as restrictive for delete to authenticated using (%s)', p_table || '_societe_supprimer', p_table, v_ecrire);
end
$f$;
"""]
    for t in a + list(b):
        out.append(f"select pg_temp.isoler('{t}', false);")
    for t in c:
        out.append(f"select pg_temp.isoler('{t}', true);")
    out.append("\ninsert into public.schema_migrations (version) values ('0275_societes_isolement') on conflict (version) do nothing;\n")
    return "\n".join(out)


def build_retour():
    a, b, c = classes()
    out = ["""-- 0274-0275_societes_retour.sql : retour arrière du rattachement des données aux sociétés (chantier C2).
-- FICHIER GÉNÉRÉ par scripts/securite/societes_c2.py. Ne pas modifier à la main.
-- Retire les règles d'isolement, les déclencheurs, les colonnes company_id et company_ids posées par 0274 (la colonne
-- facultative de user_feedback, de 0260, est remise facultative sans clé étrangère), puis les fonctions.
-- Refusé s'il existe plus d'une société : les données d'une deuxième société ne doivent pas se mélanger.

do $$
begin
  if (select count(*) from public.companies) > 1 then
    raise exception 'Retour arrière refusé : plusieurs sociétés existent, leurs données se mélangeraient';
  end if;
end
$$;
"""]
    for t in a + list(b) + c:
        drops = f"""    execute 'drop policy if exists {t}_societe_lire on public.{t}';
    execute 'drop policy if exists {t}_societe_creer on public.{t}';
    execute 'drop policy if exists {t}_societe_modifier on public.{t}';
    execute 'drop policy if exists {t}_societe_supprimer on public.{t}';
    execute 'drop trigger if exists {t}_societe on public.{t}';
    execute 'drop trigger if exists {t}_societes on public.{t}';
    execute 'alter table public.{t} drop constraint if exists {t}_company_fk';
    execute 'drop index if exists public.{t}_company_idx';
    execute 'drop index if exists public.{t}_company_ids_idx';
    execute 'alter table public.{t} drop column if exists company_ids';"""
        if t in DEJA:
            drops += f"""
    execute 'alter table public.{t} alter column company_id drop not null';
    execute 'alter table public.{t} alter column company_id drop default';"""
        else:
            drops += f"""
    execute 'alter table public.{t} drop column if exists company_id';"""
        out.append(f"-- {t}\n" + guard_exists(t, drops))
    out.append("""
drop function if exists app.societes_lisibles();
drop function if exists app.societes_ecriture();
drop function if exists app.societe_du_parent();
drop function if exists app.societes_partage();
drop function if exists app.company_default();

delete from public.schema_migrations where version in ('0274_societes_colonnes', '0275_societes_isolement');
""")
    return "\n".join(out)


if __name__ == '__main__':
    for rel, fn in (('supabase/migrations/0274_societes_colonnes.sql', build_0274),
                    ('supabase/migrations/0275_societes_isolement.sql', build_0275),
                    ('supabase/rollback/0274-0275_societes_retour.sql', build_retour)):
        (ROOT / rel).write_text(fn(), encoding='utf-8')
        print(f"{rel} : écrit")
    a, b, c = classes()
    print(f"classes : A {len(a)}, B {len(b)}, C {len(c)}")
