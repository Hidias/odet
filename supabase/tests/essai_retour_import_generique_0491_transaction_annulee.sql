-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (import_generique_0491) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0491_import_generique.sql, retour arrière,
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

-- ===== supabase/migrations/0491_import_generique.sql =====
-- 0491 : import générique (B3, décision de H du 05/11). L'import au format Sellsy devient un import CSV avec
-- correspondance des colonnes ; les identifiants de l'ancien outil sont rangés dans des colonnes génériques :
-- clients.external_source (« csv », plus tard « henrri ») et external_ref sur clients, client_contacts et invoices.
-- Les colonnes héritées sellsy_id, sellsy_contact_id et sellsy_reference (toutes vides en production, contrôle du 05/11)
-- sont recopiées dans les nouvelles colonnes, puis gardées : la version de l'application en service les écrit encore
-- jusqu'au déploiement. Leur retrait se fera dans un lot suivant. courses.sellsy_id n'a plus d'usage (import du
-- catalogue retiré, décision de H) : retrait dans ce même lot suivant. Aucune donnée supprimée.
-- Idempotente. Retour arrière : supabase/rollback/0491_import_generique_retour.sql

alter table public.clients add column if not exists external_source text;
alter table public.clients add column if not exists external_ref text;
alter table public.client_contacts add column if not exists external_ref text;
alter table public.invoices add column if not exists external_ref text;

-- Même longueur que les colonnes héritées (50) : le retour arrière y recopie les identifiants sans rien couper
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_external_ref_longueur') then
    alter table public.clients add constraint clients_external_ref_longueur check (char_length(external_ref) <= 50);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'client_contacts_external_ref_longueur') then
    alter table public.client_contacts add constraint client_contacts_external_ref_longueur check (char_length(external_ref) <= 50);
  end if;
end $$;

comment on column public.clients.external_source is 'Outil ou fichier d''origine du client importé (csv ; henrri plus tard). Vide pour un client créé dans l''application.';
comment on column public.clients.external_ref is 'Identifiant du client dans l''outil d''origine, gardé tel quel.';
comment on column public.client_contacts.external_ref is 'Identifiant du contact dans l''outil d''origine, gardé tel quel.';
comment on column public.invoices.external_ref is 'Numéro de la facture dans l''outil d''origine (historique importé), gardé tel quel.';

update public.clients set external_ref = sellsy_id, external_source = coalesce(external_source, 'sellsy')
  where nullif(btrim(sellsy_id), '') is not null and external_ref is null;
update public.client_contacts set external_ref = sellsy_contact_id
  where nullif(btrim(sellsy_contact_id), '') is not null and external_ref is null;
update public.invoices set external_ref = sellsy_reference
  where nullif(btrim(sellsy_reference), '') is not null and external_ref is null;

insert into public.schema_migrations (version) values ('0491_import_generique') on conflict (version) do nothing;

-- ===== supabase/rollback/0491_import_generique_retour.sql =====
-- Retour arrière de 0491 : les identifiants rangés dans les colonnes génériques sont recopiés dans les colonnes héritées
-- quand c'est possible : colonne héritée vide et, pour les clients, identifiant libre (index unique clients_sellsy_id_key).
-- Sinon (même identifiant sur deux clients, colonne héritée déjà remplie d'une autre valeur), l'identifiant est ajouté
-- aux notes : aucune perte. Puis les colonnes génériques sont retirées.
with candidats as (
  select id, external_ref, count(*) over (partition by external_ref) as n
  from public.clients
  where nullif(btrim(external_ref), '') is not null and nullif(btrim(sellsy_id), '') is null
)
update public.clients c set sellsy_id = k.external_ref
  from candidats k
  where c.id = k.id and k.n = 1 and not exists (select 1 from public.clients x where x.sellsy_id = k.external_ref);
update public.clients
  set notes = concat_ws(E'\n', nullif(notes, ''), 'Identifiant d''origine (' || coalesce(external_source, 'import') || ') : ' || external_ref)
  where nullif(btrim(external_ref), '') is not null and sellsy_id is distinct from external_ref;

update public.client_contacts set sellsy_contact_id = external_ref
  where nullif(btrim(external_ref), '') is not null and nullif(btrim(sellsy_contact_id), '') is null;
update public.client_contacts
  set notes = concat_ws(E'\n', nullif(notes, ''), 'Identifiant d''origine : ' || external_ref)
  where nullif(btrim(external_ref), '') is not null and sellsy_contact_id is distinct from external_ref;

update public.invoices set sellsy_reference = external_ref
  where nullif(btrim(external_ref), '') is not null and nullif(btrim(sellsy_reference), '') is null;
update public.invoices
  set notes = concat_ws(E'\n', nullif(notes, ''), 'Référence d''origine : ' || external_ref)
  where nullif(btrim(external_ref), '') is not null and sellsy_reference is distinct from external_ref;

alter table public.clients drop column if exists external_source;
alter table public.clients drop column if exists external_ref;
alter table public.client_contacts drop column if exists external_ref;
alter table public.invoices drop column if exists external_ref;

delete from public.schema_migrations where version = '0491_import_generique';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE import_generique_0491 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
