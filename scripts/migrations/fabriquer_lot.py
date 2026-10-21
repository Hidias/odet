#!/usr/bin/env python3
"""Fabrique les fichiers d'un lot de migrations pour l'action « Migrations en production ».

Utilisation :
  python3 scripts/migrations/fabriquer_lot.py LOT RETOUR MIGRATION [MIGRATION ...]
  ex. python3 scripts/migrations/fabriquer_lot.py c1_0376 supabase/rollback/0376_maintenance_nuit_retour.sql \\
          supabase/migrations/0376_maintenance_nuit.sql

Écrit :
  supabase/tests/essai_<lot>_transaction_annulee.sql : migrations puis tests de droits (droits_chantier2.sql),
      se termine par l'erreur volontaire « N test(s), M échec(s) » : tout est annulé ;
  supabase/tests/essai_retour_<lot>_transaction_annulee.sql : photographie de l'état, migrations, retour arrière,
      comparaison, se termine par « N écart(s) » : tout est annulé ;
  supabase/application/<lot>.sql : application réelle (une seule transaction) ;
  supabase/lots/<lot>.conf : description du lot pour l'action.
Ne pas modifier les fichiers produits à la main. Aucun BEGIN ni COMMIT.
"""
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[2]
ENTETE = "select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);\n"
ETAT = """
create temp view etat_essai as
  select 'règle' as kind, schemaname || '.' || tablename || '.' || policyname as name,
         md5(concat_ws('|', permissive, roles::text, cmd, qual, with_check)) as v
  from pg_policies where schemaname in ('public', 'storage')
  union all
  select 'fonction', p.oid::regprocedure::text,
         md5(concat_ws('|', pg_get_functiondef(p.oid), p.prosecdef::text, p.proconfig::text,
             (select string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',' order by a.grantee::regrole::text, a.privilege_type)
              from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a)))
  from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace) and p.prokind in ('f', 'p')
  union all
  select 'droits table', c.oid::regclass::text,
         md5(coalesce((select string_agg(a.grantee::regrole::text || ':' || a.privilege_type || ':' || a.is_grantable::text, ','
                               order by a.grantee::regrole::text, a.privilege_type)
                       from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a), '') || c.relrowsecurity::text)
  from pg_class c where c.relnamespace in ('public'::regnamespace, 'app'::regnamespace) and c.relkind in ('r', 'v', 'm', 'p')
  union all
  select 'vue', c.oid::regclass::text, md5(pg_get_viewdef(c.oid) || coalesce(c.reloptions::text, ''))
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
  union all
  select 'colonne', table_schema || '.' || table_name || '.' || column_name, md5(data_type || is_nullable || coalesce(column_default, ''))
  from information_schema.columns where table_schema in ('public', 'app')
  union all
  select 'contrainte', conrelid::regclass::text || '.' || conname, md5(pg_get_constraintdef(oid))
  from pg_constraint where connamespace in ('public'::regnamespace, 'app'::regnamespace)
  union all
  select 'index', indexrelid::regclass::text, md5(pg_get_indexdef(indexrelid))
  from pg_index where indrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace, 'app'::regnamespace))
  union all
  select 'déclencheur', tgrelid::regclass::text || '.' || tgname, md5(tgfoid::regprocedure::text || tgenabled::text)
  from pg_trigger where not tgisinternal
    and tgrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace, 'app'::regnamespace))
  union all
  select 'migrations', 'public.schema_migrations', md5(coalesce(string_agg(version, ',' order by version), ''))
  from public.schema_migrations
  union all
  select 'données', 'organization_settings', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.organization_settings t
  union all
  select 'données', 'profiles', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.profiles t
  union all
  select 'données', 'org_modules', md5(coalesce(string_agg(t::text, ',' order by t.key), '')) from public.org_modules t
  union all
  select 'données', 'company_members', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.company_members t
  union all
  select 'données', 'company_member_roles', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.company_member_roles t;
create temp table etat_essai_avant as select * from etat_essai;
"""
VERIF = """
do $verif$
declare
  v_diff text[];
  v_n int;
  v_par text;
begin
  select count(*), (array_agg(coalesce(a.kind, b.kind) || ' ' || coalesce(a.name, b.name) || case
           when a.name is null then ' (en trop après retour)' when b.name is null then ' (manquant après retour)'
           else ' (différent)' end order by coalesce(a.kind, b.kind) desc, coalesce(a.name, b.name)))[1:40]
    into v_n, v_diff
  from etat_essai_avant a full join etat_essai b on a.kind = b.kind and a.name = b.name
  where a.v is distinct from b.v;
  select string_agg(k || ' ' || n, ', ') into v_par from (
    select coalesce(a.kind, b.kind) k, count(*) n
    from etat_essai_avant a full join etat_essai b on a.kind = b.kind and a.name = b.name
    where a.v is distinct from b.v group by 1) z;
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE {lot} (tout est annulé)\\n% écart(s) avec l''état d''avant (%)\\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\\n'), '');
end
$verif$;
"""


