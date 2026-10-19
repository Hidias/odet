-- Retour arrière de 0311_rh_jours_feries.sql : remet le décompte et les référentiels de départ de 0294, retire les
-- jours fériés et leurs fonctions. Idempotent. Les demandes déjà faites gardent leur nombre de jours.

create or replace function public.hr_absence_demander(p_type uuid, p_debut date, p_debut_demi text, p_fin date,
  p_fin_demi text, p_commentaire text default null, p_personne uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_co uuid := app.current_company();
  v_pers uuid;
  v_type public.hr_absence_types;
  v_jours numeric;
  v_id uuid;
  v_appro uuid;
begin
  if v_co is null then raise exception 'Accès refusé' using errcode = '42501'; end if;
  if p_personne is null then
    select p.id into v_pers from public.hr_people p where p.profile_id = (select auth.uid()) and p.company_id = v_co and p.archived_at is null;
    if v_pers is null then raise exception 'Aucune fiche du personnel reliée à votre compte' using errcode = 'P0002'; end if;
    if not app.a_le_droit('rh.absences.demander') and not app.a_le_droit('rh.dossiers.gerer') then
      raise exception 'Accès refusé' using errcode = '42501';
    end if;
  else
    select p.id into v_pers from public.hr_people p where p.id = p_personne and p.company_id = v_co;
    if v_pers is null then raise exception 'Personne introuvable' using errcode = 'P0002'; end if;
    if not (v_pers in (select app.hr_mes_personnes()) and app.a_le_droit('rh.absences.demander')) and not app.a_le_droit('rh.dossiers.gerer') then
      raise exception 'Accès refusé' using errcode = '42501';
    end if;
  end if;
  select * into v_type from public.hr_absence_types t where t.id = p_type and t.company_id = v_co and t.is_active;
  if v_type.id is null then raise exception 'Type d''absence inconnu' using errcode = 'P0002'; end if;
  if not v_type.employee_can_request and not app.a_le_droit('rh.dossiers.gerer') then
    raise exception 'Ce type d''absence est saisi par la RH' using errcode = '42501';
  end if;
  if p_fin < p_debut then raise exception 'La fin est avant le début' using errcode = '22023'; end if;
  if not v_type.half_days and (p_debut_demi is not null or p_fin_demi is not null) then
    raise exception 'Ce type d''absence se prend par journées entières' using errcode = '22023';
  end if;
  if exists (select 1 from public.hr_absence_requests r where r.person_id = v_pers and r.status in ('demandee', 'validee')
             and daterange(r.start_on, r.end_on, '[]') && daterange(p_debut, p_fin, '[]')) then
    raise exception 'Une demande couvre déjà une partie de ces dates' using errcode = '23505';
  end if;
  v_jours := app.hr_jours_ouvres(p_debut, p_debut_demi, p_fin, p_fin_demi);
  if v_jours <= 0 then raise exception 'Aucun jour ouvré dans cette période' using errcode = '22023'; end if;
  insert into public.hr_absence_requests (company_id, person_id, type_id, start_on, start_half, end_on, end_half, days, comment, requested_by)
  values (v_co, v_pers, v_type.id, p_debut, p_debut_demi, p_fin, p_fin_demi, v_jours, nullif(btrim(coalesce(p_commentaire, '')), ''), (select auth.uid()))
  returning id into v_id;
  v_appro := public.approval_submit('absence', 'hr_absence_requests', v_id, null, null,
    left(v_type.label || ' du ' || to_char(p_debut, 'DD/MM/YYYY') || ' au ' || to_char(p_fin, 'DD/MM/YYYY'), 200));
  if v_appro is null then
    -- Aucune validation demandée par la société : validée tout de suite
    perform app.hr_absence_appliquer(v_id, 'validee', null, null);
  else
    update public.hr_absence_requests set approval_id = v_appro where id = v_id;
  end if;
  return v_id;
end
$$;
revoke all on function public.hr_absence_demander(uuid, date, text, date, text, text, uuid) from public, anon;
grant execute on function public.hr_absence_demander(uuid, date, text, date, text, text, uuid) to authenticated;

create or replace function app.societe_referentiels_depart()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.subcontractor_doc_types_depart(new.id);
  if to_regprocedure('app.obligation_rules_depart(uuid)') is not null then
    execute 'select app.obligation_rules_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.commercial_lists_depart(uuid)') is not null then
    execute 'select app.commercial_lists_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.rgpd_sous_traitants_depart(uuid)') is not null then
    execute 'select app.rgpd_sous_traitants_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.rgpd_purge_regles_depart(uuid)') is not null then
    execute 'select app.rgpd_purge_regles_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.cert_pitfalls_depart(uuid)') is not null then
    execute 'select app.cert_pitfalls_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.hr_horaires_depart(uuid)') is not null then
    execute 'select app.hr_horaires_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.hr_types_absence_depart(uuid)') is not null then
    execute 'select app.hr_types_absence_depart($1)' using new.id;
  end if;
  return null;
end
$$;
revoke all on function app.societe_referentiels_depart() from public, anon, authenticated;

drop function if exists public.hr_feries_annee(int);
drop function if exists app.hr_jours_ouvres_societe(uuid, date, text, date, text);
drop function if exists app.hr_feries_depart(uuid);
drop function if exists app.hr_feries_poser(uuid, int);
drop function if exists app.paques(int);
drop table if exists public.hr_public_holidays;

delete from public.schema_migrations where version = '0311_rh_jours_feries';
