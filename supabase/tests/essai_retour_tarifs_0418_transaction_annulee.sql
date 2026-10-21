-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (tarifs_0418) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0418_tarifs_client.sql, retour arrière,
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

-- ===== supabase/migrations/0418_tarifs_client.sql =====
-- 0418 : tarifs par client (demande de H du 21/10 au soir : « zéro erreur de prix, zéro double saisie »). Les prix
-- négociés sont saisis une seule fois dans la fiche client et repris partout où un prix se pose :
--   - formation : prix intra (à la place du prix du catalogue) et prix inter par personne ;
--   - pièces de maintenance : prix d'une pièce, ou remise en % sur toutes les pièces ;
--   - déplacement (codes de frais des devis) et forfait de visite hors contrat.
-- Un tarif peut valoir pour tout le groupe du client (même nom de groupe) : les autres sociétés du groupe le reprennent
-- quand elles n'ont pas le leur. Un tarif peut avoir une date de fin.
--   1. client_prices : les tarifs.
--   2. app.prix_client(client, type, référence, code) : le tarif qui s'applique (celui du client, sinon du groupe).
--   3. Repris par la base : prix intra d'une nouvelle session (si aucun prix n'est saisi), prix par personne d'une
--      nouvelle entreprise inscrite en inter, prix d'une pièce posée sur une visite (aussi pour le technicien qui ne
--      voit pas les prix). Les écrans (devis, factures, visites) lisent les mêmes tarifs.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0418_tarifs_client_retour.sql

