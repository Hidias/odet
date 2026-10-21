#!/usr/bin/env python3
"""Fabrique les scripts d'essai et d'application des droits composés (chantier C1b, migrations 0370 à 0375).

Lancer `python3 scripts/securite/essai_droits.py` (après `python3 scripts/securite/regles.py`) réécrit :
  supabase/tests/essai_c1b_transaction_annulee.sql
      photographie des lectures (11 comptes d'essai, un par rôle, toutes les tables de la matrice), 0370 à 0375,
      nouvelle photographie, puis tous les tests de droits (chantier 2, C1a, C1b) : la comparaison des deux
      photographies est un des tests (« mêmes lignes lues avant et après ») ;
  supabase/tests/essai_retour_c1b_transaction_annulee.sql
      photographie de l'état, 0370 à 0375, retour arrière, comparaison ;
  supabase/application/c1b_0370-0375.sql
      application réelle (un seul envoi, une seule transaction implicite).
Les deux essais se terminent TOUJOURS par une erreur volontaire : tout est annulé.
Base de départ : la production avec C1a (0270 à 0273) appliqué.
Ne pas modifier les fichiers produits à la main.
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import regles  # noqa: E402

root = Path(__file__).resolve().parents[2]
mig = sorted((root / 'supabase' / 'migrations').glob('037[0-5]_*.sql'))
assert [m.name[:4] for m in mig] == ['0370', '0371', '0372', '0373', '0374', '0375'], mig
tests = root / 'supabase' / 'tests' / 'droits_chantier2.sql'
retour = root / 'supabase' / 'rollback' / '0370-0375_droits_retour.sql'

ENTETE = "select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);\n"


def bloc(f):
    return f"\n-- ===== {f.relative_to(root)} =====\n" + f.read_text(encoding='utf-8')


def ecrire(path, text):
    assert not re.search(r'^\s*commit\s*;', text, re.I | re.M), f'COMMIT interdit : {path}'
    assert not re.search(r'^\s*begin\s*;', text, re.I | re.M), f'BEGIN interdit : {path}'
    path.parent.mkdir(exist_ok=True)
    path.write_text(text, encoding='utf-8')
    print(f"{path.relative_to(root)} : {len(text)} caractères")


TABLES = regles.tables()
ARR = "array[" + ", ".join(f"'{t}'" for t in TABLES) + "]"

# Photographie des lectures : un compte d'essai par rôle, nombre de lignes lues dans chaque table de la matrice
LECTURES_AVANT = """
-- ===== Photographie des lectures avant C1b (comptes d'essai créés dans la transaction annulée) =====
create temp table essai_lectures_comptes (who text primary key, uid uuid);
create temp table essai_lectures_avant (who text, tbl text, n bigint);
create temp table essai_lectures_apres (who text, tbl text, n bigint);

do $cmp$
declare
  v_trainer uuid; v_client uuid; v_site uuid; v_tech uuid;
begin
  insert into essai_lectures_comptes (who, uid)
  select x.who, gen_random_uuid() from unnest(array['sa', 'ad', 'dir', 'ges', 'for', 'com', 'cpt', 'lec', 'tech', 'off', 'ent']) x(who);
  insert into auth.users (id, email, aud, role)
  select uid, 'cmp.' || who || '@test.invalid', 'authenticated', 'authenticated' from essai_lectures_comptes;
  insert into public.trainers (first_name, last_name) values ('Comparaison', 'FORMATEUR') returning id into v_trainer;
  alter table public.profiles disable trigger profiles_protect_role;
  insert into public.profiles (id, email, role, is_active, trainer_id)
  select c.uid, 'cmp.' || c.who || '@test.invalid',
         case c.who when 'sa' then 'superadmin' when 'ad' then 'admin' when 'dir' then 'direction' when 'ges' then 'gestionnaire'
                    when 'for' then 'formateur' when 'com' then 'commercial' when 'cpt' then 'comptable' when 'off' then 'direction'
                    when 'ent' then 'entreprise' else 'lecture' end,
         c.who <> 'off', case when c.who = 'for' then v_trainer end
  from essai_lectures_comptes c
  on conflict (id) do update set role = excluded.role, is_active = excluded.is_active, trainer_id = excluded.trainer_id;
  alter table public.profiles enable trigger profiles_protect_role;
  select uid into v_tech from essai_lectures_comptes where who = 'tech';
  insert into public.itv_technicians (profile_id, is_active) values (v_tech, true)
  on conflict (profile_id) do update set is_active = true;
  insert into public.clients (name) values ('Comparaison client') returning id into v_client;
  insert into public.sites (name, client_id) values ('Comparaison site', v_client) returning id into v_site;
  insert into public.sessions (start_date, end_date, trainer_id, client_id, attendance_token)
  values (current_date, current_date, v_trainer, v_client, 'cmp-' || replace(gen_random_uuid()::text, '-', ''));
  insert into public.itv_visits (client_id, site_id, technician_id, status) values (v_client, v_site, v_tech, 'planifiee');
end
$cmp$;

create function pg_temp.essai_compter(p_apres boolean)
returns void
language plpgsql
as $f$
declare
  c record; t text; v bigint;
begin
  for c in select * from essai_lectures_comptes order by who loop
    foreach t in array @@TABLES@@ loop
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', c.uid, 'role', 'authenticated',
                                                                   'email', 'cmp.' || c.who || '@test.invalid')::text, true);
        perform set_config('request.jwt.claim.sub', c.uid::text, true);
        execute 'set local role authenticated';
        execute format('select count(*) from public.%I', t) into v;
        execute 'reset role';
      exception when others then
        v := -1;
      end;
      if p_apres then
        insert into essai_lectures_apres values (c.who, t, v);
      else
        insert into essai_lectures_avant values (c.who, t, v);
      end if;
    end loop;
  end loop;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end
