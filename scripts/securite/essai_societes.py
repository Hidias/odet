#!/usr/bin/env python3
"""Fabrique les scripts d'essai et d'application du socle multi-sociétés (chantier C1a, migrations 0270 à 0273).

Lancer `python3 scripts/securite/essai_societes.py` réécrit :
  supabase/tests/essai_c1a_transaction_annulee.sql
      0270 à 0273, réglage de l'instance odet-gld, puis tous les tests de droits (chantier 2 et C1a) ;
  supabase/tests/essai_retour_c1a_transaction_annulee.sql
      photographie de l'état, 0270 à 0273, réglage de l'instance, retour arrière, comparaison ;
  supabase/application/c1a_0270-0273_odet-gld.sql
      application réelle (un seul envoi, une seule transaction implicite).
Les deux essais se terminent TOUJOURS par une erreur volontaire : tout est annulé.
Base de départ : la production avec le chantier 2 (0080 à 0087) et la 0070 appliqués.
Ne pas modifier les fichiers produits à la main.
"""
import re
from pathlib import Path

root = Path(__file__).resolve().parents[2]
mig = sorted((root / 'supabase' / 'migrations').glob('027[0-3]_*.sql'))
assert [m.name[:4] for m in mig] == ['0270', '0271', '0272', '0273'], mig
instance = root / 'supabase' / 'instances' / 'odet-gld' / 'c1a_acces_support_permanent.sql'
tests = root / 'supabase' / 'tests' / 'droits_chantier2.sql'
retour = root / 'supabase' / 'rollback' / '0270-0273_societes_retour.sql'

ENTETE = "select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '180s', true);\n"


def bloc(f):
    return f"\n-- ===== {f.relative_to(root)} =====\n" + f.read_text(encoding='utf-8')


def ecrire(path, text):
    assert not re.search(r'^\s*commit\s*;', text, re.I | re.M), f'COMMIT interdit : {path}'
    assert not re.search(r'^\s*begin\s*;', text, re.I | re.M), f'BEGIN interdit : {path}'
    path.parent.mkdir(exist_ok=True)
    path.write_text(text, encoding='utf-8')
    print(f"{path.relative_to(root)} : {len(text)} caractères")


# 1. Essai : migrations puis tests de droits
p1 = ["""-- FICHIER GÉNÉRÉ par scripts/securite/essai_societes.py : ne pas modifier à la main.
-- Essai du socle multi-sociétés (C1a) en transaction annulée : 0270 à 0273, réglage de l'instance odet-gld,
-- puis tous les tests de droits. Se termine TOUJOURS par l'erreur volontaire « RÉSULTAT DES TESTS DE DROITS » :
-- tout est annulé, rien n'est enregistré. Aucune validation de transaction.
""", ENTETE]
p1 += [bloc(f) for f in mig] + [bloc(instance), bloc(tests)]
ecrire(root / 'supabase' / 'tests' / 'essai_c1a_transaction_annulee.sql', "".join(p1))

# 2. Essai du retour arrière : état avant, migrations, retour arrière, comparaison
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
  select 'données', 'org_modules', md5(coalesce(string_agg(t::text, ',' order by t.key), '')) from public.org_modules t;
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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE C1a (tout est annulé)\\n% écart(s) avec l''état d''avant (%)\\n%\\nsociétés pendant l''essai : %',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\\n'), ''),
    current_setting('essai.societes', true);
end
$verif$;
"""
PENDANT = """
-- Contrôle pendant l'essai (avant le retour arrière) : sociétés, appartenances, modules
select set_config('essai.societes',
  (select count(*) from public.companies)::text || ' société(s), '
  || (select count(*) from public.company_members)::text || ' appartenance(s), '
  || (select count(*) from public.company_modules)::text || ' module(s), mode '
  || coalesce((select support_access_mode from public.companies where is_instance_owner), 'aucun'), true);
"""
p2 = ["""-- FICHIER GÉNÉRÉ par scripts/securite/essai_societes.py : ne pas modifier à la main.
-- Essai du retour arrière du socle multi-sociétés (C1a) en transaction annulée : photographie de l'état
-- (structure des schémas public et app, registre des migrations, réglages, profils, modules), 0270 à 0273,
-- réglage de l'instance, retour arrière, comparaison. Se termine TOUJOURS par l'erreur volontaire
-- « RÉSULTAT DE L'ESSAI DU RETOUR ARRIÈRE C1a » : tout est annulé. Aucune validation de transaction.
""", ENTETE, ETAT]
p2 += [bloc(f) for f in mig] + [bloc(instance), PENDANT, bloc(retour), VERIF]
ecrire(root / 'supabase' / 'tests' / 'essai_retour_c1a_transaction_annulee.sql', "".join(p2))

# 3. Application réelle sur odet-gld
p3 = ["""-- FICHIER GÉNÉRÉ par scripts/securite/essai_societes.py : ne pas modifier à la main.
-- APPLICATION RÉELLE du socle multi-sociétés (C1a) sur l'instance odet-gld : 0270 à 0273 puis le réglage
-- de l'instance (accès de support permanent). Un seul envoi, une seule transaction implicite : si une
-- instruction échoue, rien n'est appliqué. Chaque migration s'enregistre dans public.schema_migrations.
-- Retour arrière : supabase/rollback/0270-0273_societes_retour.sql
""", ENTETE]
p3 += [bloc(f) for f in mig] + [bloc(instance)]
ecrire(root / 'supabase' / 'application' / 'c1a_0270-0273_odet-gld.sql', "".join(p3))
