-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (nir_fiches_0506) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0506_nir_fiches_saisie_directe.sql, retour arrière,
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

-- ===== supabase/migrations/0506_nir_fiches_saisie_directe.sql =====
-- 0506 : numéro de sécurité sociale saisi directement (fiche du stagiaire, liste des participants, Passeport) : les
-- fiches de renseignements ne restent plus « numéro absent ». Reste de 0503 relevé le 07/11 (V30).
-- Constat : la fiche session affiche « - » (trainee_info_sheets.ssn_present faux) alors que le numéro est connu.
--   a. Saisie sur le stagiaire : trainee_ssn_capture range le numéro et vide social_security_number avant l'écriture ;
--      les déclencheurs d'après du stagiaire ne voient donc aucun changement et ne touchent pas les fiches.
--   b. Saisie dans le Passeport (pp_nir) ou reprise automatique (trainee_ssn passé dans pp_nir puis effacé) :
--      info_sheet_ssn_capture ne regardait que trainee_ssn ; toute écriture ultérieure d'une fiche la repassait à faux.
-- Correctif :
--   1. info_sheet_ssn_capture (corps de 0503, deux lignes changées) : sans refus ni numéro saisi, « présent » = numéro
--      dans trainee_ssn ou dans pp_nir ; un numéro saisi sur la fiche ne met plus le stagiaire à jour depuis ce
--      déclencheur d'avant : sync_info_sheet_to_trainee le fait déjà après l'écriture (0503). Sinon le déclencheur du
--      point 2 réécrirait la fiche en cours (« tuple already modified », ou « on conflict » touché deux fois).
--   2. app.nir_vers_fiches(stagiaire) : passe à « présent » ses fiches sans refus qui ne le sont pas (jamais une fiche
--      « refus », dont la mise à jour effacerait le numéro). Appelée par deux déclencheurs d'après (un déclencheur
--      d'avant qui écrit dans les fiches finit en « tuple already modified », voir 0503) :
--      - zy_nir_vers_fiches sur trainees, quand ssn_present passe de faux à vrai (sans « update of » : la colonne est
--        changée par le déclencheur d'avant, pas par l'instruction) ; nommé pour passer après les recopies existantes ;
--      - nir_vers_fiches sur pp_nir, à l'insertion.
--      Fin de la chaîne : la fiche mise à jour recopie vers le stagiaire des valeurs déjà égales ; ssn_present du
--      stagiaire ne change plus, le déclencheur ne repart pas.
--   3. Déclencheur en double sync_trainee_data retiré (même fonction et même condition que
--      trg_sync_trainee_to_info_sheets, 0001) : la recopie vers les fiches passait deux fois.
--   4. Fiches déjà en écart remises à « présent » (production le 07/11 : 0 numéro, 0 fiche concernée).
-- Le passage du stagiaire à faux (reprise du Passeport) ne touche pas les fiches : le numéro est dans pp_nir.
-- Retour arrière : supabase/rollback/0506_nir_fiches_saisie_directe_retour.sql (corps de 0503, déclencheur remis).

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
    new.ssn_present := true;
  else
    new.ssn_present := exists (select 1 from public.trainee_ssn s where s.trainee_id = new.trainee_id)
      or exists (select 1 from public.pp_nir n where n.trainee_id = new.trainee_id);
  end if;
  new.ssn := null;
  return new;
end
$function$;

create or replace function app.nir_vers_fiches(p_trainee uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.trainee_info_sheets
     set ssn_present = true
   where trainee_id = p_trainee
     and not coalesce(ssn_refused, false)
     and not ssn_present;
$$;
revoke all on function app.nir_vers_fiches(uuid) from public, anon, authenticated;

create or replace function app.nir_vers_fiches_stagiaire()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.nir_vers_fiches(new.id);
  return null;
end
$$;
revoke all on function app.nir_vers_fiches_stagiaire() from public, anon, authenticated;

create or replace function app.nir_vers_fiches_passeport()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.nir_vers_fiches(new.trainee_id);
  return null;
end
$$;
revoke all on function app.nir_vers_fiches_passeport() from public, anon, authenticated;

drop trigger if exists zy_nir_vers_fiches on public.trainees;
create trigger zy_nir_vers_fiches after update on public.trainees
  for each row when (new.ssn_present and not old.ssn_present)
  execute function app.nir_vers_fiches_stagiaire();

drop trigger if exists nir_vers_fiches on public.pp_nir;
create trigger nir_vers_fiches after insert on public.pp_nir
  for each row execute function app.nir_vers_fiches_passeport();

drop trigger if exists sync_trainee_data on public.trainees;

update public.trainee_info_sheets f
   set ssn_present = true
 where not coalesce(f.ssn_refused, false)
   and not f.ssn_present
   and (exists (select 1 from public.trainee_ssn s where s.trainee_id = f.trainee_id)
        or exists (select 1 from public.pp_nir n where n.trainee_id = f.trainee_id));

insert into public.schema_migrations (version) values ('0506_nir_fiches_saisie_directe') on conflict (version) do nothing;

-- ===== supabase/rollback/0506_nir_fiches_saisie_directe_retour.sql =====
-- Retour arrière de 0506 : info_sheet_ssn_capture remise au corps de 0503, déclencheurs zy_nir_vers_fiches et
-- nir_vers_fiches retirés avec leurs fonctions, déclencheur sync_trainee_data remis (0001). Les fiches passées à
-- « présent » le restent (elles disent vrai : le numéro est connu).

drop trigger if exists zy_nir_vers_fiches on public.trainees;
drop trigger if exists nir_vers_fiches on public.pp_nir;
drop function if exists app.nir_vers_fiches_stagiaire();
drop function if exists app.nir_vers_fiches_passeport();
drop function if exists app.nir_vers_fiches(uuid);

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

drop trigger if exists sync_trainee_data on public.trainees;
CREATE TRIGGER sync_trainee_data AFTER UPDATE ON public.trainees FOR EACH ROW WHEN ((((old.email)::text IS DISTINCT FROM (new.email)::text) OR ((old.social_security_number)::text IS DISTINCT FROM (new.social_security_number)::text) OR (old.refused_ssn IS DISTINCT FROM new.refused_ssn) OR (old.csp IS DISTINCT FROM new.csp) OR ((old.job_title)::text IS DISTINCT FROM (new.job_title)::text))) EXECUTE FUNCTION sync_trainee_to_info_sheets();

delete from public.schema_migrations where version = '0506_nir_fiches_saisie_directe';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE nir_fiches_0506 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
