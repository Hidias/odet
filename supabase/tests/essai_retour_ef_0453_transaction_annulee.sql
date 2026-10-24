-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (ef_0453) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0453_espace_formateur_emargement.sql, retour arrière,
-- comparaison. Se termine TOUJOURS par l'erreur volontaire « RÉSULTAT DE L'ESSAI DU RETOUR ARRIÈRE » : tout est annulé.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

create temp view etat_essai as
  select 'règle' as kind, schemaname || '.' || tablename || '.' || policyname as name,
         md5(concat_ws('|', permissive, roles::text, cmd, qual, with_check)) as v
  from pg_policies where schemaname in ('public', 'storage')
  union all
  select 'fonction', p.oid::regprocedure::text,
         md5(concat_ws('|', pg_get_functiondef(p.oid), p.prosecdef::text, p.proconfig::text,
             (select string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',' order by a.grantee::regrole::text, a.privilege_type)
              from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a)))
  from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace) and p.prokind in ('f', 'p')
  union all
  select 'droits table', c.oid::regclass::text,
         md5(coalesce((select string_agg(a.grantee::regrole::text || ':' || a.privilege_type || ':' || a.is_grantable::text, ','
                               order by a.grantee::regrole::text, a.privilege_type)
                       from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a), '') || c.relrowsecurity::text)
  from pg_class c where c.relnamespace in ('public'::regnamespace, 'app'::regnamespace) and c.relkind in ('r', 'v', 'm', 'p')
  union all
  select 'vue', c.oid::regclass::text, md5(pg_get_viewdef(c.oid) || coalesce(c.reloptions::text, ''))
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
  union all
  select 'colonne', table_schema || '.' || table_name || '.' || column_name, md5(data_type || is_nullable || coalesce(column_default, ''))
  from information_schema.columns where table_schema in ('public', 'app')
  union all
  select 'contrainte', conrelid::regclass::text || '.' || conname, md5(pg_get_constraintdef(oid))
  from pg_constraint where connamespace in ('public'::regnamespace, 'app'::regnamespace)
  union all
  select 'index', indexrelid::regclass::text, md5(pg_get_indexdef(indexrelid))
  from pg_index where indrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace, 'app'::regnamespace))
  union all
  select 'déclencheur', tgrelid::regclass::text || '.' || tgname, md5(tgfoid::regprocedure::text || tgenabled::text)
  from pg_trigger where not tgisinternal
    and tgrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace, 'app'::regnamespace))
  union all
  select 'migrations', 'public.schema_migrations', md5(coalesce(string_agg(version, ',' order by version), ''))
  from public.schema_migrations
  union all
  select 'données', 'organization_settings', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.organization_settings t
  union all
  select 'données', 'profiles', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.profiles t
  union all
  select 'données', 'org_modules', md5(coalesce(string_agg(t::text, ',' order by t.key), '')) from public.org_modules t
  union all
  select 'données', 'company_members', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.company_members t
  union all
  select 'données', 'company_member_roles', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.company_member_roles t;
create temp table etat_essai_avant as select * from etat_essai;

