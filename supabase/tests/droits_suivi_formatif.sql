-- supabase/tests/droits_suivi_formatif.sql : tests de droits et de comportement du module Suivi formatif (0250).
--
-- Le script crée des comptes et des données d'essai, se fait passer pour chaque rôle
-- (set local role + request.jwt.claims), vérifie ce que chacun voit, modifie et appelle,
-- puis SE TERMINE TOUJOURS PAR UNE ERREUR VOLONTAIRE : rien n'est jamais enregistré.
-- Le message d'erreur contient le résultat, une ligne par test : OK ou ÉCHEC, puis le total.
--
-- Utilisation : placé après 0250 dans une même exécution (fichier essai_suivi_formatif_transaction_annulee.sql),
-- ou seul une fois 0250 appliquée.

create or replace function pg_temp.sf_essai(p_uid uuid, p_sql text)
returns text
language plpgsql as $f$
declare
  v_n bigint;
begin
  if p_uid is null then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform set_config('request.jwt.claim.sub', '', true);
    execute 'set local role anon';
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', p_uid::text, true);
    execute 'set local role authenticated';
  end if;
  execute p_sql into v_n;
  execute 'reset role';
  return v_n::text;
exception when others then
  return 'refus (' || sqlstate || ')';
end $f$;

do $test$
declare
  u_sa uuid := gen_random_uuid();  u_ges uuid := gen_random_uuid(); u_for uuid := gen_random_uuid();
  u_for2 uuid := gen_random_uuid(); u_com uuid := gen_random_uuid(); u_cpt uuid := gen_random_uuid();
  u_lec uuid := gen_random_uuid(); u_off uuid := gen_random_uuid();
  v_trainer uuid; v_trainer2 uuid; v_client uuid; v_course uuid; v_s1 uuid; v_s2 uuid; v_t1 uuid;
  v_seq1 uuid; v_seq2 uuid; v_prev_on boolean;
  r record; v_got text; v_ok boolean; v_lines text[] := '{}'; v_fail int := 0; v_total int := 0; v_uid uuid;
  v_before int; v_after int;
