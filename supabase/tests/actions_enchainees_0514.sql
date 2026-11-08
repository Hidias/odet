-- Essai de 0514 : types d'action (délai, responsable, suite) et suite d'une action.
-- Rouge sans 0514 (table et colonnes absentes). Données d'essai créées ici (une société existante seulement), tout est annulé.
begin;
set local client_min_messages = warning;

do $$
declare
  v_cie uuid; v_autre uuid;
  v_envoi uuid; v_relance uuid; v_t uuid; v_a uuid; v_b uuid; v_c uuid; v_n int;
begin
  select id into v_cie from public.companies order by created_at limit 1;

  -- 1. Liste de départ posée pour chaque société existante, et pour une nouvelle société
  if (select count(*) from public.team_action_types where company_id = v_cie) < 4 then raise exception '1. liste de départ absente'; end if;
  insert into public.companies (legal_name) values ('Société essai 0514') returning id into v_autre;
  select count(*) into v_n from public.team_action_types where company_id = v_autre;
  if v_n <> 4 then raise exception '1b. nouvelle société : % types (4 attendus)', v_n; end if;
  select id into v_envoi from public.team_action_types where company_id = v_autre and name = 'Envoyer un devis';
  select id into v_relance from public.team_action_types where company_id = v_autre and name = 'Relancer le devis';
  if (select next_type_id from public.team_action_types where id = v_envoi) is distinct from v_relance
     or (select delay_days from public.team_action_types where id = v_relance) <> 7 then raise exception '1c. suite de départ fausse'; end if;
  -- Jamais reposée : une société qui a déjà des types n'en reçoit pas d'autres
  perform app.team_action_types_depart(v_autre);
  if (select count(*) from public.team_action_types where company_id = v_autre) <> 4 then raise exception '1d. liste reposée'; end if;
  delete from public.team_action_types where company_id = v_autre and name = 'Rendez-vous';
  perform app.team_action_types_depart(v_autre);
  if (select count(*) from public.team_action_types where company_id = v_autre) <> 3 then raise exception '1e. type supprimé reposé'; end if;

  -- 2. Type suivant d'une autre société refusé ; société d'un type figée ; même nom refusé
  select id into v_t from public.team_action_types where company_id = v_cie order by position limit 1;
  begin
    update public.team_action_types set next_type_id = v_relance where id = v_t;
    raise exception '2. type suivant d''une autre société accepté';
  exception when check_violation then null;
  end;
  update public.team_action_types set company_id = v_autre where id = v_t;
  if (select company_id from public.team_action_types where id = v_t) <> v_cie then raise exception '2b. société changée'; end if;
  begin
    insert into public.team_action_types (company_id, name) values (v_autre, ' relancer le DEVIS ');
    raise exception '2c. même nom accepté';
  exception when unique_violation then null;
  end;
  begin
    insert into public.team_action_types (company_id, name, delay_days) values (v_autre, 'Délai faux', 400);
    raise exception '2d. délai hors limites accepté';
  exception when check_violation then null;
  end;

  -- 3. Action et suite
  insert into public.team_actions (company_id, title, type_id) values (v_autre, 'Envoyer le devis essai 0514', v_envoi) returning id into v_a;
  begin
    insert into public.team_actions (company_id, title, type_id) values (v_cie, 'Type étranger', v_envoi);
    raise exception '3. type d''une autre société accepté';
  exception when check_violation then null;
  end;
  begin
    insert into public.team_actions (company_id, title, previous_id) values (v_cie, 'Suite étrangère', v_a);
    raise exception '3b. suite d''une action d''une autre société acceptée';
  exception when check_violation then null;
  end;
  update public.team_actions set status = 'fait' where id = v_a;
  insert into public.team_actions (company_id, title, type_id, previous_id) values (v_autre, 'Relancer le devis essai 0514', v_relance, v_a) returning id into v_b;
  begin
    insert into public.team_actions (company_id, title, previous_id) values (v_autre, 'Seconde suite', v_a);
    raise exception '3c. seconde suite acceptée';
  exception when unique_violation then null;
  end;
  -- La précédente est figée après la création
  insert into public.team_actions (company_id, title) values (v_autre, 'Autre action 0514') returning id into v_c;
  update public.team_actions set previous_id = v_c where id = v_b;
  if (select previous_id from public.team_actions where id = v_b) <> v_a then raise exception '3d. précédente changée'; end if;
  begin
    update public.team_actions set type_id = v_t where id = v_c;
    raise exception '3e. type d''une autre société accepté à la modification';
  exception when check_violation then null;
  end;

  -- 4. Type supprimé : l'action reste sans type ; action précédente supprimée : la suite reste
  delete from public.team_action_types where id = v_relance;
  if (select type_id from public.team_actions where id = v_b) is not null then raise exception '4. type supprimé encore lié'; end if;
  if (select next_type_id from public.team_action_types where id = v_envoi) is not null then raise exception '4b. type suivant encore lié'; end if;
  delete from public.team_actions where id = v_a;
  if not exists (select 1 from public.team_actions where id = v_b and previous_id is null) then raise exception '4c. suite perdue'; end if;

  -- 5. Droits : règles en place, fonction de départ fermée
  if not (select relrowsecurity from pg_class where oid = 'public.team_action_types'::regclass)
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'team_action_types') <> 4 then
    raise exception '5. règles absentes'; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'team_action_types' and cmd <> 'SELECT'
             and (coalesce(qual, '') || coalesce(with_check, '') like '%visible_companies%'
                  or coalesce(qual, '') || coalesce(with_check, '') not like '%societes_avec_droit(''manager.cockpit.voir''%')) then
    raise exception '5b. écriture non réservée à la direction'; end if;
  if has_function_privilege('authenticated', 'app.team_action_types_depart(uuid)', 'execute') then raise exception '5c. fonction ouverte'; end if;
end
$$;

rollback;
