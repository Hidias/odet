-- 0382_taches_et_envois.sql : journal des tâches planifiées et interrupteurs des envois automatiques (audit du 19/10 au soir).
--
--   1. Journal des tâches planifiées (job_runs) : chaque passage d'une tâche de nuit ou périodique est noté par la route
--      serveur (début, fin, résultat, erreur), y compris un appel refusé (secret absent ou faux). La Console affiche la
--      dernière exécution de chaque tâche. Cause du constat « 0 relance préparée » : la tâche n'a laissé aucune trace,
--      la fonction marche à la main (3 relances préparées dans une transaction annulée le 19/10) ; le journal le dira.
--   2. Interrupteurs des envois automatiques (décision de H du 19/10 à 23h14) : un interrupteur par société et par type
--      d'envoi, fermé par défaut. Le super administrateur l'ouvre ou le ferme. Un administrateur de la société peut
--      seulement le suspendre 24 heures, après une triple confirmation (la troisième demande de recopier
--      « SUSPENDRE 24 H »). Tout changement est journalisé. Un envoi automatique ne part que si app.envoi_auto_autorise()
--      répond vrai.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0382_taches_et_envois_retour.sql

-- 1. Journal des tâches planifiées
create table if not exists public.job_runs (
  id uuid primary key default gen_random_uuid(),
  -- Vide : tâche de la plateforme (toutes sociétés) ; renseignée quand une tâche ne vise qu'une société
  company_id uuid references public.companies(id) on delete cascade,
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'en_cours' check (status in ('en_cours', 'ok', 'erreur', 'refuse')),
  declencheur text not null default 'tache' check (declencheur in ('tache', 'manuel')),
  detail jsonb,
  error text
);
create index if not exists job_runs_job_idx on public.job_runs (job, started_at desc);
comment on table public.job_runs is 'Passages des tâches planifiées, écrits par les routes serveur (clé de service). Lecture : super administrateur.';
alter table public.job_runs enable row level security;
revoke all on public.job_runs from anon, authenticated;
grant select on public.job_runs to authenticated;

-- Dernier passage de chaque tâche, et dernier passage réussi
create or replace view public.v_job_last_runs
with (security_invoker = true)
as
select distinct on (r.job)
  r.job, r.started_at, r.finished_at, r.status, r.declencheur, r.detail, r.error,
  (select max(r2.started_at) from public.job_runs r2 where r2.job = r.job and r2.status = 'ok') as last_ok_at,
  (select count(*) from public.job_runs r3 where r3.job = r.job and r3.status in ('erreur', 'refuse')
     and r3.started_at > now() - interval '7 days') as echecs_7j
from public.job_runs r
order by r.job, r.started_at desc;
grant select on public.v_job_last_runs to authenticated;

-- 2. Interrupteurs des envois automatiques
create table if not exists public.auto_send_switches (
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in ('relance_recyclage', 'relance_devis', 'relance_facture', 'convocation', 'attestation',
                                      'evaluation_froid', 'renouvellement_contrat', 'visite_hors_contrat', 'justificatif_prestataire')),
  enabled boolean not null default false,
  suspended_until timestamptz,
  suspended_by uuid,
  suspended_reason text,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (company_id, kind)
);
comment on table public.auto_send_switches is 'Envois automatiques par société et par type : fermés par défaut, ouverts par le super administrateur, suspendus 24 h par un administrateur.';
alter table public.auto_send_switches enable row level security;
revoke all on public.auto_send_switches from anon, authenticated;
grant select on public.auto_send_switches to authenticated;

create table if not exists public.auto_send_switch_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null,
  action text not null check (action in ('ouvert', 'ferme', 'suspendu', 'repris')),
  motif text,
  user_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists auto_send_switch_log_idx on public.auto_send_switch_log (company_id, created_at desc);
alter table public.auto_send_switch_log enable row level security;
revoke all on public.auto_send_switch_log from anon, authenticated;
grant select on public.auto_send_switch_log to authenticated;

-- Types d'envoi et libellés (une seule liste, lue par l'écran)
create or replace function app.envoi_auto_types()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['relance_recyclage', 'relance_devis', 'relance_facture', 'convocation', 'attestation', 'evaluation_froid',
               'renouvellement_contrat', 'visite_hors_contrat', 'justificatif_prestataire']
$$;

-- Vrai si un envoi automatique de ce type peut partir pour cette société
create or replace function app.envoi_auto_autorise(p_company uuid, p_kind text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.enabled and (s.suspended_until is null or s.suspended_until <= now())
                     from public.auto_send_switches s where s.company_id = p_company and s.kind = p_kind), false)
