-- 0509 : évaluation à froid de l'employeur depuis l'espace par lien (même remède que 0504 pour l'avis de l'entreprise).
-- Défaut : le questionnaire à froid de l'employeur (0482) ne se remplissait que depuis l'espace entreprise par compte
-- (ent_froid, ent_froid_repondre). En production, aucun client n'a de compte : tous passent par le lien et le code.
-- Aucun employeur ne pouvait donc répondre, et le mail d'invitation menait à une page de connexion sans compte.
--   1. froid_employeur.repondu_acces : accès par lien qui a donné la réponse (trace d'une réponse sans compte).
--      Pas de clé étrangère : la réponse reçue est figée (app.froid_employeur_figee), une remise à vide par la base
--      la bloquerait. repondu_par (compte), repondu_acces (lien) ou saisi_par (organisme) : un des trois.
--   2. app.froid_employeur_client(client, société) : liste de ent_froid (0482), sortie telle quelle pour servir aux deux
--      espaces. app.froid_employeur_repondre(client, société, session, réponses, profil, accès) : règle de
--      ent_froid_repondre (questionnaire proposé, une seule réponse, réponses complètes, envois préparés ignorés).
--   3. public.ent_froid et public.ent_froid_repondre appellent ces règles (même résultat qu'avant).
--   4. public.client_portal_froid(jeton, code) et public.client_portal_froid_repondre(jeton, code, session, réponses) :
--      mêmes règles depuis l'espace par lien, après client_portal_check (erreurs du lien en JSON { error }), dans la
--      société de l'accès.
--   5. Qui voit quoi (relecture de 0509 ; 0482 ouvrait plus large, sans conséquence tant qu'aucun compte n'existait) :
--      le questionnaire de l'employeur n'est proposé qu'à l'entreprise qui a acheté la formation (client de la session,
--      ou groupe non annulé d'une inter), ou à l'employeur d'un stagiaire que l'organisme a choisi d'interroger (envoi
--      « employeur » préparé pour lui par app.froid_preparer_corps, qui retient le client de la session et celui de chaque
--      stagiaire présent) ; une entreprise ne voit une autre formation que pour ce questionnaire ou pour les salariés que
--      l'organisme lui a demandé de relancer (envoi « contact » à son adresse), avec leur code.
-- Retour arrière : supabase/rollback/0509_froid_employeur_par_lien_retour.sql (corps de 0482, fonctions du lien retirées ;
-- l'accès qui a donné chaque réponse par le lien est recopié dans audit_logs, puis la colonne repondu_acces est retirée).
-- Le code de l'écran et de l'API (lien du mail vers l'espace par lien) se retire avec lui.

-- ── 1. Trace ──
alter table public.froid_employeur add column if not exists repondu_acces uuid;
comment on column public.froid_employeur.repondu_acces is 'Accès par lien (client_portal_access) qui a donné la réponse ; vide si réponse par compte ou saisie (0509)';

-- ── 2. Règles communes ──
create or replace function app.froid_employeur_client(p_client uuid, p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare r public.froid_reglages := app.froid_reglage(p_company);
begin
  if p_client is null or p_company is null then
    raise exception 'Espace entreprise : client inconnu' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'actif', r.actif,
    'sessions', coalesce((select jsonb_agg(jsonb_build_object(
        'session_id', se.id, 'formation', co.title, 'debut', se.start_date, 'fin', coalesce(se.end_date, se.start_date),
        'employeur', case when (se.client_id = p_client
                                or exists (select 1 from public.session_groups g where g.session_id = se.id and g.client_id = p_client and g.status is distinct from 'cancelled')
                                or exists (select 1 from public.froid_envois e where e.session_id = se.id and e.client_id = p_client and e.cible = 'employeur'))
                           and (r.employeur_actif or exists (select 1 from public.froid_envois e where e.session_id = se.id and e.client_id = p_client and e.cible = 'employeur' and e.statut = 'envoye')) then jsonb_build_object(
            'recue', fe.completed_at is not null, 'recue_le', fe.completed_at,
            'questions', app.froid_questions(se.id, 'employeur')) end,
        'stagiaires', coalesce((select jsonb_agg(jsonb_build_object('prenom', tr.first_name, 'nom', tr.last_name,
              'recue', ec.completed_at is not null, 'code', st.access_code, 'jeton', se.attendance_token) order by tr.last_name, tr.first_name)
            from public.session_trainees st join public.trainees tr on tr.id = st.trainee_id
            left join public.evaluations_cold ec on ec.session_id = st.session_id and ec.trainee_id = st.trainee_id
            where st.session_id = se.id and tr.client_id = p_client and not coalesce(st.absent, false)
              and exists (select 1 from public.froid_envois e where e.session_id = se.id and e.trainee_id = st.trainee_id and e.client_id = p_client and e.cible = 'contact')), '[]'::jsonb))
        order by coalesce(se.end_date, se.start_date) desc)
      from public.sessions se left join public.courses co on co.id = se.course_id
      left join public.froid_employeur fe on fe.session_id = se.id and fe.client_id = p_client
      where se.company_id = p_company
        -- questionnaire ouvert par les réglages, ou déjà envoyé à l'employeur (il reste accessible si les réglages changent)
        and ((r.actif
              and se.status = 'completed' and coalesce(se.session_type, 'intra') <> 'subcontract'
       and not exists (select 1 from public.clients oc where oc.id = se.client_id and oc.client_type = 'organisme_formation')
              and coalesce(se.end_date, se.start_date) + coalesce(co.froid_delai_jours, r.premier_envoi_jours) <= public.paris_today()
              and (coalesce(se.end_date, se.start_date) >= public.paris_today() - r.anciennete_max_jours or se.froid_inclure))
             or exists (select 1 from public.froid_envois e where e.session_id = se.id and e.client_id = p_client and e.cible = 'employeur' and e.statut = 'envoye'))
        -- formation achetée par l'entreprise (client ou groupe non annulé), ou salarié à relancer par elle (envoi « contact »)
        and (se.client_id = p_client
             or exists (select 1 from public.session_groups g where g.session_id = se.id and g.client_id = p_client and g.status is distinct from 'cancelled')
             or exists (select 1 from public.froid_envois e where e.session_id = se.id and e.client_id = p_client and e.cible = 'employeur')
             or exists (select 1 from public.session_trainees st join public.trainees tr on tr.id = st.trainee_id
                         where st.session_id = se.id and tr.client_id = p_client and not coalesce(st.absent, false)
                           and exists (select 1 from public.froid_envois e where e.session_id = se.id and e.trainee_id = st.trainee_id
                                        and e.client_id = p_client and e.cible = 'contact')))), '[]'::jsonb));
end
$$;
revoke all on function app.froid_employeur_client(uuid, uuid) from public, anon, authenticated;

create or replace function app.froid_employeur_repondre(p_client uuid, p_company uuid, p_session uuid, p_reponses jsonb, p_profile uuid, p_acces uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_q jsonb; v_ok boolean;
begin
  -- session visible dans l'espace entreprise, avec un questionnaire employeur proposé (réglage actif ou déjà envoyé)
  select exists (select 1 from jsonb_array_elements(app.froid_employeur_client(p_client, p_company) -> 'sessions') x
                  where (x ->> 'session_id')::uuid = p_session and jsonb_typeof(x -> 'employeur') = 'object') into v_ok;
  if not v_ok then raise exception 'Questionnaire non disponible pour cette formation' using errcode = '22023'; end if;
  if exists (select 1 from public.froid_employeur fe where fe.session_id = p_session and fe.client_id = p_client and fe.completed_at is not null) then
    raise exception 'Votre réponse est déjà enregistrée : merci' using errcode = '23505';
  end if;
  v_q := app.froid_questions(p_session, 'employeur');
  if not app.froid_reponses_valides(v_q, p_reponses) then raise exception 'Merci de répondre à toutes les questions' using errcode = '22023'; end if;
  insert into public.froid_employeur (company_id, session_id, client_id, reponses, completed_at, repondu_par, repondu_acces)
  values (p_company, p_session, p_client, p_reponses, now(), p_profile, p_acces)
  on conflict (session_id, client_id) do update set reponses = excluded.reponses, completed_at = excluded.completed_at,
    repondu_par = excluded.repondu_par, repondu_acces = excluded.repondu_acces;
  update public.froid_envois set statut = 'ignore', motif = 'Réponse reçue'
   where session_id = p_session and client_id = p_client and cible = 'employeur' and statut = 'prepare';
  return jsonb_build_object('success', true);
end
$$;
revoke all on function app.froid_employeur_repondre(uuid, uuid, uuid, jsonb, uuid, uuid) from public, anon, authenticated;

-- ── 3. Espace entreprise par compte ──
create or replace function public.ent_froid()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v public.client_accounts := app.ent_compte();
begin
  return app.froid_employeur_client(v.client_id, v.company_id);
end
$$;
revoke all on function public.ent_froid() from public, anon;
grant execute on function public.ent_froid() to authenticated;

create or replace function public.ent_froid_repondre(p_session uuid, p_reponses jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v public.client_accounts := app.ent_compte();
begin
  return app.froid_employeur_repondre(v.client_id, v.company_id, p_session, p_reponses, (select auth.uid()), null);
end
$$;
revoke all on function public.ent_froid_repondre(uuid, jsonb) from public, anon;
grant execute on function public.ent_froid_repondre(uuid, jsonb) to authenticated;

-- ── 4. Espace par lien ──
create or replace function public.client_portal_froid(p_token text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_check jsonb := public.client_portal_check(p_token, p_code); a public.client_portal_access;
begin
  if v_check ? 'error' then return v_check; end if;
  select * into a from public.client_portal_access where token = p_token;
  return app.froid_employeur_client(a.client_id, a.company_id);
end
$$;
revoke all on function public.client_portal_froid(text, text) from public;
grant execute on function public.client_portal_froid(text, text) to anon, authenticated;

create or replace function public.client_portal_froid_repondre(p_token text, p_code text, p_session uuid, p_reponses jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_check jsonb := public.client_portal_check(p_token, p_code); a public.client_portal_access;
begin
  if v_check ? 'error' then return v_check; end if;
  select * into a from public.client_portal_access where token = p_token;
  return app.froid_employeur_repondre(a.client_id, a.company_id, p_session, p_reponses, null, a.id);
end
$$;
revoke all on function public.client_portal_froid_repondre(text, text, uuid, jsonb) from public;
grant execute on function public.client_portal_froid_repondre(text, text, uuid, jsonb) to anon, authenticated;

comment on table public.froid_employeur is 'Évaluation à froid de l''employeur (0482) : réponse figée dès sa réception ; donnée par compte (repondu_par), par lien (repondu_acces, 0509) ou saisie (saisi_par)';

insert into public.schema_migrations (version) values ('0509_froid_employeur_par_lien') on conflict (version) do nothing;
