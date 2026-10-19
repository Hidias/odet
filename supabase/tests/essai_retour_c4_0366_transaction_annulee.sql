-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (c4_0366) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0366_facturation_transmission.sql, retour arrière,
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

-- ===== supabase/migrations/0366_facturation_transmission.sql =====
-- 0366_facturation_transmission.sql : transmission des factures au comptable, réglée par société (Facturation fiable).
--
-- Rien n'est supposé : tant que la société n'a pas choisi son mode de transmission, l'envoi au comptable est désactivé
-- avec un message. Le destinataire reste celui des Paramètres (comptable_* de l'organisme) jusqu'au chantier C2.
--   billing_settings.comptable_transmission : email_facturx (récapitulatif mensuel et Factur-X de chaque facture),
--     email_pdf (récapitulatif mensuel et PDF simple) ; vide = envoi désactivé ;
--   billing_settings.plateforme_agreee : plateforme de dématérialisation retenue (renseignement, branchement plus tard) ;
--   billing_transmission_mode() : mode de la société courante, lu par l'écran et par /api/send-invoices-comptable,
--     qui n'envoie plus que des factures et avoirs émis.
-- Aucune nouvelle table. Idempotente. Retour arrière : supabase/rollback/0366_facturation_transmission_retour.sql

alter table public.billing_settings add column if not exists comptable_transmission text;
alter table public.billing_settings add column if not exists plateforme_agreee text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'billing_settings_comptable_transmission_check') then
    alter table public.billing_settings add constraint billing_settings_comptable_transmission_check
      check (comptable_transmission is null or comptable_transmission in ('email_facturx', 'email_pdf'));
  end if;
end
$$;
comment on column public.billing_settings.comptable_transmission is 'Transmission au comptable : email_facturx, email_pdf ; vide = envoi désactivé (rien n''est supposé)';
comment on column public.billing_settings.plateforme_agreee is 'Plateforme de dématérialisation retenue par la société (renseignement, branchement par API plus tard)';

create or replace function public.billing_transmission_mode()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.comptable_transmission from public.billing_settings s
  where s.company_id = app.billing_company()
    and app.un_des_droits(array['facturation.export.comptable', 'facturation.factures.voir'])
$$;

revoke all on function public.billing_transmission_mode() from public, anon;
grant execute on function public.billing_transmission_mode() to authenticated, service_role;

insert into public.schema_migrations (version) values ('0366_facturation_transmission') on conflict (version) do nothing;

-- ===== supabase/rollback/0366_facturation_transmission_retour.sql =====
-- Retour arrière de 0366_facturation_transmission.sql : réglage de transmission retiré. Idempotent.

drop function if exists public.billing_transmission_mode();
alter table public.billing_settings drop constraint if exists billing_settings_comptable_transmission_check;
alter table public.billing_settings drop column if exists comptable_transmission, drop column if exists plateforme_agreee;

delete from public.schema_migrations where version = '0366_facturation_transmission';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE c4_0366 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
