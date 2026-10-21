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
