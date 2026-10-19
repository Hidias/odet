-- 0140_registre_securite.sql : fonction 11, registre de sécurité numérique du client (module « registre »).
--
-- Spec : odet-f11-registre-securite.md (validée le 14/10/2026). Aucune recopie : vérifications des Interventions,
-- exercices et essais de l'exploitant, personnel formé et échéances du lot 2, DUERP du client.
-- 1. client_documents : pièces que ni l'organisme ni l'outil ne produisent (consigne incendie, plan d'évacuation,
--    rapport d'un organisme agréé, permis, autre), déposées par l'organisme ou par l'entreprise. Fichiers dans le
--    bucket privé « registre », chemin <société>/<client>/<fichier>.
-- 2. app.registre_donnees(...) : le registre d'un client (sites, vérifications, parc, exercices, personnel formé,
--    échéances, documents, DUERP, dossier de contrôle avec l'état de chaque pièce). Des faits datés et des échéances
--    calculées, jamais une note de conformité. Le registre alimente les registres légaux ; il ne prétend pas les
--    remplacer (tenue sur support informatique : L8113-6 et décrets, à vérifier par registre).
-- 3. Espace entreprise : ent_registre(site), ent_exercice_ajouter(...), ent_document_ajouter(...) ; un compte limité
--    à certains sites ne voit que ceux-là. Organisme : registre_client(client, site) sur la fiche client.
-- 4. Module « registre » (org_modules), actif d'emblée si Formation ou Interventions l'est.
-- Table client_documents : company_id, règles par droits (build_suite('0140')) et isolement par société.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0140_registre_securite_retour.sql

create table if not exists public.client_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id),
  client_id uuid not null references public.clients(id) on delete cascade,
  site_id uuid references public.sites(id) on delete set null,
  kind text not null default 'autre' check (kind in ('consigne_incendie', 'plan_evacuation', 'rapport_organisme_agree', 'permis', 'autre')),
  title text not null,
  file_path text,
  file_name text,
  issued_on date,
  valid_until date,
  source text not null default 'organisme' check (source in ('organisme', 'entreprise')),
  uploaded_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists client_documents_client_idx on public.client_documents (client_id, kind);

create or replace function app.client_documents_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.company_id := coalesce((select c.company_id from public.clients c where c.id = new.client_id), new.company_id);
  if new.site_id is not null and not exists (select 1 from public.sites s where s.id = new.site_id and s.client_id = new.client_id) then
    raise exception 'Ce site n''appartient pas au client' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function app.client_documents_maj() from public, anon, authenticated;
drop trigger if exists client_documents_maj on public.client_documents;
create trigger client_documents_maj before insert or update on public.client_documents for each row execute function app.client_documents_maj();

alter table public.client_documents enable row level security;
revoke all on table public.client_documents from public, anon;
grant select, insert, update, delete on table public.client_documents to authenticated;
grant all on table public.client_documents to service_role;

