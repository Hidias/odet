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
