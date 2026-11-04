-- 0482 : évaluations à froid, envoi et relance préparés la nuit, validés en un clic (option C, décision de H du 04/11).
-- Conception validée par H le 04/11 (10 points) ; délai par défaut du premier envoi : 60 jours après la fin.
-- 1. froid_reglages (par société) : premier envoi, relance 30 jours après l'envoi, 60 jours entre deux relances,
--    une relance, sessions de plus d'un an exclues (inclusion à la main par session : sessions.froid_inclure),
--    évaluation de l'employeur. courses : délai propre à la formation et questions réglables.
-- 2. Questions : base des 4 questions de Campus (compétences pratiquées, objectifs atteints, besoins satisfaits,
--    amélioration du travail) et « recommanderiez-vous » ; questions ajoutées par formation dans evaluations_cold.reponses.
-- 3. froid_envois : préparation et trace de chaque envoi et relance (stagiaire, contact de l'entreprise pour un
--    stagiaire sans adresse, employeur). Un rang par personne : 0 premier envoi, 1.. relances. Jamais de boucle :
--    une relance n'est préparée qu'après l'envoi réel du rang précédent, et jamais au-delà du nombre réglé.
-- 4. public.froid_preparer() (nuit) et froid_preparer_maintenant() (écran) : rien ne part, tout attend la validation.
-- 5. Envoi : froid_envois_reserver (droit d'envoyer de la société, interrupteur « Questionnaires à froid », une adresse
--    par jour) puis froid_envoi_terminer, appelées par /api/evaluations-froid avec le jeton de la personne connectée.
-- 6. Portail stagiaire : portail_froid / portail_froid_repondre (lien de la session et code personnel), réponse figée.
-- 7. Employeur : froid_employeur, questionnaire de l'espace entreprise (ent_froid, ent_froid_repondre), réponse figée.
-- 8. Le rappel interne du pilote (0160, eval_froid) est coupé : la préparation de nuit le remplace.
-- Additive. Idempotente. Retour arrière : supabase/rollback/0482_relance_froid_retour.sql

-- ── 1. Réglages ──
create table if not exists public.froid_reglages (
  company_id uuid primary key references public.companies(id) on delete cascade,
  actif boolean not null default true,
  premier_envoi_jours int not null default 60 check (premier_envoi_jours between 7 and 365),
  relance_apres_jours int not null default 30 check (relance_apres_jours between 7 and 365),
  entre_relances_jours int not null default 60 check (entre_relances_jours between 7 and 365),
  relances_max int not null default 1 check (relances_max between 0 and 3),
  anciennete_max_jours int not null default 365 check (anciennete_max_jours between 30 and 1095),
  employeur_actif boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
comment on table public.froid_reglages is 'Évaluations à froid par société (0482) : délais d''envoi et de relance ; sans ligne, valeurs par défaut';
alter table public.froid_reglages enable row level security;
revoke all on public.froid_reglages from anon, authenticated;
grant select on public.froid_reglages to authenticated;
drop policy if exists froid_reglages_lire on public.froid_reglages;
create policy froid_reglages_lire on public.froid_reglages for select to authenticated
  using (company_id in (select app.societes_lisibles()));

alter table public.courses add column if not exists froid_delai_jours int check (froid_delai_jours is null or froid_delai_jours between 7 and 365);
alter table public.courses add column if not exists froid_questions jsonb;
alter table public.courses add column if not exists froid_questions_employeur jsonb;
comment on column public.courses.froid_delai_jours is 'Délai du premier envoi de l''évaluation à froid pour cette formation (vide : réglage de la société) (0482)';
comment on column public.courses.froid_questions is 'Questions de l''évaluation à froid du stagiaire (vide : questions de base) (0482)';
comment on column public.courses.froid_questions_employeur is 'Questions de l''évaluation à froid de l''employeur (vide : questions de base) (0482)';
alter table public.sessions add column if not exists froid_inclure boolean not null default false;
comment on column public.sessions.froid_inclure is 'Session de plus d''un an incluse à la main dans les évaluations à froid (0482)';
alter table public.evaluations_cold add column if not exists reponses jsonb;
comment on column public.evaluations_cold.reponses is 'Réponses aux questions ajoutées par la formation (0482)';

create or replace function app.froid_reglage(p_company uuid)
returns public.froid_reglages
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select r from public.froid_reglages r where r.company_id = p_company),
                  row(p_company, true, 60, 30, 60, 1, 365, true, now(), null)::public.froid_reglages)
$$;
revoke all on function app.froid_reglage(uuid) from public, anon, authenticated;

-- ── 2. Questions ──
create or replace function app.froid_questions_defaut(p_cible text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when p_cible = 'employeur' then jsonb_build_array(
      jsonb_build_object('cle', 'e_pratique', 'libelle', 'Votre salarié met-il en pratique ce qu''il a appris pendant la formation ?', 'type', 'oui_non'),
      jsonb_build_object('cle', 'e_besoins', 'libelle', 'La formation a-t-elle répondu aux besoins de votre entreprise ?', 'type', 'oui_non'),
      jsonb_build_object('cle', 'e_recommande', 'libelle', 'Recommanderiez-vous cette formation ?', 'type', 'oui_non'),
      jsonb_build_object('cle', 'e_commentaire', 'libelle', 'Une remarque ou un besoin de formation à nous signaler ?', 'type', 'texte'))
  else jsonb_build_array(
      jsonb_build_object('cle', 'skills_applied', 'libelle', 'Avez-vous pu mettre en pratique ce que vous avez appris ?', 'type', 'oui_non'),
      jsonb_build_object('cle', 'objectives_met', 'libelle', 'Estimez-vous avoir atteint les objectifs de la formation ?', 'type', 'oui_non'),
      jsonb_build_object('cle', 'knowledge_retained', 'libelle', 'La formation a-t-elle répondu à vos besoins ?', 'type', 'oui_non'),
      jsonb_build_object('cle', 'job_impact', 'libelle', 'La formation a-t-elle amélioré votre façon de travailler ?', 'type', 'oui_non'),
      jsonb_build_object('cle', 'would_recommend', 'libelle', 'Recommanderiez-vous cette formation ?', 'type', 'oui_non'),
      jsonb_build_object('cle', 'comments', 'libelle', 'Un commentaire ?', 'type', 'texte'))
  end
$$;
revoke all on function app.froid_questions_defaut(text) from public, anon, authenticated;

-- Questions d'une session : celles de la formation si elles sont valides, sinon la base
create or replace function app.froid_questions(p_session uuid, p_cible text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select case when jsonb_typeof(q) = 'array' and jsonb_array_length(q) between 1 and 20 then q end
       from (select case when p_cible = 'employeur' then co.froid_questions_employeur else co.froid_questions end as q
               from public.sessions s join public.courses co on co.id = s.course_id where s.id = p_session) x),
    app.froid_questions_defaut(p_cible))
