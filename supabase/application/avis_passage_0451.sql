-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (avis_passage_0451) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0451_avis_passage_bon_distance.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0451_avis_passage_bon_distance_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0451_avis_passage_bon_distance.sql =====
-- 0451 : avis de passage et bon d'intervention signé à distance (pilotage de H du 24/10, partie 5 d).
--   1. Avis de passage (itv_visit_notices) : avant la visite (« notre technicien passera le … entre … ») ou au passage
--      quand le client est absent (« nous sommes passés le … à … ; rappelez-nous »). Le PDF est mis à disposition dans
--      l'espace client (kind « avis_passage »), à imprimer pour la boîte aux lettres ; l'avis reste tracé.
--   2. Bon d'intervention signé à distance : une visite terminée sans signature du client peut être envoyée à signer ;
--      le client signe le rapport dans son espace (même preuve que le devis : nom, mention « bon pour accord » écrite,
--      empreinte du document, appareil). La visite garde la trace (demandé le, signé le, preuve).
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0451_avis_passage_bon_distance_retour.sql

-- ── Documents de l'espace client : avis de passage ──
do $$
begin
  alter table public.client_shared_documents drop constraint if exists client_shared_documents_kind_check;
  alter table public.client_shared_documents add constraint client_shared_documents_kind_check
    check (kind in ('rapport', 'facture', 'devis', 'contrat', 'convention', 'attestation', 'autre', 'avis_passage'));
end
$$;

-- ── 1. Avis de passage ──
create table if not exists public.itv_visit_notices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  visit_id uuid not null references public.itv_visits(id) on delete cascade,
  kind text not null check (kind in ('prevu', 'absent')),
  passage_on date not null,
  window_text text check (window_text is null or length(window_text) <= 100),
  message text check (message is null or length(message) <= 1000),
  document_id uuid references public.client_shared_documents(id) on delete set null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists itv_visit_notices_visit_idx on public.itv_visit_notices (visit_id, created_at desc);
create index if not exists itv_visit_notices_company_idx on public.itv_visit_notices (company_id);
comment on table public.itv_visit_notices is 'Avis de passage d''une visite : prévu (avant) ou client absent (au passage), mis à disposition dans l''espace client';

create or replace function app.itv_avis_garde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_co uuid;
begin
  select v.company_id into v_co from public.itv_visits v where v.id = new.visit_id;
  if v_co is null then raise exception 'Visite introuvable' using errcode = 'P0002'; end if;
  new.company_id := v_co;
  if tg_op = 'INSERT' then new.created_by := (select auth.uid()); end if;
  return new;
end
$$;
revoke all on function app.itv_avis_garde() from public, anon, authenticated;
drop trigger if exists itv_visit_notices_garde on public.itv_visit_notices;
create trigger itv_visit_notices_garde before insert or update on public.itv_visit_notices for each row execute function app.itv_avis_garde();
drop trigger if exists zz_audit_row on public.itv_visit_notices;
create trigger zz_audit_row after insert or update or delete on public.itv_visit_notices for each row execute function app.audit_row('interventions');

