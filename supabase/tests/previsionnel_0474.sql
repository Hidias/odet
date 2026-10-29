-- Essai local de 0474 : sources par mois, hypothèses (défaut puis direction, tracée), photo et alerte.
begin;
set local client_min_messages = warning;
do $$
declare v_cie uuid; v_client uuid; v_k uuid; v_r jsonb; v_q uuid;
begin
  select id into v_cie from public.companies limit 1;
  insert into public.clients (name, company_id) values ('Client 0474', v_cie) returning id into v_client;
  insert into public.itv_contracts (client_id, company_id, start_on, annual_price_ht, visit_months, status, duration_years, billing_period, tacit_renewal)
  values (v_client, v_cie, date_trunc('month', current_date)::date, 1200, array[3], 'a_valider', 1, 'trimestriel', false) returning id into v_k;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  perform public.contrat_valider(v_k);
  insert into public.quotes (reference, client_id, company_id, status, quote_date, validity_date, total_ht) values ('DEV-0474', v_client, v_cie, 'sent', current_date, current_date + 30, 1000) returning id into v_q;
  v_r := app.previsionnel_calcul(v_cie);
  if (v_r->'mois'->0->>'certain')::numeric < 300 then raise exception 'échéance du mois absente : %', v_r->'mois'->0; end if;
  if ((v_r->'mois'->1->>'devis')::numeric + (v_r->'mois'->0->>'devis')::numeric) < 1000 then raise exception 'devis en cours absent'; end if;
  if v_r->'hypotheses'->'recurrent'->>'origine' <> 'defaut' or (v_r->'hypotheses'->'devis'->>'pessimiste')::numeric <> 0 then raise exception 'hypothèses : %', v_r->'hypotheses'; end if;
  -- Réglage direction (compte de direction fictif), tracé ; retour au calcul
  insert into auth.users (id, email, aud, role) values ('00000000-0000-4000-8000-00000000d474', 'dir0474@exemple.invalid', 'authenticated', 'authenticated') on conflict do nothing;
  alter table public.profiles disable trigger profiles_protect_role;
  insert into public.profiles (id, email, role, is_active) values ('00000000-0000-4000-8000-00000000d474', 'dir0474@exemple.invalid', 'superadmin', true)
    on conflict (id) do update set role = 'superadmin', is_active = true;
  alter table public.profiles enable trigger profiles_protect_role;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d474","role":"authenticated"}', true);
  perform public.previsionnel_hypothese_regler('recurrent', 10, 40, 80);
  v_r := app.previsionnel_calcul(v_cie);
  if v_r->'hypotheses'->'recurrent'->>'origine' <> 'direction' or (v_r->'hypotheses'->'recurrent'->>'realiste')::numeric <> 40 then raise exception 'réglage : %', v_r->'hypotheses'->'recurrent'; end if;
  if (select count(*) from public.previsionnel_hypotheses_journal where company_id = v_cie and cle = 'recurrent') < 1 then raise exception 'journal vide'; end if;
  perform public.previsionnel_hypothese_regler('recurrent', null, null, null);
  if app.previsionnel_calcul(v_cie)->'hypotheses'->'recurrent'->>'origine' <> 'defaut' then raise exception 'retour au défaut'; end if;
  -- Photo du mois (une seule fois)
  perform set_config('request.jwt.claims', '', true);
  delete from public.previsionnel_photos where company_id = v_cie;
  v_r := public.previsionnel_nuit();
  if (select count(*) from public.previsionnel_photos where company_id = v_cie) <> 12 then raise exception 'photos : %', v_r; end if;
  perform public.previsionnel_nuit();
  if (select count(*) from public.previsionnel_photos where company_id = v_cie) <> 12 then raise exception 'photo en double'; end if;
  raise warning 'ESSAI 0474 : OK';
end
$$;
rollback;
