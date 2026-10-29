-- Essai local de 0471 : résiliation en ligne d'un particulier, refusée à un professionnel.
begin;
set local client_min_messages = warning;
do $$
declare v_cie uuid; v_part uuid; v_pro uuid; v_k uuid; v_k2 uuid; v_u uuid := gen_random_uuid(); v_u2 uuid := gen_random_uuid(); v_r jsonb; v_ok boolean;
begin
  select id into v_cie from public.companies limit 1;
  insert into public.clients (name, client_type, company_id) values ('Particulier 0471', 'particulier', v_cie) returning id into v_part;
  insert into public.clients (name, client_type, company_id) values ('Pro 0471', 'entreprise', v_cie) returning id into v_pro;
  insert into public.itv_contracts (client_id, company_id, start_on, annual_price_ht, visit_months, status, tacit_renewal, term_on, notice_months)
  values (v_part, v_cie, current_date - 30, 100, array[3], 'actif', true, current_date + 335, 1) returning id into v_k;
  insert into public.itv_contracts (client_id, company_id, start_on, annual_price_ht, visit_months, status) values (v_pro, v_cie, current_date, 100, array[3], 'actif') returning id into v_k2;
  insert into auth.users (id, email, aud, role) values (v_u, 'part0471@exemple.invalid', 'authenticated', 'authenticated'), (v_u2, 'pro0471@exemple.invalid', 'authenticated', 'authenticated');
  alter table public.profiles disable trigger profiles_protect_role;
  insert into public.profiles (id, email, role, is_active) values (v_u, 'part0471@exemple.invalid', 'entreprise', true), (v_u2, 'pro0471@exemple.invalid', 'entreprise', true)
    on conflict (id) do update set role = 'entreprise', is_active = true;
  alter table public.profiles enable trigger profiles_protect_role;
  insert into public.client_accounts (company_id, profile_id, client_id) values (v_cie, v_u, v_part), (v_cie, v_u2, v_pro);

  perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  v_r := public.ent_contrats();
  if not (v_r->>'particulier')::boolean or jsonb_array_length(v_r->'contrats') <> 1 then raise exception 'liste : %', v_r; end if;
  v_r := public.ent_contrat_resilier(v_k, 'Déménagement');
  if (v_r->>'deja')::boolean or v_r->>'receipt' not like 'RES-%' then raise exception 'résiliation : %', v_r; end if;
  if (select status from public.itv_contracts where id = v_k) <> 'actif' then raise exception 'statut changé tout seul'; end if;
  if not exists (select 1 from public.scheduled_actions where dedup_key = 'resiliation:' || v_k) then raise exception 'rappel direction absent'; end if;
  if not (public.ent_contrat_resilier(v_k, null)->>'deja')::boolean then raise exception 'deuxième demande non reconnue'; end if;
  -- Contrat d'un autre client : refusé
  begin perform public.ent_contrat_resilier(v_k2, null); v_ok := true; exception when others then v_ok := false; end;
  if v_ok then raise exception 'contrat d''un autre client résilié'; end if;
  -- Professionnel : refusé
  perform set_config('request.jwt.claims', json_build_object('sub', v_u2, 'role', 'authenticated')::text, true);
  begin perform public.ent_contrat_resilier(v_k2, null); v_ok := true; exception when insufficient_privilege then v_ok := false; end;
  if v_ok then raise exception 'professionnel autorisé'; end if;
  raise warning 'ESSAI 0471 : OK';
end
$$;
rollback;
