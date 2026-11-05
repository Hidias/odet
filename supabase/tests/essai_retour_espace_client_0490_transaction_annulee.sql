-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (espace_client_0490) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0490_espace_client_retrait_supprimes.sql, retour arrière,
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

-- ===== supabase/migrations/0490_espace_client_retrait_supprimes.sql =====
-- 0490 : un devis ou un groupe inter supprimé n'est plus visible dans l'espace client (décision de H, 05/11).
-- Jusqu'ici, supprimer un devis publié (ou un groupe dont la convention était mise à signer) laissait son PDF
-- visible, et même signable, dans l'espace du client. Désormais la suppression retire le document : il est gardé,
-- avec la date, l'auteur et le motif du retrait (une ligne de client_shared_documents ne s'efface jamais, 0404).
-- La signature en ligne refuse déjà un document retiré (0420). Rien ne part par e-mail. Aucune donnée supprimée.
-- Convention ou contrat d'un groupe inter (0420) : les contraintes de 0404 n'acceptaient pas l'objet « session_group »,
-- si bien que sa mise à disposition échouait toujours (0 document de groupe en production, relevé le 05/11). Elles
-- l'acceptent désormais ; tant qu'il n'est pas signé, un nouveau document du groupe remplace le précédent
-- (api/documents-client.js), comme pour un contrat de maintenance.
-- Idempotente. Retour arrière : supabase/rollback/0490_espace_client_retrait_supprimes_retour.sql

alter table public.client_shared_documents drop constraint if exists client_shared_documents_object_type_check;
alter table public.client_shared_documents add constraint client_shared_documents_object_type_check
  check (object_type in ('client', 'session', 'invoice', 'quote', 'itv_visit', 'itv_contract', 'session_group'));
alter table public.portal_events drop constraint if exists portal_events_object_type_check;
alter table public.portal_events add constraint portal_events_object_type_check
  check (object_type is null or object_type in ('client', 'session', 'invoice', 'quote', 'itv_visit', 'itv_contract', 'session_group'));

create or replace function app.espace_client_retirer_supprime()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.client_shared_documents
     set withdrawn_at = now(),
         withdrawn_reason = case tg_argv[0] when 'quote' then 'Devis supprimé' else 'Groupe supprimé' end
   where object_type = tg_argv[0] and object_id = old.id and withdrawn_at is null;
  return old;
end
$$;
revoke all on function app.espace_client_retirer_supprime() from public, anon, authenticated;
comment on function app.espace_client_retirer_supprime() is 'Retire de l''espace client le document d''un devis ou d''un groupe inter supprimé (0490)';

drop trigger if exists quotes_retrait_espace_client on public.quotes;
create trigger quotes_retrait_espace_client after delete on public.quotes
  for each row execute function app.espace_client_retirer_supprime('quote');

drop trigger if exists session_groups_retrait_espace_client on public.session_groups;
create trigger session_groups_retrait_espace_client after delete on public.session_groups
  for each row execute function app.espace_client_retirer_supprime('session_group');

insert into public.schema_migrations (version) values ('0490_espace_client_retrait_supprimes') on conflict (version) do nothing;

-- ===== supabase/rollback/0490_espace_client_retrait_supprimes_retour.sql =====
-- Retour arrière de 0490 : déclencheurs et fonction retirés, contraintes remises comme en 0404. Les documents déjà
-- retirés restent retirés. Échoue si un document ou un événement de groupe existe déjà (à retirer d'abord).
drop trigger if exists quotes_retrait_espace_client on public.quotes;
drop trigger if exists session_groups_retrait_espace_client on public.session_groups;
drop function if exists app.espace_client_retirer_supprime();
alter table public.client_shared_documents drop constraint if exists client_shared_documents_object_type_check;
alter table public.client_shared_documents add constraint client_shared_documents_object_type_check
  check (object_type = any (array['client', 'session', 'invoice', 'quote', 'itv_visit', 'itv_contract']));
alter table public.portal_events drop constraint if exists portal_events_object_type_check;
alter table public.portal_events add constraint portal_events_object_type_check
  check (object_type is null or object_type in ('client', 'session', 'invoice', 'quote', 'itv_visit', 'itv_contract'));

delete from public.schema_migrations where version = '0490_espace_client_retrait_supprimes';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE espace_client_0490 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
