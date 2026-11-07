-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (nir_0503) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0503_nir_apres_refus.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0503_nir_apres_refus_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0503_nir_apres_refus.sql =====
-- 0503 : numéro de sécurité sociale saisi sur la fiche de renseignements après un refus : il n'est plus perdu.
-- Défaut ancien relevé le 07/11 (V28). Une fiche d'abord refusée (« je ne donne pas mon numéro »), puis remplie avec
-- un numéro : info_sheet_ssn_capture rangeait le numéro dans trainee_ssn, puis passait le stagiaire à « numéro
-- présent » ; or le stagiaire portait encore le refus (levé seulement après, par sync_info_sheet_to_trainee) et son
-- déclencheur trainee_ssn_capture effaçait aussitôt le numéro. Résultat : la fiche disait « numéro indiqué » et
-- trainee_ssn était vide (rien pour le Passeport de prévention).
--   Correctif : info_sheet_ssn_capture ne touche plus le stagiaire quand un numéro est saisi alors qu'il porte encore
--   le refus ; c'est sync_info_sheet_to_trainee (après l'écriture de la fiche) qui lève le refus et recalcule « numéro
--   présent » d'après trainee_ssn dans la même mise à jour (jamais d'après une fiche dépassée). Lever le refus dès le déclencheur d'avant échoue : le stagiaire recopie le
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
        ssn_present = EXISTS (SELECT 1 FROM trainee_ssn s WHERE s.trainee_id = NEW.trainee_id),
        updated_at = NOW()
    WHERE id = NEW.trainee_id;
    
    RETURN NEW;
END;
$function$;

insert into public.schema_migrations (version) values ('0503_nir_apres_refus') on conflict (version) do nothing;
