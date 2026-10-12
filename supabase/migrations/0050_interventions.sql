-- 0050_interventions.sql : module « Interventions et tournées » (maintenance du matériel de sécurité des clients).
--
-- 1. Module « interventions » (déjà présent dans org_modules, désactivé) : description mise à jour.
-- 2. Réglages du module (itv_settings, une ligne) : préfixe et compteur des étiquettes, forfait de visite,
--    taux de TVA, textes du rapport, observations de site proposées. Rien de propre à un organisme en dur.
-- 3. Types de matériel paramétrables (itv_equipment_types) : périodicité, opérations périodiques (années après
--    fabrication), durée de vie, motifs de non-conformité, source des valeurs, « à confirmer » tant que l'organisme
--    ne les a pas validées. Un jeu de départ est proposé (valeurs sourcées), modifiable et supprimable.
-- 4. Pièces (itv_parts) avec prix, pour le rapport, la facture et le devis.
-- 5. Techniciens (itv_technicians) : comptes du personnel cochés technicien ; nom et téléphone lus dans profiles.
-- 6. Sites : la table sites existante reçoit seulement une position (latitude, longitude). Rien n'est recopié.
-- 7. Parc (itv_equipment), contrats (itv_contracts), visites (itv_visits), lignes de visite (itv_visit_items),
--    pièces fournies (itv_visit_parts).
-- 8. Fonctions : itv_can_write(), itv_next_label(), itv_next_visit_ref(), itv_close_visit(),
--    itv_generate_contract_visits(), itv_dashboard().
-- 9. Bucket privé « interventions » (photos des visites).
-- 10. Démonstration : les lignes itv_* et les comptes de techniciens fictifs inscrits dans demo_records
--     disparaissent avec elles (déclencheur sur demo_records, même méthode que le module Certification).
-- Les règles d'accès des tables existantes ne sont pas modifiées.

-- ── 1. Module ──
update public.org_modules set description = 'Parc de matériel des clients, visites sur téléphone, rapports, planning et tournées, contrats de maintenance'
where key = 'interventions';

-- ── Droit d'écriture : personnel de gestion, ou compte coché technicien ──
create table if not exists public.itv_technicians (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  color text not null default '#1D4ED8',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.itv_can_write()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    public.current_profile_role() in ('superadmin', 'admin', 'direction', 'gestionnaire')
    or exists (select 1 from public.itv_technicians t join public.profiles p on p.id = t.profile_id
               where t.profile_id = auth.uid() and t.is_active and p.is_active),
    false)
$$;

create or replace function public.itv_can_configure()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_profile_role() in ('superadmin', 'admin', 'direction', 'gestionnaire'), false)
$$;

