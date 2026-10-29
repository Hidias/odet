-- 0463 : contrats de maintenance, lot 4 : inventaire initial et prix d'après le parc.
--
-- 1. Nature de l'intervention (itv_visits.kind) : vérification (défaut), inventaire, dépannage, installation, livraison,
--    mise en service, exercice d'évacuation. Le lot 4 se sert de « inventaire », le lot 5 des autres.
-- 2. Prix par type d'appareil (par appareil et par an, HT), propre à chaque société (itv_type_prices), et tarif
--    propre à un client (client_prices, kind 'equipement'), qui passe avant.
-- 3. Prix de l'inventaire initial et délai de déduction (billing_settings) : l'inventaire est facturé ; si le contrat
--    est signé dans le délai, la première échéance le déduit (une seule fois, tracé sur la visite).
-- 4. public.contrat_prix_parc(contrat) : nombre d'appareils couverts par type, prix retenu et sa source, total, types
--    sans prix. Rien n'est appliqué sans action : l'écran propose, l'utilisateur applique (contrat non signé) ou
--    prépare un avenant (contrat signé).
-- 5. Déclaration du matériel par le client depuis son espace (itv_parc_declarations) : il indique ce qu'il pense avoir,
--    le technicien le reprend au parc lors de la visite d'inventaire, ou l'écarte. Rien n'entre au parc sans lui.
-- 6. Appareil ajouté au parc d'un client sous contrat signé : rappel « avenant à proposer » (une fois par contrat et
--    par mois), jamais de changement de prix automatique.
--
-- Retour arrière (manuel) : en fin de fichier.

-- ── 1. Nature de l'intervention ──
alter table public.itv_visits add column if not exists kind text not null default 'verification';
alter table public.itv_visits add column if not exists deducted_in_invoice_id uuid references public.invoices(id) on delete set null;
do $$ begin
  alter table public.itv_visits add constraint itv_visits_kind_check check (kind in
    ('verification', 'inventaire', 'depannage', 'installation', 'livraison', 'mise_en_service', 'exercice_evacuation'));
exception when duplicate_object then null; end $$;
comment on column public.itv_visits.kind is '0463 : nature de l''intervention (vérification par défaut).';
comment on column public.itv_visits.deducted_in_invoice_id is '0463 : facture d''échéance qui a déduit cet inventaire (une seule fois).';

-- ── 2. Prix par type d'appareil ──
create table if not exists public.itv_type_prices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  type_id uuid not null references public.itv_equipment_types(id) on delete cascade,
  price_ht numeric not null check (price_ht >= 0 and price_ht <= 100000),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (company_id, type_id)
);
comment on table public.itv_type_prices is '0463 : prix de vérification par appareil et par an (HT), par société et par type d''appareil.';
alter table public.itv_type_prices enable row level security;
drop policy if exists itv_type_prices_sel on public.itv_type_prices;
create policy itv_type_prices_sel on public.itv_type_prices for select to authenticated
  using (company_id in (select app.societes_lisibles())
    and (((select app.module_on('interventions')) and ((select app.a_le_droit('interventions.contrats.voir')) or (select app.a_le_droit('interventions.tarifs.voir'))))
      or (select app.is_superadmin())));
drop policy if exists itv_type_prices_ecr on public.itv_type_prices;
create policy itv_type_prices_ecr on public.itv_type_prices for all to authenticated
  using (company_id in (select app.societes_ecriture()) and (select app.module_on('interventions')) and (select app.a_le_droit('interventions.contrats.gerer')))
  with check (company_id in (select app.societes_ecriture()) and (select app.module_on('interventions')) and (select app.a_le_droit('interventions.contrats.gerer')));
revoke all on public.itv_type_prices from anon, authenticated;
grant select, insert, update, delete on public.itv_type_prices to authenticated;

-- Tarif d'un client par type d'appareil
alter table public.client_prices add column if not exists equipment_type_id uuid references public.itv_equipment_types(id) on delete cascade;
alter table public.client_prices drop constraint if exists client_prices_kind_check;
alter table public.client_prices add constraint client_prices_kind_check
  check (kind in ('formation', 'piece', 'remise_pieces', 'deplacement', 'visite', 'equipement'));
