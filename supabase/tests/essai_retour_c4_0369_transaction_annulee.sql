-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (c4_0369) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0369_facturation_compteur_demo.sql, retour arrière,
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

-- ===== supabase/migrations/0369_facturation_compteur_demo.sql =====
-- 0369_facturation_compteur_demo.sql : compteur des numéros pendant la démonstration (Facturation fiable).
--
-- Décision de H (19/10) : le dernier numéro réel de GLD n'est pas encore connu et changera d'ici la mise en service.
-- Tant que l'organisme est en mode démonstration, le super administrateur peut remettre le compteur à zéro
-- (billing_counter_reset), même après des émissions de test ; le réglage « dernier numéro avant l'outil » redevient
-- alors modifiable. Hors mode démonstration, refusé : le compteur réel ne recule jamais.
-- Aucune nouvelle table, aucun verrou modifié. Idempotente.
-- Retour arrière : supabase/rollback/0369_facturation_compteur_demo_retour.sql

create or replace function public.billing_counter_reset()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := app.billing_company();
  v_n int;
begin
  if not app.a_le_droit('plateforme.administrer') then
    raise exception 'Réservé au super administrateur' using errcode = '42501';
  end if;
  if not coalesce((select o.demo_mode from public.organization_settings o limit 1), false) then
    raise exception 'Hors mode démonstration, le compteur des numéros ne se remet jamais à zéro' using errcode = '42501';
  end if;
  delete from public.billing_sequences where company_id = v_company;
  get diagnostics v_n = row_count;
  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_name, details)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'update', 'system',
          'Compteur des factures remis à zéro (démonstration)', jsonb_build_object('company_id', v_company, 'series', v_n));
  return v_n > 0;
end
$$;

revoke all on function public.billing_counter_reset() from public, anon;
grant execute on function public.billing_counter_reset() to authenticated;

insert into public.schema_migrations (version) values ('0369_facturation_compteur_demo') on conflict (version) do nothing;

-- ===== supabase/rollback/0369_facturation_compteur_demo_retour.sql =====
-- Retour arrière de 0369_facturation_compteur_demo.sql : retire la remise à zéro du compteur. Idempotent.

drop function if exists public.billing_counter_reset();

delete from public.schema_migrations where version = '0369_facturation_compteur_demo';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE c4_0369 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
