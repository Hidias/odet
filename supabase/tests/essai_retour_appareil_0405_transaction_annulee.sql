-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (appareil_0405) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0405_appareil_complet.sql, retour arrière,
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

-- ===== supabase/migrations/0405_appareil_complet.sql =====
-- 0405 : l'appareil d'une signature est gardé en entier.
-- La lecture des en-têtes de la requête (0346) coupait à la première virgule, utile pour l'adresse IP (liste
-- « client, relais ») mais fausse pour l'appareil : « Mozilla/5.0 (Macintosh; …) AppleWebKit/537.36 (KHTML » au lieu de
-- l'identifiant complet, d'où « navigateur, Mac » sur le dossier de preuve. L'appareil est désormais lu en entier pour
-- les signatures (stagiaires, formateurs, clients) et pour le journal des signatures de l'espace client. Les signatures
-- déjà faites gardent ce qui a été relevé (rien n'est réécrit). Idempotent.

create or replace function app.entete_complet(p_nom text)
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(left(btrim(coalesce((nullif(current_setting('request.headers', true), '')::jsonb) ->> p_nom, '')), 400), '')
$$;
revoke all on function app.entete_complet(text) from public, anon, authenticated;

create or replace function app.signature_ip()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.ip_address := coalesce(app.audit_entete('x-forwarded-for'), app.audit_entete('x-real-ip'), nullif(new.ip_address, 'unknown'));
  new.user_agent := coalesce(app.entete_complet('user-agent'), new.user_agent);
  return new;
end
$$;
revoke all on function app.signature_ip() from public, anon, authenticated;

-- Journal des signatures de l'espace client (0402) : même lecture complète
do $patch$
declare
  v_def text := pg_get_functiondef('app.portail_signer(uuid,text,uuid,uuid,uuid,text,text,text,text,text,text,text)'::regprocedure);
  v_anc text := $a$left(app.audit_entete('user-agent'), 400)$a$;
  v_nouv text := $n$left(app.entete_complet('user-agent'), 400)$n$;
begin
  if position(v_nouv in v_def) > 0 then return; end if;
  if position(v_anc in v_def) = 0 then raise exception 'portail_signer : lecture de l''appareil introuvable, rien n''est modifié'; end if;
  execute replace(v_def, v_anc, v_nouv);
end
$patch$;

insert into public.schema_migrations (version) values ('0405_appareil_complet') on conflict (version) do nothing;

-- ===== supabase/rollback/0405_appareil_complet_retour.sql =====
-- Retour arrière de 0405_appareil_complet.sql : lecture de 0346 (coupée à la première virgule). Idempotent.

create or replace function app.signature_ip()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.ip_address := coalesce(app.audit_entete('x-forwarded-for'), app.audit_entete('x-real-ip'), nullif(new.ip_address, 'unknown'));
  new.user_agent := coalesce(app.audit_entete('user-agent'), new.user_agent);
  return new;
end
$$;
revoke all on function app.signature_ip() from public, anon, authenticated;

do $patch$
declare
  v_def text := pg_get_functiondef('app.portail_signer(uuid,text,uuid,uuid,uuid,text,text,text,text,text,text,text)'::regprocedure);
begin
  execute replace(v_def, $n$left(app.entete_complet('user-agent'), 400)$n$, $a$left(app.audit_entete('user-agent'), 400)$a$);
end
$patch$;
drop function if exists app.entete_complet(text);

delete from public.schema_migrations where version = '0405_appareil_complet';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE appareil_0405 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