-- ── 1. Tarifs ──
create table if not exists public.client_prices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  kind text not null check (kind in ('formation', 'piece', 'remise_pieces', 'deplacement', 'visite')),
  course_id uuid references public.courses(id) on delete cascade,
  part_id uuid references public.itv_parts(id) on delete cascade,
  code text check (code is null or length(code) <= 40),
  prix_ht numeric check (prix_ht is null or prix_ht >= 0),
  prix_inter_ht numeric check (prix_inter_ht is null or prix_inter_ht >= 0),
  remise_pct numeric check (remise_pct is null or (remise_pct >= 0 and remise_pct <= 100)),
  pour_le_groupe boolean not null default false,
  valid_until date,
  notes text check (notes is null or length(notes) <= 500),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'formation' or (course_id is not null and (prix_ht is not null or prix_inter_ht is not null))),
  check (kind <> 'piece' or (part_id is not null and prix_ht is not null)),
  check (kind <> 'remise_pieces' or remise_pct is not null),
  check (kind <> 'deplacement' or (code is not null and prix_ht is not null)),
  check (kind <> 'visite' or prix_ht is not null)
);
create unique index if not exists client_prices_unique on public.client_prices
  (client_id, kind, coalesce(course_id, part_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(code, ''));
create index if not exists client_prices_company_idx on public.client_prices (company_id, kind);
comment on table public.client_prices is 'Tarifs négociés par client (formation, pièces, déplacement, visite), repris dans les devis, factures, sessions et visites';
drop trigger if exists client_prices_societe on public.client_prices;
create trigger client_prices_societe before insert or update of client_id on public.client_prices
  for each row execute function app.societe_du_parent('clients', 'client_id');

create or replace function app.client_prices_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then new.created_by := old.created_by; new.created_at := old.created_at; end if;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function app.client_prices_maj() from public, anon, authenticated;
drop trigger if exists client_prices_maj on public.client_prices;
create trigger client_prices_maj before insert or update on public.client_prices
  for each row execute function app.client_prices_maj();

-- ── 2. Tarif qui s'applique ──
create or replace function app.prix_client(p_client uuid, p_kind text, p_ref uuid default null, p_code text default null)
returns public.client_prices
language sql
stable
security definer
set search_path = ''
as $$
  select cp.* from public.client_prices cp
  join public.clients c on c.id = p_client
  left join public.clients g on g.id = cp.client_id
  where cp.kind = p_kind
    and (cp.valid_until is null or cp.valid_until >= (now() at time zone 'Europe/Paris')::date)
    and (p_ref is null or coalesce(cp.course_id, cp.part_id) = p_ref)
    and (p_code is null or cp.code = p_code)
    and (cp.client_id = p_client
         or (cp.pour_le_groupe and nullif(btrim(c.group_name), '') is not null
             and lower(btrim(g.group_name)) = lower(btrim(c.group_name)) and g.company_id = c.company_id))
  order by (cp.client_id = p_client) desc, cp.updated_at desc
  limit 1
$$;
revoke all on function app.prix_client(uuid, text, uuid, text) from public, anon, authenticated;

-- ── 3. Repris par la base ──
-- Session intra (création, ou client ou formation changés) d'un client qui a un prix pour cette formation : prix de
-- la session, si aucun n'est saisi
create or replace function app.sessions_tarif_client()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare r public.client_prices;
begin
  if new.total_price is null and new.client_id is not null and new.course_id is not null
     and coalesce(new.session_type, 'intra') <> 'inter' then
    r := app.prix_client(new.client_id, 'formation', new.course_id);
    if r.prix_ht is not null then new.total_price := r.prix_ht; end if;
  end if;
  return new;
end
$$;
revoke all on function app.sessions_tarif_client() from public, anon, authenticated;
drop trigger if exists sessions_tarif_client on public.sessions;
create trigger sessions_tarif_client before insert or update of client_id, course_id on public.sessions
  for each row execute function app.sessions_tarif_client();

-- Entreprise inscrite en inter : prix par personne de son tarif, si aucun prix n'est saisi
create or replace function app.session_groups_tarif_client()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare r public.client_prices; v_course uuid;
begin
  if new.price_per_person is null and coalesce(new.price_total, 0) = 0 and new.client_id is not null then
    select s.course_id into v_course from public.sessions s where s.id = new.session_id;
    if v_course is not null then
      r := app.prix_client(new.client_id, 'formation', v_course);
      if r.prix_inter_ht is not null then new.price_per_person := r.prix_inter_ht; end if;
    end if;
  end if;
  return new;
end
$$;
revoke all on function app.session_groups_tarif_client() from public, anon, authenticated;
drop trigger if exists session_groups_tarif_client on public.session_groups;
create trigger session_groups_tarif_client before insert on public.session_groups
  for each row execute function app.session_groups_tarif_client();

-- Pièce posée sur une visite par la fonction (technicien sans droit aux prix) : prix du client
create or replace function public.itv_visit_part_add(p_visit uuid, p_part uuid default null, p_label text default null, p_quantity numeric default 1)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_name text;
  v_price numeric := 0;
  v_id uuid;
  v_client uuid;
  r public.client_prices;
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
    -- Tarif du client (0418) : prix de la pièce, sinon remise sur les pièces
    select v.client_id into v_client from public.itv_visits v where v.id = p_visit;
    if v_client is not null then
      r := app.prix_client(v_client, 'piece', p_part);
      if r.prix_ht is not null then v_price := r.prix_ht;
      else
        r := app.prix_client(v_client, 'remise_pieces');
        if r.remise_pct is not null then v_price := round(coalesce(v_price, 0) * (1 - r.remise_pct / 100), 2); end if;
      end if;
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
$function$;

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
           where schemaname = 'public' and tablename = any (array['client_prices'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- client_prices
select pg_temp.regles(array['client_prices'], null,
  $r$company_id in (select app.societes_avec_droit('commercial.devis.voir'))$r$,
  $r$company_id in (select app.societes_avec_droit('clients.fiches.modifier'))$r$,
  $r$company_id in (select app.societes_avec_droit('clients.fiches.modifier'))$r$,
  $r$company_id in (select app.societes_avec_droit('clients.fiches.modifier'))$r$);


insert into public.schema_migrations (version) values ('0418_tarifs_client') on conflict (version) do nothing;

-- ===== supabase/rollback/0418_tarifs_client_retour.sql =====
-- Retour arrière de 0418_tarifs_client.sql. Les tarifs sont effacés ; les prix déjà posés (sessions, inscriptions,
-- pièces) restent. La fonction d'ajout de pièce reprend sa version de 0374. Idempotent.

drop trigger if exists session_groups_tarif_client on public.session_groups;
drop function if exists app.session_groups_tarif_client();
drop trigger if exists sessions_tarif_client on public.sessions;
drop function if exists app.sessions_tarif_client();

CREATE OR REPLACE FUNCTION public.itv_visit_part_add(p_visit uuid, p_part uuid DEFAULT NULL::uuid, p_label text DEFAULT NULL::text, p_quantity numeric DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$

;

drop function if exists app.prix_client(uuid, text, uuid, text);
drop table if exists public.client_prices;
drop function if exists app.client_prices_maj();

delete from public.schema_migrations where version = '0418_tarifs_client';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE tarifs_0418 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