alter table public.client_prices drop constraint if exists client_prices_equipement_check;
alter table public.client_prices add constraint client_prices_equipement_check
  check (kind <> 'equipement' or (equipment_type_id is not null and prix_ht is not null));
drop index if exists public.client_prices_unique;
create unique index client_prices_unique on public.client_prices
  (client_id, kind, coalesce(course_id, part_id, equipment_type_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(code, ''));

-- ── 3. Réglages ──
alter table public.billing_settings add column if not exists contrat_prix_inventaire numeric check (contrat_prix_inventaire is null or contrat_prix_inventaire >= 0);
alter table public.billing_settings add column if not exists contrat_deduction_jours integer not null default 30 check (contrat_deduction_jours between 0 and 365);
comment on column public.billing_settings.contrat_prix_inventaire is '0463 : prix HT de l''inventaire initial ; vide = non réglé (la facture d''inventaire ne se prépare pas).';
comment on column public.billing_settings.contrat_deduction_jours is '0463 : l''inventaire est déduit de la première échéance si le contrat est signé dans ce délai après l''inventaire.';

-- ── 4. Prix d'après le parc ──
create or replace function app.contrat_prix_parc(p_contract uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  k public.itv_contracts;
  v_lignes jsonb;
begin
  select * into k from public.itv_contracts where id = p_contract;
  if k.id is null then return null; end if;
  with parc as (
    select q.type_id, count(*) as nb
    from public.itv_equipment q
    where q.client_id = k.client_id and q.status <> 'retire'
      and (k.site_ids is null or cardinality(k.site_ids) = 0 or q.site_id = any(k.site_ids))
      and (k.type_ids is null or cardinality(k.type_ids) = 0 or q.type_id = any(k.type_ids))
    group by q.type_id
  ), prix as (
    select p.type_id, p.nb, t.name,
           cp.prix_ht as prix_client, tp.price_ht as prix_type
    from parc p
    join public.itv_equipment_types t on t.id = p.type_id
    left join lateral (select c.prix_ht from public.client_prices c
      where c.client_id = k.client_id and c.kind = 'equipement' and c.equipment_type_id = p.type_id
        and (c.valid_until is null or c.valid_until >= current_date) limit 1) cp on true
    left join public.itv_type_prices tp on tp.company_id = k.company_id and tp.type_id = p.type_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'type_id', type_id, 'type', name, 'nb', nb,
           'prix', coalesce(prix_client, prix_type),
           'source', case when prix_client is not null then 'client' when prix_type is not null then 'type' else 'manquant' end,
           'total', case when coalesce(prix_client, prix_type) is null then null else round(nb * coalesce(prix_client, prix_type), 2) end)
         order by name), '[]'::jsonb)
    into v_lignes
  from prix;
  return jsonb_build_object(
    'lignes', v_lignes,
    'appareils', coalesce((select sum((l->>'nb')::int) from jsonb_array_elements(v_lignes) l), 0),
    'total', coalesce((select sum((l->>'total')::numeric) from jsonb_array_elements(v_lignes) l where l->>'total' is not null), 0),
    'manquants', coalesce((select jsonb_agg(l->>'type') from jsonb_array_elements(v_lignes) l where l->>'source' = 'manquant'), '[]'::jsonb),
    'prix_actuel', k.annual_price_ht,
    'signe', k.signed_at is not null or coalesce(k.signed_on_paper, false));
end
$$;
revoke all on function app.contrat_prix_parc(uuid) from public, anon, authenticated;

create or replace function public.contrat_prix_parc(p_contract uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_right('interventions.contrats.voir');
  perform app.exiger_societe('itv_contracts', p_contract, false);
  return app.contrat_prix_parc(p_contract);
end
$$;
revoke all on function public.contrat_prix_parc(uuid) from public, anon;
grant execute on function public.contrat_prix_parc(uuid) to authenticated;

-- ── 3 bis. Déduction de l'inventaire sur la première échéance préparée ──
-- Déclenché quand une échéance passe à « préparée » : si une visite d'inventaire de ce client a été facturée, n'a pas
-- encore été déduite, et que le contrat a été signé (ou validé) dans le délai réglé après la fin de l'inventaire, une
-- ligne négative « Déduction de l'inventaire initial » est ajoutée (au plus le montant de l'échéance).
create or replace function app.contrat_deduire_inventaire()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.itv_contracts;
  v record;
  v_jours int;
  v_montant numeric;
  v_tva numeric;
  v_ht numeric;
  v_pos int;
  v_ref text;
