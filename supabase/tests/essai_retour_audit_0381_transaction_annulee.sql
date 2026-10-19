-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (audit_0381) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0381_audit_correctifs.sql, retour arrière,
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

-- ===== supabase/migrations/0381_audit_correctifs.sql =====
-- 0381_audit_correctifs.sql : correctifs de l'audit du 19/10 au soir (angles morts relevés par H).
--
--   1. Visite d'intervention terminée : figée en base, comme le rapport signé remis au client. Après la clôture, seuls
--      le devis, la facture, la date d'envoi du rapport et les notes internes changent ; les contrôles, pièces,
--      observations, signature, technicien et dates ne se modifient plus (sauf super administrateur, pour une
--      réouverture tracée par le journal). Jusqu'ici, seul l'écran empêchait la modification.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0381_audit_correctifs_retour.sql

-- 1. Visite terminée figée
create or replace function app.itv_visite_figee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_statut text;
begin
  -- Écritures du système (tâches, migrations) et super administrateur : permises
  if (select auth.uid()) is null or app.is_superadmin() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_table_name = 'itv_visits' then
    if old.status = 'terminee' and (
         new.status is distinct from old.status or new.client_id is distinct from old.client_id
         or new.site_id is distinct from old.site_id or new.contract_id is distinct from old.contract_id
         or new.technician_id is distinct from old.technician_id or new.started_at is distinct from old.started_at
         or new.finished_at is distinct from old.finished_at or new.signer_name is distinct from old.signer_name
         or new.client_signature is distinct from old.client_signature or new.observations is distinct from old.observations
         or new.site_observations is distinct from old.site_observations or new.photos is distinct from old.photos
         or new.planned_on is distinct from old.planned_on) then
      raise exception 'Visite terminée : le rapport est figé. Une correction passe par le super administrateur.' using errcode = '23514';
    end if;
    return new;
  end if;
  select v.status into v_statut from public.itv_visits v where v.id = case when tg_op = 'DELETE' then old.visit_id else new.visit_id end;
  if v_statut = 'terminee' then
    raise exception 'Visite terminée : ses contrôles et ses pièces ne se modifient plus.' using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;
revoke all on function app.itv_visite_figee() from public, anon, authenticated;

drop trigger if exists itv_visits_figee on public.itv_visits;
create trigger itv_visits_figee before update on public.itv_visits for each row execute function app.itv_visite_figee();
drop trigger if exists itv_visit_items_figee on public.itv_visit_items;
create trigger itv_visit_items_figee before insert or update or delete on public.itv_visit_items for each row execute function app.itv_visite_figee();
drop trigger if exists itv_visit_parts_figee on public.itv_visit_parts;
create trigger itv_visit_parts_figee before insert or update or delete on public.itv_visit_parts for each row execute function app.itv_visite_figee();

insert into public.schema_migrations (version) values ('0381_audit_correctifs') on conflict (version) do nothing;

-- ===== supabase/rollback/0381_audit_correctifs_retour.sql =====
-- Retour arrière de 0381_audit_correctifs.sql : retire le verrou des visites terminées. Idempotent.

drop trigger if exists itv_visit_parts_figee on public.itv_visit_parts;
drop trigger if exists itv_visit_items_figee on public.itv_visit_items;
drop trigger if exists itv_visits_figee on public.itv_visits;
drop function if exists app.itv_visite_figee();

delete from public.schema_migrations where version = '0381_audit_correctifs';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE audit_0381 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