-- ── 2. Réglages ──
create table if not exists public.itv_settings (
  id int primary key default 1 check (id = 1),
  label_prefix text,                         -- vide : initiales de l'entreprise (organization_settings.doc_prefix)
  label_next int not null default 1,
  visit_fee_ht numeric not null default 0,   -- forfait de déplacement et de visite hors contrat
  tva_rate numeric not null default 20,
  report_title text not null default 'Rapport d''intervention',
  report_intro text,                         -- phrase d'introduction du rapport (facultative)
  report_mentions text,                      -- mentions de bas de rapport (certification de l'entreprise, etc.)
  site_observations jsonb not null default '[]'::jsonb, -- observations de site proposées au technicien
  operation_labels jsonb not null default '{}'::jsonb,  -- libellés des opérations, modifiables
  planning_start time not null default '08:30',
  updated_at timestamptz not null default now()
);
insert into public.itv_settings (id, site_observations, operation_labels)
values (1,
  '["Consigne incendie non affichée", "Plan d''évacuation absent ou à mettre à jour", "Signalétique de sécurité manquante ou dégradée", "Accès à un moyen de secours encombré", "Matériel manquant par rapport à la dotation", "Type d''extincteur inadapté au risque"]'::jsonb,
  '{"verification": "Vérification périodique", "maa": "Maintenance additionnelle", "revision": "Révision en atelier", "requalification": "Requalification", "epreuve": "Épreuve", "remplacement": "Remplacement", "mise_en_service": "Mise en service"}'::jsonb)
on conflict (id) do nothing;

-- ── 3. Types de matériel ──
create table if not exists public.itv_equipment_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  family text not null default 'Autre',
  verification_months int not null default 12 check (verification_months > 0),
  operations jsonb not null default '[]'::jsonb,   -- [{ "code": "maa", "label": "...", "years": [5, 15] }] : années après fabrication
  lifespan_years int,                               -- âge de remplacement (vide : aucun)
  defects jsonb not null default '[]'::jsonb,       -- motifs de non-conformité proposés
  fields jsonb not null default '[]'::jsonb,        -- champs facultatifs de la fiche appareil : ["Agent", "Capacité", "Pression"]
  source_note text,                                 -- d'où viennent les valeurs
  is_confirmed boolean not null default false,      -- valeurs validées par l'organisme
  is_active boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── 4. Pièces ──
create table if not exists public.itv_parts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit text not null default 'unité',
  price_ht numeric not null default 0,
  type_id uuid references public.itv_equipment_types(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ── 6. Sites : position sur la carte ──
alter table public.sites add column if not exists latitude double precision;
alter table public.sites add column if not exists longitude double precision;

-- ── 7. Parc, contrats, visites ──
create table if not exists public.itv_equipment (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  type_id uuid not null references public.itv_equipment_types(id),
  label_code text not null unique,
  location text,
  brand text,
  manufactured_year int,
  installed_on date,
  details jsonb not null default '{}'::jsonb,       -- valeurs des champs du type
  status text not null default 'en_service' check (status in ('en_service', 'a_remplacer', 'retire')),
  last_check_on date,
  next_check_on date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists itv_equipment_site_idx on public.itv_equipment (site_id);
create index if not exists itv_equipment_client_idx on public.itv_equipment (client_id);
create index if not exists itv_equipment_next_idx on public.itv_equipment (next_check_on) where status <> 'retire';

create table if not exists public.itv_contracts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  reference text,
  label text not null default 'Contrat de maintenance',
  start_on date not null default current_date,
  end_on date,
  annual_price_ht numeric not null default 0,
  visit_months int[] not null default '{}',          -- mois de visite (1 à 12)
  site_ids uuid[],                                    -- vide : tous les sites du client
  type_ids uuid[],                                    -- vide : tous les types
  status text not null default 'actif' check (status in ('actif', 'suspendu', 'termine')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists itv_contracts_client_idx on public.itv_contracts (client_id);

create table if not exists public.itv_visits (
  id uuid primary key default gen_random_uuid(),
  reference text unique,
  client_id uuid not null references public.clients(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  contract_id uuid references public.itv_contracts(id) on delete set null,
  technician_id uuid references public.profiles(id) on delete set null,
  due_on date,                                        -- échéance (contrat ou appareils)
  planned_on date,
  planned_time time,
  route_order int not null default 0,
  status text not null default 'a_planifier' check (status in ('a_planifier', 'planifiee', 'en_cours', 'terminee', 'annulee')),
  started_at timestamptz,
  finished_at timestamptz,
  signer_name text,
  client_signature text,                              -- image de la signature (data URL)
  observations text,
  site_observations jsonb not null default '[]'::jsonb,
  photos jsonb not null default '[]'::jsonb,           -- chemins dans le bucket « interventions »
  invoice_id uuid references public.invoices(id) on delete set null,
  quote_id uuid references public.quotes(id) on delete set null,
  report_sent_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists itv_visits_planned_idx on public.itv_visits (planned_on, technician_id);
create index if not exists itv_visits_site_idx on public.itv_visits (site_id);
create index if not exists itv_visits_status_idx on public.itv_visits (status);

create table if not exists public.itv_visit_items (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.itv_visits(id) on delete cascade,
  equipment_id uuid not null references public.itv_equipment(id) on delete cascade,
  operation text not null default 'verification',
  result text check (result in ('conforme', 'a_remplacer', 'remplace', 'absent', 'inaccessible')),
  defect text,
  observation text,
  photo_path text,
  checked_at timestamptz,
  unique (visit_id, equipment_id)
);

create table if not exists public.itv_visit_parts (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.itv_visits(id) on delete cascade,
  part_id uuid references public.itv_parts(id) on delete set null,
  label text not null,
  quantity numeric not null default 1,
  unit_price_ht numeric not null default 0,
  created_at timestamptz not null default now()
);

-- ── Règles d'accès des nouvelles tables : lecture pour les comptes connectés ;
--    écriture pour la gestion et les techniciens ; réglages, types et pièces : gestion seulement ──
do $$
declare t text;
begin
  foreach t in array array['itv_technicians', 'itv_settings', 'itv_equipment_types', 'itv_parts', 'itv_equipment',
                           'itv_contracts', 'itv_visits', 'itv_visit_items', 'itv_visit_parts'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_select') then
      execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_select', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_write') then
      if t in ('itv_technicians', 'itv_settings', 'itv_equipment_types', 'itv_parts') then
        execute format('create policy %I on public.%I for all to authenticated using (public.itv_can_configure()) with check (public.itv_can_configure())', t || '_write', t);
      else
        execute format('create policy %I on public.%I for all to authenticated using (public.itv_can_write()) with check (public.itv_can_write())', t || '_write', t);
      end if;
    end if;
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- ── 8. Fonctions ──

-- Prochain code d'étiquette : préfixe des réglages (sinon initiales de l'entreprise) + numéro sur 5 chiffres
create or replace function public.itv_next_label(p_count int default 1)
returns text[]
language plpgsql security definer set search_path = public as $$
declare v_prefix text; v_start int; v_out text[] := '{}'; i int;
begin
  if not public.itv_can_write() then raise exception 'Accès refusé' using errcode = '42501'; end if;
  select coalesce(nullif(trim(s.label_prefix), ''), nullif(trim(o.doc_prefix), ''), 'APP')
    into v_prefix
  from public.itv_settings s left join lateral (select doc_prefix from public.organization_settings limit 1) o on true
  where s.id = 1;
  update public.itv_settings set label_next = label_next + greatest(p_count, 1), updated_at = now()
    where id = 1 returning label_next - greatest(p_count, 1) into v_start;
  for i in 0 .. greatest(p_count, 1) - 1 loop
    v_out := v_out || (upper(v_prefix) || '-' || lpad((v_start + i)::text, 5, '0'));
  end loop;
  return v_out;
end $$;

-- Référence de visite : ITV-AAAA-NNNN
create or replace function public.itv_visit_ref()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_year text := to_char(coalesce(new.planned_on, new.due_on, current_date), 'YYYY'); v_n int;
begin
  if new.reference is null or new.reference = '' then
    select coalesce(max(nullif(regexp_replace(reference, '^ITV-\d{4}-', ''), reference)::int), 0) + 1 into v_n
    from public.itv_visits where reference like 'ITV-' || v_year || '-%';
    new.reference := 'ITV-' || v_year || '-' || lpad(v_n::text, 4, '0');
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists itv_visit_ref on public.itv_visits;
create trigger itv_visit_ref before insert or update on public.itv_visits
  for each row execute function public.itv_visit_ref();

-- Clôture d'une visite : fige la visite, met à jour la dernière et la prochaine vérification de chaque appareil.
-- Conforme ou remplacé : prochaine = date de la visite + périodicité du type. Remplacé : année de fabrication remise
-- à l'année de la visite. À remplacer : statut de l'appareil « à remplacer ». Absent ou inaccessible : échéance inchangée.
create or replace function public.itv_close_visit(p_visit uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.itv_visits%rowtype; v_day date; n_ok int; n_ko int; n_rp int; n_other int;
begin
  if not public.itv_can_write() then raise exception 'Accès refusé' using errcode = '42501'; end if;
  select * into v from public.itv_visits where id = p_visit for update;
  if not found then raise exception 'Visite introuvable'; end if;
  v_day := coalesce((v.started_at at time zone 'Europe/Paris')::date, v.planned_on, current_date);

  update public.itv_equipment e set
    last_check_on = v_day,
    next_check_on = (v_day + make_interval(months => t.verification_months))::date,
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
end $$;

-- Visites de l'année générées par un contrat : une visite « à planifier » par mois de visite et par site couvert,
-- sauf si elle existe déjà. Retourne le nombre de visites créées.
create or replace function public.itv_generate_contract_visits(p_contract uuid, p_year int default extract(year from current_date)::int)
returns int
language plpgsql security definer set search_path = public as $$
declare c public.itv_contracts%rowtype; m int; s record; v_due date; n int := 0;
begin
  if not public.itv_can_write() then raise exception 'Accès refusé' using errcode = '42501'; end if;
  select * into c from public.itv_contracts where id = p_contract;
  if not found then raise exception 'Contrat introuvable'; end if;
  foreach m in array coalesce(c.visit_months, '{}') loop
    v_due := make_date(p_year, m, 1);
    if v_due < date_trunc('month', c.start_on)::date or (c.end_on is not null and v_due > c.end_on) then continue; end if;
    for s in select id from public.sites
             where client_id = c.client_id and is_active
               and (c.site_ids is null or cardinality(c.site_ids) = 0 or id = any(c.site_ids)) loop
      if not exists (select 1 from public.itv_visits where contract_id = c.id and site_id = s.id
                     and date_trunc('month', due_on) = date_trunc('month', v_due) and status <> 'annulee') then
        insert into public.itv_visits (client_id, site_id, contract_id, due_on, status)
        values (c.client_id, s.id, c.id, v_due, 'a_planifier');
        n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end $$;

-- Chiffres du tableau de bord : appareils en retard, sites à planifier ce mois-ci, remplacements à chiffrer
create or replace function public.itv_dashboard()
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'late_equipment', (select count(*) from itv_equipment where status <> 'retire' and next_check_on < current_date),
    'late_sites', (select count(distinct site_id) from itv_equipment where status <> 'retire' and next_check_on < current_date),
    'due_month_sites', (select count(distinct site_id) from itv_equipment where status <> 'retire'
                         and next_check_on >= current_date and next_check_on < (date_trunc('month', current_date) + interval '1 month')::date),
    'to_quote', (select count(*) from itv_visit_items i join itv_visits v on v.id = i.visit_id
                 where i.result = 'a_remplacer' and v.status = 'terminee' and v.quote_id is null),
    'today_visits', (select count(*) from itv_visits where planned_on = current_date and status in ('planifiee', 'en_cours')),
    'unplanned_contract_visits', (select count(*) from itv_visits where status = 'a_planifier' and due_on < (current_date + 31))
  )
$$;

revoke all on function public.itv_can_write() from public, anon;
revoke all on function public.itv_can_configure() from public, anon;
revoke all on function public.itv_next_label(int) from public, anon;
revoke all on function public.itv_close_visit(uuid) from public, anon;
revoke all on function public.itv_generate_contract_visits(uuid, int) from public, anon;
revoke all on function public.itv_dashboard() from public, anon;
grant execute on function public.itv_can_write() to authenticated;
grant execute on function public.itv_can_configure() to authenticated;
grant execute on function public.itv_next_label(int) to authenticated;
grant execute on function public.itv_close_visit(uuid) to authenticated;
grant execute on function public.itv_generate_contract_visits(uuid, int) to authenticated;
grant execute on function public.itv_dashboard() to authenticated;

-- ── 9. Photos des visites : bucket privé ──
insert into storage.buckets (id, name, public) values ('interventions', 'interventions', false) on conflict (id) do nothing;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'interventions_read') then
    create policy interventions_read on storage.objects for select to authenticated
      using (bucket_id = 'interventions' and public.itv_can_write());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'interventions_insert') then
    create policy interventions_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'interventions' and public.itv_can_write());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'interventions_remove') then
    create policy interventions_remove on storage.objects for delete to authenticated
      using (bucket_id = 'interventions' and public.itv_can_write());
  end if;
end $$;

-- ── 10. Démonstration : une ligne itv_* ou un compte fictif inscrit dans demo_records disparaît avec elle ──
-- (les visites, appareils et contrats des clients fictifs partent déjà avec leur client, par cascade)
create or replace function public.itv_demo_record_deleted()
returns trigger language plpgsql security definer set search_path = public, auth as $$
begin
  if old.tbl in ('itv_equipment', 'itv_contracts', 'itv_visits', 'itv_parts', 'sites') then
    execute format('delete from public.%I where id = $1', old.tbl) using old.id;
  elsif old.tbl = 'auth_users' then
    delete from auth.users where id = old.id;
  end if;
  return old;
end $$;
drop trigger if exists itv_demo_record_deleted on public.demo_records;
create trigger itv_demo_record_deleted after delete on public.demo_records
  for each row execute function public.itv_demo_record_deleted();

insert into public.schema_migrations (version) values ('0050_interventions') on conflict (version) do nothing;
