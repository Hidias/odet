-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (cd_0455) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0455_circuit_documents.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0455_circuit_documents_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0455_circuit_documents.sql =====
-- 0455 : circuit de validation des documents (pilotage de H du 24/10, 13 h 37 à 13 h 39). Un document (conditions
-- générales, contrats, documents qualité) suit une boucle : rédaction, relecture par des personnes de l'entreprise
-- (valider, modifier, commenter, répondre aux questions ouvertes), arbitrage par la direction, vérification par un
-- expert (avocat, juriste, expert-comptable, comptable : selon l'entreprise), retour arbitré, version validée, revue.
-- Chaque entreprise choisit son circuit, document par document :
--   « direct » (la direction valide seule, comme avant), « interne » (relecture sans expert), « complet » (avec expert).
-- Aucun relecteur ni expert ne valide : seule une personne qui a le droit de valider les documents le fait. Tant que la
-- version n'est pas validée, rien ne change dans les devis.
--   1. doc_review_settings : circuit par défaut et par document, par société (défaut « direct » : rien ne change).
--   2. doc_reviews : un circuit en cours ou passé pour un document (contenu proposé, état, tour).
--   3. doc_review_participants : personnes de l'entreprise invitées à relire.
--   4. doc_review_items : avis par article (validation, modification proposée, commentaire), questions ouvertes et
--      réponses ; décision de la direction (acceptée, refusée, close).
--   5. Gardes : passages d'état, avis écrits par leur auteur seulement, décision par qui valide ; la version d'un
--      document dont le circuit n'est pas « direct » ne se valide que depuis son circuit arbitré (et relu par l'expert
--      en mode « complet »), avec exactement le contenu arbitré.
--   6. Fonctions : public.relecteurs_possibles, public.doc_review_decider, notifications à chaque étape.
-- L'espace de l'expert (lien et code) viendra ensuite ; d'ici là, son retour passe par le fichier relu (mode dégradé).
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0455_circuit_documents_retour.sql

-- ── 1. Réglages ──
create table if not exists public.doc_review_settings (
  company_id uuid primary key default app.company_default() references public.companies(id) on delete cascade,
  default_mode text not null default 'direct' check (default_mode in ('direct', 'interne', 'complet')),
  per_doc jsonb not null default '{}'::jsonb check (jsonb_typeof(per_doc) = 'object'),
  expert_label text check (expert_label is null or length(expert_label) <= 80),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
comment on table public.doc_review_settings is 'Circuit de validation des documents par société : direct, relecture interne, ou relecture et expert ; per_doc = { doc_id: mode }';

create or replace function app.doc_review_mode(p_company uuid, p_doc_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select case when s.per_doc ? p_doc_id and s.per_doc->>p_doc_id in ('direct', 'interne', 'complet') then s.per_doc->>p_doc_id else s.default_mode end
     from public.doc_review_settings s where s.company_id = p_company),
    'direct')
$$;
revoke all on function app.doc_review_mode(uuid, text) from public, anon;
grant execute on function app.doc_review_mode(uuid, text) to authenticated;

