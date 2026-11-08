-- 0517 : avis des financeurs (Qualiopi, indicateur 30 ; idée S1 de Samyo, conception validée par H le 08/11).
-- Indicateur 30 (décret n° 2026-728) : « Le prestataire recueille les appréciations des parties prenantes : bénéficiaires,
-- financeurs (le cas échéant), équipes pédagogiques et entreprises concernées. » Guide de lecture V10 (novembre 2026),
-- p. 37 : la sollicitation des financeurs « doit être effectuée au moins une fois par an ou selon les modalités précisées
-- par le financeur » ; elle « peut être remplacée par la participation du prestataire à des webinaires thématiques ou des
-- réunions relatives aux bonnes pratiques organisés par le financeur » ; non-conformité mineure : « absence de contact ou
-- de participation à des webinaires ou réunions organisés par le financeur ».
-- Décisions de H (08/11) : une sollicitation par financeur et par an ; envoi PRÉPARÉ (Relances à valider), jamais envoyé
-- sans une personne ; le financeur répond par un lien, sans compte.
--   1. funder_feedback : une demande d'avis par société, financeur et année (sessions financées gardées en photo), lien
--      à usage unique (jeton de 48 caractères, illisible par les comptes), actif seulement une fois la relance validée ou
--      envoyée, valable 90 jours à compter de la validation ou de l'envoi. Seules les sessions terminées sont annoncées.
--      Aucune écriture par un compte : la base prépare, le financeur répond par les fonctions du lien.
--   2. funder_exchanges : échanges avec un financeur saisis à la main (webinaire, réunion, échange sur une prestation,
--      contrôle, consultation de son site d'avis), qui couvrent l'année comme une sollicitation (guide V10).
--   3. app.financeur_cle : un financeur = CPF, France Travail, sa fiche (donnée, ou retrouvée par son nom sans casse ni
--      accents dans la société), sinon son nom normalisé. app.financeurs_de_l_annee(société, année) : financeurs des
--      sessions non annulées de l'année (dernier jour dans
--      l'année), financements ni refusés ni annulés ; OPCO, région, autre, CPF, France Travail. Le financeur
--      « entreprise » est l'entreprise elle-même (avis de l'entreprise, 0415, 0504) : il n'est pas repris ici.
--   4. public.financeurs_avis_preparer() (la nuit, clé de service) : pour chaque OPCO, région ou autre financeur qui a au
--      moins une session terminée dans l'année, avec une adresse, sans demande ni échange dans l'année : une demande et
--      une relance à valider (« avis_financeur ») ; 15 jours après l'envoi sans réponse, une seconde relance à valider,
--      à l'adresse retenue au premier envoi. L'année écoulée reste traitée jusqu'au 31 mars.
--      CPF et France Travail : rien n'est préparé (leurs plateformes recueillent les avis) ; un échange saisi les couvre.
--   5. public.financeurs_suivi(année) : suivi par financeur pour l'écran (couvert : sollicité ou échange dans l'année),
--      et sessions marquées financées sans aucun financeur renseigné (la nuit ne peut rien en faire).
--   6. public.financeur_avis_ouvrir(jeton) et public.financeur_avis_repondre(jeton, réponses) : page publique du lien
--      (une seule réponse, notification à l'organisme). Aucune donnée de stagiaire n'est montrée.
-- Additive. Idempotente. Retour arrière : supabase/rollback/0517_avis_financeurs_retour.sql

-- ── 1. Demandes d'avis ──
create table if not exists public.funder_feedback (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  year int not null check (year between 2020 and 2100),
  funder_key text not null check (length(funder_key) between 3 and 220),
  funder_type text not null check (funder_type in ('opco', 'region', 'autre')),
  funder_name text not null check (length(btrim(funder_name)) between 1 and 200),
  funder_client_id uuid references public.clients(id) on delete set null,
  contact_email text check (contact_email is null or length(contact_email) <= 255),
  sessions jsonb not null default '[]'::jsonb,
  token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  expires_at timestamptz not null default (now() + interval '90 days'),
  answered_at timestamptz,
  note_globale smallint check (note_globale between 1 and 5),
  q_information smallint check (q_information between 1 and 5),
  q_administratif smallint check (q_administratif between 1 and 5),
  q_qualite smallint check (q_qualite between 1 and 5),
  q_relation smallint check (q_relation between 1 and 5),
  commentaire text check (commentaire is null or length(commentaire) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, funder_key, year),
  check ((answered_at is null) = (note_globale is null))
);
create index if not exists funder_feedback_client_idx on public.funder_feedback (funder_client_id);
comment on table public.funder_feedback is 'Avis des financeurs (0517, Qualiopi 30) : une demande par société, financeur et année, réponse par un lien à usage unique';

-- ── 2. Échanges avec un financeur ──
create table if not exists public.funder_exchanges (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  funder_type text not null check (funder_type in ('opco', 'region', 'autre', 'cpf', 'pole_emploi')),
  funder_name text not null check (length(btrim(funder_name)) between 2 and 200),
  funder_client_id uuid references public.clients(id) on delete set null,
  kind text not null check (kind in ('webinaire', 'reunion', 'echange', 'controle', 'consultation_site')),
  happened_on date not null,
  notes text check (notes is null or length(notes) <= 1000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists funder_exchanges_societe_idx on public.funder_exchanges (company_id, happened_on);
comment on table public.funder_exchanges is 'Échanges avec un financeur (0517, Qualiopi 30 : webinaire, réunion, échange, contrôle, site d''avis), saisis à la main';

-- Nom d'un financeur comparé sans casse, sans accents et sans espaces en trop (« Région  Bretagne » = « region bretagne »)
create or replace function app.financeur_nom_norme(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(replace(translate(lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g')),
    'àâäáãåçéèêëíìîïñóòôöõúùûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy'), 'œ', 'oe'), 'æ', 'ae')
$$;
revoke all on function app.financeur_nom_norme(text) from public, anon, authenticated;

-- Clé d'un financeur : CPF et France Travail (financeur national unique) ; sinon sa fiche, donnée ou retrouvée par son nom
-- dans la société (une saisie libre « Akto » rejoint la fiche AKTO) ; sinon son nom normalisé, quel que soit le type saisi
create or replace function app.financeur_cle(p_company uuid, p_type text, p_client uuid, p_name text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_type in ('cpf', 'pole_emploi') then p_type
    else coalesce('c:' || coalesce(p_client, (
           select c.id from public.clients c
           where c.company_id = p_company and app.financeur_nom_norme(p_name) <> ''
             and app.financeur_nom_norme(c.name) = app.financeur_nom_norme(p_name)
           order by (c.client_type = 'opco') desc, c.created_at, c.id limit 1))::text,
         'n:' || app.financeur_nom_norme(p_name)) end
$$;
revoke all on function app.financeur_cle(uuid, text, uuid, text) from public, anon, authenticated;

-- Même contrôle d'adresse pour la nuit et pour l'écran
create or replace function app.financeur_email_valide(p_email text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(btrim(p_email) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$', false)
$$;
revoke all on function app.financeur_email_valide(text) from public, anon, authenticated;


-- Société, auteur et date de création figés ; fiche du financeur de la même société ; date passée ; nom nettoyé
create or replace function app.funder_exchanges_regle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.company_id := old.company_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  else
    new.created_by := (select auth.uid());
    new.created_at := now();
  end if;
  new.funder_name := regexp_replace(btrim(new.funder_name), '\s+', ' ', 'g');
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  if new.happened_on > (now() at time zone 'Europe/Paris')::date then
    raise exception 'La date de l''échange ne peut pas être dans le futur' using errcode = '23514';
  end if;
  if new.funder_client_id is not null and not exists (
    select 1 from public.clients c where c.id = new.funder_client_id and c.company_id = new.company_id) then
    raise exception 'Fiche du financeur d''une autre société' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function app.funder_exchanges_regle() from public, anon, authenticated;
drop trigger if exists funder_exchanges_regle on public.funder_exchanges;
create trigger funder_exchanges_regle before insert or update on public.funder_exchanges
  for each row execute function app.funder_exchanges_regle();

-- ── 3. Financeurs d'une année ──
-- Sessions non annulées dont le dernier jour est dans l'année ; « sessions_finies » : celles déjà terminées (les seules
-- annoncées au financeur)
create or replace function app.financeurs_de_l_annee(p_company uuid, p_year int)
returns table (funder_key text, funder_type text, funder_name text, funder_client_id uuid, contact_email text,
               sessions jsonb, sessions_terminees int, sessions_finies jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  with f as (
    select k.cle, sf.funder_type, coalesce(nullif(btrim(c.name), ''), nullif(btrim(sf.funder_name), '')) as nom, c.id as client_id,
           coalesce(nullif(btrim(sf.funder_contact_email), ''), nullif(btrim(c.billing_email), ''), nullif(btrim(c.email), ''),
                    nullif(btrim(c.contact_email), '')) as email,
           sf.updated_at, jsonb_build_object('id', s.id, 'reference', s.reference, 'titre', co.title, 'debut', s.start_date,
                                             'fin', coalesce(s.end_date, s.start_date)) as session,
           s.id as session_id, coalesce(s.end_date, s.start_date) <= (now() at time zone 'Europe/Paris')::date as finie
    from public.session_fundings sf
    join public.sessions s on s.id = sf.session_id
    left join public.courses co on co.id = s.course_id
    cross join lateral (select app.financeur_cle(s.company_id, sf.funder_type, sf.funder_client_id, sf.funder_name) as cle) k
    left join public.clients c on c.id = case when k.cle like 'c:%' then substr(k.cle, 3)::uuid end
    where s.company_id = p_company
      and s.status is distinct from 'cancelled'
      and sf.status not in ('refused', 'cancelled')
      and sf.funder_type in ('opco', 'region', 'autre', 'cpf', 'pole_emploi')
      and extract(year from coalesce(s.end_date, s.start_date))::int = p_year
      and (sf.funder_client_id is not null or nullif(btrim(sf.funder_name), '') is not null
           or sf.funder_type in ('cpf', 'pole_emploi'))
  )
  select f.cle, min(f.funder_type),
         coalesce(max(f.nom), case min(f.funder_type) when 'cpf' then 'CPF (Caisse des Dépôts)' when 'pole_emploi' then 'France Travail' else 'Financeur' end),
         (array_agg(f.client_id) filter (where f.client_id is not null))[1],
         (array_agg(f.email order by f.updated_at desc) filter (where f.email is not null))[1],
         jsonb_agg(distinct f.session),
         count(distinct f.session_id) filter (where f.finie)::int,
         coalesce(jsonb_agg(distinct f.session) filter (where f.finie), '[]'::jsonb)
  from f
  group by f.cle
$$;
revoke all on function app.financeurs_de_l_annee(uuid, int) from public, anon, authenticated;

-- Années encore traitées par la nuit : l'année en cours, et l'année écoulée jusqu'au 31 mars (session finie le 31/12,
-- accord d'un OPCO reçu en janvier)
create or replace function app.financeurs_annees_ouvertes()
returns int[]
language sql
stable
set search_path = ''
as $$
  select case when extract(month from (now() at time zone 'Europe/Paris')) <= 3
              then array[extract(year from (now() at time zone 'Europe/Paris'))::int, extract(year from (now() at time zone 'Europe/Paris'))::int - 1]
              else array[extract(year from (now() at time zone 'Europe/Paris'))::int] end
$$;
revoke all on function app.financeurs_annees_ouvertes() from public, anon, authenticated;

-- ── 4. Préparation de la nuit ──
create or replace function app.avis_financeur_texte(p_relance boolean, p_org text, p_annee int, p_n int, p_lien text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_relance then
    'Bonjour,' || E'\n\n' || 'Nous nous permettons de revenir vers vous : votre avis sur '
      || case when p_n > 1 then 'les formations que vous avez financées' else 'la formation que vous avez financée' end
      || ' en ' || p_annee || ' nous serait utile. Le questionnaire prend deux minutes, sans créer de compte :' || E'\n'
      || p_lien || E'\n\n' || 'Cordialement,' || E'\n' || p_org
  else
    'Bonjour,' || E'\n\n' || 'En ' || p_annee || ', ' || p_org || ' a réalisé '
      || case when p_n > 1 then p_n || ' formations que vous avez financées' else 'une formation que vous avez financée' end
      || '. Dans le cadre de notre démarche qualité (certification Qualiopi), nous recueillons une fois par an l''avis des financeurs.'
      || E'\n\n' || 'Si vous le souhaitez, vous pouvez nous faire part de vos observations en deux minutes, sans créer de compte :'
      || E'\n' || p_lien || E'\n\n' || 'Ce lien vous est réservé et ne sert qu''une fois.' || E'\n\n' || 'Cordialement,' || E'\n' || p_org
  end
$$;
revoke all on function app.avis_financeur_texte(boolean, text, int, int, text) from public, anon, authenticated;

alter table public.scheduled_actions drop constraint if exists scheduled_actions_kind_check;
alter table public.scheduled_actions add constraint scheduled_actions_kind_check check (kind in ('relance_recyclage',
  'justificatif_prestataire', 'convocation', 'rappel', 'evaluation_froid', 'relance_impaye', 'autre', 'renouvellement_contrat',
  'visite_hors_contrat', 'emargement_manquant', 'eval_chaud', 'attestations', 'facture_brouillon', 'avis_financeur'));

-- Lien valable 90 jours à compter de la validation ou de l'envoi (pas de la préparation : une relance peut attendre)
create or replace function app.avis_financeur_lien_actif()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'avis_financeur' and new.target_id is not null and new.status in ('valide', 'envoye')
     and new.status is distinct from old.status then
    update public.funder_feedback d set expires_at = greatest(d.expires_at, now() + interval '90 days'), updated_at = now()
     where d.id = new.target_id and d.company_id = new.company_id and d.answered_at is null;
  end if;
  return null;
end
$$;
revoke all on function app.avis_financeur_lien_actif() from public, anon, authenticated;
drop trigger if exists scheduled_actions_avis_financeur on public.scheduled_actions;
create trigger scheduled_actions_avis_financeur after update of status on public.scheduled_actions
  for each row execute function app.avis_financeur_lien_actif();

create or replace function public.financeurs_avis_preparer()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_annee int;
  v_cie record;
  v_f record;
  v_d public.funder_feedback;
  v_r record;
  v_org text;
  v_n int;
  v_demandes int := 0;
  v_relances int := 0;
begin
  select rtrim(decrypted_secret, '/') into v_url from vault.decrypted_secrets where name = 'app_url';
  if nullif(btrim(coalesce(v_url, '')), '') is null then
    return jsonb_build_object('demandes', 0, 'relances', 0, 'sans_adresse', true);
  end if;
  for v_cie in select c.id, coalesce(nullif(btrim(c.short_name), ''), c.legal_name) as nom
               from public.companies c where c.is_training_org is not false and c.status = 'active'
  loop
    v_org := coalesce(nullif(btrim(v_cie.nom), ''), 'L''organisme de formation');
    foreach v_annee in array app.financeurs_annees_ouvertes() loop
      for v_f in
        select * from app.financeurs_de_l_annee(v_cie.id, v_annee) x
        where x.funder_type in ('opco', 'region', 'autre') and x.sessions_terminees > 0
          and app.financeur_email_valide(x.contact_email)
          and not exists (select 1 from public.funder_feedback d where d.company_id = v_cie.id and d.funder_key = x.funder_key and d.year = v_annee)
          and not exists (select 1 from public.funder_exchanges e where e.company_id = v_cie.id
                            and extract(year from e.happened_on)::int = v_annee
                            and app.financeur_cle(e.company_id, e.funder_type, e.funder_client_id, e.funder_name) = x.funder_key)
      loop
        v_d := null;
        insert into public.funder_feedback (company_id, year, funder_key, funder_type, funder_name, funder_client_id, contact_email, sessions)
        values (v_cie.id, v_annee, v_f.funder_key, v_f.funder_type, v_f.funder_name, v_f.funder_client_id, btrim(v_f.contact_email), v_f.sessions_finies)
        on conflict (company_id, funder_key, year) do nothing
        returning * into v_d;
        if v_d.id is null then continue; end if;
        v_n := jsonb_array_length(v_d.sessions);
        insert into public.scheduled_actions (company_id, kind, target_table, target_id, client_id, due_on, title, payload, dedup_key)
        values (v_cie.id, 'avis_financeur', 'funder_feedback', v_d.id, v_d.funder_client_id, (now() at time zone 'Europe/Paris')::date,
                left('Avis du financeur ' || v_annee || ' : ' || v_d.funder_name, 255),
                jsonb_build_object('destinataire', v_d.contact_email, 'objet', 'Votre avis sur nos formations ' || v_annee,
                                   'texte', app.avis_financeur_texte(false, v_org, v_annee, v_n, v_url || '/#/avis-financeur/' || v_d.token)),
                'avis_financeur:' || v_d.id)
        on conflict (company_id, dedup_key) do nothing;
        v_demandes := v_demandes + 1;
      end loop;
    end loop;
    -- Seconde relance : 15 jours après l'envoi, sans réponse, encore au moins 10 jours de validité ; à l'adresse
    -- retenue au premier envoi (elle a pu être corrigée dans les relances)
    for v_r in
      select d.id, d.year, d.funder_name, d.funder_client_id, d.token, d.sessions,
             coalesce(nullif(btrim(a.payload->>'destinataire'), ''), d.contact_email) as destinataire
      from public.funder_feedback d
      join public.scheduled_actions a on a.company_id = d.company_id and a.dedup_key = 'avis_financeur:' || d.id
      where d.company_id = v_cie.id and d.answered_at is null and d.expires_at > now() + interval '10 days'
        and a.status = 'envoye' and a.sent_at <= now() - interval '15 days'
        and not exists (select 1 from public.scheduled_actions r where r.company_id = d.company_id and r.dedup_key = 'avis_financeur_relance:' || d.id)
    loop
      v_n := jsonb_array_length(v_r.sessions);
      insert into public.scheduled_actions (company_id, kind, target_table, target_id, client_id, due_on, title, payload, dedup_key)
      values (v_cie.id, 'avis_financeur', 'funder_feedback', v_r.id, v_r.funder_client_id, (now() at time zone 'Europe/Paris')::date,
              left('Relance, avis du financeur ' || v_r.year || ' : ' || v_r.funder_name, 255),
              jsonb_build_object('destinataire', v_r.destinataire, 'objet', 'Rappel : votre avis sur nos formations ' || v_r.year,
                                 'texte', app.avis_financeur_texte(true, v_org, v_r.year, v_n, v_url || '/#/avis-financeur/' || v_r.token)),
              'avis_financeur_relance:' || v_r.id)
      on conflict (company_id, dedup_key) do nothing;
      v_relances := v_relances + 1;
    end loop;
  end loop;
  return jsonb_build_object('demandes', v_demandes, 'relances', v_relances);
end
$$;
revoke all on function public.financeurs_avis_preparer() from public, anon, authenticated;
grant execute on function public.financeurs_avis_preparer() to service_role;

-- ── 5. Suivi pour l'écran ──
-- { financeurs: [...], sans_financeur: [...] } : sans_financeur = sessions de l'année marquées financées (type de
-- financement de la session) sans aucun financeur renseigné, que la nuit ne peut pas traiter
create or replace function public.financeurs_suivi(p_annee int default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_annee int := coalesce(p_annee, extract(year from (now() at time zone 'Europe/Paris'))::int);
  v_ouverte boolean := v_annee = any (app.financeurs_annees_ouvertes());
begin
  if (select auth.uid()) is null then raise exception 'Connexion requise' using errcode = '42501'; end if;
  return jsonb_build_object('annee', v_annee, 'annee_ouverte', v_ouverte, 'financeurs', coalesce((
    select jsonb_agg(jsonb_build_object(
      'company_id', x.company_id, 'cle', x.funder_key, 'type', x.funder_type, 'nom', x.funder_name,
      'client_id', x.funder_client_id, 'email', x.contact_email, 'email_valide', app.financeur_email_valide(x.contact_email),
      'sessions', x.sessions, 'sessions_terminees', x.sessions_terminees,
      'demande', d.etat, 'repondu_le', d.answered_at, 'note', d.note_globale,
      'echanges', coalesce(e.n, 0), 'dernier_echange', e.dernier,
      'couvert', coalesce(d.etat in ('envoyee', 'expiree', 'repondue'), false) or coalesce(e.n, 0) > 0,
      'preparable', v_ouverte and d.etat is null and coalesce(e.n, 0) = 0 and x.funder_type in ('opco', 'region', 'autre')
                    and x.sessions_terminees > 0 and app.financeur_email_valide(x.contact_email)
    ) order by x.funder_name)
    from (select c.id as company_id, f.* from public.companies c
            cross join lateral app.financeurs_de_l_annee(c.id, v_annee) f
           where c.id in (select app.visible_companies())) x
    left join lateral (
      select dd.answered_at, dd.note_globale,
             -- Lien expiré : seulement après l'envoi (avant, il repart pour 90 jours à la validation)
             case when dd.answered_at is not null then 'repondue'
                  when exists (select 1 from public.scheduled_actions a where a.company_id = dd.company_id and a.target_id = dd.id and a.kind = 'avis_financeur' and a.status = 'envoye')
                    then case when dd.expires_at <= now() then 'expiree' else 'envoyee' end
                  when exists (select 1 from public.scheduled_actions a where a.company_id = dd.company_id and a.target_id = dd.id and a.kind = 'avis_financeur' and a.status = 'valide') then 'validee'
                  when exists (select 1 from public.scheduled_actions a where a.company_id = dd.company_id and a.target_id = dd.id and a.kind = 'avis_financeur' and a.status = 'a_valider') then 'preparee'
                  else 'ignoree' end as etat
      from public.funder_feedback dd
      where dd.company_id = x.company_id and dd.funder_key = x.funder_key and dd.year = v_annee
    ) d on true
    left join lateral (
      select count(*)::int as n, max(ee.happened_on) as dernier from public.funder_exchanges ee
      where ee.company_id = x.company_id and extract(year from ee.happened_on)::int = v_annee
        and app.financeur_cle(ee.company_id, ee.funder_type, ee.funder_client_id, ee.funder_name) = x.funder_key
    ) e on true
  ), '[]'::jsonb), 'sans_financeur', coalesce((
    select jsonb_agg(jsonb_build_object('company_id', s.company_id, 'id', s.id, 'reference', s.reference, 'titre', co.title,
                                        'fin', coalesce(s.end_date, s.start_date), 'funding_type', s.funding_type)
                     order by coalesce(s.end_date, s.start_date))
    from public.sessions s left join public.courses co on co.id = s.course_id
    where s.company_id in (select app.visible_companies())
      and s.status is distinct from 'cancelled'
      and extract(year from coalesce(s.end_date, s.start_date))::int = v_annee
      and nullif(btrim(coalesce(s.funding_type, '')), '') is not null and s.funding_type not in ('none', 'direct')
      and not exists (select 1 from public.session_fundings sf where sf.session_id = s.id and sf.funder_type <> 'entreprise'
                        and sf.status not in ('refused', 'cancelled'))
  ), '[]'::jsonb));
end
$$;
revoke all on function public.financeurs_suivi(int) from public, anon;
grant execute on function public.financeurs_suivi(int) to authenticated;


-- ── 6. Page publique du lien ──
create or replace function app.financeur_avis_lire(p_token text)
returns public.funder_feedback
language plpgsql
stable
security definer
set search_path = ''
as $$
declare d public.funder_feedback;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{48}$' then
    raise exception 'Lien invalide' using errcode = '22023';
  end if;
  select * into d from public.funder_feedback x where x.token = p_token;
  -- Lien actif seulement une fois la relance validée ou envoyée par l'organisme
  if d.id is null or not exists (select 1 from public.scheduled_actions a where a.company_id = d.company_id and a.target_id = d.id
                                   and a.kind = 'avis_financeur' and a.status in ('valide', 'envoye')) then
    raise exception 'Lien invalide ou retiré' using errcode = '22023';
  end if;
  return d;
end
$$;
revoke all on function app.financeur_avis_lire(text) from public, anon, authenticated;

create or replace function public.financeur_avis_ouvrir(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d public.funder_feedback;
begin
  begin
    d := app.financeur_avis_lire(p_token);
  exception when sqlstate '22023' then
    return jsonb_build_object('error', sqlerrm);
  end;
  return jsonb_build_object(
    'organisme', (select coalesce(nullif(btrim(c.short_name), ''), c.legal_name) from public.companies c where c.id = d.company_id),
    'financeur', d.funder_name, 'annee', d.year,
    'sessions', coalesce((select jsonb_agg(jsonb_build_object('titre', s->>'titre', 'debut', s->>'debut', 'fin', s->>'fin') order by s->>'debut')
                          from jsonb_array_elements(d.sessions) s), '[]'::jsonb),
    'repondu', d.answered_at is not null, 'expire', d.answered_at is null and d.expires_at <= now(),
    'valable_jusqu_au', to_char(d.expires_at at time zone 'Europe/Paris', 'YYYY-MM-DD'));
end
$$;
revoke all on function public.financeur_avis_ouvrir(text) from public;
grant execute on function public.financeur_avis_ouvrir(text) to anon, authenticated;

create or replace function public.financeur_avis_repondre(p_token text, p_reponses jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.funder_feedback;
  v_note int;
  n text;
begin
  begin
    d := app.financeur_avis_lire(p_token);
  exception when sqlstate '22023' then
    return jsonb_build_object('error', sqlerrm);
  end;
  if d.answered_at is not null then return jsonb_build_object('error', 'Votre avis a déjà été enregistré. Merci.'); end if;
  if d.expires_at <= now() then return jsonb_build_object('error', 'Ce lien a expiré. Vous pouvez répondre directement à l''e-mail reçu.'); end if;
  if p_reponses is null or jsonb_typeof(p_reponses) <> 'object' then return jsonb_build_object('error', 'Réponses absentes'); end if;
  if coalesce(p_reponses->>'note_globale', '') !~ '^[1-5]$' then return jsonb_build_object('error', 'Note globale requise (de 1 à 5)'); end if;
  v_note := (p_reponses->>'note_globale')::int;
  foreach n in array array['q_information', 'q_administratif', 'q_qualite', 'q_relation'] loop
    if p_reponses ? n and jsonb_typeof(p_reponses->n) <> 'null' and coalesce(p_reponses->>n, '') !~ '^[1-5]$' then
      return jsonb_build_object('error', 'Note invalide');
    end if;
  end loop;
  update public.funder_feedback x
     set answered_at = now(), note_globale = v_note,
         q_information = nullif(p_reponses->>'q_information', '')::smallint, q_administratif = nullif(p_reponses->>'q_administratif', '')::smallint,
         q_qualite = nullif(p_reponses->>'q_qualite', '')::smallint, q_relation = nullif(p_reponses->>'q_relation', '')::smallint,
         commentaire = nullif(btrim(left(coalesce(p_reponses->>'commentaire', ''), 2000)), ''), updated_at = now()
   where x.id = d.id and x.answered_at is null;
  if not found then return jsonb_build_object('error', 'Votre avis a déjà été enregistré. Merci.'); end if;
  insert into public.notifications (type, title, message, link, company_id, metadata)
  values ('avis_financeur', left('Avis du financeur : ' || d.funder_name || ' (' || d.year || ')', 255),
          format('Note globale : %s sur 5', v_note), '/certification', d.company_id,
          jsonb_build_object('funder_feedback_id', d.id));
  return jsonb_build_object('ok', true);
end
$$;
revoke all on function public.financeur_avis_repondre(text, jsonb) from public;
grant execute on function public.financeur_avis_repondre(text, jsonb) to anon, authenticated;

-- ── Droits ──
alter table public.funder_feedback enable row level security;
revoke all on table public.funder_feedback from public, anon, authenticated;
-- Le jeton n'est pas lisible par les comptes (sinon n'importe quel compte de la société pourrait répondre à la place du
-- financeur) : il n'apparaît que dans le texte de la relance, pour qui la valide
grant select (id, company_id, year, funder_key, funder_type, funder_name, funder_client_id, contact_email, sessions, expires_at,
  answered_at, note_globale, q_information, q_administratif, q_qualite, q_relation, commentaire, created_at, updated_at)
  on table public.funder_feedback to authenticated;
grant all on table public.funder_feedback to service_role;
drop policy if exists funder_feedback_lire on public.funder_feedback;
create policy funder_feedback_lire on public.funder_feedback for select to authenticated
  using (company_id in (select app.visible_companies()));

alter table public.funder_exchanges enable row level security;
revoke all on table public.funder_exchanges from public, anon;
grant select, insert, update, delete on table public.funder_exchanges to authenticated;
grant all on table public.funder_exchanges to service_role;
do $$
declare t text := 'funder_exchanges';
begin
  execute format('drop policy if exists %I on public.%I', t || '_lire', t);
  execute format('drop policy if exists %I on public.%I', t || '_creer', t);
  execute format('drop policy if exists %I on public.%I', t || '_modifier', t);
  execute format('drop policy if exists %I on public.%I', t || '_supprimer', t);
  execute format('create policy %I on public.%I for select to authenticated using (company_id in (select app.visible_companies()))', t || '_lire', t);
  execute format('create policy %I on public.%I for insert to authenticated with check (company_id in (select app.societes_avec_droit(%L)))', t || '_creer', t, 'qualite.certification.gerer');
  execute format('create policy %I on public.%I for update to authenticated using (company_id in (select app.societes_avec_droit(%L))) with check (company_id in (select app.societes_avec_droit(%L)))', t || '_modifier', t, 'qualite.certification.gerer', 'qualite.certification.gerer');
  execute format('create policy %I on public.%I for delete to authenticated using (company_id in (select app.societes_avec_droit(%L)))', t || '_supprimer', t, 'qualite.certification.gerer');
end $$;

select app.vue_groupe_poser();

insert into public.schema_migrations (version) values ('0517_avis_financeurs') on conflict (version) do nothing;
