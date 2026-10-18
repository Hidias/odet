-- 0374_droits_prix_terrain.sql : prix cachés au technicien EN BASE (chantier C1b, décision du 17/10).
--
-- Depuis 0373, la lecture de itv_parts, itv_settings et itv_visit_parts (qui portent des prix) demande le droit
-- « Voir les prix des interventions » (interventions.tarifs.voir), que le modèle « technicien » n'a pas.
-- Le technicien lit à la place trois vues SANS AUCUNE colonne de prix, limitées à ses missions :
--   itv_parts_terrain         : catalogue des pièces (nom, unité, type), sans price_ht ;
--   itv_settings_terrain      : réglages du module, sans visit_fee_ht (forfait de visite) ;
--   itv_visit_parts_terrain   : pièces fournies des visites de ses clients, sans unit_price_ht.
-- Il ajoute, change la quantité et retire les pièces fournies de SES visites par trois fonctions contrôlées
-- (itv_visit_part_add, itv_visit_part_set_quantity, itv_visit_part_remove) : le prix unitaire est pris dans le
-- catalogue par la base, jamais envoyé ni renvoyé au technicien. Les comptes qui ont le droit des prix gardent la
-- lecture et l'écriture directes, inchangées.
--
-- Les vues sont exécutées avec les droits de leur propriétaire (vues « security definer ») : elles filtrent
-- elles-mêmes par les droits (fonction unique app.a_le_droit) et par le module Interventions. Le conseiller de
-- sécurité de Supabase les signale à ce titre : c'est voulu (colonnes choisies, lignes filtrées).
-- Migration idempotente. Retour arrière : supabase/rollback/0370-0375_droits_retour.sql

create or replace view public.itv_parts_terrain with (security_barrier = true) as
select p.id, p.name, p.unit, p.type_id, p.is_active, p.created_at
from public.itv_parts p
where (select app.module_on('interventions'))
  and ((select app.a_le_droit('interventions.missions.voir'))
       or (select app.a_le_droit('interventions.referentiel.voir')));
comment on view public.itv_parts_terrain is 'Catalogue des pièces sans prix (technicien) : jamais de colonne de prix';

create or replace view public.itv_settings_terrain with (security_barrier = true) as
select s.id, s.label_prefix, s.label_next, s.tva_rate, s.report_title, s.report_intro, s.report_mentions,
       s.site_observations, s.operation_labels, s.planning_start, s.updated_at
from public.itv_settings s
where (select app.module_on('interventions'))
  and ((select app.a_le_droit('interventions.missions.voir'))
       or (select app.a_le_droit('interventions.referentiel.voir')));
comment on view public.itv_settings_terrain is 'Réglages du module Interventions sans le forfait de visite (technicien)';

create or replace view public.itv_visit_parts_terrain with (security_barrier = true) as
select vp.id, vp.visit_id, vp.part_id, vp.label, vp.quantity, vp.created_at
from public.itv_visit_parts vp
where (select app.module_on('interventions'))
  and ((select app.a_le_droit('interventions.visites.voir'))
       or ((select app.a_le_droit('interventions.missions.voir'))
           and vp.visit_id in (select app.tech_scope_visit_ids())));
comment on view public.itv_visit_parts_terrain is 'Pièces fournies des visites sans prix unitaire (technicien : visites de ses clients)';

revoke all on public.itv_parts_terrain, public.itv_settings_terrain, public.itv_visit_parts_terrain from public, anon;
grant select on public.itv_parts_terrain, public.itv_settings_terrain, public.itv_visit_parts_terrain to authenticated, service_role;

-- Le compte connecté peut-il écrire les pièces fournies de cette visite ?
create or replace function app.itv_can_edit_visit_parts(p_visit uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select app.module_on('interventions'))
    and ((select app.a_le_droit('interventions.visites.gerer'))
         or ((select app.a_le_droit('interventions.missions.realiser'))
             and p_visit in (select app.tech_visit_ids()))), false)
$$;

-- Ligne renvoyée au navigateur : jamais de prix
create or replace function app.itv_visit_part_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', vp.id, 'visit_id', vp.visit_id, 'part_id', vp.part_id, 'label', vp.label,
                            'quantity', vp.quantity, 'created_at', vp.created_at)
  from public.itv_visit_parts vp where vp.id = p_id
$$;

-- Ajout d'une pièce fournie (prix unitaire pris dans le catalogue par la base ; saisie libre : 0)
create or replace function public.itv_visit_part_add(p_visit uuid, p_part uuid default null, p_label text default null,
                                                     p_quantity numeric default 1)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_price numeric := 0;
  v_id uuid;
begin
  if not app.itv_can_edit_visit_parts(p_visit) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if coalesce(p_quantity, 0) <= 0 then
    raise exception 'Quantité invalide' using errcode = '22023';
  end if;
  if p_part is not null then
    select p.name, p.price_ht into v_name, v_price from public.itv_parts p where p.id = p_part;
    if v_name is null then
      raise exception 'Pièce inconnue' using errcode = '22023';
    end if;
  end if;
  v_name := coalesce(nullif(btrim(p_label), ''), v_name);
  if v_name is null then
    raise exception 'Libellé de la pièce manquant' using errcode = '22023';
  end if;
  insert into public.itv_visit_parts (visit_id, part_id, label, quantity, unit_price_ht)
  values (p_visit, p_part, left(v_name, 300), p_quantity, coalesce(v_price, 0))
  returning id into v_id;
  return app.itv_visit_part_json(v_id);
end
$$;

-- Nouvelle quantité d'une pièce fournie
create or replace function public.itv_visit_part_set_quantity(p_id uuid, p_quantity numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_visit uuid;
begin
  select vp.visit_id into v_visit from public.itv_visit_parts vp where vp.id = p_id;
  if v_visit is null or not app.itv_can_edit_visit_parts(v_visit) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if coalesce(p_quantity, 0) <= 0 then
    raise exception 'Quantité invalide' using errcode = '22023';
  end if;
  update public.itv_visit_parts set quantity = p_quantity where id = p_id;
  return app.itv_visit_part_json(p_id);
end
$$;

-- Retrait d'une pièce fournie
create or replace function public.itv_visit_part_remove(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_visit uuid;
begin
  select vp.visit_id into v_visit from public.itv_visit_parts vp where vp.id = p_id;
  if v_visit is null or not app.itv_can_edit_visit_parts(v_visit) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  delete from public.itv_visit_parts where id = p_id;
end
$$;

revoke all on function app.itv_can_edit_visit_parts(uuid), app.itv_visit_part_json(uuid) from public, anon, authenticated;
revoke all on function public.itv_visit_part_add(uuid, uuid, text, numeric), public.itv_visit_part_set_quantity(uuid, numeric),
  public.itv_visit_part_remove(uuid) from public, anon;
grant execute on function public.itv_visit_part_add(uuid, uuid, text, numeric), public.itv_visit_part_set_quantity(uuid, numeric),
  public.itv_visit_part_remove(uuid) to authenticated, service_role;

insert into public.schema_migrations (version) values ('0374_droits_prix_terrain') on conflict (version) do nothing;
