#!/usr/bin/env python3
"""Fabrique le script d'essai du chantier 2 en transaction annulée.

Lancer `python3 scripts/securite/essai.py` réécrit
supabase/tests/essai_chantier2_transaction_annulee.sql : les migrations 0080 à 0087 à la suite,
puis les tests de droits. Le script se termine toujours par une erreur volontaire (fin des tests) :
toute l'exécution est annulée, rien n'est enregistré. Ne pas modifier le fichier produit à la main.
"""
import re
from pathlib import Path

root = Path(__file__).resolve().parents[2]
mig = sorted((root / 'supabase' / 'migrations').glob('008[0-7]_*.sql'))
tests = root / 'supabase' / 'tests' / 'droits_chantier2.sql'

parts = ["""-- FICHIER GÉNÉRÉ par scripts/securite/essai.py : ne pas modifier à la main.
-- Essai du chantier 2 en transaction annulée : migrations 0080 à 0087, puis tests de droits.
-- Le script se termine TOUJOURS par une erreur volontaire « RÉSULTAT DES TESTS DE DROITS » :
-- tout est annulé, rien n'est enregistré. Il ne contient aucune validation de transaction.

-- Pas de BEGIN : l'éditeur envoie le texte en un seul message, exécuté dans une seule transaction implicite ;
-- l'erreur finale l'annule entièrement et la connexion reste propre.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '180s', true);

-- Photographie du suivi formatif (0250) avant les migrations : le script de tests vérifie qu'il est inchangé
create temp table essai_sf_avant as
  select 'fonction'::text as kind, p.oid::regprocedure::text as name,
         md5(concat_ws('|', pg_get_functiondef(p.oid), p.prosecdef::text, p.proconfig::text,
             (select string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',' order by a.grantee::regrole::text, a.privilege_type)
              from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a))) as v
  from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'sf\\_%' or p.proname = 'save_formative_batch')
  union all
  select 'règle', tablename || '.' || policyname, md5(concat_ws('|', permissive, roles::text, cmd, qual, with_check))
  from pg_policies where schemaname = 'public'
    and tablename in ('course_sequences', 'session_sequences', 'formative_evaluations', 'formative_sheets');
"""]
for f in mig:
    parts.append(f"\n-- ===== {f.name} =====\n")
    parts.append(f.read_text(encoding='utf-8'))
parts.append(f"\n-- ===== {tests.name} =====\n")
parts.append(tests.read_text(encoding='utf-8'))

out = root / 'supabase' / 'tests' / 'essai_chantier2_transaction_annulee.sql'
text = "".join(parts)
assert not re.search(r'^\s*commit\s*;', text, re.I | re.M), 'COMMIT interdit dans le script d\'essai'
out.write_text(text, encoding='utf-8')
print(f"{out.relative_to(root)} : {len(mig)} migrations + tests, {len(text)} caractères")

