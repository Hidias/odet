-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (vehicules_papiers_0447) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0447_vehicules_papiers.sql, retour arrière,
-- comparaison. Se termine TOUJOURS par l'erreur volontaire « RÉSULTAT DE L'ESSAI DU RETOUR ARRIÈRE » : tout est annulé.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

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

-- ===== supabase/migrations/0447_vehicules_papiers.sql =====
-- 0447 : papiers des véhicules et suivi des sinistres (pilotage de H du 24/10).
--   1. vehicles : rubriques de la carte grise reprises par le certificat de cession (Cerfa 15776 : D.2 type, J.1 genre
--      national, D.3 dénomination commerciale, numéro de formule) et par le constat amiable (carte verte, agence ou
--      courtier, dégâts du véhicule couverts). Saisies une fois sur la fiche, jamais retapées dans un formulaire.
--   2. vehicle_papers : carte grise, attestation d'assurance (avec ses dates), constat rempli, photos d'un sinistre,
--      certificat de cession signé ; et, sans véhicule, le constat amiable vierge de la société (fourni par son
--      assureur, déposé une fois : l'outil prérempli la partie « Véhicule A » dessus). Lus par qui voit le parc et par le
--      conducteur pour son véhicule ; le conducteur dépose le constat et les photos de son sinistre.
--   3. vehicle_events (sinistre) : suivi de la déclaration à l'assureur (5 jours ouvrés, article L113-2 du code des
--      assurances : date limite posée par la base, sans compter les jours fériés, donc jamais trop tard), état du
--      dossier, référence, tiers, responsabilité, franchise et indemnité ; le responsable du parc est prévenu.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0447_vehicules_papiers_retour.sql

-- ── 1. Carte grise et assurance ──
alter table public.vehicles add column if not exists type_variant text;
alter table public.vehicles add column if not exists national_genre text;
alter table public.vehicles add column if not exists commercial_name text;
alter table public.vehicles add column if not exists registration_formula text;
alter table public.vehicles add column if not exists green_card_number text;
alter table public.vehicles add column if not exists insurer_agency text;
alter table public.vehicles add column if not exists insurer_agency_address text;
alter table public.vehicles add column if not exists insurer_agency_contact text;
alter table public.vehicles add column if not exists own_damage_covered boolean;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vehicles_papiers_longueurs') then
    alter table public.vehicles add constraint vehicles_papiers_longueurs check (
      coalesce(length(type_variant), 0) <= 100 and coalesce(length(national_genre), 0) <= 20 and coalesce(length(commercial_name), 0) <= 100
      and coalesce(length(registration_formula), 0) <= 20 and coalesce(length(green_card_number), 0) <= 50
      and coalesce(length(insurer_agency), 0) <= 200 and coalesce(length(insurer_agency_address), 0) <= 300
      and coalesce(length(insurer_agency_contact), 0) <= 200);
  end if;
end
$$;
comment on column public.vehicles.type_variant is 'Carte grise D.2 : type, variante, version';
comment on column public.vehicles.national_genre is 'Carte grise J.1 : genre national (VP, CTTE…)';
comment on column public.vehicles.commercial_name is 'Carte grise D.3 : dénomination commerciale';
comment on column public.vehicles.registration_formula is 'Numéro de formule du certificat d''immatriculation (certificat de cession)';

-- ── 2. Papiers ──
create table if not exists public.vehicle_papers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  vehicle_id uuid references public.vehicles(id) on delete cascade,
  event_id uuid references public.vehicle_events(id) on delete cascade,
  kind text not null check (kind in ('carte_grise', 'attestation_assurance', 'constat_vierge', 'constat', 'photo_sinistre', 'cession', 'autre')),
  label text check (label is null or length(label) <= 200),
  valid_from date,
  valid_until date,
  file_path text not null check (length(file_path) between 1 and 500),
  file_name text check (file_name is null or length(file_name) <= 200),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_papers_dates check (valid_until is null or valid_from is null or valid_until >= valid_from),
  constraint vehicle_papers_vehicule check ((kind = 'constat_vierge') = (vehicle_id is null))
);
create index if not exists vehicle_papers_company_idx on public.vehicle_papers (company_id, kind);
create index if not exists vehicle_papers_vehicle_idx on public.vehicle_papers (vehicle_id) where vehicle_id is not null;
create index if not exists vehicle_papers_event_idx on public.vehicle_papers (event_id) where event_id is not null;
create index if not exists vehicle_papers_path_idx on public.vehicle_papers (file_path);
comment on table public.vehicle_papers is 'Papiers des véhicules (stockage privé « vehicules ») ; sans véhicule : constat amiable vierge de la société';

drop trigger if exists vehicle_papers_maj on public.vehicle_papers;
create trigger vehicle_papers_maj before insert or update on public.vehicle_papers for each row execute function app.hr_h_maj();

