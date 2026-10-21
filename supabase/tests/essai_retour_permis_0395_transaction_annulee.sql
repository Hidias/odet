-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (permis_0395) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0395_vehicule_permis.sql, retour arrière,
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

-- ===== supabase/migrations/0395_vehicule_permis.sql =====
-- 0395 : permis vérifié à l'attribution d'un véhicule (liste unique A5).
-- L'employeur qui confie un véhicule doit s'assurer que le conducteur détient un permis valable. Quand le module RH
-- est actif pour la société du véhicule et que le conducteur a une fiche du personnel, l'attribution est refusée
-- sans titre « Permis de conduire » en cours (non archivé, non suspendu, non échu à la date de début).
-- Sans fiche du personnel, rien n'est bloqué (rien à vérifier) : l'écran le signale. Les attributions déjà
-- enregistrées ne sont pas touchées. Idempotent.

create or replace function app.permis_motif(p_company uuid, p_profile uuid, p_person uuid, p_date date)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_person uuid := p_person;
begin
  if not exists (select 1 from public.company_modules m where m.company_id = p_company and m.key = 'rh' and m.enabled) then
    return null;
  end if;
  if v_person is null and p_profile is not null then
    select p.id into v_person from public.hr_people p
    where p.profile_id = p_profile and p.archived_at is null and p.company_id = p_company limit 1;
  end if;
  if v_person is null then return null; end if;
  if exists (select 1 from public.hr_qualifications q
             where q.person_id = v_person and q.kind = 'permis' and q.archived_at is null and q.suspended_at is null
               and (q.expires_on is null or q.expires_on >= coalesce(p_date, current_date))) then
    return null;
  end if;
  return 'Permis de conduire absent, échu ou suspendu dans le dossier du personnel';
end
$$;
revoke all on function app.permis_motif(uuid, uuid, uuid, date) from public, anon, authenticated;

-- Vérification pour l'écran, avant d'attribuer : null si tout va bien, sinon le motif ; « sans_fiche » si le
-- conducteur n'a pas de fiche du personnel (rien n'a pu être vérifié)
create or replace function public.vehicule_permis_verifier(p_vehicle uuid, p_profile uuid, p_date date default current_date)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_co uuid;
begin
  select v.company_id into v_co from public.vehicles v where v.id = p_vehicle;
  if v_co is null or not (v_co in (select app.societes_avec_droit('vehicules.parc.gerer'))) then
    raise exception 'Véhicule introuvable ou non accessible' using errcode = '42501';
  end if;
  if exists (select 1 from public.company_modules m where m.company_id = v_co and m.key = 'rh' and m.enabled)
     and not exists (select 1 from public.hr_people p where p.profile_id = p_profile and p.archived_at is null and p.company_id = v_co) then
    return 'sans_fiche';
  end if;
  return app.permis_motif(v_co, p_profile, null, p_date);
end
$$;
revoke all on function public.vehicule_permis_verifier(uuid, uuid, date) from public, anon;
grant execute on function public.vehicule_permis_verifier(uuid, uuid, date) to authenticated;

create or replace function app.vehicule_attribution_permis()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motif text;
begin
  if new.end_on is not null then return new; end if;
  if tg_op = 'UPDATE' and new.profile_id is not distinct from old.profile_id and new.person_id is not distinct from old.person_id
     and new.start_on is not distinct from old.start_on then
    return new;
  end if;
  v_motif := app.permis_motif(new.company_id, new.profile_id, new.person_id, new.start_on);
  if v_motif is not null then
    raise exception '%', v_motif using errcode = '23514',
      hint = 'Ajoutez le permis dans Personnel, fiche de la personne, Habilitations et titres.';
  end if;
  return new;
end
$$;
revoke all on function app.vehicule_attribution_permis() from public, anon, authenticated;
drop trigger if exists vehicle_assignments_permis on public.vehicle_assignments;
create trigger vehicle_assignments_permis before insert or update of profile_id, person_id, start_on on public.vehicle_assignments
  for each row execute function app.vehicule_attribution_permis();

insert into public.schema_migrations (version) values ('0395_vehicule_permis') on conflict (version) do nothing;

-- ===== supabase/rollback/0395_vehicule_permis_retour.sql =====
-- Retour arrière de 0395_vehicule_permis.sql : plus de vérification du permis à l'attribution. Idempotent.

drop trigger if exists vehicle_assignments_permis on public.vehicle_assignments;
drop function if exists app.vehicule_attribution_permis();
drop function if exists public.vehicule_permis_verifier(uuid, uuid, date);
drop function if exists app.permis_motif(uuid, uuid, uuid, date);

delete from public.schema_migrations where version = '0395_vehicule_permis';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE permis_0395 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
