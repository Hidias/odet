-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (f13_0160) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur odet-gld : 0160_pilote_sessions.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0160_pilote_sessions_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0160_pilote_sessions.sql =====
-- 0160_pilote_sessions.sql : fonction 13, pilote automatique des sessions (module « pilote »).
--
-- Spec : odet-f13-pilote-sessions.md (validée le 14/10/2026). Aucune nouvelle file : le moteur commun
-- scheduled_actions (0043) reçoit les étapes administratives des sessions, préparées chaque nuit, à valider dans
-- « Relances à valider ». Validation manuelle (décision du 11/10) : rien n'est envoyé par l'application ; une action
-- validée se fait depuis la session (envois existants) ou la messagerie, puis se marque « envoyée ».
-- 1. scheduled_actions : session_id (frise de la session, actions retirées avec la session), blocked_reason (l'action
--    reste visible avec la raison quand une condition manque) ; nouveaux types emargement_manquant, eval_chaud,
--    attestations, facture_brouillon (convocation, rappel, evaluation_froid, relance_impaye existent).
-- 2. public.pilote_generate() (tâche de nuit, après scheduled_actions_generate) : convocation (J-7), rappel (J-1),
--    émargement incomplet (fin de session), évaluation à chaud non remplie (J+1), attestations et certificats (fin de
--    session, bloqué tant que l'émargement ou les résultats manquent), évaluation à froid (J+60), facture (fin de
--    session, bloquée sans prix ni client facturé ; rien pour une sous-traitance pour le compte d'un autre
--    organisme), relance d'impayé (échéance + 7 puis + 30 jours). Une seule action par session (ou facture), étape et
--    palier : un passage rejoué ne prépare jamais deux fois la même chose ; une action à valider suit l'état de la
--    session (raison du blocage mise à jour) ; session annulée : ses actions à valider sont ignorées.
-- 3. Module « pilote » (org_modules), inactif par défaut ; réglages par étape dans org_modules.settings (actif, délai).
--    L'envoi automatique n'existe pas encore (« auto » réservé, toujours faux).
-- Aucune table nouvelle. Migration additive. Idempotente. Retour arrière : supabase/rollback/0160_pilote_sessions_retour.sql

alter table public.scheduled_actions add column if not exists session_id uuid references public.sessions(id) on delete cascade;
alter table public.scheduled_actions add column if not exists blocked_reason text;
create index if not exists scheduled_actions_session_idx on public.scheduled_actions (session_id) where session_id is not null;

alter table public.scheduled_actions drop constraint if exists scheduled_actions_kind_check;
alter table public.scheduled_actions add constraint scheduled_actions_kind_check check (kind in ('relance_recyclage', 'justificatif_prestataire',
  'convocation', 'rappel', 'evaluation_froid', 'relance_impaye', 'autre', 'renouvellement_contrat', 'visite_hors_contrat',
  'emargement_manquant', 'eval_chaud', 'attestations', 'facture_brouillon'));

-- Le statut de l'action reste tenu par 0043 ; la session d'une action ne se change pas depuis l'écran
create or replace function app.scheduled_actions_session_garde()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then new.session_id := old.session_id; end if;
  return new;
end
$$;
revoke all on function app.scheduled_actions_session_garde() from public, anon, authenticated;
drop trigger if exists scheduled_actions_session_garde on public.scheduled_actions;
create trigger scheduled_actions_session_garde before update on public.scheduled_actions for each row execute function app.scheduled_actions_session_garde();

-- ── 3. Module ──
insert into public.org_modules (key, label, enabled, position, description, settings)
values ('pilote', 'Pilote des sessions', false, 33,
        'Chaque nuit, les étapes administratives des sessions (convocations, rappels, émargement, évaluations, attestations, facture, impayés) sont préparées à valider',
        jsonb_build_object(
          'convocation', jsonb_build_object('actif', true, 'jours', 7, 'auto', false),
          'rappel', jsonb_build_object('actif', true, 'jours', 1, 'auto', false),
          'emargement', jsonb_build_object('actif', true, 'auto', false),
          'eval_chaud', jsonb_build_object('actif', true, 'jours', 1, 'auto', false),
          'attestations', jsonb_build_object('actif', true, 'auto', false),
          'eval_froid', jsonb_build_object('actif', true, 'jours', 60, 'auto', false),
          'facture', jsonb_build_object('actif', true, 'auto', false),
          'impaye', jsonb_build_object('actif', true, 'paliers', jsonb_build_array(7, 30), 'auto', false)))
