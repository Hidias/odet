-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (portail_0410) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0410_portail_avancement.sql, retour arrière,
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

-- ===== supabase/migrations/0410_portail_avancement.sql =====
-- 0410 : la préparation des stagiaires prévient l'équipe (décision de H du 21/10 : « ils font leurs trucs et ça nous
-- ping dès que c'est fait »), sans harcèlement. Quand un stagiaire remplit sa fiche de renseignements (avec ses
-- attentes) ou termine son test de positionnement sur le portail, une seule notification par session et par jour est
-- tenue à jour : « 3 fiches sur 8, 2 positionnements, 3 attentes ». Quand tous les stagiaires sont prêts, la
-- notification le dit et redevient non lue. Aucun email. Migration additive. Idempotente.
-- Retour arrière : supabase/rollback/0410_portail_avancement_retour.sql

create or replace function app.portail_avancement(p_session uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s record;
  n_total int; n_fiche int; n_pos int; n_att int;
  v_jour date := (now() at time zone 'Europe/Paris')::date;
  v_id uuid;
  v_complet boolean;
  v_titre text; v_msg text;
begin
  select se.id, se.company_id, se.start_date, se.reference, co.title into s
  from public.sessions se left join public.courses co on co.id = se.course_id where se.id = p_session;
  if s.id is null then return; end if;
  select count(*),
         count(*) filter (where coalesce(st.info_sheet_completed, false) or exists (select 1 from public.trainee_info_sheets i
                          where i.session_id = st.session_id and i.trainee_id = st.trainee_id and i.filled_online)),
         count(*) filter (where coalesce(st.positioning_test_completed, false)),
         count(*) filter (where exists (select 1 from public.trainee_info_sheets i where i.session_id = st.session_id
                          and i.trainee_id = st.trainee_id and nullif(btrim(coalesce(i.training_expectations, '')), '') is not null))
    into n_total, n_fiche, n_pos, n_att
  from public.session_trainees st where st.session_id = p_session;
  if n_total = 0 then return; end if;
  v_complet := n_fiche = n_total and n_pos = n_total;
  v_titre := case when v_complet then 'Tous les stagiaires sont prêts' else 'Préparation des stagiaires' end
             || coalesce(' : ' || s.title, '') || coalesce(' du ' || to_char(s.start_date, 'DD/MM'), '');
  v_msg := format('%s fiche%s de renseignements sur %s, %s test%s de positionnement, %s stagiaire%s %s indiqué leurs attentes.',
                  n_fiche, case when n_fiche > 1 then 's' else '' end, n_total,
                  n_pos, case when n_pos > 1 then 's' else '' end,
                  n_att, case when n_att > 1 then 's' else '' end, case when n_att > 1 then 'ont' else 'a' end);
  select id into v_id from public.notifications
  where type = 'portail_stagiaire' and metadata->>'session_id' = p_session::text and metadata->>'jour' = v_jour::text
  order by created_at desc limit 1;
  if v_id is null then
    insert into public.notifications (type, title, message, link, company_id, metadata)
    values ('portail_stagiaire', left(v_titre, 255), v_msg, '/sessions/' || p_session, s.company_id,
            jsonb_build_object('session_id', p_session, 'jour', v_jour, 'complet', v_complet));
  else
    update public.notifications
       set title = left(v_titre, 255), message = v_msg,
           read_at = case when v_complet and not coalesce((metadata->>'complet')::boolean, false) then null else read_at end,
           metadata = metadata || jsonb_build_object('complet', v_complet)
     where id = v_id;
  end if;
end
$$;
revoke all on function app.portail_avancement(uuid) from public, anon, authenticated;

-- Déclencheurs : fiche remplie en ligne, test de positionnement terminé
create or replace function app.portail_avancement_fiche()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.filled_online and (tg_op = 'INSERT' or not coalesce(old.filled_online, false)
      or coalesce(old.training_expectations, '') is distinct from coalesce(new.training_expectations, '')) then
    perform app.portail_avancement(new.session_id);
  end if;
  return null;
end
$$;
revoke all on function app.portail_avancement_fiche() from public, anon, authenticated;
drop trigger if exists portail_avancement_fiche on public.trainee_info_sheets;
create trigger portail_avancement_fiche after insert or update on public.trainee_info_sheets
  for each row execute function app.portail_avancement_fiche();

create or replace function app.portail_avancement_test()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (coalesce(new.positioning_test_completed, false) and not coalesce(old.positioning_test_completed, false))
     or (coalesce(new.info_sheet_completed, false) and not coalesce(old.info_sheet_completed, false)) then
    perform app.portail_avancement(new.session_id);
  end if;
  return null;
end
$$;
revoke all on function app.portail_avancement_test() from public, anon, authenticated;
drop trigger if exists portail_avancement_test on public.session_trainees;
create trigger portail_avancement_test after update of positioning_test_completed, info_sheet_completed on public.session_trainees
  for each row execute function app.portail_avancement_test();

insert into public.schema_migrations (version) values ('0410_portail_avancement') on conflict (version) do nothing;

-- ===== supabase/rollback/0410_portail_avancement_retour.sql =====
-- Retour arrière de 0410_portail_avancement.sql. Les notifications déjà créées restent. Idempotent.

drop trigger if exists portail_avancement_test on public.session_trainees;
drop trigger if exists portail_avancement_fiche on public.trainee_info_sheets;
drop function if exists app.portail_avancement_test();
drop function if exists app.portail_avancement_fiche();
drop function if exists app.portail_avancement(uuid);

delete from public.schema_migrations where version = '0410_portail_avancement';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE portail_0410 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
