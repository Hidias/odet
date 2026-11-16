-- Retour arrière de 0519 : réglage à trois modes retiré, interrupteurs ouvert / fermé de 0382 remis.
-- Ouvert recalculé depuis le mode : questionnaires à froid ouverts s'ils étaient à valider, relances du circuit et
-- demande du n° ouvertes s'ils étaient en automatique. Les relances du circuit déjà préparées dans la file restent,
-- en type « autre » (même texte, même état) ; celles qui sont parties sont notées dans circuit_relances pour ne pas
-- repartir par l'ancienne route. Le journal garde chaque changement (actions de 0519 ramenées à ouvert / fermé).

-- Interrupteurs : ouvert d'après le mode
update public.auto_send_switches set enabled = case kind
    when 'evaluation_froid' then coalesce(mode, 'a_valider') <> 'ferme'
    when 'relance_circuit' then mode = 'auto'
    when 'demande_nir' then mode = 'auto'
    else enabled end
 where mode is not null;
delete from public.auto_send_switches where kind in ('relance_impaye', 'avis_financeur', 'rappel', 'autre');
alter table public.auto_send_switches drop constraint if exists auto_send_switches_mode_check;
alter table public.auto_send_switches drop column if exists mode;
alter table public.auto_send_switches drop constraint if exists auto_send_switches_kind_check;
alter table public.auto_send_switches add constraint auto_send_switches_kind_check
  check (kind in ('relance_recyclage', 'relance_devis', 'relance_facture', 'convocation', 'attestation', 'evaluation_froid',
                  'renouvellement_contrat', 'visite_hors_contrat', 'justificatif_prestataire', 'relance_circuit', 'demande_nir'));
update public.auto_send_switch_log set motif = concat_ws(' ; ', 'Mode ' || action, motif),
  action = case when action = 'automatique' or (action = 'a_valider' and kind = 'evaluation_froid') then 'ouvert' else 'ferme' end
 where action in ('a_valider', 'automatique');
alter table public.auto_send_switch_log drop constraint if exists auto_send_switch_log_action_check;
alter table public.auto_send_switch_log add constraint auto_send_switch_log_action_check
  check (action in ('ouvert', 'ferme', 'suspendu', 'repris'));

-- Relances du circuit de la file : parties notées, puis type « autre »
insert into public.circuit_relances (company_id, session_id, kind, sent_to)
select a.company_id, a.session_id, a.payload->>'circuit', left(a.payload->>'destinataire', 255)
  from public.scheduled_actions a
 where a.kind = 'relance_circuit' and a.status = 'envoye' and a.session_id is not null and a.payload->>'circuit' in ('participants', 'convention')
on conflict (session_id, kind) do nothing;
alter table public.scheduled_actions drop constraint if exists scheduled_actions_kind_check;
-- La règle d'état garde le type (« ne se corrige pas depuis l'écran ») : levée le temps de la conversion
alter table public.scheduled_actions disable trigger scheduled_actions_maj;
update public.scheduled_actions set kind = 'autre' where kind = 'relance_circuit';
alter table public.scheduled_actions enable trigger scheduled_actions_maj;
alter table public.scheduled_actions add constraint scheduled_actions_kind_check check (kind = any (array[
  'relance_recyclage', 'justificatif_prestataire', 'convocation', 'rappel', 'evaluation_froid', 'relance_impaye', 'autre',
  'renouvellement_contrat', 'visite_hors_contrat', 'emargement_manquant', 'eval_chaud', 'attestations', 'facture_brouillon',
  'avis_financeur']));
create or replace function app.relance_envoyable(p_kind text, p_payload jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_kind in ('relance_recyclage', 'justificatif_prestataire', 'rappel', 'relance_impaye', 'avis_financeur',
                             'renouvellement_contrat', 'visite_hors_contrat', 'autre'), false)
     and coalesce((p_payload->>'interne')::boolean, false) = false
     and coalesce((p_payload->>'a_valider_par_expert')::boolean, false) = false
     and coalesce(p_payload->>'etape', '') not in ('convocation', 'attestations', 'emargement', 'eval_chaud', 'eval_froid', 'facture', 'mise_en_demeure')
$$;
revoke all on function app.relance_envoyable(text, jsonb) from public, anon;
grant execute on function app.relance_envoyable(text, jsonb) to authenticated, service_role;

create or replace function app.envoi_auto_types()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['relance_recyclage', 'relance_devis', 'relance_facture', 'convocation', 'attestation', 'evaluation_froid',
               'renouvellement_contrat', 'visite_hors_contrat', 'justificatif_prestataire', 'relance_circuit', 'demande_nir']
$$;

create or replace function app.envoi_auto_autorise(p_company uuid, p_kind text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.enabled and (s.suspended_until is null or s.suspended_until <= now())
                     from public.auto_send_switches s where s.company_id = p_company and s.kind = p_kind), false)
$$;
revoke all on function app.envoi_auto_autorise(uuid, text) from public, anon;
grant execute on function app.envoi_auto_autorise(uuid, text) to authenticated, service_role;
grant execute on function public.envoi_auto_regler(uuid, text, boolean) to authenticated;

