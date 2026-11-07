-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (nir_fiches_0506) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0506_nir_fiches_saisie_directe.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0506_nir_fiches_saisie_directe_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

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
