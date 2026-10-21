-- 0394 : EPI remis au personnel, reliés au stock, fiche de remise signée (liste unique A5).
--   1. Articles du stock marqués EPI (stock_items.ppe), avec une durée de renouvellement indicative en mois.
--   2. Remises (hr_ppe_handovers) : personne, article, quantité, taille, date, renouvellement, signature du salarié.
--      À l'enregistrement, la base sort l'article de l'emplacement choisi (dépôt, camion) : pas de double saisie.
--      Une remise annulée (supprimée) remet l'article à son emplacement par un ajustement tracé (sans toucher au coût moyen).
--   3. Code du travail : les EPI sont fournis gratuitement par l'employeur (R4323-95), adaptés à la personne, et
--      remplacés dès qu'ils sont usés ; la signature n'est pas imposée mais prouve la remise.
-- Idempotent.

-- ── 1. Articles EPI ──
alter table public.stock_items add column if not exists ppe boolean not null default false;
alter table public.stock_items add column if not exists ppe_renew_months int;
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'stock_items_ppe_renew_months_check') then
    alter table public.stock_items add constraint stock_items_ppe_renew_months_check
      check (ppe_renew_months is null or ppe_renew_months between 1 and 240);
  end if;
end $c$;

-- ── 2. Remises ──
create table if not exists public.hr_ppe_handovers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  person_id uuid not null references public.hr_people(id) on delete cascade,
  item_id uuid not null references public.stock_items(id),
  quantity numeric not null default 1 check (quantity > 0 and quantity <= 1000),
  size text check (size is null or length(size) <= 30),
  from_location_id uuid references public.stock_locations(id),
  handed_on date not null default current_date,
  renew_on date,
  returned_on date,
  employee_signature text check (employee_signature is null or (employee_signature like 'data:image/%' and length(employee_signature) <= 400000)),
  signed_at timestamptz,
  notes text check (notes is null or length(notes) <= 1000),
  handed_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_ppe_handovers_dates check ((renew_on is null or renew_on >= handed_on) and (returned_on is null or returned_on >= handed_on))
);
create index if not exists hr_ppe_handovers_person_idx on public.hr_ppe_handovers (person_id);
create index if not exists hr_ppe_handovers_company_idx on public.hr_ppe_handovers (company_id);
create index if not exists hr_ppe_handovers_item_idx on public.hr_ppe_handovers (item_id);
comment on table public.hr_ppe_handovers is 'EPI remis au personnel, avec signature du salarié ; sortie du stock par la base';

-- Société de la personne ; date de renouvellement proposée par l'article ; signature datée
create or replace function app.epi_remise_avant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mois int;
begin
  new.company_id := coalesce((select p.company_id from public.hr_people p where p.id = new.person_id), new.company_id, app.company_default());
  if tg_op = 'INSERT' and new.renew_on is null then
    select i.ppe_renew_months into v_mois from public.stock_items i where i.id = new.item_id;
    if v_mois is not null then new.renew_on := (new.handed_on + make_interval(months => v_mois))::date; end if;
  end if;
  if new.employee_signature is not null and (tg_op = 'INSERT' or new.employee_signature is distinct from old.employee_signature) then
    new.signed_at := now();
  elsif new.employee_signature is null then
    new.signed_at := null;
  end if;
  if tg_op = 'UPDATE' and (new.item_id is distinct from old.item_id or new.quantity is distinct from old.quantity
                           or new.from_location_id is distinct from old.from_location_id) then
    raise exception 'Article, quantité et emplacement d''une remise ne se modifient pas : annulez la remise et refaites-la'
      using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function app.epi_remise_avant() from public, anon, authenticated;
drop trigger if exists hr_ppe_handovers_avant on public.hr_ppe_handovers;
create trigger hr_ppe_handovers_avant before insert or update on public.hr_ppe_handovers
  for each row execute function app.epi_remise_avant();

