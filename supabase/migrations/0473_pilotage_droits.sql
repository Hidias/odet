-- 0473 : rentabilité des contrats, relecture de #249 : droits appliqués société par société.
-- La fonction contourne les règles de lecture (security definer) : elle ne retient que les contrats des sociétés où
-- l'utilisateur a « voir les contrats », et ne calcule le coût des pièces que pour les sociétés où il a « voir les
-- prix d'achat ». Les totaux « prix d'achat » ne sont présentés que si toutes les sociétés affichées le permettent.
-- Corps de 0472 repris, seules ces conditions changent. Retour arrière : réappliquer 0472.

create or replace function public.contrats_pilotage(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_societes uuid[];
  v_prix_soc uuid[];
  v_prix boolean;
begin
  perform app.require_right('interventions.contrats.voir');
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 1100 then
    raise exception 'Période invalide' using errcode = '22023';
  end if;
  -- Droits par société : contrats des seules sociétés où le droit est donné ; prix d'achat des seules sociétés où
  -- « voir les prix d'achat » est donné (la fonction contourne les règles de lecture, elle les applique donc elle-même)
  if app.is_superadmin() then
    select array_agg(s) into v_societes from app.societes_lisibles() s;
    v_prix_soc := v_societes;
  else
    select array_agg(s) into v_societes from app.societes_avec_droit('interventions.contrats.voir') s
    where s in (select app.societes_lisibles());
    select array_agg(s) into v_prix_soc from app.societes_avec_droit('stock.valeur.voir') s
    where s = any(coalesce(v_societes, '{}'));
  end if;
  v_societes := coalesce(v_societes, '{}'); v_prix_soc := coalesce(v_prix_soc, '{}');
  v_prix := v_societes <@ v_prix_soc and cardinality(v_societes) > 0;
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
      where v.contract_id is not null and v.status = 'terminee' and p.stock_item_id is not null and v.company_id = any(v_prix_soc)
        and coalesce((v.started_at at time zone 'Europe/Paris')::date, v.planned_on) between p_from and p_to
      group by v.contract_id
    ), lignes as (
      select k.id, k.client_id, k.client_name, coalesce(nullif(k.label, ''), 'Contrat de maintenance') as label, k.reference, k.status,
             k.annual_price_ht, coalesce(f.ht, 0) as ca, coalesce(vi.nb, 0) as visites, round(coalesce(vi.heures, 0)::numeric, 2) as heures,
             coalesce(vi.sans_temps, 0) as visites_sans_temps,
             case when k.company_id = any(v_prix_soc) then round(coalesce(pc.cout, 0), 2) end as pieces, coalesce(pc.sans_prix, 0) as pieces_sans_prix,
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
