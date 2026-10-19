-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (rh_0302) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0302_rh_suppression_fiche.sql, retour arrière,
-- comparaison. Se termine TOUJOURS par l'erreur volontaire « RÉSULTAT DE L'ESSAI DU RETOUR ARRIÈRE » : tout est annulé.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

create temp view etat_essai as
  select 'règle' as kind, schemaname || '.' || tablename || '.' || policyname as name,
         md5(concat_ws('|', permissive, roles::text, cmd, qual, with_check)) as v
  from pg_policies where schemaname in ('public', 'storage')
  union all
  select 'fonction', p.oid::regprocedure::text,
         md5(concat_ws('|', pg_get_functiondef(p.oid), p.prosecdef::text, p.proconfig::text,
             (select string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',' order by a.grantee::regrole::text, a.privilege_type)
              from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a)))
  from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace) and p.prokind in ('f', 'p')
  union all
  select 'droits table', c.oid::regclass::text,
         md5(coalesce((select string_agg(a.grantee::regrole::text || ':' || a.privilege_type || ':' || a.is_grantable::text, ','
                               order by a.grantee::regrole::text, a.privilege_type)
                       from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a), '') || c.relrowsecurity::text)
  from pg_class c where c.relnamespace in ('public'::regnamespace, 'app'::regnamespace) and c.relkind in ('r', 'v', 'm', 'p')
  union all
  select 'vue', c.oid::regclass::text, md5(pg_get_viewdef(c.oid) || coalesce(c.reloptions::text, ''))
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
  union all
  select 'colonne', table_schema || '.' || table_name || '.' || column_name, md5(data_type || is_nullable || coalesce(column_default, ''))
  from information_schema.columns where table_schema in ('public', 'app')
  union all
  select 'contrainte', conrelid::regclass::text || '.' || conname, md5(pg_get_constraintdef(oid))
  from pg_constraint where connamespace in ('public'::regnamespace, 'app'::regnamespace)
  union all
  select 'index', indexrelid::regclass::text, md5(pg_get_indexdef(indexrelid))
  from pg_index where indrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace, 'app'::regnamespace))
  union all
  select 'déclencheur', tgrelid::regclass::text || '.' || tgname, md5(tgfoid::regprocedure::text || tgenabled::text)
  from pg_trigger where not tgisinternal
    and tgrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace, 'app'::regnamespace))
  union all
  select 'migrations', 'public.schema_migrations', md5(coalesce(string_agg(version, ',' order by version), ''))
  from public.schema_migrations
  union all
  select 'données', 'organization_settings', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.organization_settings t
  union all
  select 'données', 'profiles', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.profiles t
  union all
  select 'données', 'org_modules', md5(coalesce(string_agg(t::text, ',' order by t.key), '')) from public.org_modules t
  union all
  select 'données', 'company_members', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.company_members t
  union all
  select 'données', 'company_member_roles', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.company_member_roles t;
create temp table etat_essai_avant as select * from etat_essai;

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

-- ===== supabase/rollback/0302_rh_suppression_fiche_retour.sql =====
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

do $verif$
declare
  v_diff text[];
  v_n int;
  v_par text;
begin
  select count(*), (array_agg(coalesce(a.kind, b.kind) || ' ' || coalesce(a.name, b.name) || case
           when a.name is null then ' (en trop après retour)' when b.name is null then ' (manquant après retour)'
           else ' (différent)' end order by coalesce(a.kind, b.kind) desc, coalesce(a.name, b.name)))[1:40]
    into v_n, v_diff
  from etat_essai_avant a full join etat_essai b on a.kind = b.kind and a.name = b.name
  where a.v is distinct from b.v;
  select string_agg(k || ' ' || n, ', ') into v_par from (
    select coalesce(a.kind, b.kind) k, count(*) n
    from etat_essai_avant a full join etat_essai b on a.kind = b.kind and a.name = b.name
    where a.v is distinct from b.v group by 1) z;
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE rh_0302 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
