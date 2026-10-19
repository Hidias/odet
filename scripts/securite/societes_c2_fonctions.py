#!/usr/bin/env python3
"""Chantier C2, suite : fonctions « security definer » rattachées aux sociétés (migration 0276).

Les fonctions security definer contournent les règles d'accès : celles qui agissent sur un objet (session, visite,
stagiaire, facture, devis, client) vérifient désormais que l'objet appartient à une société du compte, et celles qui
renvoient des listes ou des comptes ne lisent que les sociétés du compte. Avec une seule société, rien ne change.

Le script lit les définitions actuelles dans une base locale équivalente à la production (après 0275), applique des
modifications ciblées et vérifiées (chacune doit s'appliquer exactement une fois), puis écrit la migration et son
retour arrière (définitions d'origine).

Utilisation : python3 scripts/securite/societes_c2_fonctions.py --base odet_c2b [--hote /var/tmp/pgodet --port 54329]
"""
import argparse
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# Garde ajoutée au début du corps : (fonction, table de l'objet, paramètre, écriture)
GARDES = [
    ('public.itv_close_visit(uuid)', 'itv_visits', 'p_visit', True),
    ('public.itv_generate_contract_visits(uuid,integer)', 'itv_contracts', 'p_contract', True),
    ('public.client_contact_sync_primary(uuid)', 'clients', 'p_client_id', True),
    ('public.get_trainee_with_ssn(uuid)', 'trainees', 'p_id', False),
    ('public.purge_trainee(uuid,text)', 'trainees', None, True),
    ('public.export_trainee_data(uuid)', 'trainees', None, False),
    ('public.pp_enregistrer_nom(uuid,text,boolean)', 'trainees', 'p_trainee_id', True),
    ('public.pp_enregistrer_refus(uuid,boolean)', 'trainees', 'p_trainee_id', True),
    ('public.pp_marquer_fichier(uuid,boolean)', 'pp_fichiers', 'p_fichier_id', True),
    ('public.detect_client_links(uuid)', 'clients', None, False),
    ('public.billing_issue(uuid)', 'invoices', 'p_invoice', True),
    ('public.billing_create_credit_note(uuid,text,jsonb,numeric)', 'invoices', 'p_invoice', True),
    ('public.billing_duplicate_invoice(uuid)', 'invoices', 'p_invoice', True),
    ('public.billing_request_validation(uuid)', 'invoices', 'p_invoice', True),
    ('public.billing_siret_motif(uuid,text)', 'invoices', 'p_invoice', True),
    ('public.billing_missing_mentions(uuid)', 'invoices', 'p_invoice', False),
    ('public.billing_create_deposit(uuid,numeric,numeric)', 'quotes', 'p_quote', True),
    ('public.billing_create_final(uuid)', 'quotes', 'p_quote', True),
    ('public.billing_deposit_summary(uuid)', 'quotes', 'p_quote', False),
]

# Remplacements ciblés : (fonction, ancien texte, nouveau texte)
SOC = "(select app.societes_lisibles())"
REMPLACEMENTS = [
    ('app.can_read_session(uuid)',
     "  false)\n$function$",
     "  false)\n  and app.societe_permise((select s.company_id from public.sessions s where s.id = p_session_id))\n$function$"),
    ('app.can_edit_session(uuid)',
     "  false)\n$function$",
     "  false)\n  and app.societe_permise((select s.company_id from public.sessions s where s.id = p_session_id), true)\n$function$"),
    ('app.itv_can_edit_visit_parts(uuid)',
     "             and p_visit in (select app.tech_visit_ids()))), false)",
     "             and p_visit in (select app.tech_visit_ids()))), false)\n"
     "    and app.societe_permise((select v.company_id from public.itv_visits v where v.id = p_visit), true)"),
    ('public.billing_compute_totals(uuid)',
     "where i.id = p_invoice and app.a_le_droit('facturation.factures.voir')",
     "where i.id = p_invoice and app.a_le_droit('facturation.factures.voir') and app.societe_permise(i.company_id)"),
    ('public.disability_count(uuid[])',
     "where d.has_disability and",
     f"where d.has_disability and d.company_id in {SOC} and"),
    ('public.psh_request_count()',
     "(select count(*) from public.psh_requests)",
     f"(select count(*) from public.psh_requests where company_id in {SOC})"),
    ('public.get_purge_stats()',
     "(SELECT COUNT(*) FROM trainees)::BIGINT",
     f"(SELECT COUNT(*) FROM trainees WHERE company_id in {SOC})::BIGINT"),
    ('public.get_purge_stats()',
     "(SELECT COUNT(*) FROM trainees_to_purge)::BIGINT",
     f"(SELECT COUNT(*) FROM trainees_to_purge tp WHERE tp.id in (select t.id from trainees t where t.company_id in {SOC}))::BIGINT"),
    ('public.get_purge_stats()',
     "COALESCE((SELECT MAX(years_since_activity) FROM trainees_to_purge), 0)",
     f"COALESCE((SELECT MAX(tp.years_since_activity) FROM trainees_to_purge tp WHERE tp.id in (select t.id from trainees t where t.company_id in {SOC})), 0)"),
    ('public.get_audit_logs(text,uuid,text,text,timestamp with time zone,timestamp with time zone,integer)',
     "  WHERE \n    (p_entity_type IS NULL",
     f"  WHERE al.company_id in {SOC}\n    AND (p_entity_type IS NULL"),
    ('public.pp_nir_etat(uuid[])',
     "from public.pp_nir n where n.trainee_id = any(p_trainee_ids);",
     f"from public.pp_nir n where n.trainee_id = any(p_trainee_ids) and n.company_id in {SOC};"),
    ('public.pp_donnees(uuid[],uuid[])',
     "    where s.end_date < current_date",
     f"    where s.end_date < current_date\n      and s.company_id in {SOC}"),
]

