-- Session de démonstration (données fictives) : SST le vendredi 16 octobre 2026, 4 stagiaires.
-- Émargement ouvert toute la journée, pas de code d'accès : on scanne, on choisit son nom.
-- Rejouable : supprime d'abord la session de démonstration existante.

do $$
declare
  v_client uuid;
  v_session uuid;
  v_course uuid := (select id from courses where title ilike 'Formation initiale de Sauveteur Secouriste%' limit 1);
  v_trainer uuid := (select id from trainers order by created_at limit 1);
  v_t uuid;
  r record;
begin
  delete from sessions where notes = 'DEMO-PORTAIL';
  delete from trainees where notes = 'DEMO-PORTAIL';
  delete from clients where notes = 'DEMO-PORTAIL';

  insert into clients (name, address, postal_code, city, notes, type, client_type, status)
  values ('Atelier Démo Kerlan (fictif)', '12 rue des Embruns', '29000', 'Quimper', 'DEMO-PORTAIL', 'client', 'entreprise', 'actif')
  returning id into v_client;

  insert into sessions (reference, course_id, client_id, trainer_id, start_date, end_date, start_time, end_time,
                        location_name, location_address, location_postal_code, location_city, session_type, is_intra,
                        status, day_type, signature_mode, notes, min_participants, max_participants)
  values ('SES-DEMO1016', v_course, v_client, v_trainer, '2026-10-16', '2026-10-16', '09:00', '17:00',
          'Salle de formation', (select address from organization_settings limit 1),
          (select postal_code from organization_settings limit 1), (select city from organization_settings limit 1),
          'intra', true, 'planned', 'full', 'ouvert', 'DEMO-PORTAIL', 2, 10)
  returning id into v_session;

  for r in select * from (values
    ('Camille', 'LE GALL', 'female'), ('Yann', 'KERVELLA', 'male'),
    ('Anaïs', 'MORVAN', 'female'), ('Erwan', 'TANGUY', 'male')
  ) as x(fn, ln, g) loop
    insert into trainees (first_name, last_name, client_id, gender, notes, job_title)
    values (r.fn, r.ln, v_client, r.g, 'DEMO-PORTAIL', 'Agent de production')
    returning id into v_t;
    insert into session_trainees (session_id, trainee_id) values (v_session, v_t);
  end loop;
end $$;

select reference, attendance_token from sessions where notes = 'DEMO-PORTAIL';

-- Fiches de renseignement déjà remplies pour Yann et Anaïs (ils arrivent directement au positionnement).
-- Une fiche vide est créée automatiquement à l'inscription : on la complète.
update trainee_info_sheets i set ssn_refused = true, highest_diploma = 'CAP/BEP', csp = 'Ouvriers', job_title = 'Agent de production',
  training_expectations = 'Savoir réagir en cas d''accident', rgpd_consent = true, rgpd_consent_date = now(), filled_at = now(), filled_online = true
from trainees t
where t.id = i.trainee_id and t.notes = 'DEMO-PORTAIL' and t.first_name in ('Yann', 'Anaïs');

-- Démonstration : pas de code d'accès (un code est généré automatiquement à l'inscription)
update session_trainees st set access_code = null from trainees t where t.id = st.trainee_id and t.notes = 'DEMO-PORTAIL';

-- Remise à zéro des réponses (à relancer juste avant la démonstration)
delete from trainee_positioning_tests where trainee_id in (select id from trainees where notes = 'DEMO-PORTAIL');
delete from quiz_attempts where trainee_id in (select id from trainees where notes = 'DEMO-PORTAIL');
delete from attendance_halfdays where trainee_id in (select id from trainees where notes = 'DEMO-PORTAIL');
delete from trainee_evaluations where trainee_id in (select id from trainees where notes = 'DEMO-PORTAIL');
update session_trainees set positioning_test_completed = false, positioning_test_completed_at = null
where trainee_id in (select id from trainees where notes = 'DEMO-PORTAIL');

-- Accès entreprise de démonstration : lien stable /#/entreprise/demo2a7f1c9e4b5d6083, code 246810
insert into client_portal_access (client_id, token, access_code)
select id, 'demo2a7f1c9e4b5d6083', '246810' from clients where notes = 'DEMO-PORTAIL'
on conflict (client_id) do update set token = excluded.token, access_code = excluded.access_code, is_active = true, attempts = 0, locked_until = null;
