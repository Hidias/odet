-- 0464 : clôture d'une visite d'inventaire (lot 4 des contrats, relecture de #243).
-- Une visite d'inventaire recense le parc ; elle n'est pas une vérification périodique. Sa clôture ne pose donc ni
-- « dernière vérification » ni « prochaine vérification » : sinon un appareil seulement inventorié paraîtrait vérifié
-- et sa vraie vérification serait repoussée. Le reste ne change pas (état « à remplacer », année d'un appareil remplacé).
-- Corps repris de 0276 à l'identique, seule la date dépend de la nature de la visite.
-- Retour arrière : réappliquer la définition de 0276.

CREATE OR REPLACE FUNCTION public.itv_close_visit(p_visit uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v public.itv_visits%rowtype; v_day date; n_ok int; n_ko int; n_rp int; n_other int;
begin
  /* société (C2) */ perform app.exiger_societe('itv_visits', p_visit, true);
  /* garde chantier 2 */ if app.role() = 'technicien' and p_visit not in (select app.tech_visit_ids()) then raise exception 'Accès refusé' using errcode = '42501'; end if;

  if not public.itv_can_write() then raise exception 'Accès refusé' using errcode = '42501'; end if;
  select * into v from public.itv_visits where id = p_visit for update;
  if not found then raise exception 'Visite introuvable'; end if;
  v_day := coalesce((v.started_at at time zone 'Europe/Paris')::date, v.planned_on, current_date);

  update public.itv_equipment e set
    last_check_on = case when v.kind = 'inventaire' then e.last_check_on else v_day end,
    next_check_on = case when v.kind = 'inventaire' then e.next_check_on else (v_day + make_interval(months => t.verification_months))::date end,
    status = case when i.result = 'a_remplacer' then 'a_remplacer' else 'en_service' end,
    manufactured_year = case when i.result = 'remplace' then extract(year from v_day)::int else e.manufactured_year end,
    updated_at = now()
  from public.itv_visit_items i, public.itv_equipment_types t
  where i.visit_id = p_visit and i.equipment_id = e.id and t.id = e.type_id
    and i.result in ('conforme', 'remplace', 'a_remplacer');

  update public.itv_visits set status = 'terminee', finished_at = coalesce(finished_at, now()) where id = p_visit;

  select count(*) filter (where result = 'conforme'), count(*) filter (where result = 'a_remplacer'),
         count(*) filter (where result = 'remplace'), count(*) filter (where result in ('absent', 'inaccessible'))
    into n_ok, n_ko, n_rp, n_other
  from public.itv_visit_items where visit_id = p_visit;
  return jsonb_build_object('conforme', n_ok, 'a_remplacer', n_ko, 'remplace', n_rp, 'autre', n_other);
end $function$;