create or replace function public.circuit_relances_dues()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('session_id', x.id, 'kind', x.kind, 'reference', x.reference, 'start_date', x.start_date,
    'start_time', x.start_time, 'course', x.course, 'client', x.client, 'contact_name', x.contact_name, 'email', x.email)), '[]'::jsonb)
  from (
    select s.id, k.kind, s.reference, s.start_date, s.start_time, co.title course, c.name client,
      coalesce(cc.first_name, cc.name) contact_name,
      coalesce(nullif(cc.email, ''), nullif(c.billing_email, ''), nullif(c.contact_email, ''), nullif(c.email, '')) email
    from public.sessions s
    join public.clients c on c.id = s.client_id
    left join public.courses co on co.id = s.course_id
    left join public.client_contacts cc on cc.id = s.contact_id
    cross join lateral (values ('participants'), ('convention')) k(kind)
    where s.quote_id is not null and not coalesce(s.validation_requise, false) and s.start_date > current_date
      and app.envoi_auto_autorise(s.company_id, 'relance_circuit')
      and not exists (select 1 from public.demo_records r where r.tbl = 'sessions' and r.id = s.id)
      and not exists (select 1 from public.circuit_relances r where r.session_id = s.id and r.kind = k.kind)
      and ((k.kind = 'participants' and s.start_date - current_date <= 10
            and not exists (select 1 from public.session_trainees st where st.session_id = s.id))
        or (k.kind = 'convention' and s.start_date - current_date <= 7 and not coalesce(s.convention_signed, false)
            and exists (select 1 from public.session_trainees st where st.session_id = s.id)))
  ) x
  where x.email is not null
$$;
revoke all on function public.circuit_relances_dues() from public, anon, authenticated;
grant execute on function public.circuit_relances_dues() to service_role;