-- Société prise du véhicule ; sinistre du même véhicule ; fichier rangé dans le dossier de la société
create or replace function app.vehicule_papier_garde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_co uuid;
begin
  if new.vehicle_id is not null then
    select v.company_id into v_co from public.vehicles v where v.id = new.vehicle_id;
    if v_co is null then raise exception 'Véhicule introuvable' using errcode = 'P0002'; end if;
    new.company_id := v_co;
  end if;
  if new.event_id is not null and not exists (select 1 from public.vehicle_events e where e.id = new.event_id and e.vehicle_id = new.vehicle_id) then
    raise exception 'Incident d''un autre véhicule' using errcode = '23514';
  end if;
  if split_part(new.file_path, '/', 1) <> new.company_id::text then
    raise exception 'Fichier hors du dossier de la société' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then new.created_by := (select auth.uid()); end if;
  return new;
end
$$;
revoke all on function app.vehicule_papier_garde() from public, anon, authenticated;
drop trigger if exists vehicle_papers_garde on public.vehicle_papers;
create trigger vehicle_papers_garde before insert or update on public.vehicle_papers for each row execute function app.vehicule_papier_garde();

drop trigger if exists zz_audit_row on public.vehicle_papers;
create trigger zz_audit_row after insert or update or delete on public.vehicle_papers for each row execute function app.audit_row('vehicules');

alter table public.vehicle_papers enable row level security;
revoke all on table public.vehicle_papers from public, anon;
grant select, insert, update, delete on table public.vehicle_papers to authenticated;
grant all on table public.vehicle_papers to service_role;

-- Pose des règles d'une liste de tables (même générateur que 0320)
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