-- ===== supabase/migrations/0453_espace_formateur_emargement.sql =====
-- 0453 : espace formateur, émargement (pilotage de H du 24/10, partie 5 e ; piste 16 ; liste unique « signature du
-- formateur par demi-journée »). Le formateur externe fait signer ses stagiaires sur son téléphone depuis son espace,
-- comme un formateur salarié (même page, même file hors réseau), et chaque formateur signe lui-même chaque demi-journée
-- tenue : la feuille d'émargement porte une vraie signature par demi-journée, plus seulement l'image enregistrée.
--   1. trainer_halfday_signatures : signature du formateur par session, date et demi-journée (jamais remplacée).
--   2. app.ext_formateur_de(session) : le compte connecté est le formateur externe de cette session.
--   3. get_trainer_sign_data, trainer_sign_halfday, trainer_proxy_sign : ouverts au formateur externe de la session
--      (mêmes contrôles qu'avant pour tous les autres comptes ; régularisation après la fin toujours réservée).
--   4. public.formateur_signatures(session) et public.formateur_signer(...) : demi-journées signées par le formateur
--      connecté, et sa signature (demi-journée de la formation, commencée, pas à venir, pas après la fin de la session).
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0453_espace_formateur_emargement_retour.sql

create table if not exists public.trainer_halfday_signatures (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  trainer_id uuid not null references public.trainers(id) on delete cascade,
  date date not null,
  period text not null check (period in ('morning', 'afternoon')),
  signature text not null check (signature like 'data:image/%' and length(signature) between 100 and 500000),
  signed_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint trainer_halfday_signatures_uniq unique (session_id, trainer_id, date, period)
);
create index if not exists trainer_halfday_signatures_company_idx on public.trainer_halfday_signatures (company_id);
comment on table public.trainer_halfday_signatures is 'Émargement : signature du formateur pour chaque demi-journée tenue, écrite seulement par public.formateur_signer, jamais remplacée';

alter table public.trainer_halfday_signatures enable row level security;
revoke all on table public.trainer_halfday_signatures from public, anon;
grant all on table public.trainer_halfday_signatures to service_role;
grant select on table public.trainer_halfday_signatures to authenticated;

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

drop policy if exists trainer_halfday_signatures_lire on public.trainer_halfday_signatures;
-- Lue par le suivi des sessions et par le formateur de ses sessions ; écrite seulement par la base
select pg_temp.regles(array['trainer_halfday_signatures'], null,
  $r$(company_id in (select app.societes_avec_droit('formation.suivi.voir')) or ((select app.a_le_droit('formation.sessions.voir_siennes')) and session_id in (select app.trainer_session_ids())))$r$,
  null, null, null);
drop policy if exists trainer_halfday_signatures_societe_lire on public.trainer_halfday_signatures;
create policy trainer_halfday_signatures_societe_lire on public.trainer_halfday_signatures as restrictive for select to authenticated
  using (company_id in (select app.societes_lisibles()));

-- ── 2. Formateur externe de la session ──
create or replace function app.ext_formateur_de(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1 from public.profiles p
    join public.sessions s on s.id = p_session_id
    where p.id = (select auth.uid()) and p.role = 'formateur_externe' and coalesce(p.is_active, true) and p.trainer_id is not null
      and (s.trainer_id = p.trainer_id
           or exists (select 1 from public.session_trainers x where x.session_id = s.id and x.trainer_id = p.trainer_id))
  ), false)
$$;
revoke all on function app.ext_formateur_de(uuid) from public, anon;
grant execute on function app.ext_formateur_de(uuid) to authenticated;

