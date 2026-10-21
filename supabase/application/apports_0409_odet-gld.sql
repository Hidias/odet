-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (apports_0409) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur odet-gld : 0409_apports.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0409_apports_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0409_apports.sql =====
-- 0409 : qui a apporté quoi (demande de H du 21/10). Pas de commissions : un point de temps en temps sur l'origine du
-- chiffre d'affaires, en marque blanche, pour toutes les situations.
--   - Apport : la personne de l'équipe ou l'apporteur extérieur (prescripteur, partenaire, client qui recommande) qui
--     a amené le client, ou l'affaire. Un apporteur extérieur peut lui-même avoir été amené par quelqu'un de l'équipe
--     ou par un autre apporteur : la chaîne est suivie (Jean-Paul a amené Pierre, prescripteur, qui a amené 70 k€).
--   - Idée : qui a vu l'occasion (une formation qui débouche sur des extincteurs, une visite qui débouche sur de
--     l'électricité ou de l'incendie).
--   - Vente : le responsable de l'affaire, sinon celui du client. Réalisation : le formateur de la session ou le
--     technicien de la visite facturée.
-- Le chiffre est compté sur le facturé (factures émises, avoirs en moins), mis en regard de l'encaissé. Rien n'est
-- figé : le calcul lit les fiches à jour, une correction d'origine se voit au point suivant.
--
--   1. business_contributors : apporteurs extérieurs, avec qui les a amenés.
--   2. clients et opportunities : qui a apporté (membre ou apporteur), et sur l'affaire qui a eu l'idée.
--   3. public.ca_apports(du, au) : une ligne par facture émise de la période avec ses rôles (droit du cockpit).
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0409_apports_retour.sql

-- ── 1. Apporteurs extérieurs ──
create table if not exists public.business_contributors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 160),
  kind text not null default 'prescripteur' check (kind in ('prescripteur', 'partenaire', 'client', 'autre')),
  client_id uuid references public.clients(id) on delete cascade,
  introduced_by_profile uuid references public.profiles(id) on delete set null,
  introduced_by_contributor uuid references public.business_contributors(id) on delete set null,
  email text check (email is null or length(email) <= 200),
  phone text check (phone is null or length(phone) <= 40),
  notes text check (notes is null or length(notes) <= 2000),
  active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (introduced_by_contributor is null or introduced_by_contributor <> id)
);
create index if not exists business_contributors_company_idx on public.business_contributors (company_id, active);
comment on table public.business_contributors is 'Apporteurs extérieurs (prescripteurs, partenaires, clients qui recommandent) et qui les a amenés';

create or replace function app.business_contributors_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.company_id := old.company_id; new.created_by := old.created_by; new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function app.business_contributors_maj() from public, anon, authenticated;
drop trigger if exists business_contributors_maj on public.business_contributors;
create trigger business_contributors_maj before insert or update on public.business_contributors
  for each row execute function app.business_contributors_maj();

-- ── 2. Origine sur le client et sur l'affaire ──
alter table public.clients add column if not exists introduced_by_profile uuid references public.profiles(id) on delete set null;
alter table public.clients add column if not exists introduced_by_contributor uuid references public.business_contributors(id) on delete set null;
alter table public.opportunities add column if not exists idea_by uuid references public.profiles(id) on delete set null;
alter table public.opportunities add column if not exists introduced_by_profile uuid references public.profiles(id) on delete set null;
alter table public.opportunities add column if not exists introduced_by_contributor uuid references public.business_contributors(id) on delete set null;
comment on column public.clients.introduced_by_profile is 'Membre de l''équipe qui a apporté le client';
comment on column public.clients.introduced_by_contributor is 'Apporteur extérieur qui a amené le client';
comment on column public.opportunities.idea_by is 'Membre de l''équipe qui a eu l''idée de l''affaire (vente croisée, besoin repéré)';

-- ── 3. Chiffre de la période, facture par facture ──
create or replace function public.ca_apports(p_du date, p_au date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company uuid := app.current_company();
begin
  if v_company is null then raise exception 'Choisissez une société' using errcode = '42501'; end if;
  if not app.a_le_droit('manager.cockpit.voir') then raise exception 'Accès refusé' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(x order by x->>'date', x->>'reference')
    from (
      select jsonb_build_object(
        'invoice_id', i.id, 'reference', i.reference, 'date', i.invoice_date, 'type', i.type,
        'client_id', c.id, 'client', c.name,
        'metier', coalesce(o.metier, case when coalesce(i.session_id, p.session_id) is not null then 'formation'
                                          when v.id is not null then 'maintenance' else 'autre' end),
        'ht', s.signe * abs(coalesce(i.total_net_ht, i.total_ht, 0)),
        'encaisse_ht', case when coalesce(i.total_ttc, 0) = 0 then 0
                            else s.signe * abs(coalesce(i.total_net_ht, i.total_ht, 0)) * least(1, greatest(0, coalesce(i.amount_paid, 0) / abs(i.total_ttc))) end,
        'affaire', o.title,
        'apport_p', coalesce(o.introduced_by_profile, case when o.introduced_by_contributor is null then c.introduced_by_profile end),
        'apport_c', coalesce(o.introduced_by_contributor, case when o.introduced_by_profile is null then c.introduced_by_contributor end),
        'idee_p', o.idea_by,
        'vente_p', coalesce(o.owner_id, c.owner_id),
        'realise_p', coalesce(pt.id, v.technician_id)
      ) x
      from public.invoices i
      left join public.invoices p on p.id = i.parent_invoice_id
      cross join lateral (select case when i.type = 'credit_note' then -1 else 1 end signe) s
      join public.clients c on c.id = i.client_id
      left join lateral (select op.* from public.opportunities op
                         where op.quote_id = coalesce(i.quote_id, p.quote_id) order by op.created_at limit 1) o on true
      left join lateral (select se.trainer_id from public.sessions se where se.id = coalesce(i.session_id, p.session_id)) ss on true
      left join lateral (select pr.id from public.profiles pr where pr.trainer_id = ss.trainer_id and ss.trainer_id is not null limit 1) pt on true
      left join lateral (select vi.id, vi.technician_id from public.itv_visits vi where vi.invoice_id = coalesce(p.id, i.id) limit 1) v on true
      where i.company_id = v_company and i.issued_at is not null and i.invoice_date between p_du and p_au
    ) z
  ), '[]'::jsonb);
end
$$;
revoke all on function public.ca_apports(date, date) from public, anon;
grant execute on function public.ca_apports(date, date) to authenticated;

-- Règles d'accès (générées par scripts/securite/regles.py, build_suite('0409'))


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
           where schemaname = 'public' and tablename = any (array['business_contributors'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- business_contributors
select pg_temp.regles(array['business_contributors'], null,
  $r$company_id in (select app.societes_avec_droit('clients.fiches.voir'))$r$,
  $r$company_id in (select app.societes_avec_droit('clients.fiches.modifier'))$r$,
  $r$company_id in (select app.societes_avec_droit('clients.fiches.modifier'))$r$,
  $r$company_id in (select app.societes_avec_droit('clients.fiches.modifier'))$r$);


insert into public.schema_migrations (version) values ('0409_apports') on conflict (version) do nothing;
