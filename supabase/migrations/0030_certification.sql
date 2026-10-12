-- 0030_certification.sql : module « NDA et Qualiopi » (parcours de certification).
--
-- 1. Module activable « certification » dans org_modules (Console > Modules pour le couper).
-- 2. cert_settings : une ligne de suivi (dates du NDA, certificateur, cycle d'audit, périmètre d'activité
--    qui rend des indicateurs non applicables). Aucune valeur propre à un organisme : tout est saisi à l'écran.
-- 3. cert_documents : pièces déposées (dossier de déclaration d'activité, certificat, rapports d'audit).
-- 4. cert_referentials, cert_criteria, cert_indicators : référentiel versionné (textes en 0031).
-- 5. cert_indicator_status, cert_proofs : non applicable justifié et preuves ajoutées à la main.
-- 6. cert_audit_findings : non-conformités relevées par le certificateur.
-- 7. cert_deadlines() : échéances calculées (une seule source pour l'écran et les notifications) ;
--    cert_daily_notifications() : notifications 90, 30 et 7 jours avant, une seule fois par seuil.
-- 8. Rôle qualité « référent violences, harcèlement et discriminations » (indicateur 12), non désigné.
-- 9. Bucket privé « certification » (pièces d'identité, casier judiciaire, rapports).
-- 10. Données de démonstration des tables cert_* : effacées avec le reste (déclencheur sur demo_records).
-- Les règles d'accès des tables existantes ne sont pas modifiées.

-- ── 1. Module ──
insert into public.org_modules (key, label, enabled, position, description)
values ('certification', 'NDA et Qualiopi', true, 45, 'Déclaration d''activité, cycle Qualiopi, indicateurs, dossier d''audit')
on conflict (key) do nothing;

-- Rôles autorisés à modifier le suivi de certification
create or replace function public.cert_can_write()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_profile_role() in ('superadmin', 'admin', 'direction', 'gestionnaire'), false)
$$;
revoke all on function public.cert_can_write() from public, anon;
grant execute on function public.cert_can_write() to authenticated;

-- ── 2. Suivi ──
create table if not exists public.cert_settings (
  id smallint primary key default 1 check (id = 1),
  -- Déclaration d'activité
  first_convention_date date,
  first_convention_session_id uuid,             -- session de la première convention (sans clé étrangère : la purge des données de démonstration reste libre)
  nda_status text not null default 'preparation' check (nda_status in ('preparation', 'depose', 'complet', 'enregistre', 'refuse')),
  nda_filed_at date,
  nda_complete_at date,
  nda_registered_at date,
  -- Qualiopi
  certifier_name text,
  certifier_status text not null default 'pressenti' check (certifier_status in ('pressenti', 'devis', 'contrat_signe')),
  certifier_contract_at date,
  initial_audit_at date,
  certified_at date,
  valid_until date,
  surveillance_audit_at date,
  surveillance_done_at date,
  renewal_audit_at date,
  new_entrant boolean not null default true,
  referential_code text not null default 'rnq-2026',
  -- Périmètre d'activité (rend des indicateurs non applicables)
  has_certifying boolean not null default false,
  has_alternance boolean not null default false,
  has_apprentissage boolean not null default false,
  has_fest boolean not null default false,
  has_distance boolean not null default false,
  uses_subcontracting boolean not null default false,
  -- Méthode de calcul publiée (indicateur 2)
  results_published_at date,
  results_published_url text,
  -- Règlement intérieur : mentions de l'article L6352-4 (loi du 25 juin 2026)
  ri_l6352_4_checked_at date,
  notes text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.cert_settings (id) values (1) on conflict (id) do nothing;

-- ── 3. Pièces ──
create table if not exists public.cert_documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                 -- nda_siren, nda_casier, nda_identite, nda_convention, nda_programme, nda_intervenants, certificat, rapport_audit, autre
  label text,
  file_path text,
  file_name text,
  issued_on date,
  valid_until date,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid
);
create index if not exists cert_documents_kind_idx on public.cert_documents(kind);

-- ── 4. Référentiel ──
create table if not exists public.cert_referentials (
  code text primary key,
  label text not null,
  legal_ref text,
  effective_from date,
  source_url text,
  notes text,
  sort_order int not null default 0
);

create table if not exists public.cert_criteria (
  referential_code text not null references public.cert_referentials(code),
  number int not null,
  title text not null,
  primary key (referential_code, number)
);

create table if not exists public.cert_indicators (
  referential_code text not null references public.cert_referentials(code),
  number int not null,
  criterion int not null,
  short_title text not null,
  text text not null,
  scope text[] not null default '{}',          -- F formation, B bilan, V VAE, A apprentissage
  applies_when text not null default 'tous'    -- tous, certifiant, alternance, apprentissage, fest, sous_traitance
    check (applies_when in ('tous', 'certifiant', 'alternance', 'apprentissage', 'fest', 'sous_traitance')),
  change_kind text check (change_kind in ('nouveau', 'modifie', 'inchange')),
  change_note text,
  major_only boolean not null default false,   -- ne peut donner lieu qu'à une non-conformité majeure
  new_entrant_light boolean not null default false, -- nouvel entrant : formalisation suffit à l'audit initial
  primary key (referential_code, number),
  foreign key (referential_code, criterion) references public.cert_criteria(referential_code, number)
);

-- ── 5. Statut par indicateur et preuves ajoutées ──
create table if not exists public.cert_indicator_status (
  referential_code text not null,
  number int not null,
  not_applicable boolean,                      -- null : règle automatique ; true / false : choix de l'organisme
  na_justification text,
  notes text,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (referential_code, number),
  foreign key (referential_code, number) references public.cert_indicators(referential_code, number)
);

create table if not exists public.cert_proofs (
  id uuid primary key default gen_random_uuid(),
  indicator_number int not null,
  label text not null,
  note text,
  url text,
  file_path text,
  file_name text,
  created_at timestamptz not null default now(),
  created_by uuid
);
create index if not exists cert_proofs_indicator_idx on public.cert_proofs(indicator_number);

-- ── 6. Non-conformités d'audit ──
create table if not exists public.cert_audit_findings (
  id uuid primary key default gen_random_uuid(),
  audit_kind text not null default 'initial' check (audit_kind in ('initial', 'surveillance', 'renouvellement', 'complementaire')),
  audit_date date,
  indicator_number int,
  severity text not null default 'mineure' check (severity in ('mineure', 'majeure')),
  description text not null,
  action_plan text,
  due_date date,
  closed_at date,
  created_at timestamptz not null default now(),
  created_by uuid
);

-- Échéance d'une non-conformité : 3 mois (majeure) ou 6 mois (mineure) après l'audit, sauf date saisie
create or replace function public.cert_findings_due()
returns trigger language plpgsql as $$
begin
  if new.due_date is null and new.audit_date is not null then
    new.due_date := (new.audit_date + case when new.severity = 'majeure' then interval '3 months' else interval '6 months' end)::date;
  end if;
  return new;
end $$;
drop trigger if exists cert_findings_due on public.cert_audit_findings;
create trigger cert_findings_due before insert or update of audit_date, severity on public.cert_audit_findings
  for each row execute function public.cert_findings_due();

-- ── Règles d'accès des nouvelles tables : lecture pour les comptes connectés, écriture pour la direction et la gestion ──
do $$
declare t text;
begin
  foreach t in array array['cert_settings', 'cert_documents', 'cert_referentials', 'cert_criteria', 'cert_indicators', 'cert_indicator_status', 'cert_proofs', 'cert_audit_findings'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_select') then
      execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_select', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_write') then
      execute format('create policy %I on public.%I for all to authenticated using (public.cert_can_write()) with check (public.cert_can_write())', t || '_write', t);
    end if;
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- ── 7. Échéances ──
create or replace function public.cert_deadlines()
returns table (key text, label text, detail text, due_date date, link text, level text)
language plpgsql stable security definer set search_path = public as $$
declare
  s public.cert_settings;
  o record;
  v_today date := (now() at time zone 'Europe/Paris')::date;
  v_year int;
  v_bpf_done boolean;
begin
  select * into s from public.cert_settings where id = 1;
  select nda, reglement_interieur into o from public.organization_settings limit 1;
  if s.id is null then return; end if;

  -- Déclaration d'activité : dépôt au plus tard 3 mois après la première convention (R6351-1)
  if s.nda_status = 'preparation' and coalesce(nullif(trim(o.nda), ''), '') = '' then
    if s.first_convention_date is not null then
      return query select 'nda_depot'::text, 'Déposer la déclaration d''activité'::text,
        'Sur Mon Activité Formation, 3 mois au plus après la première convention'::text,
        (s.first_convention_date + interval '3 months')::date, '/certification/nda'::text, 'action'::text;
    else
      return query select 'nda_convention'::text, 'Saisir la date de la première convention'::text,
        'Elle fixe le délai de dépôt de la déclaration d''activité (3 mois)'::text,
        null::date, '/certification/nda'::text, 'info'::text;
    end if;
  end if;
  -- Réponse de l'administration : 2 mois après un dossier complet, le silence vaut enregistrement (R6351-6)
  if s.nda_status in ('depose', 'complet') and coalesce(s.nda_complete_at, s.nda_filed_at) is not null then
    return query select 'nda_reponse'::text, 'Réponse à la déclaration d''activité'::text,
      'Sans réponse à cette date, la déclaration est enregistrée'::text,
      (coalesce(s.nda_complete_at, s.nda_filed_at) + interval '2 months')::date, '/certification/nda'::text, 'info'::text;
  end if;

  -- Audit initial planifié
  if s.certified_at is null and s.initial_audit_at is not null and s.initial_audit_at >= v_today then
    return query select 'audit_initial'::text, 'Audit initial Qualiopi'::text,
      coalesce('Certificateur : ' || nullif(s.certifier_name, ''), 'Certificateur à choisir')::text,
      s.initial_audit_at, '/certification/qualiopi'::text, 'action'::text;
  end if;

  if s.certified_at is not null then
    -- Surveillance : entre le 14e et le 22e mois après l'obtention (arrêté du 6 juin 2019)
    if s.surveillance_done_at is null then
      if v_today < (s.certified_at + interval '14 months')::date then
        return query select 'surveillance_ouverture'::text, 'Ouverture de la fenêtre de surveillance'::text,
          'Audit à distance entre le 14e et le 22e mois après l''obtention'::text,
          (s.certified_at + interval '14 months')::date, '/certification/qualiopi'::text, 'info'::text;
      end if;
      return query select 'surveillance_limite'::text, 'Audit de surveillance, date limite'::text,
        coalesce('Prévu le ' || to_char(s.surveillance_audit_at, 'DD/MM/YYYY'), 'À planifier avec le certificateur')::text,
        (s.certified_at + interval '22 months')::date, '/certification/qualiopi'::text, 'action'::text;
    end if;
    -- Renouvellement : durant la 3e année ; alerte 4 mois avant l'échéance (temps de lever une majeure)
    return query select 'renouvellement'::text, 'Audit de renouvellement'::text,
      ('Certificat valable jusqu''au ' || to_char(coalesce(s.valid_until, (s.certified_at + interval '3 years' - interval '1 day')::date), 'DD/MM/YYYY'))::text,
      (coalesce(s.valid_until, (s.certified_at + interval '3 years' - interval '1 day')::date) - interval '4 months')::date,
      '/certification/qualiopi'::text, 'action'::text;
  end if;

  -- Non-conformités d'audit ouvertes
  return query select 'nc_' || f.id::text, ('Non-conformité ' || f.severity || coalesce(', indicateur ' || f.indicator_number, ''))::text,
    left(f.description, 120)::text, f.due_date, '/certification/qualiopi'::text, 'action'::text
    from public.cert_audit_findings f where f.closed_at is null;

  -- BPF : avant le 30 avril (R6352-23) pour l'exercice précédent, dès qu'une activité a commencé
  if s.first_convention_date is not null or coalesce(nullif(trim(o.nda), ''), '') <> '' then
    v_year := extract(year from v_today)::int - 1;
    if v_today > make_date(v_year + 1, 5, 31) then v_year := v_year + 1; end if;
    if s.first_convention_date is null or extract(year from s.first_convention_date)::int <= v_year then
      select bool_or(submitted_at is not null) into v_bpf_done from public.bpf_declarations where year = v_year;
      if not coalesce(v_bpf_done, false) then
        return query select ('bpf_' || v_year)::text, ('BPF ' || v_year)::text,
          'Sur Mon Activité Formation. Date légale : 30 avril. Report au 31 mai accordé les années précédentes'::text,
          make_date(v_year + 1, 4, 30), '/bpf'::text, 'action'::text;
      end if;
    end if;
  end if;

  -- Règlement intérieur : mentions de l'article L6352-4 (en vigueur depuis le 27 juin 2026)
  if s.ri_l6352_4_checked_at is null then
    return query select 'ri_l6352_4'::text, 'Règlement intérieur à compléter'::text,
      'Égalité de traitement, liberté d''expression et de conscience, neutralité (article L6352-4)'::text,
      null::date, '/certification'::text, 'action'::text;
  end if;
end $$;
revoke all on function public.cert_deadlines() from public, anon;
grant execute on function public.cert_deadlines() to authenticated;

-- Notifications du tableau de bord : 90, 30 et 7 jours avant chaque échéance datée, une fois par seuil
create or replace function public.cert_daily_notifications()
returns int
language plpgsql security definer set search_path = public as $$
declare
  d record;
  v_today date := (now() at time zone 'Europe/Paris')::date;
  v_left int;
  v_step int;
  v_n int := 0;
begin
  if not exists (select 1 from public.org_modules where key = 'certification' and enabled) then return 0; end if;
  for d in select * from public.cert_deadlines() where due_date is not null loop
    v_left := d.due_date - v_today;
    v_step := case when v_left <= 7 then 7 when v_left <= 30 then 30 when v_left <= 90 then 90 else null end;
    continue when v_step is null;
    if not exists (select 1 from public.notifications where type = 'certification'
                    and metadata->>'key' = d.key and metadata->>'due' = d.due_date::text and (metadata->>'step')::int <= v_step) then
      insert into public.notifications (type, title, message, link, metadata)
      values ('certification', d.label,
              case when v_left < 0 then 'Échéance dépassée depuis le ' || to_char(d.due_date, 'DD/MM/YYYY')
                   else 'Échéance le ' || to_char(d.due_date, 'DD/MM/YYYY') || ' (dans ' || v_left || ' jour' || case when v_left > 1 then 's' else '' end || ')' end,
              d.link, jsonb_build_object('key', d.key, 'due', d.due_date::text, 'step', v_step));
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.cert_daily_notifications() from public, anon;
grant execute on function public.cert_daily_notifications() to authenticated;

-- ── 8. Rôle qualité pour l'indicateur 12 (non désigné par défaut) ──
insert into public.quality_roles (code, label, sort_order)
values ('referent_signalements', 'Référent violences, harcèlement et discriminations', 35)
on conflict (code) do nothing;

-- ── 9. Pièces du dossier : bucket privé ──
insert into storage.buckets (id, name, public) values ('certification', 'certification', false) on conflict (id) do nothing;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'certification_read') then
    create policy certification_read on storage.objects for select to authenticated
      using (bucket_id = 'certification' and public.cert_can_write());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'certification_insert') then
    create policy certification_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'certification' and public.cert_can_write());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'certification_delete') then
    create policy certification_delete on storage.objects for delete to authenticated
      using (bucket_id = 'certification' and public.cert_can_write());
  end if;
end $$;

-- ── 10. Démonstration : une ligne cert_* inscrite dans demo_records disparaît avec elle ──
create or replace function public.cert_demo_record_deleted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.tbl in ('cert_proofs', 'cert_audit_findings', 'cert_documents') then
    execute format('delete from public.%I where id = $1', old.tbl) using old.id;
  end if;
  return old;
end $$;
drop trigger if exists cert_demo_record_deleted on public.demo_records;
create trigger cert_demo_record_deleted after delete on public.demo_records
  for each row execute function public.cert_demo_record_deleted();

insert into public.schema_migrations (version) values ('0030_certification') on conflict (version) do nothing;
