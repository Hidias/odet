-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (formateurs_0495) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0495_formateurs_session_cles.sql, retour arrière,
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

-- ===== supabase/migrations/0495_formateurs_session_cles.sql =====
-- 0495 : formateurs d'une session (suite de C6, #304).
-- 1. app.session_appliquer (0437), appelée à la confirmation d'une session préparée et pour une session supplémentaire
--    d'un devis, retirait de session_trainers tous les formateurs sauf celui qu'elle pose : les autres formateurs cochés
--    depuis C6 disparaissaient à la confirmation. Elle ne retire plus que l'ancien formateur principal, s'il change.
-- 2. session_trainers n'avait aucune clé étrangère vers sessions ni trainers (relevé en production le 05/11) : ses lignes
--    partent désormais avec la session ou le formateur (cascade), dans la même transaction. 0 ligne orpheline en
--    production le 06/11 (1 ligne au total). L'index sur trainer_id existe déjà (0081), session_id est en tête de la
--    clé primaire.

create or replace function app.session_appliquer(p_session uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_debut date := nullif(p_data ->> 'start_date', '')::date;
  v_fin date := coalesce(nullif(p_data ->> 'end_date', '')::date, nullif(p_data ->> 'start_date', '')::date);
  v_h1 time := nullif(p_data ->> 'start_time', '')::time;
  v_h2 time := nullif(p_data ->> 'end_time', '')::time;
  v_max int := nullif(p_data ->> 'max_participants', '')::int;
  v_sup int := coalesce(nullif(p_data ->> 'places_supplementaires', '')::int, 0);
  v_formateur uuid := nullif(p_data ->> 'trainer_id', '')::uuid;
  v_ancien uuid;
begin
  if v_debut is null or v_h1 is null or v_h2 is null then raise exception 'Date, heure de début et heure de fin requises' using errcode = '22023'; end if;
  if v_fin < v_debut then raise exception 'La fin est avant le début' using errcode = '22023'; end if;
  if v_h2 <= v_h1 then raise exception 'L''heure de fin doit suivre l''heure de début' using errcode = '22023'; end if;
  if v_formateur is null then raise exception 'Formateur requis' using errcode = '22023'; end if;
  if v_max is null or v_max < 1 or v_max > 200 then raise exception 'Nombre de places invalide' using errcode = '22023'; end if;
  if v_sup < 0 or v_sup > 20 then raise exception 'Dépassement autorisé entre 0 et 20' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_data ->> 'location_name', '') || coalesce(p_data ->> 'location_address', '') || coalesce(p_data ->> 'location_city', ''))) < 2 then
    raise exception 'Lieu requis' using errcode = '22023';
  end if;
  select trainer_id into v_ancien from public.sessions where id = p_session;
  update public.sessions set
    start_date = v_debut, end_date = v_fin, start_time = v_h1, end_time = v_h2,
    day_type = case when v_h2 - v_h1 <= interval '4 hours 30 minutes' then 'half' else 'full' end,
    location_name = nullif(btrim(coalesce(p_data ->> 'location_name', '')), ''),
    location_address = nullif(btrim(coalesce(p_data ->> 'location_address', '')), ''),
    location_postal_code = nullif(btrim(coalesce(p_data ->> 'location_postal_code', '')), ''),
    location_city = nullif(btrim(coalesce(p_data ->> 'location_city', '')), ''),
    trainer_id = v_formateur, max_participants = v_max, places_supplementaires = v_sup,
    contact_id = coalesce(nullif(p_data ->> 'contact_id', '')::uuid, contact_id),
    total_price = coalesce(nullif(p_data ->> 'total_price', '')::numeric, total_price),
    validation_requise = false, status_locked = true, updated_at = now()
  where id = p_session;
  if v_ancien is not null and v_ancien <> v_formateur then
    delete from public.session_trainers where session_id = p_session and trainer_id = v_ancien;
  end if;
  insert into public.session_trainers (session_id, trainer_id) values (p_session, v_formateur) on conflict do nothing;
