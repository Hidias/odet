-- 0404 : documents mis à disposition dans l'espace client, pour toutes les prestations (décision de H du 21/10 :
-- zéro papier, sans double saisie, même principe pour la maintenance et les autres prestations).
-- Un document remis au client (rapport d'intervention, facture émise, devis, contrat, tout PDF déposé à la main) est
-- rangé tel quel dans un espace privé, avec son empreinte SHA-256, la date et l'auteur. Le client le retrouve dans son
-- espace (par lien et code, ou par compte) ; chaque téléchargement est noté au journal (0401). Un document se retire
-- mais ne s'efface pas (preuve de mise à disposition). Le dépôt passe par le serveur, qui vérifie que l'appelant voit
-- bien la prestation. Idempotent.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('client-documents', 'client-documents', false, 15728640, array['application/pdf'])
on conflict (id) do nothing;

create table if not exists public.client_shared_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  object_type text not null check (object_type in ('client', 'session', 'invoice', 'quote', 'itv_visit', 'itv_contract')),
  object_id uuid not null,
  kind text not null check (kind in ('rapport', 'facture', 'devis', 'contrat', 'convention', 'attestation', 'autre')),
  label text not null check (length(btrim(label)) between 2 and 200),
  file_path text not null check (file_path !~ '\.\.' and length(file_path) <= 400),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes integer,
  published_by uuid,
  published_by_name text check (published_by_name is null or length(published_by_name) <= 120),
  published_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  withdrawn_by uuid,
  withdrawn_reason text check (withdrawn_reason is null or length(withdrawn_reason) <= 300)
);
-- Un seul document actif par prestation et par type ; plusieurs pour les documents déposés à la main sur la fiche
create unique index if not exists client_shared_documents_un_actif on public.client_shared_documents (object_type, object_id, kind) where withdrawn_at is null and object_type <> 'client';
create index if not exists client_shared_documents_client_idx on public.client_shared_documents (client_id, published_at desc);
create index if not exists client_shared_documents_company_idx on public.client_shared_documents (company_id);
comment on table public.client_shared_documents is 'Documents mis à disposition dans l''espace client (fichier rangé tel quel, empreinte, retrait sans effacement)';

-- Seul le retrait se modifie, une fois ; une ligne ne s'efface qu'avec le client
create or replace function app.client_shared_documents_fige()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.clients c where c.id = old.client_id) then
      raise exception 'Document mis à disposition : il se retire, il ne s''efface pas' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.withdrawn_at is not null
     or (to_jsonb(new) - 'withdrawn_at' - 'withdrawn_by' - 'withdrawn_reason') <> (to_jsonb(old) - 'withdrawn_at' - 'withdrawn_by' - 'withdrawn_reason') then
    raise exception 'Document mis à disposition : seul le retrait est possible' using errcode = '42501';
  end if;
  if new.withdrawn_at is not null then
    new.withdrawn_at := now();
    new.withdrawn_by := auth.uid();
  end if;
  return new;
end
$$;
revoke all on function app.client_shared_documents_fige() from public, anon, authenticated;
drop trigger if exists client_shared_documents_fige on public.client_shared_documents;
create trigger client_shared_documents_fige before update or delete on public.client_shared_documents
  for each row execute function app.client_shared_documents_fige();

-- Le journal (0401) et le contrôle d'appartenance reconnaissent un document déposé sur la fiche du client
alter table public.portal_events drop constraint if exists portal_events_object_type_check;
alter table public.portal_events add constraint portal_events_object_type_check
  check (object_type is null or object_type in ('client', 'session', 'invoice', 'quote', 'itv_visit', 'itv_contract'));

create or replace function app.objet_du_client(p_type text, p_id uuid, p_client uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_type
    when 'client' then p_id = p_client
    when 'session' then exists (select 1 from public.sessions s where s.id = p_id and s.client_id = p_client)
      or exists (select 1 from public.session_groups g where g.session_id = p_id and g.client_id = p_client)
    when 'invoice' then exists (select 1 from public.invoices i where i.id = p_id and (i.client_id = p_client or i.billing_client_id = p_client))
    when 'quote' then exists (select 1 from public.quotes q where q.id = p_id and q.client_id = p_client)
    when 'itv_visit' then exists (select 1 from public.itv_visits v where v.id = p_id and v.client_id = p_client)
    when 'itv_contract' then exists (select 1 from public.itv_contracts c where c.id = p_id and c.client_id = p_client)
    else false end
$$;
revoke all on function app.objet_du_client(text, uuid, uuid) from public, anon, authenticated;

-- Documents visibles par le client (jamais les retirés)
create or replace function app.portail_documents_client(p_client uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'object_type', d.object_type, 'object_id', d.object_id, 'kind', d.kind,
      'label', d.label, 'published_at', d.published_at, 'sha256', d.sha256, 'size_bytes', d.size_bytes) order by d.published_at desc), '[]'::jsonb)
  from public.client_shared_documents d
  where d.client_id = p_client and d.withdrawn_at is null
$$;
revoke all on function app.portail_documents_client(uuid) from public, anon, authenticated;

create or replace function public.client_portal_mes_documents(p_token text, p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_check jsonb := public.client_portal_check(p_token, p_code);
begin
  if v_check ? 'error' then return '[]'::jsonb; end if;
  return app.portail_documents_client((v_check->>'client_id')::uuid);
end
$$;
revoke all on function public.client_portal_mes_documents(text, text) from public;
grant execute on function public.client_portal_mes_documents(text, text) to anon, authenticated;

create or replace function public.ent_mes_documents()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.client_accounts := app.ent_compte();
begin
  -- Factures seulement si le compte y a droit (réglage du compte entreprise)
  return coalesce((select jsonb_agg(e) from jsonb_array_elements(app.portail_documents_client(v.client_id)) e
                   where v.can_see_invoices or e->>'kind' <> 'facture'), '[]'::jsonb);
end
$$;
revoke all on function public.ent_mes_documents() from public, anon;
grant execute on function public.ent_mes_documents() to authenticated;

-- Règles d'accès (générées par scripts/securite/regles.py, build_suite('0404')) : lecture, retrait seulement

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
           where schemaname = 'public' and tablename = any (array['client_shared_documents'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- client_shared_documents
select pg_temp.regles(array['client_shared_documents'], null,
  $r$(company_id in (select app.societes_avec_droit('clients.fiches.voir')) or (company_id in (select app.societes_avec_droit('interventions.missions.voir')) and client_id in (select app.tech_client_ids())))$r$,
  null,
  $r$company_id in (select app.societes_avec_droit('clients.fiches.modifier'))$r$,
  null);


insert into public.schema_migrations (version) values ('0404_documents_espace_client') on conflict (version) do nothing;
