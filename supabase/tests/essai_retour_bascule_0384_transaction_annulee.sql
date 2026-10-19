-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (bascule_0384) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0384_bascule_rib.sql, retour arrière,
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

-- ===== supabase/migrations/0384_bascule_rib.sql =====
-- 0384_bascule_rib.sql : bascule vers le réel, émission refusée avec le RIB de démonstration (décision de H du 19/10 au soir).
--
--   Le vrai RIB n'arrivera peut-être pas avant jeudi. Tant que la société porte les coordonnées bancaires de
--   démonstration (BIC commençant par DEMO, ou IBAN d'exemple FR76 3000 6000 0112 3456 7890 189), aucune facture ni
--   facture d'acompte n'est émise : le refus est posé en base, au moment de l'émission (date d'émission renseignée),
--   quel que soit l'écran. Les avoirs restent possibles (ils ne demandent aucun paiement). Le Factur-X est refusé de
--   même par la route serveur. Le contrôle avant émission (billing_missing_mentions) l'affiche comme point bloquant.
--   La numérotation reprend déjà la suite du dernier numéro saisi (billing_settings.invoice_last_number_before, 0360) :
--   rien à changer.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0384_bascule_rib_retour.sql

-- Vrai si les coordonnées bancaires de la société (ou, à défaut, de l'organisme) sont celles de la démonstration
create or replace function app.rib_demo(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with r as (
    select coalesce(nullif(btrim(c.bic), ''), nullif(btrim(o.bic), '')) as bic,
           regexp_replace(upper(coalesce(nullif(btrim(c.iban), ''), nullif(btrim(o.iban), ''), '')), '\s', '', 'g') as iban
    from (select 1) x
    left join public.companies c on c.id = p_company
    left join lateral (select os.bic, os.iban from public.organization_settings os limit 1) o on true
  )
  select coalesce(upper(r.bic) like 'DEMO%', false) or r.iban = 'FR7630006000011234567890189' from r
$$;
revoke all on function app.rib_demo(uuid) from public, anon;
grant execute on function app.rib_demo(uuid) to authenticated, service_role;

-- Refus à l'émission (passage de la date d'émission de vide à renseignée), hors avoirs
create or replace function app.billing_refus_rib_demo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.issued_at is null and new.issued_at is not null and coalesce(new.type, 'invoice') <> 'credit_note'
     and app.rib_demo(new.company_id) then
    raise exception 'Émission impossible : les coordonnées bancaires sont celles de la démonstration. Saisissez le RIB réel de la société (Paramètres › Banque et facturation).'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
revoke all on function app.billing_refus_rib_demo() from public, anon, authenticated;
drop trigger if exists invoices_refus_rib_demo on public.invoices;
create trigger invoices_refus_rib_demo before update of issued_at on public.invoices
  for each row execute function app.billing_refus_rib_demo();

-- Contrôle avant émission : point bloquant affiché à l'écran
create or replace function public.billing_missing_mentions(p_invoice uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
  v_type text;
  v_co uuid;
begin
  /* société (C2) */ perform app.exiger_societe('invoices', p_invoice, false);
  if not app.a_le_droit('facturation.factures.voir') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  v := app.billing_check(p_invoice);
  select i.type, i.company_id into v_type, v_co from public.invoices i where i.id = p_invoice;
  if coalesce(v_type, 'invoice') <> 'credit_note' and app.rib_demo(v_co) then
    v := jsonb_set(v, '{points}', coalesce(v -> 'points', '[]'::jsonb) || jsonb_build_object(
      'code', 'rib_demo', 'libelle', 'RIB réel de la société (les coordonnées bancaires sont celles de la démonstration)',
      'ou', 'parametres', 'bloquant', true));
  end if;
  return v;
end
$$;
revoke all on function public.billing_missing_mentions(uuid) from public, anon;
grant execute on function public.billing_missing_mentions(uuid) to authenticated, service_role;

insert into public.schema_migrations (version) values ('0384_bascule_rib') on conflict (version) do nothing;

-- ===== supabase/rollback/0384_bascule_rib_retour.sql =====
-- Retour arrière de 0384_bascule_rib.sql : retire le refus d'émission avec le RIB de démonstration et remet le
-- contrôle avant émission de 0363. Idempotent.

drop trigger if exists invoices_refus_rib_demo on public.invoices;
drop function if exists app.billing_refus_rib_demo();

create or replace function public.billing_missing_mentions(p_invoice uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  /* société (C2) */ perform app.exiger_societe('invoices', p_invoice, false);
  if not app.a_le_droit('facturation.factures.voir') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  return app.billing_check(p_invoice);
end
$$;
revoke all on function public.billing_missing_mentions(uuid) from public, anon;
grant execute on function public.billing_missing_mentions(uuid) to authenticated, service_role;

drop function if exists app.rib_demo(uuid);

delete from public.schema_migrations where version = '0384_bascule_rib';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE bascule_0384 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
