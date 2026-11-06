-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (signataire_0496) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0496_signataire_prevu.sql, retour arrière,
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

-- ===== supabase/migrations/0496_signataire_prevu.sql =====
-- 0496 : espace client, signataire prévu proposé à la signature d'un document (reste du 05/11, décision de H du 06/11).
-- Dans l'espace ouvert par lien et code, le nom du signataire était un champ vide et libre, même quand le document
-- imprime « Représenté par » une autre personne. La base donne désormais le signataire prévu par le document lui-même,
-- jamais un nom envoyé par le navigateur : pour la convention ou le contrat d'un groupe inter (object_type
-- 'session_group'), le contact choisi dans le groupe (même client), ou le particulier. Rien pour les autres documents.
-- L'écran pré-remplit ce nom, modifiable ; un nom différent est signalé et écrit dans la preuve.
-- Trois fonctions ajoutées, en lecture seule ; aucune donnée touchée.

create or replace function app.signataire_prevu(p_client uuid, p_document uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case when r->>'name' is not null and r->>'name' <> '' then r end
    from (
      select case when g.kind = 'particulier'
        then jsonb_build_object('name', btrim(coalesce(cl.name, '')), 'role', '')
        else (
          select jsonb_build_object(
            'name', coalesce(nullif(btrim(c.name), ''), btrim(concat_ws(' ', nullif(btrim(c.first_name), ''), nullif(btrim(c.last_name), '')))),
            'role', btrim(coalesce(nullif(btrim(c.fonction), ''), c.role, '')))
          from public.client_contacts c
          where c.id = g.contact_id and c.client_id = g.client_id)
        end as r
      from public.client_shared_documents d
      join public.session_groups g on g.id = d.object_id
      join public.clients cl on cl.id = g.client_id
      where d.id = p_document and d.client_id = p_client and d.object_type = 'session_group'
        and d.withdrawn_at is null and g.client_id = p_client
    ) x
  ), '{}'::jsonb)
$$;
revoke all on function app.signataire_prevu(uuid, uuid) from public, anon, authenticated;

-- Espace par lien et code
create or replace function public.client_portal_signataire_prevu(p_token text, p_code text, p_document uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_check jsonb := public.client_portal_check(p_token, p_code);
begin
  if v_check ? 'error' then return v_check; end if;
  return app.signataire_prevu((v_check->>'client_id')::uuid, p_document);
end
$$;
revoke all on function public.client_portal_signataire_prevu(text, text, uuid) from public;
grant execute on function public.client_portal_signataire_prevu(text, text, uuid) to anon, authenticated;

-- Espace avec compte
create or replace function public.ent_signataire_prevu(p_document uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.client_accounts := app.ent_compte();
begin
  return app.signataire_prevu(v.client_id, p_document);
end
$$;
revoke all on function public.ent_signataire_prevu(uuid) from public, anon;
grant execute on function public.ent_signataire_prevu(uuid) to authenticated;

insert into public.schema_migrations (version) values ('0496_signataire_prevu') on conflict (version) do nothing;

-- ===== supabase/rollback/0496_signataire_prevu_retour.sql =====
-- Retour arrière de 0496 : les trois fonctions de lecture du signataire prévu sont retirées (aucune donnée touchée ;
-- l'écran retombe sur un nom vide, comme avant).

drop function if exists public.ent_signataire_prevu(uuid);
drop function if exists public.client_portal_signataire_prevu(text, text, uuid);
drop function if exists app.signataire_prevu(uuid, uuid);

delete from public.schema_migrations where version = '0496_signataire_prevu';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE signataire_0496 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
