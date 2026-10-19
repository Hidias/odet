-- Retour arrière de 0042_obligations.sql : retire le référentiel des obligations, les formations suivies ailleurs,
-- les exercices de l'exploitant et les vues d'échéances. Idempotent.
-- Refusé si des formations suivies ailleurs ou des exercices ont été saisis, ou si le référentiel a été modifié
-- (règle confirmée, changée ou ajoutée) : ce sont des données saisies, jamais effacées par un retour arrière.

do $$
begin
  if to_regclass('public.obligation_rules') is not null then
    if exists (select 1 from public.external_trainings) or exists (select 1 from public.client_safety_checks) then
      raise exception 'Retour arrière refusé : des formations suivies ailleurs ou des exercices ont été saisis';
    end if;
    if exists (select 1 from public.obligation_rules where is_confirmed or updated_at > created_at + interval '1 second'
                 or code not in ('sst', 'habilitation_electrique', 'incendie_equipier', 'conduite_r489', 'conduite_r485', 'gestes_postures',
                                 'exercice_evacuation', 'essai_alarme', 'verification_extincteurs', 'verification_ria',
                                 'verification_alarme', 'verification_baes', 'verification_desenfumage')) then
      raise exception 'Retour arrière refusé : le référentiel des obligations a été modifié';
    end if;
  end if;
end $$;

drop view if exists public.v_obligation_deadlines;
drop view if exists public.v_trainee_validities;
drop table if exists public.client_safety_checks;
drop table if exists public.external_trainings;
drop table if exists public.obligation_rules;
drop function if exists app.obligation_rules_depart(uuid);
drop function if exists app.obligations_societe();
drop function if exists app.safety_check_echeance();
drop function if exists app.external_training_echeance();
drop function if exists app.obligation_rules_maj();

delete from public.schema_migrations where version = '0042_obligations';
