-- supabase/rollback/0080-0087_securite_retour.sql : retour arrière des migrations 0080 à 0087 (chantier 2).
-- Les huit migrations sont appliquées ensemble ; ce script les annule ensemble.
-- Il remet exactement l'état photographié par 0080 dans app.etat_avant_chantier2 :
--   règles d'accès (tables et Storage), définitions et droits d'exécution des fonctions, droits des
--   rôles anon et authenticated sur les tables, buckets, vues, contrainte des rôles de profiles.
-- Les numéros de sécurité sociale rangés dans trainee_ssn sont remis dans trainees et
-- trainee_info_sheets avant la suppression de la table.
-- Les index ajoutés par 0081 sont gardés (sans effet sur les droits).
-- À exécuter dans l'éditeur SQL de Supabase, en une fois. Il s'arrête sans rien changer si la
-- photographie est absente.

do $$
declare
  r record;
  v_cnt int;
begin
  if to_regclass('app.etat_avant_chantier2') is null then
    raise exception 'Photographie app.etat_avant_chantier2 absente : retour arrière impossible par ce script';
  end if;
  select count(*) into v_cnt from app.etat_avant_chantier2 where kind = 'policy';
  if v_cnt = 0 then
    raise exception 'Photographie vide : retour arrière impossible par ce script';
  end if;

  -- 1. Numéros de sécurité sociale : retour dans les colonnes d'origine ---------------------------------
  drop trigger if exists a_trainee_ssn_capture on public.trainees;
  drop trigger if exists a_info_sheet_ssn_capture on public.trainee_info_sheets;
  if to_regclass('public.trainee_ssn') is not null then
    update public.trainees t set social_security_number = s.ssn from public.trainee_ssn s where s.trainee_id = t.id;
    update public.trainee_info_sheets i set ssn = s.ssn from public.trainee_ssn s where s.trainee_id = i.trainee_id;
  end if;

  -- 1 bis. Handicap (0087) : retour dans les colonnes d'origine
  drop trigger if exists a_trainee_disability_capture on public.trainees;
  if to_regclass('public.trainee_disability') is not null then
    update public.trainees t set has_disability = d.has_disability, disability_details = d.details,
           disability_adaptations = d.adaptations
    from public.trainee_disability d where d.trainee_id = t.id;
  end if;

  -- 2. Règles d'accès des tables et du Storage ---------------------------------------------------------
  for r in select schemaname, tablename, policyname from pg_policies where schemaname in ('public', 'storage') loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
  for r in select definition from app.etat_avant_chantier2 where kind = 'policy' order by id loop
    execute r.definition;
  end loop;
  for r in select name, definition from app.etat_avant_chantier2 where kind = 'bucket' loop
    update storage.buckets set public = r.definition::boolean where id = r.name;
  end loop;

  -- 3. Fonctions : celles ajoutées par le chantier disparaissent, les autres reprennent leur définition
  drop function if exists public.portal_documents(text);
  drop function if exists public.portal_log_download(text, uuid, uuid);
  drop function if exists public.public_reclamation_session(text);
  drop function if exists public.public_reclamation_submit(uuid, text, text, text, text, text);
  drop function if exists public.trainee_ssn_capture();
  drop function if exists public.trainee_disability_capture();
  drop function if exists public.can_see_disability();
  drop function if exists public.disability_count(uuid[]);
  drop function if exists public.psh_request_count();
  drop function if exists public.info_sheet_ssn_capture();
  drop function if exists public.load_trainee_data(text, uuid, text);
  drop function if exists public.update_trainee_data(text, uuid, jsonb, text);
  drop function if exists public.save_trainee_info(text, uuid, jsonb, text);
  for r in select name, definition from app.etat_avant_chantier2 where kind = 'function' order by id loop
    if to_regprocedure(r.name) is null or pg_get_functiondef(to_regprocedure(r.name)) is distinct from r.definition then
      execute r.definition;
    end if;
  end loop;
  for r in select name, definition from app.etat_avant_chantier2 where kind = 'function_acl' loop
    execute format('revoke execute on function %s from public, anon, authenticated, service_role', r.name);
    if r.definition <> '' then
      execute format('grant execute on function %s to %s', r.name, r.definition);
    end if;
  end loop;

  -- 4. Droits sur les tables --------------------------------------------------------------------------
  for r in select split_part(name, '|', 1) as tbl, split_part(name, '|', 2) as grantee, definition
           from app.etat_avant_chantier2 where kind = 'table_acl' loop
    if to_regclass('public.' || quote_ident(r.tbl)) is not null then
      execute format('grant %s on table public.%I to %I', replace(r.definition, ',', ', '), r.tbl, r.grantee);
    end if;
  end loop;
  alter default privileges for role postgres in schema public grant all on tables to anon, authenticated;

  -- 5. Vues --------------------------------------------------------------------------------------------
  drop view if exists public.trainees_safe;
  drop view if exists public.v_trainee_session_complete;
  for r in select name, definition from app.etat_avant_chantier2 where kind = 'view' loop
    execute format('create view public.%I with (security_invoker = true) as %s', r.name, r.definition);
    execute format('revoke all on public.%I from anon', r.name);
  end loop;

  -- 6. Colonnes et tables ajoutées --------------------------------------------------------------------
  drop table if exists public.trainee_ssn;
  drop table if exists public.trainee_disability;
  alter table public.trainees drop column if exists ssn_present;
  alter table public.trainee_info_sheets drop column if exists ssn_present;
  alter table public.session_trainees drop column if exists portal_ticket;
  alter table public.session_trainees drop column if exists portal_ticket_expires_at;

  -- 7. Contrainte des rôles ---------------------------------------------------------------------------
  select definition into strict r from app.etat_avant_chantier2 where kind = 'profiles_role_check';
  alter table public.profiles drop constraint if exists profiles_role_check;
  execute 'alter table public.profiles add constraint profiles_role_check ' || r.definition;
end $$;

-- 8. Schéma app et suivi des migrations ------------------------------------------------------------
drop schema if exists app cascade;
delete from public.schema_migrations where version in (
  '0080_securite_urgences', '0081_securite_fonctions_aide', '0082_securite_regles', '0083_securite_numero_secu',
  '0084_securite_portails', '0085_securite_fonctions', '0086_securite_stockage', '0087_securite_handicap');
