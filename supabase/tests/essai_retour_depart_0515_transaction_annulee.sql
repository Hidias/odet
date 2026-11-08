-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (depart_0515) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0515_rh_depart.sql, retour arrière,
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

-- ===== supabase/migrations/0515_rh_depart.sql =====
-- 0515 : départ d'un salarié qui fait le ménage (idée n° 4 reprise d'Odoo, choix de H du 08/11).
-- Décisions de H (08/11) :
--   - « Enregistrer un départ » sur la fiche du personnel : date et motif, puis un bilan de tout ce qui sera fait, cases
--     cochées par défaut, rien sans confirmation ;
--   - véhicule : affectation en cours close à la date de départ ; absences qui commencent après le départ annulées
--     (jamais effacées : même effet qu'une annulation par la RH, solde rendu pour une absence validée) ;
--   - EPI non rendus et affectations à venir (sessions comme formateur, visites de maintenance, actions de l'équipe,
--     absence à cheval sur le départ, véhicule prévu après) : une action de l'équipe par sujet, confiée au responsable
--     RH des paramètres (sinon à qui enregistre le départ) ; rien n'est réaffecté d'office ;
--   - le lendemain du départ, la nuit archive la fiche et coupe le compte de connexion.
-- Règles :
--   1. hr_people : date, motif et auteur du départ, choix « archiver et couper le compte », date d'application par la
--      nuit ; colonnes écrites par les fonctions de 0515 seules (jamais par un compte en direct).
--   2. app.depart_bilan(personne, jour) : ce que fera le départ ; une seule règle pour l'écran et l'enregistrement.
--      Bloquant : un contrat qui commence après la date de départ.
--   3. public.rh_depart_bilan, public.rh_enregistrer_depart, public.rh_annuler_depart (droit rh.dossiers.gerer de la
--      société de la personne).
--   4. Compte coupé par la nuit : seulement le compte relié au moment de l'enregistrement (departure_profile_id), et
--      seulement si l'auteur du départ peut gérer les utilisateurs (même règle que app.profiles_liens_garde) ; jamais un
--      super administrateur ; sinon une action « compte à couper à la main ». Si le compte est actif dans une autre
--      société, seule l'appartenance à cette société est coupée ; sinon le compte est désactivé.
--      Actions confiées au responsable RH des paramètres, sinon à l'auteur, jamais à la personne qui part ni à un
--      compte sans accès actif à la société (sinon sans responsable).
--   Absences : celles qui commencent après le départ ET après aujourd'hui sont annulées ; celles déjà commencées
--   (départ saisi en retard, ou à cheval sur le départ) sont seulement signalées. Un départ en attente se remplace
--   seulement après « Annuler le départ ».
--   5. team_actions : source « depart », posée seulement pendant l'enregistrement d'un départ (clé de dédoublonnage par
--      personne, date et sujet) ; corps de app.team_actions_maj repris de la production (0513), plus cette source.
--   6. public.rh_departs_appliquer() : tâche de nuit (api/maintenance-nuit.js).
-- Additive. Idempotente. Retour arrière : supabase/rollback/0515_rh_depart_retour.sql

-- ── 1. Départ sur la fiche ──
alter table public.hr_people add column if not exists departure_on date;
alter table public.hr_people add column if not exists departure_reason text check (departure_reason is null or length(btrim(departure_reason)) between 2 and 200);
alter table public.hr_people add column if not exists departure_auto boolean not null default true;
alter table public.hr_people add column if not exists departure_by uuid;
alter table public.hr_people add column if not exists departure_recorded_at timestamptz;
alter table public.hr_people add column if not exists departure_applied_at timestamptz;
alter table public.hr_people add column if not exists departure_profile_id uuid;
create index if not exists hr_people_depart_idx on public.hr_people (departure_on) where departure_on is not null and departure_applied_at is null;
comment on column public.hr_people.departure_on is 'Dernier jour du salarié (0515), posé par public.rh_enregistrer_depart seulement';
comment on column public.hr_people.departure_auto is 'Départ (0515) : la nuit du lendemain archive la fiche et coupe le compte';
comment on column public.hr_people.departure_profile_id is 'Départ (0515) : compte à couper par la nuit, vérifié à l''enregistrement ; null = aucun compte coupé';
comment on column public.hr_people.departure_applied_at is 'Départ (0515) : archivage et compte traités par la nuit ; jamais refait ensuite';

-- Colonnes du départ figées hors des fonctions de 0515 (et de la nuit, sans compte connecté)
create or replace function app.hr_people_depart_garde()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or current_setting('app.depart_en_cours', true) = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.departure_on := null; new.departure_reason := null; new.departure_auto := true;
    new.departure_by := null; new.departure_recorded_at := null; new.departure_applied_at := null; new.departure_profile_id := null;
  elsif new.departure_on is distinct from old.departure_on or new.departure_reason is distinct from old.departure_reason
     or new.departure_auto is distinct from old.departure_auto or new.departure_by is distinct from old.departure_by
     or new.departure_recorded_at is distinct from old.departure_recorded_at
     or new.departure_applied_at is distinct from old.departure_applied_at
     or new.departure_profile_id is distinct from old.departure_profile_id then
    raise exception 'Le départ s''enregistre par « Enregistrer un départ » sur la fiche' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function app.hr_people_depart_garde() from public, anon, authenticated;
drop trigger if exists hr_people_depart_garde on public.hr_people;
create trigger hr_people_depart_garde before insert or update on public.hr_people
  for each row execute function app.hr_people_depart_garde();

-- ── 5. Actions de l'équipe : source « depart » ──
alter table public.team_actions drop constraint if exists team_actions_source_check;
alter table public.team_actions add constraint team_actions_source_check
  check (source in ('manuel', 'point', 'bilan', 'reunion', 'habilitation', 'depart'));

-- Corps de production (0513) repris à l'identique, plus : source « depart » et sa clé posées seulement pendant
-- l'enregistrement d'un départ
create or replace function app.team_actions_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.postponed_count := 0;
    if auth.uid() is not null then
      if new.source = 'habilitation' then
        raise exception 'Action réservée à la préparation de la nuit' using errcode = '42501';
      end if;
      if new.source = 'depart' then
        if current_setting('app.depart_en_cours', true) is distinct from 'on' then
          raise exception 'Action réservée à l''enregistrement d''un départ' using errcode = '42501';
        end if;
      else
        new.dedup_key := null;
      end if;
    end if;
  else
    new.company_id := old.company_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.source := old.source;
    new.source_id := old.source_id;
    new.dedup_key := old.dedup_key;
    -- Report : l'échéance d'une action à faire recule
    new.postponed_count := old.postponed_count;
    if old.status = 'a_faire' and new.status = 'a_faire' and old.due_on is not null and new.due_on > old.due_on then
      new.postponed_count := old.postponed_count + 1;
    end if;
  end if;
  if new.status = 'fait' and (tg_op = 'INSERT' or old.status <> 'fait') then
    new.done_at := now();
    new.done_by := auth.uid();
  elsif new.status <> 'fait' then
    new.done_at := null;
    new.done_by := null;
  else
    new.done_at := old.done_at;
    new.done_by := old.done_by;
  end if;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function app.team_actions_maj() from public, anon, authenticated;

-- ── 2. Bilan ──
create or replace function app.depart_bilan(p_person uuid, p_jour date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.hr_people;
  pr public.profiles;
  v_trainers uuid[];
  v_autres int := 0;
  v_compte text := 'aucun';
  v_jour_paris date := (now() at time zone 'Europe/Paris')::date;
  v_owner uuid;
  v_r jsonb;
begin
  select * into p from public.hr_people where id = p_person;
  if p.id is null then raise exception 'Fiche introuvable' using errcode = 'P0002'; end if;
  if p.profile_id is not null then select * into pr from public.profiles where id = p.profile_id; end if;
  v_trainers := array_remove(array[p.trainer_id, pr.trainer_id], null);
  if pr.id is not null then
    select count(*) into v_autres from public.company_members m
    where m.profile_id = pr.id and m.is_active and m.company_id <> p.company_id;
    v_compte := case
      when not pr.is_active then 'deja_inactif'
      when pr.role = 'superadmin' then 'superadmin'
      -- Couper un compte est réservé à qui gère les utilisateurs (app.profiles_liens_garde) : la nuit ne sert pas de passe-droit
      when not (app.a_le_droit('parametres.utilisateurs.gerer') or app.a_le_droit('plateforme.administrer')) then 'non_autorise'
      when v_autres > 0 then 'societe'
      else 'desactive' end;
  end if;
  -- Responsable des actions : responsable RH des paramètres, sinon l'auteur ; jamais la personne qui part, toujours un
  -- compte actif avec un accès actif à la société
  select x.id into v_owner from (
    select s.titres_owner_id as id, 1 as rang from public.hr_settings s where s.company_id = p.company_id
    union all select (select auth.uid()), 2) x
  join public.profiles o on o.id = x.id and o.is_active
  where x.id is distinct from p.profile_id
    and exists (select 1 from public.company_members m where m.profile_id = x.id and m.company_id = p.company_id and m.is_active)
  order by x.rang limit 1;

  select jsonb_build_object(
    'personne', jsonb_build_object('id', p.id, 'company_id', p.company_id,
      'nom', upper(btrim(coalesce(nullif(btrim(p.usage_name), ''), p.last_name))) || ' ' || btrim(p.first_name),
      'archivee', p.archived_at is not null),
    'jour', p_jour,
    'archivage_le', greatest(p_jour + 1, v_jour_paris + 1),
    'responsable', case when v_owner is not null then (select jsonb_build_object('id', o.id,
      'nom', coalesce(nullif(btrim(o.display_name), ''), nullif(btrim(concat_ws(' ', o.first_name, o.last_name)), ''), o.email))
      from public.profiles o where o.id = v_owner) end,
    'depart_en_attente', case when p.departure_on is not null and p.departure_applied_at is null
      then jsonb_build_object('le', p.departure_on, 'motif', p.departure_reason, 'auto', p.departure_auto) end,
    'compte', jsonb_build_object('etat', v_compte, 'id', pr.id, 'email', pr.email, 'autres_societes', v_autres),
    'bloquant', (select 'Un contrat commence après la date de départ (' || to_char(min(e.start_on), 'DD/MM/YYYY')
                        || ') : modifiez-le ou supprimez-le d''abord.'
                 from public.hr_employments e where e.person_id = p.id and e.start_on > p_jour
                 having count(*) > 0),
    'contrats', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'type', e.contract_type, 'debut', e.start_on,
                   'fin', e.end_on, 'emploi', e.job_title) order by e.start_on)
                 from public.hr_employments e where e.person_id = p.id and e.start_on <= p_jour
                   and (e.end_on is null or e.end_on > p_jour)), '[]'),
    'vehicules', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'vehicule', concat_ws(' ', v.plate, v.brand, v.model),
                   'debut', a.start_on, 'fin', a.end_on) order by a.start_on)
                 from public.vehicle_assignments a join public.vehicles v on v.id = a.vehicle_id
                 where a.company_id = p.company_id and (a.person_id = p.id or (pr.id is not null and a.profile_id = pr.id))
                   and a.start_on <= p_jour and (a.end_on is null or a.end_on > p_jour)), '[]'),
    'vehicules_futurs', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'vehicule', concat_ws(' ', v.plate, v.brand, v.model),
                   'debut', a.start_on) order by a.start_on)
                 from public.vehicle_assignments a join public.vehicles v on v.id = a.vehicle_id
                 where a.company_id = p.company_id and (a.person_id = p.id or (pr.id is not null and a.profile_id = pr.id))
                   and a.start_on > p_jour), '[]'),
    'absences', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'type', t.label, 'debut', r.start_on, 'fin', r.end_on,
                   'statut', r.status) order by r.start_on)
                 from public.hr_absence_requests r join public.hr_absence_types t on t.id = r.type_id
                 where r.person_id = p.id and r.status in ('demandee', 'validee') and r.start_on > p_jour and r.start_on > v_jour_paris), '[]'),
    'absences_a_cheval', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'type', t.label, 'debut', r.start_on, 'fin', r.end_on,
                   'statut', r.status) order by r.start_on)
                 from public.hr_absence_requests r join public.hr_absence_types t on t.id = r.type_id
                 where r.person_id = p.id and r.status in ('demandee', 'validee')
                   and ((r.start_on <= p_jour and r.end_on > p_jour) or (r.start_on > p_jour and r.start_on <= v_jour_paris))), '[]'),
    'epi', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'article', i.label, 'taille', h.size, 'quantite', h.quantity,
                   'remis', h.handed_on) order by h.handed_on)
                 from public.hr_ppe_handovers h join public.stock_items i on i.id = h.item_id
                 where h.person_id = p.id and h.returned_on is null), '[]'),
    'sessions', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'reference', s.reference, 'debut', s.start_date,
                   'fin', s.end_date) order by s.start_date)
                 from public.sessions s
                 where s.company_id = p.company_id and coalesce(s.status, '') <> 'cancelled'
                   and coalesce(s.end_date, s.start_date) > p_jour and cardinality(v_trainers) > 0
                   and (s.trainer_id = any (v_trainers)
                        or exists (select 1 from public.session_trainers st where st.session_id = s.id and st.trainer_id = any (v_trainers)))), '[]'),
    'visites', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'reference', x.reference, 'prevue', x.planned_on,
                   'statut', x.status) order by x.planned_on nulls last)
                 from public.itv_visits x
                 where pr.id is not null and x.technician_id = pr.id and x.company_id = p.company_id
                   and x.status in ('a_planifier', 'planifiee', 'en_cours')), '[]'),
    'actions', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'titre', t.title, 'echeance', t.due_on) order by t.due_on nulls last)
                 from public.team_actions t
                 where pr.id is not null and t.owner_id = pr.id and t.company_id = p.company_id and t.status = 'a_faire'), '[]')
  ) into v_r;
  return v_r;