begin
  set local lock_timeout = '5s';

  -- Comptes ------------------------------------------------------------------------------------------
  insert into auth.users (id, email, aud, role)
  select x.id, x.email, 'authenticated', 'authenticated' from (values
    (u_sa, 'sf.sa@test.invalid'), (u_ges, 'sf.ges@test.invalid'), (u_for, 'sf.for@test.invalid'),
    (u_for2, 'sf.for2@test.invalid'), (u_com, 'sf.com@test.invalid'), (u_cpt, 'sf.cpt@test.invalid'),
    (u_lec, 'sf.lec@test.invalid'), (u_off, 'sf.off@test.invalid')) x(id, email);

  insert into public.trainers (first_name, last_name) values ('Essai', 'SUIVI') returning id into v_trainer;
  insert into public.trainers (first_name, last_name) values ('Essai', 'AUTRE') returning id into v_trainer2;

  if exists (select 1 from pg_trigger where tgname = 'profiles_protect_role') then
    execute 'alter table public.profiles disable trigger profiles_protect_role';
  end if;
  insert into public.profiles (id, email, role, is_active, trainer_id)
  select x.id, x.email, x.role, x.active, x.trainer from (values
    (u_sa, 'sf.sa@test.invalid', 'superadmin', true, null::uuid), (u_ges, 'sf.ges@test.invalid', 'gestionnaire', true, null),
    (u_for, 'sf.for@test.invalid', 'formateur', true, v_trainer), (u_for2, 'sf.for2@test.invalid', 'formateur', true, v_trainer2),
    (u_com, 'sf.com@test.invalid', 'commercial', true, null), (u_cpt, 'sf.cpt@test.invalid', 'comptable', true, null),
    (u_lec, 'sf.lec@test.invalid', 'lecture', true, null), (u_off, 'sf.off@test.invalid', 'direction', false, null)) x(id, email, role, active, trainer)
  on conflict (id) do update set role = excluded.role, is_active = excluded.is_active, trainer_id = excluded.trainer_id;
  if exists (select 1 from pg_trigger where tgname = 'profiles_protect_role') then
    execute 'alter table public.profiles enable trigger profiles_protect_role';
  end if;

  -- Données ------------------------------------------------------------------------------------------
  insert into public.clients (name) values ('Essai suivi formatif') returning id into v_client;
  insert into public.courses (title, code) values ('Essai SST suivi formatif', 'ESSAI-SF') returning id into v_course;
  insert into public.course_sequences (course_id, position, title, competences, modality, roles)
  values (v_course, 1, 'Protéger', '{C2}', 'mise_situation', '{Sauveteur,Victime,Témoin}'),
         (v_course, 2, 'Le SST, cadre juridique', '{C1}', 'oral', '{}');
  insert into public.sessions (course_id, start_date, end_date, trainer_id, client_id, attendance_token)
  values (v_course, current_date, current_date, v_trainer, v_client, 'essai-' || replace(gen_random_uuid()::text, '-', ''))
  returning id into v_s1;
  insert into public.sessions (course_id, start_date, end_date, trainer_id, client_id, attendance_token)
  values (v_course, current_date, current_date, v_trainer2, v_client, 'essai-' || replace(gen_random_uuid()::text, '-', ''))
  returning id into v_s2;
  insert into public.trainees (first_name, last_name, client_id) values ('Essai', 'STAGIAIRE', v_client) returning id into v_t1;
  insert into public.session_trainees (session_id, trainee_id) values (v_s1, v_t1), (v_s2, v_t1);

  select enabled into v_prev_on from public.org_modules where key = 'suivi_formatif';

  -- Phase A : module coupé ---------------------------------------------------------------------------
  update public.org_modules set enabled = false where key = 'suivi_formatif';
  for r in
    select * from (values
      ('A', u_ges, 'gestionnaire ne lit pas le catalogue, module coupé', format('select count(*) from public.course_sequences where course_id = %L', v_course), '=0'),
      ('A', u_sa, 'superadmin lit le catalogue, module coupé', format('select count(*) from public.course_sequences where course_id = %L', v_course), '=2'),
      ('A', u_for, 'formateur ne prépare pas sa session, module coupé', format('select public.sf_init_session(%L)', v_s1), 'refus'),
      ('A', u_ges, 'gestionnaire ne crée pas de séquence, module coupé', format('with x as (insert into public.course_sequences (course_id, title) values (%L, ''x'') returning 1) select count(*) from x', v_course), 'refus')
    ) t(phase, who, label, sql, expect)
  loop
    v_got := pg_temp.sf_essai(r.who, r.sql);
    v_ok := case when r.expect = 'refus' then v_got like 'refus%' when r.expect like '=%' then v_got = substr(r.expect, 2) else false end;
    v_total := v_total + 1; if not v_ok then v_fail := v_fail + 1; end if;
    v_lines := v_lines || format('%s  %s %-60s attendu %-6s obtenu %s', case when v_ok then 'OK   ' else 'ÉCHEC' end, r.phase, r.label, r.expect, v_got);
  end loop;

  -- Phase B : module actif ---------------------------------------------------------------------------
  update public.org_modules set enabled = true where key = 'suivi_formatif';
  for r in
    select * from (values
      ('B', null::uuid, 'anonyme ne lit pas le catalogue', 'select count(*) from public.course_sequences', 'refus'),
      ('B', u_ges, 'gestionnaire lit le catalogue', format('select count(*) from public.course_sequences where course_id = %L', v_course), '=2'),
      ('B', u_for, 'formateur lit le catalogue', format('select count(*) from public.course_sequences where course_id = %L', v_course), '=2'),
      ('B', u_for, 'formateur ne crée pas de séquence au catalogue', format('with x as (insert into public.course_sequences (course_id, title) values (%L, ''x'') returning 1) select count(*) from x', v_course), 'refus'),
      ('B', u_ges, 'gestionnaire crée une séquence au catalogue', format('with x as (insert into public.course_sequences (course_id, position, title, competences, modality) values (%L, 3, ''Examiner'', ''{C3}'', ''mise_situation'') returning 1) select count(*) from x', v_course), '=1'),
      ('B', u_off, 'compte désactivé ne lit rien', format('select count(*) from public.course_sequences where course_id = %L', v_course), '=0'),
      ('B', u_for, 'formateur prépare sa session (3 séquences)', format('select public.sf_init_session(%L)', v_s1), '=3'),
      ('B', u_for, 'deuxième préparation sans doublon', format('select public.sf_init_session(%L)', v_s1), '=3'),
      ('B', u_for, 'formateur ne prépare pas la session d''un autre', format('select public.sf_init_session(%L)', v_s2), 'refus'),
      ('B', u_ges, 'gestionnaire prépare l''autre session', format('select public.sf_init_session(%L)', v_s2), '=3'),
      ('B', u_for, 'formateur ne voit pas les séquences de l''autre session', format('select count(*) from public.session_sequences where session_id = %L', v_s2), '=0'),
      ('B', u_for2, 'autre formateur voit sa session', format('select count(*) from public.session_sequences where session_id = %L', v_s2), '=3')
    ) t(phase, who, label, sql, expect)
  loop
    v_got := pg_temp.sf_essai(r.who, r.sql);
    v_ok := case when r.expect = 'refus' then v_got like 'refus%' when r.expect like '=%' then v_got = substr(r.expect, 2) else false end;
    v_total := v_total + 1; if not v_ok then v_fail := v_fail + 1; end if;
    v_lines := v_lines || format('%s  %s %-60s attendu %-6s obtenu %s', case when v_ok then 'OK   ' else 'ÉCHEC' end, r.phase, r.label, r.expect, v_got);
  end loop;

  select id into v_seq1 from public.session_sequences where session_id = v_s1 and position = 1;
  select id into v_seq2 from public.session_sequences where session_id = v_s2 and position = 1;

  -- Phase C : saisies, versions, archives ------------------------------------------------------------
  for r in
    select * from (values
      ('C', u_for, 'formateur enregistre groupe + stagiaire', format($q$select (public.save_formative_batch(jsonb_build_array(
          jsonb_build_object('type','group','session_sequence_id',%L,'group_status','acquis','client_updated_at','2026-10-21T10:00:00Z'),
          jsonb_build_object('type','trainee','session_sequence_id',%L,'trainee_id',%L,'status','a_revoir','role','Sauveteur','indicators_met',jsonb_build_array('Protège'),'remark','À reprendre','client_updated_at','2026-10-21T10:01:00Z')))->>'saved')::bigint$q$, v_seq1, v_seq1, v_t1), '=2'),
      ('C', u_for, 'saisie plus ancienne ignorée', format($q$select (public.save_formative_batch(jsonb_build_array(
          jsonb_build_object('type','trainee','session_sequence_id',%L,'trainee_id',%L,'status','acquis','client_updated_at','2026-10-21T09:00:00Z')))->>'ignored')::bigint$q$, v_seq1, v_t1), '=1'),
      ('C', u_for, 'la saisie la plus récente reste', format('select count(*) from public.formative_evaluations where session_sequence_id = %L and status = ''a_revoir''', v_seq1), '=1'),
      ('C', u_for, 'formateur ne saisit pas dans l''autre session', format($q$select (public.save_formative_batch(jsonb_build_array(
          jsonb_build_object('type','trainee','session_sequence_id',%L,'trainee_id',%L,'status','acquis')))->>'ignored')::bigint$q$, v_seq2, v_t1), '=1'),
      ('C', u_lec, 'lecture voit la saisie', format('select count(*) from public.formative_evaluations where session_id = %L', v_s1), '=1'),
      ('C', u_lec, 'lecture n''écrit pas', format('with x as (insert into public.formative_evaluations (session_id, session_sequence_id, trainee_id, status) values (%L, %L, %L, ''acquis'') returning 1) select count(*) from x', v_s2, v_seq2, v_t1), 'refus'),
      ('C', u_com, 'commercial voit la saisie', format('select count(*) from public.formative_evaluations where session_id = %L', v_s1), '=1'),
      ('C', u_cpt, 'comptable ne voit pas la saisie', format('select count(*) from public.formative_evaluations where session_id = %L', v_s1), '=0'),
      ('C', u_for2, 'autre formateur ne voit pas la saisie', format('select count(*) from public.formative_evaluations where session_id = %L', v_s1), '=0'),
      ('C', u_for, 'clôture de la séquence', format($q$select (public.save_formative_batch(jsonb_build_array(jsonb_build_object('type','close','session_sequence_id',%L,'closed',true)))->>'saved')::bigint$q$, v_seq1), '=1'),
      ('C', u_for, 'première fiche archivée : version 1', format('select public.sf_register_sheet(%L, %L, ''fiche.pdf'', ''abc'', null)', v_s1, v_s1 || '/suivi/fiche-v1.pdf'), '=1'),
      ('C', u_for, 'deuxième fiche : version 2', format('select public.sf_register_sheet(%L, %L, ''fiche.pdf'', ''def'', ''Correction'')', v_s1, v_s1 || '/suivi/fiche-v2.pdf'), '=2'),
      ('C', u_for, 'chemin d''archive hors session refusé', format('select public.sf_register_sheet(%L, %L, ''fiche.pdf'', ''x'', null)', v_s1, v_s2 || '/suivi/fiche.pdf'), 'refus'),
      ('C', u_ges, 'fiche archivée non modifiable', format('with x as (update public.formative_sheets set file_name = ''x'' where session_id = %L returning 1) select count(*) from x', v_s1), 'refus'),
      ('C', u_sa, 'fiche archivée non supprimable', format('with x as (delete from public.formative_sheets where session_id = %L returning 1) select count(*) from x', v_s1), 'refus'),
      ('C', u_for, 'archive de sa session : dépôt permis', format('select case when public.sf_archive_can(%L, true) then 1 else 0 end', v_s1 || '/suivi/a.pdf'), '=1'),
      ('C', u_for, 'archive d''une autre session : dépôt refusé', format('select case when public.sf_archive_can(%L, true) then 1 else 0 end', v_s2 || '/suivi/a.pdf'), '=0'),
      ('C', u_for, 'grille SST de sa session : dépôt permis', format('select case when public.sf_archive_can(%L, true) then 1 else 0 end', v_s1 || '/certification-sst/g.pdf'), '=1'),
      ('C', u_lec, 'lecture lit une grille SST archivée', format('select case when public.sf_archive_can(%L, false) then 1 else 0 end', v_s1 || '/certification-sst/g.pdf'), '=1'),
      ('C', u_lec, 'lecture ne dépose pas', format('select case when public.sf_archive_can(%L, true) then 1 else 0 end', v_s1 || '/suivi/a.pdf'), '=0'),
      ('C', u_ges, 'chemin mal formé refusé', 'select case when public.sf_archive_can(''pas-un-uuid/suivi/a.pdf'', true) then 1 else 0 end', '=0'),
      ('C', u_ges, 'dossier inconnu refusé', format('select case when public.sf_archive_can(%L, true) then 1 else 0 end', v_s1 || '/autre/a.pdf'), '=0'),
      ('C', u_ges, 'sous-dossier en trop refusé', format('select case when public.sf_archive_can(%L, true) then 1 else 0 end', v_s1 || '/suivi/x/a.pdf'), '=0'),
      ('C', null::uuid, 'anonyme ne lit aucune archive', 'select count(*) from storage.objects where bucket_id = ''archives-formation''', 'refus_ou_0')
    ) t(phase, who, label, sql, expect)
  loop
    v_got := pg_temp.sf_essai(r.who, r.sql);
    v_ok := case when r.expect = 'refus' then v_got like 'refus%'
                 when r.expect = 'refus_ou_0' then v_got like 'refus%' or v_got = '0'
                 when r.expect like '=%' then v_got = substr(r.expect, 2) else false end;
    v_total := v_total + 1; if not v_ok then v_fail := v_fail + 1; end if;
    v_lines := v_lines || format('%s  %s %-60s attendu %-6s obtenu %s', case when v_ok then 'OK   ' else 'ÉCHEC' end, r.phase, r.label, r.expect, v_got);
  end loop;

  -- Phase D : effacement d'une session -----------------------------------------------------------------
  select count(*) into v_before from public.session_sequences where session_id = v_s1;
  delete from public.session_trainees where session_id = v_s1;
  delete from public.sessions where id = v_s1;
  select count(*) into v_after from public.session_sequences where session_id = v_s1;
  v_ok := v_before = 3 and v_after = 0
          and not exists (select 1 from public.formative_evaluations where session_id = v_s1)
          and not exists (select 1 from public.formative_sheets where session_id = v_s1);
  v_total := v_total + 1; if not v_ok then v_fail := v_fail + 1; end if;
  v_lines := v_lines || format('%s  D %-60s avant %s après %s', case when v_ok then 'OK   ' else 'ÉCHEC' end, 'session effacée : séquences, saisies et registre suivent', v_before, v_after);

  -- Rien d'existant n'a bougé
  v_ok := (select count(*) from pg_policies where schemaname = 'public' and tablename = 'sst_certifications') > 0
          and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'trainee_objectives') > 0;
  v_total := v_total + 1; if not v_ok then v_fail := v_fail + 1; end if;
  v_lines := v_lines || format('%s  D %-60s', case when v_ok then 'OK   ' else 'ÉCHEC' end, 'règles de sst_certifications et trainee_objectives toujours là');

  update public.org_modules set enabled = coalesce(v_prev_on, false) where key = 'suivi_formatif';

  raise exception E'RÉSULTAT DES TESTS SUIVI FORMATIF (tout est annulé)\n%\n\n% test(s), % échec(s)',
    array_to_string(v_lines, E'\n'), v_total, v_fail;
end
$test$;