end
$$;
revoke all on function app.session_appliquer(uuid, jsonb) from public, anon, authenticated;

alter table public.session_trainers
  add constraint session_trainers_session_fk foreign key (session_id) references public.sessions (id) on delete cascade;
alter table public.session_trainers
  add constraint session_trainers_trainer_fk foreign key (trainer_id) references public.trainers (id) on delete cascade;

insert into public.schema_migrations (version) values ('0495_formateurs_session_cles') on conflict (version) do nothing;

-- ===== supabase/rollback/0495_formateurs_session_cles_retour.sql =====
-- Retour arrière de 0495 : clés étrangères de session_trainers retirées, app.session_appliquer reprend sa définition
-- de 0437 (relevée en production le 06/11, empreinte 490dddc7aa3a23eb2a86b6662af3921f). Aucune donnée n'est touchée.

alter table public.session_trainers drop constraint if exists session_trainers_trainer_fk;
alter table public.session_trainers drop constraint if exists session_trainers_session_fk;

create or replace function app.session_appliquer(p_session uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_debut date := nullif(p_data ->> 'start_date', '')::date;
  v_fin date := coalesce(nullif(p_data ->> 'end_date', '')::date, nullif(p_data ->> 'start_date', '')::date);
  v_h1 time := nullif(p_data ->> 'start_time', '')::time;
  v_h2 time := nullif(p_data ->> 'end_time', '')::time;
  v_max int := nullif(p_data ->> 'max_participants', '')::int;
  v_sup int := coalesce(nullif(p_data ->> 'places_supplementaires', '')::int, 0);
  v_formateur uuid := nullif(p_data ->> 'trainer_id', '')::uuid;
begin
  if v_debut is null or v_h1 is null or v_h2 is null then raise exception 'Date, heure de début et heure de fin requises' using errcode = '22023'; end if;
  if v_fin < v_debut then raise exception 'La fin est avant le début' using errcode = '22023'; end if;
  if v_h2 <= v_h1 then raise exception 'L''heure de fin doit suivre l''heure de début' using errcode = '22023'; end if;
  if v_formateur is null then raise exception 'Formateur requis' using errcode = '22023'; end if;
  if v_max is null or v_max < 1 or v_max > 200 then raise exception 'Nombre de places invalide' using errcode = '22023'; end if;
  if v_sup < 0 or v_sup > 20 then raise exception 'Dépassement autorisé entre 0 et 20' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_data ->> 'location_name', '') || coalesce(p_data ->> 'location_address', '') || coalesce(p_data ->> 'location_city', ''))) < 2 then
    raise exception 'Lieu requis' using errcode = '22023';
  end if;
  update public.sessions set
    start_date = v_debut, end_date = v_fin, start_time = v_h1, end_time = v_h2,
    day_type = case when v_h2 - v_h1 <= interval '4 hours 30 minutes' then 'half' else 'full' end,
    location_name = nullif(btrim(coalesce(p_data ->> 'location_name', '')), ''),
    location_address = nullif(btrim(coalesce(p_data ->> 'location_address', '')), ''),
    location_postal_code = nullif(btrim(coalesce(p_data ->> 'location_postal_code', '')), ''),
    location_city = nullif(btrim(coalesce(p_data ->> 'location_city', '')), ''),
    trainer_id = v_formateur, max_participants = v_max, places_supplementaires = v_sup,
    contact_id = coalesce(nullif(p_data ->> 'contact_id', '')::uuid, contact_id),
    total_price = coalesce(nullif(p_data ->> 'total_price', '')::numeric, total_price),
    validation_requise = false, status_locked = true, updated_at = now()
  where id = p_session;
  delete from public.session_trainers where session_id = p_session and trainer_id <> v_formateur;
  insert into public.session_trainers (session_id, trainer_id) values (p_session, v_formateur) on conflict do nothing;
end
$$;
revoke all on function app.session_appliquer(uuid, jsonb) from public, anon, authenticated;

delete from public.schema_migrations where version = '0495_formateurs_session_cles';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE formateurs_0495 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
