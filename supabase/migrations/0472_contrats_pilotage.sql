-- 0472 : contrats de maintenance, pilotage et fidélisation (décisions du 27/10 § 8.2, 8.3 et 8.6).
--
-- 1. Rentabilité par contrat sur une période (public.contrats_pilotage) : chiffre d'affaires facturé (échéances et
--    interventions rattachées, factures émises), visites faites, temps réel passé sur place (arrivée à départ), coût
--    des pièces sorties au prix d'achat (seulement avec le droit de voir les prix d'achat), coût de la main-d'œuvre au
--    coût horaire saisi dans les réglages (vide : non calculé, rien n'est inventé), marge. Les déplacements ne sont pas
--    mesurés (aucun kilométrage enregistré) : c'est dit à l'écran.
-- 2. Maintien des contrats : contrats actifs au début de la période et toujours actifs à la fin.
-- 3. Rappels de fidélisation (public.pilotage_rappels_generer, chaque nuit) : en octobre, « bilan annuel à envoyer »
--    pour chaque client sous contrat actif ; en janvier, « contact à confirmer » pour chaque client public sous contrat
--    (changement d'élus et d'agents). Une fois par client et par an ; rien n'est envoyé.
-- Retour arrière (manuel) : en fin de fichier.

alter table public.billing_settings add column if not exists cout_horaire_intervention numeric check (cout_horaire_intervention is null or (cout_horaire_intervention >= 0 and cout_horaire_intervention <= 1000));
comment on column public.billing_settings.cout_horaire_intervention is '0472 : coût horaire chargé d''un technicien, saisi par l''entreprise (vide : main-d''œuvre non chiffrée dans la rentabilité).';

create or replace function public.contrats_pilotage(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_societes uuid[];
  v_prix boolean;
begin
  perform app.require_right('interventions.contrats.voir');
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 1100 then
    raise exception 'Période invalide' using errcode = '22023';
  end if;
  select array_agg(s) into v_societes from app.societes_lisibles() s;
  v_prix := app.is_superadmin() or exists (select 1 from app.societes_avec_droit('stock.valeur.voir') x where x = any(v_societes));
  return (
    with k as (
      select k.*, c.name as client_name
      from public.itv_contracts k join public.clients c on c.id = k.client_id
      where k.company_id = any(v_societes) and k.status in ('actif', 'suspendu', 'termine')
        and k.start_on <= p_to and (k.end_on is null or k.end_on >= p_from)
    ), factures as (
      select x.contract_id, sum(x.ht) as ht from (
        select e.contract_id, i.id, i.total_net_ht as ht
        from public.itv_contract_installments e join public.invoices i on i.id = e.invoice_id
        where i.status not in ('draft', 'cancelled') and i.invoice_date between p_from and p_to
        union
        select v.contract_id, i.id, i.total_net_ht
        from public.itv_visits v join public.invoices i on i.id = v.invoice_id
        where v.contract_id is not null and i.status not in ('draft', 'cancelled') and i.invoice_date between p_from and p_to
      ) x group by x.contract_id
    ), visites as (
      select v.contract_id, count(*) as nb,
             sum(case when v.started_at is not null and v.finished_at > v.started_at and v.finished_at - v.started_at < interval '12 hours'
                      then extract(epoch from v.finished_at - v.started_at) / 3600 end) as heures,
             count(*) filter (where v.started_at is null or v.finished_at is null or v.finished_at <= v.started_at) as sans_temps
      from public.itv_visits v
      where v.contract_id is not null and v.status = 'terminee'
        and coalesce((v.started_at at time zone 'Europe/Paris')::date, v.planned_on) between p_from and p_to
      group by v.contract_id
    ), pieces as (
      select v.contract_id, sum(p.quantity * c.purchase_price_ht) as cout, count(*) filter (where c.purchase_price_ht is null) as sans_prix
      from public.itv_visits v join public.itv_visit_parts p on p.visit_id = v.id
      left join public.stock_item_costs c on c.item_id = p.stock_item_id
      where v.contract_id is not null and v.status = 'terminee' and p.stock_item_id is not null
        and coalesce((v.started_at at time zone 'Europe/Paris')::date, v.planned_on) between p_from and p_to
      group by v.contract_id
    ), lignes as (
      select k.id, k.client_id, k.client_name, coalesce(nullif(k.label, ''), 'Contrat de maintenance') as label, k.reference, k.status,
             k.annual_price_ht, coalesce(f.ht, 0) as ca, coalesce(vi.nb, 0) as visites, round(coalesce(vi.heures, 0)::numeric, 2) as heures,
             coalesce(vi.sans_temps, 0) as visites_sans_temps,
             case when v_prix then round(coalesce(pc.cout, 0), 2) end as pieces, coalesce(pc.sans_prix, 0) as pieces_sans_prix,
             case when bs.cout_horaire_intervention is not null then round(coalesce(vi.heures, 0)::numeric * bs.cout_horaire_intervention, 2) end as main_oeuvre
      from k left join factures f on f.contract_id = k.id left join visites vi on vi.contract_id = k.id
      left join pieces pc on pc.contract_id = k.id left join public.billing_settings bs on bs.company_id = k.company_id
    )
    select jsonb_build_object(
      'du', p_from, 'au', p_to, 'prix_achat', v_prix,
      'cout_horaire', (select bs.cout_horaire_intervention from public.billing_settings bs where bs.company_id = any(v_societes) and bs.cout_horaire_intervention is not null limit 1),
      'contrats', coalesce((select jsonb_agg(jsonb_build_object(
          'id', l.id, 'client_id', l.client_id, 'client', l.client_name, 'label', l.label, 'reference', l.reference, 'status', l.status,
          'prix_annuel', l.annual_price_ht, 'ca', l.ca, 'visites', l.visites, 'heures', l.heures, 'visites_sans_temps', l.visites_sans_temps,
          'pieces', l.pieces, 'pieces_sans_prix', l.pieces_sans_prix, 'main_oeuvre', l.main_oeuvre,
          'marge', case when l.main_oeuvre is not null and l.pieces is not null then l.ca - l.main_oeuvre - l.pieces end)
        order by l.client_name) from lignes l), '[]'::jsonb),
      'maintien', (select jsonb_build_object(
          'debut', count(*),
          'toujours', count(*) filter (where k2.status in ('actif', 'suspendu') or (k2.end_on is not null and k2.end_on > p_to)))
        from public.itv_contracts k2
        where k2.company_id = any(v_societes) and k2.start_on < p_from and k2.status in ('actif', 'suspendu', 'termine')
          and (k2.end_on is null or k2.end_on >= p_from)))
  );
end
$$;
revoke all on function public.contrats_pilotage(date, date) from public, anon;
grant execute on function public.contrats_pilotage(date, date) to authenticated;

create or replace function public.pilotage_rappels_generer()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_b int := 0; v_c int := 0; v_annee int := extract(year from current_date)::int;
begin
  if coalesce((select auth.role()), '') not in ('service_role', '') and not app.a_le_droit('plateforme.administrer') then
    raise exception 'Réservé à la tâche de nuit' using errcode = '42501';
  end if;
  if extract(month from current_date) = 10 then
    insert into public.scheduled_actions (company_id, kind, target_table, target_id, client_id, due_on, title, payload, dedup_key)
    select distinct on (k.company_id, k.client_id) k.company_id, 'rappel', 'clients', k.client_id, k.client_id, current_date,
           'Bilan annuel à envoyer à ' || c.name,
           jsonb_build_object('interne', true, 'lien', '/interventions/parc/' || k.client_id || '?bilan=1',
             'texte', 'Ouvrez le parc de ' || c.name || ' et appuyez sur « Bilan annuel » : visites de l''année, remplacements, '
               || 'vérifications et fins de vie à venir, budget à prévoir. Relisez-le, puis envoyez-le au client.'),
           'bilan:' || k.client_id || ':' || v_annee
    from public.itv_contracts k join public.clients c on c.id = k.client_id
    where k.status = 'actif'
    order by k.company_id, k.client_id
    on conflict (company_id, dedup_key) do nothing;
    get diagnostics v_b = row_count;
  end if;
  if extract(month from current_date) = 1 then
    insert into public.scheduled_actions (company_id, kind, target_table, target_id, client_id, due_on, title, payload, dedup_key)
    select distinct on (k.company_id, k.client_id) k.company_id, 'rappel', 'clients', k.client_id, k.client_id, current_date,
           'Contact à confirmer chez ' || c.name || ' (client public)',
           jsonb_build_object('interne', true, 'lien', '/clients/' || k.client_id,
             'texte', 'Nouvelle année : vérifiez auprès de ' || c.name || ' l''interlocuteur, l''adresse de facturation et le numéro d''engagement '
               || v_annee || ' (changement d''élus ou d''agents). Mettez la fiche à jour : ajoutez le nouveau contact plutôt que de remplacer l''ancien.'),
           'contact_annuel:' || k.client_id || ':' || v_annee
    from public.itv_contracts k join public.clients c on c.id = k.client_id
    where k.status = 'actif' and c.client_type = 'public'
    order by k.company_id, k.client_id
    on conflict (company_id, dedup_key) do nothing;
    get diagnostics v_c = row_count;
  end if;
  return jsonb_build_object('bilans', v_b, 'contacts', v_c);
end
$$;
revoke all on function public.pilotage_rappels_generer() from public, anon, authenticated;
grant execute on function public.pilotage_rappels_generer() to service_role;

-- Retour arrière (manuel) :
-- drop function if exists public.pilotage_rappels_generer(); drop function if exists public.contrats_pilotage(date, date);
-- alter table public.billing_settings drop column if exists cout_horaire_intervention;