alter table public.itv_visit_notices enable row level security;
revoke all on table public.itv_visit_notices from public, anon;
grant select, insert, update, delete on table public.itv_visit_notices to authenticated;
grant all on table public.itv_visit_notices to service_role;

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
           where schemaname = 'public' and tablename = any (array['itv_visit_notices'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- itv_visit_notices : lus par qui voit les visites et par leur auteur ; écrits par qui gère les visites, ou par le
-- technicien pour une visite qui lui est confiée
select pg_temp.regles(array['itv_visit_notices'], null,
  $r$(company_id in (select app.societes_avec_droit('interventions.visites.voir')) or created_by = (select auth.uid()))$r$,
  $r$(company_id in (select app.societes_avec_droit('interventions.visites.gerer')) or (company_id in (select app.societes_avec_droit('interventions.missions.realiser')) and visit_id in (select v.id from public.itv_visits v where v.technician_id = (select auth.uid()))))$r$,
  $r$company_id in (select app.societes_avec_droit('interventions.visites.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('interventions.visites.gerer'))$r$);

drop policy if exists itv_visit_notices_societe_lire on public.itv_visit_notices;
drop policy if exists itv_visit_notices_societe_creer on public.itv_visit_notices;
drop policy if exists itv_visit_notices_societe_modifier on public.itv_visit_notices;
drop policy if exists itv_visit_notices_societe_supprimer on public.itv_visit_notices;
create policy itv_visit_notices_societe_lire on public.itv_visit_notices as restrictive for select to authenticated using (company_id in (select app.societes_lisibles()));
create policy itv_visit_notices_societe_creer on public.itv_visit_notices as restrictive for insert to authenticated with check (company_id in (select app.societes_ecriture()));
create policy itv_visit_notices_societe_modifier on public.itv_visit_notices as restrictive for update to authenticated using (company_id in (select app.societes_ecriture())) with check (company_id in (select app.societes_ecriture()));
create policy itv_visit_notices_societe_supprimer on public.itv_visit_notices as restrictive for delete to authenticated using (company_id in (select app.societes_ecriture()));

-- ── 2. Bon d'intervention signé à distance ──
alter table public.itv_visits add column if not exists remote_signature_requested_at timestamptz;
alter table public.itv_visits add column if not exists remote_signed_at timestamptz;
alter table public.itv_visits add column if not exists remote_signature_id uuid references public.document_signatures(id) on delete set null;
comment on column public.itv_visits.remote_signature_requested_at is 'Bon d''intervention envoyé à signer à distance (visite terminée sans signature du client)';

-- La demande ne vaut que pour une visite terminée sans signature sur place ; la signature à distance est écrite par
-- la base seule (app.portail_signer_document)
create or replace function app.itv_signature_distance_garde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then return new; end if;
  -- Écriture de la signature par la base (app.portail_signer_document pose ce réglage pour la visite)
  if coalesce(current_setting('app.itv_signature', true), '') = new.id::text then return new; end if;
  if new.remote_signed_at is distinct from old.remote_signed_at or new.remote_signature_id is distinct from old.remote_signature_id then
    raise exception 'La signature à distance est enregistrée par l''espace client' using errcode = '42501';
  end if;
  if new.remote_signature_requested_at is distinct from old.remote_signature_requested_at and new.remote_signature_requested_at is not null then
    if new.status <> 'terminee' then raise exception 'Terminez la visite avant de l''envoyer à signer' using errcode = '22023'; end if;
    if new.client_signature is not null then raise exception 'Visite déjà signée sur place' using errcode = '22023'; end if;
  end if;
  return new;
end
$$;
revoke all on function app.itv_signature_distance_garde() from public, anon, authenticated;
drop trigger if exists itv_visits_signature_distance on public.itv_visits;
create trigger itv_visits_signature_distance before update of remote_signature_requested_at, remote_signed_at, remote_signature_id on public.itv_visits
  for each row execute function app.itv_signature_distance_garde();

-- Signature en ligne d'un document : le rapport d'une visite envoyée à signer devient signable (même preuve)
do $do$
declare
  v_def text := pg_get_functiondef('app.portail_signer_document(uuid,text,uuid,uuid,uuid,text,text,text,text)'::regprocedure);
  a1 text := $a$  if d.kind not in ('devis', 'contrat') then raise exception 'Document non signable' using errcode = '22023'; end if;$a$;
  b1 text := $b$  if d.kind not in ('devis', 'contrat', 'rapport') then raise exception 'Document non signable' using errcode = '22023'; end if;
  -- Bon d'intervention (0451) : seulement le rapport d'une visite terminée, envoyée à signer, pas encore signée
  if d.kind = 'rapport' and not (d.object_type = 'itv_visit' and exists (select 1 from public.itv_visits v where v.id = d.object_id
       and v.status = 'terminee' and v.client_signature is null and v.remote_signature_requested_at is not null and v.remote_signed_at is null)) then
    raise exception 'Ce rapport n''est pas à signer' using errcode = '22023';
  end if;$b$;
  a2 text := $a$  else
    v_lien := '/clients/' || p_client;
  end if;$a$;
  b2 text := $b$  elsif d.kind = 'rapport' and d.object_type = 'itv_visit' then
    -- Bon d'intervention signé à distance (0451) : trace sur la visite, écrite par la base seule
    perform set_config('app.itv_signature', d.object_id::text, true);
    update public.itv_visits set remote_signed_at = now(), remote_signature_id = v_id where id = d.object_id;
    perform set_config('app.itv_signature', '', true);
    v_lien := '/interventions/visite/' || d.object_id;
  else
    v_lien := '/clients/' || p_client;
  end if;$b$;
  a3 text := $a$case when d.kind = 'devis' then 'devis_signe' else 'contrat_signe' end,
    case when d.kind = 'devis' then 'Devis signé en ligne' else 'Contrat signé en ligne' end,$a$;
  b3 text := $b$case when d.kind = 'devis' then 'devis_signe' when d.kind = 'rapport' then 'bon_intervention_signe' else 'contrat_signe' end,
    case when d.kind = 'devis' then 'Devis signé en ligne' when d.kind = 'rapport' then 'Bon d''intervention signé à distance' else 'Contrat signé en ligne' end,$b$;
begin
  if position('0451' in v_def) > 0 then return; end if;
  if position(a1 in v_def) = 0 or position(a2 in v_def) = 0 or position(a3 in v_def) = 0 then
    raise exception 'Fonction portail_signer_document inattendue : rien n''est changé';
  end if;
  execute replace(replace(replace(v_def, a1, b1), a2, b2), a3, b3);
end
$do$;
revoke all on function app.portail_signer_document(uuid, text, uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;

-- Rapports à signer pour l'espace client (le bouton « Signer » n'apparaît que pour eux)
create or replace function app.rapports_a_signer(p_client uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(d.id), '[]'::jsonb)
  from public.client_shared_documents d join public.itv_visits v on v.id = d.object_id
  where d.client_id = p_client and d.kind = 'rapport' and d.object_type = 'itv_visit' and d.withdrawn_at is null
    and v.status = 'terminee' and v.client_signature is null and v.remote_signature_requested_at is not null and v.remote_signed_at is null
$$;
revoke all on function app.rapports_a_signer(uuid) from public, anon, authenticated;

create or replace function public.client_portal_a_signer(p_token text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check jsonb := public.client_portal_check(p_token, p_code);
begin
  if v_check ? 'error' then return v_check; end if;
  return app.rapports_a_signer((v_check->>'client_id')::uuid);
end
$$;
revoke all on function public.client_portal_a_signer(text, text) from public;
grant execute on function public.client_portal_a_signer(text, text) to anon, authenticated;

create or replace function public.ent_a_signer()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.client_accounts := app.ent_compte();
begin
  return app.rapports_a_signer(v.client_id);
end
$$;
revoke all on function public.ent_a_signer() from public, anon;
grant execute on function public.ent_a_signer() to authenticated;

insert into public.schema_migrations (version) values ('0451_avis_passage_bon_distance') on conflict (version) do nothing;
