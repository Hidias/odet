-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (appareil_0494) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0494_portail_appareil_concurrence.sql, retour arrière,
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

-- ===== supabase/migrations/0494_portail_appareil_concurrence.sql =====
-- 0494 : espace client, première visite d'un appareil sans erreur quand deux appels arrivent ensemble.
-- app.portail_appareil_noter (0449) cherchait l'appareil puis l'insérait. Deux appels simultanés à la première visite
-- (deux onglets ouverts ensemble) ne trouvaient rien tous les deux ; le second échouait sur l'index unique
-- portal_devices_compte_uniq ou portal_devices_acces_uniq (relevé le 05/11 sur base locale). L'insertion ignore
-- désormais le doublon (« on conflict do nothing », valable pour les deux index partiels), puis relit la ligne :
-- l'appel perdant répond comme une visite connue, sans notification « nouvel appareil ».
-- Seule la fonction change ; aucune donnée touchée (0 appareil en production le 05/11).

create or replace function app.portail_appareil_noter(p_client uuid, p_access uuid, p_profile uuid, p_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  h jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  v_ip text := left(nullif(btrim(split_part(coalesce(h->>'x-forwarded-for', h->>'cf-connecting-ip', h->>'x-real-ip', ''), ',', 1)), ''), 64);
  v_ua text := left(h->>'user-agent', 400);
  v_co uuid;
  v_nom text;
  v_id uuid;
  v_autres int;
  v_nouveau boolean := false;
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('error', 'Appareil non reconnu'); end if;
  select c.company_id, c.name into v_co, v_nom from public.clients c where c.id = p_client;
  if v_co is null then return jsonb_build_object('error', 'Client introuvable'); end if;
  select id into v_id from public.portal_devices
   where device_hash = p_hash and ((p_access is not null and access_id = p_access) or (p_profile is not null and profile_id = p_profile));
  if v_id is not null then
    update public.portal_devices set last_seen_at = now(), ip = coalesce(v_ip, ip), user_agent = coalesce(v_ua, user_agent) where id = v_id;
  else
    select count(*) into v_autres from public.portal_devices
     where (p_access is not null and access_id = p_access) or (p_profile is not null and profile_id = p_profile);
    insert into public.portal_devices (company_id, client_id, access_id, profile_id, device_hash, user_agent, ip)
    values (v_co, p_client, p_access, p_profile, p_hash, v_ua, v_ip)
    on conflict do nothing
    returning id into v_id;
    if v_id is null then
      -- Même appareil noté au même instant par un autre appel (deux onglets) : on relit sa ligne, rien n'est nouveau.
      select id into v_id from public.portal_devices
       where device_hash = p_hash and ((p_access is not null and access_id = p_access) or (p_profile is not null and profile_id = p_profile));
      update public.portal_devices set last_seen_at = now(), ip = coalesce(v_ip, ip), user_agent = coalesce(v_ua, user_agent) where id = v_id;
    elsif v_autres > 0 then
      v_nouveau := true;
      insert into public.notifications (company_id, type, title, message, link, metadata)
      values (v_co, 'espace_client_appareil', 'Espace client : nouvel appareil',
        coalesce(v_nom, 'Un client') || ' : connexion depuis un nouvel appareil (' || coalesce(app.appareil_libelle(v_ua), 'navigateur') || ')',
        '/clients/' || p_client, jsonb_build_object('client_id', p_client, 'device_id', v_id, 'canal', case when p_access is not null then 'lien' else 'compte' end));
    end if;
  end if;
  return jsonb_build_object('nouveau', v_nouveau, 'appareils', (
    select coalesce(jsonb_agg(jsonb_build_object('libelle', app.appareil_libelle(d.user_agent), 'premiere', d.first_seen_at,
      'derniere', d.last_seen_at, 'actuel', d.id = v_id) order by d.last_seen_at desc), '[]'::jsonb)
    from public.portal_devices d
    where (p_access is not null and d.access_id = p_access) or (p_profile is not null and d.profile_id = p_profile)));
end
$$;
revoke all on function app.portail_appareil_noter(uuid, uuid, uuid, text) from public, anon, authenticated;

insert into public.schema_migrations (version) values ('0494_portail_appareil_concurrence') on conflict (version) do nothing;

-- ===== supabase/rollback/0494_portail_appareil_concurrence_retour.sql =====
-- Retour arrière de 0494 : app.portail_appareil_noter reprend sa définition de 0449 (relevée en production le 05/11,
-- empreinte fe1f7b555b26b44c825fddba2f3fdfcf). Aucune donnée n'est touchée.

create or replace function app.portail_appareil_noter(p_client uuid, p_access uuid, p_profile uuid, p_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  h jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  v_ip text := left(nullif(btrim(split_part(coalesce(h->>'x-forwarded-for', h->>'cf-connecting-ip', h->>'x-real-ip', ''), ',', 1)), ''), 64);
  v_ua text := left(h->>'user-agent', 400);
  v_co uuid;
  v_nom text;
  v_id uuid;
  v_autres int;
  v_nouveau boolean := false;
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('error', 'Appareil non reconnu'); end if;
  select c.company_id, c.name into v_co, v_nom from public.clients c where c.id = p_client;
  if v_co is null then return jsonb_build_object('error', 'Client introuvable'); end if;
  select id into v_id from public.portal_devices
   where device_hash = p_hash and ((p_access is not null and access_id = p_access) or (p_profile is not null and profile_id = p_profile));
  if v_id is not null then
    update public.portal_devices set last_seen_at = now(), ip = coalesce(v_ip, ip), user_agent = coalesce(v_ua, user_agent) where id = v_id;
  else
    select count(*) into v_autres from public.portal_devices
     where (p_access is not null and access_id = p_access) or (p_profile is not null and profile_id = p_profile);
    insert into public.portal_devices (company_id, client_id, access_id, profile_id, device_hash, user_agent, ip)
    values (v_co, p_client, p_access, p_profile, p_hash, v_ua, v_ip) returning id into v_id;
    if v_autres > 0 then
      v_nouveau := true;
      insert into public.notifications (company_id, type, title, message, link, metadata)
      values (v_co, 'espace_client_appareil', 'Espace client : nouvel appareil',
        coalesce(v_nom, 'Un client') || ' : connexion depuis un nouvel appareil (' || coalesce(app.appareil_libelle(v_ua), 'navigateur') || ')',
        '/clients/' || p_client, jsonb_build_object('client_id', p_client, 'device_id', v_id, 'canal', case when p_access is not null then 'lien' else 'compte' end));
    end if;
  end if;
  return jsonb_build_object('nouveau', v_nouveau, 'appareils', (
    select coalesce(jsonb_agg(jsonb_build_object('libelle', app.appareil_libelle(d.user_agent), 'premiere', d.first_seen_at,
      'derniere', d.last_seen_at, 'actuel', d.id = v_id) order by d.last_seen_at desc), '[]'::jsonb)
    from public.portal_devices d
    where (p_access is not null and d.access_id = p_access) or (p_profile is not null and d.profile_id = p_profile)));
end
$$;
revoke all on function app.portail_appareil_noter(uuid, uuid, uuid, text) from public, anon, authenticated;

delete from public.schema_migrations where version = '0494_portail_appareil_concurrence';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE appareil_0494 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