# itv_dashboard : chaque comptage limité aux sociétés du compte
ITV_TABLES = ('itv_equipment', 'itv_visits')


def psql(args, sql):
    r = subprocess.run(['psql', '-X', '-At', '-h', args.hote, '-p', str(args.port), '-U', 'postgres', '-d', args.base, '-c', sql],
                       text=True, capture_output=True, check=True)
    return r.stdout


def definition(args, sig):
    out = psql(args, f"select pg_get_functiondef('{sig}'::regprocedure)")
    assert out.strip(), sig
    return out.rstrip('\n') + ';\n'


def premier_parametre(defn):
    m = re.search(r'\((\w+) uuid', defn)
    assert m, 'paramètre uuid introuvable'
    return m.group(1)


def garde(defn, table, param, ecriture):
    param = param or premier_parametre(defn)
    ligne = (f"  /* société (C2) */ perform app.exiger_societe('{table}', {param}, {'true' if ecriture else 'false'});\n")
    lignes = defn.split('\n')
    idx = [i for i, l in enumerate(lignes) if l.strip().lower() == 'begin']
    assert idx, 'begin introuvable'
    lignes.insert(idx[0] + 1, ligne.rstrip('\n'))
    return '\n'.join(lignes)


def itv_dashboard(defn):
    n = 0
    for t in ITV_TABLES:
        new, k = re.subn(rf'from {t} where ', f'from {t} where company_id in {SOC} and ', defn)
        defn, n = new, n + k
    new, k = re.subn(r'from itv_visit_items i join itv_visits v on v.id = i.visit_id\n\s+where ',
                     lambda m: m.group(0) + f'v.company_id in {SOC} and ', defn)
    assert n == 5 and k == 1, (n, k)
    return new


