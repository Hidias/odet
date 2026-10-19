-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (stock_0247) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0247_stock_inventaire.sql, retour arrière,
-- comparaison. Se termine TOUJOURS par l'erreur volontaire « RÉSULTAT DE L'ESSAI DU RETOUR ARRIÈRE » : tout est annulé.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

create temp view etat_essai as
  select 'règle' as kind, schemaname || '.' || tablename || '.' || policyname as name,
         md5(concat_ws('|', permissive, roles::text, cmd, qual, with_check)) as v
  from pg_policies where schemaname in ('public', 'storage')
  union all
  select 'fonction', p.oid::regprocedure::text,
         md5(concat_ws('|', pg_get_functiondef(p.oid), p.prosecdef::text, p.proconfig::text,
             (select string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',' order by a.grantee::regrole::text, a.privilege_type)
              from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a)))
  from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace) and p.prokind in ('f', 'p')
  union all
  select 'droits table', c.oid::regclass::text,
         md5(coalesce((select string_agg(a.grantee::regrole::text || ':' || a.privilege_type || ':' || a.is_grantable::text, ','
                               order by a.grantee::regrole::text, a.privilege_type)
                       from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a), '') || c.relrowsecurity::text)
  from pg_class c where c.relnamespace in ('public'::regnamespace, 'app'::regnamespace) and c.relkind in ('r', 'v', 'm', 'p')
  union all
  select 'vue', c.oid::regclass::text, md5(pg_get_viewdef(c.oid) || coalesce(c.reloptions::text, ''))
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
  union all
  select 'colonne', table_schema || '.' || table_name || '.' || column_name, md5(data_type || is_nullable || coalesce(column_default, ''))
  from information_schema.columns where table_schema in ('public', 'app')
  union all
  select 'contrainte', conrelid::regclass::text || '.' || conname, md5(pg_get_constraintdef(oid))
  from pg_constraint where connamespace in ('public'::regnamespace, 'app'::regnamespace)
  union all
  select 'index', indexrelid::regclass::text, md5(pg_get_indexdef(indexrelid))
  from pg_index where indrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace, 'app'::regnamespace))
  union all
  select 'déclencheur', tgrelid::regclass::text || '.' || tgname, md5(tgfoid::regprocedure::text || tgenabled::text)
  from pg_trigger where not tgisinternal
    and tgrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace, 'app'::regnamespace))
  union all
  select 'migrations', 'public.schema_migrations', md5(coalesce(string_agg(version, ',' order by version), ''))
  from public.schema_migrations
  union all
  select 'données', 'organization_settings', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.organization_settings t
  union all
  select 'données', 'profiles', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.profiles t
  union all
  select 'données', 'org_modules', md5(coalesce(string_agg(t::text, ',' order by t.key), '')) from public.org_modules t
  union all
  select 'données', 'company_members', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.company_members t
  union all
  select 'données', 'company_member_roles', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.company_member_roles t;
create temp table etat_essai_avant as select * from etat_essai;

-- ===== supabase/migrations/0247_stock_inventaire.sql =====
-- 0247_stock_inventaire.sql : module Stock, inventaires et numéros de série (spec odet-spec-stock.md § 3 à 6,
-- branche stock/inventaire-series).
--
--   - inventaires (stock_counts, stock_count_lines) : un inventaire par emplacement ; il s'ouvre avec la liste des
--     articles présents ou suivis à cet emplacement ; on compte sur le téléphone (un article oublié s'ajoute) ; à la
--     validation, chaque écart entre le compté et la quantité calculée devient un mouvement d'ajustement (jamais une
--     quantité saisie) ; un article non compté ne bouge pas. Un seul inventaire en cours par emplacement ;
--   - numéros de série (stock_serials) pour les articles suivis par numéro : emplacement actuel tenu par les
--     mouvements qui portent ce numéro (entrée, transfert, retour : il arrive ; sortie, perte : il sort), date d'achat,
--     fin de garantie, appareil posé chez le client (itv_equipment) ;
--   - la purge de démonstration efface les inventaires et numéros des articles et emplacements de démonstration
--     (suppression en cascade).
-- Droits (build_suite('0247')) : voir regles.py, module Stock ; isolement par société ; journal par app.audit_row.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0247_stock_inventaire_retour.sql

