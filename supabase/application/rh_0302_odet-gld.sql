-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (rh_0302) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur odet-gld : 0302_rh_suppression_fiche.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0302_rh_suppression_fiche_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0302_rh_suppression_fiche.sql =====
-- 0302_rh_suppression_fiche.sql : chantier 12, module RH, suppression d'une fiche du personnel (constat du 19/10 en
-- recette : supprimer deux fiches dont l'une est responsable de l'autre était refusé).
--
-- Les gardes des tables RH vérifiaient la société de la personne à chaque modification, y compris celles que la base
-- fait seule pendant une suppression en cascade (responsable remis à vide, document joint remis à vide) : la
-- personne déjà supprimée faisait échouer la vérification. De même, les heures d'une semaine soumise ou validée
-- refusaient d'être supprimées avec leur fiche.
-- Désormais :
--   - contrat, rémunération, document, habilitation, suivi de santé : la société de la personne est vérifiée à la
--     création et quand la personne, le contrat ou la société change, plus lors des autres modifications ;
--   - document joint : vérifié quand il change, et seulement s'il n'est pas vide ;
--   - heures : une ligne d'une semaine soumise ou validée reste figée, sauf quand sa fiche est supprimée.
-- Aucune autre règle ne change. Migration additive (fonctions remplacées). Idempotente.
-- Retour arrière : supabase/rollback/0302_rh_suppression_fiche_retour.sql

create or replace function app.hr_meme_societe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'hr_employments' then
    if (tg_op = 'INSERT' or new.person_id is distinct from old.person_id or new.company_id is distinct from old.company_id)
       and not exists (select 1 from public.hr_people p where p.id = new.person_id and p.company_id = new.company_id) then
      raise exception 'Contrat : la personne appartient à une autre société' using errcode = '23514';
    end if;
  elsif tg_table_name = 'hr_compensation' then
    if (tg_op = 'INSERT' or new.employment_id is distinct from old.employment_id or new.company_id is distinct from old.company_id)
       and not exists (select 1 from public.hr_employments e where e.id = new.employment_id and e.company_id = new.company_id) then
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
  -- Suppression de la fiche : ses heures partent avec elle, même figées
  if tg_op = 'DELETE' and not exists (select 1 from public.hr_people p where p.id = old.person_id) then
    return old;
  end if;
  if tg_op <> 'DELETE' and (tg_op = 'INSERT' or new.person_id is distinct from old.person_id or new.company_id is distinct from old.company_id)
     and not exists (select 1 from public.hr_people p where p.id = new.person_id and p.company_id = new.company_id) then
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
  if (tg_op = 'INSERT' or new.person_id is distinct from old.person_id or new.company_id is distinct from old.company_id)
     and not exists (select 1 from public.hr_people p where p.id = new.person_id and p.company_id = new.company_id) then
    raise exception 'RH : la personne appartient à une autre société' using errcode = '23514';
  end if;
  if tg_table_name = 'hr_documents' then
    if new.employment_id is not null and (tg_op = 'INSERT' or new.employment_id is distinct from old.employment_id or new.person_id is distinct from old.person_id)
       and not exists (select 1 from public.hr_employments e where e.id = new.employment_id and e.person_id = new.person_id) then
      raise exception 'Document : le contrat est celui d''une autre personne' using errcode = '23514';
    end if;
    if split_part(new.file_path, '/', 1) <> new.company_id::text or split_part(new.file_path, '/', 2) <> new.person_id::text then
      raise exception 'Document : le fichier n''est pas rangé dans le dossier de la personne' using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' and new.file_path <> old.file_path then
      raise exception 'Document : le fichier ne se remplace pas (déposez un nouveau document)' using errcode = '23514';
    end if;
  else
    if new.document_id is not null and (tg_op = 'INSERT' or new.document_id is distinct from old.document_id or new.person_id is distinct from old.person_id) then
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

insert into public.schema_migrations (version) values ('0302_rh_suppression_fiche') on conflict (version) do nothing;
