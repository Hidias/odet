-- Essai de 0513 : titres exigés par poste, actions de l'équipe préparées la nuit pour les manques et les fins à moins de 3 mois.
-- Rouge sans 0513 (tables et fonction absentes). Données d'essai créées ici (une société existante seulement), tout est annulé.
begin;
set local client_min_messages = warning;

do $$
declare
  v_cie uuid; v_j uuid; v_he uuid; v_sst uuid; v_resp uuid := gen_random_uuid(); v_moi uuid := gen_random_uuid();
  v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_e uuid; v_f uuid;
  v_jour date := (now() at time zone 'Europe/Paris')::date;
  v_r jsonb; v_n int; t record; v_id uuid; v_h uuid; v_i uuid; v_q uuid; v_k uuid;
begin
  select id into v_cie from public.companies order by created_at limit 1;
  insert into public.company_modules (company_id, key, enabled) values (v_cie, 'rh', true)
    on conflict (company_id, key) do update set enabled = true;
  insert into auth.users (id, email) values (v_resp, 'resp-0513@example.invalid'), (v_moi, 'moi-0513@example.invalid');
  update public.profiles set is_active = true where id in (v_resp, v_moi);

  insert into public.hr_jobs (company_id, name) values (v_cie, 'Technicien essai 0513') returning id into v_j;
  insert into public.hr_job_requirements (company_id, job_id, required_kind, required_symbols, label)
    values (v_cie, v_j, 'habilitation_electrique', array['BS', 'BR'], 'Habilitation électrique BS ou BR') returning id into v_he;
  -- Société de l'exigence : celle du poste, quelle que soit la valeur envoyée
  insert into public.hr_job_requirements (company_id, job_id, required_kind, label)
    values (gen_random_uuid(), v_j, 'sst', 'Sauveteur secouriste du travail') returning id into v_sst;
  if (select company_id from public.hr_job_requirements where id = v_sst) <> v_cie then raise exception '0. société de l''exigence'; end if;
  insert into public.hr_settings (company_id, titres_owner_id) values (v_cie, v_resp)
    on conflict (company_id) do update set titres_owner_id = excluded.titres_owner_id;

  -- A : aucun titre (2 manques) ; B : BR finit dans 2 mois, SST dans un an (1 fin proche) ;
  -- C : contrat terminé ; D : fiche archivée ; E : titre suspendu (manque), SST échu (manque daté) ; F : BR dans le libellé, sans fin
  insert into public.hr_people (company_id, first_name, last_name) values (v_cie, 'anne', 'Alpha') returning id into v_a;
  insert into public.hr_people (company_id, first_name, last_name) values (v_cie, 'Bruno', 'Bravo') returning id into v_b;
  insert into public.hr_people (company_id, first_name, last_name) values (v_cie, 'Chloé', 'Charlie') returning id into v_c;
  insert into public.hr_people (company_id, first_name, last_name, archived_at) values (v_cie, 'Denis', 'Delta', now()) returning id into v_d;
  insert into public.hr_people (company_id, first_name, last_name) values (v_cie, 'Emma', 'Echo') returning id into v_e;
  insert into public.hr_people (company_id, first_name, last_name) values (v_cie, 'Fanny', 'Foxtrot') returning id into v_f;
  insert into public.hr_employments (company_id, person_id, start_on, job_id) values
    (v_cie, v_a, v_jour - 100, v_j), (v_cie, v_b, v_jour - 100, v_j), (v_cie, v_d, v_jour - 100, v_j),
    (v_cie, v_e, v_jour - 100, v_j), (v_cie, v_f, v_jour - 100, v_j);
  insert into public.hr_employments (company_id, person_id, start_on, end_on, job_id) values (v_cie, v_c, v_jour - 100, v_jour - 1, v_j);
  insert into public.hr_qualifications (company_id, person_id, kind, label, symbols, expires_on) values
    (v_cie, v_b, 'habilitation_electrique', 'Habilitation', array['B0', 'BR'], v_jour + 60),
    (v_cie, v_b, 'sst', 'SST', null, v_jour + 365),
    (v_cie, v_e, 'sst', 'SST', null, v_jour - 10),
    (v_cie, v_f, 'habilitation_electrique', 'Habilitation BR', null, null),
    (v_cie, v_f, 'sst', 'SST', null, v_jour + 400);
  insert into public.hr_qualifications (company_id, person_id, kind, label, symbols, expires_on, suspended_at) values
    (v_cie, v_e, 'habilitation_electrique', 'Habilitation', array['BR'], v_jour + 500, now());
  -- Titre d'un autre type, ou sans le bon symbole : ne couvre pas
  insert into public.hr_qualifications (company_id, person_id, kind, label, symbols, expires_on) values
    (v_cie, v_a, 'habilitation_electrique', 'Habilitation', array['B0'], v_jour + 500),
    (v_cie, v_a, 'incendie', 'Incendie', null, v_jour + 500);
  -- Titre archivé : ne couvre pas
  insert into public.hr_qualifications (company_id, person_id, kind, label, expires_on, archived_at) values
    (v_cie, v_a, 'sst', 'SST', v_jour + 500, now());

  -- 1. Écarts
  select count(*) into v_n from app.habilitations_ecarts(v_cie, v_jour) e where e.person_id in (v_a, v_b, v_c, v_d, v_e, v_f);
  if v_n <> 5 then raise exception '1. % écarts (5 attendus)', v_n; end if;
  if (select count(*) from app.habilitations_ecarts(v_cie, v_jour) e where e.person_id = v_a and e.motif = 'manque') <> 2 then raise exception '1a. A'; end if;
  select * into t from app.habilitations_ecarts(v_cie, v_jour) e where e.person_id = v_b;
  if t.motif <> 'fin_proche' or t.requirement_id <> v_he or t.expires_on <> v_jour + 60 or t.nom <> 'BRAVO Bruno' then
    raise exception '1b. B (% % %)', t.motif, t.expires_on, t.nom; end if;
  if (select count(*) from app.habilitations_ecarts(v_cie, v_jour) e where e.person_id = v_e and e.motif = 'manque') <> 2 then raise exception '1c. E'; end if;
  if (select e.derniere_fin from app.habilitations_ecarts(v_cie, v_jour) e where e.person_id = v_e and e.requirement_id = v_sst) <> v_jour - 10 then raise exception '1d. dernière fin'; end if;
  if exists (select 1 from app.habilitations_ecarts(v_cie, v_jour) e where e.person_id in (v_c, v_d, v_f)) then raise exception '1e. C, D ou F'; end if;
  -- Fin à 3 mois et un jour : pas encore
  update public.hr_qualifications set expires_on = (v_jour + interval '3 months')::date where person_id = v_b and kind = 'habilitation_electrique';
  if exists (select 1 from app.habilitations_ecarts(v_cie, v_jour) e where e.person_id = v_b) then raise exception '1f. limite des 3 mois'; end if;
  update public.hr_qualifications set expires_on = v_jour + 60 where person_id = v_b and kind = 'habilitation_electrique';

  -- 2. Préparation de la nuit
  v_r := public.habilitations_actions_generer();
  select count(*) into v_n from public.team_actions where source = 'habilitation' and source_id in (v_a, v_b, v_e);
  if v_n <> 5 then raise exception '2. % actions (5 attendues, %)', v_n, v_r; end if;
  select * into t from public.team_actions where source = 'habilitation' and source_id = v_b;
  if t.owner_id <> v_resp or t.due_on <> v_jour + 60 or t.link <> '/collaborateurs/' || v_b or t.status <> 'a_faire'
     or t.title <> 'Titre à renouveler : BRAVO Bruno, Habilitation électrique BS ou BR' or t.created_by is not null
     or t.detail not like '%se termine le ' || to_char(v_jour + 60, 'DD/MM/YYYY') || '.' or t.company_id <> v_cie then
    raise exception '2b. action fausse (% % % %)', t.owner_id, t.due_on, t.title, t.detail; end if;
  select * into t from public.team_actions where source = 'habilitation' and source_id = v_a and dedup_key like '%:' || v_sst || ':%';
  if t.due_on <> v_jour or t.title <> 'Titre à obtenir : ALPHA anne, Sauveteur secouriste du travail' then raise exception '2c. manque (% %)', t.due_on, t.title; end if;

  -- 3. Rejouée : rien de nouveau ; action faite : pas recréée
  update public.team_actions set status = 'fait' where source = 'habilitation' and source_id = v_a;
  v_r := public.habilitations_actions_generer();
  if (select count(*) from public.team_actions where source = 'habilitation' and source_id in (v_a, v_b, v_e)) <> 5 then raise exception '3. doublons (%)', v_r; end if;
  -- Titre renouvelé puis à nouveau proche de sa fin : nouvelle action pour la nouvelle date
  update public.hr_qualifications set expires_on = v_jour + 70 where person_id = v_b and kind = 'habilitation_electrique';
  perform public.habilitations_actions_generer();
  if (select count(*) from public.team_actions where source = 'habilitation' and source_id = v_b) <> 2 then raise exception '3b. nouvelle fin'; end if;

  -- 4. Responsable désactivé : action sans responsable
  update public.profiles set is_active = false where id = v_resp;
  update public.hr_qualifications set expires_on = v_jour + 80 where person_id = v_b and kind = 'habilitation_electrique';
  perform public.habilitations_actions_generer();
  if (select owner_id from public.team_actions where source = 'habilitation' and source_id = v_b and due_on = v_jour + 80) is not null then raise exception '4. responsable inactif'; end if;

  -- 4b. Manque déjà signalé et traité, titre saisi puis suspendu : nouvelle action
  insert into public.hr_people (company_id, first_name, last_name) values (v_cie, 'Hugo', 'Hotel') returning id into v_h;
  insert into public.hr_employments (company_id, person_id, start_on, job_id) values (v_cie, v_h, v_jour - 5, v_j);
  insert into public.hr_qualifications (company_id, person_id, kind, label, expires_on) values (v_cie, v_h, 'sst', 'SST', v_jour + 900);
  perform public.habilitations_actions_generer();
  update public.team_actions set status = 'fait' where source_id = v_h;
  insert into public.hr_qualifications (company_id, person_id, kind, label, symbols, expires_on)
    values (v_cie, v_h, 'habilitation_electrique', 'Habilitation', array['BS'], v_jour + 900) returning id into v_q;
  perform public.habilitations_actions_generer();
  if exists (select 1 from public.team_actions where source_id = v_h and status = 'a_faire') then raise exception '4b. titre valide signalé'; end if;
  update public.hr_qualifications set suspended_at = now() where id = v_q;
  perform public.habilitations_actions_generer();
  if (select count(*) from public.team_actions where source_id = v_h and status = 'a_faire' and title like 'Titre à obtenir%') <> 1 then raise exception '4c. suspension non signalée'; end if;
  update public.hr_qualifications set suspended_at = null, archived_at = now() where id = v_q;
  perform public.habilitations_actions_generer();
  if (select count(*) from public.team_actions where source_id = v_h and status = 'a_faire') <> 1 then raise exception '4d. archivage du même titre recompté'; end if;

  -- 4g. Nouveau titre saisi puis archivé le même jour : c'est un nouveau manque (autre titre)
  -- (une seule transaction : même heure partout ; le premier titre est remis archivé une heure plus tôt)
  update public.hr_qualifications set archived_at = now() - interval '1 hour', created_at = now() - interval '2 hours' where id = v_q;
  update public.team_actions set status = 'fait' where source_id = v_h;
  insert into public.hr_qualifications (company_id, person_id, kind, label, symbols, expires_on)
    values (v_cie, v_h, 'habilitation_electrique', 'Habilitation', array['BR'], v_jour + 900) returning id into v_q;
  perform public.habilitations_actions_generer();
  update public.hr_qualifications set archived_at = now() where id = v_q;
  perform public.habilitations_actions_generer();
  if (select count(*) from public.team_actions where source_id = v_h and status = 'a_faire') <> 1 then raise exception '4g. second titre archivé non signalé'; end if;

  -- 4e. Titre échu dont l'action de renouvellement (préparée avant la fin) est encore à faire : pas d'action « à obtenir »
  -- en plus ; une fois l'action faite, le manque est signalé
  insert into public.hr_people (company_id, first_name, last_name) values (v_cie, 'Inès', 'India') returning id into v_i;
  insert into public.hr_employments (company_id, person_id, start_on, job_id) values (v_cie, v_i, v_jour - 5, v_j);
  insert into public.hr_qualifications (company_id, person_id, kind, label, expires_on) values (v_cie, v_i, 'sst', 'SST', v_jour + 900);
  insert into public.hr_qualifications (company_id, person_id, kind, label, symbols, expires_on)
    values (v_cie, v_i, 'habilitation_electrique', 'Habilitation', array['BR'], v_jour - 1);
  insert into public.team_actions (company_id, title, source, source_id, due_on, dedup_key)
    select v_cie, 'Titre à renouveler : INDIA Inès', 'habilitation', v_i, v_jour - 1, 'hab:' || v_i || ':' || v_he || ':' || e.regle || ':fin:' || (v_jour - 1)::text
    from app.habilitations_ecarts(v_cie, v_jour) e where e.person_id = v_i and e.requirement_id = v_he;
  perform public.habilitations_actions_generer();
  if (select count(*) from public.team_actions where source_id = v_i) <> 1 then raise exception '4e. seconde action pour la même fin'; end if;
  update public.team_actions set status = 'fait' where source_id = v_i;
  perform public.habilitations_actions_generer();
  if (select count(*) from public.team_actions where source_id = v_i and status = 'a_faire' and title like 'Titre à obtenir%') <> 1 then raise exception '4f. manque après l''action faite'; end if;

  -- 4h. Exigence modifiée sur place : libellé seul, rien de nouveau ; type ou symboles changés, nouvelle action
  insert into public.hr_people (company_id, first_name, last_name) values (v_cie, 'Karim', 'Kilo') returning id into v_k;
  insert into public.hr_employments (company_id, person_id, start_on, job_id) values (v_cie, v_k, v_jour - 5, v_j);
  perform public.habilitations_actions_generer();
  update public.team_actions set status = 'abandonne' where source = 'habilitation' and status = 'a_faire';
  update public.hr_job_requirements set label = 'Habilitation électrique (BS ou BR)' where id = v_he;
  perform public.habilitations_actions_generer();
  if exists (select 1 from public.team_actions where source = 'habilitation' and status = 'a_faire') then raise exception '4h. libellé changé : actions recréées'; end if;
  update public.hr_job_requirements set required_symbols = array['B2V'] where id = v_he;
  perform public.habilitations_actions_generer();
  if not exists (select 1 from public.team_actions where source_id = v_b and status = 'a_faire' and title like 'Titre à obtenir%') then raise exception '4i. symboles resserrés : manque non signalé'; end if;
  -- Aucun titre, manque déjà traité : la règle changée le signale de nouveau
  if (select count(*) from public.team_actions where source_id = v_k and status = 'a_faire') <> 1 then raise exception '4j. règle changée, manque déjà traité non signalé'; end if;
  update public.hr_job_requirements set required_symbols = array['BR', 'BS'], label = 'Habilitation électrique BS ou BR' where id = v_he;

  -- 5. Module RH coupé : rien
  update public.company_modules set enabled = false where company_id = v_cie and key = 'rh';
  update public.hr_qualifications set expires_on = v_jour + 85 where person_id = v_b and kind = 'habilitation_electrique';
  perform public.habilitations_actions_generer();
  if exists (select 1 from public.team_actions where source = 'habilitation' and source_id = v_b and due_on = v_jour + 85) then raise exception '5. module coupé'; end if;

  -- 6. Un compte ne crée pas d'action « habilitation » ni de clé ; la clé ne change pas
  perform set_config('request.jwt.claims', json_build_object('sub', v_moi, 'role', 'authenticated')::text, true);
  begin
    insert into public.team_actions (company_id, title, source) values (v_cie, 'Essai', 'habilitation');
    raise exception '6. action habilitation créée par un compte';
  exception when insufficient_privilege then null;
  end;
  insert into public.team_actions (company_id, title, dedup_key) values (v_cie, 'Essai 0513', 'hab:x') returning id into v_id;
  if (select dedup_key from public.team_actions where id = v_id) is not null then raise exception '6b. clé posée par un compte'; end if;
  update public.team_actions set dedup_key = 'autre', source = 'manuel', status = 'abandonne' where source = 'habilitation' and source_id = v_b;
  if exists (select 1 from public.team_actions where source_id = v_b and (dedup_key not like 'hab:%' or source <> 'habilitation')) then raise exception '6c. clé ou source changée'; end if;
  begin
    delete from public.team_actions where source_id = v_i;
    raise exception '6e. action préparée supprimée par un compte';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.habilitations_actions_generer();
    raise exception '6d. préparation lancée par un compte';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', '', true);

  -- 7. Poste d'une autre société refusé sur un contrat
  insert into public.companies (legal_name) values ('Société essai 0513') returning id into v_id;
  insert into public.hr_people (company_id, first_name, last_name) values (v_id, 'Gaël', 'Golf') returning id into v_c;
  insert into public.hr_employments (company_id, person_id, start_on) values (v_id, v_c, v_jour);
  begin
    insert into public.hr_employments (company_id, person_id, start_on, job_id) values (v_id, v_c, v_jour, v_j);
    raise exception '7. poste d''une autre société accepté';
  exception when check_violation then null;
  end;

  -- 8. Droits
  if has_function_privilege('authenticated', 'public.habilitations_actions_generer()', 'execute')
     or has_function_privilege('anon', 'public.habilitations_actions_generer()', 'execute')
     or has_function_privilege('authenticated', 'app.habilitations_ecarts(uuid, date)', 'execute') then
    raise exception '8. fonction ouverte'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.hr_jobs'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.hr_job_requirements'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.hr_settings'::regclass) then
    raise exception '8b. règles absentes'; end if;
end
$$;

rollback;
