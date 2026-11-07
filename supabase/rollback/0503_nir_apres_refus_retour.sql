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
