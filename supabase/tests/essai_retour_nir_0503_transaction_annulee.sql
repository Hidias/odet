-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (nir_0503) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0503_nir_apres_refus.sql, retour arrière,
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

-- ===== supabase/migrations/0503_nir_apres_refus.sql =====
-- 0503 : numéro de sécurité sociale saisi sur la fiche de renseignements après un refus : il n'est plus perdu.
-- Défaut ancien relevé le 07/11 (V28). Une fiche d'abord refusée (« je ne donne pas mon numéro »), puis remplie avec
-- un numéro : info_sheet_ssn_capture rangeait le numéro dans trainee_ssn, puis passait le stagiaire à « numéro
-- présent » ; or le stagiaire portait encore le refus (levé seulement après, par sync_info_sheet_to_trainee) et son
-- déclencheur trainee_ssn_capture effaçait aussitôt le numéro. Résultat : la fiche disait « numéro indiqué » et
-- trainee_ssn était vide (rien pour le Passeport de prévention).
--   Correctif : info_sheet_ssn_capture ne touche plus le stagiaire quand un numéro est saisi alors qu'il porte encore
--   le refus ; c'est sync_info_sheet_to_trainee (après l'écriture de la fiche) qui lève le refus et marque « numéro
--   présent » dans la même mise à jour. Lever le refus dès le déclencheur d'avant échoue : le stagiaire recopie le
--   refus sur ses fiches, dont celle en cours d'écriture (« tuple already modified »).
--   Une ligne changée dans chacune des deux fonctions (corps de 0502 et de 0001 pour le reste).
-- Retour arrière : supabase/rollback/0503_nir_apres_refus_retour.sql (corps de 0502 et de 0001).

CREATE OR REPLACE FUNCTION public.info_sheet_ssn_capture()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ssn text := nullif(regexp_replace(coalesce(new.ssn, ''), '\s', '', 'g'), '');
begin
  if coalesce(new.ssn_refused, false) then
    delete from public.trainee_ssn where trainee_id = new.trainee_id;
    update public.trainees set ssn_present = false where id = new.trainee_id and ssn_present;
    new.ssn_present := false;
  elsif v_ssn is not null then
    insert into public.trainee_ssn (trainee_id, ssn, updated_at) values (new.trainee_id, v_ssn, now())
    on conflict (trainee_id) do update set ssn_chiffre = excluded.ssn_chiffre, fin = excluded.fin, updated_at = now();
    update public.trainees set ssn_present = true where id = new.trainee_id and not ssn_present and not coalesce(refused_ssn, false);
    new.ssn_present := true;
  else
    new.ssn_present := exists (select 1 from public.trainee_ssn s where s.trainee_id = new.trainee_id);
  end if;
  new.ssn := null;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.sync_info_sheet_to_trainee()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    -- Mise à jour de la table trainees
    UPDATE trainees
    SET
        email = COALESCE(NULLIF(NEW.email, ''), trainees.email),
        job_title = COALESCE(NULLIF(NEW.job_title, ''), trainees.job_title),
        csp = COALESCE(NULLIF(NEW.csp, ''), trainees.csp),
        social_security_number = COALESCE(NULLIF(NEW.ssn, ''), trainees.social_security_number),
        refused_ssn = COALESCE(NEW.ssn_refused, trainees.refused_ssn),
        ssn_present = CASE WHEN NEW.ssn_present THEN true ELSE trainees.ssn_present END,
        updated_at = NOW()
    WHERE id = NEW.trainee_id;
    
    RETURN NEW;
END;
$function$;

insert into public.schema_migrations (version) values ('0503_nir_apres_refus') on conflict (version) do nothing;

-- ===== supabase/rollback/0503_nir_apres_refus_retour.sql =====
-- Retour arrière de 0503 : info_sheet_ssn_capture remise au corps de 0502 et sync_info_sheet_to_trainee à celui de
-- 0001 (un numéro saisi après un refus est de nouveau perdu). Aucune donnée touchée.

CREATE OR REPLACE FUNCTION public.info_sheet_ssn_capture()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ssn text := nullif(regexp_replace(coalesce(new.ssn, ''), '\s', '', 'g'), '');
begin
  if coalesce(new.ssn_refused, false) then
    delete from public.trainee_ssn where trainee_id = new.trainee_id;
    update public.trainees set ssn_present = false where id = new.trainee_id and ssn_present;
    new.ssn_present := false;
  elsif v_ssn is not null then
    insert into public.trainee_ssn (trainee_id, ssn, updated_at) values (new.trainee_id, v_ssn, now())
    on conflict (trainee_id) do update set ssn_chiffre = excluded.ssn_chiffre, fin = excluded.fin, updated_at = now();
    update public.trainees set ssn_present = true where id = new.trainee_id and not ssn_present;
    new.ssn_present := true;
  else
    new.ssn_present := exists (select 1 from public.trainee_ssn s where s.trainee_id = new.trainee_id);
  end if;
  new.ssn := null;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.sync_info_sheet_to_trainee()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    -- Mise à jour de la table trainees
    UPDATE trainees
    SET
        email = COALESCE(NULLIF(NEW.email, ''), trainees.email),
        job_title = COALESCE(NULLIF(NEW.job_title, ''), trainees.job_title),
        csp = COALESCE(NULLIF(NEW.csp, ''), trainees.csp),
        social_security_number = COALESCE(NULLIF(NEW.ssn, ''), trainees.social_security_number),
        refused_ssn = COALESCE(NEW.ssn_refused, trainees.refused_ssn),
        updated_at = NOW()
    WHERE id = NEW.trainee_id;
    
    RETURN NEW;
END;
$function$;

delete from public.schema_migrations where version = '0503_nir_apres_refus';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE nir_0503 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
