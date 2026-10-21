-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (depots_0431) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0431_depots_client.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0431_depots_client_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0431_depots_client.sql =====
-- 0431 : imprimer, signer et déposer depuis l'espace client (décision de H, 21/10, 23 h 30). Le client peut, au lieu
-- de signer en ligne, imprimer le devis ou la convention, le signer à la main et déposer le scan (PDF ou photos,
-- compressés par le navigateur sans perte visible). L'organisme est prévenu tout de suite, ouvre le scan et le valide
-- (devis accepté et session préparée, ou convention signée) ou le refuse avec un motif que le client voit.
-- Dépôt fait par le serveur (/api/depot-client) après vérification de l'accès ; fichier rangé tel quel avec son
-- empreinte ; une ligne de dépôt ne s'efface pas et seule sa décision se renseigne, une fois.
-- Migration additive (table, fonctions, règles). Idempotente. Retour arrière : supabase/rollback/0431_depots_client_retour.sql

create table if not exists public.client_deposits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default(),
  client_id uuid not null references public.clients (id),
  object_type text not null check (object_type in ('quote', 'session')),
  object_id uuid not null,
  kind text not null check (kind in ('devis', 'contrat', 'convention')),
  label text not null check (length(label) between 2 and 200),
  bucket text not null check (bucket in ('client-documents', 'signed-conventions')),
  file_path text not null check (length(file_path) <= 400),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes int not null check (size_bytes > 0),
  original_bytes int check (original_bytes is null or original_bytes > 0),
  channel text not null check (channel in ('lien', 'compte')),
  access_id uuid,
  profile_id uuid,
  depositor_name text check (depositor_name is null or length(depositor_name) <= 120),
  ip text check (ip is null or length(ip) <= 64),
  user_agent text check (user_agent is null or length(user_agent) <= 400),
  deposited_at timestamptz not null default now(),
  status text not null default 'recu' check (status in ('recu', 'valide', 'refuse')),
  decided_at timestamptz,
  decided_by uuid,
  decided_name text,
  motif text check (motif is null or length(motif) <= 500)
);
create index if not exists client_deposits_objet_idx on public.client_deposits (object_type, object_id, deposited_at desc);
create index if not exists client_deposits_client_idx on public.client_deposits (client_id, deposited_at desc);
comment on table public.client_deposits is 'Documents signés à la main et déposés par le client dans son espace (0431), à valider par l''organisme';

-- Un dépôt ne s'efface pas ; seule sa décision se renseigne, une fois
create or replace function app.client_deposits_fige()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.demo_records r where r.tbl = 'client_deposits' and r.id = old.id) then return old; end if;
    raise exception 'Dépôt du client : il ne s''efface pas' using errcode = '42501';
  end if;
  if old.status <> 'recu'
     or (to_jsonb(new) - 'status' - 'decided_at' - 'decided_by' - 'decided_name' - 'motif')
        <> (to_jsonb(old) - 'status' - 'decided_at' - 'decided_by' - 'decided_name' - 'motif') then
    raise exception 'Dépôt du client : seule la décision se renseigne, une fois' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function app.client_deposits_fige() from public, anon, authenticated;
drop trigger if exists client_deposits_fige on public.client_deposits;
create trigger client_deposits_fige before update or delete on public.client_deposits
  for each row execute function app.client_deposits_fige();

-- Décision de l'organisme : valider (devis accepté puis session préparée ; convention signée) ou refuser avec un motif
create or replace function public.depot_client_decider(p_depot uuid, p_decision text, p_motif text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.client_deposits;
  v_nom text;
  v_n int := 0;
begin
  select * into d from public.client_deposits where id = p_depot;
  if d.id is null then raise exception 'Dépôt introuvable' using errcode = 'P0002'; end if;
  if d.object_type = 'quote' and not app.a_le_droit_dans(d.company_id, 'commercial.devis.modifier') then
    raise exception 'Droit insuffisant' using errcode = '42501';
  end if;
  if d.object_type = 'session' and not app.can_edit_session(d.object_id) then
    raise exception 'Droit insuffisant' using errcode = '42501';
  end if;
  if d.status <> 'recu' then raise exception 'Dépôt déjà traité' using errcode = '22023'; end if;
  if p_decision not in ('valide', 'refuse') then raise exception 'Décision inconnue' using errcode = '22023'; end if;
  if p_decision = 'refuse' and length(btrim(coalesce(p_motif, ''))) < 3 then
    raise exception 'Motif du refus requis (le client le voit)' using errcode = '22023';
  end if;
  select coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), p.display_name, p.email) into v_nom
  from public.profiles p where p.id = auth.uid();

  update public.client_deposits set status = p_decision, decided_at = now(), decided_by = auth.uid(), decided_name = left(v_nom, 120),
    motif = nullif(left(btrim(coalesce(p_motif, '')), 500), '')
  where id = d.id;

  if p_decision = 'valide' and d.object_type = 'quote' then
    update public.quotes set status = 'accepted', updated_at = now() where id = d.object_id and status in ('draft', 'sent', 'partial');
    v_n := app.devis_prepare_sessions(d.object_id);
  elsif p_decision = 'valide' and d.object_type = 'session' then
    update public.sessions set convention_signed = true, convention_signed_date = coalesce(convention_signed_date, now()),
      convention_signed_file_url = coalesce(convention_signed_file_url, d.file_path), updated_at = now()
    where id = d.object_id;
  end if;
  return jsonb_build_object('ok', true, 'sessions_preparees', v_n);
end
$$;
revoke all on function public.depot_client_decider(uuid, text, text) from public, anon;
grant execute on function public.depot_client_decider(uuid, text, text) to authenticated;

-- Dépôts du client (espace) : état et motif d'un refus
create or replace function app.depots_du_client(p_client uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'object_type', d.object_type, 'object_id', d.object_id, 'kind', d.kind,
    'label', d.label, 'status', d.status, 'deposited_at', d.deposited_at, 'decided_at', d.decided_at, 'motif', d.motif)
    order by d.deposited_at desc), '[]'::jsonb)
  from public.client_deposits d where d.client_id = p_client
$$;
revoke all on function app.depots_du_client(uuid) from public, anon, authenticated;

create or replace function public.client_portal_depots(p_token text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_check jsonb := public.client_portal_check(p_token, p_code);
begin
  if v_check ? 'error' then return v_check; end if;
  return app.depots_du_client((v_check ->> 'client_id')::uuid);
end
$$;
revoke all on function public.client_portal_depots(text, text) from public;
grant execute on function public.client_portal_depots(text, text) to anon, authenticated;

create or replace function public.ent_depots()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v public.client_accounts := app.ent_compte();
begin
  return app.depots_du_client(v.client_id);
end
$$;
revoke all on function public.ent_depots() from public, anon;
grant execute on function public.ent_depots() to authenticated;


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
           where schemaname = 'public' and tablename = any (array['client_deposits'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- client_deposits
select pg_temp.regles(array['client_deposits'], null,
  $r$company_id in (select app.societes_avec_droit('clients.fiches.voir'))$r$,
  null,
  null,
  null);


insert into public.schema_migrations (version) values ('0431_depots_client') on conflict (version) do nothing;