create table if not exists public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  location_id uuid not null references public.stock_locations(id) on delete cascade,
  status text not null default 'en_cours' check (status in ('en_cours', 'validee', 'annulee')),
  note text,
  started_by uuid default auth.uid(),
  started_at timestamptz not null default now(),
  validated_by uuid,
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists stock_counts_company_idx on public.stock_counts (company_id, started_at desc);
create unique index if not exists stock_counts_en_cours_uniq on public.stock_counts (location_id) where status = 'en_cours';
comment on table public.stock_counts is 'Inventaires par emplacement (écrits par les fonctions stock_inventaire_*)';

create table if not exists public.stock_count_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  count_id uuid not null references public.stock_counts(id) on delete cascade,
  item_id uuid not null references public.stock_items(id) on delete cascade,
  counted_qty numeric(12,3) check (counted_qty is null or counted_qty >= 0),
  expected_qty numeric(12,3),
  counted_by uuid,
  counted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (count_id, item_id)
);
create index if not exists stock_count_lines_company_idx on public.stock_count_lines (company_id);
comment on table public.stock_count_lines is 'Lignes d''inventaire : quantité comptée ; quantité calculée figée à la validation';

create table if not exists public.stock_serials (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  item_id uuid not null references public.stock_items(id) on delete cascade,
  serial text not null check (length(btrim(serial)) > 0),
  location_id uuid references public.stock_locations(id) on delete set null,
  status text not null default 'en_stock' check (status in ('en_stock', 'sorti', 'pose', 'rebut')),
  purchased_on date,
  warranty_until date,
  equipment_id uuid references public.itv_equipment(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists stock_serials_company_idx on public.stock_serials (company_id);
create unique index if not exists stock_serials_uniq on public.stock_serials (company_id, item_id, serial);
comment on table public.stock_serials is 'Équipements suivis par numéro de série : emplacement actuel, garantie, pose chez un client';

do $$
declare t text;
begin
  foreach t in array array['stock_counts', 'stock_count_lines', 'stock_serials'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_maj', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function app.hr_h_maj()', t || '_maj', t);
  end loop;
end $$;

-- Numéro de série : même société que l'article (et l'emplacement)
create or replace function app.stock_serie_garde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.serial := btrim(new.serial);
  if not exists (select 1 from public.stock_items i where i.id = new.item_id and i.company_id = new.company_id) then
    raise exception 'Article d''une autre société' using errcode = '23514';
  end if;
  if new.location_id is not null and not exists (select 1 from public.stock_locations l where l.id = new.location_id and l.company_id = new.company_id) then
    raise exception 'Emplacement d''une autre société' using errcode = '23514';
  end if;
  return new;
end
$$;
revoke all on function app.stock_serie_garde() from public, anon, authenticated;
drop trigger if exists stock_serials_garde on public.stock_serials;
create trigger stock_serials_garde before insert or update on public.stock_serials for each row execute function app.stock_serie_garde();

-- Un mouvement qui porte un numéro de série d'un article suivi tient l'emplacement du numéro
create or replace function app.stock_serie_suivre()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_suivi boolean;
begin
  if new.serial is null then return null; end if;
  select i.serialized into v_suivi from public.stock_items i where i.id = new.item_id;
  if not coalesce(v_suivi, false) then return null; end if;
  if new.to_location_id is not null then
    insert into public.stock_serials (company_id, item_id, serial, location_id, status, purchased_on)
    values (new.company_id, new.item_id, new.serial, new.to_location_id, 'en_stock', case when new.kind = 'entree' then current_date end)
    on conflict (company_id, item_id, serial) do update set location_id = excluded.location_id, status = 'en_stock',
      purchased_on = coalesce(public.stock_serials.purchased_on, excluded.purchased_on);
  else
    update public.stock_serials set location_id = null, status = case when new.kind = 'perte' then 'rebut' else 'sorti' end
    where company_id = new.company_id and item_id = new.item_id and serial = new.serial;
  end if;
  return null;
end
$$;
revoke all on function app.stock_serie_suivre() from public, anon, authenticated;
drop trigger if exists stock_movements_serie on public.stock_movements;
create trigger stock_movements_serie after insert on public.stock_movements for each row execute function app.stock_serie_suivre();

-- Droit de compter à un emplacement : gérer le stock, ou son propre emplacement avec « Mouvementer son stock »
create or replace function app.stock_peut_compter(p_location uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.stock_locations l
    where l.id = p_location and l.company_id in (select app.societes_ecriture())
      and (l.company_id in (select app.societes_avec_droit('stock.articles.gerer'))
           or l.company_id in (select app.societes_avec_droit('stock.inventaires.valider'))
           or (l.id in (select app.stock_mes_emplacements()) and l.company_id in (select app.societes_avec_droit('stock.sien.mouvementer')))))
$$;
revoke all on function app.stock_peut_compter(uuid) from public, anon, authenticated;

-- Quantité calculée d'un article à un emplacement
create or replace function app.stock_niveau(p_item uuid, p_location uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(case when m.to_location_id = p_location then m.quantity else 0 end)
                - sum(case when m.from_location_id = p_location then m.quantity else 0 end), 0)
  from public.stock_movements m
  where m.item_id = p_item and (m.to_location_id = p_location or m.from_location_id = p_location)
$$;
revoke all on function app.stock_niveau(uuid, uuid) from public, anon, authenticated;

-- Ouvrir un inventaire : articles présents (quantité non nulle) ou suivis (seuil) à cet emplacement
create or replace function public.stock_inventaire_ouvrir(p_location uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_co uuid;
  v_id uuid;
begin
  select l.company_id into v_co from public.stock_locations l where l.id = p_location and l.is_active;
  if v_co is null then raise exception 'Emplacement introuvable' using errcode = 'P0002'; end if;
  if not app.stock_peut_compter(p_location) then raise exception 'Accès refusé' using errcode = '42501'; end if;
  select c.id into v_id from public.stock_counts c where c.location_id = p_location and c.status = 'en_cours';
  if v_id is not null then return v_id; end if;
  insert into public.stock_counts (company_id, location_id, note, started_by)
  values (v_co, p_location, nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid()))
  returning id into v_id;
  insert into public.stock_count_lines (company_id, count_id, item_id)
  select v_co, v_id, x.item_id
  from (select m.item_id from public.stock_movements m where m.company_id = v_co and (m.to_location_id = p_location or m.from_location_id = p_location)
        union
        select t.item_id from public.stock_thresholds t where t.location_id = p_location) x
  join public.stock_items i on i.id = x.item_id and i.is_active
  where app.stock_niveau(x.item_id, p_location) <> 0
     or exists (select 1 from public.stock_thresholds t where t.item_id = x.item_id and t.location_id = p_location)
  on conflict (count_id, item_id) do nothing;
  return v_id;
end
$$;
revoke all on function public.stock_inventaire_ouvrir(uuid, text) from public, anon;
grant execute on function public.stock_inventaire_ouvrir(uuid, text) to authenticated;

-- Compter un article (une ligne est ajoutée pour un article oublié) ; une quantité vide retire le comptage
create or replace function public.stock_inventaire_compter(p_count uuid, p_item uuid, p_quantity numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.stock_counts;
begin
  select * into c from public.stock_counts where id = p_count;
  if c.id is null then raise exception 'Inventaire introuvable' using errcode = 'P0002'; end if;
  if not app.stock_peut_compter(c.location_id) then raise exception 'Accès refusé' using errcode = '42501'; end if;
  if c.status <> 'en_cours' then raise exception 'Inventaire déjà clos' using errcode = '22023'; end if;
  if p_quantity is not null and p_quantity < 0 then raise exception 'Quantité négative' using errcode = '22023'; end if;
  if not exists (select 1 from public.stock_items i where i.id = p_item and i.company_id = c.company_id) then
    raise exception 'Article introuvable' using errcode = 'P0002';
  end if;
  insert into public.stock_count_lines (company_id, count_id, item_id, counted_qty, counted_by, counted_at)
  values (c.company_id, c.id, p_item, p_quantity, case when p_quantity is not null then (select auth.uid()) end, case when p_quantity is not null then now() end)
  on conflict (count_id, item_id) do update set counted_qty = excluded.counted_qty, counted_by = excluded.counted_by, counted_at = excluded.counted_at;
end
$$;
revoke all on function public.stock_inventaire_compter(uuid, uuid, numeric) from public, anon;
grant execute on function public.stock_inventaire_compter(uuid, uuid, numeric) to authenticated;

-- Valider : chaque écart devient un ajustement ; la quantité calculée au moment de la validation est figée sur la ligne
create or replace function public.stock_inventaire_valider(p_count uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.stock_counts;
  l record;
  v_niv numeric;
  v_n integer := 0;
begin
  select * into c from public.stock_counts where id = p_count for update;
  if c.id is null then raise exception 'Inventaire introuvable' using errcode = 'P0002'; end if;
  if not (c.company_id in (select app.societes_ecriture())) or not (c.company_id in (select app.societes_avec_droit('stock.inventaires.valider'))) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if c.status <> 'en_cours' then raise exception 'Inventaire déjà clos' using errcode = '22023'; end if;
  for l in select * from public.stock_count_lines where count_id = c.id loop
    v_niv := app.stock_niveau(l.item_id, c.location_id);
    update public.stock_count_lines set expected_qty = v_niv where id = l.id;
    if l.counted_qty is not null and l.counted_qty <> v_niv then
      insert into public.stock_movements (company_id, kind, item_id, quantity, from_location_id, to_location_id, source_table, source_id, note, created_by)
      values (c.company_id, 'ajustement', l.item_id, abs(l.counted_qty - v_niv),
              case when l.counted_qty < v_niv then c.location_id end, case when l.counted_qty > v_niv then c.location_id end,
              'stock_count_lines', l.id, 'Inventaire du ' || to_char(c.started_at, 'DD/MM/YYYY'), (select auth.uid()));
      v_n := v_n + 1;
    end if;
  end loop;
  update public.stock_counts set status = 'validee', validated_by = (select auth.uid()), validated_at = now() where id = c.id;
  return v_n;
end
$$;
revoke all on function public.stock_inventaire_valider(uuid) from public, anon;
grant execute on function public.stock_inventaire_valider(uuid) to authenticated;

create or replace function public.stock_inventaire_annuler(p_count uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.stock_counts;
begin
  select * into c from public.stock_counts where id = p_count for update;
  if c.id is null then raise exception 'Inventaire introuvable' using errcode = 'P0002'; end if;
  if not app.stock_peut_compter(c.location_id) then raise exception 'Accès refusé' using errcode = '42501'; end if;
  if c.status <> 'en_cours' then raise exception 'Inventaire déjà clos' using errcode = '22023'; end if;
  update public.stock_counts set status = 'annulee' where id = c.id;
end
$$;
revoke all on function public.stock_inventaire_annuler(uuid) from public, anon;
grant execute on function public.stock_inventaire_annuler(uuid) to authenticated;

-- Journal
do $$
declare r record;
begin
  for r in select * from (values ('stock_counts', 'stock'), ('stock_count_lines', 'stock'), ('stock_serials', 'stock')) as t(nom, type) loop
    execute format('drop trigger if exists zz_audit_row on public.%I', r.nom);
    execute format('create trigger zz_audit_row after insert or update or delete on public.%I for each row execute function app.audit_row(%L)', r.nom, r.type);
  end loop;
end $$;

-- ── Droits des tables ──
do $$
declare t text;
begin
  foreach t in array array['stock_counts', 'stock_count_lines', 'stock_serials'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

-- ── Règles (générées par scripts/securite/regles.py, build_suite('0247')) ──

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
           where schemaname = 'public' and tablename = any (array['stock_count_lines', 'stock_counts', 'stock_serials'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- stock_count_lines
select pg_temp.regles(array['stock_count_lines'], null,
  $r$(company_id in (select app.societes_avec_droit('stock.voir')) or count_id in (select c.id from public.stock_counts c where c.location_id in (select app.stock_mes_emplacements())))$r$,
  null,
  null,
  null);

-- stock_counts
select pg_temp.regles(array['stock_counts'], null,
  $r$(company_id in (select app.societes_avec_droit('stock.voir')) or location_id in (select app.stock_mes_emplacements()))$r$,
  null,
  null,
  null);

-- stock_serials
select pg_temp.regles(array['stock_serials'], null,
  $r$(company_id in (select app.societes_avec_droit('stock.voir')) or location_id in (select app.stock_mes_emplacements()))$r$,
  $r$company_id in (select app.societes_avec_droit('stock.articles.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('stock.articles.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('stock.articles.gerer'))$r$);


do $$
declare t text;
begin
  foreach t in array array['stock_counts', 'stock_count_lines', 'stock_serials'] loop
    execute format('drop policy if exists %I on public.%I', t || '_societe_lire', t);
    execute format('drop policy if exists %I on public.%I', t || '_societe_creer', t);
    execute format('drop policy if exists %I on public.%I', t || '_societe_modifier', t);
    execute format('drop policy if exists %I on public.%I', t || '_societe_supprimer', t);
    execute format('create policy %I on public.%I as restrictive for select to authenticated using (company_id in (select app.societes_lisibles()))', t || '_societe_lire', t);
    execute format('create policy %I on public.%I as restrictive for insert to authenticated with check (company_id in (select app.societes_ecriture()))', t || '_societe_creer', t);
    execute format('create policy %I on public.%I as restrictive for update to authenticated using (company_id in (select app.societes_ecriture())) with check (company_id in (select app.societes_ecriture()))', t || '_societe_modifier', t);
    execute format('create policy %I on public.%I as restrictive for delete to authenticated using (company_id in (select app.societes_ecriture()))', t || '_societe_supprimer', t);
  end loop;
end $$;

insert into public.schema_migrations (version) values ('0247_stock_inventaire') on conflict (version) do nothing;

-- ===== supabase/rollback/0247_stock_inventaire_retour.sql =====
-- Retour arrière de 0247_stock_inventaire.sql : retire les inventaires et les numéros de série (tables, fonctions,
-- déclencheurs). Idempotent. Refusé si un inventaire ou un numéro de série a été saisi (à exporter d'abord).

do $$
begin
  if (to_regclass('public.stock_counts') is not null and exists (select 1 from public.stock_counts))
     or (to_regclass('public.stock_serials') is not null and exists (select 1 from public.stock_serials)) then
    raise exception 'Retour arrière refusé : des inventaires ou des numéros de série ont été saisis (à exporter d''abord)';
  end if;
end $$;

drop function if exists public.stock_inventaire_annuler(uuid);
drop function if exists public.stock_inventaire_valider(uuid);
drop function if exists public.stock_inventaire_compter(uuid, uuid, numeric);
drop function if exists public.stock_inventaire_ouvrir(uuid, text);
drop function if exists app.stock_niveau(uuid, uuid);
drop function if exists app.stock_peut_compter(uuid);
drop trigger if exists stock_movements_serie on public.stock_movements;
drop function if exists app.stock_serie_suivre();
drop table if exists public.stock_serials;
drop function if exists app.stock_serie_garde();
drop table if exists public.stock_count_lines;
drop table if exists public.stock_counts;

delete from public.schema_migrations where version = '0247_stock_inventaire';

do $verif$
declare
  v_diff text[];
  v_n int;
  v_par text;
begin
  select count(*), (array_agg(coalesce(a.kind, b.kind) || ' ' || coalesce(a.name, b.name) || case
           when a.name is null then ' (en trop après retour)' when b.name is null then ' (manquant après retour)'
           else ' (différent)' end order by coalesce(a.kind, b.kind) desc, coalesce(a.name, b.name)))[1:40]
    into v_n, v_diff
  from etat_essai_avant a full join etat_essai b on a.kind = b.kind and a.name = b.name
  where a.v is distinct from b.v;
  select string_agg(k || ' ' || n, ', ') into v_par from (
    select coalesce(a.kind, b.kind) k, count(*) n
    from etat_essai_avant a full join etat_essai b on a.kind = b.kind and a.name = b.name
    where a.v is distinct from b.v group by 1) z;
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE stock_0247 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
