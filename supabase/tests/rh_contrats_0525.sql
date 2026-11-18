-- Essai de 0525 : contrats de travail et avenants.
-- Rouge sans 0525 (tables et colonnes absentes). Données d'essai créées ici (une société existante seulement), tout est annulé.
begin;
set local client_min_messages = warning;

do $$
declare
  v_cie uuid; v_p uuid; v_q uuid; v_e uuid; v_e2 uuid; v_d uuid; v_dq uuid; v_a uuid; v_m uuid; v_n int; v_jour date; v_lab text;
begin
  select id into v_cie from public.companies order by created_at limit 1;
  insert into public.hr_people (company_id, first_name, last_name) values (v_cie, 'Essai', 'CONTRAT 0525') returning id into v_p;
  insert into public.hr_people (company_id, first_name, last_name) values (v_cie, 'Essai', 'AUTRE 0525') returning id into v_q;

  -- 1. Modèles de départ : trois types en « projet » ; validation sans validateur refusée ; validé, texte figé
  select count(*) into v_n from public.hr_contract_models where company_id = v_cie and version = 1 and status = 'projet' and kind in ('cdi', 'cdd', 'avenant');
  if v_n <> 3 then raise exception 'Essai 0525 : 3 modèles de départ attendus (% trouvés)', v_n; end if;
  perform app.hr_modeles_contrat_depart(v_cie);
  select count(*) into v_n from public.hr_contract_models where company_id = v_cie;
  if v_n <> 3 then raise exception 'Essai 0525 : modèles de départ posés deux fois (%)', v_n; end if;
  select id into v_m from public.hr_contract_models where company_id = v_cie and kind = 'cdi';
  begin
    update public.hr_contract_models set status = 'valide' where id = v_m;
    raise exception 'Essai 0525 : validation sans date ni validateur acceptée';
  exception when check_violation then null;
  end;
  update public.hr_contract_models set status = 'valide', validated_on = current_date, validated_by_name = 'Avocat essai' where id = v_m;
  begin
    update public.hr_contract_models set articles = '[{"titre":"x","texte":"y"}]' where id = v_m;
    raise exception 'Essai 0525 : texte d''un modèle validé modifié';
  exception when invalid_parameter_value then null;
  end;
  begin
    update public.hr_contract_models set status = 'projet', validated_on = null, validated_by_name = null where id = v_m;
    raise exception 'Essai 0525 : modèle validé repassé en projet';
  exception when invalid_parameter_value then null;
  end;
  begin
    delete from public.hr_contract_models where id = v_m;
    raise exception 'Essai 0525 : modèle validé supprimé';
  exception when invalid_parameter_value then null;
  end;
  update public.hr_contract_models set note = 'note modifiable' where id = v_m;
  -- Un modèle naît « projet », même inséré « validé »
  insert into public.hr_contract_models (company_id, kind, version, title, articles, status, validated_on, validated_by_name)
    values (v_cie, 'cdi', 2, 'Essai v2', '[{"titre":"x","texte":"y"}]', 'valide', current_date, 'X') returning id into v_m;
  if (select status from public.hr_contract_models where id = v_m) <> 'projet' then raise exception 'Essai 0525 : modèle inséré directement validé'; end if;

  -- 2. Motif de CDD : seulement sur un CDD ; sans terme précis refusé pour un accroissement
  begin
    insert into public.hr_employments (company_id, person_id, contract_type, start_on, cdd_reason) values (v_cie, v_p, 'cdi', current_date, 'accroissement');
    raise exception 'Essai 0525 : motif de CDD accepté sur un CDI';
  exception when check_violation then null;
  end;
  begin
    insert into public.hr_employments (company_id, person_id, contract_type, start_on, cdd_reason, cdd_min_end_on)
      values (v_cie, v_p, 'cdd', current_date, 'accroissement', current_date + 30);
    raise exception 'Essai 0525 : CDD sans terme précis accepté pour un accroissement';
  exception when check_violation then null;
  end;
  begin
    insert into public.hr_employments (company_id, person_id, contract_type, start_on, cdd_reason, cdd_min_end_on)
      values (v_cie, v_p, 'cdd', current_date, 'remplacement_temps_partiel', current_date + 30);
    raise exception 'Essai 0525 : CDD sans terme précis accepté pour un passage à temps partiel (hors L1242-7)';
  exception when check_violation then null;
  end;
  begin
    insert into public.hr_employments (company_id, person_id, contract_type, start_on, cdd_min_end_on) values (v_cie, v_p, 'cdd', current_date, current_date + 30);
    raise exception 'Essai 0525 : CDD sans terme précis accepté sans motif';
  exception when check_violation then null;
  end;
  begin
    insert into public.hr_employments (company_id, person_id, contract_type, start_on, cdd_reason) values (v_cie, v_p, 'cdd', current_date, 'inconnu');
    raise exception 'Essai 0525 : motif de CDD inconnu accepté';
  exception when check_violation then null;
  end;

  -- 3. Jours ouvrables : dimanche et jour férié chômé exclus, samedi compté
  v_jour := date_trunc('week', current_date + 14)::date + 4;  -- un vendredi
  insert into public.hr_public_holidays (company_id, day, label, is_worked) values (v_cie, v_jour + 3, 'Férié essai 0525', false)
    on conflict (company_id, day) do update set is_worked = false;
  if app.hr_jour_ouvrable_apres(v_cie, v_jour, 2) <> v_jour + 4 then
    raise exception 'Essai 0525 : 2 jours ouvrables après un vendredi suivi d''un lundi férié : % attendu, % obtenu', v_jour + 4, app.hr_jour_ouvrable_apres(v_cie, v_jour, 2);
  end if;
  if app.hr_jour_ouvrable_apres(v_cie, v_jour, 1) <> v_jour + 1 then raise exception 'Essai 0525 : le samedi n''est pas compté comme ouvrable'; end if;

  -- 4. Échéance « contrat à remettre » : CDD sous 2 jours ouvrables, CDI sous 7 jours ; levée une fois remis
  insert into public.hr_employments (company_id, person_id, contract_type, start_on, end_on, cdd_reason)
    values (v_cie, v_p, 'cdd', v_jour, v_jour + 60, 'accroissement') returning id into v_e;
  select count(*) into v_n from public.v_hr_echeances where kind = 'contrat_remis' and source_id = v_e and due_on = v_jour + 4;
  if v_n <> 1 then raise exception 'Essai 0525 : échéance du CDD attendue au % (% trouvée)', v_jour + 4, v_n; end if;
  insert into public.hr_employments (company_id, person_id, contract_type, start_on)
    values (v_cie, v_q, 'cdi', current_date - 2) returning id into v_e2;
  select count(*) into v_n from public.v_hr_echeances where kind = 'contrat_remis' and source_id = v_e2 and due_on = current_date + 5;
  if v_n <> 1 then raise exception 'Essai 0525 : échéance du CDI attendue à début + 7 jours (% trouvée)', v_n; end if;
  update public.hr_employments set contract_handed_on = current_date where id = v_e2;
  if exists (select 1 from public.v_hr_echeances where kind = 'contrat_remis' and source_id = v_e2) then
    raise exception 'Essai 0525 : échéance encore là après la remise';
  end if;

  -- 5. Contrat signé : document de la personne seulement ; déposé, la ligne de la liste d'arrivée se coche
  insert into public.hr_documents (company_id, person_id, employment_id, category, confidentiality, title, file_path)
    values (v_cie, v_p, v_e, 'contrat', 'restreint', 'Contrat signé essai', v_cie || '/' || v_p || '/essai-0525.pdf') returning id into v_d;
  insert into public.hr_documents (company_id, person_id, category, confidentiality, title, file_path)
    values (v_cie, v_q, 'contrat', 'restreint', 'Autre contrat essai', v_cie || '/' || v_q || '/essai-0525-q.pdf') returning id into v_dq;
  begin
    update public.hr_employments set signed_document_id = v_dq where id = v_e;
    raise exception 'Essai 0525 : document d''une autre personne accepté comme contrat signé';
  exception when invalid_parameter_value then null;
  end;
  insert into public.hr_checklists (company_id, person_id, kind, items)
    values (v_cie, v_p, 'arrivee', '[{"label":"Contrat signé et rangé dans les documents","done_on":null,"done_by":null},{"label":"Accueil sécurité fait","done_on":null,"done_by":null}]');
  update public.hr_employments set signed_document_id = v_d where id = v_e;
  select x->>'done_on' into v_lab from public.hr_checklists l, jsonb_array_elements(l.items) x
   where l.person_id = v_p and l.kind = 'arrivee' and x->>'label' = 'Contrat signé et rangé dans les documents';
  if v_lab is null then raise exception 'Essai 0525 : ligne « Contrat signé » non cochée'; end if;
  select x->>'done_on' into v_lab from public.hr_checklists l, jsonb_array_elements(l.items) x
   where l.person_id = v_p and l.kind = 'arrivee' and x->>'label' = 'Accueil sécurité fait';
  if v_lab is not null then raise exception 'Essai 0525 : une autre ligne de la liste a été cochée'; end if;
  -- Document supprimé : le contrat reste, sans document signé
  delete from public.hr_documents where id = v_d;
  if (select signed_document_id from public.hr_employments where id = v_e) is not null then raise exception 'Essai 0525 : lien au document supprimé resté'; end if;

  -- 6. Avenant : société et personne reprises du contrat ; ligne sans nouvelle valeur refusée ; signé, figé
  begin
    insert into public.hr_contract_amendments (employment_id, effective_on, subject, changes)
      values (v_e, current_date, 'Essai', '[{"label":"Horaire","before":"35 h","after":""}]');
    raise exception 'Essai 0525 : modification sans nouvelle valeur acceptée';
  exception when invalid_parameter_value then null;
  end;
  insert into public.hr_contract_amendments (company_id, employment_id, effective_on, subject, changes)
    values (v_cie, v_e, current_date, 'Changement d''horaire', '[{"label":"Durée du travail","before":"35 h","after":"39 h"}]') returning id into v_a;
  if (select person_id from public.hr_contract_amendments where id = v_a) <> v_p then raise exception 'Essai 0525 : personne non reprise du contrat'; end if;
  begin
    update public.hr_contract_amendments set signed_document_id = v_dq where id = v_a;
    raise exception 'Essai 0525 : document d''une autre personne accepté sur l''avenant';
  exception when invalid_parameter_value then null;
  end;
  insert into public.hr_documents (company_id, person_id, employment_id, category, confidentiality, title, file_path)
    values (v_cie, v_p, v_e, 'avenant', 'restreint', 'Avenant signé essai', v_cie || '/' || v_p || '/essai-0525-a.pdf') returning id into v_d;
  update public.hr_contract_amendments set signed_document_id = v_d, handed_on = current_date where id = v_a;
  begin
    update public.hr_contract_amendments set subject = 'Autre objet' where id = v_a;
    raise exception 'Essai 0525 : avenant signé modifié';
  exception when invalid_parameter_value then null;
  end;
  begin
    update public.hr_contract_amendments set signed_document_id = null where id = v_a;
    raise exception 'Essai 0525 : signature d''un avenant retirée';
  exception when invalid_parameter_value then null;
  end;
  begin
    delete from public.hr_contract_amendments where id = v_a;
    raise exception 'Essai 0525 : avenant signé supprimé';
  exception when invalid_parameter_value then null;
  end;
  begin
    delete from public.hr_documents where id = v_d;
    raise exception 'Essai 0525 : document signé d''un avenant supprimé';
  exception when foreign_key_violation then null;
  end;
  if not public.hr_document_protege(v_d) is not null then raise exception 'Essai 0525 : protection du document signé illisible'; end if;
  if app.hr_fichier_supprimable((select file_path from public.hr_documents where id = v_d)) then
    raise exception 'Essai 0525 : scan signé d''un avenant effaçable du stockage';
  end if;

  -- 7. Document généré : traçabilité contrôlée
  begin
    update public.hr_documents set generated_from = 'cdi1projet' where id = v_d;
    raise exception 'Essai 0525 : origine de document mal formée acceptée';
  exception when check_violation then null;
  end;
  update public.hr_documents set generated_from = 'avenant@1:projet', content_sha256 = repeat('a', 64) where id = v_d;

  -- Contrat supprimé : ses avenants partent avec lui, même signés
  delete from public.hr_employments where id = v_e;
  if exists (select 1 from public.hr_contract_amendments where id = v_a) then raise exception 'Essai 0525 : avenant resté après la suppression du contrat'; end if;

  -- 10. Contrat et avenant jamais « normal » ; scan signé d'avenant jamais effaçable du stockage
  begin
    insert into public.hr_documents (company_id, person_id, category, confidentiality, title, file_path)
      values (v_cie, v_p, 'contrat', 'normal', 'Contrat normal essai', v_cie || '/' || v_p || '/essai-0525-n.pdf');
    raise exception 'Essai 0525 : contrat rangé en « normal » accepté';
  exception when check_violation then null;
  end;

  -- 9. Droit « Voir les contrats de travail » : RH, Super administrateur, Direction ; pas l'administrateur
  select count(distinct p.key) into v_n from public.permission_profile_rights r join public.permission_profiles p on p.id = r.profile_id
   where r.right_code = 'rh.contrats.voir' and p.company_id is null and p.key in ('rh', 'superadmin', 'direction');
  if v_n <> 3 then raise exception 'Essai 0525 : droit des contrats attendu sur 3 modèles de profil (%)', v_n; end if;
  if exists (select 1 from public.permission_profile_rights r join public.permission_profiles p on p.id = r.profile_id
             where r.right_code = 'rh.contrats.voir' and p.key = 'admin') then
    raise exception 'Essai 0525 : droit des contrats donné à l''administrateur';
  end if;
  -- Primes et accessoires gardés avec la rémunération
  insert into public.hr_employments (company_id, person_id, contract_type, start_on) values (v_cie, v_q, 'cdi', current_date - 400) returning id into v_e2;
  insert into public.hr_compensation (company_id, employment_id, amount, period, effective_on, components)
    values (v_cie, v_e2, 2000, 'mensuel', current_date - 400, 'néant');

  -- 8. Poser les modèles : droit « Configurer les RH » exigé
  begin
    perform public.hr_modeles_contrat_poser(v_cie);
    raise exception 'Essai 0525 : modèles posés sans droit';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