do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and tablename = any (array['vehicle_papers'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- vehicle_papers : lus par qui voit le parc, par le conducteur pour son véhicule, et (constat vierge) par qui utilise
-- son véhicule ; tenus par qui gère le parc ; le conducteur dépose le constat et les photos de son sinistre
select pg_temp.regles(array['vehicle_papers'], null,
  $r$(company_id in (select app.societes_avec_droit('vehicules.parc.voir')) or vehicle_id in (select app.vehicules_miens()) or (vehicle_id is null and company_id in (select app.societes_avec_droit('vehicules.siens.utiliser'))))$r$,
  $r$(company_id in (select app.societes_avec_droit('vehicules.parc.gerer')) or (company_id in (select app.societes_avec_droit('vehicules.siens.utiliser')) and vehicle_id in (select app.vehicules_miens()) and kind in ('constat', 'photo_sinistre')))$r$,
  $r$company_id in (select app.societes_avec_droit('vehicules.parc.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('vehicules.parc.gerer'))$r$);

drop policy if exists vehicle_papers_societe_lire on public.vehicle_papers;
drop policy if exists vehicle_papers_societe_creer on public.vehicle_papers;
drop policy if exists vehicle_papers_societe_modifier on public.vehicle_papers;
drop policy if exists vehicle_papers_societe_supprimer on public.vehicle_papers;
create policy vehicle_papers_societe_lire on public.vehicle_papers as restrictive for select to authenticated using (company_id in (select app.societes_lisibles()));
create policy vehicle_papers_societe_creer on public.vehicle_papers as restrictive for insert to authenticated with check (company_id in (select app.societes_ecriture()));
create policy vehicle_papers_societe_modifier on public.vehicle_papers as restrictive for update to authenticated using (company_id in (select app.societes_ecriture())) with check (company_id in (select app.societes_ecriture()));
create policy vehicle_papers_societe_supprimer on public.vehicle_papers as restrictive for delete to authenticated using (company_id in (select app.societes_ecriture()));

-- Fichiers : le conducteur lit les papiers de son véhicule et le constat vierge de sa société
drop policy if exists vehicules_papiers_lire on storage.objects;
create policy vehicules_papiers_lire on storage.objects for select to authenticated
  using (bucket_id = 'vehicules' and exists (
    select 1 from public.vehicle_papers p where p.file_path = objects.name
      and (p.vehicle_id in (select app.vehicules_miens())
           or (p.vehicle_id is null and p.company_id in (select app.societes_avec_droit('vehicules.siens.utiliser'))))));

-- ── 3. Suivi des sinistres ──
alter table public.vehicle_events add column if not exists claim_status text;
alter table public.vehicle_events add column if not exists claim_deadline_on date;
alter table public.vehicle_events add column if not exists claim_declared_on date;
alter table public.vehicle_events add column if not exists claim_ref text;
alter table public.vehicle_events add column if not exists third_party text;
alter table public.vehicle_events add column if not exists at_fault text;
alter table public.vehicle_events add column if not exists injuries boolean;
alter table public.vehicle_events add column if not exists deductible numeric(12,2);
alter table public.vehicle_events add column if not exists indemnity numeric(12,2);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vehicle_events_sinistre_check') then
    alter table public.vehicle_events add constraint vehicle_events_sinistre_check check (
      (claim_status is null or claim_status in ('a_declarer', 'declare', 'expertise', 'reparation', 'indemnise', 'clos'))
      and (at_fault is null or at_fault in ('non', 'partiel', 'oui', 'inconnu'))
      and coalesce(length(claim_ref), 0) <= 100 and coalesce(length(third_party), 0) <= 1000
      and (deductible is null or deductible >= 0) and (indemnity is null or indemnity >= 0));
  end if;
end
$$;
comment on column public.vehicle_events.claim_deadline_on is 'Sinistre : date limite de déclaration à l''assureur (5 jours ouvrés après le sinistre, jours fériés comptés comme ouvrés)';

-- Date limite : n jours ouvrés (lundi à vendredi) après une date
create or replace function app.jours_ouvres_apres(p_date date, p_n int)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  d date := p_date;
  n int := 0;
begin
  while n < p_n loop
    d := d + 1;
    if extract(isodow from d) < 6 then n := n + 1; end if;
  end loop;
  return d;
end
$$;
revoke all on function app.jours_ouvres_apres(date, int) from public, anon;
grant execute on function app.jours_ouvres_apres(date, int) to authenticated;

create or replace function app.vehicule_sinistre_suivi()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plate text;
begin
  if new.kind <> 'sinistre' then
    if tg_op = 'INSERT' then new.claim_status := null; new.claim_deadline_on := null; end if;
    return new;
  end if;
  new.claim_deadline_on := app.jours_ouvres_apres(new.happened_on, 5);
  if new.claim_status is null then new.claim_status := case when new.claim_declared_on is not null then 'declare' else 'a_declarer' end; end if;
  if new.claim_declared_on is not null and new.claim_status = 'a_declarer' then new.claim_status := 'declare'; end if;
  if tg_op = 'INSERT' then
    select v.plate into v_plate from public.vehicles v where v.id = new.vehicle_id;
    insert into public.notifications (company_id, type, title, message, link, metadata)
    values (new.company_id, 'vehicule_sinistre', 'Sinistre déclaré : ' || coalesce(v_plate, ''),
      'À déclarer à l''assureur avant le ' || to_char(new.claim_deadline_on, 'DD/MM/YYYY') || coalesce(' : ' || left(new.description, 200), ''),
      '/vehicules/parc', jsonb_build_object('vehicle_id', new.vehicle_id, 'event_id', new.id));
  end if;
  return new;
end
$$;
revoke all on function app.vehicule_sinistre_suivi() from public, anon, authenticated;
drop trigger if exists vehicle_events_sinistre on public.vehicle_events;
create trigger vehicle_events_sinistre before insert or update of kind, happened_on, claim_status, claim_declared_on on public.vehicle_events
  for each row execute function app.vehicule_sinistre_suivi();

insert into public.schema_migrations (version) values ('0447_vehicules_papiers') on conflict (version) do nothing;

-- ===== supabase/rollback/0447_vehicules_papiers_retour.sql =====
-- Retour arrière de 0447_vehicules_papiers.sql. Idempotent. Refusé s'il existe des papiers déposés (les fichiers
-- resteraient sans fiche) : les retirer d'abord.
do $do$
begin
  if to_regclass('public.vehicle_papers') is not null and exists (select 1 from public.vehicle_papers) then
    raise exception 'Des papiers de véhicules sont déposés : retour arrière refusé';
  end if;
end
$do$;
drop trigger if exists vehicle_events_sinistre on public.vehicle_events;
drop function if exists app.vehicule_sinistre_suivi();
drop function if exists app.jours_ouvres_apres(date, int);
alter table public.vehicle_events drop constraint if exists vehicle_events_sinistre_check;
alter table public.vehicle_events drop column if exists indemnity;
alter table public.vehicle_events drop column if exists deductible;
alter table public.vehicle_events drop column if exists injuries;
alter table public.vehicle_events drop column if exists at_fault;
alter table public.vehicle_events drop column if exists third_party;
alter table public.vehicle_events drop column if exists claim_ref;
alter table public.vehicle_events drop column if exists claim_declared_on;
alter table public.vehicle_events drop column if exists claim_deadline_on;
alter table public.vehicle_events drop column if exists claim_status;
drop policy if exists vehicules_papiers_lire on storage.objects;
drop table if exists public.vehicle_papers;
drop function if exists app.vehicule_papier_garde();
alter table public.vehicles drop constraint if exists vehicles_papiers_longueurs;
alter table public.vehicles drop column if exists own_damage_covered;
alter table public.vehicles drop column if exists insurer_agency_contact;
alter table public.vehicles drop column if exists insurer_agency_address;
alter table public.vehicles drop column if exists insurer_agency;
alter table public.vehicles drop column if exists green_card_number;
alter table public.vehicles drop column if exists registration_formula;
alter table public.vehicles drop column if exists commercial_name;
alter table public.vehicles drop column if exists national_genre;
alter table public.vehicles drop column if exists type_variant;
delete from public.schema_migrations where version = '0447_vehicules_papiers';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE vehicules_papiers_0447 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