on conflict (key) do nothing;

-- ── 2. Génération ──
create or replace function public.pilote_generate()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  st jsonb := coalesce((select m.settings from public.org_modules m where m.key = 'pilote'), '{}'::jsonb);
  v_conv int := coalesce((st -> 'convocation' ->> 'jours')::int, 7);
  v_froid int := coalesce((st -> 'eval_froid' ->> 'jours')::int, 60);
  v_chaud int := coalesce((st -> 'eval_chaud' ->> 'jours')::int, 1);
  v_n jsonb := '{}'::jsonb;
  v_c int;
  p int;
begin
  if coalesce((select auth.role()), '') not in ('service_role', '') and not app.a_le_droit('plateforme.administrer') then
    raise exception 'Réservé à la tâche de nuit' using errcode = '42501';
  end if;
  if not exists (select 1 from public.org_modules m where m.key = 'pilote' and m.enabled) then
    return jsonb_build_object('pilote', 'inactif');
  end if;

  -- Session annulée : ses actions à valider sont ignorées
  update public.scheduled_actions a set status = 'ignore', error = 'Session annulée'
  from public.sessions s
  where a.session_id = s.id and a.status = 'a_valider' and coalesce(s.status, '') in ('cancelled', 'annulee');

  -- Sessions concernées (hors annulées)
  create temporary table if not exists pg_temp.pilote_sessions on commit drop as
  select s.id, s.company_id, s.reference, s.client_id, s.session_type, s.start_date, s.end_date, s.start_time, s.location_name,
         s.location_city, s.is_remote, s.status, s.total_price, s.use_custom_price, s.custom_price_ht, s.inter_total_price,
         co.title as course_title, co.price_ht as course_price, c.name as client_name,
         coalesce(nullif(btrim(c.billing_email), ''), nullif(btrim(c.contact_email), ''), nullif(btrim(c.email), '')) as client_email,
         (select count(*) from public.session_trainees x where x.session_id = s.id and not coalesce(x.absent, false)) as nb,
         (select count(*) from public.session_trainees x join public.trainees t on t.id = x.trainee_id
          where x.session_id = s.id and nullif(btrim(t.email), '') is not null and not coalesce(t.email_refused, false)) as nb_email,
         (select count(*) from public.session_trainees x where x.session_id = s.id and x.convocation_sent_at is null and not coalesce(x.absent, false)) as nb_sans_convocation
  from public.sessions s
  left join public.courses co on co.id = s.course_id
  left join public.clients c on c.id = s.client_id
  where coalesce(s.status, '') not in ('cancelled', 'annulee')
    and s.start_date is not null
    and s.start_date <= current_date + greatest(v_conv, 1)
    and coalesce(s.end_date, s.start_date) >= current_date - greatest(v_froid + 7, 45);

  -- Convocation (J-7 par défaut)
  if coalesce((st -> 'convocation' ->> 'actif')::boolean, true) then
    insert into public.scheduled_actions (company_id, kind, target_table, target_id, session_id, client_id, due_on, title, payload, dedup_key, blocked_reason)
    select s.company_id, 'convocation', 'sessions', s.id, s.id, s.client_id, s.start_date - v_conv,
           'Convocations ' || coalesce(s.course_title, 'formation') || ' du ' || to_char(s.start_date, 'DD/MM/YYYY') || coalesce(' (' || s.client_name || ')', ''),
           jsonb_build_object('lien', '/sessions/' || s.id, 'etape', 'convocation', 'destinataire', s.client_email,
             'objet', 'Convocation : ' || coalesce(s.course_title, 'formation') || ' du ' || to_char(s.start_date, 'DD/MM/YYYY'),
             'texte', 'Convocations à envoyer depuis la session (envoi « avant la formation ») : ' || s.nb_sans_convocation || ' stagiaire(s) sans convocation.'),
           'convocation:' || s.id,
           case when s.nb = 0 then 'Aucun stagiaire inscrit'
                when not coalesce(s.is_remote, false) and nullif(btrim(coalesce(s.location_name, s.location_city, '')), '') is null then 'Lieu non renseigné'
                when s.start_time is null then 'Horaires non renseignés'
                when s.nb_email = 0 then 'Aucun stagiaire avec une adresse email' end
    from pg_temp.pilote_sessions s
    where s.start_date between current_date and current_date + v_conv and s.nb_sans_convocation > 0
    on conflict (company_id, dedup_key) do update set blocked_reason = excluded.blocked_reason, payload = excluded.payload
      where public.scheduled_actions.status = 'a_valider';
    get diagnostics v_c = row_count; v_n := v_n || jsonb_build_object('convocation', v_c);
  end if;

  -- Rappel (J-1), quand les convocations sont parties
  if coalesce((st -> 'rappel' ->> 'actif')::boolean, true) then
    insert into public.scheduled_actions (company_id, kind, target_table, target_id, session_id, client_id, due_on, title, payload, dedup_key)
    select s.company_id, 'rappel', 'sessions', s.id, s.id, s.client_id, s.start_date - 1,
           'Rappel ' || coalesce(s.course_title, 'formation') || ' de demain' || coalesce(' (' || s.client_name || ')', ''),
           jsonb_build_object('lien', '/sessions/' || s.id, 'etape', 'rappel', 'destinataire', s.client_email,
             'objet', 'Rappel : formation ' || coalesce(s.course_title, '') || ' demain',
             'texte', 'Bonjour,' || E'\n\n' || 'Nous vous rappelons la formation « ' || coalesce(s.course_title, '') || ' » qui commence demain, le '
               || to_char(s.start_date, 'DD/MM/YYYY') || coalesce(' à ' || to_char(s.start_time, 'HH24"h"MI'), '')
               || coalesce(', ' || nullif(btrim(concat_ws(', ', s.location_name, s.location_city)), ''), '') || '.' || E'\n\n' || 'Bien cordialement,'),
           'rappel:' || s.id
    from pg_temp.pilote_sessions s
    where s.start_date = current_date + 1 and s.nb > 0 and s.nb_sans_convocation < s.nb
    on conflict (company_id, dedup_key) do nothing;
    get diagnostics v_c = row_count; v_n := v_n || jsonb_build_object('rappel', v_c);
  end if;

  -- Émargement incomplet, de la fin de session à 7 jours après
  if coalesce((st -> 'emargement' ->> 'actif')::boolean, true) then
    insert into public.scheduled_actions (company_id, kind, target_table, target_id, session_id, client_id, due_on, title, payload, dedup_key)
    select s.company_id, 'emargement_manquant', 'sessions', s.id, s.id, s.client_id, coalesce(s.end_date, s.start_date),
           'Émargement incomplet : ' || coalesce(s.course_title, 'formation') || ' du ' || to_char(s.start_date, 'DD/MM/YYYY'),
           jsonb_build_object('lien', '/sessions/' || s.id, 'etape', 'emargement',
             'texte', 'Des demi-journées ne sont pas signées : compléter l''émargement depuis la session (onglet Présence).'),
           'emargement:' || s.id
    from pg_temp.pilote_sessions s
    where coalesce(s.end_date, s.start_date) between current_date - 7 and current_date and s.nb > 0
      and exists (select 1 from public.session_trainees x
                  where x.session_id = s.id and not coalesce(x.absent, false)
                    and not exists (select 1 from public.attendance_halfdays h where h.session_id = s.id and h.trainee_id = x.trainee_id and (h.morning or h.afternoon)))
    on conflict (company_id, dedup_key) do nothing;
    get diagnostics v_c = row_count; v_n := v_n || jsonb_build_object('emargement', v_c);
  end if;

  -- Évaluation à chaud non remplie (J+1)
  if coalesce((st -> 'eval_chaud' ->> 'actif')::boolean, true) then
    insert into public.scheduled_actions (company_id, kind, target_table, target_id, session_id, client_id, due_on, title, payload, dedup_key)
    select s.company_id, 'eval_chaud', 'sessions', s.id, s.id, s.client_id, coalesce(s.end_date, s.start_date) + v_chaud,
           'Évaluations à chaud à relancer : ' || coalesce(s.course_title, 'formation') || ' du ' || to_char(s.start_date, 'DD/MM/YYYY'),
           jsonb_build_object('lien', '/sessions/' || s.id, 'etape', 'eval_chaud',
             'texte', 'Des stagiaires n''ont pas rempli le questionnaire de satisfaction (indicateur 30) : relancer depuis la session.'),
           'eval_chaud:' || s.id
    from pg_temp.pilote_sessions s
    where coalesce(s.end_date, s.start_date) between current_date - 14 and current_date - v_chaud and s.nb > 0
      and exists (select 1 from public.session_trainees x where x.session_id = s.id and not coalesce(x.absent, false)
                  and not coalesce(x.evaluation_completed, false)
                  and not exists (select 1 from public.trainee_evaluations e where e.session_id = s.id and e.trainee_id = x.trainee_id))
    on conflict (company_id, dedup_key) do nothing;
    get diagnostics v_c = row_count; v_n := v_n || jsonb_build_object('eval_chaud', v_c);
  end if;

  -- Attestations et certificats (fin de session), bloqués tant que l'émargement ou les résultats manquent
  if coalesce((st -> 'attestations' ->> 'actif')::boolean, true) then
    insert into public.scheduled_actions (company_id, kind, target_table, target_id, session_id, client_id, due_on, title, payload, dedup_key, blocked_reason)
    select s.company_id, 'attestations', 'sessions', s.id, s.id, s.client_id, coalesce(s.end_date, s.start_date),
           'Attestations et certificats : ' || coalesce(s.course_title, 'formation') || ' du ' || to_char(s.start_date, 'DD/MM/YYYY'),
           jsonb_build_object('lien', '/sessions/' || s.id, 'etape', 'attestations', 'destinataire', s.client_email,
             'objet', 'Attestations de la formation ' || coalesce(s.course_title, ''),
             'texte', 'Attestations de présence et certificats de réalisation à envoyer depuis la session (envoi « après la formation »).'),
           'attestations:' || s.id,
           case when exists (select 1 from public.session_trainees x where x.session_id = s.id and not coalesce(x.absent, false)
                             and not exists (select 1 from public.attendance_halfdays h where h.session_id = s.id and h.trainee_id = x.trainee_id and (h.morning or h.afternoon)))
                  then 'Émargement incomplet'
                when exists (select 1 from public.session_trainees x where x.session_id = s.id and not coalesce(x.absent, false) and x.result is null)
                  then 'Résultats non saisis' end
    from pg_temp.pilote_sessions s
    where coalesce(s.end_date, s.start_date) between current_date - 30 and current_date - 0 and s.nb > 0
      and exists (select 1 from public.session_trainees x where x.session_id = s.id and not coalesce(x.absent, false) and not coalesce(x.certificate_sent_individual, false))
    on conflict (company_id, dedup_key) do update set blocked_reason = excluded.blocked_reason
      where public.scheduled_actions.status = 'a_valider';
    get diagnostics v_c = row_count; v_n := v_n || jsonb_build_object('attestations', v_c);
  end if;

  -- Évaluation à froid (J+60 par défaut)
  if coalesce((st -> 'eval_froid' ->> 'actif')::boolean, true) then
    insert into public.scheduled_actions (company_id, kind, target_table, target_id, session_id, client_id, due_on, title, payload, dedup_key)
    select s.company_id, 'evaluation_froid', 'sessions', s.id, s.id, s.client_id, coalesce(s.end_date, s.start_date) + v_froid,
           'Évaluation à froid : ' || coalesce(s.course_title, 'formation') || ' du ' || to_char(s.start_date, 'DD/MM/YYYY'),
           jsonb_build_object('lien', '/sessions/' || s.id, 'etape', 'eval_froid',
             'texte', 'Questionnaire d''évaluation à froid à envoyer aux stagiaires depuis la session.'),
           'eval_froid:' || s.id
    from pg_temp.pilote_sessions s
    where coalesce(s.end_date, s.start_date) between current_date - v_froid - 7 and current_date - v_froid and s.nb > 0
      and exists (select 1 from public.session_trainees x where x.session_id = s.id and not coalesce(x.absent, false) and not coalesce(x.cold_eval_sent_individual, false))
    on conflict (company_id, dedup_key) do nothing;
    get diagnostics v_c = row_count; v_n := v_n || jsonb_build_object('eval_froid', v_c);
  end if;

  -- Facture (fin de session) : rien si une facture existe déjà ou pour une sous-traitance pour le compte d'un autre
  if coalesce((st -> 'facture' ->> 'actif')::boolean, true) then
    insert into public.scheduled_actions (company_id, kind, target_table, target_id, session_id, client_id, due_on, title, payload, dedup_key, blocked_reason)
    select s.company_id, 'facture_brouillon', 'sessions', s.id, s.id, s.client_id, coalesce(s.end_date, s.start_date),
           'Facture à préparer : ' || coalesce(s.course_title, 'formation') || ' du ' || to_char(s.start_date, 'DD/MM/YYYY') || coalesce(' (' || s.client_name || ')', ''),
           jsonb_build_object('lien', '/sessions/' || s.id, 'etape', 'facture',
             'texte', 'Préparer la facture depuis la session (« Facturer »), puis la relire et l''émettre.'),
           'facture:' || s.id,
           case when s.client_id is null and s.session_type <> 'inter' then 'Client facturé non renseigné'
                when coalesce(nullif(s.total_price, 0), nullif(s.custom_price_ht, 0), nullif(s.inter_total_price, 0), nullif(s.course_price, 0)) is null then 'Prix non renseigné' end
    from pg_temp.pilote_sessions s
    where coalesce(s.end_date, s.start_date) between current_date - 30 and current_date and s.nb > 0
      and coalesce(s.session_type, 'intra') <> 'subcontract'
      and not exists (select 1 from public.invoices i where i.session_id = s.id and coalesce(i.status, 'draft') not in ('cancelled'))
    on conflict (company_id, dedup_key) do update set blocked_reason = excluded.blocked_reason
      where public.scheduled_actions.status = 'a_valider';
    get diagnostics v_c = row_count; v_n := v_n || jsonb_build_object('facture', v_c);
  end if;

  -- Relance d'impayé : échéance + 7 jours, puis + 30 (paliers réglables)
  if coalesce((st -> 'impaye' ->> 'actif')::boolean, true) then
    v_c := 0;
    for p in select (x)::int from jsonb_array_elements_text(coalesce(st -> 'impaye' -> 'paliers', '[7, 30]'::jsonb)) x loop
      insert into public.scheduled_actions (company_id, kind, target_table, target_id, session_id, client_id, due_on, title, payload, dedup_key)
      select i.company_id, 'relance_impaye', 'invoices', i.id, i.session_id, coalesce(i.billing_client_id, i.client_id), i.due_date + p,
             'Facture ' || i.reference || ' impayée (' || p || ' jours après l''échéance)' || coalesce(' : ' || c.name, ''),
             jsonb_build_object('lien', '/factures?open=' || i.id, 'etape', 'impaye', 'palier', p,
               'destinataire', coalesce(nullif(btrim(c.billing_email), ''), nullif(btrim(c.contact_email), ''), nullif(btrim(c.email), '')),
               'objet', 'Facture ' || i.reference || ' : règlement en attente',
               'texte', 'Bonjour,' || E'\n\n' || 'Sauf erreur de notre part, la facture ' || i.reference || ' du ' || to_char(i.invoice_date, 'DD/MM/YYYY')
                 || ', d''un montant restant de ' || to_char(coalesce(i.amount_due, i.total_ttc), 'FM999G999G990D00') || ' €, arrivée à échéance le '
                 || to_char(i.due_date, 'DD/MM/YYYY') || ', n''est pas encore réglée. Pourriez-vous nous indiquer la date prévue du règlement ?'
                 || E'\n\n' || 'Bien cordialement,'),
             'impaye:' || i.id || ':' || p
      from public.invoices i left join public.clients c on c.id = coalesce(i.billing_client_id, i.client_id)
      where i.type = 'invoice' and coalesce(i.status, 'draft') in ('sent', 'due', 'overdue', 'partial')
        and coalesce(i.amount_due, i.total_ttc, 0) > 0 and i.due_date is not null
        and i.due_date + p between current_date - 14 and current_date
      on conflict (company_id, dedup_key) do nothing;
      get diagnostics p = row_count; v_c := v_c + p;
    end loop;
    v_n := v_n || jsonb_build_object('impaye', v_c);
  end if;

  drop table if exists pg_temp.pilote_sessions;
  return v_n;
end
$$;
revoke all on function public.pilote_generate() from public, anon;
grant execute on function public.pilote_generate() to authenticated, service_role;

insert into public.schema_migrations (version) values ('0160_pilote_sessions') on conflict (version) do nothing;
