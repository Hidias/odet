-- Essai de 0516 : en vue groupe, les écritures d'un compte connecté sont refusées ; une société choisie, ou la nuit
-- (sans compte), écrit comme avant. Rouge sans 0516. Données d'essai créées ici, tout est annulé.
begin;
set local client_min_messages = warning;

do $$
declare
  v_cie uuid; v_co2 uuid;
  v_u uuid := 'e0516000-0000-4000-8000-000000000001';
  c_u text; h_groupe text; h_cie text; v_n int;
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
  exception when insufficient_privilege then null;
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
  perform set_config('request.headers', '', true);
end $$;

rollback;
