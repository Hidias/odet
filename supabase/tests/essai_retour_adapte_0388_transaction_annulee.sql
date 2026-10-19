-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (adapte_0388) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0388_affichage_adapte.sql, retour arrière,
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

-- ===== supabase/migrations/0388_affichage_adapte.sql =====
-- 0388_affichage_adapte.sql : affichage adapté réglé pour une autre personne (décision de H du 19/10, 23h15).
--
--   Chacun règle son affichage adapté lui-même (français facile, lecture à voix haute, texte agrandi, contraste
--   renforcé), dans le menu Affichage. La RH, l'administrateur, la direction et le super administrateur peuvent aussi
--   le régler pour une personne de leur société (par exemple un technicien, à son arrivée). Le motif n'est jamais
--   demandé ni enregistré : le réglage ne doit rien révéler de la santé de la personne.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0388_affichage_adapte_retour.sql

create or replace function public.affichage_adapte_regler(p_profile uuid, p_adapte jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ok boolean;
  v jsonb := '{}'::jsonb;
  k text;
begin
  if p_profile is null then raise exception 'Personne inconnue' using errcode = '22023'; end if;
  -- Soi-même, ou RH / administrateur / direction d'une société commune
  v_ok := p_profile = (select auth.uid()) or app.is_superadmin() or exists (
    select 1 from public.company_members m
    where m.profile_id = p_profile and m.is_active
      and (coalesce(app.company_role(m.company_id), '') in ('admin', 'direction')
           or m.company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))));
  if not v_ok then
    raise exception 'Réservé à la personne, à la RH et à la direction' using errcode = '42501';
  end if;
  foreach k in array array['facile', 'voix', 'grand', 'contraste'] loop
    if coalesce((p_adapte ->> k)::boolean, false) then v := v || jsonb_build_object(k, true); end if;
  end loop;
  update public.profiles set ui_prefs = coalesce(ui_prefs, '{}'::jsonb) || jsonb_build_object('adapte', v) where id = p_profile;
  return v;
end
$$;
revoke all on function public.affichage_adapte_regler(uuid, jsonb) from public, anon;
grant execute on function public.affichage_adapte_regler(uuid, jsonb) to authenticated;

-- Lecture du réglage d'une personne (mêmes droits)
create or replace function public.affichage_adapte_lire(p_profile uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p.ui_prefs -> 'adapte', '{}'::jsonb) from public.profiles p
  where p.id = p_profile and (p_profile = (select auth.uid()) or app.is_superadmin() or exists (
    select 1 from public.company_members m where m.profile_id = p_profile and m.is_active
      and (coalesce(app.company_role(m.company_id), '') in ('admin', 'direction')
           or m.company_id in (select app.societes_avec_droit('rh.dossiers.gerer')))))
$$;
revoke all on function public.affichage_adapte_lire(uuid) from public, anon;
grant execute on function public.affichage_adapte_lire(uuid) to authenticated;

insert into public.schema_migrations (version) values ('0388_affichage_adapte') on conflict (version) do nothing;

-- ===== supabase/rollback/0388_affichage_adapte_retour.sql =====
-- Retour arrière de 0388_affichage_adapte.sql. Les réglages déjà enregistrés restent dans les préférences. Idempotent.

drop function if exists public.affichage_adapte_lire(uuid);
drop function if exists public.affichage_adapte_regler(uuid, jsonb);

delete from public.schema_migrations where version = '0388_affichage_adapte';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE adapte_0388 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
