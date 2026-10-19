-- Retour arrière de 0314_rh_entretiens.sql : remet la vue des échéances de 0301 et les référentiels de départ de 0311,
-- retire entretiens, listes et modèles. Idempotent. Refusé si des entretiens ou des listes ont été saisis.

do $$
begin
  if (to_regclass('public.hr_reviews') is not null and exists (select 1 from public.hr_reviews))
     or (to_regclass('public.hr_checklists') is not null and exists (select 1 from public.hr_checklists)) then
    raise exception 'Retour arrière refusé : des entretiens ou des listes d''arrivée et de départ ont été saisis (à exporter d''abord)';
  end if;
end $$;

drop view if exists public.v_hr_echeances;
create or replace view public.v_hr_echeances with (security_invoker = true) as
  select q.company_id, q.person_id, 'habilitation'::text as kind, q.label, q.expires_on as due_on, q.id as source_id
  from public.hr_qualifications q
  where q.archived_at is null and q.expires_on is not null
  union all
  select m.company_id, m.person_id, 'visite', 'Visite de santé au travail', m.next_due_on, m.id
  from public.hr_medical_followups m
  where m.next_due_on is not null
    and not exists (select 1 from public.hr_medical_followups m2
                    where m2.person_id = m.person_id and m2.visit_on is not null and m2.visit_on >= m.next_due_on)
  union all
  select e.company_id, e.person_id, 'fin_contrat', 'Fin de contrat', e.end_on, e.id
  from public.hr_employments e
  where e.end_on is not null and e.end_on >= current_date - 30
  union all
  select e.company_id, e.person_id, 'fin_essai', 'Fin de la période d''essai', e.trial_end_on, e.id
  from public.hr_employments e
  where e.trial_end_on is not null and e.trial_end_on >= current_date - 30;
comment on view public.v_hr_echeances is 'Échéances RH (habilitations, visites, fins de CDD et d''essai), aux droits du lecteur';
revoke all on public.v_hr_echeances from public, anon;
grant select on public.v_hr_echeances to authenticated;

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
  if to_regprocedure('app.hr_feries_depart(uuid)') is not null then
    execute 'select app.hr_feries_depart($1)' using new.id;
  end if;
  return null;
end
$$;
revoke all on function app.societe_referentiels_depart() from public, anon, authenticated;

drop function if exists public.hr_liste_ouvrir(uuid, text);
drop function if exists app.hr_listes_depart(uuid);
drop table if exists public.hr_checklists;
drop table if exists public.hr_checklist_templates;
drop table if exists public.hr_reviews;
drop function if exists app.hr_entretien_garde();

delete from public.schema_migrations where version = '0314_rh_entretiens';