end
$$;
revoke all on function app.depart_bilan(uuid, date) from public, anon, authenticated;

create or replace function app.depart_droit(p_person uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_co uuid;
begin
  select company_id into v_co from public.hr_people where id = p_person;
  if v_co is null or v_co not in (select app.societes_avec_droit('rh.dossiers.gerer')) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  return v_co;
end
$$;
revoke all on function app.depart_droit(uuid) from public, anon, authenticated;

-- ── 3. Fonctions de l'écran ──
create or replace function public.rh_depart_bilan(p_person uuid, p_jour date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.depart_droit(p_person);
  if p_jour is null then raise exception 'Date de départ obligatoire' using errcode = '22023'; end if;
  return app.depart_bilan(p_person, p_jour);
end
$$;
revoke all on function public.rh_depart_bilan(uuid, date) from public, anon;
grant execute on function public.rh_depart_bilan(uuid, date) to authenticated;

-- p_choix : {"vehicules": bool, "absences": bool, "actions": bool, "archiver": bool} (absent = vrai)
create or replace function public.rh_enregistrer_depart(p_person uuid, p_jour date, p_motif text, p_choix jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_co uuid;
  b jsonb;
  x jsonb;
  v_owner uuid;
  v_nom text;
  v_motif text := nullif(btrim(coalesce(p_motif, '')), '');
  v_choix jsonb := coalesce(p_choix, '{}'::jsonb);
  v_veh boolean := coalesce((v_choix ->> 'vehicules')::boolean, true);
  v_abs boolean := coalesce((v_choix ->> 'absences')::boolean, true);
  v_act boolean := coalesce((v_choix ->> 'actions')::boolean, true);
  v_arc boolean := coalesce((v_choix ->> 'archiver')::boolean, true);
  v_req public.hr_absence_requests;
  v_lien text := '/collaborateurs/' || p_person;
  v_cle text := 'dep:' || p_person || ':' || p_jour || ':';
  v_n jsonb := '{}'::jsonb;
  v_c int;
begin
  v_co := app.depart_droit(p_person);
  if p_jour is null then raise exception 'Date de départ obligatoire' using errcode = '22023'; end if;
  if v_motif is null or length(v_motif) < 2 or length(v_motif) > 200 then
    raise exception 'Motif du départ obligatoire (2 à 200 caractères)' using errcode = '22023';
  end if;
  if p_jour < (now() at time zone 'Europe/Paris')::date - 366 or p_jour > (now() at time zone 'Europe/Paris')::date + 366 then
    raise exception 'Date de départ à plus d''un an d''aujourd''hui' using errcode = '22023';
  end if;
  perform 1 from public.hr_people where id = p_person for update;
  if exists (select 1 from public.hr_people where id = p_person and archived_at is not null) then
    raise exception 'Fiche archivée : désarchivez-la d''abord' using errcode = '22023';
  end if;
  if exists (select 1 from public.hr_people where id = p_person and departure_on is not null and departure_applied_at is null) then
    raise exception 'Un départ est déjà enregistré : annulez-le d''abord' using errcode = '22023';
  end if;
  b := app.depart_bilan(p_person, p_jour);
  if b ->> 'bloquant' is not null then raise exception '%', b ->> 'bloquant' using errcode = '22023'; end if;
  perform set_config('app.depart_en_cours', 'on', true);
  v_nom := b -> 'personne' ->> 'nom';

  -- Contrats en cours : fin à la date de départ, motif repris
  update public.hr_employments set end_on = p_jour, end_reason = v_motif
  where person_id = p_person and start_on <= p_jour and (end_on is null or end_on > p_jour);
  get diagnostics v_c = row_count;
  v_n := v_n || jsonb_build_object('contrats', v_c);

  -- Véhicule : affectation close à la date de départ
  if v_veh then
    update public.vehicle_assignments set end_on = p_jour
    where id in (select (e ->> 'id')::uuid from jsonb_array_elements(b -> 'vehicules') e);
    get diagnostics v_c = row_count;
    v_n := v_n || jsonb_build_object('vehicules', v_c);
  end if;

  -- Absences qui commencent après le départ : annulées comme par la RH (circuit commun, solde rendu)
  if v_abs then
    v_c := 0;
    for x in select e from jsonb_array_elements(b -> 'absences') e loop
      select * into v_req from public.hr_absence_requests where id = (x ->> 'id')::uuid for update;
      if v_req.status not in ('demandee', 'validee') then continue; end if;
      if v_req.approval_id is not null and v_req.status = 'demandee' then
        update public.approval_requests set status = 'cancelled', updated_at = now(),
          history = history || jsonb_build_array(jsonb_build_object('at', now(), 'by', (select auth.uid()), 'action', 'cancelled'))
        where id = v_req.approval_id and status = 'pending';
      end if;
      perform app.hr_absence_appliquer(v_req.id, 'annulee', (select auth.uid()), null);
      v_c := v_c + 1;
    end loop;
    v_n := v_n || jsonb_build_object('absences', v_c);
  end if;

  -- Une action par sujet, pour le responsable RH des paramètres (sinon qui enregistre le départ)
  if v_act then
    v_owner := (b -> 'responsable' ->> 'id')::uuid;
    insert into public.team_actions (company_id, title, detail, owner_id, due_on, source, source_id, link, dedup_key)
    select v_co, left(a.titre || ' : ' || v_nom, 300), left(a.detail, 2000), v_owner, a.echeance, 'depart', p_person, v_lien, v_cle || a.sujet
    from (
      select 'epi' sujet, 'EPI à récupérer' titre, p_jour echeance,
             'Départ le ' || to_char(p_jour, 'DD/MM/YYYY') || '. EPI remis et non rendus : '
             || string_agg((e ->> 'article') || coalesce(' (taille ' || (e ->> 'taille') || ')', '') || ', remis le '
                           || to_char((e ->> 'remis')::date, 'DD/MM/YYYY'), ' ; ') || '.' detail
      from jsonb_array_elements(b -> 'epi') e having count(*) > 0
      union all
      select 'sessions', 'Formateur à remplacer', p_jour,
             'Départ le ' || to_char(p_jour, 'DD/MM/YYYY') || '. Sessions à venir dont la personne est formatrice : '
             || string_agg(coalesce(e ->> 'reference', 'session') || ' du ' || to_char((e ->> 'debut')::date, 'DD/MM/YYYY'), ' ; ') || '.'
      from jsonb_array_elements(b -> 'sessions') e having count(*) > 0
      union all
      select 'visites', 'Visites à réaffecter', p_jour,
             'Départ le ' || to_char(p_jour, 'DD/MM/YYYY') || '. Visites de maintenance encore ouvertes confiées à la personne : '
             || string_agg(coalesce(e ->> 'reference', 'visite') || coalesce(' prévue le ' || to_char((e ->> 'prevue')::date, 'DD/MM/YYYY'), ' à planifier'), ' ; ') || '.'
      from jsonb_array_elements(b -> 'visites') e having count(*) > 0
      union all
      select 'actions', 'Actions à reprendre', p_jour,
             'Départ le ' || to_char(p_jour, 'DD/MM/YYYY') || '. Actions de l''équipe encore à faire par la personne : '
             || string_agg(e ->> 'titre', ' ; ') || '.'
      from jsonb_array_elements(b -> 'actions') e having count(*) > 0
      union all
      select 'absences_a_cheval', 'Absence à revoir', p_jour,
             'Départ le ' || to_char(p_jour, 'DD/MM/YYYY') || '. Absences déjà commencées ou qui continuent après le départ (non modifiées) : '
             || string_agg((e ->> 'type') || ' du ' || to_char((e ->> 'debut')::date, 'DD/MM/YYYY') || ' au ' || to_char((e ->> 'fin')::date, 'DD/MM/YYYY'), ' ; ') || '.'
      from jsonb_array_elements(b -> 'absences_a_cheval') e having count(*) > 0
      union all
      select 'vehicules_futurs', 'Véhicule prévu après le départ', p_jour,
             'Départ le ' || to_char(p_jour, 'DD/MM/YYYY') || '. Affectations de véhicule qui commencent après le départ (non modifiées) : '
             || string_agg((e ->> 'vehicule') || ' à partir du ' || to_char((e ->> 'debut')::date, 'DD/MM/YYYY'), ' ; ') || '.'
      from jsonb_array_elements(b -> 'vehicules_futurs') e having count(*) > 0
      union all
      select 'compte', 'Compte à couper à la main', p_jour,
             'Départ le ' || to_char(p_jour, 'DD/MM/YYYY') || '. '
             || case b -> 'compte' ->> 'etat' when 'superadmin' then 'Le compte de connexion est celui d''un super administrateur : il n''est jamais coupé automatiquement.'
                else 'Le départ a été enregistré par un compte qui ne gère pas les utilisateurs : le compte de connexion n''est pas coupé automatiquement.' end
             || ' À couper dans Paramètres, Utilisateurs.'
      where v_arc and b -> 'compte' ->> 'etat' in ('superadmin', 'non_autorise')
    ) a
    on conflict (company_id, dedup_key) where dedup_key is not null do nothing;
    get diagnostics v_c = row_count;
    v_n := v_n || jsonb_build_object('actions', v_c);
  end if;

  update public.hr_people set departure_on = p_jour, departure_reason = v_motif, departure_auto = v_arc,
    departure_by = (select auth.uid()), departure_recorded_at = now(), departure_applied_at = null,
    departure_profile_id = case when v_arc and b -> 'compte' ->> 'etat' in ('desactive', 'societe') then (b -> 'compte' ->> 'id')::uuid end
  where id = p_person;
  perform set_config('app.depart_en_cours', 'off', true);
  return jsonb_build_object('fait', v_n, 'archivage_le', case when v_arc then (b ->> 'archivage_le')::date end,
    'compte', case when v_arc then b -> 'compte' ->> 'etat' end, 'responsable', b -> 'responsable' ->> 'nom');
end
$$;
revoke all on function public.rh_enregistrer_depart(uuid, date, text, jsonb) from public, anon;
grant execute on function public.rh_enregistrer_depart(uuid, date, text, jsonb) to authenticated;

-- Annuler un départ pas encore traité par la nuit : l'archivage et le compte ne seront pas touchés ; contrats, véhicule,
-- absences et actions restent tels quels (à corriger à la main)
create or replace function public.rh_annuler_depart(p_person uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.depart_droit(p_person);
  if not exists (select 1 from public.hr_people where id = p_person and departure_on is not null and departure_applied_at is null) then
    raise exception 'Aucun départ en attente sur cette fiche' using errcode = '22023';
  end if;
  perform set_config('app.depart_en_cours', 'on', true);
  update public.hr_people set departure_on = null, departure_reason = null, departure_auto = true,
    departure_by = null, departure_recorded_at = null, departure_profile_id = null
  where id = p_person;
  perform set_config('app.depart_en_cours', 'off', true);
end
$$;
revoke all on function public.rh_annuler_depart(uuid) from public, anon;
grant execute on function public.rh_annuler_depart(uuid) to authenticated;

-- ── 6. Nuit : archivage et compte, le lendemain du départ ──
create or replace function public.rh_departs_appliquer()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p record;
  v_jour date := (now() at time zone 'Europe/Paris')::date;
  v_arch int := 0; v_comptes int := 0; v_appart int := 0; v_echecs int := 0;
begin
  if coalesce((select auth.role()), '') not in ('service_role', '') then
    raise exception 'Réservé à la tâche de nuit' using errcode = '42501';
  end if;
  for p in
    select h.id, h.company_id, h.profile_id, h.departure_profile_id, h.departure_auto from public.hr_people h
    where h.departure_on is not null and h.departure_on < v_jour and h.departure_applied_at is null
  loop
    -- Une fiche en erreur n'empêche pas les autres ; elle sera reprise la nuit suivante
    begin
    perform 1 from public.hr_people where id = p.id for update;
    if p.departure_auto then
      update public.hr_people set archived_at = now() where id = p.id and archived_at is null;
      if found then v_arch := v_arch + 1; end if;
      -- Seulement le compte vérifié à l'enregistrement, et seulement s'il est toujours relié à la fiche
      if p.departure_profile_id is not null and p.profile_id is not distinct from p.departure_profile_id
         and exists (select 1 from public.profiles pr where pr.id = p.profile_id and pr.is_active and pr.role <> 'superadmin') then
        if exists (select 1 from public.company_members m where m.profile_id = p.profile_id and m.is_active and m.company_id <> p.company_id) then
          update public.company_members set is_active = false, updated_at = now()
          where profile_id = p.profile_id and company_id = p.company_id and is_active;
          if found then v_appart := v_appart + 1; end if;
        else
          update public.profiles set is_active = false where id = p.profile_id;
          v_comptes := v_comptes + 1;
        end if;
      end if;
    end if;
    update public.hr_people set departure_applied_at = now() where id = p.id;
    exception when others then
      v_echecs := v_echecs + 1;
    end;
  end loop;
  return jsonb_build_object('fiches_archivees', v_arch, 'comptes_coupes', v_comptes, 'appartenances_coupees', v_appart, 'echecs', v_echecs);
end
$$;
revoke all on function public.rh_departs_appliquer() from public, anon, authenticated;
grant execute on function public.rh_departs_appliquer() to service_role;

insert into public.schema_migrations (version) values ('0515_rh_depart') on conflict (version) do nothing;

-- ===== supabase/rollback/0515_rh_depart_retour.sql =====
-- Retour arrière de 0515 : fonctions du départ retirées, colonnes du départ retirées de hr_people, source « depart » des
-- actions de l'équipe retirée (les actions déjà créées restent, passées en source « manuel ») et app.team_actions_maj
-- remise au corps de production avant 0515 (0513). Les contrats clos, véhicules rendus, absences annulées, fiches
-- archivées et comptes coupés restent tels quels (le travail fait n'est pas défait).

drop function if exists public.rh_departs_appliquer();
drop function if exists public.rh_annuler_depart(uuid);
drop function if exists public.rh_enregistrer_depart(uuid, date, text, jsonb);
drop function if exists public.rh_depart_bilan(uuid, date);
drop function if exists app.depart_droit(uuid);
drop function if exists app.depart_bilan(uuid, date);

CREATE OR REPLACE FUNCTION app.team_actions_maj()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.postponed_count := 0;
    if auth.uid() is not null then
      if new.source = 'habilitation' then
        raise exception 'Action réservée à la préparation de la nuit' using errcode = '42501';
      end if;
      new.dedup_key := null;
    end if;
  else
    new.company_id := old.company_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.source := old.source;
    new.source_id := old.source_id;
    new.dedup_key := old.dedup_key;
    -- Report : l'échéance d'une action à faire recule
    new.postponed_count := old.postponed_count;
    if old.status = 'a_faire' and new.status = 'a_faire' and old.due_on is not null and new.due_on > old.due_on then
      new.postponed_count := old.postponed_count + 1;
    end if;
  end if;
  if new.status = 'fait' and (tg_op = 'INSERT' or old.status <> 'fait') then
    new.done_at := now();
    new.done_by := auth.uid();
  elsif new.status <> 'fait' then
    new.done_at := null;
    new.done_by := null;
  else
    new.done_at := old.done_at;
    new.done_by := old.done_by;
  end if;
  new.updated_at := now();
  return new;
end
$function$;
revoke all on function app.team_actions_maj() from public, anon, authenticated;

alter table public.team_actions disable trigger team_actions_maj;
update public.team_actions set source = 'manuel', dedup_key = null where source = 'depart';
alter table public.team_actions enable trigger team_actions_maj;
alter table public.team_actions drop constraint if exists team_actions_source_check;
alter table public.team_actions add constraint team_actions_source_check
  check (source in ('manuel', 'point', 'bilan', 'reunion', 'habilitation'));

drop trigger if exists hr_people_depart_garde on public.hr_people;
drop function if exists app.hr_people_depart_garde();
drop index if exists public.hr_people_depart_idx;
alter table public.hr_people drop column if exists departure_profile_id;
alter table public.hr_people drop column if exists departure_applied_at;
alter table public.hr_people drop column if exists departure_recorded_at;
alter table public.hr_people drop column if exists departure_by;
alter table public.hr_people drop column if exists departure_auto;
alter table public.hr_people drop column if exists departure_reason;
alter table public.hr_people drop column if exists departure_on;

delete from public.schema_migrations where version = '0515_rh_depart';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE depart_0515 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
