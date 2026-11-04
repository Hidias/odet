-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (stock_0483) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0483_stock_emplacements_inactifs.sql, retour arrière,
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

-- ===== supabase/migrations/0483_stock_emplacements_inactifs.sql =====
-- 0483 : emplacement de stock désactivé (suite de #271, relecture indépendante du 04/11).
-- 1. Les alertes de stock (v_stock_alerts) et la commande préparée depuis les alertes (stock_commande_depuis_alertes)
--    ignorent les emplacements inactifs : un emplacement fermé qui garde des seuils ne reste plus en alerte et ne
--    gonfle plus les quantités commandées.
-- 2. Emplacement d'un technicien : s'il existe mais a été désactivé, il est réactivé au lieu d'en créer un second
--    (sinon erreur de doublon sur stock_locations_tech_uniq quand un technicien réactivé ouvre « Mon stock »), et les
--    pièces posées pendant une visite sortent d'un emplacement visible (app.stock_camion, utilisée par la clôture).
--    Le camion n'est réactivé que si le technicien et son compte sont actifs : clore la visite d'un technicien parti
--    ne rouvre pas son camion (il est alors renvoyé inactif, comme avant). « Mon stock » réactive l'emplacement de la
--    personne connectée. Sans demande de création (p_creer = false), rien ne change.
-- 3. Un stock négatif reste signalé dans les alertes, même sur un emplacement désactivé (anomalie à voir), mais il
--    n'entre jamais dans une commande préparée depuis les alertes.
-- Au 04/11 en production : aucun seuil, un seul emplacement inactif (sans technicien actif) : aucun effet immédiat.
-- Additive. Idempotente. Retour arrière : supabase/rollback/0483_stock_emplacements_inactifs_retour.sql

-- ── 1. Alertes : emplacements actifs, plus les négatifs partout ──
create or replace view public.v_stock_alerts with (security_invoker = true) as
  select t.company_id, t.item_id, t.location_id, t.min_qty, t.target_qty, coalesce(l.quantity, 0) as quantity,
         greatest(0, coalesce(t.target_qty, t.min_qty) - coalesce(l.quantity, 0)) as to_order
  from public.stock_thresholds t
  left join public.stock_locations s on s.id = t.location_id
  left join public.v_stock_levels l on l.item_id = t.item_id and l.location_id = t.location_id
  where (coalesce(s.is_active, false) and coalesce(l.quantity, 0) < t.min_qty) or coalesce(l.quantity, 0) < 0;
comment on view public.v_stock_alerts is 'Articles sous le seuil par emplacement actif, ou en négatif sur tout emplacement, quantité à commander';
revoke all on public.v_stock_alerts from public, anon;
grant select on public.v_stock_alerts to authenticated;

create or replace function public.stock_commande_depuis_alertes(p_supplier uuid, p_location uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_co uuid;
  v_id uuid;
  v_prix boolean;
  v_n integer;
begin
  select s.company_id into v_co from public.suppliers s where s.id = p_supplier and s.archived_at is null;
  if v_co is null then raise exception 'Fournisseur introuvable' using errcode = 'P0002'; end if;
  v_prix := v_co in (select app.societes_avec_droit('stock.valeur.voir'));
  v_id := public.stock_commande_creer(p_supplier, p_location, 'Préparée depuis les alertes de stock');
  insert into public.purchase_order_lines (company_id, order_id, item_id, quantity, unit_price_ht, position)
  select v_co, v_id, a.item_id, a.qte, case when v_prix then c.purchase_price_ht end, row_number() over (order by i.label)
  from (select t.item_id, sum(greatest(0, coalesce(t.target_qty, t.min_qty) - coalesce(lv.quantity, 0))) as qte
        from public.stock_thresholds t
        join public.stock_locations el on el.id = t.location_id and el.is_active
        left join (select m.item_id, x.location_id, sum(x.sens * m.quantity) as quantity
                   from public.stock_movements m
                   cross join lateral (values (m.to_location_id, 1), (m.from_location_id, -1)) as x(location_id, sens)
                   where m.company_id = v_co and x.location_id is not null
                   group by m.item_id, x.location_id) lv on lv.item_id = t.item_id and lv.location_id = t.location_id
        where t.company_id = v_co and (p_location is null or t.location_id = p_location)
          and coalesce(lv.quantity, 0) < t.min_qty
        group by t.item_id) a
  join public.stock_items i on i.id = a.item_id and i.supplier_id = p_supplier and i.is_active
  left join public.stock_item_costs c on c.item_id = a.item_id
  where a.qte > 0;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Aucun article de ce fournisseur sous le seuil' using errcode = 'P0002';
  end if;
  return v_id;
end
$$;
revoke all on function public.stock_commande_depuis_alertes(uuid, uuid) from public, anon;
grant execute on function public.stock_commande_depuis_alertes(uuid, uuid) to authenticated;

-- ── 2. Emplacement du technicien : réactivé plutôt que recréé ──
create or replace function app.stock_mon_emplacement(p_creer boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_co uuid := app.current_company();
  v_id uuid;
  v_actif boolean;
  v_nom text;
begin
  select l.id, l.is_active into v_id, v_actif from public.stock_locations l
  where l.company_id = v_co and l.kind = 'technicien' and l.profile_id = (select auth.uid())
  order by l.is_active desc limit 1;
  if v_id is not null and not v_actif then
    if not p_creer then return null; end if;
    update public.stock_locations set is_active = true, updated_at = now() where id = v_id;
  end if;
  if v_id is null and p_creer then
    select coalesce(nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), p.display_name, p.email) into v_nom
    from public.profiles p where p.id = (select auth.uid());
    insert into public.stock_locations (company_id, kind, name, profile_id)
    values (v_co, 'technicien', 'Stock de ' || coalesce(v_nom, 'technicien'), (select auth.uid()))
    on conflict do nothing
    returning id into v_id;
    if v_id is null then
      -- Créé entre-temps par un autre appel (deux écrans ouverts en même temps)
      select l.id into v_id from public.stock_locations l
      where l.company_id = v_co and l.kind = 'technicien' and l.profile_id = (select auth.uid()) limit 1;
      update public.stock_locations set is_active = true, updated_at = now() where id = v_id and not is_active;
    end if;
  end if;
  return v_id;
end
$$;
revoke all on function app.stock_mon_emplacement(boolean) from public, anon, authenticated;

create or replace function app.stock_camion(p_company uuid, p_profile uuid, p_creer boolean default true)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_actif boolean;
  v_nom text;
begin
  if p_company is null or p_profile is null then return null; end if;
  select l.id, l.is_active into v_id, v_actif from public.stock_locations l
  where l.company_id = p_company and l.kind = 'technicien' and l.profile_id = p_profile
  order by l.is_active desc limit 1;
  if v_id is not null and not v_actif and p_creer
     and exists (select 1 from public.itv_technicians t join public.profiles p on p.id = t.profile_id
                 where t.profile_id = p_profile and t.is_active and p.is_active
                   and (t.company_id = p_company or p_company = any (t.company_ids))) then
    update public.stock_locations set is_active = true, updated_at = now() where id = v_id;
  end if;
  if v_id is null and p_creer then
    select coalesce(nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), p.display_name, p.email) into v_nom
    from public.profiles p where p.id = p_profile;
    insert into public.stock_locations (company_id, kind, name, profile_id)
    values (p_company, 'technicien', 'Camion de ' || coalesce(v_nom, 'technicien'), p_profile)
    on conflict do nothing
    returning id into v_id;
    if v_id is null then
      select l.id into v_id from public.stock_locations l
      where l.company_id = p_company and l.kind = 'technicien' and l.profile_id = p_profile limit 1;
    end if;
  end if;
  return v_id;
end
$$;
revoke all on function app.stock_camion(uuid, uuid, boolean) from public, anon, authenticated;

insert into public.schema_migrations (version) values ('0483_stock_emplacements_inactifs') on conflict (version) do nothing;

-- ===== supabase/rollback/0483_stock_emplacements_inactifs_retour.sql =====
-- Retour arrière de 0483 : définitions d'origine (0240, 0245, 0383), emplacements inactifs de nouveau comptés dans les
-- alertes et la commande depuis les alertes ; emplacement technicien inactif de nouveau ignoré (pas réactivé).
-- Les emplacements réactivés par 0483 restent actifs (aucune donnée n'est retouchée).

create or replace function app.stock_mon_emplacement(p_creer boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_co uuid := app.current_company();
  v_id uuid;
  v_nom text;
begin
  select l.id into v_id from public.stock_locations l
  where l.company_id = v_co and l.kind = 'technicien' and l.profile_id = (select auth.uid()) and l.is_active;
  if v_id is null and p_creer then
    select coalesce(nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), p.display_name, p.email) into v_nom
    from public.profiles p where p.id = (select auth.uid());
    insert into public.stock_locations (company_id, kind, name, profile_id)
    values (v_co, 'technicien', 'Stock de ' || coalesce(v_nom, 'technicien'), (select auth.uid()))
    returning id into v_id;
  end if;
  return v_id;
end
$$;
revoke all on function app.stock_mon_emplacement(boolean) from public, anon, authenticated;

create or replace view public.v_stock_alerts with (security_invoker = true) as
  select t.company_id, t.item_id, t.location_id, t.min_qty, t.target_qty, coalesce(l.quantity, 0) as quantity,
         greatest(0, coalesce(t.target_qty, t.min_qty) - coalesce(l.quantity, 0)) as to_order
  from public.stock_thresholds t
  left join public.v_stock_levels l on l.item_id = t.item_id and l.location_id = t.location_id
  where coalesce(l.quantity, 0) < t.min_qty or coalesce(l.quantity, 0) < 0;
comment on view public.v_stock_alerts is 'Articles sous le seuil (ou en négatif) par emplacement, quantité à commander';
revoke all on public.v_stock_alerts from public, anon;
grant select on public.v_stock_alerts to authenticated;

create or replace function public.stock_commande_depuis_alertes(p_supplier uuid, p_location uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_co uuid;
  v_id uuid;
  v_prix boolean;
  v_n integer;
begin
  select s.company_id into v_co from public.suppliers s where s.id = p_supplier and s.archived_at is null;
  if v_co is null then raise exception 'Fournisseur introuvable' using errcode = 'P0002'; end if;
  v_prix := v_co in (select app.societes_avec_droit('stock.valeur.voir'));
  v_id := public.stock_commande_creer(p_supplier, p_location, 'Préparée depuis les alertes de stock');
  insert into public.purchase_order_lines (company_id, order_id, item_id, quantity, unit_price_ht, position)
  select v_co, v_id, a.item_id, a.qte, case when v_prix then c.purchase_price_ht end, row_number() over (order by i.label)
  from (select t.item_id, sum(greatest(0, coalesce(t.target_qty, t.min_qty) - coalesce(lv.quantity, 0))) as qte
        from public.stock_thresholds t
        left join (select m.item_id, x.location_id, sum(x.sens * m.quantity) as quantity
                   from public.stock_movements m
                   cross join lateral (values (m.to_location_id, 1), (m.from_location_id, -1)) as x(location_id, sens)
                   where m.company_id = v_co and x.location_id is not null
                   group by m.item_id, x.location_id) lv on lv.item_id = t.item_id and lv.location_id = t.location_id
        where t.company_id = v_co and (p_location is null or t.location_id = p_location)
          and coalesce(lv.quantity, 0) < t.min_qty
        group by t.item_id) a
  join public.stock_items i on i.id = a.item_id and i.supplier_id = p_supplier and i.is_active
  left join public.stock_item_costs c on c.item_id = a.item_id
  where a.qte > 0;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Aucun article de ce fournisseur sous le seuil' using errcode = 'P0002';
  end if;
  return v_id;
end
$$;
revoke all on function public.stock_commande_depuis_alertes(uuid, uuid) from public, anon;

create or replace function app.stock_camion(p_company uuid, p_profile uuid, p_creer boolean default true)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_nom text;
begin
  if p_company is null or p_profile is null then return null; end if;
  select l.id into v_id from public.stock_locations l
  where l.company_id = p_company and l.kind = 'technicien' and l.profile_id = p_profile
  order by l.is_active desc limit 1;
  if v_id is null and p_creer then
    select coalesce(nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), p.display_name, p.email) into v_nom
    from public.profiles p where p.id = p_profile;
    insert into public.stock_locations (company_id, kind, name, profile_id)
    values (p_company, 'technicien', 'Camion de ' || coalesce(v_nom, 'technicien'), p_profile)
    on conflict do nothing
    returning id into v_id;
    if v_id is null then
      select l.id into v_id from public.stock_locations l
      where l.company_id = p_company and l.kind = 'technicien' and l.profile_id = p_profile limit 1;
    end if;
  end if;
  return v_id;
end
$$;
revoke all on function app.stock_camion(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.stock_commande_depuis_alertes(uuid, uuid) to authenticated;

delete from public.schema_migrations where version = '0483_stock_emplacements_inactifs';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE stock_0483 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
