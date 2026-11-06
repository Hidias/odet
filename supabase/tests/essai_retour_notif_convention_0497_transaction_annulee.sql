-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (notif_convention_0497) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0497_notification_convention_signee.sql, retour arrière,
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

-- ===== supabase/migrations/0497_notification_convention_signee.sql =====
-- 0497 : notification d'une convention signée en ligne (constat du 06/11 sur l'inter d'essai).
-- La convention d'une entreprise inscrite à une session inter est publiée dans l'espace client sous le type
-- « contrat » (C4) ; sa signature en ligne notifiait l'équipe par « Contrat signé en ligne ». Pour le document d'un
-- groupe inter, le titre suit désormais le groupe : « Convention signée en ligne » pour une entreprise, « Contrat
-- signé en ligne » pour un particulier (contrat de formation). Type de notification inchangé (contrat_signe) ; devis,
-- bon d'intervention et autres contrats inchangés. Seul le titre des notifications à venir change.

do $do$
declare
  v_def text := pg_get_functiondef('app.portail_signer_document(uuid,text,uuid,uuid,uuid,text,text,text,text)'::regprocedure);
  a1 text := $a$    case when d.kind = 'devis' then 'Devis signé en ligne' when d.kind = 'rapport' then 'Bon d''intervention signé à distance' else 'Contrat signé en ligne' end,$a$;
  b1 text := $b$    -- Convention d'une entreprise d'une session inter (0497) : titre selon le groupe, le particulier signe un contrat
    case when d.kind = 'devis' then 'Devis signé en ligne' when d.kind = 'rapport' then 'Bon d''intervention signé à distance'
      when d.object_type = 'session_group' and coalesce((select g.kind from public.session_groups g where g.id = d.object_id), '') <> 'particulier'
        then 'Convention signée en ligne'
      else 'Contrat signé en ligne' end,$b$;
begin
  if position('(0497)' in v_def) > 0 then return; end if;
  if position(a1 in v_def) = 0 then
    raise exception 'Fonction portail_signer_document inattendue : rien n''est changé';
  end if;
  execute replace(v_def, a1, b1);
end
$do$;
revoke all on function app.portail_signer_document(uuid, text, uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;

insert into public.schema_migrations (version) values ('0497_notification_convention_signee') on conflict (version) do nothing;

-- ===== supabase/rollback/0497_notification_convention_signee_retour.sql =====
-- Retour arrière de 0497 : titre de notification d'origine (« Contrat signé en ligne » pour tout contrat). Les
-- notifications déjà écrites gardent leur titre.

do $do$
declare
  v_def text := pg_get_functiondef('app.portail_signer_document(uuid,text,uuid,uuid,uuid,text,text,text,text)'::regprocedure);
  a1 text := $a$    -- Convention d'une entreprise d'une session inter (0497) : titre selon le groupe, le particulier signe un contrat
    case when d.kind = 'devis' then 'Devis signé en ligne' when d.kind = 'rapport' then 'Bon d''intervention signé à distance'
      when d.object_type = 'session_group' and coalesce((select g.kind from public.session_groups g where g.id = d.object_id), '') <> 'particulier'
        then 'Convention signée en ligne'
      else 'Contrat signé en ligne' end,$a$;
  b1 text := $b$    case when d.kind = 'devis' then 'Devis signé en ligne' when d.kind = 'rapport' then 'Bon d''intervention signé à distance' else 'Contrat signé en ligne' end,$b$;
begin
  if position(a1 in v_def) = 0 then return; end if;
  execute replace(v_def, a1, b1);
end
$do$;
revoke all on function app.portail_signer_document(uuid, text, uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;

delete from public.schema_migrations where version = '0497_notification_convention_signee';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE notif_convention_0497 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
