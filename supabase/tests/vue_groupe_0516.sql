-- Essai de 0516 : en vue groupe, les écritures d'un compte connecté sont refusées ; une société choisie, ou la nuit
-- (sans compte), écrit comme avant. Rouge sans 0516. Données d'essai créées ici, tout est annulé.
begin;
set local client_min_messages = warning;

-- Fonction security definer d'essai (propriétaire : rôle de l'essai), qui écrit dans une table de société
create function pg_temp.essai_0516_ecrire(p_cie uuid) returns void language sql security definer as
$f$ insert into public.team_actions (company_id, title) values (p_cie, 'Écrite par une fonction') $f$;
grant execute on function pg_temp.essai_0516_ecrire(uuid) to authenticated;

do $$
declare
  v_cie uuid; v_co2 uuid;
  v_u uuid := 'e0516000-0000-4000-8000-000000000001';
  c_u text; h_groupe text; h_cie text; v_n int; v_t uuid;
begin
  select id into v_cie from public.companies order by created_at limit 1;
  insert into public.companies (legal_name) values ('Société essai 0516') returning id into v_co2;
  insert into auth.users (id, email, aud, role) values (v_u, 'u-0516@exemple.invalid', 'authenticated', 'authenticated');
  insert into public.profiles (id, email) values (v_u, 'u-0516@exemple.invalid') on conflict (id) do nothing;
  update public.profiles set is_active = true where id = v_u;
  insert into public.company_members (company_id, profile_id, role, is_default, is_active, can_consolidate) values
    (v_cie, v_u, 'admin', true, true, true), (v_co2, v_u, 'admin', false, true, true)
  on conflict (company_id, profile_id) do update set role = 'admin', is_active = true, can_consolidate = true;
  c_u := json_build_object('sub', v_u, 'role', 'authenticated')::text;
  h_groupe := '{"x-company-id": "groupe"}';
  h_cie := json_build_object('x-company-id', v_cie)::text;

  -- 0. Déclencheur posé partout sauf sur les tables laissées ouvertes
  if not exists (select 1 from pg_trigger where tgname = 'aa_vue_groupe_lecture' and tgrelid = 'public.team_actions'::regclass) then
    raise exception '0. déclencheur absent de team_actions'; end if;
  if exists (select 1 from pg_trigger where tgname = 'aa_vue_groupe_lecture' and tgrelid = 'public.audit_logs'::regclass) then
    raise exception '0b. journal d''audit fermé'; end if;
  if app.vue_groupe_poser() <> 0 then raise exception '0c. pose non idempotente'; end if;
  -- 0d. Couverture : toute table de public à company_id porte le déclencheur, sauf les tables laissées ouvertes
  select count(*) into v_n from information_schema.columns c
    join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'company_id'
      and c.table_name <> all (array['audit_logs', 'error_logs', 'job_runs', 'import_logs', 'auto_send_switch_log',
        'session_document_access', 'notifications', 'user_feedback', 'platform_notices', 'company_members',
        'company_member_rights', 'company_modules', 'company_establishments', 'permission_profile_rights',
        'support_access_grants', 'push_subscriptions'])
      and not exists (select 1 from pg_trigger g where g.tgrelid = format('public.%I', c.table_name)::regclass and g.tgname = 'aa_vue_groupe_lecture');
  if v_n <> 0 then raise exception '0d. % table(s) à company_id sans déclencheur', v_n; end if;
  if exists (select 1 from pg_trigger where tgname = 'aa_vue_groupe_lecture'
             and tgrelid in ('public.push_subscriptions'::regclass, 'public.company_establishments'::regclass, 'public.permission_profile_rights'::regclass)) then
    raise exception '0e. réglage de société ou abonnement du téléphone fermé'; end if;

  -- 1. Vue groupe : écriture refusée, lecture possible
  perform set_config('request.jwt.claims', c_u, true);
  perform set_config('request.headers', h_groupe, true);
  perform set_config('role', 'authenticated', true);
  if not coalesce(app.vue_groupe(), false) then raise exception '1. vue groupe non reconnue'; end if;
  perform count(*) from public.team_actions;
  begin
    insert into public.team_actions (company_id, title) values (v_cie, 'Écrite en vue groupe');
    raise exception '1b. écriture acceptée en vue groupe';
  exception when insufficient_privilege then
    if sqlerrm not like 'Vue groupe : lecture seule.%' then raise; end if;
  end;
  begin
    update public.team_actions set title = title where false;
    raise exception '1c. mise à jour acceptée en vue groupe';
  exception when insufficient_privilege then
    if sqlerrm <> 'Vue groupe : lecture seule. Pour créer ou modifier, choisissez une société dans l''en-tête.' then raise; end if;
  end;
  -- 1d. Fonction security definer appelée par le compte en vue groupe : refusée aussi
  begin
    perform pg_temp.essai_0516_ecrire(v_cie);
    raise exception '1d. écriture par une fonction security definer acceptée en vue groupe';
  exception when insufficient_privilege then
    if sqlerrm not like 'Vue groupe : lecture seule.%' then raise; end if;
  end;

  -- 2. Société choisie : écriture acceptée
  perform set_config('request.headers', h_cie, true);
  insert into public.team_actions (company_id, title) values (v_cie, 'Écrite dans une société');
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception '2. écriture refusée avec une société choisie'; end if;

  -- 3. Sans compte connecté (nuit, clé de service), même avec l'en-tête : acceptée
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', h_groupe, true);
  insert into public.team_actions (company_id, title) values (v_cie, 'Écrite par la nuit');

  -- 4. Clé de service (rôle service_role, aucun compte) avec l'en-tête : acceptée
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('role', 'service_role', true);
  insert into public.team_actions (company_id, title) values (v_cie, 'Écrite par la clé de service');
  perform set_config('role', 'postgres', true);

  -- 5. Suite d'une écriture admise, faite par un autre déclencheur : acceptée (compte relié à une fiche formateur
  --    qui corrige son nom en vue groupe ; profiles n'est pas rattachée à une société)
  insert into public.trainers (company_id, first_name, last_name) values (v_cie, 'Avant', 'ESSAI') returning id into v_t;
  update public.profiles set trainer_id = v_t, first_name = 'Avant', last_name = 'ESSAI', phone = '0600000000' where id = v_u;
  perform set_config('request.jwt.claims', c_u, true);
  perform set_config('request.headers', h_groupe, true);
  if not coalesce(app.vue_groupe(), false) then raise exception '5. vue groupe non reconnue'; end if;
  begin
    insert into public.team_actions (company_id, title) values (v_cie, 'Écrite en vue groupe');
    raise exception '5b. écriture directe acceptée en vue groupe';
  exception when insufficient_privilege then null;
  end;
  update public.profiles set first_name = 'Après' where id = v_u;
  if (select first_name from public.trainers where id = v_t) <> 'Après' then raise exception '5c. fiche formateur non suivie'; end if;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end $$;

rollback;
