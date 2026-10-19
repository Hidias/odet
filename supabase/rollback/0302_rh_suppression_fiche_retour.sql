-- Retour arrière de 0302_rh_suppression_fiche.sql : remet les gardes de 0290, 0297 et 0301 telles quelles. Idempotent.

create or replace function app.hr_meme_societe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'hr_employments' then
    if not exists (select 1 from public.hr_people p where p.id = new.person_id and p.company_id = new.company_id) then
      raise exception 'Contrat : la personne appartient à une autre société' using errcode = '23514';
    end if;
  elsif tg_table_name = 'hr_compensation' then
    if not exists (select 1 from public.hr_employments e where e.id = new.employment_id and e.company_id = new.company_id) then
      raise exception 'Rémunération : le contrat appartient à une autre société' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;
revoke all on function app.hr_meme_societe() from public, anon, authenticated;

create or replace function app.hr_ligne_garde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.hr_time_entries := coalesce(new, old);
begin
  if tg_op <> 'DELETE' and not exists (select 1 from public.hr_people p where p.id = new.person_id and p.company_id = new.company_id) then
    raise exception 'Heures : la personne appartient à une autre société' using errcode = '23514';
  end if;
  if exists (select 1 from public.hr_timesheets s
             where s.person_id = v_row.person_id and s.status in ('soumise', 'validee')
               and s.week_start = (date_trunc('week', v_row.work_date))::date)
     or (tg_op = 'UPDATE' and exists (select 1 from public.hr_timesheets s
             where s.person_id = old.person_id and s.status in ('soumise', 'validee')
               and s.week_start = (date_trunc('week', old.work_date))::date)) then
    raise exception 'Semaine soumise ou validée : les heures ne se modifient plus' using errcode = '23514';
  end if;
  return coalesce(new, old);
end
$$;
revoke all on function app.hr_ligne_garde() from public, anon, authenticated;

create or replace function app.hr_ds_garde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.hr_documents;
begin
  if not exists (select 1 from public.hr_people p where p.id = new.person_id and p.company_id = new.company_id) then
    raise exception 'RH : la personne appartient à une autre société' using errcode = '23514';
  end if;
  if tg_table_name = 'hr_documents' then
    if new.employment_id is not null and not exists (select 1 from public.hr_employments e where e.id = new.employment_id and e.person_id = new.person_id) then
      raise exception 'Document : le contrat est celui d''une autre personne' using errcode = '23514';
    end if;
    if split_part(new.file_path, '/', 1) <> new.company_id::text or split_part(new.file_path, '/', 2) <> new.person_id::text then
      raise exception 'Document : le fichier n''est pas rangé dans le dossier de la personne' using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' and new.file_path <> old.file_path then
      raise exception 'Document : le fichier ne se remplace pas (déposez un nouveau document)' using errcode = '23514';
    end if;
  else
    if new.document_id is not null then
      select * into v_doc from public.hr_documents d where d.id = new.document_id;
      if v_doc.person_id is distinct from new.person_id then
        raise exception 'Le document joint est celui d''une autre personne' using errcode = '23514';
      end if;
      if tg_table_name = 'hr_medical_followups' and v_doc.confidentiality = 'normal' then
        raise exception 'Santé au travail : le document joint doit être restreint' using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end
$$;
revoke all on function app.hr_ds_garde() from public, anon, authenticated;

delete from public.schema_migrations where version = '0302_rh_suppression_fiche';
