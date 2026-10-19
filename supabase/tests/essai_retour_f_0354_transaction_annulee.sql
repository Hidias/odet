-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (f_0354) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0354_interventions_remplacement.sql, retour arrière,
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

-- ===== supabase/migrations/0354_interventions_remplacement.sql =====
-- 0354_interventions_remplacement.sql : chantier F phase 2, Interventions (spec § 7, erreurs A1 et A2).
--
-- 1. Lignes de visite : motif de remplacement (replace_reason, replace_note), information du client (client_informed)
--    et numéro de série du nouvel appareil (new_serial_number).
-- 2. Appareils : numéro de série (serial_number).
-- 3. Garde à la clôture d'une visite (déclencheur sur itv_visits, quel que soit le chemin de clôture) :
--    - un appareil « remplacé » sans motif bloque la clôture ;
--    - motif « autre » sans précision : bloque ;
--    - remplacement à la place d'une opération périodique (maintenance additionnelle, révision, requalification) :
--      le client doit avoir été informé (case cochée), sinon la clôture est refusée.
--    Les lignes peuvent être enregistrées une à une pendant la visite (le technicien touche « Remplacé », puis choisit
--    le motif) : seule la clôture contrôle.
-- 4. Après la clôture : le numéro de série saisi pour un appareil remplacé devient celui de l'appareil.
-- Aucune nouvelle table : pas de nouvelle règle d'accès (colonnes couvertes par les droits existants des tables).
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0354_interventions_remplacement_retour.sql

alter table public.itv_visit_items add column if not exists replace_reason text;
alter table public.itv_visit_items add column if not exists replace_note text;
alter table public.itv_visit_items add column if not exists client_informed boolean not null default false;
alter table public.itv_visit_items add column if not exists new_serial_number text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'itv_visit_items_replace_reason_check') then
    alter table public.itv_visit_items add constraint itv_visit_items_replace_reason_check
      check (replace_reason is null or replace_reason in ('fin_de_vie', 'hors_service', 'non_reparable', 'demande_client', 'cout', 'obsolete', 'autre'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'itv_visit_items_new_serial_number_check') then
    alter table public.itv_visit_items add constraint itv_visit_items_new_serial_number_check
      check (new_serial_number is null or length(new_serial_number) <= 60);
  end if;
end $$;
comment on column public.itv_visit_items.replace_reason is 'Motif du remplacement (obligatoire à la clôture si l''appareil est remplacé)';
comment on column public.itv_visit_items.client_informed is 'Client informé et d''accord (obligatoire si le remplacement prend la place d''une opération périodique)';

alter table public.itv_equipment add column if not exists serial_number text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'itv_equipment_serial_number_check') then
    alter table public.itv_equipment add constraint itv_equipment_serial_number_check
      check (serial_number is null or length(serial_number) <= 60);
  end if;
end $$;

create or replace function app.itv_visite_cloture_garde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if new.status = 'terminee' and old.status is distinct from 'terminee' then
    select count(*) into v_n from public.itv_visit_items
     where visit_id = new.id and result = 'remplace' and replace_reason is null;
    if v_n > 0 then
      raise exception 'Clôture refusée : % appareil(s) remplacé(s) sans motif de remplacement', v_n using errcode = '23514';
    end if;
    select count(*) into v_n from public.itv_visit_items
     where visit_id = new.id and result = 'remplace' and replace_reason = 'autre' and coalesce(btrim(replace_note), '') = '';
    if v_n > 0 then
      raise exception 'Clôture refusée : % remplacement(s) « autre motif » sans précision', v_n using errcode = '23514';
    end if;
    select count(*) into v_n from public.itv_visit_items
     where visit_id = new.id and result = 'remplace' and operation in ('maa', 'revision', 'requalification', 'epreuve')
       and not client_informed;
    if v_n > 0 then
      raise exception 'Clôture refusée : % remplacement(s) à la place d''une opération périodique sans information du client', v_n using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;
revoke all on function app.itv_visite_cloture_garde() from public, anon, authenticated;
drop trigger if exists itv_visite_cloture_garde on public.itv_visits;
create trigger itv_visite_cloture_garde before update of status on public.itv_visits
  for each row execute function app.itv_visite_cloture_garde();

create or replace function app.itv_visite_cloture_series()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'terminee' and old.status is distinct from 'terminee' then
    update public.itv_equipment e set serial_number = i.new_serial_number, updated_at = now()
      from public.itv_visit_items i
     where i.visit_id = new.id and i.equipment_id = e.id and i.result = 'remplace'
       and coalesce(btrim(i.new_serial_number), '') <> '';
  end if;
  return null;
end
$$;
revoke all on function app.itv_visite_cloture_series() from public, anon, authenticated;
drop trigger if exists itv_visite_cloture_series on public.itv_visits;
create trigger itv_visite_cloture_series after update of status on public.itv_visits
  for each row execute function app.itv_visite_cloture_series();

insert into public.schema_migrations (version) values ('0354_interventions_remplacement') on conflict (version) do nothing;

-- ===== supabase/rollback/0354_interventions_remplacement_retour.sql =====
-- Retour arrière de 0354_interventions_remplacement.sql : retire la garde de clôture, la reprise des numéros de série
-- et les colonnes ajoutées. Idempotent. Les motifs et numéros de série saisis sont perdus (ce sont des ajouts).

drop trigger if exists itv_visite_cloture_series on public.itv_visits;
drop function if exists app.itv_visite_cloture_series();
drop trigger if exists itv_visite_cloture_garde on public.itv_visits;
drop function if exists app.itv_visite_cloture_garde();

alter table public.itv_equipment drop constraint if exists itv_equipment_serial_number_check;
alter table public.itv_equipment drop column if exists serial_number;
alter table public.itv_visit_items drop constraint if exists itv_visit_items_new_serial_number_check;
alter table public.itv_visit_items drop constraint if exists itv_visit_items_replace_reason_check;
alter table public.itv_visit_items drop column if exists new_serial_number;
alter table public.itv_visit_items drop column if exists client_informed;
alter table public.itv_visit_items drop column if exists replace_note;
alter table public.itv_visit_items drop column if exists replace_reason;

delete from public.schema_migrations where version = '0354_interventions_remplacement';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE f_0354 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
