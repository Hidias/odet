-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (f10_0130) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur odet-gld : 0130_pont_formation_maintenance.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0130_pont_formation_maintenance_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0130_pont_formation_maintenance.sql =====
-- 0130_pont_formation_maintenance.sql : fonction 10, pont entre formation et maintenance (module « pont »).
--
-- Spec : odet-f10-pont-formation-maintenance.md (validée le 14/10/2026). Aucune nouvelle source de données : clients,
-- sites, salariés, validités et exercices du lot 2, parc et contrats des Interventions, devis existants.
-- 1. cross_sell_leads : pistes « vers la formation » (signalées à la fin d'une visite) et « vers la maintenance »
--    (session incendie terminée chez un client sans contrat de maintenance). Une seule piste ouverte par client,
--    sens et domaine (index unique partiel) ; un nouveau signalement s'ajoute en note.
-- 2. itv_site_training_summary(visite) : pour le technicien de la visite (ou qui gère les visites), personnel du
--    site en nombres seulement (salariés connus, formés et valides dans les domaines suivis, sans site renseigné,
--    prochaine échéance, dernier exercice d'évacuation). Jamais de noms. Des faits, pas un taux de conformité : le
--    code du travail impose de désigner les personnes et de faire des exercices (R4227-38, R4227-39).
-- 3. pont_signaler_besoin(visite, note) et pont_declarer_exercice(visite, date) : les deux gestes du technicien.
-- 4. Fin de session : une session terminée d'une formation d'un domaine suivi, chez un client actif sans contrat de
--    maintenance actif, crée une piste « vers la maintenance » (module pont et Interventions actifs, création
--    automatique cochée). Client inactif ou « ne pas solliciter » : rien.
-- 5. Module « pont » (org_modules) : réglages domaines suivis (incendie), création automatique, responsable par
--    défaut. Actif d'emblée seulement si Formation et Interventions le sont.
-- Les pistes des clients de démonstration partent avec la purge (colonne client_id, comme les autres tables).
-- Table cross_sell_leads : company_id, règles par droits (build_suite('0130')) et isolement par société.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0130_pont_formation_maintenance_retour.sql

create table if not exists public.cross_sell_leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id),
  client_id uuid not null references public.clients(id) on delete cascade,
  site_id uuid references public.sites(id) on delete set null,
  direction text not null check (direction in ('vers_formation', 'vers_maintenance')),
  domain text not null default 'incendie',
  rule_id uuid references public.obligation_rules(id) on delete set null,
  source_kind text not null default 'manuel' check (source_kind in ('visite', 'session', 'manuel')),
  source_id uuid,
  note text,
  status text not null default 'nouvelle' check (status in ('nouvelle', 'en_cours', 'devis_envoye', 'gagnee', 'perdue', 'ignoree')),
  quote_id uuid references public.quotes(id) on delete set null,
  assigned_to uuid references public.profiles(id) on delete set null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);
create unique index if not exists cross_sell_leads_ouverte on public.cross_sell_leads (company_id, client_id, direction, domain)
  where status in ('nouvelle', 'en_cours', 'devis_envoye');
create index if not exists cross_sell_leads_statut_idx on public.cross_sell_leads (company_id, status, created_at desc);
comment on table public.cross_sell_leads is 'Pistes entre formation et maintenance (fonction 10) : une seule ouverte par client, sens et domaine';

create or replace function app.cross_sell_leads_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.company_id := coalesce((select c.company_id from public.clients c where c.id = new.client_id), new.company_id);
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at; new.created_by := old.created_by;
    if new.status in ('gagnee', 'perdue', 'ignoree') and old.status not in ('gagnee', 'perdue', 'ignoree') then new.closed_at := now(); end if;
    if new.status in ('nouvelle', 'en_cours', 'devis_envoye') then new.closed_at := null; end if;
  end if;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function app.cross_sell_leads_maj() from public, anon, authenticated;
drop trigger if exists cross_sell_leads_maj on public.cross_sell_leads;
create trigger cross_sell_leads_maj before insert or update on public.cross_sell_leads for each row execute function app.cross_sell_leads_maj();

