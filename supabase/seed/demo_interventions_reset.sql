-- Remise à zéro des visites de démonstration du vendredi 16 octobre 2026 (après les répétitions).
-- À coller dans l'éditeur SQL de Supabase (contient des suppressions : l'outil de Claude ne l'exécute pas).
-- Touche seulement les visites du 16/10 des clients fictifs : contrôles, pièces, photos, signature, facture et
-- devis préparés pendant la répétition ; échéances des appareils recalculées depuis la dernière visite terminée ;
-- appareils ajoutés pendant la répétition retirés. Ordre de passage d'origine remis.

begin;

create temporary table _demo16 on commit drop as
select v.id, v.site_id, v.invoice_id, v.quote_id from public.itv_visits v
join public.demo_records r on r.id = v.client_id and r.tbl = 'clients'
where v.planned_on = '2026-10-16'
   or v.reference in ('ITV-2026-0024', 'ITV-2026-0025', 'ITV-2026-0026', 'ITV-2026-0027', 'ITV-2026-0028'); -- même si déplacées pendant les répétitions

-- Facture et devis préparés depuis ces visites
update public.itv_visits set invoice_id = null, quote_id = null where id in (select id from _demo16);
delete from public.invoice_items where invoice_id in (select invoice_id from _demo16 where invoice_id is not null);
delete from public.invoices where id in (select invoice_id from _demo16 where invoice_id is not null);
delete from public.quote_items where quote_id in (select quote_id from _demo16 where quote_id is not null);
delete from public.quotes where id in (select quote_id from _demo16 where quote_id is not null);

-- Appareils ajoutés sur place pendant la répétition (mise en service), puis contrôles et pièces
delete from public.itv_equipment where id in (
  select i.equipment_id from public.itv_visit_items i where i.visit_id in (select id from _demo16) and i.operation = 'mise_en_service');
delete from public.itv_visit_items where visit_id in (select id from _demo16);
delete from public.itv_visit_parts where visit_id in (select id from _demo16);

update public.itv_visits set status = 'planifiee', planned_on = '2026-10-16', started_at = null, finished_at = null, signer_name = null, client_signature = null,
  observations = null, site_observations = '[]'::jsonb, photos = '[]'::jsonb, report_sent_at = null
where id in (select id from _demo16);

-- Échéances des appareils des sites concernés : depuis la dernière visite terminée
update public.itv_equipment e set
  last_check_on = x.last_day,
  next_check_on = (x.last_day + make_interval(months => t.verification_months))::date,
  status = case when e.status = 'retire' then 'retire' when x.result = 'a_remplacer' then 'a_remplacer' else 'en_service' end
from (
  select distinct on (i.equipment_id) i.equipment_id, v.planned_on as last_day, i.result
  from public.itv_visit_items i join public.itv_visits v on v.id = i.visit_id
  where v.status = 'terminee' and v.site_id in (select site_id from _demo16)
  order by i.equipment_id, v.planned_on desc
) x, public.itv_equipment_types t
where e.id = x.equipment_id and t.id = e.type_id;

-- Ordre de passage d'origine (heure prévue)
update public.itv_visits v set route_order = o.n
from (select id, row_number() over (partition by technician_id order by planned_time) as n from public.itv_visits where id in (select id from _demo16)) o
where v.id = o.id;

commit;

-- Contrôle : 5 visites planifiées, aucune ligne de contrôle
select v.reference, c.name, v.status, (select count(*) from public.itv_visit_items i where i.visit_id = v.id) as lignes
from public.itv_visits v join public.clients c on c.id = v.client_id
where v.planned_on = '2026-10-16' order by v.technician_id, v.route_order;
