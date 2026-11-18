-- Essai de 0521 : suivi de la DPAE (colonnes, catégorie de document, échéance de la vue).
-- Rouge sans 0521 (colonnes absentes). Données d'essai créées ici (une société existante seulement), tout est annulé.
begin;
set local client_min_messages = warning;

do $$
declare
  v_cie uuid; v_p uuid; v_cdi uuid; v_cdd uuid; v_stage uuid; v_vieux uuid; v_interim uuid; v_n int; v_kind text;
begin
  select id into v_cie from public.companies order by created_at limit 1;
  insert into public.hr_people (company_id, first_name, last_name) values (v_cie, 'Essai', 'DPAE 0521') returning id into v_p;

  insert into public.hr_employments (company_id, person_id, contract_type, start_on)
    values (v_cie, v_p, 'cdi', current_date + 5) returning id into v_cdi;
  insert into public.hr_employments (company_id, person_id, contract_type, start_on, end_on)
    values (v_cie, v_p, 'cdd', current_date - 10, current_date + 60) returning id into v_cdd;
  insert into public.hr_employments (company_id, person_id, contract_type, start_on)
    values (v_cie, v_p, 'stage', current_date + 2) returning id into v_stage;
  insert into public.hr_employments (company_id, person_id, contract_type, start_on)
    values (v_cie, v_p, 'interim', current_date + 2) returning id into v_interim;
  insert into public.hr_employments (company_id, person_id, contract_type, start_on)
    values (v_cie, v_p, 'cdi', current_date - 40) returning id into v_vieux;

  -- 1. Échéance DPAE : CDI à venir et CDD commencé depuis moins de 30 jours ; ni stage, ni intérim, ni contrat ancien
  select count(*) into v_n from public.v_hr_echeances where kind = 'dpae' and person_id = v_p;
  if v_n <> 2 then raise exception 'Essai 0521 : 2 échéances DPAE attendues, % trouvées', v_n; end if;
  if exists (select 1 from public.v_hr_echeances where kind = 'dpae' and source_id in (v_stage, v_interim, v_vieux)) then
    raise exception 'Essai 0521 : échéance DPAE pour un stage, un intérim ou un contrat ancien';
  end if;
  if (select due_on from public.v_hr_echeances where kind = 'dpae' and source_id = v_cdi) <> current_date + 5 then
    raise exception 'Essai 0521 : l''échéance DPAE doit tomber à la date de début du contrat';
  end if;
  select label into v_kind from public.v_hr_echeances where kind = 'dpae' and source_id = v_cdi;
  if v_kind <> 'Déclaration préalable à l''embauche (DPAE)' then raise exception 'Essai 0521 : libellé inattendu (%)', v_kind; end if;

  -- 2. DPAE notée : l'échéance disparaît, les autres échéances du contrat restent
  update public.hr_employments set dpae_sent_on = current_date, dpae_reference = 'AR-ESSAI-0521' where id = v_cdd;
  if exists (select 1 from public.v_hr_echeances where kind = 'dpae' and source_id = v_cdd) then
    raise exception 'Essai 0521 : échéance DPAE encore là après l''envoi';
  end if;
  if not exists (select 1 from public.v_hr_echeances where kind = 'fin_contrat' and source_id = v_cdd) then
    raise exception 'Essai 0521 : la fin de CDD a disparu des échéances';
  end if;

  -- 3. Référence de l'accusé limitée à 60 caractères
  begin
    update public.hr_employments set dpae_reference = repeat('x', 61) where id = v_cdi;
    raise exception 'Essai 0521 : référence de 61 caractères acceptée';
  exception when check_violation then null;
  end;

  -- 4. Catégorie « dpae » acceptée pour un document RH (restreint) ; jamais « normal » ; catégorie inconnue refusée
  insert into public.hr_documents (company_id, person_id, category, confidentiality, title, file_path)
    values (v_cie, v_p, 'dpae', 'restreint', 'Accusé DPAE essai 0521', v_cie || '/' || v_p || '/essai-0521.pdf');
  begin
    insert into public.hr_documents (company_id, person_id, category, confidentiality, title, file_path)
      values (v_cie, v_p, 'dpae', 'normal', 'Accusé DPAE essai 0521', v_cie || '/' || v_p || '/essai-0521-b.pdf');
    raise exception 'Essai 0521 : accusé DPAE accepté en confidentialité normale';
  exception when check_violation then null;
  end;
  begin
    insert into public.hr_documents (company_id, person_id, category, confidentiality, title, file_path)
      values (v_cie, v_p, 'inconnue', 'restreint', 'Essai 0521', v_cie || '/' || v_p || '/essai-0521-c.pdf');
    raise exception 'Essai 0521 : catégorie inconnue acceptée';
  exception when check_violation then null;
  end;
  begin
    insert into public.hr_documents (company_id, person_id, category, confidentiality, title, file_path)
      values (v_cie, v_p, 'sante', 'normal', 'Essai 0521', v_cie || '/' || v_p || '/essai-0521-d.pdf');
    raise exception 'Essai 0521 : document de santé accepté en confidentialité normale (contrainte de 0301 perdue)';
  exception when check_violation then null;
  end;

  -- 5. Aucun numéro de sécurité sociale stocké sur le contrat ni sur la fiche
  if exists (select 1 from information_schema.columns where table_schema = 'public'
             and table_name in ('hr_employments', 'hr_people') and (column_name ilike '%nir%' or column_name ilike '%ssn%' or column_name ilike '%secu%')) then
    raise exception 'Essai 0521 : colonne de numéro de sécurité sociale trouvée';
  end if;

  -- 6. La vue reste aux droits du lecteur
  if not exists (select 1 from pg_class where oid = 'public.v_hr_echeances'::regclass and reloptions @> array['security_invoker=true']) then
    raise exception 'Essai 0521 : la vue des échéances doit rester aux droits du lecteur';
  end if;
end $$;

rollback;
