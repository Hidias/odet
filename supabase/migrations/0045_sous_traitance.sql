-- 0045_sous_traitance.sql : sous-traitance, l'organisme donneur d'ordres (lot 2, branche sous-traitance).
--
-- Spec : odet-lot2-spec.md v2, section 5. Le cas inverse (session réalisée pour le compte d'un autre organisme,
-- session_type = 'subcontract') garde ses colonnes.
-- 1. subcontractors : prestataires (organismes ou formateurs indépendants), identité, NDA, Qualiopi.
-- 2. subcontractor_doc_types (par société) : justificatifs demandés, périodicité, seuil. Départ [OFFICIEL,
--    code.travail.gouv.fr, consulté le 14/10/2026] : attestation de vigilance URSSAF à la conclusion puis tous les six
--    mois (D8222-5) pour toute opération d'au moins 5 000 € HT (R8222-1), extrait d'immatriculation (D8222-5) ; puis
--    attestation d'assurance, certificat Qualiopi, attestation de déclaration d'activité, CV, charte et contrat signés.
-- 3. subcontractor_documents : justificatifs déposés (fichier, date, validité calculée si non saisie).
-- 4. subcontract_orders : bons de commande (session, jours, montant, statut, bon signé).
-- 5. trainers.subcontractor_id : formateur rattaché à son prestataire.
-- 6. v_subcontractor_compliance : par prestataire et justificatif demandé, état (à jour, à renouveler dans 30 jours,
--    périmé, manquant) ; un justificatif périmé est un avertissement, jamais un blocage (décision du 12/10). Seuil :
--    montant des commandes des 12 derniers mois et à venir.
-- 6 bis. Société créée ensuite : justificatifs et obligations de départ posés à sa création.
-- 6 ter. Fichiers dans le bucket privé « prestataires » (chemin commençant par la société), règles par droits.
-- 7. Relances des justificatifs par le moteur commun (0043) : scheduled_actions_generate() prépare aussi une relance
--    « justificatif » par prestataire actif qui a une commande en cours ou à venir et un justificatif manquant, périmé
--    ou à renouveler.
-- Toutes les tables naissent avec company_id ; règles par droits (build_suite('0045')) et isolement par société.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0045_sous_traitance_retour.sql

-- ── 1. Prestataires ──
create table if not exists public.subcontractors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id),
  name text not null,
  kind text not null default 'organisme' check (kind in ('organisme', 'independant')),
  siren varchar(9),
  siret varchar(14),
  address text,
  postal_code varchar(10),
  city varchar(100),
  email text,
  phone text,
  contact_name text,
  nda text,
  qualiopi boolean not null default false,
  qualiopi_until date,
  daily_rate numeric(10,2),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.subcontractors is 'Prestataires de l''organisme donneur d''ordres (sous-traitance de formations)';

-- ── 2. Types de justificatifs ──
create table if not exists public.subcontractor_doc_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  code text not null,
  label text not null,
  validity_months int check (validity_months is null or validity_months > 0),
  required boolean not null default true,
  threshold_ht numeric(12,2),
  applies_to text not null default 'tous' check (applies_to in ('tous', 'organisme', 'independant')),
  legal_ref text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, code)
);

-- ── 3. Justificatifs déposés ──
create table if not exists public.subcontractor_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id),
  subcontractor_id uuid not null references public.subcontractors(id) on delete cascade,
  doc_type_id uuid references public.subcontractor_doc_types(id) on delete set null,
  label text,
  file_path text,
  file_name text,
  issued_on date,
  valid_until date,
  notes text,
  uploaded_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists subcontractor_documents_st_idx on public.subcontractor_documents (subcontractor_id, doc_type_id, issued_on desc);

