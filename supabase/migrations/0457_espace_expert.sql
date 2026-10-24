-- 0457 : espace de l'expert (pilotage de H du 24/10, circuit de validation, PR 3). L'expert de l'entreprise (avocat,
-- juriste, expert-comptable, comptable) relit en ligne, sans compte : un lien personnel et un code, envoyés dans deux
-- e-mails séparés (ou copiés par l'équipe). Il valide, propose une modification ou commente chaque article, puis
-- termine ; le circuit passe tout seul à l'arbitrage. Il ne valide jamais une version.
--   1. doc_review_experts : invitation d'un expert sur un circuit (lien, code, tentatives, blocage, échéance, état).
--   2. doc_review_items.expert_id : l'avis vient de cet expert (retrait de ses propres avis) ; doc_reviews.expert_view :
--      texte montré à l'expert, champs de l'entreprise remplis.
--   3. Gardes du circuit (0455) : un avis d'expert et le passage « chez l'expert » → « arbitrage » sont aussi permis
--      depuis les fonctions de l'espace de l'expert (et seulement pour son circuit).
--   4. public.expert_ouvrir, public.expert_deposer, public.expert_retirer, public.expert_terminer (lien et code).
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0457_espace_expert_retour.sql

create table if not exists public.doc_review_experts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  review_id uuid not null references public.doc_reviews(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 120),
  quality text not null default 'avocat' check (quality in ('avocat', 'juriste', 'expert_comptable', 'comptable', 'autre')),
  email text check (email is null or email ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  access_code text not null default lpad((floor(random() * 1000000))::int::text, 6, '0'),
  invited_by uuid default auth.uid(),
  invited_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '45 days',
  link_sent_at timestamptz,
  code_sent_at timestamptz,
  opened_at timestamptz,
  last_seen_at timestamptz,
  done_at timestamptz,
  revoked_at timestamptz,
  failed_attempts int not null default 0,
  locked_until timestamptz
);
create index if not exists doc_review_experts_review_idx on public.doc_review_experts (review_id);
create index if not exists doc_review_experts_company_idx on public.doc_review_experts (company_id);
comment on table public.doc_review_experts is 'Expert invité à relire un document en ligne (lien et code, sans compte) ; il donne son avis, ne valide jamais';

alter table public.doc_review_items add column if not exists expert_id uuid references public.doc_review_experts(id) on delete set null;
-- Texte montré à l'expert : les champs de l'entreprise ({{org.…}}) remplis par l'équipe à l'invitation (l'expert n'a pas
-- accès aux réglages) ; le texte arbitré (content) reste celui qui est validé
alter table public.doc_reviews add column if not exists expert_view jsonb;

create or replace function app.doc_review_expert_garde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare r public.doc_reviews;
begin
  select * into r from public.doc_reviews where id = new.review_id;
  if tg_op = 'INSERT' then
    if r.id is null or r.status not in ('arbitrage', 'expert') or r.mode <> 'complet' then
      raise exception 'On invite un expert quand le circuit « relecture et expert » est à l''arbitrage ou chez l''expert' using errcode = '23514';
    end if;
    if not app.peut_gerer_docs(r.company_id) then raise exception 'Inviter un expert demande le droit de gérer les documents' using errcode = '42501'; end if;
    new.company_id := r.company_id;
    new.invited_by := (select auth.uid());
    new.opened_at := null; new.last_seen_at := null; new.done_at := null; new.revoked_at := null; new.failed_attempts := 0; new.locked_until := null;
    new.email := nullif(lower(btrim(coalesce(new.email, ''))), '');
    return new;
  end if;
  if (new.review_id, new.company_id, new.token, new.invited_by, new.invited_at) is distinct from (old.review_id, old.company_id, old.token, old.invited_by, old.invited_at) then
    raise exception 'Une invitation ne change pas de circuit ni de lien : invitez de nouveau' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function app.doc_review_expert_garde() from public, anon, authenticated;
drop trigger if exists doc_review_experts_garde on public.doc_review_experts;
create trigger doc_review_experts_garde before insert or update on public.doc_review_experts for each row execute function app.doc_review_expert_garde();
drop trigger if exists zz_audit_row on public.doc_review_experts;
create trigger zz_audit_row after insert or update or delete on public.doc_review_experts for each row execute function app.audit_row('qualite');

alter table public.doc_review_experts enable row level security;
revoke all on table public.doc_review_experts from public, anon;
grant all on table public.doc_review_experts to service_role;
grant select, insert, update on table public.doc_review_experts to authenticated;

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
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'doc_review_experts' loop
    execute format('drop policy %I on public.doc_review_experts', r.policyname);
  end loop;
end $$;
-- Invitations (lien et code compris) : lues et tenues par qui gère les documents ; jamais effacées
select pg_temp.regles(array['doc_review_experts'], null,
  $r$company_id in (select app.societes_avec_droit('qualite.documents.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('qualite.documents.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('qualite.documents.gerer'))$r$,
  null);
create policy doc_review_experts_societe_lire on public.doc_review_experts as restrictive for select to authenticated using (company_id in (select app.societes_lisibles()));
create policy doc_review_experts_societe_creer on public.doc_review_experts as restrictive for insert to authenticated with check (company_id in (select app.societes_ecriture()));
create policy doc_review_experts_societe_modifier on public.doc_review_experts as restrictive for update to authenticated using (company_id in (select app.societes_ecriture())) with check (company_id in (select app.societes_ecriture()));

-- ── 3. Gardes du circuit : l'espace de l'expert ──
do $do$
declare
  v_def text;
  a1 text := $a$      if not (r.status = 'expert' and app.peut_gerer_docs(r.company_id)) then$a$;
  b1 text := $b$      if not (r.status = 'expert' and (app.peut_gerer_docs(r.company_id) or current_setting('app.expert_review', true) = r.id::text)) /* 0457 */ then$b$;
  a2 text := $a$      if old.author_id <> v_uid then raise exception 'Seul son auteur retire un avis' using errcode = '42501'; end if;$a$;
  b2 text := $b$      if old.author_id is distinct from v_uid and not (old.expert_id is not null and current_setting('app.expert_id', true) = old.expert_id::text) /* 0457 */ then raise exception 'Seul son auteur retire un avis' using errcode = '42501'; end if;$b$;
  a3 text := $a$  if (new.review_id, new.round, new.section_id, new.parent_id, new.kind, new.author_id, new.author_name, new.author_quality, new.author_label,
      new.text, new.proposed, new.base, new.choices, new.created_at, new.company_id)$a$;
  b3 text := $b$  if (new.review_id, new.round, new.section_id, new.parent_id, new.kind, new.author_id, new.author_name, new.author_quality, new.author_label,
      new.text, new.proposed, new.base, new.choices, new.created_at, new.company_id, new.expert_id) /* 0457 */$b$;
  a4 text := $a$     is distinct from (old.review_id, old.round, old.section_id, old.parent_id, old.kind, old.author_id, old.author_name, old.author_quality, old.author_label,
      old.text, old.proposed, old.base, old.choices, old.created_at, old.company_id) then$a$;
  b4 text := $b$     is distinct from (old.review_id, old.round, old.section_id, old.parent_id, old.kind, old.author_id, old.author_name, old.author_quality, old.author_label,
      old.text, old.proposed, old.base, old.choices, old.created_at, old.company_id, old.expert_id) then$b$;
  a5 text := $a$    new.decided_by := null; new.decided_name := null; new.decided_at := null; new.decision_note := null;$a$;
  b5 text := $b$    new.decided_by := null; new.decided_name := null; new.decided_at := null; new.decision_note := null;
    if current_setting('app.expert_review', true) is distinct from r.id::text then new.expert_id := null; end if;$b$;
begin
  v_def := pg_get_functiondef('app.doc_review_item_garde()'::regprocedure);
  if position('/* 0457 */' in v_def) = 0 then
    if position(a1 in v_def) = 0 or position(a2 in v_def) = 0 or position(a3 in v_def) = 0 or position(a4 in v_def) = 0 or position(a5 in v_def) = 0 then
      raise exception 'Fonction doc_review_item_garde inattendue : rien n''est changé';
    end if;
    execute replace(replace(replace(replace(replace(v_def, a1, b1), a2, b2), a3, b3), a4, b4), a5, b5);
  end if;
  v_def := pg_get_functiondef('app.doc_review_garde()'::regprocedure);
  if position('/* 0457 */' in v_def) = 0 then
    a1 := $a$      if not app.peut_gerer_docs(old.company_id) then raise exception 'Le retour de l''expert est enregistré par l''équipe qui gère les documents' using errcode = '42501'; end if;$a$;
    b1 := $b$      if not (app.peut_gerer_docs(old.company_id) or current_setting('app.expert_review', true) = old.id::text) /* 0457 */ then raise exception 'Le retour de l''expert est enregistré par l''équipe qui gère les documents' using errcode = '42501'; end if;$b$;
    if position(a1 in v_def) = 0 then raise exception 'Fonction doc_review_garde inattendue : rien n''est changé'; end if;
    execute replace(v_def, a1, b1);
  end if;
end
$do$;

-- ── 4. Espace de l'expert (lien et code) ──
-- Contrôle du lien et du code : 5 essais, puis 15 minutes de blocage ; invitation retirée, échue, ou circuit sorti de
-- l'étape « chez l'expert » : refus. Renvoie { expert_id } ou { error } (sans lever d'erreur, pour garder le compte
-- des essais).
create or replace function app.expert_verifier(p_token text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare e public.doc_review_experts; v_status text;
begin
  select * into e from public.doc_review_experts where token = p_token;
  if e.id is null then return jsonb_build_object('error', 'Lien inconnu'); end if;
  if e.revoked_at is not null then return jsonb_build_object('error', 'Cette invitation a été retirée par l''entreprise'); end if;
  if e.expires_at < now() then return jsonb_build_object('error', 'Cette invitation est échue : demandez-en une nouvelle à l''entreprise'); end if;
  if e.locked_until is not null and e.locked_until > now() then return jsonb_build_object('error', 'Trop d''essais : réessayez dans quelques minutes'); end if;
  if p_code is null or btrim(p_code) <> e.access_code then
    update public.doc_review_experts set failed_attempts = failed_attempts + 1,
      locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else null end where id = e.id;
    return jsonb_build_object('error', 'Code incorrect', 'code', true);
  end if;
  select r.status into v_status from public.doc_reviews r where r.id = e.review_id;
  if v_status <> 'expert' and e.done_at is null then return jsonb_build_object('error', 'La relecture est close : l''entreprise a repris le document'); end if;
  update public.doc_review_experts set failed_attempts = 0, locked_until = null, opened_at = coalesce(opened_at, now()), last_seen_at = now() where id = e.id;
  return jsonb_build_object('expert_id', e.id);
end
$$;
revoke all on function app.expert_verifier(text, text) from public, anon, authenticated;

create or replace function app.expert_qualite(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p when 'avocat' then 'avocat' when 'juriste' then 'juriste' when 'expert_comptable' then 'expert-comptable' when 'comptable' then 'comptable' else 'expert' end
$$;
revoke all on function app.expert_qualite(text) from public, anon;

create or replace function public.expert_ouvrir(p_token text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v jsonb := app.expert_verifier(p_token, p_code); e public.doc_review_experts; r public.doc_reviews;
begin
  if v ? 'error' then return v; end if;
  select * into e from public.doc_review_experts where id = (v->>'expert_id')::uuid;
  select * into r from public.doc_reviews where id = e.review_id;
  return jsonb_build_object(
    'expert', jsonb_build_object('name', e.name, 'quality', app.expert_qualite(e.quality), 'done_at', e.done_at),
    'organisme', (select jsonb_build_object('nom', coalesce(nullif(c.short_name, ''), nullif(c.legal_name, ''), 'L''entreprise')) from public.companies c where c.id = r.company_id),
    'review', jsonb_build_object('doc_name', r.doc_name, 'message', r.message, 'due_on', r.due_on, 'status', r.status, 'sections', coalesce(r.expert_view->'sections', r.content->'sections'), 'options', r.content->'options'),
    'questions', coalesce((select jsonb_agg(jsonb_build_object('text', i.text, 'choice', i.choice) order by i.created_at)
                           from public.doc_review_items i where i.review_id = r.id and i.kind = 'question' and i.status = 'close'), '[]'::jsonb),
    'avis', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'section_id', i.section_id, 'kind', i.kind, 'text', i.text, 'proposed', i.proposed, 'status', i.status, 'created_at', i.created_at) order by i.created_at)
                      from public.doc_review_items i where i.expert_id = e.id and i.status <> 'retiree'), '[]'::jsonb));
end
$$;
revoke all on function public.expert_ouvrir(text, text) from public;
grant execute on function public.expert_ouvrir(text, text) to anon, authenticated;

create or replace function public.expert_deposer(p_token text, p_code text, p_section text, p_kind text, p_text text default null, p_proposed jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v jsonb := app.expert_verifier(p_token, p_code); e public.doc_review_experts; v_id uuid;
begin
  if v ? 'error' then return v; end if;
  select * into e from public.doc_review_experts where id = (v->>'expert_id')::uuid;
  if e.done_at is not null then return jsonb_build_object('error', 'Vous avez terminé votre relecture : l''entreprise reprend le document'); end if;
  if p_kind is null or p_kind not in ('validation', 'modification', 'commentaire') then return jsonb_build_object('error', 'Avis inconnu'); end if;
  if p_kind = 'commentaire' and length(btrim(coalesce(p_text, ''))) < 2 then return jsonb_build_object('error', 'Écrivez votre commentaire'); end if;
  if p_kind = 'modification' and (p_proposed is null or jsonb_typeof(p_proposed->'blocks') <> 'array') then return jsonb_build_object('error', 'Proposition illisible'); end if;
  perform set_config('app.expert_review', e.review_id::text, true);
  insert into public.doc_review_items (review_id, section_id, kind, text, proposed, author_quality, author_label, expert_id)
  values (e.review_id, nullif(btrim(coalesce(p_section, '')), ''), p_kind, nullif(btrim(coalesce(p_text, '')), ''), p_proposed, 'expert', left(e.name || ', ' || app.expert_qualite(e.quality), 160), e.id)
  returning id into v_id;
  perform set_config('app.expert_review', '', true);
  return jsonb_build_object('ok', true, 'id', v_id);
end
$$;
revoke all on function public.expert_deposer(text, text, text, text, text, jsonb) from public;
grant execute on function public.expert_deposer(text, text, text, text, text, jsonb) to anon, authenticated;

create or replace function public.expert_retirer(p_token text, p_code text, p_item uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v jsonb := app.expert_verifier(p_token, p_code); e public.doc_review_experts;
begin
  if v ? 'error' then return v; end if;
  select * into e from public.doc_review_experts where id = (v->>'expert_id')::uuid;
  if e.done_at is not null then return jsonb_build_object('error', 'Vous avez terminé votre relecture'); end if;
  perform set_config('app.expert_id', e.id::text, true);
  update public.doc_review_items set status = 'retiree' where id = p_item and expert_id = e.id and status = 'ouverte';
  perform set_config('app.expert_id', '', true);
  if not found then return jsonb_build_object('error', 'Avis introuvable ou déjà traité'); end if;
  return jsonb_build_object('ok', true);
end
$$;
revoke all on function public.expert_retirer(text, text, uuid) from public;
grant execute on function public.expert_retirer(text, text, uuid) to anon, authenticated;

-- Fin de relecture : un mot pour l'entreprise (facultatif), puis le circuit passe à l'arbitrage quand tous les experts
-- invités ont terminé
create or replace function public.expert_terminer(p_token text, p_code text, p_message text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v jsonb := app.expert_verifier(p_token, p_code); e public.doc_review_experts; v_lbl text;
begin
  if v ? 'error' then return v; end if;
  select * into e from public.doc_review_experts where id = (v->>'expert_id')::uuid;
  if e.done_at is not null then return jsonb_build_object('ok', true, 'deja', true); end if;
  v_lbl := left(e.name || ', ' || app.expert_qualite(e.quality), 160);
  perform set_config('app.expert_review', e.review_id::text, true);
  if length(btrim(coalesce(p_message, ''))) >= 2 then
    insert into public.doc_review_items (review_id, kind, text, author_quality, author_label, expert_id)
    values (e.review_id, 'commentaire', left(btrim(p_message), 5000), 'expert', v_lbl, e.id);
  elsif not exists (select 1 from public.doc_review_items i where i.expert_id = e.id and i.status <> 'retiree') then
    insert into public.doc_review_items (review_id, kind, text, author_quality, author_label, expert_id)
    values (e.review_id, 'validation', 'Relu sans remarque.', 'expert', v_lbl, e.id);
  end if;
  update public.doc_review_experts set done_at = now() where id = e.id;
  if not exists (select 1 from public.doc_review_experts x where x.review_id = e.review_id and x.id <> e.id and x.revoked_at is null and x.done_at is null and x.expires_at > now()) then
    update public.doc_reviews set status = 'arbitrage', expert_label = coalesce(expert_label, left(v_lbl, 120)) where id = e.review_id and status = 'expert';
  end if;
  perform set_config('app.expert_review', '', true);
  return jsonb_build_object('ok', true);
end
$$;
revoke all on function public.expert_terminer(text, text, text) from public;
grant execute on function public.expert_terminer(text, text, text) to anon, authenticated;

insert into public.schema_migrations (version) values ('0457_espace_expert') on conflict (version) do nothing;
