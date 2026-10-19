#!/usr/bin/env python3
"""Base PostgreSQL locale qui rejoue toutes les migrations du dépôt dans l'ordre de la production.

Sert aux essais d'un chantier AVANT la production : on reconstruit une base avec Supabase simulé
(rôles anon, authenticated, service_role ; schémas auth, storage, cron, net, vault ; pgcrypto),
on rejoue les migrations dans l'ordre où elles ont été appliquées sur odet-gld, on ajoute quelques
données et des comptes comme en production, puis on lance les fichiers d'essai.

Rien ici ne touche la production : la base est locale (PostgreSQL 16 lancé à part).

Utilisation :
  python3 scripts/securite/base_locale.py --hote /chemin/socket --port 54329 --base odet_essai
      [--jusqu-a 0273] [--fichier essai.sql ...]

Ordre de la production (constaté le 18/10/2026, odet-c1a-socle.md) :
  0001 à 0051 (0040 comprise), 0111, 0190, 0250, 0260, 0080 à 0087, 0070, 0270 à 0273,
  puis les migrations du chantier en cours (0370 et suivantes).
0110 (Budget générique) n'est pas appliquée en production : elle n'est pas rejouée.
"""
import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIG = ROOT / 'supabase' / 'migrations'

SIMULATION = r"""
-- ===== Supabase simulé (base locale d'essai seulement) =====
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then create role supabase_admin nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then create role supabase_storage_admin nologin; end if;
end $$;
grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to postgres;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
create table if not exists auth.users (
  id uuid primary key, instance_id uuid, email text, aud text, role text,
  raw_user_meta_data jsonb default '{}'::jsonb, raw_app_meta_data jsonb default '{}'::jsonb,
  encrypted_password text, email_confirmed_at timestamptz, confirmed_at timestamptz, last_sign_in_at timestamptz,
  phone text, banned_until timestamptz, deleted_at timestamptz, is_sso_user boolean default false,
  is_anonymous boolean default false, created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid,
  created_at timestamptz default now(), updated_at timestamptz);
create or replace function auth.uid() returns uuid language sql stable as $f$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$f$;
create or replace function auth.role() returns text language sql stable as $f$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text
$f$;
create or replace function auth.email() returns text language sql stable as $f$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')::text
$f$;
create or replace function auth.jwt() returns jsonb language sql stable as $f$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                  nullif(current_setting('request.jwt.claims', true), ''))::jsonb
$f$;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant select on auth.users to service_role;

create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;
create table if not exists storage.buckets (
  id text primary key, name text not null, owner uuid, owner_id text, public boolean default false,
  avif_autodetection boolean default false, file_size_limit bigint, allowed_mime_types text[],
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text,
  owner uuid, owner_id text, metadata jsonb, user_metadata jsonb, version text,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz default now()
);
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;
create or replace function storage.foldername(name text) returns text[] language plpgsql immutable as $f$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end $f$;
create or replace function storage.filename(name text) returns text language plpgsql immutable as $f$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[array_length(_parts, 1)];
end $f$;
create or replace function storage.extension(name text) returns text language plpgsql immutable as $f$
declare _parts text[]; _filename text;
begin
  select string_to_array(name, '/') into _parts;
  select _parts[array_length(_parts, 1)] into _filename;
  return reverse(split_part(reverse(_filename), '.', 1));
end $f$;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;
grant execute on all functions in schema storage to anon, authenticated, service_role;

create schema if not exists cron;
create table if not exists cron.job (jobid bigserial primary key, schedule text, command text, nodename text default 'localhost',
  nodeport int default 5432, database text default current_database(), username text default current_user,
  active boolean default true, jobname text);
create or replace function cron.schedule(p_jobname text, p_schedule text, p_command text) returns bigint language plpgsql as $f$
declare v bigint;
begin
  delete from cron.job where jobname = p_jobname;
  insert into cron.job (schedule, command, jobname) values (p_schedule, p_command, p_jobname) returning jobid into v;
  return v;
end $f$;
create or replace function cron.unschedule(p_jobname text) returns boolean language plpgsql as $f$
begin delete from cron.job where jobname = p_jobname; return found; end $f$;
create or replace function cron.unschedule(p_jobid bigint) returns boolean language plpgsql as $f$
begin delete from cron.job where jobid = p_jobid; return found; end $f$;

create schema if not exists net;
create or replace function net.http_get(url text, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb,
  timeout_milliseconds integer default 5000) returns bigint language sql as $f$ select 0::bigint $f$;
create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000) returns bigint language sql as $f$ select 0::bigint $f$;

create schema if not exists vault;
create table if not exists vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text);
create or replace view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
create or replace function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
returns uuid language sql as $f$ insert into vault.secrets (name, secret) values (new_name, new_secret) returning id $f$;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
"""