-- ── 4. Bons de commande ──
create table if not exists public.subcontract_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id),
  subcontractor_id uuid not null references public.subcontractors(id) on delete restrict,
  session_id uuid references public.sessions(id) on delete set null,
  reference text,
  order_date date not null default (now() at time zone 'Europe/Paris')::date,
  start_date date,
  end_date date,
  days numeric(6,2),
  daily_rate numeric(10,2),
  amount_ht numeric(12,2),
  object text,
  status text not null default 'brouillon' check (status in ('brouillon', 'envoye', 'signe', 'realise', 'facture', 'paye', 'annule')),
  signed_path text,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists subcontract_orders_st_idx on public.subcontract_orders (subcontractor_id, order_date desc);
create index if not exists subcontract_orders_session_idx on public.subcontract_orders (session_id) where session_id is not null;

-- ── 5. Formateur d'un prestataire ──
alter table public.trainers add column if not exists subcontractor_id uuid references public.subcontractors(id) on delete set null;

-- ── Tenue par la base ──
create or replace function app.sous_traitance_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_mois int;
begin
  if tg_table_name = 'subcontractor_documents' then
    new.company_id := coalesce((select s.company_id from public.subcontractors s where s.id = new.subcontractor_id), new.company_id);
    if new.valid_until is null and new.issued_on is not null and new.doc_type_id is not null then
      select t.validity_months into v_mois from public.subcontractor_doc_types t where t.id = new.doc_type_id;
      if v_mois is not null then new.valid_until := (new.issued_on + make_interval(months => v_mois))::date; end if;
    end if;
  elsif tg_table_name = 'subcontract_orders' then
    new.company_id := coalesce((select s.company_id from public.subcontractors s where s.id = new.subcontractor_id), new.company_id);
    if new.amount_ht is null and new.days is not null and new.daily_rate is not null then
      new.amount_ht := round(new.days * new.daily_rate, 2);
    end if;
    if new.reference is null then
      new.reference := 'BC-' || to_char(coalesce(new.order_date, current_date), 'YYYYMMDD') || '-'
        || lpad(((select count(*) from public.subcontract_orders o where o.company_id = new.company_id) + 1)::text, 4, '0');
    end if;
    new.updated_at := now();
  else
    new.updated_at := now();
  end if;
  return new;
end
$$;
revoke all on function app.sous_traitance_maj() from public, anon, authenticated;

drop trigger if exists subcontractors_maj on public.subcontractors;
create trigger subcontractors_maj before update on public.subcontractors for each row execute function app.sous_traitance_maj();
drop trigger if exists subcontractor_documents_maj on public.subcontractor_documents;
create trigger subcontractor_documents_maj before insert or update on public.subcontractor_documents for each row execute function app.sous_traitance_maj();
drop trigger if exists subcontract_orders_maj on public.subcontract_orders;
create trigger subcontract_orders_maj before insert or update on public.subcontract_orders for each row execute function app.sous_traitance_maj();

alter table public.subcontractors enable row level security;
alter table public.subcontractor_doc_types enable row level security;
alter table public.subcontractor_documents enable row level security;
alter table public.subcontract_orders enable row level security;
revoke all on table public.subcontractors, public.subcontractor_doc_types, public.subcontractor_documents, public.subcontract_orders from public, anon;
grant select, insert, update, delete on table public.subcontractors, public.subcontractor_doc_types, public.subcontractor_documents, public.subcontract_orders to authenticated;
grant all on table public.subcontractors, public.subcontractor_doc_types, public.subcontractor_documents, public.subcontract_orders to service_role;