$f$;

select pg_temp.essai_compter(false);
""".replace('@@TABLES@@', ARR)

LECTURES_APRES = """
-- ===== Photographie des lectures après C1b (comparée par droits_chantier2.sql) =====
select pg_temp.essai_compter(true);
"""

# 1. Essai : photographie, migrations, photographie, tests de droits
p1 = ["""-- FICHIER GÉNÉRÉ par scripts/securite/essai_droits.py : ne pas modifier à la main.
-- Essai des droits composés (C1b) en transaction annulée : photographie des lectures par rôle, 0370 à 0375,
-- nouvelle photographie, puis tous les tests de droits. Se termine TOUJOURS par l'erreur volontaire
-- « RÉSULTAT DES TESTS DE DROITS » : tout est annulé, rien n'est enregistré. Aucune validation de transaction.
""", ENTETE, LECTURES_AVANT]
p1 += [bloc(f) for f in mig] + [LECTURES_APRES, bloc(tests)]
ecrire(root / 'supabase' / 'tests' / 'essai_c1b_transaction_annulee.sql', "".join(p1))

# 2. Essai du retour arrière
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
PENDANT = """
-- Contrôle pendant l'essai (avant le retour arrière) : catalogue, profils, règles par droits
select set_config('essai.droits',
  (select count(*) from public.permissions)::text || ' droit(s), '
  || (select count(*) from public.permission_profiles)::text || ' profil(s), '
  || (select count(*) from public.permission_profile_rights)::text || ' droit(s) de profils, '
  || (select count(*) from pg_policies where schemaname = 'public'
        and (coalesce(qual, '') || coalesce(with_check, '')) like '%a_le_droit%')::text || ' règle(s) par droits', true);
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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE C1b (tout est annulé)\\n% écart(s) avec l''état d''avant (%)\\n%\\npendant l''essai : %',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\\n'), ''),
    current_setting('essai.droits', true);
end
$verif$;
"""
p2 = ["""-- FICHIER GÉNÉRÉ par scripts/securite/essai_droits.py : ne pas modifier à la main.
-- Essai du retour arrière des droits composés (C1b) en transaction annulée : photographie de l'état (structure des
-- schémas public et app, registre des migrations, réglages, profils, modules, appartenances), 0370 à 0375, retour
-- arrière, comparaison. Se termine TOUJOURS par l'erreur volontaire « RÉSULTAT DE L'ESSAI DU RETOUR ARRIÈRE C1b » :
-- tout est annulé. Aucune validation de transaction.
""", ENTETE, ETAT]
p2 += [bloc(f) for f in mig] + [PENDANT, bloc(retour), VERIF]
ecrire(root / 'supabase' / 'tests' / 'essai_retour_c1b_transaction_annulee.sql', "".join(p2))

# 3. Application réelle sur l'instance
p3 = ["""-- FICHIER GÉNÉRÉ par scripts/securite/essai_droits.py : ne pas modifier à la main.
-- APPLICATION RÉELLE des droits composés (C1b) sur l'instance : 0370 à 0375. Un seul envoi, une seule
-- transaction implicite : si une instruction échoue, rien n'est appliqué. Chaque migration s'enregistre dans
-- public.schema_migrations. Retour arrière : supabase/rollback/0370-0375_droits_retour.sql
""", ENTETE]
p3 += [bloc(f) for f in mig]
ecrire(root / 'supabase' / 'application' / 'c1b_0370-0375.sql', "".join(p3))
