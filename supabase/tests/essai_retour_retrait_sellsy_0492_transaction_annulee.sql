-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (retrait_sellsy_0492) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0492_retrait_sellsy.sql, retour arrière,
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

-- ===== supabase/migrations/0492_retrait_sellsy.sql =====
-- 0492 : retrait des colonnes héritées de l'import Sellsy (B22). Depuis 0491 et #294, l'import est générique et les
-- identifiants de l'ancien outil vont dans external_source et external_ref ; plus aucun écran ni aucune fonction ne lit
-- ni n'écrit clients.sellsy_id, client_contacts.sellsy_contact_id, invoices.sellsy_reference, courses.sellsy_id
-- (contrôle du 05/11 : 0 valeur dans les quatre colonnes en production, seule dépendance la vue v_clients_a_appeler).
-- La vue est recréée avec les seules colonnes du contact qu'elle utilise (mêmes colonnes en sortie). Le retrait est
-- refusé si une des colonnes contient une valeur : rien n'est perdu. La contrainte clients_sellsy_id_key et les index
-- idx_clients_sellsy et idx_courses_sellsy_id partent avec leurs colonnes.
-- Idempotente. Retour arrière : supabase/rollback/0492_retrait_sellsy_retour.sql

do $$
declare
  v record;
  v_plein boolean;
begin
  for v in select * from (values ('clients', 'sellsy_id'), ('client_contacts', 'sellsy_contact_id'),
                                 ('invoices', 'sellsy_reference'), ('courses', 'sellsy_id')) t(tbl, col) loop
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = v.tbl and column_name = v.col) then
      execute format('select exists (select 1 from public.%I where nullif(btrim(%I::text), %L) is not null)', v.tbl, v.col, '') into v_plein;
      if v_plein then
        raise exception '0492 : %.% contient une valeur, retrait refusé (la recopier d''abord dans external_ref)', v.tbl, v.col;
      end if;
    end if;
  end loop;
end $$;

create or replace view public.v_clients_a_appeler
with (security_invoker = true)
as
with ech as (
  select d.company_id, d.client_id, min(d.due_on) as premiere_echeance, count(*)::int as nb_echeances,
         array_agg(distinct d.kind order by d.kind) as natures,
         bool_or(d.due_on < current_date) as depassee
  from public.v_obligation_deadlines d
  where d.due_on <= current_date + 90
  group by d.company_id, d.client_id
)
select e.company_id, e.client_id, c.name as client_name, c.city, c.status as client_status, e.premiere_echeance,
       e.nb_echeances, e.natures, e.depassee,
       ('appel' = any (c.opposition_canaux)) as ne_pas_appeler,
       ct.id as contact_id, coalesce(nullif(btrim(concat_ws(' ', ct.first_name, ct.last_name)), ''), ct.name, c.contact_name) as contact_name,
       coalesce(nullif(ct.mobile, ''), nullif(ct.phone, ''), nullif(c.contact_phone, ''), nullif(c.mobile, '')) as contact_phone,
       exists (select 1 from public.opportunities o where o.client_id = e.client_id and o.stage not in ('gagnee', 'perdue')) as affaire_en_cours,
       exists (select 1 from public.quotes q where q.client_id = e.client_id and q.status in ('draft', 'sent')) as devis_en_cours,
       (select max(i.interaction_date) from public.client_interactions i where i.client_id = e.client_id) as dernier_echange,
       c.owner_id
from ech e
join public.clients c on c.id = e.client_id
left join lateral (
  select x.id, x.name, x.first_name, x.last_name, x.mobile, x.phone from public.client_contacts x where x.client_id = e.client_id
  order by x.is_primary desc nulls last, x.created_at limit 1
) ct on true
where coalesce(c.status, '') not in ('archive', 'inactif');

alter table public.clients drop column if exists sellsy_id;
alter table public.client_contacts drop column if exists sellsy_contact_id;
alter table public.invoices drop column if exists sellsy_reference;
alter table public.courses drop column if exists sellsy_id;

insert into public.schema_migrations (version) values ('0492_retrait_sellsy') on conflict (version) do nothing;

-- ===== supabase/rollback/0492_retrait_sellsy_retour.sql =====
-- Retour arrière de 0492 : les quatre colonnes héritées reviennent vides (elles l'étaient au retrait, 0492 refuse sinon),
-- avec la contrainte unique clients_sellsy_id_key, les index idx_clients_sellsy et idx_courses_sellsy_id, et la vue
-- v_clients_a_appeler dans sa définition d'avant 0492. Possible même après usage : aucune contrainte ajoutée ne peut
-- être violée par des lignes nouvelles (colonnes vides). Les identifiants importés restent dans external_ref.

alter table public.clients add column if not exists sellsy_id character varying(50);
alter table public.client_contacts add column if not exists sellsy_contact_id character varying(50);
alter table public.invoices add column if not exists sellsy_reference character varying;
alter table public.courses add column if not exists sellsy_id text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_sellsy_id_key') then
    alter table public.clients add constraint clients_sellsy_id_key unique (sellsy_id);
  end if;
end $$;
create index if not exists idx_clients_sellsy on public.clients using btree (sellsy_id);
create index if not exists idx_courses_sellsy_id on public.courses using btree (sellsy_id) where (sellsy_id is not null);

create or replace view public.v_clients_a_appeler
with (security_invoker = true)
as
with ech as (
  select d.company_id, d.client_id, min(d.due_on) as premiere_echeance, count(*)::int as nb_echeances,
         array_agg(distinct d.kind order by d.kind) as natures,
         bool_or(d.due_on < current_date) as depassee
  from public.v_obligation_deadlines d
  where d.due_on <= current_date + 90
  group by d.company_id, d.client_id
)
select e.company_id, e.client_id, c.name as client_name, c.city, c.status as client_status, e.premiere_echeance,
       e.nb_echeances, e.natures, e.depassee,
       ('appel' = any (c.opposition_canaux)) as ne_pas_appeler,
       ct.id as contact_id, coalesce(nullif(btrim(concat_ws(' ', ct.first_name, ct.last_name)), ''), ct.name, c.contact_name) as contact_name,
       coalesce(nullif(ct.mobile, ''), nullif(ct.phone, ''), nullif(c.contact_phone, ''), nullif(c.mobile, '')) as contact_phone,
       exists (select 1 from public.opportunities o where o.client_id = e.client_id and o.stage not in ('gagnee', 'perdue')) as affaire_en_cours,
       exists (select 1 from public.quotes q where q.client_id = e.client_id and q.status in ('draft', 'sent')) as devis_en_cours,
       (select max(i.interaction_date) from public.client_interactions i where i.client_id = e.client_id) as dernier_echange,
       c.owner_id
from ech e
join public.clients c on c.id = e.client_id
left join lateral (
  select x.id, x.client_id, x.name, x.role, x.email, x.phone, x.is_primary, x.created_at, x.updated_at, x.civilite,
         x.first_name, x.last_name, x.mobile, x.fonction, x.is_billing, x.is_followup, x.notes, x.sellsy_contact_id,
         x.is_document_contact, x.company_id, x.company_ids, x.site_id
  from public.client_contacts x where x.client_id = e.client_id
  order by x.is_primary desc nulls last, x.created_at limit 1
) ct on true
where coalesce(c.status, '') not in ('archive', 'inactif');

delete from public.schema_migrations where version = '0492_retrait_sellsy';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE retrait_sellsy_0492 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