alter table public.cross_sell_leads enable row level security;
revoke all on table public.cross_sell_leads from public, anon;
grant select, insert, update, delete on table public.cross_sell_leads to authenticated;
grant all on table public.cross_sell_leads to service_role;

-- ── Règles (générées par scripts/securite/regles.py, build_suite('0130')) ──

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
           where schemaname = 'public' and tablename = any (array['cross_sell_leads'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- cross_sell_leads
select pg_temp.regles(array['cross_sell_leads'], null,
  $r$company_id in (select app.societes_avec_droit('clients.fiches.voir'))$r$,
  $r$company_id in (select app.societes_avec_droit('clients.fiches.modifier'))$r$,
  $r$company_id in (select app.societes_avec_droit('clients.fiches.modifier'))$r$,
  $r$company_id in (select app.societes_avec_droit('clients.fiches.modifier'))$r$);

drop policy if exists cross_sell_leads_societe_lire on public.cross_sell_leads;
drop policy if exists cross_sell_leads_societe_creer on public.cross_sell_leads;
drop policy if exists cross_sell_leads_societe_modifier on public.cross_sell_leads;
drop policy if exists cross_sell_leads_societe_supprimer on public.cross_sell_leads;
create policy cross_sell_leads_societe_lire on public.cross_sell_leads as restrictive for select to authenticated
  using (company_id in (select app.societes_lisibles()));
create policy cross_sell_leads_societe_creer on public.cross_sell_leads as restrictive for insert to authenticated
  with check (company_id in (select app.societes_ecriture()));
create policy cross_sell_leads_societe_modifier on public.cross_sell_leads as restrictive for update to authenticated
  using (company_id in (select app.societes_ecriture())) with check (company_id in (select app.societes_ecriture()));
create policy cross_sell_leads_societe_supprimer on public.cross_sell_leads as restrictive for delete to authenticated
  using (company_id in (select app.societes_ecriture()));

-- ── 5. Module ──
insert into public.org_modules (key, label, enabled, position, description, settings)
select 'pont', 'Pont formation et maintenance',
       coalesce((select enabled from public.org_modules where key = 'formation'), false)
         and coalesce((select enabled from public.org_modules where key = 'interventions'), false),
       125,
       'À la fin d''une visite, le personnel formé du site en un coup d''œil et le signalement d''un besoin de formation ; une session incendie chez un client sans contrat de maintenance crée une piste maintenance',
       jsonb_build_object('domaines', jsonb_build_array('incendie'), 'auto', true, 'responsable', null)
on conflict (key) do nothing;

create or replace function app.pont_reglages()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select m.settings from public.org_modules m where m.key = 'pont'), '{}'::jsonb)
$$;
revoke all on function app.pont_reglages() from public, anon, authenticated;

create or replace function app.pont_domaines()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select array_agg(x) from jsonb_array_elements_text(app.pont_reglages() -> 'domaines') x), array['incendie'])
$$;
revoke all on function app.pont_domaines() from public, anon, authenticated;

-- Visite accessible au technicien de la visite ou à qui gère les visites
create or replace function app.pont_visite(p_visit uuid)
returns public.itv_visits
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v public.itv_visits;
begin
  select * into v from public.itv_visits where id = p_visit;
  if v.id is null or not (
       v.technician_id = (select auth.uid())
       or (app.a_le_droit('interventions.visites.gerer') and v.company_id in (select app.societes_avec_droit('interventions.visites.gerer')))) then
    raise exception 'Visite inaccessible' using errcode = '42501';
  end if;
  return v;
end
$$;
revoke all on function app.pont_visite(uuid) from public, anon, authenticated;