$$;
revoke all on function app.envoi_auto_autorise(uuid, text) from public, anon;
grant execute on function app.envoi_auto_autorise(uuid, text) to authenticated, service_role;

-- Ouvrir ou fermer un type d'envoi : super administrateur seulement
create or replace function public.envoi_auto_regler(p_company uuid, p_kind text, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_superadmin() then
    raise exception 'Seul le super administrateur ouvre ou ferme un envoi automatique' using errcode = '42501';
  end if;
  if p_kind is null or not (p_kind = any (app.envoi_auto_types())) then
    raise exception 'Type d''envoi inconnu' using errcode = '22023';
  end if;
  insert into public.auto_send_switches (company_id, kind, enabled, updated_by, updated_at)
  values (p_company, p_kind, coalesce(p_enabled, false), (select auth.uid()), now())
  on conflict (company_id, kind) do update
    set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now(),
        suspended_until = case when excluded.enabled then public.auto_send_switches.suspended_until else null end;
  insert into public.auto_send_switch_log (company_id, kind, action, user_id)
  values (p_company, p_kind, case when coalesce(p_enabled, false) then 'ouvert' else 'ferme' end, (select auth.uid()));
end
$$;
revoke all on function public.envoi_auto_regler(uuid, text, boolean) from public, anon;
grant execute on function public.envoi_auto_regler(uuid, text, boolean) to authenticated;

-- Suspendre un type d'envoi 24 heures : administrateur de la société (ou super administrateur), confirmation recopiée
create or replace function public.envoi_auto_suspendre(p_company uuid, p_kind text, p_confirmation text, p_motif text default null)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_jusqu timestamptz := now() + interval '24 hours';
begin
  if not (app.is_superadmin() or app.is_company_admin(p_company)) then
    raise exception 'Réservé aux administrateurs de la société' using errcode = '42501';
  end if;
  if p_kind is null or not (p_kind = any (app.envoi_auto_types())) then
    raise exception 'Type d''envoi inconnu' using errcode = '22023';
  end if;
  if upper(btrim(coalesce(p_confirmation, ''))) <> 'SUSPENDRE 24 H' then
    raise exception 'Confirmation incorrecte : recopiez « SUSPENDRE 24 H »' using errcode = '22023';
  end if;
  insert into public.auto_send_switches (company_id, kind, enabled, suspended_until, suspended_by, suspended_reason, updated_by, updated_at)
  values (p_company, p_kind, false, v_jusqu, (select auth.uid()), nullif(btrim(coalesce(p_motif, '')), ''), (select auth.uid()), now())
  on conflict (company_id, kind) do update
    set suspended_until = v_jusqu, suspended_by = excluded.suspended_by, suspended_reason = excluded.suspended_reason,
        updated_by = excluded.updated_by, updated_at = now();
  insert into public.auto_send_switch_log (company_id, kind, action, motif, user_id)
  values (p_company, p_kind, 'suspendu', nullif(btrim(coalesce(p_motif, '')), ''), (select auth.uid()));
  return v_jusqu;
end
$$;
revoke all on function public.envoi_auto_suspendre(uuid, text, text, text) from public, anon;
grant execute on function public.envoi_auto_suspendre(uuid, text, text, text) to authenticated;

-- Lever une suspension avant la fin des 24 heures : super administrateur seulement
create or replace function public.envoi_auto_reprendre(p_company uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_superadmin() then
    raise exception 'Seul le super administrateur lève une suspension' using errcode = '42501';
  end if;
  update public.auto_send_switches set suspended_until = null, updated_by = (select auth.uid()), updated_at = now()
  where company_id = p_company and kind = p_kind;
  insert into public.auto_send_switch_log (company_id, kind, action, user_id) values (p_company, p_kind, 'repris', (select auth.uid()));
end
$$;
revoke all on function public.envoi_auto_reprendre(uuid, text) from public, anon;
grant execute on function public.envoi_auto_reprendre(uuid, text) to authenticated;

-- Règles d'accès (lecture seule ; toute écriture passe par les fonctions ci-dessus ou par la clé de service)

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
           where schemaname = 'public' and tablename = any (array['auto_send_switch_log', 'auto_send_switches', 'job_runs'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- auto_send_switch_log, auto_send_switches
select pg_temp.regles(array['auto_send_switch_log', 'auto_send_switches'], null,
  $r$(company_id in (select app.societes_avec_droit('parametres.organisme.modifier')) or (select app.a_le_droit('plateforme.administrer')))$r$,
  null,
  null,
  null);

-- job_runs
select pg_temp.regles(array['job_runs'], null,
  $r$(select app.a_le_droit('plateforme.administrer'))$r$,
  null,
  null,
  null);

insert into public.schema_migrations (version) values ('0382_taches_et_envois') on conflict (version) do nothing;
