-- Retour arrière de 0150_previsionnel.sql : retire la vue du prévisionnel, le module, les nouveaux types de relances
-- et remet la génération des relances dans sa version de 0045. Idempotent.
-- Refusé si une relance de ces nouveaux types a été validée ou envoyée ; celles encore à valider sont retirées.

do $$
begin
  if exists (select 1 from public.scheduled_actions where kind in ('renouvellement_contrat', 'visite_hors_contrat') and status <> 'a_valider') then
    raise exception 'Retour arrière refusé : des relances de renouvellement ou de visite ont été validées';
  end if;
end $$;

delete from public.scheduled_actions where kind in ('renouvellement_contrat', 'visite_hors_contrat') and status = 'a_valider';
alter table public.scheduled_actions drop constraint if exists scheduled_actions_kind_check;
alter table public.scheduled_actions add constraint scheduled_actions_kind_check check (kind in ('relance_recyclage', 'justificatif_prestataire',
  'convocation', 'rappel', 'evaluation_froid', 'relance_impaye', 'autre'));

-- Génération des relances : version de 0045
create or replace function public.scheduled_actions_generate()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int := 0;
  v_j int := 0;
begin
  if coalesce((select auth.role()), '') not in ('service_role', '') and not app.a_le_droit('plateforme.administrer') then
    raise exception 'Réservé à la tâche de nuit' using errcode = '42501';
  end if;

  -- Recyclages (0043, inchangé)
  with echeances as (
    select d.company_id, d.client_id, d.rule_id, d.rule_label, d.due_on, d.objet_label, d.status
    from public.v_obligation_deadlines d
    where d.kind = 'formation' and d.status in ('a_prevoir', 'depasse') and d.client_id is not null and d.rule_id is not null
  ), par_client as (
    select e.company_id, e.client_id, e.rule_id, min(e.rule_label) as rule_label, min(e.due_on) as premiere,
           count(*) as nb, bool_or(e.status = 'depasse') as depasse,
           jsonb_agg(jsonb_build_object('nom', e.objet_label, 'echeance', e.due_on) order by e.due_on) as personnes
    from echeances e
    group by e.company_id, e.client_id, e.rule_id
  ), avec_client as (
    select p.*, c.name as client_name,
           coalesce(nullif(btrim(c.contact_email), ''), nullif(btrim(c.email), ''),
                    (select nullif(btrim(cc.email), '') from public.client_contacts cc
                      where cc.client_id = c.id and cc.email is not null order by cc.is_primary desc nulls last limit 1)) as email
    from par_client p
    join public.clients c on c.id = p.client_id
    where coalesce(c.status, 'actif') not in ('archive', 'archived', 'inactif')
      and not coalesce((to_jsonb(c) ->> 'do_not_mail')::boolean, false)
  )
  insert into public.scheduled_actions (company_id, kind, target_table, target_id, client_id, rule_id, due_on, title, payload, dedup_key)
  select a.company_id, 'relance_recyclage', 'clients', a.client_id, a.client_id, a.rule_id, a.premiere,
         a.rule_label || ' : ' || a.nb || ' salarié' || case when a.nb > 1 then 's' else '' end || ' à recycler chez ' || a.client_name,
         jsonb_build_object(
           'destinataire', a.email,
           'objet', 'Recyclage ' || a.rule_label || ' à prévoir',
           'texte', 'Bonjour,' || E'\n\n'
             || case when a.depasse then 'La validité de la formation « ' || a.rule_label || ' » est dépassée ou arrive à échéance pour une partie de votre personnel :'
                     else 'La validité de la formation « ' || a.rule_label || ' » arrive à échéance pour une partie de votre personnel :' end
             || E'\n' || (select string_agg('- ' || coalesce(x ->> 'nom', 'salarié') || ' : ' || to_char((x ->> 'echeance')::date, 'DD/MM/YYYY'), E'\n')
                          from jsonb_array_elements(a.personnes) x)
             || E'\n\n' || 'Nous pouvons organiser le recyclage dans vos locaux ou dans les nôtres. Souhaitez-vous que nous vous proposions des dates ?'
             || E'\n\n' || 'Bien cordialement,',
           'personnes', a.personnes,
           'depasse', a.depasse),
         'recyclage:' || a.client_id || ':' || a.rule_id || ':' || to_char(a.premiere, 'YYYY-MM')
  from avec_client a
  on conflict (company_id, dedup_key) do nothing;
  get diagnostics v_n = row_count;

  -- Justificatifs des prestataires (0045) : prestataire actif avec une commande en cours ou à venir
  with manques as (
    select v.company_id, v.subcontractor_id, min(v.subcontractor_name) as nom,
           jsonb_agg(jsonb_build_object('justificatif', v.label, 'etat', v.status, 'jusqu_au', v.valid_until) order by v.label) as liste
    from public.v_subcontractor_compliance v
    where v.status in ('manquant', 'perime', 'a_renouveler')
      and exists (select 1 from public.subcontract_orders o where o.subcontractor_id = v.subcontractor_id
                  and o.status in ('brouillon', 'envoye', 'signe') and coalesce(o.end_date, o.start_date, o.order_date) >= current_date)
    group by v.company_id, v.subcontractor_id
  )
  insert into public.scheduled_actions (company_id, kind, target_table, target_id, due_on, title, payload, dedup_key)
  select m.company_id, 'justificatif_prestataire', 'subcontractors', m.subcontractor_id, current_date,
         'Justificatifs à demander à ' || m.nom,
         jsonb_build_object(
           'destinataire', (select nullif(btrim(s.email), '') from public.subcontractors s where s.id = m.subcontractor_id),
           'objet', 'Documents à nous transmettre',
           'texte', 'Bonjour,' || E'\n\n' || 'Pour notre collaboration, merci de nous transmettre les documents suivants :' || E'\n'
             || (select string_agg('- ' || (x ->> 'justificatif')
                   || case x ->> 'etat' when 'perime' then ' (le précédent n''est plus valable)' when 'a_renouveler' then ' (à renouveler prochainement)' else '' end, E'\n')
                 from jsonb_array_elements(m.liste) x)
             || E'\n\n' || 'Bien cordialement,',
           'liste', m.liste),
         'justificatif:' || m.subcontractor_id || ':' || to_char(current_date, 'YYYY-MM')
  from manques m
  on conflict (company_id, dedup_key) do nothing;
  get diagnostics v_j = row_count;

  return jsonb_build_object('relance_recyclage', v_n, 'justificatif_prestataire', v_j);
end
$$;
revoke all on function public.scheduled_actions_generate() from public, anon;
grant execute on function public.scheduled_actions_generate() to authenticated, service_role;

drop view if exists public.v_recurring_revenue;
delete from public.company_modules where key = 'previsionnel';
delete from public.org_modules where key = 'previsionnel';

delete from public.schema_migrations where version = '0150_previsionnel';
