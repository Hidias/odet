-- 0528 (B126, partie 3) : parcours automatique du statut des sessions (décisions de H du 25/11, QCM V82 et V83).
--   Prévue / Confirmée / En cours → À clôturer (to_close) : à l'heure de fin, heure de Paris.
--   À clôturer → À facturer (to_invoice) : quand tout est saisi (voir app.session_cloture_etat).
--   À facturer → Terminée (completed) : facture émise (non brouillon, non annulée), ou « pas de facture » avec motif.
-- Le verrou manuel (status_locked) ne bloque que le passage vers Terminée. Sous-traitance exclue du parcours :
-- elle garde la règle d'avant (Terminée le lendemain de la fin, sauf verrou), annulées désormais exclues.
-- Une session réalisée = À clôturer, À facturer ou Terminée (app.session_realisee, élargie ici ; le froid la lit
-- depuis 0527). Écran : « À clôturer » est calculé dès l'heure de fin ; la base l'écrit la nuit, à l'ouverture de la
-- fiche (session_avancer_statut) et à l'émission d'une facture.
-- Prérequis : 0527 appliquée. À appliquer seulement après la fusion (après le départ de l'auditrice le 27/11).
-- Retour arrière : supabase/rollback/0528_parcours_statut_session_retour.sql
begin;

do $$ begin
  if to_regprocedure('app.session_realisee(text)') is null then
    raise exception '0528 : appliquer 0527 d''abord';
  end if;
end $$;

alter table public.sessions add column if not exists sans_facture_motif text;
alter table public.sessions drop constraint if exists sessions_sans_facture_motif_check;
alter table public.sessions add constraint sessions_sans_facture_motif_check
  check (sans_facture_motif is null or length(btrim(sans_facture_motif)) between 3 and 500);
comment on column public.sessions.sans_facture_motif is 'B126 : session sans facture, motif obligatoire ; elle passe en Terminée dès que tout est saisi';

-- Réalisée : À clôturer, À facturer, Terminée
create or replace function app.session_realisee(p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$ select p_status = any (array['to_close', 'to_invoice', 'completed']) $$;

-- Ce qui manque pour passer « À facturer » (inscrits absents ou partis exclus, comme le froid)
create or replace function app.session_cloture_etat(p_session uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_presences boolean; v_objectifs boolean; v_chaud boolean; v_formateur boolean; v_avis boolean; v_inscrits int;
begin
  select count(*) into v_inscrits from public.session_trainees st where st.session_id = p_session;
  -- Présences : chaque inscrit présent à chaque demi-journée prévue, sauf absent ou parti avant cette date
  v_presences := v_inscrits > 0 and not exists (
    select 1 from public.session_trainees st cross join public.session_half_days(p_session) hd
     where st.session_id = p_session
       and not coalesce(st.absent, false)
       and not (coalesce(st.early_departure, false) and st.departure_date is not null and hd.d >= st.departure_date)
       and not exists (select 1 from public.attendance_halfdays a
                        where a.session_id = p_session and a.trainee_id = st.trainee_id and a.date = hd.d
                          and ((hd.period = 'morning' and a.morning) or (hd.period = 'afternoon' and a.afternoon))));
  -- Objectifs : résultat posé pour chaque présent (calculé à la saisie des objectifs)
  v_objectifs := v_inscrits > 0 and not exists (
    select 1 from public.session_trainees st
     where st.session_id = p_session and not coalesce(st.absent, false) and st.result is null);
  -- Évaluation à chaud : remise par chaque présent
  v_chaud := v_inscrits > 0 and not exists (
    select 1 from public.session_trainees st
     where st.session_id = p_session and not coalesce(st.absent, false)
       and not exists (select 1 from public.trainee_evaluations e
                        where e.session_id = p_session and e.trainee_id = st.trainee_id
                          and (coalesce(e.questionnaire_submitted, false) or coalesce(e.submitted_online, false))));
  v_formateur := exists (select 1 from public.trainer_evaluations t where t.session_id = p_session);
  -- Avis de l'entreprise demandé : envoi « Après formation » tracé
  v_avis := exists (select 1 from public.session_emails_sent m
                     where m.session_id = p_session and m.email_type = 'after' and coalesce(m.status, 'sent') = 'sent');
  return jsonb_build_object(
    'presences', v_presences, 'objectifs', v_objectifs, 'chaud', v_chaud, 'formateur', v_formateur, 'avis', v_avis,
    'complet', v_presences and v_objectifs and v_chaud and v_formateur and v_avis);
end
$$;
revoke all on function app.session_cloture_etat(uuid) from public, anon;

create or replace function app.session_facture_emise(p_session uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.invoices i
     where coalesce(i.type, 'invoice') <> 'credit_note' and i.status not in ('draft', 'cancelled')
       and (i.session_id = p_session
            or exists (select 1 from public.invoice_sessions l where l.invoice_id = i.id and l.session_id = p_session)))
$$;
revoke all on function app.session_facture_emise(uuid) from public, anon;

-- Fait avancer une session d'autant d'étapes que possible ; renvoie le nouveau statut, ou null si rien ne change
create or replace function app.session_avancer(p_session uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare s record; v text; v_fin timestamptz;
begin
  select se.id, se.status, coalesce(se.status_locked, false) as verrou, coalesce(se.session_type, 'intra') as type_session,
         coalesce(se.end_date, se.start_date) as fin_jour, se.end_time, se.sans_facture_motif
    into s from public.sessions se where se.id = p_session for update;
  if not found or s.type_session = 'subcontract' or s.fin_jour is null
     or coalesce(s.status, '') not in ('planned', 'confirmed', 'in_progress', 'to_close', 'to_invoice') then
    return null;
  end if;
  v_fin := (s.fin_jour + coalesce(s.end_time, time '23:59')) at time zone 'Europe/Paris';
  if now() < v_fin then return null; end if;
  v := s.status;
  if v in ('planned', 'confirmed', 'in_progress') then v := 'to_close'; end if;
  if v = 'to_close' and (app.session_cloture_etat(p_session) ->> 'complet')::boolean then v := 'to_invoice'; end if;
  if v = 'to_invoice' and not s.verrou
     and (app.session_facture_emise(p_session) or nullif(btrim(coalesce(s.sans_facture_motif, '')), '') is not null) then
    v := 'completed';
  end if;
  if v is not distinct from s.status then return null; end if;
  update public.sessions set status = v, updated_at = now() where id = p_session;
  return v;
end
$$;
revoke all on function app.session_avancer(uuid) from public, anon;

-- Appels depuis l'écran (fiche session)
create or replace function public.session_cloture_etat(p_session uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (app.evaluation_peut_saisir(p_session) or app.is_superadmin()) then
    raise exception 'Droit de suivi de la session requis' using errcode = '42501';
  end if;
  return app.session_cloture_etat(p_session) || jsonb_build_object('facture', app.session_facture_emise(p_session));
end
$$;
revoke all on function public.session_cloture_etat(uuid) from public, anon;
grant execute on function public.session_cloture_etat(uuid) to authenticated;

create or replace function public.session_avancer_statut(p_session uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (app.evaluation_peut_saisir(p_session) or app.is_superadmin()) then
    raise exception 'Droit de suivi de la session requis' using errcode = '42501';
  end if;
  return app.session_avancer(p_session);
end
$$;
revoke all on function public.session_avancer_statut(uuid) from public, anon;
grant execute on function public.session_avancer_statut(uuid) to authenticated;

-- Émission d'une facture : la ou les sessions liées avancent tout de suite
create or replace function app.facture_avancer_sessions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if tg_table_name = 'invoice_sessions' then
    perform app.session_avancer(new.session_id);
    return new;
  end if;
  if new.status in ('draft', 'cancelled') or (tg_op = 'UPDATE' and old.status is not distinct from new.status) then
    return new;
  end if;
  if new.session_id is not null then perform app.session_avancer(new.session_id); end if;
  for v_id in select l.session_id from public.invoice_sessions l where l.invoice_id = new.id loop
    perform app.session_avancer(v_id);
  end loop;
  return new;
end
$$;
revoke all on function app.facture_avancer_sessions() from public, anon;
drop trigger if exists trg_facture_avancer_sessions on public.invoices;
create trigger trg_facture_avancer_sessions after insert or update of status on public.invoices
  for each row execute function app.facture_avancer_sessions();
drop trigger if exists trg_facture_avancer_sessions on public.invoice_sessions;
create trigger trg_facture_avancer_sessions after insert on public.invoice_sessions
  for each row execute function app.facture_avancer_sessions();

-- Tâche de nuit : l'étape 1 suit le parcours (remplacement contrôlé du seul bloc de l'étape 1)
do $$
declare d text; v_avant text; v_apres text; n int;
begin
  d := pg_get_functiondef('public.daily_maintenance()'::regprocedure);
  v_avant := $b$  -- 1. Sessions passées : « terminée » le lendemain de la fin (sauf statut verrouillé)
  update public.sessions s
     set status = 'completed', updated_at = now()
   where s.status is distinct from 'completed'
     and coalesce(s.status_locked, false) = false
     and s.end_date is not null
     and s.end_date < v_today;
  get diagnostics v_sessions = row_count;$b$;
  v_apres := $b$  -- 1. Statut des sessions (B126, 0528) : sous-traitance « terminée » le lendemain de la fin (sauf verrou
  --    ou annulée) ; les autres suivent le parcours À clôturer, À facturer, Terminée (app.session_avancer)
  update public.sessions s
     set status = 'completed', updated_at = now()
   where coalesce(s.session_type, 'intra') = 'subcontract'
     and coalesce(s.status, '') not in ('completed', 'cancelled')
     and coalesce(s.status_locked, false) = false
     and s.end_date is not null
     and s.end_date < v_today;
  get diagnostics v_sessions = row_count;
  v_sessions := v_sessions + (select count(*) from (
    select app.session_avancer(s.id) as nouveau from public.sessions s
     where coalesce(s.session_type, 'intra') <> 'subcontract'
       and s.status in ('planned', 'confirmed', 'in_progress', 'to_close', 'to_invoice')
       and coalesce(s.end_date, s.start_date) <= v_today) x where x.nouveau is not null);$b$;
  n := (length(d) - length(replace(d, v_avant, ''))) / length(v_avant);
  if n <> 1 then
    raise exception '0528 : étape 1 de daily_maintenance introuvable telle que relue le 25/11 (% occurrence)', n;
  end if;
  execute replace(d, v_avant, v_apres);
end $$;

insert into public.schema_migrations (version) values ('0528_parcours_statut_session') on conflict (version) do nothing;
commit;
