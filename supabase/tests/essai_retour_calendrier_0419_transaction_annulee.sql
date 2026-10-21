-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (calendrier_0419) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0419_calendrier_public.sql, retour arrière,
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

-- ===== supabase/migrations/0419_calendrier_public.sql =====
-- 0419 : calendrier public des sessions inter (série du 21/10, n° 27). Une page publique de l'outil liste les
-- sessions inter publiées : formation, dates, horaires, ville, places restantes, prix par personne (ou « sur
-- demande »), avec la réserve de maintien choisie par l'organisme (décision de H du 21/10 : sessions publiées
-- directement, avec une mention qui couvre l'organisme en cas d'annulation). La même page s'intègre dans le site de
-- l'organisme (bloc à copier depuis les paramètres).
--   1. organization_settings : calendrier publié ou non (non par défaut), réserve de maintien (texte modifiable).
--   2. public.public_calendrier() : lecture publique, seulement si le calendrier est publié ; aucune donnée
--      personnelle (ni stagiaire, ni client, ni adresse précise).
-- Les sessions sont publiées une par une (sessions.is_public, prix public par personne : colonnes existantes).
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0419_calendrier_public_retour.sql

alter table public.organization_settings add column if not exists calendrier_public boolean not null default false;
alter table public.organization_settings add column if not exists mention_maintien text
  default 'Session maintenue sous réserve d''un nombre minimum d''inscrits et de la disponibilité du formateur. En cas de report ou d''annulation par l''organisme, l''inscription est sans frais pour vous et d''autres dates vous sont proposées.';
comment on column public.organization_settings.calendrier_public is 'Calendrier public des sessions inter publié (page publique et bloc pour le site)';
comment on column public.organization_settings.mention_maintien is 'Réserve de maintien des sessions inter, affichée au calendrier public, à l''inscription et sur les conventions';

create or replace function public.public_calendrier()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o record;
  v_societe uuid := app.company_default();
begin
  select os.calendrier_public, os.name, os.phone, os.email, os.website, os.mention_maintien into o
    from public.organization_settings os limit 1;
  if not coalesce(o.calendrier_public, false) then
    return jsonb_build_object('publie', false);
  end if;
  return jsonb_build_object(
    'publie', true,
    'organisme', jsonb_build_object('name', o.name, 'phone', o.phone, 'email', o.email, 'website', o.website),
    'mention_maintien', o.mention_maintien,
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'reference', s.reference, 'course_id', s.course_id, 'title', co.title, 'code', co.code,
               'duration_hours', co.duration_hours, 'duration_days', co.duration_days,
               'start_date', s.start_date, 'end_date', coalesce(s.end_date, s.start_date),
               'start_time', s.start_time, 'end_time', s.end_time,
               'city', s.location_city, 'postal_code', s.location_postal_code, 'is_remote', coalesce(s.is_remote, false),
               'price_per_person', s.public_price_per_person,
               'places', case when s.max_participants is null then null
                              else greatest(s.max_participants - (select count(*) from public.session_trainees st
                                                                   where st.session_id = s.id and not coalesce(st.absent, false)), 0) end)
             order by s.start_date, co.title)
      from public.sessions s left join public.courses co on co.id = s.course_id
      where s.company_id = v_societe and s.session_type = 'inter' and coalesce(s.is_public, false)
        and s.start_date >= (now() at time zone 'Europe/Paris')::date
        and coalesce(s.status, '') not in ('cancelled', 'annulee')), '[]'::jsonb)
  );
end
$$;
revoke all on function public.public_calendrier() from public;
grant execute on function public.public_calendrier() to anon, authenticated;

insert into public.schema_migrations (version) values ('0419_calendrier_public') on conflict (version) do nothing;

-- ===== supabase/rollback/0419_calendrier_public_retour.sql =====
-- Retour arrière de 0419_calendrier_public.sql. Les sessions publiées le restent (is_public, colonne existante).
-- Idempotent.

drop function if exists public.public_calendrier();
alter table public.organization_settings drop column if exists mention_maintien;
alter table public.organization_settings drop column if exists calendrier_public;

delete from public.schema_migrations where version = '0419_calendrier_public';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE calendrier_0419 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
