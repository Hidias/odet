-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (photo_0426) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0426_profil_photo.sql, retour arrière,
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

-- ===== supabase/migrations/0426_profil_photo.sql =====
-- 0426 : photo ou logo du profil (espaces extérieurs, demande de H, 21/10, 21 h 31). Chaque personne connectée à un
-- espace (entreprise, formateur, stagiaire, équipe) peut mettre une photo ou un logo pour une expérience à son image ;
-- l'accueil dit « Bonjour » + son prénom, jamais le nom de l'entreprise. Image réduite par le navigateur (256 px), gardée
-- dans le profil (au plus 300 000 caractères). Seule la personne elle-même les change (public.mon_profil_photo, public.mon_profil_prenom).
-- Migration additive (colonne et fonction). Idempotente. Retour arrière : supabase/rollback/0426_profil_photo_retour.sql

alter table public.profiles add column if not exists photo text;
alter table public.profiles drop constraint if exists profiles_photo_check;
alter table public.profiles add constraint profiles_photo_check
  check (photo is null or (length(photo) <= 300000 and photo ~ '^data:image/(png|jpeg|webp);base64,'));
comment on column public.profiles.photo is 'Photo ou logo choisi par la personne (image réduite, en data URL) pour ses espaces';

create or replace function public.mon_profil_photo(p_photo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v text := nullif(btrim(coalesce(p_photo, '')), '');
begin
  if auth.uid() is null then raise exception 'Connexion requise' using errcode = '42501'; end if;
  if v is not null and (length(v) > 300000 or v !~ '^data:image/(png|jpeg|webp);base64,') then
    raise exception 'Image refusée : JPEG, PNG ou WebP de petite taille' using errcode = '22023';
  end if;
  update public.profiles set photo = v, updated_at = now() where id = auth.uid();
  return jsonb_build_object('ok', true);
end
$$;
revoke all on function public.mon_profil_photo(text) from public, anon;
grant execute on function public.mon_profil_photo(text) to authenticated;

-- Prénom affiché à l'accueil (« Bonjour Sophie ») : la personne le renseigne elle-même (comptes entreprise créés sans prénom)
create or replace function public.mon_profil_prenom(p_prenom text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v text := nullif(btrim(coalesce(p_prenom, '')), '');
begin
  if auth.uid() is null then raise exception 'Connexion requise' using errcode = '42501'; end if;
  if v is not null and length(v) > 60 then raise exception 'Prénom trop long' using errcode = '22023'; end if;
  update public.profiles set first_name = v, updated_at = now() where id = auth.uid();
  return jsonb_build_object('ok', true);
end
$$;
revoke all on function public.mon_profil_prenom(text) from public, anon;
grant execute on function public.mon_profil_prenom(text) to authenticated;

insert into public.schema_migrations (version) values ('0426_profil_photo') on conflict (version) do nothing;

-- ===== supabase/rollback/0426_profil_photo_retour.sql =====
-- Retour arrière de 0426_profil_photo.sql : photos retirées. Idempotent.
drop function if exists public.mon_profil_photo(text);
drop function if exists public.mon_profil_prenom(text);
alter table public.profiles drop constraint if exists profiles_photo_check;
alter table public.profiles drop column if exists photo;
delete from public.schema_migrations where version = '0426_profil_photo';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE photo_0426 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
