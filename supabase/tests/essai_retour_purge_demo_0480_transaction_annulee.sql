-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (purge_demo_0480) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0480_purge_demo_verrous.sql, retour arrière,
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

-- ===== supabase/migrations/0480_purge_demo_verrous.sql =====
-- 0480 : la purge des données de démonstration repasse (bloquée depuis les verrous ajoutés après 0385).
-- Constat du 04/11 (lot regles_sst_0479) : le rapport « réel / test » et donc la sortie du mode démonstration
-- échouaient : un devis fictif accepté est « signé » pour le verrou des devis (0435), et l'effacement d'une session
-- fictive met à jour une note de frais, refusée par son verrou (0454). Sans cette correction, la purge prévue à la
-- sortie du mode démonstration était impossible.
-- 1. Réglage local app.demo_purge, posé par purge_demo_data() en début de purge, pour la durée de sa transaction
--    (super administrateur seulement, comme avant).
-- 2. Devis : un devis enregistré comme fictif (demo_records) n'est pas « signé » pendant la purge ; les vrais devis
--    signés restent verrouillés, purge comprise.
-- 3. Notes de frais : le verrou laisse passer les mises à jour en cascade de la purge.
-- Le corps de la purge n'est pas recopié : la ligne qui pose le réglage est ajoutée à la version en base.
-- Retour arrière : supabase/rollback/0480_purge_demo_verrous_retour.sql

-- ── 2. Devis fictifs pendant la purge ──
create or replace function app.devis_signe(p_quote uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.quotes q
    where q.id = p_quote and q.status in ('accepted', 'partial', 'invoiced', 'replaced')
      and (q.signature_base64 is not null
        or exists (select 1 from public.document_signatures d
                   where d.status = 'valid' and d.signer_type = 'client' and d.metadata ->> 'object_id' = q.id::text)
        or exists (select 1 from public.client_deposits cd
                   where cd.object_type = 'quote' and cd.object_id = q.id and cd.status = 'valide'))
      and not (coalesce(current_setting('app.demo_purge', true), '') = 'on'
               and exists (select 1 from public.demo_records r where r.tbl = 'quotes' and r.id = q.id)))
$$;

-- ── 3. Notes de frais ──
create or replace function app.frais_garde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Purge des données de démonstration (0480) : les effacements en cascade passent
  if coalesce(current_setting('app.demo_purge', true), '') = 'on' then return new; end if;
  if (new.company_id, new.trainer_id, new.session_id, new.spent_on, new.category, new.amount_ttc, new.km, new.description, new.receipt_path, new.created_by, new.created_at)
     is distinct from (old.company_id, old.trainer_id, old.session_id, old.spent_on, old.category, old.amount_ttc, old.km, old.description, old.receipt_path, old.created_by, old.created_at) then
    raise exception 'Une note de frais déclarée ne se modifie pas : refusez-la avec un motif' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'soumise' and new.status in ('validee', 'refusee', 'annulee'))
         or (old.status = 'validee' and new.status in ('remboursee', 'soumise'))
         or (old.status = 'refusee' and new.status = 'soumise')) then
      raise exception 'Passage impossible de « % » à « % »', old.status, new.status using errcode = '23514';
    end if;
    if new.status = 'refusee' and length(btrim(coalesce(new.decision_note, ''))) < 3 then
      raise exception 'Indiquez le motif du refus' using errcode = '23514';
    end if;
    if new.status = 'remboursee' and new.paid_on is null then new.paid_on := public.paris_today(); end if;
    if new.status = 'soumise' then new.decided_by := null; new.decided_at := null; new.paid_on := null;
    else new.decided_by := (select auth.uid()); new.decided_at := now(); end if;
  end if;
  new.updated_at := now();
  return new;
end
$$;

revoke all on function app.frais_garde() from public, anon, authenticated;

-- ── 1. La purge pose le réglage (ajout à la version en base, idempotent) ──
do $do$
declare
  v_src text := pg_get_functiondef('public.purge_demo_data()'::regprocedure);
begin
  if position('app.demo_purge' in v_src) = 0 then
    if position(E'\nbegin\n' in v_src) = 0 then raise exception 'purge_demo_data : début du corps introuvable'; end if;
    v_src := regexp_replace(v_src, E'\nbegin\n',
      E'\nbegin\n  -- 0480 : les verrous laissent passer la purge des données fictives\n  perform set_config(''app.demo_purge'', ''on'', true);\n', '');
    execute v_src;
  end if;
end
$do$;
revoke all on function public.purge_demo_data() from public, anon;
grant execute on function public.purge_demo_data() to authenticated;

insert into public.schema_migrations (version) values ('0480_purge_demo_verrous') on conflict (version) do nothing;

-- ===== supabase/rollback/0480_purge_demo_verrous_retour.sql =====
-- Retour arrière de 0480 : verrous d'origine (0435, 0454) ; la ligne ajoutée à la purge est retirée.
create or replace function app.devis_signe(p_quote uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.quotes q
    where q.id = p_quote and q.status in ('accepted', 'partial', 'invoiced', 'replaced')
      and (q.signature_base64 is not null
        or exists (select 1 from public.document_signatures d
                   where d.status = 'valid' and d.signer_type = 'client' and d.metadata ->> 'object_id' = q.id::text)
        or exists (select 1 from public.client_deposits cd
                   where cd.object_type = 'quote' and cd.object_id = q.id and cd.status = 'valide')))
$$;

create or replace function app.frais_garde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.company_id, new.trainer_id, new.session_id, new.spent_on, new.category, new.amount_ttc, new.km, new.description, new.receipt_path, new.created_by, new.created_at)
     is distinct from (old.company_id, old.trainer_id, old.session_id, old.spent_on, old.category, old.amount_ttc, old.km, old.description, old.receipt_path, old.created_by, old.created_at) then
    raise exception 'Une note de frais déclarée ne se modifie pas : refusez-la avec un motif' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'soumise' and new.status in ('validee', 'refusee', 'annulee'))
         or (old.status = 'validee' and new.status in ('remboursee', 'soumise'))
         or (old.status = 'refusee' and new.status = 'soumise')) then
      raise exception 'Passage impossible de « % » à « % »', old.status, new.status using errcode = '23514';
    end if;
    if new.status = 'refusee' and length(btrim(coalesce(new.decision_note, ''))) < 3 then
      raise exception 'Indiquez le motif du refus' using errcode = '23514';
    end if;
    if new.status = 'remboursee' and new.paid_on is null then new.paid_on := public.paris_today(); end if;
    if new.status = 'soumise' then new.decided_by := null; new.decided_at := null; new.paid_on := null;
    else new.decided_by := (select auth.uid()); new.decided_at := now(); end if;
  end if;
  new.updated_at := now();
  return new;
end
$$;

revoke all on function app.frais_garde() from public, anon, authenticated;

do $do$
declare
  v_src text := pg_get_functiondef('public.purge_demo_data()'::regprocedure);
begin
  if position('app.demo_purge' in v_src) > 0 then
    v_src := replace(v_src, E'  -- 0480 : les verrous laissent passer la purge des données fictives\n  perform set_config(''app.demo_purge'', ''on'', true);\n', '');
    execute v_src;
  end if;
end
$do$;
revoke all on function public.purge_demo_data() from public, anon;
grant execute on function public.purge_demo_data() to authenticated;

delete from public.schema_migrations where version = '0480_purge_demo_verrous';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE purge_demo_0480 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