# Essai du retour arrière : état photographié, migrations, retour arrière, comparaison, annulation.
retour = root / 'supabase' / 'rollback' / '0080-0087_securite_retour.sql'
etat = """
create temp view etat_essai as
  select 'règle' as kind, schemaname || '.' || tablename || '.' || policyname as name,
         md5(concat_ws('|', permissive, roles::text, cmd, qual, with_check)) as v
  from pg_policies where schemaname in ('public', 'storage')
  union all
  select 'fonction', p.oid::regprocedure::text,
         md5(concat_ws('|', pg_get_functiondef(p.oid), p.prosecdef::text, p.proconfig::text,
             (select string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',' order by a.grantee::regrole::text, a.privilege_type) from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a)))
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
  union all
  select 'droits table', c.oid::regclass::text,
         md5(coalesce((select string_agg(a.grantee::regrole::text || ':' || a.privilege_type || ':' || a.is_grantable::text, ','
                               order by a.grantee::regrole::text, a.privilege_type)
                       from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a), '') || c.relrowsecurity::text)
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p')
  union all
  select 'vue', c.oid::regclass::text, md5(pg_get_viewdef(c.oid) || coalesce(c.reloptions::text, ''))
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
  union all
  select 'colonne', table_name || '.' || column_name, md5(data_type || is_nullable || coalesce(column_default, ''))
  from information_schema.columns where table_schema = 'public'
  union all
  select 'contrainte', conrelid::regclass::text || '.' || conname, md5(pg_get_constraintdef(oid))
  from pg_constraint where connamespace = 'public'::regnamespace
  union all
  select 'déclencheur', tgrelid::regclass::text || '.' || tgname, md5(tgfoid::regprocedure::text || tgenabled::text)
  from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)
  union all
  select 'bucket', id, md5(public::text) from storage.buckets
  union all
  select 'schéma', nspname, '' from pg_namespace where nspname = 'app'
  union all
  select 'numéros stagiaires', 'trainees',
         md5(coalesce(string_agg(id::text || coalesce(social_security_number, '') || coalesce(encode(ssn_encrypted, 'hex'), ''), ',' order by id), ''))
  from public.trainees
  union all
  select 'handicap stagiaires', 'trainees',
         md5(coalesce(string_agg(id::text || coalesce(has_disability::text, '') || coalesce(disability_details, '') || coalesce(disability_adaptations, ''), ',' order by id), ''))
  from public.trainees
  union all
  select 'numéros fiches', 'trainee_info_sheets',
         md5(coalesce(string_agg(id::text || coalesce(ssn, ''), ',' order by id), ''))
  from public.trainee_info_sheets;
create temp table etat_essai_avant as select * from etat_essai;
"""
verif = """
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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE (tout est annulé)\\n% écart(s) avec l''état d''avant (%)\\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\\n'), '');
end
$verif$;
"""
p2 = ["""-- FICHIER GÉNÉRÉ par scripts/securite/essai.py : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie de l'état, migrations 0080 à 0087,
-- retour arrière, comparaison avec l'état d'avant. Se termine TOUJOURS par une erreur volontaire
-- « RÉSULTAT DE L'ESSAI DU RETOUR ARRIÈRE » : tout est annulé. Aucune validation de transaction.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '180s', true);
""", etat]
for f in mig:
    p2.append(f"\n-- ===== {f.name} =====\n")
    p2.append(f.read_text(encoding='utf-8'))
p2.append(f"\n-- ===== {retour.name} =====\n")
p2.append(retour.read_text(encoding='utf-8'))
p2.append(verif)
text2 = "".join(p2)
assert not re.search(r'^\s*commit\s*;', text2, re.I | re.M)
out2 = root / 'supabase' / 'tests' / 'essai_retour_chantier2_transaction_annulee.sql'
out2.write_text(text2, encoding='utf-8')
print(f"{out2.relative_to(root)} : {len(text2)} caractères")

# Fichier d'application (lundi) : les migrations seules, en un seul envoi dans l'éditeur SQL.
# Exécuté dans une seule transaction implicite : si une instruction échoue, rien n'est appliqué.
p3 = ["""-- FICHIER GÉNÉRÉ par scripts/securite/essai.py : ne pas modifier à la main.
-- APPLICATION RÉELLE du chantier 2 : migrations 0080 à 0087 en un seul envoi (éditeur SQL de Supabase).
-- Une seule transaction implicite : si une instruction échoue, rien n'est appliqué.
-- À n'exécuter qu'avec l'accord écrit de Hicham, selon la procédure de odet-chantier2-securite.md § 7.
-- Retour arrière : supabase/rollback/0080-0087_securite_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '180s', true);
"""]
for f in mig:
    p3.append(f"\n-- ===== {f.name} =====\n")
    p3.append(f.read_text(encoding='utf-8'))
text3 = "".join(p3)
assert not re.search(r'^\s*commit\s*;', text3, re.I | re.M)
out3 = root / 'supabase' / 'application' / 'chantier2_0080-0087.sql'
out3.parent.mkdir(exist_ok=True)
out3.write_text(text3, encoding='utf-8')
print(f"{out3.relative_to(root)} : {len(text3)} caractères")