-- Sortie du stock à la remise ; retour en stock si la remise est annulée
create or replace function app.epi_remise_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.from_location_id is not null then
    insert into public.stock_movements (company_id, kind, item_id, quantity, from_location_id, source_table, source_id, note, created_by)
    values (new.company_id, 'sortie', new.item_id, new.quantity, new.from_location_id, 'hr_ppe_handovers', new.id,
            'EPI remis', (select auth.uid()))
    on conflict (source_table, source_id) where source_table is not null and source_id is not null do nothing;
  elsif tg_op = 'DELETE' and old.from_location_id is not null
        and exists (select 1 from public.stock_movements m where m.source_table = 'hr_ppe_handovers' and m.source_id = old.id) then
    insert into public.stock_movements (company_id, kind, item_id, quantity, to_location_id, source_table, source_id, note, created_by)
    values (old.company_id, 'ajustement', old.item_id, old.quantity, old.from_location_id, 'hr_ppe_handovers_annulee', old.id,
            'Remise d''EPI annulée', (select auth.uid()))
    on conflict (source_table, source_id) where source_table is not null and source_id is not null do nothing;
  end if;
  return coalesce(new, old);
end
$$;
revoke all on function app.epi_remise_stock() from public, anon, authenticated;
drop trigger if exists hr_ppe_handovers_stock on public.hr_ppe_handovers;
create trigger hr_ppe_handovers_stock after insert or delete on public.hr_ppe_handovers
  for each row execute function app.epi_remise_stock();

-- Règles d'accès (générées par scripts/securite/regles.py, build_suite('0394'))


-- Pose des règles d'une liste de tables : une règle par action, garde du module ajoutée ici.
-- Lecture : module actif, ou super administrateur. Écriture : module actif.
create or replace function pg_temp.regles(p_tables text[], p_module text, p_sel text, p_ins text, p_upd text, p_del text)
returns void
language plpgsql
as $f$
declare
  t text;
  v_on text;
  v_sel text := p_sel; v_ins text := p_ins; v_upd text := p_upd; v_del text := p_del;
begin
  if p_module is not null then
    select '(' || string_agg(format('(select app.module_on(%L))', m), ' or ') || ')' into v_on
    from unnest(string_to_array(p_module, '|')) m;
    if v_sel is not null then v_sel := format('((%s and %s) or (select app.is_superadmin()))', v_on, v_sel); end if;
    if v_ins is not null then v_ins := format('(%s and %s)', v_on, v_ins); end if;
    if v_upd is not null then v_upd := format('(%s and %s)', v_on, v_upd); end if;
    if v_del is not null then v_del := format('(%s and %s)', v_on, v_del); end if;
  end if;
  foreach t in array p_tables loop
    execute format('alter table public.%I enable row level security', t);
    if v_sel is not null then
      execute format('create policy %I on public.%I for select to authenticated using (%s)', t || '_lire', t, v_sel);
    end if;
    if v_ins is not null then
      execute format('create policy %I on public.%I for insert to authenticated with check (%s)', t || '_creer', t, v_ins);
    end if;
    if v_upd is not null then
      execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', t || '_modifier', t, v_upd, v_upd);
    end if;
    if v_del is not null then
      execute format('create policy %I on public.%I for delete to authenticated using (%s)', t || '_supprimer', t, v_del);
    end if;
  end loop;
end
$f$;

-- Suppression des règles nommées du générateur (lire, créer, modifier, supprimer) ; les autres règles
-- (règle restrictive des notifications de 0070, etc.) ne sont pas touchées
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and tablename = any (array['hr_ppe_handovers'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- hr_ppe_handovers
select pg_temp.regles(array['hr_ppe_handovers'], null,
  $r$(company_id in (select app.societes_avec_droit('rh.dossiers.voir')) or person_id in (select app.hr_mes_personnes()))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))$r$);


insert into public.schema_migrations (version) values ('0394_epi') on conflict (version) do nothing;
