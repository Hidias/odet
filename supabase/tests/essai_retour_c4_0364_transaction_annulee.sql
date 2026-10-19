-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (c4_0364) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0364_facturation_avoirs.sql, retour arrière,
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

-- ===== supabase/migrations/0364_facturation_avoirs.sql =====
-- 0364_facturation_avoirs.sql : avoirs et nouvelle facture préremplie, préparés par la base (Facturation fiable).
--
-- Décisions du 17/10 : une facture émise ne se modifie jamais ; une erreur se corrige par un avoir, total ou partiel
-- (repris de la facture, libre, ou réduction en pourcentage), puis éventuellement une nouvelle facture préremplie.
--   billing_create_credit_note(facture, mode, lignes, pourcentage) : brouillon d'avoir rattaché à une facture émise
--     total        toutes les lignes de la facture, à l'identique ;
--     partiel      les lignes et quantités choisies ([{"item_id": ..., "quantity": ...}]), jamais plus que la facture ;
--     pourcentage  une ligne par taux de TVA : « Réduction de X % sur la facture N » ;
--     libre        aucune ligne : elles se saisissent dans le brouillon.
--   billing_duplicate_invoice(facture) : nouveau brouillon de facture repris d'une facture émise (client à jour,
--     lignes, références), sans numéro.
-- L'avoir s'émet ensuite par billing_issue (série AVR, contrôle « avoirs ≤ facture », mentions).
-- Aucune nouvelle table. Idempotente. Retour arrière : supabase/rollback/0364_facturation_avoirs_retour.sql

create or replace function public.billing_create_credit_note(p_invoice uuid, p_mode text, p_lines jsonb default null,
                                                              p_percent numeric default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invoices;
  v_id uuid;
  v_restant numeric;
  l record;
  v_n int := 0;
begin
  if not app.a_le_droit('facturation.avoirs.emettre') then
    raise exception 'Accès refusé : émettre un avoir ne fait pas partie de vos accès' using errcode = '42501';
  end if;
  if p_mode not in ('total', 'partiel', 'pourcentage', 'libre') then
    raise exception 'Type d''avoir inconnu : %', p_mode using errcode = '22023';
  end if;
  select * into inv from public.invoices where id = p_invoice;
  if inv.id is null or inv.type <> 'invoice' then
    raise exception 'Facture introuvable' using errcode = 'P0002';
  end if;
  if inv.issued_at is null then
    raise exception 'Un avoir se rattache à une facture émise (un brouillon se modifie directement)' using errcode = '22023';
  end if;
  v_restant := coalesce(inv.total_ttc, 0) - coalesce((select sum(total_ttc) from public.invoices
    where parent_invoice_id = inv.id and type = 'credit_note' and issued_at is not null), 0);
  if v_restant <= 0.01 then
    raise exception 'Facture % déjà entièrement couverte par des avoirs', inv.reference using errcode = '22023';
  end if;
  if p_mode = 'pourcentage' and (p_percent is null or p_percent <= 0 or p_percent > 100) then
    raise exception 'Pourcentage entre 0 et 100' using errcode = '22023';
  end if;

  insert into public.invoices (reference, type, client_id, contact_id, quote_id, session_id, parent_invoice_id, client_reference,
    invoice_date, service_start_date, service_end_date, object, payment_method, payment_terms, discount_percent, discount_label,
    tva_applicable, notes, created_by, is_formation_pro, billing_client_id, is_subrogation, chorus_service_code, chorus_engagement)
  values ('x', 'credit_note', inv.client_id, inv.contact_id, inv.quote_id, inv.session_id, inv.id, inv.client_reference,
    (now() at time zone 'Europe/Paris')::date, inv.service_start_date, inv.service_end_date,
    case p_mode when 'pourcentage' then 'Réduction de ' || trim(to_char(p_percent, 'FM990D99')) || ' % sur la facture ' || inv.reference
                else 'Avoir sur la facture ' || inv.reference end,
    inv.payment_method, inv.payment_terms, case when p_mode = 'total' then inv.discount_percent else 0 end,
    case when p_mode = 'total' then inv.discount_label end, inv.tva_applicable, null,
    coalesce((select coalesce(p.display_name, p.email) from public.profiles p where p.id = (select auth.uid())), inv.created_by),
    inv.is_formation_pro, inv.billing_client_id, inv.is_subrogation, inv.chorus_service_code, inv.chorus_engagement)
  returning id into v_id;

  if p_mode = 'total' then
    insert into public.invoice_items (invoice_id, position, code, description_title, description_detail, quantity, unit, unit_price_ht,
      tva_rate, total_ht, course_id, nature, vat_regime)
    select v_id, it.position, it.code, it.description_title, it.description_detail, it.quantity, it.unit, it.unit_price_ht,
      it.tva_rate, it.total_ht, it.course_id, it.nature, it.vat_regime
    from public.invoice_items it where it.invoice_id = inv.id;
  elsif p_mode = 'partiel' then
    for l in
      select it.*, least(greatest(coalesce((x ->> 'quantity')::numeric, 0), 0), it.quantity) as q
      from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x
      join public.invoice_items it on it.id = (x ->> 'item_id')::uuid and it.invoice_id = inv.id
    loop
      continue when l.q <= 0;
      insert into public.invoice_items (invoice_id, position, code, description_title, description_detail, quantity, unit, unit_price_ht,
        tva_rate, total_ht, course_id, nature, vat_regime)
      values (v_id, v_n, l.code, l.description_title, l.description_detail, l.q, l.unit, l.unit_price_ht,
        l.tva_rate, round(l.q * l.unit_price_ht, 2), l.course_id, l.nature, l.vat_regime);
      v_n := v_n + 1;
    end loop;
    if v_n = 0 then
      raise exception 'Choisir au moins une ligne et une quantité' using errcode = '22023';
    end if;
  elsif p_mode = 'pourcentage' then
    insert into public.invoice_items (invoice_id, position, description_title, description_detail, quantity, unit, unit_price_ht,
      tva_rate, total_ht, nature, vat_regime)
    select v_id, (row_number() over (order by g.tva_rate))::int - 1,
      'Réduction de ' || trim(to_char(p_percent, 'FM990D99')) || ' %', 'Sur la facture ' || inv.reference
        || case when count(*) over () > 1 then ', lignes à ' || trim(to_char(g.tva_rate, 'FM990D99')) || ' % de TVA' else '' end,
      1, 'forfait', round(g.base * p_percent / 100, 2), g.tva_rate, round(g.base * p_percent / 100, 2), g.nature, g.vat_regime
    from (
      select it.tva_rate, min(it.nature) as nature, min(it.vat_regime) as vat_regime,
             round(sum(round(it.quantity * it.unit_price_ht, 2)) * (1 - coalesce(inv.discount_percent, 0) / 100), 2) as base
      from public.invoice_items it where it.invoice_id = inv.id group by it.tva_rate
    ) g
    where g.base > 0;
  end if;

  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_id, entity_name, details)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'create', 'document', v_id, 'Brouillon d''avoir sur ' || inv.reference,
          jsonb_build_object('mode', p_mode));
  return v_id;