$$;
revoke all on function app.froid_questions(uuid, text) from public, anon, authenticated;

-- Contrôle des réponses : chaque clé est une question de la liste, type respecté, textes bornés
create or replace function app.froid_reponses_valides(p_questions jsonb, p_reponses jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare k text; v jsonb; t text;
begin
  if p_reponses is null or jsonb_typeof(p_reponses) <> 'object' then return false; end if;
  for k, v in select * from jsonb_each(p_reponses) loop
    select q ->> 'type' into t from jsonb_array_elements(p_questions) q where q ->> 'cle' = k;
    if t is null then return false; end if;
    if jsonb_typeof(v) = 'null' then continue; end if;
    if t = 'oui_non' and jsonb_typeof(v) <> 'boolean' then return false; end if;
    if t = 'note' and not (jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric in (1, 2, 3, 4, 5)) then return false; end if;
    if t = 'texte' and (jsonb_typeof(v) <> 'string' or length(v #>> '{}') > 2000) then return false; end if;
  end loop;
  -- Toutes les questions fermées sont répondues
  return not exists (select 1 from jsonb_array_elements(p_questions) q
                      where q ->> 'type' in ('oui_non', 'note') and coalesce(jsonb_typeof(p_reponses -> (q ->> 'cle')), 'null') = 'null');
end
$$;
revoke all on function app.froid_reponses_valides(jsonb, jsonb) from public, anon, authenticated;

-- ── 3. Envois et relances ──
create table if not exists public.froid_envois (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  session_id uuid not null references public.sessions(id) on delete cascade,
  trainee_id uuid references public.trainees(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  cible text not null check (cible in ('stagiaire', 'contact', 'employeur')),
  rang int not null check (rang between 0 and 3),
  du_le date not null,
  statut text not null default 'prepare' check (statut in ('prepare', 'en_cours', 'envoye', 'ignore', 'erreur')),
  destinataire text,
  destinataire_nom text,
  motif text,
  prepare_le timestamptz not null default now(),
  envoye_le timestamptz,
  reserve_le timestamptz,
  envoye_par uuid,
  boite text,
  message_id text,
  check ((cible = 'employeur') = (trainee_id is null))
);
create unique index if not exists froid_envois_unique on public.froid_envois (session_id, (coalesce(trainee_id, client_id)), (cible = 'employeur'), rang);
create index if not exists froid_envois_company_idx on public.froid_envois (company_id, statut);
create index if not exists froid_envois_dest_idx on public.froid_envois (lower(destinataire), envoye_le);
comment on table public.froid_envois is 'Évaluations à froid (0482) : envois et relances préparés la nuit, validés à l''écran, trace de chaque envoi';
alter table public.froid_envois enable row level security;
revoke all on public.froid_envois from anon, authenticated;
grant select on public.froid_envois to authenticated;
drop policy if exists froid_envois_lire on public.froid_envois;
create policy froid_envois_lire on public.froid_envois for select to authenticated
  using (company_id in (select app.societes_avec_droit('formation.suivi.voir'))
         or (company_id in (select app.societes_avec_droit('formation.sessions.voir_siennes')) and session_id in (select app.trainer_session_ids())));

-- Employeur : une réponse par session et par entreprise
create table if not exists public.froid_employeur (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  session_id uuid not null references public.sessions(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  reponses jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  repondu_par uuid,
  saisi_par uuid,
  created_at timestamptz not null default now(),
  unique (session_id, client_id)
);
comment on table public.froid_employeur is 'Évaluation à froid de l''employeur (0482) : réponse figée dès sa réception';
alter table public.froid_employeur enable row level security;
revoke all on public.froid_employeur from anon, authenticated;
grant select on public.froid_employeur to authenticated;
drop policy if exists froid_employeur_lire on public.froid_employeur;
create policy froid_employeur_lire on public.froid_employeur for select to authenticated
  using (company_id in (select app.societes_avec_droit('formation.suivi.voir')));

create or replace function app.froid_employeur_figee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.completed_at is null
     or coalesce(current_setting('app.eval_correction', true), '') = 'on'
     or coalesce(current_setting('app.demo_purge', true), '') = 'on'
     or (tg_op = 'DELETE' and pg_trigger_depth() > 1) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'Réponse reçue : elle ne se modifie plus (correction par le super administrateur, avec un motif)' using errcode = '42501';
end
$$;
revoke all on function app.froid_employeur_figee() from public, anon, authenticated;
drop trigger if exists froid_employeur_figee on public.froid_employeur;
create trigger froid_employeur_figee before update or delete on public.froid_employeur for each row execute function app.froid_employeur_figee();

create or replace function app.froid_email_valide(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(btrim(p) ~* '^[^@\s<>,;]+@[^@\s<>,;]+\.[a-z]{2,}$', false)
$$;
revoke all on function app.froid_email_valide(text) from public, anon, authenticated;

-- Contact de suivi d'une entreprise : contact « suivi », sinon principal, sinon adresse de la fiche
create or replace function app.froid_contact(p_client uuid)
returns table (email text, nom text)
language sql
stable
security definer
set search_path = ''
as $$
  select x.email, x.nom from (
    select btrim(cc.email) as email, coalesce(nullif(btrim(concat_ws(' ', cc.first_name, cc.last_name)), ''), cc.name) as nom,
           case when coalesce(cc.is_followup, false) then 0 when coalesce(cc.is_primary, false) then 1 else 2 end as o, cc.created_at
      from public.client_contacts cc where cc.client_id = p_client and app.froid_email_valide(cc.email)
    union all
    select btrim(c.contact_email), c.contact_name, 3, null from public.clients c where c.id = p_client and app.froid_email_valide(c.contact_email)
  ) x order by x.o, x.created_at nulls last limit 1
$$;
revoke all on function app.froid_contact(uuid) from public, anon, authenticated;

-- ── 4. Préparation (règles et exclusions) ──
-- Sessions retenues : au statut « terminée » (une session verrouillée dans un autre statut n'est pas prise), pas une sous-traitance pour le compte d'un autre organisme, délai du
-- premier envoi échu, de moins d'un an (réglable) sauf inclusion à la main, réglage de la société actif.
create or replace function app.froid_preparer_corps(p_companies uuid[], p_today date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_n0 int := 0; v_nr int := 0; v_ign int := 0; v_k int; s record; t record; c record; r public.froid_reglages; v_dest record; v_sans uuid;
begin
  for s in
    select se.id, se.company_id, se.client_id, coalesce(se.end_date, se.start_date) as fin, se.froid_inclure, co.froid_delai_jours
      from public.sessions se left join public.courses co on co.id = se.course_id
     where se.company_id = any (p_companies)
       and se.status = 'completed'
       and coalesce(se.session_type, 'intra') <> 'subcontract'
       and not exists (select 1 from public.clients oc where oc.id = se.client_id and oc.client_type = 'organisme_formation')
       and coalesce(se.end_date, se.start_date) is not null
       and coalesce(se.end_date, se.start_date) < p_today
  loop
    r := app.froid_reglage(s.company_id);
    continue when not r.actif;
    continue when s.fin + coalesce(s.froid_delai_jours, r.premier_envoi_jours) > p_today;
    continue when s.fin < p_today - r.anciennete_max_jours and not s.froid_inclure;

    -- Stagiaires présents, sans réponse
    for t in
      select st.trainee_id, tr.first_name, tr.last_name, tr.email, coalesce(tr.email_refused, false) as refus, tr.client_id,
             ec.sent_at, ec.completed_at
        from public.session_trainees st join public.trainees tr on tr.id = st.trainee_id
        left join public.evaluations_cold ec on ec.session_id = s.id and ec.trainee_id = st.trainee_id
       where st.session_id = s.id and not coalesce(st.absent, false)
    loop
      if t.completed_at is not null then
        update public.froid_envois set statut = 'ignore', motif = 'Réponse reçue'
         where session_id = s.id and trainee_id = t.trainee_id and statut = 'prepare';
        continue;
      end if;
      -- Envoi noté à la main avant ce circuit : repris comme premier envoi
      if t.sent_at is not null and not exists (select 1 from public.froid_envois e where e.session_id = s.id and e.trainee_id = t.trainee_id) then
        insert into public.froid_envois (company_id, session_id, trainee_id, client_id, cible, rang, du_le, statut, destinataire, destinataire_nom, motif, envoye_le)
        values (s.company_id, s.id, t.trainee_id, t.client_id, 'stagiaire', 0, t.sent_at::date, 'envoye', nullif(btrim(t.email), ''),
                concat_ws(' ', t.first_name, t.last_name), 'Envoi noté à la main', t.sent_at)
        on conflict do nothing;
      end if;
      -- Ligne mise de côté faute d'adresse : reprise dès qu'une adresse existe (stagiaire ou contact de l'entreprise)
      select e.id into v_sans from public.froid_envois e
       where e.session_id = s.id and e.trainee_id = t.trainee_id and e.statut = 'ignore' and e.motif = 'Aucune adresse valide, ni pour le stagiaire ni pour son entreprise'
       order by e.rang desc limit 1;
      if v_sans is not null then
        if not t.refus and app.froid_email_valide(t.email) then
          update public.froid_envois set statut = 'prepare', cible = 'stagiaire', destinataire = btrim(t.email),
                 destinataire_nom = concat_ws(' ', t.first_name, t.last_name), motif = null, du_le = p_today, prepare_le = now()
           where id = v_sans;
          v_n0 := v_n0 + 1;
        else
          select * into v_dest from app.froid_contact(coalesce(t.client_id, s.client_id));
          if v_dest.email is not null then
            update public.froid_envois set statut = 'prepare', cible = 'contact', destinataire = v_dest.email, destinataire_nom = v_dest.nom,
                   motif = 'Stagiaire sans adresse valide : demande au contact de l''entreprise', du_le = p_today, prepare_le = now()
             where id = v_sans;
            v_n0 := v_n0 + 1;
          end if;
        end if;
        continue;
      end if;
      -- Rang suivant à préparer
      select coalesce(max(e.rang) + 1, 0) into v_k from public.froid_envois e where e.session_id = s.id and e.trainee_id = t.trainee_id;
      continue when v_k > r.relances_max;
      if v_k > 0 then
        -- une relance seulement après l'envoi réel du rang précédent, au délai réglé
        continue when not exists (select 1 from public.froid_envois e
           where e.session_id = s.id and e.trainee_id = t.trainee_id and e.rang = v_k - 1 and e.statut = 'envoye'
             and (e.envoye_le at time zone 'Europe/Paris')::date
                 + case when v_k = 1 then r.relance_apres_jours else r.entre_relances_jours end <= p_today);
      end if;
      if not t.refus and app.froid_email_valide(t.email) then
        insert into public.froid_envois (company_id, session_id, trainee_id, client_id, cible, rang, du_le, destinataire, destinataire_nom)
        values (s.company_id, s.id, t.trainee_id, t.client_id, 'stagiaire', v_k, p_today, btrim(t.email), concat_ws(' ', t.first_name, t.last_name))
        on conflict do nothing;
      else
        select * into v_dest from app.froid_contact(coalesce(t.client_id, s.client_id));
        if v_dest.email is not null then
          insert into public.froid_envois (company_id, session_id, trainee_id, client_id, cible, rang, du_le, destinataire, destinataire_nom, motif)
          values (s.company_id, s.id, t.trainee_id, coalesce(t.client_id, s.client_id), 'contact', v_k, p_today, v_dest.email, v_dest.nom,
                  'Stagiaire sans adresse valide : demande au contact de l''entreprise')
          on conflict do nothing;
        else
          insert into public.froid_envois (company_id, session_id, trainee_id, client_id, cible, rang, du_le, statut, destinataire_nom, motif)
          values (s.company_id, s.id, t.trainee_id, coalesce(t.client_id, s.client_id), 'stagiaire', v_k, p_today, 'ignore',
                  concat_ws(' ', t.first_name, t.last_name), 'Aucune adresse valide, ni pour le stagiaire ni pour son entreprise')
          on conflict do nothing;
          get diagnostics v_k = row_count;
          v_ign := v_ign + v_k;
          continue;
        end if;
      end if;
      get diagnostics v_k = row_count;
      if v_k > 0 then
        if (select max(rang) from public.froid_envois e where e.session_id = s.id and e.trainee_id = t.trainee_id) = 0 then v_n0 := v_n0 + 1; else v_nr := v_nr + 1; end if;
      end if;
    end loop;

    -- Employeurs : une demande par entreprise de la session
    continue when not r.employeur_actif;
    for c in
      select distinct x.client_id from (
        select s.client_id union all
        select tr.client_id from public.session_trainees st join public.trainees tr on tr.id = st.trainee_id
         where st.session_id = s.id and not coalesce(st.absent, false)) x
      join public.clients cl on cl.id = x.client_id
      where x.client_id is not null and coalesce(cl.client_type, 'entreprise') <> 'particulier'
    loop
      if exists (select 1 from public.froid_employeur fe where fe.session_id = s.id and fe.client_id = c.client_id and fe.completed_at is not null) then
        update public.froid_envois set statut = 'ignore', motif = 'Réponse reçue'
         where session_id = s.id and client_id = c.client_id and cible = 'employeur' and statut = 'prepare';
        continue;
      end if;
      select coalesce(max(e.rang) + 1, 0) into v_k from public.froid_envois e where e.session_id = s.id and e.client_id = c.client_id and e.cible = 'employeur';
      continue when v_k > r.relances_max;
      if v_k > 0 then
        continue when not exists (select 1 from public.froid_envois e
           where e.session_id = s.id and e.client_id = c.client_id and e.cible = 'employeur' and e.rang = v_k - 1 and e.statut = 'envoye'
             and (e.envoye_le at time zone 'Europe/Paris')::date
                 + case when v_k = 1 then r.relance_apres_jours else r.entre_relances_jours end <= p_today);
      end if;
      select * into v_dest from app.froid_contact(c.client_id);
      continue when v_dest.email is null;
      insert into public.froid_envois (company_id, session_id, client_id, cible, rang, du_le, destinataire, destinataire_nom)
      values (s.company_id, s.id, c.client_id, 'employeur', v_k, p_today, v_dest.email, v_dest.nom)
      on conflict do nothing;
      get diagnostics v_k = row_count;
      if v_k > 0 then v_n0 := v_n0 + 1; end if;
    end loop;
  end loop;
  return jsonb_build_object('premiers_envois', v_n0, 'relances', v_nr, 'sans_adresse', v_ign);
end
$$;
revoke all on function app.froid_preparer_corps(uuid[], date) from public, anon, authenticated;

-- Tâche de nuit (toutes les sociétés)
create or replace function public.froid_preparer()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') not in ('service_role', '') and not app.a_le_droit('plateforme.administrer') then
    raise exception 'Réservé à la tâche de nuit' using errcode = '42501';
  end if;
  return app.froid_preparer_corps(array(select id from public.companies), public.paris_today());
end
$$;
revoke all on function public.froid_preparer() from public, anon, authenticated;
grant execute on function public.froid_preparer() to service_role;

-- Bouton « Préparer maintenant » : sociétés où la personne gère le suivi
create or replace function public.froid_preparer_maintenant()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v uuid[] := array(select app.societes_avec_droit('formation.suivi.gerer'));
begin
  if cardinality(v) = 0 then raise exception 'Droit de suivi des sessions requis' using errcode = '42501'; end if;
  return app.froid_preparer_corps(v, public.paris_today());
end
$$;
revoke all on function public.froid_preparer_maintenant() from public, anon;
grant execute on function public.froid_preparer_maintenant() to authenticated;

-- ── Page des non-répondants ──
create or replace function public.froid_suivi()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'envois', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'company_id', e.company_id, 'session_id', e.session_id, 'trainee_id', e.trainee_id, 'client_id', e.client_id,
        'cible', e.cible, 'rang', e.rang, 'du_le', e.du_le, 'statut', e.statut, 'destinataire', e.destinataire,
        'destinataire_nom', e.destinataire_nom, 'motif', e.motif, 'envoye_le', e.envoye_le, 'boite', e.boite,
        'interrompu', e.statut = 'en_cours' and coalesce(e.reserve_le, e.prepare_le) < now() - interval '15 minutes',
        'session_ref', se.reference, 'formation', co.title, 'fin', coalesce(se.end_date, se.start_date), 'debut', se.start_date,
        'entreprise', cl.name) order by coalesce(se.end_date, se.start_date) desc, se.reference, e.cible, e.destinataire_nom)
      from public.froid_envois e join public.sessions se on se.id = e.session_id
      left join public.courses co on co.id = se.course_id left join public.clients cl on cl.id = e.client_id
      where e.company_id in (select app.societes_avec_droit('formation.suivi.voir'))
        and (e.statut in ('prepare', 'en_cours', 'erreur') or e.prepare_le > now() - interval '120 days')), '[]'::jsonb),
    'reglages', coalesce((select jsonb_agg(to_jsonb(app.froid_reglage(x)) || jsonb_build_object('nom', (select coalesce(c.short_name, c.legal_name) from public.companies c where c.id = x)))
      from unnest(array(select app.societes_avec_droit('formation.suivi.voir'))) x), '[]'::jsonb),
    'anciennes', coalesce((select jsonb_agg(jsonb_build_object('session_id', se.id, 'session_ref', se.reference, 'formation', co.title,
        'fin', coalesce(se.end_date, se.start_date), 'inclure', se.froid_inclure) order by coalesce(se.end_date, se.start_date) desc)
      from public.sessions se left join public.courses co on co.id = se.course_id
      where se.company_id in (select app.societes_avec_droit('formation.suivi.voir'))
        and se.status = 'completed' and coalesce(se.session_type, 'intra') <> 'subcontract'
       and not exists (select 1 from public.clients oc where oc.id = se.client_id and oc.client_type = 'organisme_formation')
        and coalesce(se.end_date, se.start_date) < public.paris_today() - (app.froid_reglage(se.company_id)).anciennete_max_jours
        and (exists (select 1 from public.session_trainees st left join public.evaluations_cold ec on ec.session_id = st.session_id and ec.trainee_id = st.trainee_id
                      where st.session_id = se.id and not coalesce(st.absent, false) and ec.completed_at is null)
             -- ou seulement l'employeur à interroger (stagiaires absents ou ayant répondu)
             or ((app.froid_reglage(se.company_id)).employeur_actif and exists (
                   select 1 from (select se.client_id as client_id union all
                                  select tr.client_id from public.session_trainees st join public.trainees tr on tr.id = st.trainee_id
                                   where st.session_id = se.id and not coalesce(st.absent, false)) x
                   join public.clients cl on cl.id = x.client_id
                   where coalesce(cl.client_type, 'entreprise') <> 'particulier'
                     and not exists (select 1 from public.froid_employeur fe where fe.session_id = se.id and fe.client_id = x.client_id and fe.completed_at is not null))))), '[]'::jsonb))
$$;
revoke all on function public.froid_suivi() from public, anon;
grant execute on function public.froid_suivi() to authenticated;

create or replace function public.froid_inclure_session(p_session uuid, p_inclure boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.sessions s where s.id = p_session and s.company_id in (select app.societes_avec_droit('formation.suivi.gerer'))) then
    raise exception 'Droit de suivi des sessions requis' using errcode = '42501';
  end if;
  update public.sessions set froid_inclure = coalesce(p_inclure, false) where id = p_session;
end
$$;
revoke all on function public.froid_inclure_session(uuid, boolean) from public, anon;
grant execute on function public.froid_inclure_session(uuid, boolean) to authenticated;

create or replace function public.froid_ecarter(p_ids uuid[], p_motif text default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v int;
begin
  update public.froid_envois e set statut = 'ignore', motif = coalesce(nullif(btrim(left(coalesce(p_motif, ''), 300)), ''), 'Écarté à la main')
   where e.id = any (p_ids) and e.statut in ('prepare', 'erreur')
     and e.company_id in (select app.societes_avec_droit('formation.suivi.gerer'));
  get diagnostics v = row_count;
  return v;
end
$$;
revoke all on function public.froid_ecarter(uuid[], text) from public, anon;
grant execute on function public.froid_ecarter(uuid[], text) to authenticated;

create or replace function public.froid_reglages_enregistrer(p_company uuid, p jsonb)
returns public.froid_reglages
language plpgsql
security definer
set search_path = ''
as $$
declare v public.froid_reglages;
begin
  if not (app.is_superadmin() or p_company in (select app.societes_avec_droit('parametres.organisme.modifier'))) then
    raise exception 'Droit de modifier les réglages de l''organisme requis' using errcode = '42501';
  end if;
  insert into public.froid_reglages (company_id, actif, premier_envoi_jours, relance_apres_jours, entre_relances_jours, relances_max, anciennete_max_jours, employeur_actif, updated_by)
  values (p_company, coalesce((p ->> 'actif')::boolean, true), coalesce((p ->> 'premier_envoi_jours')::int, 60),
          coalesce((p ->> 'relance_apres_jours')::int, 30), coalesce((p ->> 'entre_relances_jours')::int, 60),
          coalesce((p ->> 'relances_max')::int, 1), coalesce((p ->> 'anciennete_max_jours')::int, 365),
          coalesce((p ->> 'employeur_actif')::boolean, true), (select auth.uid()))
  on conflict (company_id) do update set actif = excluded.actif, premier_envoi_jours = excluded.premier_envoi_jours,
    relance_apres_jours = excluded.relance_apres_jours, entre_relances_jours = excluded.entre_relances_jours,
    relances_max = excluded.relances_max, anciennete_max_jours = excluded.anciennete_max_jours,
    employeur_actif = excluded.employeur_actif, updated_at = now(), updated_by = excluded.updated_by
  returning * into v;
  return v;
end
$$;
revoke all on function public.froid_reglages_enregistrer(uuid, jsonb) from public, anon;
grant execute on function public.froid_reglages_enregistrer(uuid, jsonb) to authenticated;

-- ── 5. Envoi (appelé par le serveur avec le jeton de la personne connectée) ──
-- Réserve les envois choisis : droit d'envoyer de la société, interrupteur ouvert, encore « à envoyer », pas plus
-- d'un envoi par adresse et par jour. Rend ce qu'il faut pour écrire chaque mail.
create or replace function public.froid_envois_reserver(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v jsonb := '[]'::jsonb; e record; v_refus jsonb := '[]'::jsonb;
begin
  if (select auth.uid()) is null then raise exception 'Connexion requise' using errcode = '42501'; end if;
  if cardinality(p_ids) > 200 then raise exception 'Au plus 200 envois à la fois' using errcode = '22023'; end if;
  -- Une réservation à la fois par adresse : deux personnes qui envoient en même temps à la même adresse passent
  -- l'une après l'autre, la seconde voit la première « en cours » et attend le lendemain.
  -- Verrous pris dans l'ordre des adresses, pour que deux réservations ne s'attendent jamais l'une l'autre.
  perform pg_advisory_xact_lock(hashtextextended('froid_envoi:' || a.adresse, 0))
     from (select distinct lower(x.destinataire) as adresse from public.froid_envois x
            where x.id = any (p_ids) and x.destinataire is not null order by 1) a;
  for e in
    select x.* from public.froid_envois x where x.id = any (p_ids) order by x.session_id, x.destinataire for update
  loop
    if e.company_id not in (select app.societes_avec_droit('formation.convocations.envoyer')) then
      v_refus := v_refus || jsonb_build_object('id', e.id, 'raison', 'Droit d''envoyer aux stagiaires et aux clients requis'); continue;
    end if;
    if not app.envoi_auto_autorise(e.company_id, 'evaluation_froid') then
      v_refus := v_refus || jsonb_build_object('id', e.id, 'raison', 'Envoi « Questionnaires à froid » fermé dans la Console'); continue;
    end if;
    if e.statut <> 'prepare' then
      v_refus := v_refus || jsonb_build_object('id', e.id, 'raison', 'Déjà traité'); continue;
    end if;
    -- La session et la personne sont-elles toujours concernées ? (session terminée, ni sous-traitance ni autre organisme,
    -- stagiaire inscrit et présent) ; sinon la ligne est écartée
    if not exists (select 1 from public.sessions se left join public.clients oc on oc.id = se.client_id
                    where se.id = e.session_id and se.status = 'completed' and coalesce(se.session_type, 'intra') <> 'subcontract'
                      and coalesce(oc.client_type, '') <> 'organisme_formation')
       or (e.trainee_id is not null and not exists (select 1 from public.session_trainees st
                    where st.session_id = e.session_id and st.trainee_id = e.trainee_id and not coalesce(st.absent, false))) then
      update public.froid_envois set statut = 'ignore', motif = 'Session ou stagiaire plus concerné' where id = e.id;
      v_refus := v_refus || jsonb_build_object('id', e.id, 'raison', 'Session ou stagiaire plus concerné'); continue;
    end if;
    if not app.froid_email_valide(e.destinataire) then
      v_refus := v_refus || jsonb_build_object('id', e.id, 'raison', 'Adresse invalide'); continue;
    end if;
    -- Une adresse, un envoi par jour
    -- Seule exception : contact et employeur d'une même session choisis ensemble, qui partent dans un seul mail.
    -- Choisis en deux fois, la seconde attend le lendemain ; une autre session aussi.
    if exists (select 1 from public.froid_envois y where lower(y.destinataire) = lower(e.destinataire) and y.id <> e.id
        and not (e.cible <> 'stagiaire' and y.cible <> 'stagiaire' and y.session_id = e.session_id and y.id = any (p_ids)
                 and (y.statut = 'prepare' or (y.statut = 'en_cours' and y.reserve_le = now() and y.envoye_par = (select auth.uid()))))
        and (y.statut = 'en_cours' or (y.statut = 'envoye' and y.envoye_le > now() - interval '1 day'))) then
      v_refus := v_refus || jsonb_build_object('id', e.id, 'raison', 'Adresse déjà écrite depuis moins d''un jour'); continue;
    end if;
    if e.cible = 'stagiaire' and exists (select 1 from public.evaluations_cold ec where ec.session_id = e.session_id and ec.trainee_id = e.trainee_id and ec.completed_at is not null) then
      update public.froid_envois set statut = 'ignore', motif = 'Réponse reçue' where id = e.id;
      v_refus := v_refus || jsonb_build_object('id', e.id, 'raison', 'Réponse déjà reçue'); continue;
    end if;
    update public.froid_envois set statut = 'en_cours', envoye_par = (select auth.uid()), reserve_le = now() where id = e.id;
    v := v || (select jsonb_build_object(
        'id', e.id, 'company_id', e.company_id, 'session_id', e.session_id, 'cible', e.cible, 'rang', e.rang,
        'destinataire', e.destinataire, 'destinataire_nom', e.destinataire_nom,
        'formation', co.title, 'debut', se.start_date, 'fin', coalesce(se.end_date, se.start_date), 'jeton', se.attendance_token,
        'prenom', tr.first_name, 'nom', tr.last_name, 'code', st.access_code, 'entreprise', cl.name)
      from public.sessions se left join public.courses co on co.id = se.course_id
      left join public.trainees tr on tr.id = e.trainee_id
      left join public.session_trainees st on st.session_id = e.session_id and st.trainee_id = e.trainee_id
      left join public.clients cl on cl.id = e.client_id
      where se.id = e.session_id);
  end loop;
  return jsonb_build_object('envois', v, 'refus', v_refus);
end
$$;
revoke all on function public.froid_envois_reserver(uuid[]) from public, anon;
grant execute on function public.froid_envois_reserver(uuid[]) to authenticated;

create or replace function public.froid_envoi_terminer(p_id uuid, p_ok boolean, p_message_id text default null, p_boite text default null, p_erreur text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare e public.froid_envois;
begin
  select * into e from public.froid_envois where id = p_id and statut = 'en_cours' and envoye_par = (select auth.uid()) for update;
  if e.id is null then raise exception 'Envoi introuvable ou déjà terminé' using errcode = '22023'; end if;
  if p_ok then
    update public.froid_envois set statut = 'envoye', envoye_le = now(), message_id = left(p_message_id, 300), boite = left(p_boite, 255), motif = null where id = p_id;
    if e.cible in ('stagiaire', 'contact') then
      insert into public.evaluations_cold (session_id, trainee_id, sent_at) values (e.session_id, e.trainee_id, now())
      on conflict (session_id, trainee_id) do update set sent_at = coalesce(public.evaluations_cold.sent_at, now())
       where public.evaluations_cold.completed_at is null;
      update public.session_trainees set cold_eval_sent_individual = true, cold_eval_sent_individual_date = coalesce(cold_eval_sent_individual_date, now())
       where session_id = e.session_id and trainee_id = e.trainee_id;
    end if;
  else
    update public.froid_envois set statut = 'erreur', motif = left(coalesce(p_erreur, 'Échec de l''envoi'), 300) where id = p_id;
  end if;
end
$$;
revoke all on function public.froid_envoi_terminer(uuid, boolean, text, text, text) from public, anon;
grant execute on function public.froid_envoi_terminer(uuid, boolean, text, text, text) to authenticated;

-- Remettre « à envoyer » un envoi en erreur, ou resté en cours plus de 15 minutes après sa réservation (envoi interrompu),
-- après vérification de la boîte d'envoi
create or replace function public.froid_remettre(p_ids uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v int;
begin
  update public.froid_envois e set statut = 'prepare', motif = null, envoye_par = null
   where e.id = any (p_ids) and (e.statut = 'erreur' or (e.statut = 'en_cours' and coalesce(e.reserve_le, e.prepare_le) < now() - interval '15 minutes'))
     and e.company_id in (select app.societes_avec_droit('formation.convocations.envoyer'));
  get diagnostics v = row_count;
  return v;
end
$$;
revoke all on function public.froid_remettre(uuid[]) from public, anon;
grant execute on function public.froid_remettre(uuid[]) to authenticated;

-- ── 6. Portail stagiaire ──
create or replace function public.portail_froid(p_token text, p_trainee_id uuid, p_ticket text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_session uuid; s record; r public.froid_reglages; ec public.evaluations_cold;
begin
  v_session := app.portal_session_for(p_token, p_trainee_id, p_ticket);
  select se.company_id, coalesce(se.end_date, se.start_date) as fin, co.title, co.froid_delai_jours, se.status into s
    from public.sessions se left join public.courses co on co.id = se.course_id where se.id = v_session;
  r := app.froid_reglage(s.company_id);
  select * into ec from public.evaluations_cold where session_id = v_session and trainee_id = p_trainee_id;
  return jsonb_build_object(
    'ouvert', s.status = 'completed' and (r.actif and s.fin + coalesce(s.froid_delai_jours, r.premier_envoi_jours) <= public.paris_today() or ec.sent_at is not null),
    'ouvre_le', s.fin + coalesce(s.froid_delai_jours, r.premier_envoi_jours),
    'recue', ec.completed_at is not null, 'recue_le', ec.completed_at,
    'formation', s.title, 'questions', app.froid_questions(v_session, 'stagiaire'));
end
$$;
revoke all on function public.portail_froid(text, uuid, text) from public;
grant execute on function public.portail_froid(text, uuid, text) to anon, authenticated;

-- Colonnes de base : oui = 5, non = 1 (convention de la fiche session) ; recommande : vrai ou faux ; autres : reponses
create or replace function public.portail_froid_repondre(p_token text, p_trainee_id uuid, p_ticket text, p_reponses jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_session uuid; v_q jsonb; v_info jsonb; k text; v jsonb; v_extra jsonb := '{}'::jsonb; ec public.evaluations_cold;
  note5 constant text[] := array['skills_applied', 'objectives_met', 'knowledge_retained', 'job_impact'];
begin
  v_session := app.portal_session_for(p_token, p_trainee_id, p_ticket);
  v_info := public.portail_froid(p_token, p_trainee_id, p_ticket);
  if not (v_info ->> 'ouvert')::boolean then raise exception 'Le questionnaire n''est pas encore ouvert' using errcode = '22023'; end if;
  if (v_info ->> 'recue')::boolean then raise exception 'Votre réponse est déjà enregistrée : merci' using errcode = '23505'; end if;
  v_q := v_info -> 'questions';
  if not app.froid_reponses_valides(v_q, p_reponses) then raise exception 'Merci de répondre à toutes les questions' using errcode = '22023'; end if;
  insert into public.evaluations_cold (session_id, trainee_id) values (v_session, p_trainee_id) on conflict (session_id, trainee_id) do nothing;
  for k, v in select * from jsonb_each(p_reponses) loop
    if k = any (note5) then continue;
    elsif k not in ('would_recommend', 'comments', 'needs_met', 'concrete_examples', 'obstacles', 'additional_needs') then v_extra := v_extra || jsonb_build_object(k, v);
    end if;
  end loop;
  update public.evaluations_cold e set
    skills_applied = case when p_reponses ? 'skills_applied' then case (p_reponses ->> 'skills_applied')::boolean when true then 5 when false then 1 end else e.skills_applied end,
    objectives_met = case when p_reponses ? 'objectives_met' then case (p_reponses ->> 'objectives_met')::boolean when true then 5 when false then 1 end else e.objectives_met end,
    knowledge_retained = case when p_reponses ? 'knowledge_retained' then case (p_reponses ->> 'knowledge_retained')::boolean when true then 5 when false then 1 end else e.knowledge_retained end,
    job_impact = case when p_reponses ? 'job_impact' then case (p_reponses ->> 'job_impact')::boolean when true then 5 when false then 1 end else e.job_impact end,
    would_recommend = case when p_reponses ? 'would_recommend' then (p_reponses ->> 'would_recommend')::boolean else e.would_recommend end,
    needs_met = case when p_reponses ? 'needs_met' then (p_reponses ->> 'needs_met')::boolean else e.needs_met end,
    comments = case when p_reponses ? 'comments' then nullif(btrim(p_reponses ->> 'comments'), '') else e.comments end,
    concrete_examples = case when p_reponses ? 'concrete_examples' then nullif(btrim(p_reponses ->> 'concrete_examples'), '') else e.concrete_examples end,
    obstacles = case when p_reponses ? 'obstacles' then nullif(btrim(p_reponses ->> 'obstacles'), '') else e.obstacles end,
    additional_needs = case when p_reponses ? 'additional_needs' then nullif(btrim(p_reponses ->> 'additional_needs'), '') else e.additional_needs end,
    reponses = nullif(v_extra, '{}'::jsonb),
    completed_at = now(), sent_at = coalesce(e.sent_at, now()), saisi_par = null
  where e.session_id = v_session and e.trainee_id = p_trainee_id
  returning * into ec;
  update public.froid_envois set statut = 'ignore', motif = 'Réponse reçue'
   where session_id = v_session and trainee_id = p_trainee_id and statut = 'prepare';
  return jsonb_build_object('success', true, 'recue_le', ec.completed_at);
end
$$;
revoke all on function public.portail_froid_repondre(text, uuid, text, jsonb) from public;
grant execute on function public.portail_froid_repondre(text, uuid, text, jsonb) to anon, authenticated;

-- ── 7. Espace entreprise ──
create or replace function public.ent_froid()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v public.client_accounts := app.ent_compte(); r public.froid_reglages := app.froid_reglage(v.company_id);
begin
  return jsonb_build_object(
    'actif', r.actif,
    'sessions', coalesce((select jsonb_agg(jsonb_build_object(
        'session_id', se.id, 'formation', co.title, 'debut', se.start_date, 'fin', coalesce(se.end_date, se.start_date),
        'employeur', case when r.employeur_actif or exists (select 1 from public.froid_envois e where e.session_id = se.id and e.client_id = v.client_id and e.cible = 'employeur' and e.statut = 'envoye') then jsonb_build_object(
            'recue', fe.completed_at is not null, 'recue_le', fe.completed_at,
            'questions', app.froid_questions(se.id, 'employeur')) end,
        'stagiaires', coalesce((select jsonb_agg(jsonb_build_object('prenom', tr.first_name, 'nom', tr.last_name,
              'recue', ec.completed_at is not null, 'code', st.access_code, 'jeton', se.attendance_token) order by tr.last_name, tr.first_name)
            from public.session_trainees st join public.trainees tr on tr.id = st.trainee_id
            left join public.evaluations_cold ec on ec.session_id = st.session_id and ec.trainee_id = st.trainee_id
            where st.session_id = se.id and tr.client_id = v.client_id and not coalesce(st.absent, false)
              and exists (select 1 from public.froid_envois e where e.session_id = se.id and e.trainee_id = st.trainee_id and e.cible = 'contact')), '[]'::jsonb))
        order by coalesce(se.end_date, se.start_date) desc)
      from public.sessions se left join public.courses co on co.id = se.course_id
      left join public.froid_employeur fe on fe.session_id = se.id and fe.client_id = v.client_id
      where se.company_id = v.company_id
        -- questionnaire ouvert par les réglages, ou déjà envoyé à l'employeur (il reste accessible si les réglages changent)
        and ((r.actif
              and se.status = 'completed' and coalesce(se.session_type, 'intra') <> 'subcontract'
       and not exists (select 1 from public.clients oc where oc.id = se.client_id and oc.client_type = 'organisme_formation')
              and coalesce(se.end_date, se.start_date) + coalesce(co.froid_delai_jours, r.premier_envoi_jours) <= public.paris_today()
              and (coalesce(se.end_date, se.start_date) >= public.paris_today() - r.anciennete_max_jours or se.froid_inclure))
             or exists (select 1 from public.froid_envois e where e.session_id = se.id and e.client_id = v.client_id and e.cible = 'employeur' and e.statut = 'envoye'))
        and (se.client_id = v.client_id or exists (select 1 from public.session_trainees st join public.trainees tr on tr.id = st.trainee_id
                                                    where st.session_id = se.id and tr.client_id = v.client_id))), '[]'::jsonb));
end
$$;
revoke all on function public.ent_froid() from public, anon;
grant execute on function public.ent_froid() to authenticated;

create or replace function public.ent_froid_repondre(p_session uuid, p_reponses jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v public.client_accounts := app.ent_compte(); r public.froid_reglages := app.froid_reglage(v.company_id); v_q jsonb; v_ok boolean;
begin
  -- session visible dans l'espace entreprise, avec un questionnaire employeur proposé (réglage actif ou déjà envoyé)
  select exists (select 1 from jsonb_array_elements(public.ent_froid() -> 'sessions') x
                  where (x ->> 'session_id')::uuid = p_session and jsonb_typeof(x -> 'employeur') = 'object') into v_ok;
  if not v_ok then raise exception 'Questionnaire non disponible pour cette formation' using errcode = '22023'; end if;
  if exists (select 1 from public.froid_employeur fe where fe.session_id = p_session and fe.client_id = v.client_id and fe.completed_at is not null) then
    raise exception 'Votre réponse est déjà enregistrée : merci' using errcode = '23505';
  end if;
  v_q := app.froid_questions(p_session, 'employeur');
  if not app.froid_reponses_valides(v_q, p_reponses) then raise exception 'Merci de répondre à toutes les questions' using errcode = '22023'; end if;
  insert into public.froid_employeur (company_id, session_id, client_id, reponses, completed_at, repondu_par)
  values (v.company_id, p_session, v.client_id, p_reponses, now(), (select auth.uid()))
  on conflict (session_id, client_id) do update set reponses = excluded.reponses, completed_at = excluded.completed_at, repondu_par = excluded.repondu_par;
  update public.froid_envois set statut = 'ignore', motif = 'Réponse reçue'
   where session_id = p_session and client_id = v.client_id and cible = 'employeur' and statut = 'prepare';
  return jsonb_build_object('success', true);
end
$$;
revoke all on function public.ent_froid_repondre(uuid, jsonb) from public, anon;
grant execute on function public.ent_froid_repondre(uuid, jsonb) to authenticated;

-- Correction d'une réponse de l'employeur : super administrateur, motif, trace avant et après
create or replace function public.froid_employeur_corriger(p_id uuid, p_reponses jsonb, p_motif text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare fe public.froid_employeur; v_motif text := nullif(btrim(coalesce(p_motif, '')), '');
begin
  if not app.is_superadmin() then raise exception 'Réservé au super administrateur' using errcode = '42501'; end if;
  if v_motif is null or length(v_motif) < 5 then raise exception 'Indiquez le motif de la correction' using errcode = '22023'; end if;
  select * into fe from public.froid_employeur where id = p_id;
  if fe.id is null then raise exception 'Réponse introuvable' using errcode = '22023'; end if;
  if not app.froid_reponses_valides(app.froid_questions(fe.session_id, 'employeur'), p_reponses) then raise exception 'Réponses invalides' using errcode = '22023'; end if;
  perform set_config('app.eval_correction', 'on', true);
  update public.froid_employeur set reponses = p_reponses where id = p_id;
  perform set_config('app.eval_correction', '', true);
  insert into public.audit_logs (action, entity_type, entity_id, entity_name, details, company_id, source)
  values ('update', 'evaluation', p_id, 'Correction d''une évaluation à froid de l''employeur',
          jsonb_build_object('table', 'froid_employeur', 'motif', v_motif, 'avant', fe.reponses, 'apres', p_reponses), fe.company_id, 'base');
end
$$;
revoke all on function public.froid_employeur_corriger(uuid, jsonb, text) from public, anon;
grant execute on function public.froid_employeur_corriger(uuid, jsonb, text) to authenticated;

-- ── 8. Rappel interne du pilote remplacé ──
update public.org_modules set settings = jsonb_set(settings, '{eval_froid,actif}', 'false'::jsonb)
 where key = 'pilote' and settings ? 'eval_froid' and coalesce((settings -> 'eval_froid' ->> 'actif')::boolean, true);

insert into public.schema_migrations (version) values ('0482_relance_froid') on conflict (version) do nothing;
