-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (documents_0399) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur odet-gld : 0399_documents_emis.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0399_documents_emis_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0399_documents_emis.sql =====
-- 0399 : certificat de réalisation et attestation de présence figés une fois émis (décision de H du 21/10).
-- Un certificat remis ne se corrige pas : une correction produit un nouveau certificat, daté du jour, qui annule et
-- remplace le précédent. La base garde chaque version émise (heures, résultat, date, auteur, motif) ; un document
-- réimprimé sans changement reprend la version émise, à sa date. Les documents d'une session pas encore terminée
-- restent des brouillons et ne sont pas enregistrés. Idempotent.

create table if not exists public.training_documents_issued (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  trainee_id uuid not null references public.trainees(id) on delete cascade,
  kind text not null check (kind in ('certificat', 'attestation')),
  version integer not null check (version >= 1),
  issued_on date not null,
  hours numeric check (hours is null or hours >= 0),
  result text check (result is null or result in ('acquired', 'not_acquired', 'in_progress')),
  absences text[] not null default '{}',
  reason text check (reason is null or length(btrim(reason)) between 3 and 500),
  issued_by uuid default auth.uid(),
  issued_by_name text check (issued_by_name is null or length(issued_by_name) <= 120),
  created_at timestamptz not null default now(),
  unique (session_id, trainee_id, kind, version),
  check (version = 1 or reason is not null)
);
create index if not exists training_documents_issued_company_idx on public.training_documents_issued (company_id);
comment on table public.training_documents_issued is 'Versions émises des certificats de réalisation et attestations de présence (une correction ajoute une version)';

drop trigger if exists training_documents_issued_societe on public.training_documents_issued;
create trigger training_documents_issued_societe before insert on public.training_documents_issued
  for each row execute function app.societe_du_parent('sessions', 'session_id');

create or replace function app.document_emis_auteur()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := now();
  if auth.uid() is not null then new.issued_by := auth.uid(); end if;
  return new;
end
$$;
revoke all on function app.document_emis_auteur() from public, anon, authenticated;
drop trigger if exists training_documents_issued_auteur on public.training_documents_issued;
create trigger training_documents_issued_auteur before insert on public.training_documents_issued
  for each row execute function app.document_emis_auteur();

-- Règles d'accès (générées par scripts/securite/regles.py, build_suite('0399')) : lecture et ajout seulement

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
           where schemaname = 'public' and tablename = any (array['training_documents_issued'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- training_documents_issued
select pg_temp.regles(array['training_documents_issued'], null,
  $r$(company_id in (select app.societes_avec_droit('formation.suivi.voir')) or ((select app.a_le_droit('formation.sessions.voir_siennes')) and session_id in (select app.trainer_session_ids())))$r$,
  $r$(company_id in (select app.societes_avec_droit('formation.suivi.gerer')) or ((select app.a_le_droit('formation.sessions.modifier_siennes')) and session_id in (select app.trainer_session_ids())))$r$,
  null,
  null);


insert into public.schema_migrations (version) values ('0399_documents_emis') on conflict (version) do nothing;
