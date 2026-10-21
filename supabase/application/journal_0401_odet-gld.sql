-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (journal_0401) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur odet-gld : 0401_journal_espace_client.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0401_journal_espace_client_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0401_journal_espace_client.sql =====
-- 0401 : journal de l'espace client, pour toutes les prestations (décision de H du 21/10).
-- Chaque connexion et chaque document téléchargé depuis l'espace client (par lien et code, ou par compte) est noté :
-- date et heure, adresse IP et appareil relevés par le serveur, document et son empreinte SHA-256. Sert de preuve de
-- mise à disposition (le client a eu le document, tel jour, sous cette forme). Une ligne ne se modifie jamais ; elle
-- part seulement avec la fiche du client. Prestations reconnues : sessions de formation, factures, devis, visites et
-- contrats de maintenance. Idempotent.

create table if not exists public.portal_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  channel text not null check (channel in ('lien', 'compte')),
  access_id uuid references public.client_portal_access(id) on delete set null,
  profile_id uuid,
  event text not null check (event in ('connexion', 'document', 'signature')),
  object_type text check (object_type is null or object_type in ('session', 'invoice', 'quote', 'itv_visit', 'itv_contract')),
  object_id uuid,
  document_kind text check (document_kind is null or length(document_kind) <= 40),
  document_label text check (document_label is null or length(document_label) <= 200),
  document_sha256 text check (document_sha256 is null or document_sha256 ~ '^[0-9a-f]{64}$'),
  ip text check (ip is null or length(ip) <= 64),
  user_agent text check (user_agent is null or length(user_agent) <= 400),
  created_at timestamptz not null default now()
);
create index if not exists portal_events_client_idx on public.portal_events (client_id, created_at desc);
create index if not exists portal_events_company_idx on public.portal_events (company_id);
comment on table public.portal_events is 'Journal de l''espace client : connexions, documents téléchargés, signatures (preuve de mise à disposition)';

-- Jamais modifié
create or replace function app.portal_events_fige()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Journal de l''espace client : une ligne ne se modifie pas' using errcode = '42501';
end
$$;
revoke all on function app.portal_events_fige() from public, anon, authenticated;
drop trigger if exists portal_events_fige on public.portal_events;
create trigger portal_events_fige before update on public.portal_events
  for each row execute function app.portal_events_fige();

-- Le document concerne-t-il bien ce client ?
create or replace function app.objet_du_client(p_type text, p_id uuid, p_client uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_type
    when 'session' then exists (select 1 from public.sessions s where s.id = p_id and s.client_id = p_client)
      or exists (select 1 from public.session_groups g where g.session_id = p_id and g.client_id = p_client)
    when 'invoice' then exists (select 1 from public.invoices i where i.id = p_id and (i.client_id = p_client or i.billing_client_id = p_client))
    when 'quote' then exists (select 1 from public.quotes q where q.id = p_id and q.client_id = p_client)
    when 'itv_visit' then exists (select 1 from public.itv_visits v where v.id = p_id and v.client_id = p_client)
    when 'itv_contract' then exists (select 1 from public.itv_contracts c where c.id = p_id and c.client_id = p_client)
    else false end
$$;
revoke all on function app.objet_du_client(text, uuid, uuid) from public, anon, authenticated;

-- Écriture commune : adresse IP et appareil lus dans la requête reçue par le serveur, jamais fournis par l'écran
create or replace function app.portail_noter(p_client uuid, p_channel text, p_access uuid, p_profile uuid, p_event text,
  p_object_type text, p_object_id uuid, p_kind text, p_label text, p_sha256 text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  h jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  v_ip text := nullif(btrim(split_part(coalesce(h->>'x-forwarded-for', h->>'cf-connecting-ip', h->>'x-real-ip', ''), ',', 1)), '');
  v_id uuid;
begin
  if p_event not in ('connexion', 'document') then
    raise exception 'Événement inconnu' using errcode = '22023';
  end if;
  if p_event = 'document' and (p_object_type is null or p_object_id is null or not app.objet_du_client(p_object_type, p_object_id, p_client)) then
    raise exception 'Document inconnu pour ce client' using errcode = '42501';
  end if;
  insert into public.portal_events (company_id, client_id, channel, access_id, profile_id, event, object_type, object_id,
    document_kind, document_label, document_sha256, ip, user_agent)
  select c.company_id, c.id, p_channel, p_access, p_profile, p_event, p_object_type, p_object_id,
    left(p_kind, 40), left(p_label, 200), case when p_sha256 ~ '^[0-9a-f]{64}$' then p_sha256 end,
    left(v_ip, 64), left(h->>'user-agent', 400)
  from public.clients c where c.id = p_client
  returning id into v_id;
  return v_id;
end
$$;
revoke all on function app.portail_noter(uuid, text, uuid, uuid, text, text, uuid, text, text, text) from public, anon, authenticated;

-- Espace par lien et code
create or replace function public.client_portal_journal(p_token text, p_code text, p_event text,
  p_object_type text default null, p_object_id uuid default null, p_kind text default null, p_label text default null, p_sha256 text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_check jsonb := public.client_portal_check(p_token, p_code);
  v_access uuid;
begin
  if v_check ? 'error' then return v_check; end if;
  select a.id into v_access from public.client_portal_access a where a.token = p_token;
  return jsonb_build_object('id', app.portail_noter((v_check->>'client_id')::uuid, 'lien', v_access, null, p_event,
    p_object_type, p_object_id, p_kind, p_label, p_sha256));
end
$$;
revoke all on function public.client_portal_journal(text, text, text, text, uuid, text, text, text) from public;
grant execute on function public.client_portal_journal(text, text, text, text, uuid, text, text, text) to anon, authenticated;

-- Espace par compte
create or replace function public.ent_journal(p_event text,
  p_object_type text default null, p_object_id uuid default null, p_kind text default null, p_label text default null, p_sha256 text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.client_accounts := app.ent_compte();
begin
  return jsonb_build_object('id', app.portail_noter(v.client_id, 'compte', null, v.profile_id, p_event,
    p_object_type, p_object_id, p_kind, p_label, p_sha256));
end
$$;
revoke all on function public.ent_journal(text, text, uuid, text, text, text) from public, anon;
grant execute on function public.ent_journal(text, text, uuid, text, text, text) to authenticated;

-- Règles d'accès (générées par scripts/securite/regles.py, build_suite('0401')) : lecture seule

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
           where schemaname = 'public' and tablename = any (array['portal_events'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- portal_events
select pg_temp.regles(array['portal_events'], null,
  $r$company_id in (select app.societes_avec_droit('clients.fiches.voir'))$r$,
  null,
  null,
  null);


insert into public.schema_migrations (version) values ('0401_journal_espace_client') on conflict (version) do nothing;
