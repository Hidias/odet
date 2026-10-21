-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (emargement_0417) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0417_emargement_sans_reseau.sql, retour arrière,
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

-- ===== supabase/migrations/0417_emargement_sans_reseau.sql =====
-- 0417 : émargement sans réseau (suggestion validée par H le 21/10). En salle, le réseau peut tomber : la signature
-- faite sur le portail est gardée sur le téléphone du stagiaire et envoyée dès le retour du réseau, avec l'heure à
-- laquelle elle a été faite. Pour la preuve, l'heure de réception par le serveur est notée à côté.
--   1. attendance_halfdays : heure de réception d'une signature envoyée en différé (matin, après-midi).
--   2. public.portal_sign_halfday_differe : mêmes contrôles que la signature en direct (lien de la session,
--      stagiaire inscrit et présent, demi-journée de la formation, après-midi à partir de 13 h, déjà signée),
--      appliqués à l'heure de la signature ; celle-ci doit dater de moins de 48 heures et ne pas être dans le futur.
-- La signature en direct (portal_sign_halfday) n'est pas modifiée. Migration additive. Idempotente.
-- Retour arrière : supabase/rollback/0417_emargement_sans_reseau_retour.sql

alter table public.attendance_halfdays add column if not exists signed_morning_received_at timestamptz;
alter table public.attendance_halfdays add column if not exists signed_afternoon_received_at timestamptz;
comment on column public.attendance_halfdays.signed_morning_received_at is
  'Signature du matin faite sans réseau : heure de réception par le serveur (signed_morning_at = heure de la signature)';
comment on column public.attendance_halfdays.signed_afternoon_received_at is
  'Signature de l''après-midi faite sans réseau : heure de réception par le serveur (signed_afternoon_at = heure de la signature)';

create or replace function public.portal_sign_halfday_differe(p_token text, p_trainee_id uuid, p_period text,
                                                              p_signature text, p_signed_at timestamptz)
returns json
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  s record;
  v_refus text;
  v_date date;
  v_heure time;
  v_name text;
begin
  select id, signature_mode into s from sessions where attendance_token = p_token;
  if s.id is null then return json_build_object('ok', false, 'error', 'Lien invalide'); end if;
  if s.signature_mode = 'ferme' then
    return json_build_object('ok', false, 'error', 'Les signatures sont fermées : voyez avec votre formateur');
  end if;
  if p_signed_at is null or p_signed_at > now() + interval '5 minutes' or p_signed_at < now() - interval '48 hours' then
    return json_build_object('ok', false, 'error', 'Signature trop ancienne pour être envoyée : voyez avec votre formateur');
  end if;
  v_date := (p_signed_at at time zone 'Europe/Paris')::date;
  v_heure := (p_signed_at at time zone 'Europe/Paris')::time;
  if s.signature_mode is distinct from 'ouvert' and p_period = 'afternoon' and v_heure < '13:00'::time then
    return json_build_object('ok', false, 'error', 'L''après-midi se signe à partir de 13h');
  end if;
  v_refus := signature_refusal(s.id, p_trainee_id, v_date, p_period, p_signature);
  if v_refus is not null then return json_build_object('ok', false, 'error', v_refus); end if;

  select trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) into v_name from trainees where id = p_trainee_id;
  perform write_halfday_signature(s.id, p_trainee_id, v_date, p_period, p_signature, least(p_signed_at, now()), v_name);
  update attendance_halfdays
     set signed_morning_received_at = case when p_period = 'morning' then now() else signed_morning_received_at end,
         signed_afternoon_received_at = case when p_period = 'afternoon' then now() else signed_afternoon_received_at end
   where session_id = s.id and trainee_id = p_trainee_id and date = v_date;
  return json_build_object('ok', true, 'date', v_date, 'period', p_period);
end
$$;
revoke all on function public.portal_sign_halfday_differe(text, uuid, text, text, timestamptz) from public;
grant execute on function public.portal_sign_halfday_differe(text, uuid, text, text, timestamptz) to anon, authenticated;

insert into public.schema_migrations (version) values ('0417_emargement_sans_reseau') on conflict (version) do nothing;

-- ===== supabase/rollback/0417_emargement_sans_reseau_retour.sql =====
-- Retour arrière de 0417_emargement_sans_reseau.sql. Les signatures déjà reçues restent ; seule l'heure de réception
-- des envois différés est effacée. Idempotent.

drop function if exists public.portal_sign_halfday_differe(text, uuid, text, text, timestamptz);
alter table public.attendance_halfdays drop column if exists signed_afternoon_received_at;
alter table public.attendance_halfdays drop column if exists signed_morning_received_at;

delete from public.schema_migrations where version = '0417_emargement_sans_reseau';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE emargement_0417 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