-- ── Règles (générées par scripts/securite/regles.py, build_suite('0140')) ──

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
           where schemaname = 'public' and tablename = any (array['client_documents'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- client_documents
select pg_temp.regles(array['client_documents'], null,
  $r$company_id in (select app.societes_avec_droit('clients.fiches.voir'))$r$,
  $r$company_id in (select app.societes_avec_droit('clients.fiches.modifier'))$r$,
  $r$company_id in (select app.societes_avec_droit('clients.fiches.modifier'))$r$,
  $r$company_id in (select app.societes_avec_droit('clients.fiches.modifier'))$r$);

drop policy if exists client_documents_societe_lire on public.client_documents;
drop policy if exists client_documents_societe_creer on public.client_documents;
drop policy if exists client_documents_societe_modifier on public.client_documents;
drop policy if exists client_documents_societe_supprimer on public.client_documents;
create policy client_documents_societe_lire on public.client_documents as restrictive for select to authenticated
  using (company_id in (select app.societes_lisibles()));
create policy client_documents_societe_creer on public.client_documents as restrictive for insert to authenticated
  with check (company_id in (select app.societes_ecriture()));
create policy client_documents_societe_modifier on public.client_documents as restrictive for update to authenticated
  using (company_id in (select app.societes_ecriture())) with check (company_id in (select app.societes_ecriture()));
create policy client_documents_societe_supprimer on public.client_documents as restrictive for delete to authenticated
  using (company_id in (select app.societes_ecriture()));

-- ── Fichiers ──
-- Dossier du compte entreprise connecté (<société>/<client>), null sinon
create or replace function app.ent_dossier_registre()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select a.company_id::text || '/' || a.client_id::text
  from public.client_accounts a join public.profiles p on p.id = a.profile_id
  where a.profile_id = (select auth.uid()) and a.is_active and p.role = 'entreprise' and coalesce(p.is_active, true)
$$;
revoke all on function app.ent_dossier_registre() from public, anon;
grant execute on function app.ent_dossier_registre() to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('registre', 'registre', false, 15728640, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
drop policy if exists registre_lire on storage.objects;
drop policy if exists registre_creer on storage.objects;
drop policy if exists registre_supprimer on storage.objects;
create policy registre_lire on storage.objects for select to authenticated
  using (bucket_id = 'registre' and (
    (storage.foldername(name))[1] in (select x::text from app.societes_avec_droit('clients.fiches.voir') x)
    or name like (select app.ent_dossier_registre()) || '/%'));
create policy registre_creer on storage.objects for insert to authenticated
  with check (bucket_id = 'registre' and (
    (storage.foldername(name))[1] in (select x::text from app.societes_avec_droit('clients.fiches.modifier') x)
    or name like (select app.ent_dossier_registre()) || '/%'));
create policy registre_supprimer on storage.objects for delete to authenticated
  using (bucket_id = 'registre' and (storage.foldername(name))[1] in (select x::text from app.societes_avec_droit('clients.fiches.modifier') x));

-- ── 4. Module ──
insert into public.org_modules (key, label, enabled, position, description)
select 'registre', 'Registre de sécurité du client',
       coalesce((select enabled from public.org_modules where key = 'formation'), false)
         or coalesce((select enabled from public.org_modules where key = 'interventions'), false),
       127,
       'Pour chaque client et chaque site : vérifications, exercices, personnel formé, échéances, documents à présenter et dossier de contrôle, aussi dans l''espace entreprise'
on conflict (key) do nothing;

-- ── 2. Données du registre ──
create or replace function app.registre_donnees(p_company uuid, p_client uuid, p_sites uuid[], p_site uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inc uuid[];
  v_sst uuid[];
  r jsonb;
begin
  if p_site is not null and p_sites is not null and not (p_site = any (p_sites)) then
    raise exception 'Site non autorisé' using errcode = '42501';
  end if;
  select array_agg(o.id) filter (where o.domain = 'incendie'), array_agg(o.id) filter (where o.domain = 'secours')
    into v_inc, v_sst
  from public.obligation_rules o where o.company_id = p_company and o.kind = 'formation' and o.is_active;

  with sites_ok as (
    select s.id, s.name, s.city, s.is_default from public.sites s
    where s.client_id = p_client and coalesce(s.is_active, true) and (p_sites is null or s.id = any (p_sites))
  ), visites as (
    select v.* from public.itv_visits v
    where v.client_id = p_client and v.status = 'terminee'
      and (p_site is null or v.site_id = p_site)
      and (p_sites is null or v.site_id = any (p_sites))
  ), personnel as (
    select tr.id, tr.first_name, tr.last_name, tr.job_title, tr.site_id from public.trainees tr
    where tr.client_id = p_client
      and (p_site is null or tr.site_id = p_site or tr.site_id is null)
      and (p_sites is null or tr.site_id is null or tr.site_id = any (p_sites))
  ), validites as (
    select p.id as trainee_id, vt.rule_id, vt.valide_le, vt.echeance, o.label, o.domain, o.reminder_days
    from personnel p join public.v_trainee_validities vt on vt.trainee_id = p.id
    left join public.obligation_rules o on o.id = vt.rule_id
  ), exercices as (
    select c.*, o.label as rule_label, o.domain, o.validity_months from public.client_safety_checks c
    left join public.obligation_rules o on o.id = c.rule_id
    where c.client_id = p_client
      and (p_site is null or c.site_id = p_site or c.site_id is null)
      and (p_sites is null or c.site_id is null or c.site_id = any (p_sites))
  ), docs as (
    select d.* from public.client_documents d
    where d.client_id = p_client
      and (p_site is null or d.site_id = p_site or d.site_id is null)
      and (p_sites is null or d.site_id is null or d.site_id = any (p_sites))
  ), parc as (
    select e.* from public.itv_equipment e
    where e.client_id = p_client and coalesce(e.status, 'actif') not in ('retire', 'hors_service', 'inventaire')
      and (p_site is null or e.site_id = p_site)
      and (p_sites is null or e.site_id = any (p_sites))
  ), duerp as (
    select dp.reference, dp.version, dp.status, dp.date_finalisation, dp.date_prochaine_maj from public.duerp_projects dp
    where dp.client_id = p_client order by dp.version desc nulls last, dp.updated_at desc limit 1
  )
  select jsonb_build_object(
    'client', (select jsonb_build_object('id', c.id, 'name', c.name, 'city', c.city) from public.clients c where c.id = p_client),
    'site', p_site,
    'sites', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'city', s.city) order by s.is_default desc, s.name) from sites_ok s), '[]'::jsonb),
    'verifications', coalesce((select jsonb_agg(jsonb_build_object(
          'id', v.id, 'reference', v.reference, 'date', coalesce(v.finished_at::date, v.planned_on, v.due_on),
          'site', (select s.name from public.sites s where s.id = v.site_id),
          'appareils', (select count(*) from public.itv_visit_items i where i.visit_id = v.id),
          'conformes', (select count(*) from public.itv_visit_items i where i.visit_id = v.id and i.result = 'conforme'),
          'a_remplacer', (select count(*) from public.itv_visit_items i where i.visit_id = v.id and i.result = 'a_remplacer'),
          'rapport_envoye', v.report_sent_at is not null) order by coalesce(v.finished_at::date, v.planned_on) desc)
        from (select * from visites order by coalesce(finished_at::date, planned_on) desc limit 30) v), '[]'::jsonb),
    'parc', jsonb_build_object('appareils', (select count(*) from parc), 'prochaine_verification', (select min(next_check_on) from parc),
                               'en_retard', (select count(*) from parc where next_check_on < current_date)),
    'exercices', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'label', coalesce(e.rule_label, 'Exercice'), 'done_on', e.done_on,
          'done_by', e.done_by, 'participants', e.participants, 'observations', e.observations, 'next_due_on', e.next_due_on,
          'declared_by_client', coalesce(e.declared_by_client, false)) order by e.done_on desc)
        from (select * from exercices order by done_on desc limit 50) e), '[]'::jsonb),
    'personnel', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'first_name', p.first_name, 'last_name', p.last_name,
          'job_title', p.job_title, 'site', (select s.name from public.sites s where s.id = p.site_id),
          'validites', coalesce((select jsonb_agg(jsonb_build_object('label', coalesce(x.label, 'Formation'), 'valide_le', x.valide_le, 'echeance', x.echeance,
              'statut', case when x.echeance is null then 'a_jour' when x.echeance < current_date then 'depasse'
                             when x.echeance <= current_date + coalesce(x.reminder_days, 90) then 'a_prevoir' else 'a_jour' end) order by x.echeance nulls last)
            from validites x where x.trainee_id = p.id), '[]'::jsonb))
          order by p.last_name, p.first_name) from personnel p
        where exists (select 1 from validites x where x.trainee_id = p.id)), '[]'::jsonb),
    'echeances', coalesce((select jsonb_agg(jsonb_build_object('kind', d.kind, 'label', d.rule_label, 'objet', d.objet_label, 'due_on', d.due_on,
          'status', d.status, 'site', (select s.name from public.sites s where s.id = d.site_id)) order by d.due_on nulls last)
        from public.v_obligation_deadlines d where d.client_id = p_client
          and (p_site is null or d.site_id = p_site or d.site_id is null)
          and (p_sites is null or d.site_id is null or d.site_id = any (p_sites))), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'title', d.title, 'file_path', d.file_path,
          'file_name', d.file_name, 'issued_on', d.issued_on, 'valid_until', d.valid_until, 'source', d.source,
          'site', (select s.name from public.sites s where s.id = d.site_id)) order by d.created_at desc) from docs d), '[]'::jsonb),
    'duerp', (select to_jsonb(x) from duerp x),
    'types_exercice', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label) order by o.label) from public.obligation_rules o
                                where o.company_id = p_company and o.kind = 'exercice' and o.is_active), '[]'::jsonb),
    'dossier', jsonb_build_array(
      jsonb_build_object('piece', 'Consigne de sécurité incendie', 'ref', 'R4227-37 et R4227-38',
        'etat', case when exists (select 1 from docs d where d.kind = 'consigne_incendie' and (d.valid_until is null or d.valid_until >= current_date)) then 'a_jour' else 'manquant' end),
      jsonb_build_object('piece', 'Plan d''évacuation', 'ref', null,
        'etat', case when exists (select 1 from docs d where d.kind = 'plan_evacuation' and (d.valid_until is null or d.valid_until >= current_date)) then 'a_jour' else 'manquant' end),
      jsonb_build_object('piece', 'Vérification du matériel de sécurité (12 derniers mois)', 'ref', 'R4224-17',
        'etat', case when exists (select 1 from visites v where coalesce(v.finished_at::date, v.planned_on) >= current_date - 365) then 'a_jour'
                     when exists (select 1 from docs d where d.kind = 'rapport_organisme_agree' and coalesce(d.issued_on, current_date) >= current_date - 365) then 'a_jour'
                     when exists (select 1 from visites) then 'a_prevoir' else 'manquant' end),
      jsonb_build_object('piece', 'Exercices et essais (6 derniers mois)', 'ref', 'R4227-39',
        'etat', case when exists (select 1 from exercices e where e.done_on >= current_date - 183) then 'a_jour'
                     when exists (select 1 from exercices) then 'a_prevoir' else 'manquant' end),
      jsonb_build_object('piece', 'Personnes désignées et formées (incendie)', 'ref', 'R4227-38',
        'etat', case when exists (select 1 from validites x where x.rule_id = any (coalesce(v_inc, '{}'::uuid[])) and (x.echeance is null or x.echeance >= current_date)) then 'a_jour' else 'manquant' end),
      jsonb_build_object('piece', 'Sauveteurs secouristes du travail', 'ref', 'R4224-15',
        'etat', case when exists (select 1 from validites x where x.rule_id = any (coalesce(v_sst, '{}'::uuid[])) and (x.echeance is null or x.echeance >= current_date)) then 'a_jour'
                     when exists (select 1 from validites x where x.rule_id = any (coalesce(v_sst, '{}'::uuid[]))) then 'a_prevoir' else 'manquant' end),
      jsonb_build_object('piece', 'Document unique (DUERP) à jour', 'ref', 'R4121-1 et R4121-2',
        'etat', case when not exists (select 1 from duerp) then 'manquant'
                     when (select date_prochaine_maj from duerp) is null or (select date_prochaine_maj from duerp) >= current_date then 'a_jour' else 'a_prevoir' end)
    )
  ) into r;
  return r;