def bloc(f):
    return f"\n-- ===== {f.relative_to(root)} =====\n" + f.read_text(encoding='utf-8')


def ecrire(path, text):
    assert not re.search(r'^\s*commit\s*;', text, re.I | re.M), f'COMMIT interdit : {path}'
    assert not re.search(r'^\s*begin\s*;', text, re.I | re.M), f'BEGIN interdit : {path}'
    path.parent.mkdir(exist_ok=True)
    path.write_text(text, encoding='utf-8')
    print(f"{path.relative_to(root)} : {len(text)} caractères")


def main():
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    lot = sys.argv[1]
    assert re.fullmatch(r'[a-z0-9_-]+', lot), 'nom de lot : minuscules, chiffres, _ et -'
    retour = (root / sys.argv[2]).resolve()
    mig = [(root / m).resolve() for m in sys.argv[3:]]
    for f in [retour, *mig]:
        assert f.is_file(), f
    tests = root / 'supabase' / 'tests' / 'droits_chantier2.sql'
    noms = ', '.join(f.name for f in mig)
    gen = f"-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py ({lot}) : ne pas modifier à la main.\n"

    essai = root / 'supabase' / 'tests' / f'essai_{lot}_transaction_annulee.sql'
    ecrire(essai, gen + f"-- Essai en transaction annulée : {noms}, puis tous les tests de droits. Se termine TOUJOURS par\n"
           "-- l'erreur volontaire « RÉSULTAT DES TESTS DE DROITS » : tout est annulé.\n" + ENTETE
           + "".join(bloc(f) for f in mig) + bloc(tests))

    retour_essai = root / 'supabase' / 'tests' / f'essai_retour_{lot}_transaction_annulee.sql'
    ecrire(retour_essai, gen + f"-- Essai du retour arrière en transaction annulée : photographie, {noms}, retour arrière,\n"
           "-- comparaison. Se termine TOUJOURS par l'erreur volontaire « RÉSULTAT DE L'ESSAI DU RETOUR ARRIÈRE » : tout est annulé.\n"
           + ENTETE + ETAT + "".join(bloc(f) for f in mig) + bloc(retour) + VERIF.replace('{lot}', lot))

    application = root / 'supabase' / 'application' / f'{lot}.sql'
    ecrire(application, gen + f"-- APPLICATION RÉELLE sur l'instance : {noms}. Une seule transaction : si une instruction échoue,\n"
           f"-- rien n'est appliqué. Retour arrière : {retour.relative_to(root)}\n" + ENTETE + "".join(bloc(f) for f in mig))

    conf = root / 'supabase' / 'lots' / f'{lot}.conf'
    ecrire(conf, f"# Lot {lot} : {noms} (fichier généré par scripts/migrations/fabriquer_lot.py)\n"
           f"ESSAI={essai.relative_to(root)}\nRETOUR_ESSAI={retour_essai.relative_to(root)}\n"
           f"APPLICATION={application.relative_to(root)}\nRETOUR={retour.relative_to(root)}\n")


if __name__ == '__main__':
    main()