-- ── Règles (générées par scripts/securite/regles.py, build_suite('0045')) ──

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
           where schemaname = 'public' and tablename = any (array['subcontract_orders', 'subcontractor_doc_types', 'subcontractor_documents', 'subcontractors'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- subcontract_orders
select pg_temp.regles(array['subcontract_orders'], null,
  $r$company_id in (select app.societes_avec_droit('formation.couts.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('formation.couts.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('formation.couts.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('formation.couts.gerer'))$r$);

-- subcontractor_doc_types, subcontractor_documents, subcontractors
select pg_temp.regles(array['subcontractor_doc_types', 'subcontractor_documents', 'subcontractors'], null,
  $r$company_id in (select app.societes_avec_droit('formation.formateurs.voir'))$r$,
  $r$company_id in (select app.societes_avec_droit('formation.formateurs.dossier'))$r$,
  $r$company_id in (select app.societes_avec_droit('formation.formateurs.dossier'))$r$,
  $r$company_id in (select app.societes_avec_droit('formation.formateurs.dossier'))$r$);

do $$
declare t text;
begin
  foreach t in array array['subcontractors', 'subcontractor_doc_types', 'subcontractor_documents', 'subcontract_orders'] loop
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

-- ── Fichiers : bucket privé « prestataires », chemin <société>/<prestataire>/<fichier> ──
-- Lecture avec le droit de voir les formateurs, dépôt et suppression avec le dossier des formateurs, dans sa société.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('prestataires', 'prestataires', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
drop policy if exists prestataires_lire on storage.objects;
drop policy if exists prestataires_creer on storage.objects;
drop policy if exists prestataires_supprimer on storage.objects;
create policy prestataires_lire on storage.objects for select to authenticated
  using (bucket_id = 'prestataires' and (storage.foldername(name))[1] in (select x::text from app.societes_avec_droit('formation.formateurs.voir') x));
create policy prestataires_creer on storage.objects for insert to authenticated
  with check (bucket_id = 'prestataires' and (storage.foldername(name))[1] in (select x::text from app.societes_avec_droit('formation.formateurs.dossier') x));
create policy prestataires_supprimer on storage.objects for delete to authenticated
  using (bucket_id = 'prestataires' and (storage.foldername(name))[1] in (select x::text from app.societes_avec_droit('formation.formateurs.dossier') x));

-- ── Justificatifs de départ, par société ──
create or replace function app.subcontractor_doc_types_depart(p_company uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v_n int;
begin
  insert into public.subcontractor_doc_types (company_id, code, label, validity_months, required, threshold_ht, applies_to, legal_ref, sort_order)
  values
    (p_company, 'vigilance_urssaf', 'Attestation de vigilance URSSAF', 6, true, 5000, 'tous',
     'D8222-5 : à la conclusion puis tous les six mois jusqu''à la fin de l''exécution ; R8222-1 : opérations d''au moins 5 000 € HT', 10),
    (p_company, 'immatriculation', 'Extrait d''immatriculation (Kbis ou carte artisan) ou récépissé', null, true, 5000, 'tous',
     'D8222-5 : document attestant l''immatriculation, à la conclusion du contrat', 20),
    (p_company, 'assurance_rc', 'Attestation d''assurance responsabilité civile professionnelle', 12, true, null, 'tous', null, 30),
    (p_company, 'nda', 'Attestation de déclaration d''activité (NDA)', null, true, null, 'organisme', 'L6351-1 : déclaration d''activité du prestataire de formation', 40),
    (p_company, 'qualiopi', 'Certificat Qualiopi', 36, false, null, 'organisme', 'Indicateur 27 du référentiel national qualité : contrôle du sous-traitant', 50),
    (p_company, 'cv', 'CV et qualifications du formateur', null, true, null, 'tous', 'Indicateurs 21 et 27 : compétences des intervenants', 60),
    (p_company, 'charte', 'Charte qualité prestataire signée', null, true, null, 'tous', 'Indicateur 27', 70),
    (p_company, 'contrat', 'Contrat de sous-traitance signé', null, true, null, 'tous', 'Indicateur 27 : clause de conformité au référentiel national qualité', 80)
  on conflict (company_id, code) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
revoke all on function app.subcontractor_doc_types_depart(uuid) from public, anon, authenticated;
select app.subcontractor_doc_types_depart(c.id) from public.companies c;

-- Société créée ensuite : référentiels de départ posés à la création (justificatifs ; obligations de 0042 aussi)
create or replace function app.societe_referentiels_depart()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.subcontractor_doc_types_depart(new.id);
  if to_regprocedure('app.obligation_rules_depart(uuid)') is not null then
    execute 'select app.obligation_rules_depart($1)' using new.id;
  end if;
  return null;
end
$$;
revoke all on function app.societe_referentiels_depart() from public, anon, authenticated;
drop trigger if exists companies_referentiels_depart on public.companies;
create trigger companies_referentiels_depart after insert on public.companies
  for each row execute function app.societe_referentiels_depart();

-- ── 6. Conformité des prestataires ──
create or replace view public.v_subcontractor_compliance
with (security_invoker = true)
as
with montants as (
  select o.subcontractor_id, coalesce(sum(o.amount_ht), 0) as montant
  from public.subcontract_orders o
  where o.status <> 'annule' and coalesce(o.end_date, o.order_date) >= current_date - 365
  group by o.subcontractor_id
), derniers as (
  select d.*, row_number() over (partition by d.subcontractor_id, d.doc_type_id order by coalesce(d.issued_on, d.created_at::date) desc) as rang
  from public.subcontractor_documents d
  where d.doc_type_id is not null
)
select s.company_id, s.id as subcontractor_id, s.name as subcontractor_name, t.id as doc_type_id, t.code, t.label, t.required,
       t.threshold_ht, coalesce(m.montant, 0) as montant_12_mois, d.id as document_id, d.issued_on, d.valid_until,
       case
         when d.id is null then 'manquant'
         when d.valid_until is not null and d.valid_until < current_date then 'perime'
         when d.valid_until is not null and d.valid_until <= current_date + 30 then 'a_renouveler'
         else 'a_jour'
       end as status
from public.subcontractors s
join public.subcontractor_doc_types t on t.company_id = s.company_id and t.is_active
  and (t.applies_to = 'tous' or t.applies_to = s.kind)
left join montants m on m.subcontractor_id = s.id
left join derniers d on d.subcontractor_id = s.id and d.doc_type_id = t.id and d.rang = 1
where s.is_active
  and (t.required or d.id is not null)
  and (t.threshold_ht is null or coalesce(m.montant, 0) >= t.threshold_ht or d.id is not null);

comment on view public.v_subcontractor_compliance is 'Justificatifs des prestataires : à jour, à renouveler (30 jours), périmé, manquant ; avertissement, jamais blocage';
revoke all on table public.v_subcontractor_compliance from public, anon;
grant select on table public.v_subcontractor_compliance to authenticated, service_role;

-- ── 7. Relances des justificatifs (moteur commun) ──
create or replace function public.scheduled_actions_generate()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int := 0;
  v_j int := 0;
begin
  if coalesce((select auth.role()), '') not in ('service_role', '') and not app.a_le_droit('plateforme.administrer') then
    raise exception 'Réservé à la tâche de nuit' using errcode = '42501';
  end if;

  -- Recyclages (0043, inchangé)
  with echeances as (
    select d.company_id, d.client_id, d.rule_id, d.rule_label, d.due_on, d.objet_label, d.status
    from public.v_obligation_deadlines d
    where d.kind = 'formation' and d.status in ('a_prevoir', 'depasse') and d.client_id is not null and d.rule_id is not null
  ), par_client as (
    select e.company_id, e.client_id, e.rule_id, min(e.rule_label) as rule_label, min(e.due_on) as premiere,
           count(*) as nb, bool_or(e.status = 'depasse') as depasse,
           jsonb_agg(jsonb_build_object('nom', e.objet_label, 'echeance', e.due_on) order by e.due_on) as personnes
    from echeances e
    group by e.company_id, e.client_id, e.rule_id
  ), avec_client as (
    select p.*, c.name as client_name,
           coalesce(nullif(btrim(c.contact_email), ''), nullif(btrim(c.email), ''),
                    (select nullif(btrim(cc.email), '') from public.client_contacts cc
                      where cc.client_id = c.id and cc.email is not null order by cc.is_primary desc nulls last limit 1)) as email
    from par_client p
    join public.clients c on c.id = p.client_id
    where coalesce(c.status, 'actif') not in ('archive', 'archived', 'inactif')
      and not coalesce((to_jsonb(c) ->> 'do_not_mail')::boolean, false)
  )
  insert into public.scheduled_actions (company_id, kind, target_table, target_id, client_id, rule_id, due_on, title, payload, dedup_key)
  select a.company_id, 'relance_recyclage', 'clients', a.client_id, a.client_id, a.rule_id, a.premiere,
         a.rule_label || ' : ' || a.nb || ' salarié' || case when a.nb > 1 then 's' else '' end || ' à recycler chez ' || a.client_name,
         jsonb_build_object(
           'destinataire', a.email,
           'objet', 'Recyclage ' || a.rule_label || ' à prévoir',
           'texte', 'Bonjour,' || E'\n\n'
             || case when a.depasse then 'La validité de la formation « ' || a.rule_label || ' » est dépassée ou arrive à échéance pour une partie de votre personnel :'
                     else 'La validité de la formation « ' || a.rule_label || ' » arrive à échéance pour une partie de votre personnel :' end
             || E'\n' || (select string_agg('- ' || coalesce(x ->> 'nom', 'salarié') || ' : ' || to_char((x ->> 'echeance')::date, 'DD/MM/YYYY'), E'\n')
                          from jsonb_array_elements(a.personnes) x)
             || E'\n\n' || 'Nous pouvons organiser le recyclage dans vos locaux ou dans les nôtres. Souhaitez-vous que nous vous proposions des dates ?'
             || E'\n\n' || 'Bien cordialement,',
           'personnes', a.personnes,
           'depasse', a.depasse),
         'recyclage:' || a.client_id || ':' || a.rule_id || ':' || to_char(a.premiere, 'YYYY-MM')
  from avec_client a
  on conflict (company_id, dedup_key) do nothing;
  get diagnostics v_n = row_count;

  -- Justificatifs des prestataires (0045) : prestataire actif avec une commande en cours ou à venir
  with manques as (
    select v.company_id, v.subcontractor_id, min(v.subcontractor_name) as nom,
           jsonb_agg(jsonb_build_object('justificatif', v.label, 'etat', v.status, 'jusqu_au', v.valid_until) order by v.label) as liste
    from public.v_subcontractor_compliance v
    where v.status in ('manquant', 'perime', 'a_renouveler')
      and exists (select 1 from public.subcontract_orders o where o.subcontractor_id = v.subcontractor_id
                  and o.status in ('brouillon', 'envoye', 'signe') and coalesce(o.end_date, o.start_date, o.order_date) >= current_date)
    group by v.company_id, v.subcontractor_id
  )
  insert into public.scheduled_actions (company_id, kind, target_table, target_id, due_on, title, payload, dedup_key)
  select m.company_id, 'justificatif_prestataire', 'subcontractors', m.subcontractor_id, current_date,
         'Justificatifs à demander à ' || m.nom,
         jsonb_build_object(
           'destinataire', (select nullif(btrim(s.email), '') from public.subcontractors s where s.id = m.subcontractor_id),
           'objet', 'Documents à nous transmettre',
           'texte', 'Bonjour,' || E'\n\n' || 'Pour notre collaboration, merci de nous transmettre les documents suivants :' || E'\n'
             || (select string_agg('- ' || (x ->> 'justificatif')
                   || case x ->> 'etat' when 'perime' then ' (le précédent n''est plus valable)' when 'a_renouveler' then ' (à renouveler prochainement)' else '' end, E'\n')
                 from jsonb_array_elements(m.liste) x)
             || E'\n\n' || 'Bien cordialement,',
           'liste', m.liste),
         'justificatif:' || m.subcontractor_id || ':' || to_char(current_date, 'YYYY-MM')
  from manques m
  on conflict (company_id, dedup_key) do nothing;
  get diagnostics v_j = row_count;

  return jsonb_build_object('relance_recyclage', v_n, 'justificatif_prestataire', v_j);
end
$$;
revoke all on function public.scheduled_actions_generate() from public, anon;
grant execute on function public.scheduled_actions_generate() to authenticated, service_role;

insert into public.schema_migrations (version) values ('0045_sous_traitance') on conflict (version) do nothing;
