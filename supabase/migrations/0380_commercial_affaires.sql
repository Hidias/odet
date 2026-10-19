-- 0380_commercial_affaires.sql : chantier 10, suivi commercial simple (module « affaires »).
--
-- Spec : odet-pac-commercial-inventaire.md, lots 0 à 3 et cadence du lot 4, ramenés à l'essentiel (Hubert, 19/10 :
-- « pas d'usine à gaz »). Une seule notion à suivre : l'affaire. Toute affaire ouverte a une date de prochaine action.
-- 1. commercial_lists : listes réglables par société (segments, sources, motifs de perte, étapes avec probabilité),
--    posées au départ de chaque société.
-- 2. clients : segment, source, responsable, premier contact, opposition par canal (appel, email, courrier) avec sa
--    date, date d'information (RGPD) ; « ne pas solliciter » (do_not_mail) reste la colonne lue partout et suit le
--    canal email dans les deux sens.
-- 3. client_interactions.created_by : auteur (compte) des échanges notés, pour la cadence.
-- 4. opportunities (affaires) : client, étape, montant, probabilité (celle de l'étape par défaut), date de signature
--    visée, prochaine action obligatoire tant que l'affaire est ouverte, motif obligatoire si perdue, devis lié.
--    Un devis lié fait avancer l'affaire : envoyé → « Devis envoyé », accepté ou facturé → gagnée, refusé → perdue.
-- 5. v_pipeline : affaires ouvertes et devis envoyés sans affaire (aucune reprise des devis existants), montant pondéré.
-- 6. v_activity_log : échanges, devis, affaires, et appels, rendez-vous et emails de la prospection, en une seule vue.
-- 7. activity_targets et v_cadence_semaine : objectifs par semaine (appels, emails, rendez-vous, affaires) et réel.
-- 8. v_client_metiers : ce que chaque client achète déjà (formation, maintenance, chiffre d'affaires), calculé.
-- 9. v_clients_a_appeler : clients avec une échéance dans les 90 jours (formations, matériel, contrats, exercices),
--    contact principal, affaire ou devis en cours, dernier échange, opposition à l'appel.
-- 10. Module « affaires » (org_modules) : actif si le module commercial l'est.
-- Les affaires des clients de démonstration partent avec la purge (client_id, suppression en cascade).
-- Tables : company_id, règles par droits (build_suite('0380')) et isolement par société.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0380_commercial_affaires_retour.sql

-- ── 1. Listes réglables ──
create table if not exists public.commercial_lists (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  kind text not null check (kind in ('segment', 'source', 'motif_perte', 'etape')),
  code text not null,
  label text not null,
  position int not null default 0,
  probability int check (probability between 0 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, kind, code)
);
comment on table public.commercial_lists is 'Listes du suivi commercial réglables par société : segments, sources, motifs de perte, étapes des affaires';

-- Étapes « gagnee » et « perdue » : toujours présentes et actives (elles ferment une affaire)
create or replace function app.commercial_lists_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- (suppression de la société elle-même : cascade, permise)
    if old.kind = 'etape' and old.code in ('gagnee', 'perdue') and (select auth.uid()) is not null and pg_trigger_depth() = 1 then
      raise exception 'Les étapes « Gagnée » et « Perdue » ne se suppriment pas' using errcode = '22023';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    new.company_id := old.company_id; new.kind := old.kind; new.code := old.code; new.created_at := old.created_at;
  end if;
  if new.kind = 'etape' and new.code in ('gagnee', 'perdue') then
    new.is_active := true;
    new.probability := case new.code when 'gagnee' then 100 else 0 end;
  end if;
  if new.kind <> 'etape' then new.probability := null; end if;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function app.commercial_lists_maj() from public, anon, authenticated;
drop trigger if exists commercial_lists_maj on public.commercial_lists;
create trigger commercial_lists_maj before insert or update or delete on public.commercial_lists
  for each row execute function app.commercial_lists_maj();

create or replace function app.commercial_lists_depart(p_company uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.commercial_lists (company_id, kind, code, label, position, probability)
  select p_company, d.kind, d.code, d.label, d.position, d.probability
  from (values
    ('etape', 'a_qualifier', 'À qualifier', 10, 10),
    ('etape', 'rdv', 'Rendez-vous', 20, 25),
    ('etape', 'devis_envoye', 'Devis envoyé', 30, 50),
    ('etape', 'negociation', 'Négociation', 40, 75),
    ('etape', 'gagnee', 'Gagnée', 90, 100),
    ('etape', 'perdue', 'Perdue', 99, 0),
    ('segment', 'industrie', 'Industrie', 10, null),
    ('segment', 'btp', 'BTP', 20, null),
    ('segment', 'commerce', 'Commerce et artisanat', 30, null),
    ('segment', 'sante', 'Santé et médico-social', 40, null),
    ('segment', 'public', 'Collectivités et public', 50, null),
    ('segment', 'hotellerie', 'Hôtellerie et restauration', 60, null),
    ('segment', 'tertiaire', 'Bureaux et tertiaire', 70, null),
    ('segment', 'autre', 'Autre', 99, null),
    ('source', 'bouche_a_oreille', 'Bouche-à-oreille', 10, null),
    ('source', 'recommandation', 'Recommandation d''un client', 20, null),
    ('source', 'appel_sortant', 'Appel sortant', 30, null),
    ('source', 'site', 'Site internet', 40, null),
    ('source', 'salon', 'Salon ou événement', 50, null),
    ('source', 'reseau', 'Réseau professionnel', 60, null),
    ('source', 'client', 'Client existant', 70, null),
    ('source', 'autre', 'Autre', 99, null),
    ('motif_perte', 'prix', 'Prix', 10, null),
    ('motif_perte', 'concurrent', 'Concurrent retenu', 20, null),
    ('motif_perte', 'budget', 'Pas de budget', 30, null),
    ('motif_perte', 'besoin', 'Pas de besoin', 40, null),
    ('motif_perte', 'sans_reponse', 'Sans réponse', 50, null),
    ('motif_perte', 'delai', 'Délai', 60, null),
    ('motif_perte', 'autre', 'Autre', 99, null)
  ) as d(kind, code, label, position, probability)
  on conflict (company_id, kind, code) do nothing
$$;
revoke all on function app.commercial_lists_depart(uuid) from public, anon, authenticated;

select app.commercial_lists_depart(c.id) from public.companies c;

-- Départ d'une nouvelle société : référentiels de 0045 (justificatifs, obligations) et listes commerciales
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
  if to_regprocedure('app.commercial_lists_depart(uuid)') is not null then
    execute 'select app.commercial_lists_depart($1)' using new.id;
  end if;
  return null;
end
$$;
revoke all on function app.societe_referentiels_depart() from public, anon, authenticated;

-- ── 2. Fiche client enrichie ──
alter table public.clients add column if not exists segment text;
alter table public.clients add column if not exists source text;
alter table public.clients add column if not exists source_detail text;
alter table public.clients add column if not exists owner_id uuid references public.profiles(id) on delete set null;
alter table public.clients add column if not exists first_contact_on date;
alter table public.clients add column if not exists opposition_canaux text[] not null default '{}';
alter table public.clients add column if not exists opposition_at timestamptz;
alter table public.clients add column if not exists opposition_motif text;
alter table public.clients add column if not exists informed_at date;
comment on column public.clients.opposition_canaux is 'Canaux refusés par le client (appel, email, courrier) ; email suit « ne pas solliciter » (do_not_mail)';
comment on column public.clients.informed_at is 'Date d''information sur le traitement de ses données (prospection)';

create or replace function app.clients_opposition_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_canaux_change boolean;
  v_dnm_change boolean;
begin
  new.opposition_canaux := coalesce((select array_agg(distinct x order by x) from unnest(coalesce(new.opposition_canaux, '{}')) x
                                     where x in ('appel', 'email', 'courrier')), '{}');
  if tg_op = 'INSERT' then
    v_canaux_change := cardinality(new.opposition_canaux) > 0;
    v_dnm_change := coalesce(new.do_not_mail, false);
  else
    v_canaux_change := new.opposition_canaux is distinct from old.opposition_canaux;
    v_dnm_change := new.do_not_mail is distinct from old.do_not_mail;
  end if;
  if v_canaux_change then
    new.do_not_mail := 'email' = any (new.opposition_canaux);
  elsif v_dnm_change then
    if coalesce(new.do_not_mail, false) and not ('email' = any (new.opposition_canaux)) then
      new.opposition_canaux := array_append(new.opposition_canaux, 'email');
    elsif not coalesce(new.do_not_mail, false) then
      new.opposition_canaux := array_remove(new.opposition_canaux, 'email');
    end if;
  end if;
  if cardinality(new.opposition_canaux) = 0 then
    new.opposition_at := null;
  elsif tg_op = 'INSERT' or cardinality(old.opposition_canaux) = 0 or new.opposition_at is null then
    new.opposition_at := coalesce(new.opposition_at, now());
  end if;
  return new;
end
$$;
revoke all on function app.clients_opposition_maj() from public, anon, authenticated;
drop trigger if exists clients_opposition_maj on public.clients;
create trigger clients_opposition_maj before insert or update of opposition_canaux, do_not_mail on public.clients
  for each row execute function app.clients_opposition_maj();

-- Reprise : « ne pas solliciter » déjà coché = opposition par email
update public.clients set opposition_canaux = array['email'] where coalesce(do_not_mail, false) and cardinality(opposition_canaux) = 0;

-- ── 3. Auteur des échanges ──
alter table public.client_interactions add column if not exists created_by uuid default auth.uid();
create index if not exists client_interactions_auteur_idx on public.client_interactions (created_by, interaction_date desc);

-- ── 4. Affaires ──
create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id),
  client_id uuid not null references public.clients(id) on delete cascade,
  contact_id uuid references public.client_contacts(id) on delete set null,
  title text not null,
  metier text check (metier in ('formation', 'maintenance', 'autre')),
  stage text not null default 'a_qualifier',
  amount_ht numeric(12, 2) check (amount_ht is null or amount_ht >= 0),
  probability int check (probability between 0 and 100),
  expected_on date,
  next_action_on date,
  next_action text,
  owner_id uuid references public.profiles(id) on delete set null default auth.uid(),
  source text,
  lost_reason text,
  lost_detail text,
  quote_id uuid references public.quotes(id) on delete set null,
  external_ref text,
  stage_changed_at timestamptz not null default now(),
  closed_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint opportunities_prochaine_action check (stage in ('gagnee', 'perdue') or next_action_on is not null),
  constraint opportunities_motif_perte check (stage <> 'perdue' or nullif(btrim(coalesce(lost_reason, '')), '') is not null)
);
create unique index if not exists opportunities_devis on public.opportunities (quote_id) where quote_id is not null;
create index if not exists opportunities_ouvertes_idx on public.opportunities (company_id, next_action_on) where stage not in ('gagnee', 'perdue');
create index if not exists opportunities_client_idx on public.opportunities (client_id);
comment on table public.opportunities is 'Affaires : une seule notion à suivre ; prochaine action obligatoire tant qu''elle est ouverte';
comment on constraint opportunities_prochaine_action on public.opportunities is 'Une affaire ouverte a toujours une date de prochaine action';

create or replace function app.opportunities_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_prob int;
  v_quote record;
begin
  new.company_id := coalesce((select c.company_id from public.clients c where c.id = new.client_id), new.company_id);
  select l.probability into v_prob from public.commercial_lists l
   where l.company_id = new.company_id and l.kind = 'etape' and l.code = new.stage;
  if not found then
    raise exception 'Étape inconnue : %', new.stage using errcode = '22023';
  end if;
  if new.quote_id is not null then
    select q.client_id, q.total_ht into v_quote from public.quotes q where q.id = new.quote_id;
    if v_quote.client_id is distinct from new.client_id then
      raise exception 'Le devis lié doit être celui du client de l''affaire' using errcode = '22023';
    end if;
    if new.amount_ht is null then new.amount_ht := v_quote.total_ht; end if;
  end if;
  if tg_op = 'INSERT' then
    new.probability := coalesce(new.probability, v_prob);
    new.stage_changed_at := now(); new.created_at := now();
  else
    new.created_at := old.created_at; new.created_by := old.created_by;
    if new.stage is distinct from old.stage then
      new.stage_changed_at := now();
      if new.probability is not distinct from old.probability then new.probability := v_prob; end if;
    end if;
  end if;
  if new.stage in ('gagnee', 'perdue') then
    new.probability := v_prob;
    if tg_op = 'INSERT' or old.stage not in ('gagnee', 'perdue') then new.closed_at := now(); end if;
  else
    new.closed_at := null;
  end if;
  if new.stage <> 'perdue' then new.lost_reason := null; new.lost_detail := null; end if;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function app.opportunities_maj() from public, anon, authenticated;
drop trigger if exists opportunities_maj on public.opportunities;
create trigger opportunities_maj before insert or update on public.opportunities
  for each row execute function app.opportunities_maj();

-- Le devis lié fait avancer l'affaire (le compte qui modifie un devis a aussi le droit de modifier les affaires ;
-- la fonction ne touche que l'affaire liée à ce devis)
create or replace function app.quotes_affaire_suivre()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is not distinct from old.status and new.total_ht is not distinct from old.total_ht then
    return null;
  end if;
  update public.opportunities o
     set stage = case
                   when new.status in ('accepted', 'invoiced') then 'gagnee'
                   when new.status = 'refused' then 'perdue'
                   when new.status = 'sent' and o.stage in ('a_qualifier', 'rdv') then 'devis_envoye'
                   else o.stage
                 end,
         lost_reason = case when new.status = 'refused' then coalesce(nullif(o.lost_reason, ''), nullif(new.lost_reason, ''), 'Devis refusé') else o.lost_reason end,
         amount_ht = case when new.total_ht is distinct from old.total_ht then new.total_ht else o.amount_ht end
   where o.quote_id = new.id
     and o.stage not in ('gagnee', 'perdue');
  return null;
end
$$;
revoke all on function app.quotes_affaire_suivre() from public, anon, authenticated;
drop trigger if exists quotes_affaire_suivre on public.quotes;
create trigger quotes_affaire_suivre after update of status, total_ht on public.quotes
  for each row execute function app.quotes_affaire_suivre();

-- ── 5. Pipeline ──
create or replace view public.v_pipeline
with (security_invoker = true)
as
select o.company_id, 'affaire'::text as origine, o.id, o.client_id, c.name as client_name, o.title, o.stage,
       l.label as stage_label, l.position as stage_position, o.amount_ht, o.probability,
       round(coalesce(o.amount_ht, 0) * coalesce(o.probability, 0) / 100.0, 2) as montant_pondere,
       o.expected_on, o.next_action_on, o.next_action, o.owner_id, o.quote_id, o.metier, o.source, o.created_at
from public.opportunities o
join public.clients c on c.id = o.client_id
left join public.commercial_lists l on l.company_id = o.company_id and l.kind = 'etape' and l.code = o.stage
where o.stage not in ('gagnee', 'perdue')
union all
select q.company_id, 'devis'::text, q.id, q.client_id, c.name, coalesce(nullif(q.object, ''), q.reference), 'devis_envoye',
       l.label, l.position, q.total_ht, l.probability,
       round(coalesce(q.total_ht, 0) * coalesce(l.probability, 0) / 100.0, 2),
       q.validity_date, q.next_followup_date, 'Relancer le devis'::text, null::uuid, q.id, null::text, null::text, q.created_at
from public.quotes q
join public.clients c on c.id = q.client_id
left join public.commercial_lists l on l.company_id = q.company_id and l.kind = 'etape' and l.code = 'devis_envoye'
where q.status = 'sent'
  and not exists (select 1 from public.opportunities o where o.quote_id = q.id);

-- ── 6. Journal d'activité ──
create or replace view public.v_activity_log
with (security_invoker = true)
as
select i.company_id, 'echange'::text as origine, i.id, i.client_id,
       case i.type when 'call' then 'appel' when 'email' then 'email' when 'sms' then 'sms'
                   when 'meeting' then 'rdv' when 'rdv_phoning' then 'rdv' when 'rappel_phoning' then 'appel'
                   when 'devis' then 'devis' when 'facture' then 'facture' when 'relance' then 'relance' else 'note' end as kind,
       i.interaction_date as happened_at, coalesce(nullif(i.title, ''), left(i.content, 120)) as label,
       i.author as author_label, i.created_by
from public.client_interactions i
union all
select q.company_id, 'devis', q.id, q.client_id, 'devis', q.quote_date::timestamptz,
       concat_ws(' · ', q.reference, nullif(q.object, '')), q.created_by, null::uuid
from public.quotes q
where q.client_id is not null
union all
select o.company_id, 'affaire', o.id, o.client_id, 'affaire', o.created_at, o.title, null::text, o.created_by
from public.opportunities o
union all
select pc.company_id, 'appel_prospection', pc.id, pc.client_id, 'appel', pc.called_at,
       concat_ws(' · ', nullif(pc.contact_name, ''), nullif(pc.call_result, '')), pc.called_by, null::uuid
from public.prospect_calls pc
union all
select r.company_id, 'rdv_prospection', r.id, r.client_id, 'rdv', (r.rdv_date + coalesce(r.rdv_time, '09:00'::time))::timestamptz,
       concat_ws(' · ', nullif(r.contact_name, ''), nullif(r.rdv_type, '')), r.conducted_by, null::uuid
from public.prospect_rdv r
where r.rdv_date is not null
union all
select e.company_id, 'email_prospection', e.id, e.client_id, 'email', e.sent_at, e.subject, e.sent_by, null::uuid
from public.prospect_email_logs e
where e.client_id is not null;

-- ── 7. Cadence ──
create table if not exists public.activity_targets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id),
  profile_id uuid references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('appel', 'email', 'rdv', 'affaire')),
  per_week int not null check (per_week between 0 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists activity_targets_unique on public.activity_targets
  (company_id, coalesce(profile_id, '00000000-0000-0000-0000-000000000000'::uuid), kind);
comment on table public.activity_targets is 'Objectifs de cadence par semaine (personne, ou toute l''équipe si profile_id est vide)';

create or replace function app.activity_targets_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then new.company_id := old.company_id; new.created_at := old.created_at; end if;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function app.activity_targets_maj() from public, anon, authenticated;
drop trigger if exists activity_targets_maj on public.activity_targets;
create trigger activity_targets_maj before insert or update on public.activity_targets
  for each row execute function app.activity_targets_maj();

-- Réel de la semaine en cours (lundi au dimanche, heure de Paris), par compte : échanges notés et affaires créées
create or replace view public.v_cadence_semaine
with (security_invoker = true)
as
with semaine as (
  select date_trunc('week', (now() at time zone 'Europe/Paris'))::date as debut
)
select a.company_id, a.created_by as profile_id, a.kind, count(*)::int as realise
from public.v_activity_log a, semaine s
where a.created_by is not null
  and a.kind in ('appel', 'email', 'rdv', 'affaire')
  and (a.happened_at at time zone 'Europe/Paris')::date between s.debut and s.debut + 6
group by a.company_id, a.created_by, a.kind;

-- ── 8. Ce que le client achète déjà (calculé, jamais saisi) ──
create or replace view public.v_client_metiers
with (security_invoker = true)
as
select c.company_id, c.id as client_id,
       (select max(s.end_date) from public.sessions s where s.client_id = c.id and coalesce(s.status, '') not in ('cancelled', 'annulee')) as derniere_formation,
       (select count(*)::int from public.sessions s where s.client_id = c.id and coalesce(s.status, '') not in ('cancelled', 'annulee')
          and s.start_date >= current_date - 730) as formations_24_mois,
       exists (select 1 from public.itv_contracts k where k.client_id = c.id and k.status = 'actif') as contrat_maintenance,
       (select max(v.planned_on) from public.itv_visits v where v.client_id = c.id and v.status = 'terminee') as derniere_visite,
       (select count(*)::int from public.itv_equipment e where e.client_id = c.id and coalesce(e.status, '') <> 'retire') as appareils,
       coalesce((select sum(case when i.type = 'credit_note' then -abs(i.total_net_ht) else i.total_net_ht end)
                 from public.invoices i
                 where coalesce(i.billing_client_id, i.client_id) = c.id and i.issued_at is not null
                   and i.issued_at >= now() - interval '12 months' and coalesce(i.status, '') <> 'cancelled'), 0)::numeric(12, 2) as ca_12_mois
from public.clients c;

-- ── 9. Clients à appeler (échéances dans les 90 jours) ──
create or replace view public.v_clients_a_appeler
with (security_invoker = true)
as
with ech as (
  select d.company_id, d.client_id, min(d.due_on) as premiere_echeance, count(*)::int as nb_echeances,
         array_agg(distinct d.kind order by d.kind) as natures,
         bool_or(d.due_on < current_date) as depassee
  from public.v_obligation_deadlines d
  where d.due_on <= current_date + 90
  group by d.company_id, d.client_id
)
select e.company_id, e.client_id, c.name as client_name, c.city, c.status as client_status, e.premiere_echeance,
       e.nb_echeances, e.natures, e.depassee,
       ('appel' = any (c.opposition_canaux)) as ne_pas_appeler,
       ct.id as contact_id, coalesce(nullif(btrim(concat_ws(' ', ct.first_name, ct.last_name)), ''), ct.name, c.contact_name) as contact_name,
       coalesce(nullif(ct.mobile, ''), nullif(ct.phone, ''), nullif(c.contact_phone, ''), nullif(c.mobile, '')) as contact_phone,
       exists (select 1 from public.opportunities o where o.client_id = e.client_id and o.stage not in ('gagnee', 'perdue')) as affaire_en_cours,
       exists (select 1 from public.quotes q where q.client_id = e.client_id and q.status in ('draft', 'sent')) as devis_en_cours,
       (select max(i.interaction_date) from public.client_interactions i where i.client_id = e.client_id) as dernier_echange,
       c.owner_id
from ech e
join public.clients c on c.id = e.client_id
left join lateral (
  select x.* from public.client_contacts x where x.client_id = e.client_id
  order by x.is_primary desc nulls last, x.created_at limit 1
) ct on true
where coalesce(c.status, '') not in ('archive', 'inactif');

-- ── Droits des tables ──
alter table public.commercial_lists enable row level security;
alter table public.opportunities enable row level security;
alter table public.activity_targets enable row level security;
revoke all on table public.commercial_lists, public.opportunities, public.activity_targets from public, anon;
grant select, insert, update, delete on table public.commercial_lists, public.opportunities, public.activity_targets to authenticated;
grant all on table public.commercial_lists, public.opportunities, public.activity_targets to service_role;
revoke all on public.v_pipeline, public.v_activity_log, public.v_cadence_semaine, public.v_client_metiers, public.v_clients_a_appeler from public, anon;
grant select on public.v_pipeline, public.v_activity_log, public.v_cadence_semaine, public.v_client_metiers, public.v_clients_a_appeler to authenticated;

-- ── Règles (générées par scripts/securite/regles.py, build_suite('0380')) ──

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
           where schemaname = 'public' and tablename = any (array['activity_targets', 'commercial_lists', 'opportunities'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- activity_targets, commercial_lists
select pg_temp.regles(array['activity_targets', 'commercial_lists'], null,
  $r$company_id in (select app.societes_avec_droit('clients.fiches.voir'))$r$,
  $r$company_id in (select app.societes_avec_droit('commercial.devis.modifier'))$r$,
  $r$company_id in (select app.societes_avec_droit('commercial.devis.modifier'))$r$,
  $r$company_id in (select app.societes_avec_droit('commercial.devis.modifier'))$r$);

-- opportunities
select pg_temp.regles(array['opportunities'], null,
  $r$company_id in (select app.societes_avec_droit('commercial.devis.voir'))$r$,
  $r$company_id in (select app.societes_avec_droit('commercial.devis.modifier'))$r$,
  $r$company_id in (select app.societes_avec_droit('commercial.devis.modifier'))$r$,
  $r$company_id in (select app.societes_avec_droit('commercial.devis.modifier'))$r$);

do $$
declare t text;
begin
  foreach t in array array['commercial_lists', 'opportunities', 'activity_targets'] loop
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

-- ── 10. Module ──
insert into public.org_modules (key, label, enabled, position, description)
select 'affaires', 'Suivi des affaires',
       coalesce((select enabled from public.org_modules where key = 'commercial'), false), 127,
       'Affaires avec étape, montant et prochaine action obligatoire ; clients à appeler sur leurs échéances ; cadence de la semaine ; fiche client enrichie (segment, source, responsable, opposition)'
on conflict (key) do nothing;

insert into public.schema_migrations (version) values ('0380_commercial_affaires') on conflict (version) do nothing;