-- Formateur (salarié ou externe) du compte connecté sur cette session, sinon null
create or replace function app.formateur_de_session(p_session_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.trainer_id from public.profiles p
  join public.sessions s on s.id = p_session_id
  where p.id = (select auth.uid()) and coalesce(p.is_active, true) and p.trainer_id is not null
    and (s.trainer_id = p.trainer_id
         or exists (select 1 from public.session_trainers x where x.session_id = s.id and x.trainer_id = p.trainer_id))
  limit 1
$$;
revoke all on function app.formateur_de_session(uuid) from public, anon;
grant execute on function app.formateur_de_session(uuid) to authenticated;

-- ── 3. Feuille de signature ouverte au formateur externe de la session ──
do $do$
declare
  r record;
  v_def text;
begin
  for r in select * from (values
      ('public.get_trainer_sign_data(uuid)', 'IF NOT app.can_read_session(p_session_id) THEN',
       'IF NOT (app.can_read_session(p_session_id) OR app.ext_formateur_de(p_session_id)) /* 0453 */ THEN'),
      ('public.trainer_sign_halfday(uuid, uuid, date, text, text, timestamptz, text)', 'IF NOT app.can_edit_session(p_session_id) THEN',
       'IF NOT (app.can_edit_session(p_session_id) OR app.ext_formateur_de(p_session_id)) /* 0453 */ THEN'),
      ('public.trainer_proxy_sign(uuid, uuid, date, text, text, text, text, text, text, text, text)', 'IF NOT app.can_edit_session(p_session_id) THEN',
       'IF NOT (app.can_edit_session(p_session_id) OR app.ext_formateur_de(p_session_id)) /* 0453 */ THEN')
    ) as t(sig, ancien, nouveau) loop
    v_def := pg_get_functiondef(r.sig::regprocedure);
    continue when position('/* 0453 */' in v_def) > 0;
    if position(r.ancien in v_def) = 0 then
      raise exception 'Fonction % inattendue : rien n''est changé', r.sig;
    end if;
    execute replace(v_def, r.ancien, r.nouveau);
  end loop;
end
$do$;

-- ── 4. Signature du formateur par demi-journée ──
create or replace function public.formateur_signatures(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_tr uuid := app.formateur_de_session(p_session_id);
begin
  if v_tr is null then
    return jsonb_build_object('ok', false, 'error', 'Vous n''êtes pas formateur de cette session');
  end if;
  return jsonb_build_object('ok', true,
    'trainer', (select jsonb_build_object('id', t.id, 'first_name', t.first_name, 'last_name', t.last_name) from public.trainers t where t.id = v_tr),
    'signes', coalesce((select jsonb_agg(jsonb_build_object('date', h.date, 'period', h.period, 'signed_at', h.signed_at) order by h.date, h.period desc)
                        from public.trainer_halfday_signatures h where h.session_id = p_session_id and h.trainer_id = v_tr), '[]'::jsonb));
end
$$;
revoke all on function public.formateur_signatures(uuid) from public, anon;
grant execute on function public.formateur_signatures(uuid) to authenticated;

create or replace function public.formateur_signer(p_session_id uuid, p_date date, p_period text, p_signature text, p_signed_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tr uuid := app.formateur_de_session(p_session_id);
  s record;
  v_at timestamptz;
  v_id uuid;
begin
  if v_tr is null then
    return jsonb_build_object('ok', false, 'error', 'Vous n''êtes pas formateur de cette session');
  end if;
  if p_period is null or p_period not in ('morning', 'afternoon') then
    return jsonb_build_object('ok', false, 'error', 'Demi-journée inconnue');
  end if;
  if p_signature is null or length(p_signature) < 100 or length(p_signature) > 500000 or p_signature not like 'data:image/%' then
    return jsonb_build_object('ok', false, 'error', 'Signature manquante ou illisible');
  end if;
  select id, company_id, start_date, end_date, start_time into s from public.sessions where id = p_session_id;
  if p_date is null or p_date < s.start_date or p_date > s.end_date then
    return jsonb_build_object('ok', false, 'error', 'Date hors de la session');
  end if;
  if p_date > public.paris_today() then
    return jsonb_build_object('ok', false, 'error', 'Impossible de signer une demi-journée à venir');
  end if;
  if not exists (select 1 from public.session_half_days(p_session_id) hd where hd.d = p_date and hd.period = p_period) then
    return jsonb_build_object('ok', false, 'error', 'Cette demi-journée ne fait pas partie de la formation');
  end if;
  if now() < ((s.start_date + coalesce(s.start_time, '09:00'::time)) at time zone 'Europe/Paris') - interval '1 hour' then
    return jsonb_build_object('ok', false, 'error', 'La formation n''a pas encore commencé');
  end if;
  if public.paris_today() > s.end_date and not public.is_signature_admin() then
    return jsonb_build_object('ok', false, 'error', 'Session terminée : la régularisation se fait depuis un compte administrateur');
  end if;
  -- Heure réelle, bornée comme pour les stagiaires : jamais dans le futur, jamais avant la demi-journée
  v_at := least(coalesce(p_signed_at, now()), now());
  if v_at < (p_date::timestamp at time zone 'Europe/Paris') then v_at := now(); end if;
  insert into public.trainer_halfday_signatures (company_id, session_id, trainer_id, date, period, signature, signed_at)
  values (s.company_id, p_session_id, v_tr, p_date, p_period, p_signature, v_at)
  on conflict (session_id, trainer_id, date, period) do nothing
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'Vous avez déjà signé cette demi-journée');
  end if;
  return jsonb_build_object('ok', true, 'signed_at', v_at);
end
$$;
revoke all on function public.formateur_signer(uuid, date, text, text, timestamptz) from public, anon;
grant execute on function public.formateur_signer(uuid, date, text, text, timestamptz) to authenticated;

insert into public.schema_migrations (version) values ('0453_espace_formateur_emargement') on conflict (version) do nothing;

-- ===== supabase/rollback/0453_espace_formateur_emargement_retour.sql =====
-- Retour arrière de 0453_espace_formateur_emargement.sql. Idempotent. Refusé s'il existe des signatures de formateur
-- (ce sont des preuves d'émargement : elles seraient perdues).
do $do$
begin
  if to_regclass('public.trainer_halfday_signatures') is not null and exists (select 1 from public.trainer_halfday_signatures) then
    raise exception 'Des signatures de formateur existent : retour arrière refusé';
  end if;
end
$do$;

-- Gardes d'avant 0453 sur la feuille de signature
do $do$
declare
  r record;
  v_def text;
begin
  for r in select * from (values
      ('public.get_trainer_sign_data(uuid)', 'IF NOT app.can_read_session(p_session_id) THEN',
       'IF NOT (app.can_read_session(p_session_id) OR app.ext_formateur_de(p_session_id)) /* 0453 */ THEN'),
      ('public.trainer_sign_halfday(uuid, uuid, date, text, text, timestamptz, text)', 'IF NOT app.can_edit_session(p_session_id) THEN',
       'IF NOT (app.can_edit_session(p_session_id) OR app.ext_formateur_de(p_session_id)) /* 0453 */ THEN'),
      ('public.trainer_proxy_sign(uuid, uuid, date, text, text, text, text, text, text, text, text)', 'IF NOT app.can_edit_session(p_session_id) THEN',
       'IF NOT (app.can_edit_session(p_session_id) OR app.ext_formateur_de(p_session_id)) /* 0453 */ THEN')
    ) as t(sig, ancien, nouveau) loop
    v_def := pg_get_functiondef(r.sig::regprocedure);
    if position(r.nouveau in v_def) > 0 then
      execute replace(v_def, r.nouveau, r.ancien);
    end if;
  end loop;
end
$do$;

drop function if exists public.formateur_signer(uuid, date, text, text, timestamptz);
drop function if exists public.formateur_signatures(uuid);
drop function if exists app.formateur_de_session(uuid);
drop function if exists app.ext_formateur_de(uuid);
drop table if exists public.trainer_halfday_signatures;
delete from public.schema_migrations where version = '0453_espace_formateur_emargement';

do $verif$
declare
  v_diff text[];
  v_n int;
  v_par text;
begin
  select count(*), (array_agg(coalesce(a.kind, b.kind) || ' ' || coalesce(a.name, b.name) || case
           when a.name is null then ' (en trop après retour)' when b.name is null then ' (manquant après retour)'
           else ' (différent)' end order by coalesce(a.kind, b.kind) desc, coalesce(a.name, b.name)))[1:40]
    into v_n, v_diff
  from etat_essai_avant a full join etat_essai b on a.kind = b.kind and a.name = b.name
  where a.v is distinct from b.v;
  select string_agg(k || ' ' || n, ', ') into v_par from (
    select coalesce(a.kind, b.kind) k, count(*) n
    from etat_essai_avant a full join etat_essai b on a.kind = b.kind and a.name = b.name
    where a.v is distinct from b.v group by 1) z;
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE ef_0453 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
