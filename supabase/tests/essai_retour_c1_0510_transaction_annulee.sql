-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (c1_0510) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0510_contrat_terme_fige.sql, retour arrière,
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

-- ===== supabase/migrations/0510_contrat_terme_fige.sql =====
-- 0510 : contrat signé, le moment de facturation (billing_term : à échoir ou à terme échu) est figé lui aussi.
-- Il change les dates de chaque facture de l'échéancier : après signature, il ne change plus que par un avenant, comme le
-- prix, la durée, la périodicité, le délai de dépannage et ce que le contrat comprend (0466). L'écran ne l'envoyait déjà
-- plus pour un contrat signé (Contrats.jsx) ; la base le refuse maintenant aussi. Corps de app.contrat_signe_fige repris
-- de 0466 ; ajouts : moment des factures, nom de l'indice et mois de la valeur de référence figés (ils sont imprimés sur
-- le contrat signé), moment des factures vide fixé à la signature selon la règle par défaut ; contrainte : une valeur de
-- référence va avec le nom ou l'identifiant de l'indice et son mois.
-- Retour arrière : supabase/rollback/0510_contrat_terme_fige_retour.sql (définition de 0466).

CREATE OR REPLACE FUNCTION app.contrat_signe_fige()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_revision boolean := coalesce(current_setting('app.revision_prix', true), '') = 'oui';
begin
  if old.signed_at is not null and (
       (new.annual_price_ht is distinct from old.annual_price_ht and not v_revision) or new.duration_years is distinct from old.duration_years
    or new.tacit_renewal is distinct from old.tacit_renewal or new.renewal_years is distinct from old.renewal_years
    or new.notice_months is distinct from old.notice_months or new.billing_period is distinct from old.billing_period
    or new.start_on is distinct from old.start_on or new.client_id is distinct from old.client_id
    or new.signed_at is distinct from old.signed_at or new.signed_name is distinct from old.signed_name
    or new.signature_id is distinct from old.signature_id or new.base_price_ht is distinct from old.base_price_ht
    or new.index_base_value is distinct from old.index_base_value or new.index_series is distinct from old.index_series
    or new.emergency_hours is distinct from old.emergency_hours or new.includes is distinct from old.includes
    or new.billing_term is distinct from old.billing_term
    or new.index_label is distinct from old.index_label or new.index_base_month is distinct from old.index_base_month) then
    raise exception 'Contrat signé : ses conditions se changent par un avenant' using errcode = '42501';
  end if;
  -- À la signature, le moment des factures vide prend la règle par défaut du moment (0461 : client public après la
  -- période, sinon au début) et ne change plus, même si le type du client change ensuite
  if old.signed_at is null and new.signed_at is not null and new.billing_term is null then
    new.billing_term := case when (select c.client_type from public.clients c where c.id = new.client_id) = 'public' then 'echu' else 'echoir' end;
  end if;
  return new;
end
$function$;

-- Clause de révision imprimée sur le contrat (relecture de 0510) : une valeur de référence ne va pas sans l'indice
-- qu'elle désigne (nom ou identifiant INSEE) ni le mois de sa publication. 0 contrat en production le 08/11.
alter table public.itv_contracts drop constraint if exists itv_contracts_indice_complet;
alter table public.itv_contracts add constraint itv_contracts_indice_complet
  check (index_base_value is null or (coalesce(nullif(btrim(index_label), ''), nullif(btrim(index_series), '')) is not null and index_base_month is not null));

insert into public.schema_migrations (version) values ('0510_contrat_terme_fige') on conflict (version) do nothing;

-- ===== supabase/rollback/0510_contrat_terme_fige_retour.sql =====
-- Retour arrière de 0510 : app.contrat_signe_fige remise à la définition de 0466 (moment de facturation de nouveau
-- modifiable par la base sur un contrat signé ; l'écran ne l'envoie toujours pas), contrainte de l'indice retirée. Un
-- moment des factures fixé à la signature reste écrit (même valeur que la règle par défaut à ce moment).

CREATE OR REPLACE FUNCTION app.contrat_signe_fige()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_revision boolean := coalesce(current_setting('app.revision_prix', true), '') = 'oui';
begin
  if old.signed_at is not null and (
       (new.annual_price_ht is distinct from old.annual_price_ht and not v_revision) or new.duration_years is distinct from old.duration_years
    or new.tacit_renewal is distinct from old.tacit_renewal or new.renewal_years is distinct from old.renewal_years
    or new.notice_months is distinct from old.notice_months or new.billing_period is distinct from old.billing_period
    or new.start_on is distinct from old.start_on or new.client_id is distinct from old.client_id
    or new.signed_at is distinct from old.signed_at or new.signed_name is distinct from old.signed_name
    or new.signature_id is distinct from old.signature_id or new.base_price_ht is distinct from old.base_price_ht
    or new.index_base_value is distinct from old.index_base_value or new.index_series is distinct from old.index_series
    or new.emergency_hours is distinct from old.emergency_hours or new.includes is distinct from old.includes) then
    raise exception 'Contrat signé : ses conditions se changent par un avenant' using errcode = '42501';
  end if;
  return new;
end
$function$;

alter table public.itv_contracts drop constraint if exists itv_contracts_indice_complet;

delete from public.schema_migrations where version = '0510_contrat_terme_fige';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE c1_0510 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