-- Réglage du circuit de la société en cours (droits de l'appelant : qui valide les documents) ; p_per_doc fusionné,
-- une valeur nulle retire le réglage propre au document
create or replace function public.doc_review_regler(p_default_mode text default null, p_per_doc jsonb default null)
returns public.doc_review_settings
language plpgsql
security invoker
set search_path = ''
as $$
declare v public.doc_review_settings;
begin
  if p_default_mode is not null and p_default_mode not in ('direct', 'interne', 'complet') then
    raise exception 'Circuit inconnu' using errcode = '22023';
  end if;
  if p_per_doc is not null and (jsonb_typeof(p_per_doc) <> 'object' or exists (
      select 1 from jsonb_each(p_per_doc) e where jsonb_typeof(e.value) <> 'null' and e.value #>> '{}' not in ('direct', 'interne', 'complet'))) then
    raise exception 'Circuit inconnu' using errcode = '22023';
  end if;
  insert into public.doc_review_settings as s (company_id, default_mode, per_doc)
  values (app.company_default(), coalesce(p_default_mode, 'direct'), jsonb_strip_nulls(coalesce(p_per_doc, '{}'::jsonb)))
  on conflict (company_id) do update
    set default_mode = coalesce(p_default_mode, s.default_mode),
        per_doc = case when p_per_doc is null then s.per_doc else jsonb_strip_nulls(s.per_doc || p_per_doc) end,
        updated_at = now(), updated_by = (select auth.uid())
  returning * into v;
  return v;
end
$$;
revoke all on function public.doc_review_regler(text, jsonb) from public, anon;
grant execute on function public.doc_review_regler(text, jsonb) to authenticated;

-- ── 2. Circuits ──
create table if not exists public.doc_reviews (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  doc_id varchar(50) not null,
  doc_name text not null check (length(btrim(doc_name)) between 2 and 255),
  base_version int not null default 0,
  content jsonb not null check (jsonb_typeof(content->'sections') = 'array'),
  mode text not null check (mode in ('interne', 'complet')),
  status text not null default 'relecture' check (status in ('relecture', 'arbitrage', 'expert', 'validee', 'abandonnee')),
  round int not null default 1 check (round between 1 and 50),
  message text check (message is null or length(message) <= 2000),
  due_on date,
  expert_label text check (expert_label is null or length(expert_label) <= 120),
  expert_sent_at timestamptz,
  expert_returned_at timestamptz,
  validated_version int,
  created_by uuid default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists doc_reviews_company_idx on public.doc_reviews (company_id, doc_id, created_at desc);
-- Un seul circuit ouvert par document et par société
create unique index if not exists doc_reviews_ouvert_uniq on public.doc_reviews (company_id, doc_id) where status in ('relecture', 'arbitrage', 'expert');
comment on table public.doc_reviews is 'Circuit de validation d''un document : contenu proposé, état (relecture, arbitrage, expert, validée, abandonnée), tour';

create table if not exists public.doc_review_participants (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  review_id uuid not null references public.doc_reviews(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  profile_name text,
  invited_by uuid default auth.uid(),
  invited_at timestamptz not null default now(),
  done_at timestamptz,
  constraint doc_review_participants_uniq unique (review_id, profile_id)
);
create index if not exists doc_review_participants_profile_idx on public.doc_review_participants (profile_id);
create index if not exists doc_review_participants_company_idx on public.doc_review_participants (company_id);
comment on table public.doc_review_participants is 'Personnes de l''entreprise invitées à relire un document ; done_at = relecture terminée pour le tour en cours';

create table if not exists public.doc_review_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  review_id uuid not null references public.doc_reviews(id) on delete cascade,
  round int not null default 1,
  section_id text check (section_id is null or length(section_id) <= 80),
  parent_id uuid references public.doc_review_items(id) on delete cascade,
  kind text not null check (kind in ('validation', 'modification', 'commentaire', 'question', 'reponse')),
  author_id uuid default auth.uid(),
  author_name text,
  author_quality text not null default 'interne' check (author_quality in ('interne', 'expert', 'modele')),
  author_label text check (author_label is null or length(author_label) <= 160),
  text text check (text is null or length(text) <= 5000),
  proposed jsonb,
  base jsonb,
  choices text[],
  choice text check (choice is null or length(choice) <= 200),
  status text not null default 'ouverte' check (status in ('ouverte', 'acceptee', 'refusee', 'close', 'retiree')),
  decided_by uuid,
  decided_name text,
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 2000),
  created_at timestamptz not null default now(),
  constraint doc_review_items_modification check (kind <> 'modification' or (proposed is not null and jsonb_typeof(proposed->'blocks') = 'array')),
  constraint doc_review_items_question check (kind <> 'question' or (choices is not null and array_length(choices, 1) between 2 and 6 and length(btrim(coalesce(text, ''))) >= 3)),
  constraint doc_review_items_reponse check (kind <> 'reponse' or parent_id is not null)
);
create index if not exists doc_review_items_review_idx on public.doc_review_items (review_id, created_at);
create index if not exists doc_review_items_company_idx on public.doc_review_items (company_id);
comment on table public.doc_review_items is 'Avis de relecture par article (validation, modification, commentaire), questions ouvertes et réponses, avec la décision de la direction';

-- ── Accès ──
create or replace function app.mes_relectures()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.review_id from public.doc_review_participants p where p.profile_id = (select auth.uid())
$$;
revoke all on function app.mes_relectures() from public, anon;
grant execute on function app.mes_relectures() to authenticated;

create or replace function app.peut_valider_docs(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_company in (select app.societes_avec_droit('qualite.documents.valider')), false)
$$;
revoke all on function app.peut_valider_docs(uuid) from public, anon;
grant execute on function app.peut_valider_docs(uuid) to authenticated;

create or replace function app.peut_gerer_docs(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_company in (select app.societes_avec_droit('qualite.documents.gerer'))
              or p_company in (select app.societes_avec_droit('qualite.documents.valider')), false)
$$;
revoke all on function app.peut_gerer_docs(uuid) from public, anon;
grant execute on function app.peut_gerer_docs(uuid) to authenticated;

-- Nom affiché d'un compte : app.nom_profil (0407), repris tel quel

-- ── 5. Gardes ──
create or replace function app.doc_review_garde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_valide boolean := current_setting('app.circuit_valide', true) = new.id::text;
  v_titre text;
begin
  if tg_op = 'INSERT' then
    if not app.peut_gerer_docs(new.company_id) then
      raise exception 'Lancer une relecture demande le droit de gérer les documents' using errcode = '42501';
    end if;
    if new.status <> 'relecture' then raise exception 'Un circuit commence par la relecture' using errcode = '23514'; end if;
    new.created_by := v_uid;
    new.created_by_name := app.nom_profil(v_uid);
    new.round := 1;
    new.validated_version := null; new.closed_at := null; new.expert_sent_at := null; new.expert_returned_at := null;
    return new;
  end if;

  if (new.company_id, new.doc_id, new.base_version, new.mode, new.created_by, new.created_at)
     is distinct from (old.company_id, old.doc_id, old.base_version, old.mode, old.created_by, old.created_at) then
    raise exception 'Le document, le circuit et l''auteur d''une relecture ne changent pas' using errcode = '42501';
  end if;
  if old.status in ('validee', 'abandonnee') then
    raise exception 'Ce circuit est clos : lancez-en un nouveau' using errcode = '23514';
  end if;

  -- Contenu : modifié seulement pendant l'arbitrage, par qui valide
  if new.content is distinct from old.content and not (old.status = 'arbitrage' and new.status = 'arbitrage' and app.peut_valider_docs(old.company_id)) then
    raise exception 'Le texte ne change que pendant l''arbitrage, par une personne qui valide les documents' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if new.status = 'validee' then
      if not v_valide then raise exception 'La version se valide depuis le circuit, après l''arbitrage' using errcode = '42501'; end if;
    elsif new.status = 'abandonnee' then
      if not (app.peut_valider_docs(old.company_id) or old.created_by = v_uid) then
        raise exception 'Abandonner le circuit : son auteur ou une personne qui valide les documents' using errcode = '42501';
      end if;
      new.closed_at := now();
    elsif old.status = 'relecture' and new.status = 'arbitrage' then
      if not app.peut_valider_docs(old.company_id) then raise exception 'Seule une personne qui valide les documents passe à l''arbitrage' using errcode = '42501'; end if;
    elsif old.status = 'arbitrage' and new.status = 'relecture' then
      if not app.peut_valider_docs(old.company_id) then raise exception 'Seule une personne qui valide les documents renvoie en relecture' using errcode = '42501'; end if;
      new.round := old.round + 1;
      update public.doc_review_participants set done_at = null where review_id = old.id;
    elsif old.status = 'arbitrage' and new.status = 'expert' then
      if not app.peut_valider_docs(old.company_id) then raise exception 'Seule une personne qui valide les documents envoie à l''expert' using errcode = '42501'; end if;
      if old.mode <> 'complet' then raise exception 'Ce document ne passe pas par un expert' using errcode = '23514'; end if;
      if exists (select 1 from public.doc_review_items i where i.review_id = old.id and i.status = 'ouverte' and i.kind in ('modification', 'question')) then
        raise exception 'Tranchez d''abord les modifications et les questions ouvertes' using errcode = '23514';
      end if;
      new.expert_sent_at := now();
      new.round := old.round + 1;
    elsif old.status = 'expert' and new.status = 'arbitrage' then
      if not app.peut_gerer_docs(old.company_id) then raise exception 'Le retour de l''expert est enregistré par l''équipe qui gère les documents' using errcode = '42501'; end if;
      new.expert_returned_at := now();
    else
      raise exception 'Passage impossible de « % » à « % »', old.status, new.status using errcode = '23514';
    end if;
  end if;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function app.doc_review_garde() from public, anon, authenticated;
drop trigger if exists doc_reviews_garde on public.doc_reviews;
create trigger doc_reviews_garde before insert or update on public.doc_reviews for each row execute function app.doc_review_garde();

-- Notification à chaque étape (visible de l'équipe de la société)
create or replace function app.doc_review_notifier()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_t text; v_m text;
begin
  if tg_op = 'INSERT' then
    v_t := 'Relecture demandée : ' || new.doc_name;
    v_m := coalesce(new.created_by_name, 'Un membre de l''équipe') || ' demande une relecture' || coalesce(' avant le ' || to_char(new.due_on, 'DD/MM/YYYY'), '') || '.';
  elsif new.status is distinct from old.status then
    v_t := case new.status
      when 'arbitrage' then case when old.status = 'expert' then 'Retour de l''expert : ' else 'À arbitrer : ' end
      when 'relecture' then 'Nouvelle relecture : '
      when 'expert' then 'Envoyé à l''expert : '
      when 'validee' then 'Version validée : '
      else 'Relecture abandonnée : ' end || new.doc_name;
    v_m := case new.status when 'validee' then 'Version ' || coalesce(new.validated_version::text, '') || ' en vigueur.' when 'relecture' then 'Tour ' || new.round || ' de relecture.' else null end;
  else
    return null;
  end if;
  insert into public.notifications (company_id, type, title, message, link, metadata)
  values (new.company_id, 'document_relecture', left(v_t, 255), v_m, '/relectures/' || new.id, jsonb_build_object('review_id', new.id, 'doc_id', new.doc_id, 'status', new.status));
  return null;
end
$$;
revoke all on function app.doc_review_notifier() from public, anon, authenticated;
drop trigger if exists doc_reviews_notifier on public.doc_reviews;
create trigger doc_reviews_notifier after insert or update of status on public.doc_reviews for each row execute function app.doc_review_notifier();

create or replace function app.doc_review_participant_garde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare r public.doc_reviews;
begin
  select * into r from public.doc_reviews where id = coalesce(new.review_id, old.review_id);
  if tg_op = 'DELETE' then
    if not app.peut_gerer_docs(old.company_id) then raise exception 'Retirer un relecteur demande le droit de gérer les documents' using errcode = '42501'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if r.status not in ('relecture', 'arbitrage') then raise exception 'Ce circuit n''accepte plus de relecteur' using errcode = '23514'; end if;
    if not app.peut_gerer_docs(r.company_id) then raise exception 'Inviter un relecteur demande le droit de gérer les documents' using errcode = '42501'; end if;
    if not exists (select 1 from public.profiles p where p.id = new.profile_id and coalesce(p.is_active, true)
                     and p.role not in ('entreprise', 'formateur_externe', 'stagiaire')) then
      raise exception 'Relecteur inconnu ou hors de l''équipe' using errcode = '22023';
    end if;
    new.company_id := r.company_id;
    new.profile_name := app.nom_profil(new.profile_id);
    new.invited_by := (select auth.uid());
    new.done_at := null;
    return new;
  end if;
  if (new.review_id, new.profile_id, new.profile_name, new.company_id, new.invited_by, new.invited_at) is distinct from (old.review_id, old.profile_id, old.profile_name, old.company_id, old.invited_by, old.invited_at) then
    raise exception 'Seule la fin de relecture se note' using errcode = '42501';
  end if;
  if new.done_at is distinct from old.done_at and pg_trigger_depth() <= 1 and old.profile_id <> (select auth.uid()) then
    raise exception 'Chacun note la fin de sa propre relecture' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function app.doc_review_participant_garde() from public, anon, authenticated;
drop trigger if exists doc_review_participants_garde on public.doc_review_participants;
create trigger doc_review_participants_garde before insert or update or delete on public.doc_review_participants for each row execute function app.doc_review_participant_garde();

create or replace function app.doc_review_item_garde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.doc_reviews;
  v_uid uuid := (select auth.uid());
  v_part boolean;
  v_q public.doc_review_items;
begin
  select * into r from public.doc_reviews where id = coalesce(new.review_id, old.review_id);
  if tg_op = 'INSERT' then
    if r.id is null then raise exception 'Circuit introuvable' using errcode = 'P0002'; end if;
    v_part := exists (select 1 from public.doc_review_participants p where p.review_id = r.id and p.profile_id = v_uid);
    new.company_id := r.company_id;
    new.round := r.round;
    new.author_id := v_uid;
    new.author_name := app.nom_profil(v_uid);
    new.status := 'ouverte';
    new.decided_by := null; new.decided_name := null; new.decided_at := null; new.decision_note := null;
    if new.author_quality = 'expert' then
      -- Retour de l'expert par fichier relu (mode dégradé) : saisi par l'équipe qui gère les documents
      if not (r.status = 'expert' and app.peut_gerer_docs(r.company_id)) then
        raise exception 'Le retour de l''expert s''enregistre pendant l''étape « chez l''expert »' using errcode = '42501';
      end if;
      if new.kind not in ('modification', 'commentaire', 'validation') then raise exception 'Avis de l''expert inconnu' using errcode = '22023'; end if;
    elsif new.author_quality = 'modele' then
      if not (r.status in ('relecture', 'arbitrage') and app.peut_gerer_docs(r.company_id)) then
        raise exception 'Proposition du modèle refusée' using errcode = '42501';
      end if;
      if new.kind <> 'modification' then raise exception 'Le modèle ne propose que des modifications' using errcode = '22023'; end if;
    else
      if new.kind = 'question' then
        if not (r.status in ('relecture', 'arbitrage') and app.peut_gerer_docs(r.company_id)) then
          raise exception 'Une question ouverte est posée par l''équipe qui gère les documents' using errcode = '42501';
        end if;
      elsif not ((r.status = 'relecture' and (v_part or app.peut_gerer_docs(r.company_id)))
              or (r.status = 'arbitrage' and app.peut_valider_docs(r.company_id) and new.kind = 'commentaire')) then
        raise exception 'Vous n''êtes pas relecteur de ce document, ou la relecture est close' using errcode = '42501';
      end if;
    end if;
    if new.kind = 'reponse' then
      select * into v_q from public.doc_review_items where id = new.parent_id;
      if v_q.id is null or v_q.review_id <> r.id or v_q.kind <> 'question' or v_q.status <> 'ouverte' then
        raise exception 'Question introuvable ou close' using errcode = '22023';
      end if;
      if new.choice is not null and not (new.choice = any (v_q.choices)) then raise exception 'Réponse hors des choix proposés' using errcode = '22023'; end if;
      if new.choice is null and length(btrim(coalesce(new.text, ''))) < 2 then raise exception 'Choisissez une réponse ou écrivez-la' using errcode = '22023'; end if;
      new.section_id := v_q.section_id;
    end if;
    if new.kind = 'commentaire' and length(btrim(coalesce(new.text, ''))) < 2 then raise exception 'Écrivez votre commentaire' using errcode = '22023'; end if;
    -- Texte de l'article au moment de l'avis, pour la comparaison mot à mot
    if new.section_id is not null then
      new.base := (select s from jsonb_array_elements(r.content->'sections') s where s->>'id' = new.section_id limit 1);
    end if;
    return new;
  end if;

  -- Le choix retenu d'une question se pose seulement à l'arbitrage (doc_review_decider)
  if new.choice is distinct from old.choice and not (old.kind = 'question' and current_setting('app.circuit_decision', true) = old.id::text) then
    raise exception 'Un avis déposé ne se modifie pas : retirez-le et déposez-en un autre' using errcode = '42501';
  end if;
  if (new.review_id, new.round, new.section_id, new.parent_id, new.kind, new.author_id, new.author_name, new.author_quality, new.author_label,
      new.text, new.proposed, new.base, new.choices, new.created_at, new.company_id)
     is distinct from (old.review_id, old.round, old.section_id, old.parent_id, old.kind, old.author_id, old.author_name, old.author_quality, old.author_label,
      old.text, old.proposed, old.base, old.choices, old.created_at, old.company_id) then
    raise exception 'Un avis déposé ne se modifie pas : retirez-le et déposez-en un autre' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if old.status <> 'ouverte' then raise exception 'Cet avis est déjà tranché' using errcode = '23514'; end if;
    if new.status = 'retiree' then
      if old.author_id <> v_uid then raise exception 'Seul son auteur retire un avis' using errcode = '42501'; end if;
    elsif current_setting('app.circuit_decision', true) is distinct from old.id::text then
      raise exception 'La décision passe par l''arbitrage' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
revoke all on function app.doc_review_item_garde() from public, anon, authenticated;
drop trigger if exists doc_review_items_garde on public.doc_review_items;
create trigger doc_review_items_garde before insert or update on public.doc_review_items for each row execute function app.doc_review_item_garde();

-- Arbitrage d'un avis : acceptée (la modification remplace l'article), refusée, ou question close sur un choix
create or replace function public.doc_review_decider(p_item uuid, p_decision text, p_note text default null, p_choice text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.doc_review_items;
  r public.doc_reviews;
  v_sections jsonb;
  v_uid uuid := (select auth.uid());
begin
  select * into i from public.doc_review_items where id = p_item;
  if i.id is null then raise exception 'Avis introuvable' using errcode = 'P0002'; end if;
  select * into r from public.doc_reviews where id = i.review_id;
  if not app.peut_valider_docs(r.company_id) then raise exception 'L''arbitrage revient à une personne qui valide les documents' using errcode = '42501'; end if;
  if r.status <> 'arbitrage' then raise exception 'Passez d''abord le circuit à l''arbitrage' using errcode = '23514'; end if;
  if i.status <> 'ouverte' then raise exception 'Cet avis est déjà tranché' using errcode = '23514'; end if;
  if p_decision not in ('acceptee', 'refusee', 'close') then raise exception 'Décision inconnue' using errcode = '22023'; end if;
  if i.kind = 'question' then
    if p_decision <> 'close' or p_choice is null or not (p_choice = any (i.choices)) then
      raise exception 'Choisissez la réponse retenue parmi les choix proposés' using errcode = '22023';
    end if;
  elsif i.kind = 'modification' then
    if p_decision not in ('acceptee', 'refusee') then raise exception 'Acceptez ou refusez la modification' using errcode = '22023'; end if;
    if p_decision = 'refusee' and length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Indiquez pourquoi la modification est refusée' using errcode = '23514'; end if;
  else
    if p_decision <> 'close' then raise exception 'Un commentaire ou une validation se clôt' using errcode = '22023'; end if;
  end if;

  if i.kind = 'modification' and p_decision = 'acceptee' then
    if exists (select 1 from jsonb_array_elements(r.content->'sections') s where s->>'id' = i.section_id) then
      select jsonb_agg(case when s->>'id' = i.section_id then s || jsonb_build_object('title', coalesce(i.proposed->>'title', s->>'title'), 'blocks', i.proposed->'blocks') else s end order by n)
      into v_sections from jsonb_array_elements(r.content->'sections') with ordinality as t(s, n);
    else
      v_sections := (r.content->'sections') || jsonb_build_array(jsonb_build_object('id', coalesce(i.section_id, 's-' || left(md5(i.id::text), 8)),
        'title', coalesce(i.proposed->>'title', 'Nouvel article'), 'blocks', i.proposed->'blocks') || coalesce(i.proposed->'extra', '{}'::jsonb));
    end if;
    update public.doc_reviews set content = jsonb_set(content, '{sections}', v_sections) where id = r.id;
  end if;

  perform set_config('app.circuit_decision', i.id::text, true);
  update public.doc_review_items set status = p_decision, decided_by = v_uid, decided_name = app.nom_profil(v_uid), decided_at = now(),
    decision_note = nullif(btrim(coalesce(p_note, '')), ''), choice = case when i.kind = 'question' then p_choice else choice end
  where id = i.id;
  perform set_config('app.circuit_decision', '', true);
  -- Les réponses à une question close sont closes avec elle
  if i.kind = 'question' then
    for i in select * from public.doc_review_items where parent_id = p_item and status = 'ouverte' loop
      perform set_config('app.circuit_decision', i.id::text, true);
      update public.doc_review_items set status = 'close', decided_by = v_uid, decided_name = app.nom_profil(v_uid), decided_at = now() where id = i.id;
    end loop;
    perform set_config('app.circuit_decision', '', true);
  end if;
  return jsonb_build_object('ok', true);
end
$$;
revoke all on function public.doc_review_decider(uuid, text, text, text) from public, anon;
grant execute on function public.doc_review_decider(uuid, text, text, text) to authenticated;

-- Version d'un document : depuis son circuit arbitré quand le circuit de ce document n'est pas « direct »
create or replace function app.doc_version_par_circuit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text := app.doc_review_mode(new.company_id, new.doc_id);
  r public.doc_reviews;
begin
  if v_mode = 'direct' then return new; end if;
  select * into r from public.doc_reviews where company_id = new.company_id and doc_id = new.doc_id and status = 'arbitrage' limit 1;
  if r.id is null then
    raise exception 'Ce document se valide par son circuit (relecture%) : lancez la relecture', case when v_mode = 'complet' then ' puis expert' else '' end using errcode = '23514';
  end if;
  if exists (select 1 from public.doc_review_items i where i.review_id = r.id and i.status = 'ouverte' and i.kind in ('modification', 'question')) then
    raise exception 'Des modifications ou des questions sont encore ouvertes' using errcode = '23514';
  end if;
  if r.mode = 'complet' and r.expert_returned_at is null then
    raise exception 'Ce document doit d''abord être vérifié par l''expert' using errcode = '23514';
  end if;
  if (new.content->'sections') is distinct from (r.content->'sections') then
    raise exception 'La version validée doit être exactement le texte arbitré' using errcode = '23514';
  end if;
  perform set_config('app.circuit_valide', r.id::text, true);
  update public.doc_reviews set status = 'validee', validated_version = new.version, closed_at = now() where id = r.id;
  perform set_config('app.circuit_valide', '', true);
  return new;
end
$$;
revoke all on function app.doc_version_par_circuit() from public, anon, authenticated;
drop trigger if exists quality_doc_versions_circuit on public.quality_doc_versions;
create trigger quality_doc_versions_circuit before insert on public.quality_doc_versions for each row execute function app.doc_version_par_circuit();

-- Personnes de l'équipe qui peuvent relire (comptes internes actifs de la société en cours)
create or replace function public.relecteurs_possibles()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_co uuid := app.current_company();
begin
  if not app.peut_gerer_docs(v_co) then raise exception 'Droit de gérer les documents nécessaire' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'nom', app.nom_profil(p.id), 'role', coalesce(m.role, p.role), 'fonction', p.fonction) order by app.nom_profil(p.id))
    from public.profiles p
    left join public.company_members m on m.profile_id = p.id and m.company_id = v_co and m.is_active
    where coalesce(p.is_active, true) and p.role not in ('entreprise', 'formateur_externe', 'stagiaire')
      and (m.id is not null or not exists (select 1 from public.company_members m2 where m2.profile_id = p.id))
  ), '[]'::jsonb);