# Ordre d'application constaté en production
ORDRE_PROD = (
    [f'{n:04d}' for n in range(1, 41)] + ['0050', '0051']
    + ['0111', '0190', '0250', '0260']
    + [f'{n:04d}' for n in range(80, 88)]
    + ['0070', '0270', '0271', '0272', '0273']
    # 18 et 19/10/2026 : droits composés (C1b), maintenance de nuit, puis Facturation fiable, dans l'ordre réel
    + [f'{n:04d}' for n in range(370, 380)]
    + ['0360', '0361', '0362', '0369', '0363', '0364', '0365', '0366', '0367', '0368']
    # 19/10/2026 : sociétés (C2 puis C3), puis mise en service (chantier A, 0261 à 0264, appliqués après 0277)
    + ['0274', '0275', '0276', '0277', '0261', '0262', '0263', '0264']
    # Lot 2 (0041 et suivantes), appliqués après le chantier A
    + ['0041', '0042', '0043', '0044', '0045', '0046', '0047']
    # Fonctions 10 à 13 (0130 et suivantes), appliquées après le lot 2
    + ['0130', '0140', '0150', '0160']
    # Chantier 10, suivi des affaires (19/10)
    + ['0380']
    # Chantier F : RGPD, journal d'audit, purges, IP des signatures, certifications (19/10)
    + ['0340', '0345', '0344', '0346', '0350', '0354']
    # Performance : droits calculés une fois par requête (19/10)
    + ['0090']
    # Chantier 12, RH socle et absences (19/10)
    + ['0290', '0294', '0297']
    # Fiche formation complète et versions des programmes (19/10)
    + ['0048', '0049']
    # Badge « Test » sur les fiches de démonstration (19/10)
    + ['0052']
    # Nom affiché calculé (prénom et nom), 19/10
    + ['0053']
    # Établissement principal, source unique de l'adresse mise en avant (19/10)
    + ['0054']
    # Chantier 12, RH documents et santé au travail administrative (19/10)
    + ['0301']
    # RH : suppression d'une fiche du personnel (gardes en cascade), 19/10
    + ['0302']
    # RH : suppression des fichiers du bucket rh, 19/10
    + ['0303']
    # RH : jours fériés par société, 19/10
    + ['0311']
    # RH : validation par le responsable d'équipe, 19/10
    + ['0312']
    # RH : registre unique du personnel, 19/10
    + ['0313']
    # RH : entretiens, listes d'arrivée et de départ, 19/10
    + ['0314']
    # Purge de démonstration étendue au RH, 19/10
    + ['0315']
    # Module Stock, socle, 19/10
    + ['0240']
    # Stock, commandes, 19/10
    + ['0245']
)


def migrations(jusqu_a=None):
    fichiers = {f.name[:4]: f for f in MIG.glob('[0-9][0-9][0-9][0-9]_*.sql')}
    ordre = [n for n in ORDRE_PROD if n in fichiers]
    # Migrations pas encore dans l'ordre de production (chantier en cours, dont C2 0274 et suivantes), dans l'ordre des numéros
    ordre += sorted(n for n in fichiers if n > '0273' and n not in ordre)
    # 0110 (finance générique) n'est pas appliquée en production (constat du 19/10) : jamais rejouée ici
    out = []
    for n in ordre:
        out.append(fichiers[n])
        if jusqu_a and n == jusqu_a:
            break
    return out


def adapter(sql):
    # Extensions propres à Supabase : simulées par le préambule
    sql = re.sub(r'(?im)^\s*create extension if not exists "?(pg_cron|pg_net)"?\s*;', '-- (extension simulée)', sql)
    return sql


def psql(args, sql, label, arret=True):
    p = subprocess.run(['psql', '-X', '-q', '-1', '-v', 'ON_ERROR_STOP=1', '-h', args.hote, '-p', str(args.port),
                        '-U', 'postgres', '-d', args.base],
                       input=sql, text=True, capture_output=True)
    if p.returncode != 0 and arret:
        sys.stderr.write(f'ÉCHEC : {label}\n{p.stderr[-4000:]}\n')
        sys.exit(1)
    return p.stdout + p.stderr


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--hote', required=True)
    ap.add_argument('--port', type=int, default=5432)
    ap.add_argument('--base', default='odet_essai')
    ap.add_argument('--jusqu-a', dest='jusqu_a', default=None)
    ap.add_argument('--donnees', default=str(Path(__file__).with_name('base_locale_donnees.sql')))
    ap.add_argument('--fichier', action='append', default=[])
    args = ap.parse_args()

    subprocess.run(['dropdb', '-h', args.hote, '-p', str(args.port), '-U', 'postgres', '--if-exists', args.base], check=True)
    subprocess.run(['createdb', '-h', args.hote, '-p', str(args.port), '-U', 'postgres', args.base], check=True)
    psql(args, f"alter database {args.base} set search_path = \"$user\", public, extensions;", 'search_path')
    psql(args, SIMULATION, 'simulation Supabase')
    donnees_faites = False
    for f in migrations(args.jusqu_a):
        psql(args, adapter(f.read_text(encoding='utf-8')), f.name)
        print(f'migration {f.name}')
        # Données et comptes comme en production, posés avant le socle multi-sociétés (comme en production)
        if f.name.startswith('0070') and not donnees_faites and Path(args.donnees).exists():
            psql(args, Path(args.donnees).read_text(encoding='utf-8'), 'données')
            donnees_faites = True
            print('données posées')
    if not donnees_faites and Path(args.donnees).exists():
        psql(args, Path(args.donnees).read_text(encoding='utf-8'), 'données')
    for extra in args.fichier:
        # Les essais se terminent par une erreur volontaire (résultat dans le message) : on l'affiche
        print(psql(args, Path(extra).read_text(encoding='utf-8'), extra, arret=False))


if __name__ == '__main__':
    main()
