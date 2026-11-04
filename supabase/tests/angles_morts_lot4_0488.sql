-- Essai local de 0488 : état de la convention (intra, inter par groupes, sous-traitance) et alertes de complétude
-- alignées ; devis à relancer selon la cadence, la veille et les relances faites, et rappel du matin qui les compte ;
-- un appel enregistré clôt les rappels en attente du même client, un rappel planifié ne clôt rien.
begin;
set local client_min_messages = warning;
do $$
declare
  v_cie uuid; v_cli uuid; v_s1 uuid; v_s2 uuid; v_s3 uuid; v_s4 uuid; v_a uuid; v_b uuid; v_d uuid;
  v_q public.quotes; v_n int; v_meta jsonb;
  v_auj date := (now() at time zone 'Europe/Paris')::date;
begin
  select id into v_cie from public.companies limit 1;
  insert into public.clients (name, company_id) values ('Client essai 0488', v_cie) returning id into v_cli;

  -- 1. État de la convention
  insert into public.sessions (reference, start_date, end_date, status, convention_sent, convention_signed, company_id)
    values ('ESSAI-0488-1', v_auj - 10, v_auj - 10, 'completed', false, true, v_cie) returning id into v_s1;
  insert into public.sessions (reference, start_date, end_date, status, session_type, company_id)
    values ('ESSAI-0488-2', v_auj - 10, v_auj - 10, 'completed', 'inter', v_cie) returning id into v_s2;
  insert into public.session_groups (session_id, doc_status, company_id) values (v_s2, 'signe', v_cie), (v_s2, 'signe', v_cie);
  insert into public.session_groups (session_id, doc_status, status, company_id) values (v_s2, 'a_envoyer', 'cancelled', v_cie);
  insert into public.sessions (reference, start_date, end_date, status, session_type, company_id)
    values ('ESSAI-0488-3', v_auj - 10, v_auj - 10, 'completed', 'inter', v_cie) returning id into v_s3;
  insert into public.session_groups (session_id, doc_status, company_id) values (v_s3, 'signe', v_cie), (v_s3, 'envoye', v_cie);
  insert into public.sessions (reference, start_date, end_date, status, session_type, company_id)
    values ('ESSAI-0488-4', v_auj - 10, v_auj - 10, 'completed', 'subcontract', v_cie) returning id into v_s4;
  if app.convention_etat(v_s1) <> 'signee' then raise exception '1. signée sans envoi : %', app.convention_etat(v_s1); end if;
  if app.convention_etat(v_s2) <> 'signee' then raise exception '1. inter tous groupes signés : %', app.convention_etat(v_s2); end if;
  if app.convention_etat(v_s3) <> 'envoyee' then raise exception '1. inter signé et envoyé : %', app.convention_etat(v_s3); end if;
  if app.convention_etat(v_s4) <> 'sans_objet' then raise exception '1. sous-traitance : %', app.convention_etat(v_s4); end if;
  if app.convention_etat(gen_random_uuid()) <> 'a_envoyer' then raise exception '1. session inconnue'; end if;

  -- 2. Complétude : aucune alerte de convention à tort, l'alerte « non signée » juste pour l'inter envoyé
  perform public.detect_completude_blockers();
  select count(*) into v_n from public.completude_alerts
   where entity_id in (v_s1, v_s2, v_s4) and detail like 'Convention%' and resolved_at is null;
  if v_n <> 0 then raise exception '2. % alerte(s) de convention à tort', v_n; end if;
  select count(*) into v_n from public.completude_alerts where entity_id = v_s3 and detail = 'Convention non signée' and resolved_at is null;
  if v_n <> 1 then raise exception '2. inter envoyé : % alerte(s) « non signée »', v_n; end if;
  update public.session_groups set doc_status = 'signe' where session_id = v_s3;
  perform public.detect_completude_blockers();
  select count(*) into v_n from public.completude_alerts where entity_id = v_s3 and detail = 'Convention non signée' and resolved_at is null;
  if v_n <> 0 then raise exception '2. alerte « non signée » non levée après signature des groupes'; end if;

  -- 3. Devis à relancer
  insert into public.quotes (reference, client_id, status, quote_date, company_id)
    values ('ESSAI-0488-D1', v_cli, 'sent', v_auj - 8, v_cie) returning * into v_q;
  if not app.devis_a_relancer(v_q, v_auj) then raise exception '3. envoyé il y a 8 jours, jamais relancé'; end if;
  if app.devis_a_relancer(v_q, v_auj - 2) then raise exception '3. pas encore dû à J+6'; end if;
  v_q.followup_state := 'veille'; v_q.veille_until := v_auj + 1;
  if app.devis_a_relancer(v_q, v_auj) then raise exception '3. devis en veille compté'; end if;
  v_q.veille_until := v_auj;
  if not app.devis_a_relancer(v_q, v_auj) then raise exception '3. réveil du jour non compté'; end if;
  v_q.followup_state := 'actif'; v_q.veille_until := null; v_q.quote_date := v_auj - 30; v_q.relance_count := 1; v_q.last_relance_date := v_auj - 3;
  if app.devis_a_relancer(v_q, v_auj) then raise exception '3. relancé il y a 3 jours compté'; end if;
  v_q.last_relance_date := v_auj - 7;
  if not app.devis_a_relancer(v_q, v_auj) then raise exception '3. 7 jours après la relance non compté'; end if;
  v_q.relance_count := 2; v_q.last_relance_date := v_auj - 29;
  if app.devis_a_relancer(v_q, v_auj) then raise exception '3. 29 jours après la 2e relance compté'; end if;
  v_q.status := 'partial'; v_q.relance_count := 0; v_q.lost_reason := 'Prix';
  if app.devis_a_relancer(v_q, v_auj) then raise exception '3. partiel perdu compté'; end if;
  v_q.status := 'accepted'; v_q.lost_reason := null;
  if app.devis_a_relancer(v_q, v_auj) then raise exception '3. accepté compté'; end if;
  v_q.status := 'sent'; v_q.next_followup_date := v_auj + 3;
  if app.devis_a_relancer(v_q, v_auj) then raise exception '3. date fixée à la main ignorée'; end if;

  -- 4. Rappel du matin : le devis envoyé il y a 8 jours compte (next_followup_date vide)
  delete from public.notifications where type = 'rappel_matin' and company_id = v_cie;
  perform app.rappel_matin(true);
  select metadata into v_meta from public.notifications where type = 'rappel_matin' and company_id = v_cie;
  if v_meta is null or (v_meta ->> 'devis')::int < 1 then raise exception '4. rappel du matin : %', v_meta; end if;

  -- 5. Un appel clôt les rappels en attente du même client
  insert into public.prospect_calls (client_id, called_at, needs_callback, callback_date, company_id)
    values (v_cli, now() - interval '2 days', true, v_auj - 1, v_cie) returning id into v_a;
  insert into public.prospect_calls (client_id, called_at, needs_callback, callback_date, is_planned, company_id)
    values (v_cli, now() - interval '1 day', true, v_auj + 5, true, v_cie) returning id into v_d;
  if not (select needs_callback from public.prospect_calls where id = v_a) then raise exception '5. un rappel planifié a clos un rappel'; end if;
  insert into public.prospect_calls (client_id, called_at, needs_callback, company_id) values (v_cli, now(), false, v_cie) returning id into v_b;
  if (select needs_callback from public.prospect_calls where id = v_a) then raise exception '5. rappel non clos par l''appel suivant'; end if;
  if (select needs_callback from public.prospect_calls where id = v_d) then raise exception '5. rappel planifié plus tôt non clos'; end if;
  if (select notes from public.prospect_calls where id = v_a) not like 'Rappel clos par l''appel du %' then raise exception '5. note absente'; end if;
  insert into public.prospect_calls (client_id, called_at, needs_callback, callback_date, company_id)
    values (v_cli, now() + interval '1 minute', true, v_auj + 7, v_cie) returning id into v_a;
  insert into public.prospect_calls (client_id, called_at, needs_callback, company_id) values (v_cli, now() - interval '3 days', false, v_cie);
  if not (select needs_callback from public.prospect_calls where id = v_a) then raise exception '5. un appel plus ancien a clos un rappel plus récent'; end if;
end $$;
rollback;