begin
  if not (old.status = 'a_facturer' and new.status = 'preparee' and new.invoice_id is not null) then return new; end if;
  select * into k from public.itv_contracts where id = new.contract_id;
  if exists (select 1 from public.itv_visits w join public.itv_contract_installments e2 on e2.invoice_id = w.deducted_in_invoice_id
             where e2.contract_id = k.id) then return new; end if;
  select coalesce(contrat_deduction_jours, 30) into v_jours from public.billing_settings where company_id = k.company_id;
  v_jours := coalesce(v_jours, 30);
  select w.id, w.invoice_id, w.finished_at into v
  from public.itv_visits w
  join public.invoices i on i.id = w.invoice_id
  where w.client_id = k.client_id and w.kind = 'inventaire' and w.status = 'terminee' and w.deducted_in_invoice_id is null
    and i.status not in ('draft', 'cancelled') and coalesce(i.type, 'invoice') = 'invoice'
    and coalesce(k.signed_at, k.validated_at, now())::date between w.finished_at::date and w.finished_at::date + v_jours
  order by w.finished_at desc
  limit 1;
  if v.id is null then return new; end if;
  select coalesce(sum(ii.total_ht), 0) into v_montant from public.invoice_items ii where ii.invoice_id = v.invoice_id and ii.code = 'INVENTAIRE';
  select ht.total_ht into v_ht from public.invoices ht where ht.id = new.invoice_id;
  v_montant := least(v_montant, coalesce(v_ht, 0));
  if v_montant <= 0 then return new; end if;
  select coalesce(tva_rate, 20) into v_tva from public.itv_settings limit 1;
  v_tva := coalesce(v_tva, 20);
  select coalesce(max(position), -1) + 1 into v_pos from public.invoice_items where invoice_id = new.invoice_id;
  select reference into v_ref from public.invoices where id = v.invoice_id;
  insert into public.invoice_items (invoice_id, company_id, position, code, description_title, description_detail, quantity, unit, unit_price_ht, tva_rate, total_ht, nature, vat_regime)
  values (new.invoice_id, k.company_id, v_pos, 'INVENTAIRE-DEDUIT', 'Déduction de l''inventaire initial',
          'Inventaire facturé' || coalesce(' (facture ' || v_ref || ')', '') || ', déduit car le contrat a été signé dans les ' || v_jours || ' jours',
          1, 'forfait', -v_montant, v_tva, -v_montant, 'service', 'normal');
  update public.invoices set
    total_ht = total_ht - v_montant, total_net_ht = total_net_ht - v_montant,
    total_tva = round((total_net_ht - v_montant) * v_tva / 100, 2),
    total_ttc = (total_net_ht - v_montant) + round((total_net_ht - v_montant) * v_tva / 100, 2),
    amount_due = (total_net_ht - v_montant) + round((total_net_ht - v_montant) * v_tva / 100, 2)
  where id = new.invoice_id;
  -- (champ hors rapport : la visite terminée reste figée pour tout le reste)
  update public.itv_visits set deducted_in_invoice_id = new.invoice_id, updated_at = now() where id = v.id;
  return new;
end
$$;
revoke all on function app.contrat_deduire_inventaire() from public, anon, authenticated;
drop trigger if exists itv_contract_installments_inventaire on public.itv_contract_installments;
create trigger itv_contract_installments_inventaire after update of status on public.itv_contract_installments
  for each row execute function app.contrat_deduire_inventaire();