end
$$;

create or replace function public.billing_duplicate_invoice(p_invoice uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invoices;
  v_id uuid;
begin
  if not app.a_le_droit('facturation.factures.modifier') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  select * into inv from public.invoices where id = p_invoice;
  if inv.id is null or inv.type <> 'invoice' then
    raise exception 'Facture introuvable' using errcode = 'P0002';
  end if;
  insert into public.invoices (reference, type, client_id, contact_id, quote_id, session_id, client_reference, invoice_date,
    service_start_date, service_end_date, due_date, object, payment_method, payment_terms, discount_percent, discount_label,
    tva_applicable, notes, created_by, is_formation_pro, billing_client_id, is_subrogation, chorus_service_code, chorus_engagement)
  values ('x', 'invoice', inv.client_id, inv.contact_id, inv.quote_id, inv.session_id, inv.client_reference,
    (now() at time zone 'Europe/Paris')::date, inv.service_start_date, inv.service_end_date,
    (now() at time zone 'Europe/Paris')::date + coalesce(inv.due_date - inv.invoice_date, 30), inv.object, inv.payment_method,
    inv.payment_terms, inv.discount_percent, inv.discount_label, inv.tva_applicable, inv.notes,
    coalesce((select coalesce(p.display_name, p.email) from public.profiles p where p.id = (select auth.uid())), inv.created_by),
    inv.is_formation_pro, inv.billing_client_id, inv.is_subrogation, inv.chorus_service_code, inv.chorus_engagement)
  returning id into v_id;
  insert into public.invoice_items (invoice_id, position, code, description_title, description_detail, quantity, unit, unit_price_ht,
    tva_rate, total_ht, course_id, nature, vat_regime)
  select v_id, it.position, it.code, it.description_title, it.description_detail, it.quantity, it.unit, it.unit_price_ht,
    it.tva_rate, it.total_ht, it.course_id, it.nature, it.vat_regime
  from public.invoice_items it where it.invoice_id = inv.id;
  return v_id;
end
$$;

revoke all on function public.billing_create_credit_note(uuid, text, jsonb, numeric), public.billing_duplicate_invoice(uuid) from public, anon;
grant execute on function public.billing_create_credit_note(uuid, text, jsonb, numeric), public.billing_duplicate_invoice(uuid)
  to authenticated, service_role;

insert into public.schema_migrations (version) values ('0364_facturation_avoirs') on conflict (version) do nothing;

-- ===== supabase/rollback/0364_facturation_avoirs_retour.sql =====
-- Retour arrière de 0364_facturation_avoirs.sql : retire la préparation des avoirs et la reprise d'une facture.
-- Les brouillons déjà préparés restent (lignes ordinaires de invoices). Idempotent.

drop function if exists public.billing_create_credit_note(uuid, text, jsonb, numeric);
drop function if exists public.billing_duplicate_invoice(uuid);

delete from public.schema_migrations where version = '0364_facturation_avoirs';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE c4_0364 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