end
$$;
revoke all on function app.registre_donnees(uuid, uuid, uuid[], uuid) from public, anon, authenticated;

-- ── 3. Espace entreprise ──
create or replace function public.ent_registre(p_site uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v public.client_accounts := app.ent_compte();
begin
  if not exists (select 1 from public.org_modules m where m.key = 'registre' and m.enabled) then
    raise exception 'Registre non activé' using errcode = '42501';
  end if;
  return app.registre_donnees(v.company_id, v.client_id, app.ent_sites(v), p_site);
end
$$;

create or replace function public.ent_exercice_ajouter(p_site uuid, p_rule uuid, p_date date, p_participants int default null,
                                                       p_observations text default null)
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
  if not exists (select 1 from public.obligation_rules o where o.id = p_rule and o.company_id = v.company_id and o.kind = 'exercice') then
    raise exception 'Type d''exercice inconnu' using errcode = '22023';
  end if;
  if p_date is null or p_date > current_date or p_date < current_date - 3650 then
    raise exception 'Date invalide' using errcode = '22023';
  end if;
  if length(coalesce(p_observations, '')) > 4000 or coalesce(p_participants, 0) < 0 or coalesce(p_participants, 0) > 100000 then
    raise exception 'Saisie invalide' using errcode = '22023';
  end if;
  insert into public.client_safety_checks (company_id, client_id, site_id, rule_id, done_on, done_by, participants, observations, declared_by_client, created_by)
  values (v.company_id, v.client_id, p_site, p_rule, p_date, 'L''entreprise (espace entreprise)', p_participants,
          nullif(btrim(p_observations), ''), true, (select auth.uid()))
  returning id into v_id;
  return v_id;
end
$$;

create or replace function public.ent_document_ajouter(p_site uuid, p_kind text, p_title text, p_path text, p_file_name text,
                                                       p_issued_on date default null, p_valid_until date default null)
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
  if p_path is null or p_path not like v.company_id::text || '/' || v.client_id::text || '/%' or p_path like '%..%'
     or not exists (select 1 from storage.objects o where o.bucket_id = 'registre' and o.name = p_path) then
    raise exception 'Fichier introuvable' using errcode = '22023';
  end if;
  if nullif(btrim(p_title), '') is null or length(p_title) > 300 then raise exception 'Titre requis' using errcode = '22023'; end if;
  insert into public.client_documents (company_id, client_id, site_id, kind, title, file_path, file_name, issued_on, valid_until, source, uploaded_by)
  values (v.company_id, v.client_id, p_site, coalesce(nullif(p_kind, ''), 'autre'), btrim(p_title), p_path, left(p_file_name, 300),
          p_issued_on, p_valid_until, 'entreprise', (select auth.uid()))
  returning id into v_id;
  return v_id;
end
$$;

-- Ce que l'espace entreprise propose (modules) et le dossier de dépôt du compte
create or replace function public.ent_modules()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v public.client_accounts := app.ent_compte();
begin
  return jsonb_build_object('registre', exists (select 1 from public.org_modules m where m.key = 'registre' and m.enabled),
                            'client_id', v.client_id, 'company_id', v.company_id);
end
$$;

-- Organisme : registre d'un client depuis sa fiche
create or replace function public.registre_client(p_client uuid, p_site uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_company uuid;
begin
  select c.company_id into v_company from public.clients c
  where c.id = p_client and c.company_id in (select app.societes_avec_droit('clients.fiches.voir'));
  if v_company is null then raise exception 'Accès refusé' using errcode = '42501'; end if;
  return app.registre_donnees(v_company, p_client, null, p_site);
end
$$;

do $$
declare f text;
begin
  foreach f in array array['ent_modules()', 'ent_registre(uuid)', 'ent_exercice_ajouter(uuid, uuid, date, int, text)',
                           'ent_document_ajouter(uuid, text, text, text, text, date, date)', 'registre_client(uuid, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

insert into public.schema_migrations (version) values ('0140_registre_securite') on conflict (version) do nothing;