create or replace function public.froid_envois_reserver(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v jsonb := '[]'::jsonb; e record; v_refus jsonb := '[]'::jsonb;
begin
  if (select auth.uid()) is null then raise exception 'Connexion requise' using errcode = '42501'; end if;
  if cardinality(p_ids) > 200 then raise exception 'Au plus 200 envois à la fois' using errcode = '22023'; end if;
  -- Une réservation à la fois par adresse : deux personnes qui envoient en même temps à la même adresse passent
  -- l'une après l'autre, la seconde voit la première « en cours » et attend le lendemain.
  -- Verrous pris dans l'ordre des adresses, pour que deux réservations ne s'attendent jamais l'une l'autre.
  perform pg_advisory_xact_lock(hashtextextended('froid_envoi:' || a.adresse, 0))
     from (select distinct lower(x.destinataire) as adresse from public.froid_envois x
            where x.id = any (p_ids) and x.destinataire is not null order by 1) a;
  for e in
    select x.* from public.froid_envois x where x.id = any (p_ids) order by x.session_id, x.destinataire for update
  loop
    if e.company_id not in (select app.societes_avec_droit('formation.convocations.envoyer')) then
      v_refus := v_refus || jsonb_build_object('id', e.id, 'raison', 'Droit d''envoyer aux stagiaires et aux clients requis'); continue;
    end if;
    if not app.envoi_auto_autorise(e.company_id, 'evaluation_froid') then
      v_refus := v_refus || jsonb_build_object('id', e.id, 'raison', 'Envoi « Questionnaires à froid » fermé dans la Console'); continue;
    end if;
    if e.statut <> 'prepare' then
      v_refus := v_refus || jsonb_build_object('id', e.id, 'raison', 'Déjà traité'); continue;
    end if;
    if not app.froid_email_valide(e.destinataire) then
      v_refus := v_refus || jsonb_build_object('id', e.id, 'raison', 'Adresse invalide'); continue;
    end if;
    -- Une adresse, un envoi par jour
    -- Seule exception : contact et employeur d'une même session choisis ensemble, qui partent dans un seul mail.
    -- Choisis en deux fois, la seconde attend le lendemain ; une autre session aussi.
    if exists (select 1 from public.froid_envois y where lower(y.destinataire) = lower(e.destinataire) and y.id <> e.id
        and not (e.cible <> 'stagiaire' and y.cible <> 'stagiaire' and y.session_id = e.session_id and y.id = any (p_ids)
                 and (y.statut = 'prepare' or (y.statut = 'en_cours' and y.reserve_le = now() and y.envoye_par = (select auth.uid()))))
        and (y.statut = 'en_cours' or (y.statut = 'envoye' and y.envoye_le > now() - interval '1 day'))) then
      v_refus := v_refus || jsonb_build_object('id', e.id, 'raison', 'Adresse déjà écrite depuis moins d''un jour'); continue;
    end if;
    if e.cible = 'stagiaire' and exists (select 1 from public.evaluations_cold ec where ec.session_id = e.session_id and ec.trainee_id = e.trainee_id and ec.completed_at is not null) then
      update public.froid_envois set statut = 'ignore', motif = 'Réponse reçue' where id = e.id;
      v_refus := v_refus || jsonb_build_object('id', e.id, 'raison', 'Réponse déjà reçue'); continue;
    end if;
    -- La session et la personne sont-elles toujours concernées ? (session terminée, ni sous-traitance ni autre organisme ;
    -- stagiaire inscrit et présent ; employeur client de la session ou d'un stagiaire présent). Sinon : refus sans toucher
    -- à la ligne, qui repart dès que la situation est corrigée (une absence notée par erreur, par exemple).
    if not exists (select 1 from public.sessions se left join public.clients oc on oc.id = se.client_id
                    where se.id = e.session_id and se.status = 'completed' and coalesce(se.session_type, 'intra') <> 'subcontract'
                      and coalesce(oc.client_type, '') <> 'organisme_formation')
       or (e.trainee_id is not null and not exists (select 1 from public.session_trainees st
                    where st.session_id = e.session_id and st.trainee_id = e.trainee_id and not coalesce(st.absent, false)))
       or (e.cible = 'employeur' and not exists (select 1 from public.sessions se where se.id = e.session_id and se.client_id = e.client_id)
           and not exists (select 1 from public.session_trainees st join public.trainees tr on tr.id = st.trainee_id
                    where st.session_id = e.session_id and tr.client_id = e.client_id and not coalesce(st.absent, false))) then
      v_refus := v_refus || jsonb_build_object('id', e.id, 'raison', 'Session ou stagiaire plus concerné (vérifiez la session, l''inscription ou la présence)'); continue;
    end if;
    update public.froid_envois set statut = 'en_cours', envoye_par = (select auth.uid()), reserve_le = now() where id = e.id;
    v := v || (select jsonb_build_object(
        'id', e.id, 'company_id', e.company_id, 'session_id', e.session_id, 'cible', e.cible, 'rang', e.rang,
        'destinataire', e.destinataire, 'destinataire_nom', e.destinataire_nom,
        'formation', co.title, 'debut', se.start_date, 'fin', coalesce(se.end_date, se.start_date), 'jeton', se.attendance_token,
        'prenom', tr.first_name, 'nom', tr.last_name, 'code', st.access_code, 'entreprise', cl.name)
      from public.sessions se left join public.courses co on co.id = se.course_id
      left join public.trainees tr on tr.id = e.trainee_id
      left join public.session_trainees st on st.session_id = e.session_id and st.trainee_id = e.trainee_id
      left join public.clients cl on cl.id = e.client_id
      where se.id = e.session_id);
  end loop;
  return jsonb_build_object('envois', v, 'refus', v_refus);
end
$$;
revoke all on function public.froid_envois_reserver(uuid[]) from public, anon;
grant execute on function public.froid_envois_reserver(uuid[]) to authenticated;

drop function if exists public.froid_envoi_terminer(uuid, uuid, boolean, text, text, text);
create or replace function public.froid_envoi_terminer(p_id uuid, p_ok boolean, p_message_id text default null, p_boite text default null, p_erreur text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare e public.froid_envois;
begin
  select * into e from public.froid_envois where id = p_id and statut = 'en_cours' and envoye_par = (select auth.uid()) for update;
  if e.id is null then raise exception 'Envoi introuvable ou déjà terminé' using errcode = '22023'; end if;
  if p_ok then
    update public.froid_envois set statut = 'envoye', envoye_le = now(), message_id = left(p_message_id, 300), boite = left(p_boite, 255), motif = null where id = p_id;
    if e.cible in ('stagiaire', 'contact') then
      insert into public.evaluations_cold (session_id, trainee_id, sent_at) values (e.session_id, e.trainee_id, now())
      on conflict (session_id, trainee_id) do update set sent_at = coalesce(public.evaluations_cold.sent_at, now())
       where public.evaluations_cold.completed_at is null;
      update public.session_trainees set cold_eval_sent_individual = true, cold_eval_sent_individual_date = coalesce(cold_eval_sent_individual_date, now())
       where session_id = e.session_id and trainee_id = e.trainee_id;
    end if;
  else
    update public.froid_envois set statut = 'erreur', motif = left(coalesce(p_erreur, 'Échec de l''envoi'), 300) where id = p_id;
  end if;
end
$$;
revoke all on function public.froid_envoi_terminer(uuid, boolean, text, text, text) from public, anon;
grant execute on function public.froid_envoi_terminer(uuid, boolean, text, text, text) to authenticated;

drop function if exists public.relance_auto_reserver(uuid);
drop function if exists public.relances_auto_a_envoyer(integer);
drop function if exists public.circuit_relances_ecarter();
drop function if exists public.circuit_relance_preparer(uuid, text, text, text, text);
drop function if exists public.envois_reglages(uuid);
drop function if exists app.envoi_sans_retouche(uuid, text);
drop function if exists public.envoi_regler(uuid, text, text);
drop function if exists app.envoi_ouvert(uuid, text);
drop function if exists app.envoi_suspendu(uuid, text);
drop function if exists app.envoi_mode(uuid, text);
drop function if exists app.envoi_modes_permis(text);
drop function if exists app.envoi_types();

delete from public.schema_migrations where version = '0519_envois_reglages';