-- ── 5. Déclaration du matériel par le client ──
create table if not exists public.itv_parc_declarations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  site_id uuid references public.sites(id) on delete set null,
  type_id uuid not null references public.itv_equipment_types(id) on delete cascade,
  quantity integer not null check (quantity between 1 and 500),
  location text check (location is null or length(location) <= 300),
  brand text check (brand is null or length(brand) <= 120),
  manufactured_year integer check (manufactured_year is null or manufactured_year between 1950 and 2100),
  notes text check (notes is null or length(notes) <= 1000),
  status text not null default 'declaree' check (status in ('declaree', 'reprise', 'ecartee')),
  handled_at timestamptz,
  handled_by uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists itv_parc_declarations_client_idx on public.itv_parc_declarations (client_id, status);
comment on table public.itv_parc_declarations is '0463 : matériel déclaré par le client depuis son espace, repris au parc (ou écarté) par l''organisme.';
alter table public.itv_parc_declarations enable row level security;
drop policy if exists itv_parc_declarations_sel on public.itv_parc_declarations;
create policy itv_parc_declarations_sel on public.itv_parc_declarations for select to authenticated
  using (company_id in (select app.societes_lisibles())
    and (((select app.module_on('interventions')) and ((select app.a_le_droit('interventions.parc.voir'))
      or ((select app.a_le_droit('interventions.missions.voir')) and client_id in (select app.tech_client_ids()))))
      or (select app.is_superadmin())));
revoke all on public.itv_parc_declarations from anon, authenticated;
grant select on public.itv_parc_declarations to authenticated;

-- Espace entreprise : types proposés et déclarations en cours
create or replace function public.ent_parc_declarations()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.client_accounts := app.ent_compte();
  v_sites uuid[] := app.ent_sites(v);
begin
  return jsonb_build_object(
    'types', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'family', t.family) order by t.sort_order, t.name)
      from public.itv_equipment_types t where t.is_active and v.company_id = any(t.company_ids)), '[]'::jsonb),
    'declarations', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'type', t.name, 'quantity', d.quantity, 'location', d.location,
        'site', s.name, 'status', d.status, 'created_at', d.created_at) order by d.created_at desc)
      from public.itv_parc_declarations d join public.itv_equipment_types t on t.id = d.type_id left join public.sites s on s.id = d.site_id
      where d.client_id = v.client_id and d.company_id = v.company_id and d.created_at > now() - interval '1 year'
        and (v_sites is null or d.site_id = any(v_sites))), '[]'::jsonb));
end
$$;
revoke all on function public.ent_parc_declarations() from public, anon;
grant execute on function public.ent_parc_declarations() to authenticated;

