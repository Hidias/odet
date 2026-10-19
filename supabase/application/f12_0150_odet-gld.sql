-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (f12_0150) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur odet-gld : 0150_previsionnel.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0150_previsionnel_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0150_previsionnel.sql =====
-- 0150_previsionnel.sql : fonction 12, chiffre d'affaires récurrent prévu (module « previsionnel »).
--
-- Spec : odet-f12-ca-recurrent.md (validée le 14/10/2026). Tout est calculé : aucune table de prévisions.
-- 1. Vue v_recurring_revenue (security_invoker : chacun ne voit que ce que ses droits lui ouvrent) : sur 12 mois
--    glissants, par mois, client et nature :
--    - formation : échéances de recyclage du personnel (une par stagiaire et par groupe de validité), prix du
--      catalogue par stagiaire (première formation de l'obligation) ; échéance dépassée comptée dans le mois en cours ;
--    - maintenance : vérifications du matériel d'un client sans contrat actif, une visite par client, site et mois,
--      au tarif de visite des réglages Interventions ;
--    - contrat : renouvellement d'un contrat de maintenance à sa fin, à son prix annuel.
--    Colonnes : montant attendu HT, part déjà devisée (devis envoyés ou acceptés des 6 derniers mois pour ces
--    formations, plafonnée au montant attendu), part planifiée (stagiaire déjà inscrit à une session à venir, visite
--    déjà planifiée), nombre d'échéances sans prix. Aucun montant inventé : sans prix, l'échéance est comptée à part.
--    Client inactif ou « ne pas solliciter » : gardé avec la mention (exclu des relances).
-- 2. Moteur de relances (0043) : nouveaux types renouvellement_contrat (contrat qui se termine dans les 60 jours) et
--    visite_hors_contrat (vérification à faire dans les 60 jours chez un client sans contrat, aucune visite
--    planifiée) ; à valider dans « Relances à valider », jamais envoyés seuls.
-- 3. Module « previsionnel » (org_modules), actif d'emblée si Formation l'est.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0150_previsionnel_retour.sql

-- ── 1. Vue ──
create or replace view public.v_recurring_revenue
with (security_invoker = true)
as
with fen as (
  select current_date as debut, (current_date + 365) as fin
), formation as (
  select d.company_id, d.client_id, d.rule_id, d.rule_label as label, d.objet_id as trainee_id,
         date_trunc('month', greatest(d.due_on, current_date))::date as mois,
         r.course_ids,
         (select nullif(c.price_ht, 0) from public.courses c where c.id = r.course_ids[1]) as prix,
         exists (select 1 from public.session_trainees st join public.sessions s on s.id = st.session_id
                 where st.trainee_id = d.objet_id and s.start_date >= current_date and s.course_id = any (coalesce(r.course_ids, '{}'::uuid[]))
                   and coalesce(s.status, '') not in ('cancelled', 'annulee')) as planifie
  from public.v_obligation_deadlines d
  join public.obligation_rules r on r.id = d.rule_id
  cross join fen
  where d.kind = 'formation' and d.due_on < fen.fin and d.client_id is not null
), formation_g as (
  select f.company_id, f.client_id, f.mois, 'formation'::text as nature, f.rule_id, min(f.label) as label,
         count(*) as nb_echeances,
         sum(f.prix) as montant_attendu,
         count(*) filter (where f.prix is null) as nb_sans_prix,
         count(*) filter (where f.planifie) as nb_planifies,
         sum(f.prix) filter (where f.planifie) as montant_planifie,
         least(sum(f.prix), coalesce((
           select sum(qi.total_ht) from public.quotes q join public.quote_items qi on qi.quote_id = q.id
           where q.client_id = f.client_id and q.quote_date >= current_date - 180
             and coalesce(q.status, 'draft') in ('sent', 'pending', 'accepted', 'signed')
             and qi.course_id = any (coalesce((select r2.course_ids from public.obligation_rules r2 where r2.id = f.rule_id), '{}'::uuid[]))), 0)) as montant_devise
  from formation f
  group by f.company_id, f.client_id, f.mois, f.rule_id
), materiel as (
  select d.company_id, d.client_id, d.site_id, date_trunc('month', greatest(d.due_on, current_date))::date as mois
  from public.v_obligation_deadlines d cross join fen
  where d.kind = 'materiel' and d.due_on < fen.fin and d.client_id is not null
    and not exists (select 1 from public.itv_contracts k where k.client_id = d.client_id
                    and coalesce(k.status, 'active') in ('active', 'actif') and (k.end_on is null or k.end_on >= current_date))
  group by 1, 2, 3, 4
), materiel_g as (
  select m.company_id, m.client_id, m.mois, 'maintenance'::text as nature, null::uuid as rule_id,
         'Visite de vérification hors contrat'::text as label,
         count(*) as nb_echeances,
         sum((select nullif(s.visit_fee_ht, 0) from public.itv_settings s limit 1)) as montant_attendu,
         count(*) filter (where (select nullif(s.visit_fee_ht, 0) from public.itv_settings s limit 1) is null) as nb_sans_prix,
         count(*) filter (where exists (select 1 from public.itv_visits v where v.client_id = m.client_id
                                        and (m.site_id is null or v.site_id = m.site_id) and v.status in ('a_planifier', 'planifiee', 'en_cours')
                                        and date_trunc('month', coalesce(v.planned_on, v.due_on))::date = m.mois)) as nb_planifies,
         null::numeric as montant_planifie,
         0::numeric as montant_devise
  from materiel m
  group by m.company_id, m.client_id, m.mois
), contrat_g as (
  select k.company_id, k.client_id, date_trunc('month', greatest(k.end_on, current_date))::date as mois, 'contrat'::text as nature,
         null::uuid as rule_id, coalesce(nullif(k.label, ''), k.reference, 'Contrat de maintenance') as label,
         1::bigint as nb_echeances, nullif(k.annual_price_ht, 0) as montant_attendu,
         case when nullif(k.annual_price_ht, 0) is null then 1 else 0 end::bigint as nb_sans_prix,
         0::bigint as nb_planifies, null::numeric as montant_planifie, 0::numeric as montant_devise
  from public.itv_contracts k cross join fen
  where k.end_on is not null and k.end_on < fen.fin and coalesce(k.status, 'active') in ('active', 'actif')
)
select x.company_id, x.client_id, c.name as client_name, x.mois, x.nature, x.rule_id, x.label,
       x.nb_echeances, coalesce(x.montant_attendu, 0) as montant_attendu, x.nb_sans_prix,
       coalesce(x.montant_devise, 0) as montant_devise,
       coalesce(x.montant_planifie, 0) as montant_planifie, x.nb_planifies,
       (coalesce(c.status, 'actif') in ('archive', 'archived', 'inactif') or coalesce((to_jsonb(c) ->> 'do_not_mail')::boolean, false)) as client_a_ne_pas_solliciter
from (select * from formation_g union all select * from materiel_g union all select * from contrat_g) x
join public.clients c on c.id = x.client_id;

comment on view public.v_recurring_revenue is 'Chiffre d''affaires récurrent attendu sur 12 mois (fonction 12) : calculé, jamais estimé sans prix';
revoke all on table public.v_recurring_revenue from public, anon;
grant select on table public.v_recurring_revenue to authenticated, service_role;

-- ── 3. Module ──
insert into public.org_modules (key, label, enabled, position, description)
select 'previsionnel', 'Prévisionnel récurrent',
       coalesce((select enabled from public.org_modules where key = 'formation'), false), 128,
       'Chiffre d''affaires attendu sur 12 mois à partir des échéances connues (recyclages, vérifications, contrats), part déjà devisée et planifiée, relances préparées'
on conflict (key) do nothing;

-- ── 2. Moteur de relances : nouveaux types ──
alter table public.scheduled_actions drop constraint if exists scheduled_actions_kind_check;
alter table public.scheduled_actions add constraint scheduled_actions_kind_check check (kind in ('relance_recyclage', 'justificatif_prestataire',
  'convocation', 'rappel', 'evaluation_froid', 'relance_impaye', 'autre', 'renouvellement_contrat', 'visite_hors_contrat'));

create or replace function public.scheduled_actions_generate()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int := 0;
  v_j int := 0;
  v_c int := 0;
  v_v int := 0;
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

  -- Justificatifs des prestataires (0045, inchangé)
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

  -- Renouvellement d'un contrat de maintenance qui se termine dans les 60 jours (0150)
  insert into public.scheduled_actions (company_id, kind, target_table, target_id, client_id, due_on, title, payload, dedup_key)
  select k.company_id, 'renouvellement_contrat', 'itv_contracts', k.id, k.client_id, k.end_on,
         'Contrat ' || coalesce(nullif(k.label, ''), k.reference, 'de maintenance') || ' de ' || c.name || ' : fin le ' || to_char(k.end_on, 'DD/MM/YYYY'),
         jsonb_build_object(
           'destinataire', coalesce(nullif(btrim(c.contact_email), ''), nullif(btrim(c.email), '')),
           'objet', 'Renouvellement de votre contrat de maintenance',
           'texte', 'Bonjour,' || E'\n\n' || 'Votre contrat de maintenance du matériel de sécurité se termine le ' || to_char(k.end_on, 'DD/MM/YYYY')
             || '. Nous vous proposons de le renouveler aux mêmes conditions, pour garder vos vérifications à jour.'
             || E'\n\n' || 'Bien cordialement,'),
         'contrat:' || k.id || ':' || to_char(k.end_on, 'YYYY-MM')
  from public.itv_contracts k join public.clients c on c.id = k.client_id
  where k.end_on between current_date and current_date + 60 and coalesce(k.status, 'active') in ('active', 'actif')
    and coalesce(c.status, 'actif') not in ('archive', 'archived', 'inactif') and not coalesce((to_jsonb(c) ->> 'do_not_mail')::boolean, false)
    and not exists (select 1 from public.itv_contracts k2 where k2.client_id = k.client_id and k2.id <> k.id and k2.start_on > k.start_on)
  on conflict (company_id, dedup_key) do nothing;
  get diagnostics v_c = row_count;

  -- Vérification à faire dans les 60 jours chez un client sans contrat, sans visite planifiée (0150)
  with dues as (
    select d.company_id, d.client_id, min(d.due_on) as premiere, count(*) as nb
    from public.v_obligation_deadlines d
    where d.kind = 'materiel' and d.due_on <= current_date + 60 and d.client_id is not null
      and not exists (select 1 from public.itv_contracts k where k.client_id = d.client_id and coalesce(k.status, 'active') in ('active', 'actif')
                      and (k.end_on is null or k.end_on >= current_date))
      and not exists (select 1 from public.itv_visits v where v.client_id = d.client_id and v.status in ('a_planifier', 'planifiee', 'en_cours'))
    group by d.company_id, d.client_id
  )
  insert into public.scheduled_actions (company_id, kind, target_table, target_id, client_id, due_on, title, payload, dedup_key)
  select x.company_id, 'visite_hors_contrat', 'clients', x.client_id, x.client_id, x.premiere,
         c.name || ' : ' || x.nb || ' appareil' || case when x.nb > 1 then 's' else '' end || ' à vérifier, sans contrat',
         jsonb_build_object(
           'destinataire', coalesce(nullif(btrim(c.contact_email), ''), nullif(btrim(c.email), '')),
           'objet', 'Vérification annuelle de votre matériel de sécurité',
           'texte', 'Bonjour,' || E'\n\n' || 'La vérification de votre matériel de sécurité (' || x.nb || ' appareil'
             || case when x.nb > 1 then 's' else '' end || ') est à prévoir à partir du ' || to_char(x.premiere, 'DD/MM/YYYY')
             || '. Souhaitez-vous que nous planifiions la visite ?' || E'\n\n' || 'Bien cordialement,',
           'nb', x.nb),
         'visite:' || x.client_id || ':' || to_char(x.premiere, 'YYYY-MM')
  from dues x join public.clients c on c.id = x.client_id
  where coalesce(c.status, 'actif') not in ('archive', 'archived', 'inactif') and not coalesce((to_jsonb(c) ->> 'do_not_mail')::boolean, false)
  on conflict (company_id, dedup_key) do nothing;
  get diagnostics v_v = row_count;

  return jsonb_build_object('relance_recyclage', v_n, 'justificatif_prestataire', v_j, 'renouvellement_contrat', v_c, 'visite_hors_contrat', v_v);
end
$$;
revoke all on function public.scheduled_actions_generate() from public, anon;
grant execute on function public.scheduled_actions_generate() to authenticated, service_role;

insert into public.schema_migrations (version) values ('0150_previsionnel') on conflict (version) do nothing;