-- ── 2. Personnel du site, en nombres ──
create or replace function public.itv_site_training_summary(p_visit uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.itv_visits := app.pont_visite(p_visit);
  v_dom text[] := app.pont_domaines();
  v_regles uuid[];
  r jsonb;
begin
  select array_agg(o.id) into v_regles from public.obligation_rules o
  where o.company_id = v.company_id and o.domain = any (v_dom) and o.kind = 'formation' and o.is_active;
  with personnel as (
    select tr.id, tr.site_id from public.trainees tr
    where tr.client_id = v.client_id and (v.site_id is null or tr.site_id = v.site_id or tr.site_id is null)
  ), valides as (
    select p.id, p.site_id, min(vt.echeance) filter (where vt.echeance >= current_date) as echeance
    from personnel p join public.v_trainee_validities vt on vt.trainee_id = p.id
    where vt.rule_id = any (coalesce(v_regles, '{}'::uuid[])) and (vt.echeance is null or vt.echeance >= current_date)
    group by p.id, p.site_id
  )
  select jsonb_build_object(
    'domaines', to_jsonb(v_dom),
    'connus', (select count(*) from personnel p where v.site_id is null or p.site_id = v.site_id),
    'formes', (select count(*) from valides x where v.site_id is null or x.site_id = v.site_id),
    'sans_site', case when v.site_id is null then 0 else (select count(*) from personnel p where p.site_id is null) end,
    'formes_sans_site', case when v.site_id is null then 0 else (select count(*) from valides x where x.site_id is null) end,
    'prochaine_echeance', (select min(x.echeance) from valides x),
    'dernier_exercice', (select max(c.done_on) from public.client_safety_checks c join public.obligation_rules o on o.id = c.rule_id
                         where c.client_id = v.client_id and (v.site_id is null or c.site_id is null or c.site_id = v.site_id)
                           and o.kind = 'exercice' and o.domain = any (v_dom)),
    'piste_ouverte', exists (select 1 from public.cross_sell_leads l where l.client_id = v.client_id and l.direction = 'vers_formation'
                             and l.status in ('nouvelle', 'en_cours', 'devis_envoye'))
  ) into r;
  return r;
end
$$;

-- ── 3. Gestes du technicien ──
create or replace function public.pont_signaler_besoin(p_visit uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.itv_visits := app.pont_visite(p_visit);
  v_dom text := (app.pont_domaines())[1];
  v_rule uuid;
  v_id uuid;
  v_note text := nullif(btrim(p_note), '');
begin
  if not app.module_on('pont') then raise exception 'Module pont inactif' using errcode = '42501'; end if;
  if exists (select 1 from public.clients c where c.id = v.client_id
             and (coalesce(c.status, 'actif') in ('archive', 'archived', 'inactif') or coalesce((to_jsonb(c) ->> 'do_not_mail')::boolean, false))) then
    raise exception 'Client inactif ou à ne pas solliciter : aucune piste' using errcode = '22023';
  end if;
  if length(coalesce(v_note, '')) > 2000 then raise exception 'Note trop longue' using errcode = '22023'; end if;
  select o.id into v_rule from public.obligation_rules o
  where o.company_id = v.company_id and o.domain = v_dom and o.kind = 'formation' and o.is_active order by o.code limit 1;
  select l.id into v_id from public.cross_sell_leads l
  where l.client_id = v.client_id and l.direction = 'vers_formation' and l.domain = v_dom and l.status in ('nouvelle', 'en_cours', 'devis_envoye');
  if v_id is not null then
    update public.cross_sell_leads
       set note = concat_ws(E'\n', note, to_char(now() at time zone 'Europe/Paris', 'DD/MM/YYYY') || ', visite ' || coalesce(v.reference, '') || coalesce(' : ' || v_note, ''))
     where id = v_id;
    return v_id;
  end if;
  insert into public.cross_sell_leads (company_id, client_id, site_id, direction, domain, rule_id, source_kind, source_id, note, assigned_to)
  values (v.company_id, v.client_id, v.site_id, 'vers_formation', v_dom, v_rule, 'visite', v.id,
          to_char(now() at time zone 'Europe/Paris', 'DD/MM/YYYY') || ', visite ' || coalesce(v.reference, '') || coalesce(' : ' || v_note, ''),
          nullif(app.pont_reglages() ->> 'responsable', '')::uuid)
  returning id into v_id;
  insert into public.notifications (company_id, type, title, message, link, metadata)
  values (v.company_id, 'piste_formation', 'Besoin de formation signalé',
          coalesce((select c.name from public.clients c where c.id = v.client_id), 'Client') || ' : signalé à la visite ' || coalesce(v.reference, ''),
          '/pistes', jsonb_build_object('lead_id', v_id, 'client_id', v.client_id));
  return v_id;
end
$$;

create or replace function public.pont_declarer_exercice(p_visit uuid, p_date date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.itv_visits := app.pont_visite(p_visit);
  v_rule uuid;
  v_id uuid;
begin
  if p_date is null or p_date > current_date or p_date < current_date - 3650 then
    raise exception 'Date de l''exercice invalide' using errcode = '22023';
  end if;
  select o.id into v_rule from public.obligation_rules o
  where o.company_id = v.company_id and o.kind = 'exercice' and o.domain = any (app.pont_domaines()) and o.is_active
  order by (o.code = 'exercice_evacuation') desc, o.code limit 1;
  if v_rule is null then raise exception 'Aucune obligation d''exercice dans le référentiel' using errcode = '22023'; end if;
  insert into public.client_safety_checks (company_id, client_id, site_id, rule_id, done_on, done_by, observations, declared_by_client, created_by)
  values (v.company_id, v.client_id, v.site_id, v_rule, p_date, 'Le client (déclaré au technicien)',
          'Déclaré lors de la visite ' || coalesce(v.reference, ''), true, (select auth.uid()))
  returning id into v_id;
  return v_id;
end
$$;

do $$
declare f text;
begin
  foreach f in array array['itv_site_training_summary(uuid)', 'pont_signaler_besoin(uuid, text)', 'pont_declarer_exercice(uuid, date)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ── 4. Fin de session : piste vers la maintenance ──
create or replace function app.pont_fin_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dom text;
begin
  if new.status is distinct from 'completed' or old.status = 'completed' or new.client_id is null then return new; end if;
  if not exists (select 1 from public.org_modules m where m.key = 'pont' and m.enabled)
     or not exists (select 1 from public.org_modules m where m.key = 'interventions' and m.enabled)
     or coalesce((app.pont_reglages() ->> 'auto')::boolean, true) is false then
    return new;
  end if;
  select o.domain into v_dom from public.obligation_rules o
  where o.company_id = new.company_id and o.kind = 'formation' and o.is_active and new.course_id = any (o.course_ids)
    and o.domain = any (app.pont_domaines())
  limit 1;
  if v_dom is null then return new; end if;
  if exists (select 1 from public.itv_contracts k where k.client_id = new.client_id and coalesce(k.status, 'actif') in ('actif', 'active')
             and (k.end_on is null or k.end_on >= current_date)) then
    return new;
  end if;
  if exists (select 1 from public.clients c where c.id = new.client_id
             and (coalesce(c.status, 'actif') in ('archive', 'archived', 'inactif') or coalesce((to_jsonb(c) ->> 'do_not_mail')::boolean, false))) then
    return new;
  end if;
  if exists (select 1 from public.cross_sell_leads l where l.client_id = new.client_id and l.direction = 'vers_maintenance' and l.domain = v_dom
             and l.status in ('nouvelle', 'en_cours', 'devis_envoye')) then
    return new;
  end if;
  insert into public.cross_sell_leads (company_id, client_id, site_id, direction, domain, source_kind, source_id, note, assigned_to, created_by)
  values (new.company_id, new.client_id, new.site_id, 'vers_maintenance', v_dom, 'session', new.id,
          'Session ' || coalesce(new.reference, '') || ' terminée, pas de contrat de maintenance',
          nullif(app.pont_reglages() ->> 'responsable', '')::uuid, null);
  return new;
exception when others then
  -- Une piste ne doit jamais empêcher de terminer une session
  raise notice 'Piste maintenance non créée : %', sqlerrm;
  return new;
end
$$;
revoke all on function app.pont_fin_session() from public, anon, authenticated;
drop trigger if exists sessions_pont_fin on public.sessions;
create trigger sessions_pont_fin after update of status on public.sessions for each row execute function app.pont_fin_session();

insert into public.schema_migrations (version) values ('0130_pont_formation_maintenance') on conflict (version) do nothing;