create or replace function public.ent_parc_declarer(p_site uuid, p_type uuid, p_quantity integer, p_location text, p_brand text, p_year integer, p_notes text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.client_accounts := app.ent_compte();
  v_sites uuid[] := app.ent_sites(v);
  v_id uuid;
begin
  if p_site is not null and not exists (select 1 from public.sites s where s.id = p_site and s.client_id = v.client_id) then
    raise exception 'Site inconnu' using errcode = '22023';
  end if;
  if v_sites is not null and (p_site is null or not (p_site = any (v_sites))) then
    raise exception 'Site non autorisé' using errcode = '42501';
  end if;
  if not exists (select 1 from public.itv_equipment_types t where t.id = p_type and t.is_active and v.company_id = any(t.company_ids)) then
    raise exception 'Type de matériel inconnu' using errcode = '22023';
  end if;
  if coalesce(p_quantity, 0) < 1 or p_quantity > 500 then raise exception 'Nombre invalide (1 à 500)' using errcode = '22023'; end if;
  if (select count(*) from public.itv_parc_declarations d where d.client_id = v.client_id and d.created_at > now() - interval '1 day') >= 200 then
    raise exception 'Trop de déclarations aujourd''hui' using errcode = '54000';
  end if;
  insert into public.itv_parc_declarations (company_id, client_id, site_id, type_id, quantity, location, brand, manufactured_year, notes)
  values (v.company_id, v.client_id, p_site, p_type, p_quantity, nullif(left(btrim(coalesce(p_location, '')), 300), ''),
          nullif(left(btrim(coalesce(p_brand, '')), 120), ''), case when p_year between 1950 and 2100 then p_year end,
          nullif(left(btrim(coalesce(p_notes, '')), 1000), ''))
  returning id into v_id;
  return v_id;
end
$$;
revoke all on function public.ent_parc_declarer(uuid, uuid, integer, text, text, integer, text) from public, anon;
grant execute on function public.ent_parc_declarer(uuid, uuid, integer, text, text, integer, text) to authenticated;

-- Organisme : reprise au parc (les appareils sont créés par l'écran, avec leurs étiquettes) ou mise à l'écart
create or replace function public.parc_declaration_traiter(p_declaration uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare d public.itv_parc_declarations;
begin
  if p_status not in ('reprise', 'ecartee') then raise exception 'Statut invalide' using errcode = '22023'; end if;
  select * into d from public.itv_parc_declarations where id = p_declaration;
  if d.id is null then raise exception 'Déclaration introuvable' using errcode = 'P0002'; end if;
  if not (app.is_superadmin() or (d.company_id in (select app.societes_ecriture()) and app.module_on('interventions')
      and (app.a_le_droit('interventions.parc.gerer') or (app.a_le_droit('interventions.parc.annoter') and d.client_id in (select app.tech_client_ids()))))) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  update public.itv_parc_declarations set status = p_status, handled_at = now(), handled_by = auth.uid() where id = d.id;
end
$$;
revoke all on function public.parc_declaration_traiter(uuid, text) from public, anon;
grant execute on function public.parc_declaration_traiter(uuid, text) to authenticated;

-- ── 6. Appareil ajouté sous contrat signé : avenant à proposer ──
create or replace function app.parc_ajout_sous_contrat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.scheduled_actions (company_id, kind, target_table, target_id, client_id, due_on, title, payload, dedup_key)
  select k.company_id, 'rappel', 'itv_contracts', k.id, k.client_id, current_date,
         'Parc de ' || c.name || ' modifié : avenant de prix à proposer',
         jsonb_build_object('interne', true, 'lien', '/interventions/contrats?contrat=' || k.id,
           'texte', 'Du matériel a été ajouté au parc de ' || c.name || ' alors que son contrat ' || coalesce(nullif(k.label, ''), 'de maintenance')
             || ' est signé. Ouvrez le contrat, « Prix d''après le parc » : l''écart est calculé et l''avenant se prépare depuis le devis du contrat.'),
         'parc_avenant:' || k.id || ':' || to_char(current_date, 'YYYY-MM')
  from public.itv_contracts k join public.clients c on c.id = k.client_id
  where k.client_id = new.client_id and k.status = 'actif' and (k.signed_at is not null or coalesce(k.signed_on_paper, false))
    and (k.site_ids is null or cardinality(k.site_ids) = 0 or new.site_id = any(k.site_ids))
    and (k.type_ids is null or cardinality(k.type_ids) = 0 or new.type_id = any(k.type_ids))
    and k.created_at < now() - interval '1 hour'
  on conflict (company_id, dedup_key) do nothing;
  return new;
end
$$;
revoke all on function app.parc_ajout_sous_contrat() from public, anon, authenticated;
drop trigger if exists itv_equipment_avenant on public.itv_equipment;
create trigger itv_equipment_avenant after insert on public.itv_equipment
  for each row execute function app.parc_ajout_sous_contrat();

-- Retour arrière (manuel) :
-- drop trigger if exists itv_equipment_avenant on public.itv_equipment; drop function if exists app.parc_ajout_sous_contrat();
-- drop function if exists public.parc_declaration_traiter(uuid, text); drop function if exists public.ent_parc_declarer(uuid, uuid, integer, text, text, integer, text);
-- drop function if exists public.ent_parc_declarations(); drop table if exists public.itv_parc_declarations;
-- drop trigger if exists itv_contract_installments_inventaire on public.itv_contract_installments; drop function if exists app.contrat_deduire_inventaire();
-- drop function if exists public.contrat_prix_parc(uuid); drop function if exists app.contrat_prix_parc(uuid);
-- alter table public.billing_settings drop column if exists contrat_deduction_jours, drop column if exists contrat_prix_inventaire;
-- (client_prices : remettre l'index unique et la contrainte de 0418, après suppression des lignes 'equipement')
-- drop table if exists public.itv_type_prices;
-- alter table public.itv_visits drop constraint if exists itv_visits_kind_check, drop column if exists deducted_in_invoice_id, drop column if exists kind;
