-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (epi_0394) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0394_epi.sql, retour arrière,
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

-- ===== supabase/migrations/0394_epi.sql =====
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

-- ===== supabase/rollback/0394_epi_retour.sql =====
-- Retour arrière de 0394_epi.sql : retire les remises d'EPI (s'il n'y en a aucune), leurs déclencheurs et les colonnes
-- EPI des articles. Les mouvements de stock déjà écrits restent (le stock reste juste). Idempotent.

do $r$
begin
  if to_regclass('public.hr_ppe_handovers') is not null and exists (select 1 from public.hr_ppe_handovers) then
    raise exception 'Des EPI ont été remis : retour arrière refusé, rien n''est modifié';
  end if;
end $r$;

drop table if exists public.hr_ppe_handovers;
drop function if exists app.epi_remise_avant();
drop function if exists app.epi_remise_stock();
alter table public.stock_items drop constraint if exists stock_items_ppe_renew_months_check;
alter table public.stock_items drop column if exists ppe_renew_months;
alter table public.stock_items drop column if exists ppe;

delete from public.schema_migrations where version = '0394_epi';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE epi_0394 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