end
$$;
revoke all on function public.relecteurs_possibles() from public, anon;
grant execute on function public.relecteurs_possibles() to authenticated;

-- ── Règles ──
do $$
declare t text;
begin
  foreach t in array array['doc_review_settings', 'doc_reviews', 'doc_review_participants', 'doc_review_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;
grant select, insert, update on table public.doc_review_settings to authenticated;
grant select, insert, update on table public.doc_reviews to authenticated;
grant select, insert, update, delete on table public.doc_review_participants to authenticated;
grant select, insert, update on table public.doc_review_items to authenticated;

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

do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and tablename = any (array['doc_review_settings', 'doc_reviews', 'doc_review_participants', 'doc_review_items']) loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Réglages : lus avec les documents, modifiés par qui valide les documents
select pg_temp.regles(array['doc_review_settings'], null,
  $r$company_id in (select app.societes_avec_droit('qualite.documents.voir'))$r$,
  $r$company_id in (select app.societes_avec_droit('qualite.documents.valider'))$r$,
  $r$company_id in (select app.societes_avec_droit('qualite.documents.valider'))$r$,
  null);
-- Circuits : lus avec les documents ou par leurs relecteurs ; ouverts par qui gère, conduits par qui valide (garde)
select pg_temp.regles(array['doc_reviews'], null,
  $r$(company_id in (select app.societes_avec_droit('qualite.documents.voir')) or id in (select app.mes_relectures()))$r$,
  $r$company_id in (select app.societes_avec_droit('qualite.documents.gerer'))$r$,
  $r$(company_id in (select app.societes_avec_droit('qualite.documents.gerer')) or company_id in (select app.societes_avec_droit('qualite.documents.valider')))$r$,
  null);
-- Relecteurs : lus avec le circuit ; invités et retirés par qui gère ; chacun note la fin de sa relecture (garde)
select pg_temp.regles(array['doc_review_participants'], null,
  $r$(company_id in (select app.societes_avec_droit('qualite.documents.voir')) or review_id in (select app.mes_relectures()))$r$,
  $r$company_id in (select app.societes_avec_droit('qualite.documents.gerer'))$r$,
  $r$(profile_id = (select auth.uid()) or company_id in (select app.societes_avec_droit('qualite.documents.gerer')))$r$,
  $r$company_id in (select app.societes_avec_droit('qualite.documents.gerer'))$r$);
-- Avis : lus avec le circuit ; déposés par leur auteur (garde : relecteur, équipe, expert par fichier) ; retirés par leur
-- auteur, tranchés seulement par doc_review_decider
select pg_temp.regles(array['doc_review_items'], null,
  $r$(company_id in (select app.societes_avec_droit('qualite.documents.voir')) or review_id in (select app.mes_relectures()))$r$,
  $r$(company_id in (select app.societes_avec_droit('qualite.documents.gerer')) or review_id in (select app.mes_relectures()))$r$,
  $r$(author_id = (select auth.uid()) or company_id in (select app.societes_avec_droit('qualite.documents.valider')))$r$,
  null);

do $$
declare t text;
begin
  foreach t in array array['doc_review_settings', 'doc_reviews', 'doc_review_participants', 'doc_review_items'] loop
    execute format('create policy %I on public.%I as restrictive for select to authenticated using (company_id in (select app.societes_lisibles()))', t || '_societe_lire', t);
    execute format('create policy %I on public.%I as restrictive for insert to authenticated with check (company_id in (select app.societes_ecriture()))', t || '_societe_creer', t);
    execute format('create policy %I on public.%I as restrictive for update to authenticated using (company_id in (select app.societes_ecriture())) with check (company_id in (select app.societes_ecriture()))', t || '_societe_modifier', t);
  end loop;
  execute 'create policy doc_review_participants_societe_supprimer on public.doc_review_participants as restrictive for delete to authenticated using (company_id in (select app.societes_ecriture()))';
end $$;

-- Journal
do $$
declare t text;
begin
  foreach t in array array['doc_review_settings', 'doc_reviews', 'doc_review_participants', 'doc_review_items'] loop
    execute format('drop trigger if exists zz_audit_row on public.%I', t);
    execute format('create trigger zz_audit_row after insert or update or delete on public.%I for each row execute function app.audit_row(%L)', t, 'qualite');
  end loop;
end $$;

insert into public.schema_migrations (version) values ('0455_circuit_documents') on conflict (version) do nothing;
