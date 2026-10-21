-- 0408 : notes de réunion et de rendez-vous (demande de H du 21/10), et une correction du point de la semaine (0407).
-- Un écran en deux colonnes : à gauche un guide (questions à poser, sujets à traiter, repris d'une trame réglable par
-- société), à droite la prise de notes à la volée. À la fin, « faire le point » range les notes (résumé, décisions,
-- actions, prochain rendez-vous) et prépare un email récapitulatif à relire et envoyer soi-même. Les actions retenues
-- partent dans les actions de l'équipe (0407) ; le compte rendu est noté sur la fiche du client.
--
--   1. meeting_templates : trames de rendez-vous. Celles sans société sont les trames proposées à toutes les sociétés
--      (découverte formation, maintenance et vérifications, fournisseur, réunion d'équipe, bilan de fin de prestation) ;
--      une société les copie et les adapte.
--   2. meetings : la réunion ou le rendez-vous (type, client ou fournisseur, participants, guide, notes, compte rendu).
--   3. Point de la semaine : la personne choisie à la main sur une ligne est gardée quand on actualise (vu à l'essai).
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0408_reunions_retour.sql

-- ── 1. Trames ──
create table if not exists public.meeting_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  kind text not null check (kind in ('rdv_client', 'rdv_fournisseur', 'reunion_interne', 'autre')),
  code text check (code is null or code ~ '^[a-z0-9_]{2,40}$'),
  name text not null check (length(btrim(name)) between 2 and 120),
  description text check (description is null or length(description) <= 500),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  position integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists meeting_templates_code on public.meeting_templates (coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), code) where code is not null;
comment on table public.meeting_templates is 'Trames de réunion et de rendez-vous : questions à poser et sujets à traiter (sans société : proposées à toutes)';

-- Trames proposées (sans société), en marque blanche : aucun nom d'organisme
insert into public.meeting_templates (company_id, kind, code, name, description, items, position) values
  (null, 'rdv_client', 'decouverte_formation', 'Découverte : besoins de formation',
   'Premier rendez-vous avec une entreprise : obligations, publics, contraintes, suite.',
   '[{"type":"question","texte":"Activité, effectif et sites de l''entreprise"},
     {"type":"question","texte":"Postes concernés et nombre de personnes à former"},
     {"type":"question","texte":"Formations déjà suivies et dates de recyclage connues"},
     {"type":"question","texte":"Obligations à couvrir (secourisme, incendie, habilitation électrique, conduite, gestes et postures…)"},
     {"type":"question","texte":"Attentes particulières, situations de travail à prendre en compte"},
     {"type":"question","texte":"Personnes en situation de handicap ou besoins d''adaptation"},
     {"type":"question","texte":"Dates, horaires et lieu souhaités (sur site ou en salle)"},
     {"type":"question","texte":"Mode de financement envisagé (opérateur de compétences, fonds propres)"},
     {"type":"question","texte":"Qui décide et qui signe la convention"},
     {"type":"sujet","texte":"Prochaine étape convenue (devis, date, documents à envoyer)"}]'::jsonb, 10),
  (null, 'rdv_client', 'maintenance_verifications', 'Maintenance et vérifications',
   'Rendez-vous sur site : matériel, contrat en cours, accès, besoins associés.',
   '[{"type":"question","texte":"Matériel en place (extincteurs, alarme, éclairage de sécurité, désenfumage, RIA…)"},
     {"type":"question","texte":"Date de la dernière vérification et prestataire actuel"},
     {"type":"question","texte":"Contrat en cours : échéance, préavis, satisfaction"},
     {"type":"question","texte":"Nombre de sites, accès, horaires, interlocuteur sur place"},
     {"type":"question","texte":"Registre de sécurité tenu à jour ?"},
     {"type":"question","texte":"Observations ou non-conformités déjà relevées"},
     {"type":"question","texte":"Besoins de formation associés (équipiers d''intervention, évacuation…)"},
     {"type":"sujet","texte":"Prochaine étape convenue (visite, devis, contrat)"}]'::jsonb, 20),
  (null, 'rdv_fournisseur', 'point_fournisseur', 'Point fournisseur',
   'Rendez-vous avec un fournisseur ou un sous-traitant.',
   '[{"type":"question","texte":"Délais de livraison et disponibilité"},
     {"type":"question","texte":"Prix, remises et conditions de paiement"},
     {"type":"question","texte":"Qualité, retours et litiges en cours"},
     {"type":"question","texte":"Nouveautés et évolutions réglementaires"},
     {"type":"sujet","texte":"Commandes à venir et engagements de chacun"}]'::jsonb, 30),
  (null, 'reunion_interne', 'reunion_equipe', 'Réunion d''équipe',
   'Réunion de la semaine : le point de la semaine peut être repris comme ordre du jour.',
   '[{"type":"sujet","texte":"Tour de table : ce qui s''est bien passé"},
     {"type":"sujet","texte":"Urgences et blocages"},
     {"type":"sujet","texte":"Planning de la semaine (sessions, visites, rendez-vous)"},
     {"type":"sujet","texte":"Relances commerciales et devis en attente"},
     {"type":"sujet","texte":"Divers"}]'::jsonb, 40),
  (null, 'rdv_client', 'bilan_prestation', 'Bilan de fin de prestation',
   'Retour du client après une formation ou une intervention, et suites à donner.',
   '[{"type":"question","texte":"Satisfaction générale et points forts"},
     {"type":"question","texte":"Points à améliorer"},
     {"type":"question","texte":"Effets constatés sur le terrain"},
     {"type":"question","texte":"Nouveaux besoins (autres sites, autres publics, autres prestations)"},
     {"type":"question","texte":"Accord pour un témoignage ou un avis"},
     {"type":"sujet","texte":"Prochaine échéance (recyclage, vérification annuelle)"}]'::jsonb, 50)
on conflict do nothing;

-- ── 2. Réunions et rendez-vous ──
create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  kind text not null default 'rdv_client' check (kind in ('rdv_client', 'rdv_fournisseur', 'reunion_interne', 'autre')),
  template_id uuid references public.meeting_templates(id) on delete set null,
  title text not null check (length(btrim(title)) between 2 and 200),
  starts_at timestamptz,
  location text check (location is null or length(location) <= 300),
  client_id uuid references public.clients(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  rdv_id uuid references public.prospect_rdv(id) on delete set null,
  participants jsonb not null default '[]'::jsonb check (jsonb_typeof(participants) = 'array'),
  guide jsonb not null default '[]'::jsonb check (jsonb_typeof(guide) = 'array'),
  notes text check (notes is null or length(notes) <= 50000),
  summary jsonb,
  status text not null default 'preparee' check (status in ('preparee', 'terminee')),
  closed_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists meetings_company_idx on public.meetings (company_id, starts_at desc);
create index if not exists meetings_client_idx on public.meetings (client_id, starts_at desc);
comment on table public.meetings is 'Réunions et rendez-vous : guide, notes prises à la volée, compte rendu, email récapitulatif (relu et envoyé à la main)';

create or replace function app.meetings_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.company_id := old.company_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  if new.status = 'terminee' and (tg_op = 'INSERT' or old.status <> 'terminee') then new.closed_at := now();
  elsif new.status <> 'terminee' then new.closed_at := null; end if;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function app.meetings_maj() from public, anon, authenticated;
drop trigger if exists meetings_maj on public.meetings;
create trigger meetings_maj before insert or update on public.meetings
  for each row execute function app.meetings_maj();

create or replace function app.meeting_templates_maj()
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
revoke all on function app.meeting_templates_maj() from public, anon, authenticated;
drop trigger if exists meeting_templates_maj on public.meeting_templates;
create trigger meeting_templates_maj before insert or update on public.meeting_templates
  for each row execute function app.meeting_templates_maj();

-- Les actions de l'équipe peuvent venir d'une réunion (0407 l'avait prévu) : rien à changer

-- ── 3. Point de la semaine : la personne choisie à la main est gardée à l'actualisation ──
create or replace function app.point_preparer(p_company uuid, p_week date, p_kind text, p_by uuid)
returns public.weekly_briefs
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  w date := date_trunc('week', p_week)::date;
  v_old jsonb;
  v_new jsonb;
  r public.weekly_briefs;
begin
  if p_kind not in ('point', 'bilan') then raise exception 'Type inconnu' using errcode = '22023'; end if;
  select lines into v_old from public.weekly_briefs where company_id = p_company and week_start = w and kind = p_kind;
  v_old := coalesce(v_old, '[]'::jsonb);
  select coalesce(jsonb_agg(a.l || coalesce((
      select jsonb_strip_nulls(jsonb_build_object('retire', o->'retire', 'suite', o->'suite', 'action_id', o->'action_id', 'note', o->'note'))
        || case when coalesce((o->>'owner_choisi')::boolean, false)
                then jsonb_build_object('owner_id', o->'owner_id', 'owner_nom', o->'owner_nom', 'owner_choisi', true) else '{}'::jsonb end
      from jsonb_array_elements(v_old) o where o->>'id' = a.l->>'id' limit 1), '{}'::jsonb) order by a.n), '[]'::jsonb)
    into v_new
  from jsonb_array_elements(app.point_lignes(p_company, w, p_kind)) with ordinality a(l, n);
  v_new := v_new || coalesce((select jsonb_agg(o) from jsonb_array_elements(v_old) o
                              where coalesce((o->>'manuel')::boolean, false)
                                and not exists (select 1 from jsonb_array_elements(v_new) x where x->>'id' = o->>'id')), '[]'::jsonb);
  insert into public.weekly_briefs (company_id, week_start, kind, lines, prepared_at, prepared_by)
  values (p_company, w, p_kind, v_new, now(), p_by)
  on conflict (company_id, week_start, kind) do update set lines = excluded.lines, prepared_at = now(), prepared_by = p_by
  returning * into r;
  return r;
end
$$;
revoke all on function app.point_preparer(uuid, date, text, uuid) from public, anon, authenticated;

-- Règles d'accès (générées par scripts/securite/regles.py, build_suite('0408'))


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
           where schemaname = 'public' and tablename = any (array['meeting_templates', 'meetings'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- meeting_templates
select pg_temp.regles(array['meeting_templates'], null,
  $r$(company_id is null or company_id in (select app.visible_companies()))$r$,
  $r$(company_id in (select app.societes_avec_droit('parametres.organisme.modifier')) or (company_id is null and (select app.a_le_droit('plateforme.administrer'))))$r$,
  $r$(company_id in (select app.societes_avec_droit('parametres.organisme.modifier')) or (company_id is null and (select app.a_le_droit('plateforme.administrer'))))$r$,
  $r$(company_id in (select app.societes_avec_droit('parametres.organisme.modifier')) or (company_id is null and (select app.a_le_droit('plateforme.administrer'))))$r$);

-- meetings
select pg_temp.regles(array['meetings'], null,
  $r$(company_id in (select app.societes_avec_droit('manager.cockpit.voir')) or (client_id is not null and company_id in (select app.societes_avec_droit('clients.fiches.voir'))) or (company_id in (select app.visible_companies()) and created_by = (select auth.uid())))$r$,
  $r$company_id in (select app.visible_companies())$r$,
  $r$(company_id in (select app.societes_avec_droit('manager.cockpit.voir')) or (company_id in (select app.visible_companies()) and created_by = (select auth.uid())))$r$,
  $r$(company_id in (select app.societes_avec_droit('manager.cockpit.voir')) or (company_id in (select app.visible_companies()) and created_by = (select auth.uid())))$r$);


insert into public.schema_migrations (version) values ('0408_reunions') on conflict (version) do nothing;