ENTETE = """-- 0276_societes_fonctions.sql : fonctions « security definer » rattachées aux sociétés (chantier C2).
-- FICHIER GÉNÉRÉ par scripts/securite/societes_c2_fonctions.py à partir des définitions de production. Ne pas modifier.
--
-- Ces fonctions contournent les règles d'accès : elles vérifient désormais la société de l'objet traité (session,
-- visite, stagiaire, facture, devis, client) et ne comptent ou ne listent que les sociétés du compte.
--   app.societe_permise(société, écriture) : société lisible (ou société courante en écriture) ; vrai pour les tâches
--     du serveur (clé de service, tâches planifiées) ;
--   app.exiger_societe(table, id, écriture) : refus si l'objet appartient à une autre société ;
--   app.can_read_session, app.can_edit_session, app.itv_can_edit_visit_parts : condition de société ajoutée (elles
--     gardent les fonctions des feuilles d'émargement, des tests, des pièces de visite et le stockage) ;
--   alertes de complétude rattachées à la société de l'élément concerné.
-- Avec une seule société, rien ne change. Idempotente. Retour arrière : supabase/rollback/0276_societes_fonctions_retour.sql

create or replace function app.societe_permise(p_company uuid, p_ecriture boolean default false)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce((select auth.jwt()) ->> 'role', '') in ('', 'service_role') then true
    when p_company is null then false
    when p_ecriture then p_company in (select app.societes_ecriture())
    else p_company in (select app.societes_lisibles())
  end
$$;

create or replace function app.exiger_societe(p_table text, p_id uuid, p_ecriture boolean default false)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_companies uuid[];
  v_partage boolean := exists (select 1 from information_schema.columns
                               where table_schema = 'public' and table_name = p_table and column_name = 'company_ids');
begin
  if p_id is null or coalesce((select auth.jwt()) ->> 'role', '') in ('', 'service_role') then
    return;
  end if;
  if v_partage then
    execute format('select company_id, company_ids from public.%I where id = $1', p_table) into v_company, v_companies using p_id;
    if v_company is null then return; end if;
    if not (v_companies && (case when p_ecriture then array(select app.societes_ecriture()) else array(select app.societes_lisibles()) end)) then
      raise exception 'Accès refusé : cet élément appartient à une autre société' using errcode = '42501';
    end if;
  else
    execute format('select company_id from public.%I where id = $1', p_table) into v_company using p_id;
    if v_company is null then return; end if;
    if not app.societe_permise(v_company, p_ecriture) then
      raise exception 'Accès refusé : cet élément appartient à une autre société' using errcode = '42501';
    end if;
  end if;
end
$$;

revoke all on function app.societe_permise(uuid, boolean), app.exiger_societe(text, uuid, boolean) from public, anon;
grant execute on function app.societe_permise(uuid, boolean), app.exiger_societe(text, uuid, boolean) to authenticated, service_role;

-- Alertes de complétude : société de l'élément concerné (stagiaire, session, non-conformité), pas celle du compte
-- qui a lancé le calcul
create or replace function app.completude_societe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.entity_id is not null then
    new.company_id := coalesce(
      (select t.company_id from public.trainees t where t.id = new.entity_id),
      (select s.company_id from public.sessions s where s.id = new.entity_id),
      (select n.company_id from public.non_conformites n where n.id = new.entity_id),
      new.company_id);
  end if;
  return new;
end
$$;
revoke all on function app.completude_societe() from public, anon, authenticated;
do $$
begin
  if to_regclass('public.completude_alerts') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'completude_alerts' and column_name = 'entity_id') then
    drop trigger if exists completude_alerts_societe on public.completude_alerts;
    create trigger completude_alerts_societe before insert on public.completude_alerts
      for each row execute function app.completude_societe();
  end if;
end
$$;
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', required=True)
    ap.add_argument('--hote', default='/var/tmp/pgodet')
    ap.add_argument('--port', default=54329, type=int)
    args = ap.parse_args()

    originaux, nouveaux = {}, {}

    def obtenir(sig):
        if sig not in nouveaux:
            originaux[sig] = definition(args, sig)
            nouveaux[sig] = originaux[sig]
        return nouveaux[sig]

    for sig, old, new in REMPLACEMENTS:
        d = obtenir(sig)
        assert d.count(old) == 1, (sig, old, d.count(old))
        nouveaux[sig] = d.replace(old, new)
    sig = 'public.itv_dashboard()'
    nouveaux[sig] = itv_dashboard(obtenir(sig))
    for sig, table, param, ecriture in GARDES:
        nouveaux[sig] = garde(obtenir(sig), table, param, ecriture)

    out = [ENTETE]
    for sig in nouveaux:
        out.append(f"\n-- {sig}\n" + nouveaux[sig])
    out.append("\ninsert into public.schema_migrations (version) values ('0276_societes_fonctions') on conflict (version) do nothing;\n")
    (ROOT / 'supabase/migrations/0276_societes_fonctions.sql').write_text('\n'.join(out), encoding='utf-8')

    rb = ["""-- Retour arrière de 0276_societes_fonctions.sql : définitions d'avant C2 remises, aides et déclencheur retirés.
-- FICHIER GÉNÉRÉ par scripts/securite/societes_c2_fonctions.py. Idempotent.
"""]
    for sig in originaux:
        rb.append(f"\n-- {sig}\n" + originaux[sig])
    rb.append("""
drop trigger if exists completude_alerts_societe on public.completude_alerts;
drop function if exists app.completude_societe();
drop function if exists app.exiger_societe(text, uuid, boolean);
drop function if exists app.societe_permise(uuid, boolean);

delete from public.schema_migrations where version = '0276_societes_fonctions';
""")
    (ROOT / 'supabase/rollback/0276_societes_fonctions_retour.sql').write_text('\n'.join(rb), encoding='utf-8')
    print(f"0276 : {len(nouveaux)} fonctions modifiées")


if __name__ == '__main__':
    main()
