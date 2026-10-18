-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (c1_0376) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur odet-gld : 0376_maintenance_nuit.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0376_maintenance_nuit_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0376_maintenance_nuit.sql =====
-- 0376_maintenance_nuit.sql : écritures automatiques de la nuit (chantier 1, branche ecrans/maintenance-nuit).
--
-- Avant : le tableau de bord, les Indicateurs et la page Factures écrivaient en base à leur ouverture, pour le
-- compte connecté (sessions passées « terminées », rappels du jour, alertes qualité, factures « dues » ou « en
-- retard »). Pour les comptes Lecture, Formateur ou Comptable externe, ces écritures étaient refusées par la base.
-- Après : une seule fonction de la base, public.daily_maintenance(), lancée chaque nuit par la tâche planifiée
-- (api/maintenance-nuit.js), fait ces écritures. Les pages ne les font plus.
--
-- Idempotente : relancée le même jour, elle ne refait rien. Dates à l'heure de Paris.
-- Exécution réservée à service_role (tâche planifiée) : ni anon ni authenticated.
-- Aucune nouvelle table. Retour arrière : supabase/rollback/0376_maintenance_nuit_retour.sql

create or replace function public.daily_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Europe/Paris')::date;
  v_dow int := extract(isodow from v_today)::int; -- 1 = lundi, 6 = samedi
  v_debut timestamptz := (v_today::timestamp at time zone 'Europe/Paris');
  v_sessions int := 0;
  v_notifs int := 0;
  v_alertes int := 0;
  v_retard int := 0;
  v_dues int := 0;
  v_cert int := 0;
  n record;
begin
  -- 1. Sessions passées : « terminée » le lendemain de la fin (sauf statut verrouillé)
  update public.sessions s
     set status = 'completed', updated_at = now()
   where s.status is distinct from 'completed'
     and coalesce(s.status_locked, false) = false
     and s.end_date is not null
     and s.end_date < v_today;
  get diagnostics v_sessions = row_count;

  -- 2. Rappels du jour (une notification par type et par jour)
  for n in
    select * from (values
      (v_dow = 1, 'veille', 'Veille réglementaire à réaliser', 'Rappel hebdomadaire', '/veille-qualiopi'),
      (v_dow = 6, 'materiel', 'Vérification matériel', 'Rappel hebdomadaire', '/parametres'),
      (extract(day from v_today) = 1 and extract(month from v_today) = 7, 'audit', 'Audit interne annuel',
       'Planifiez votre audit', '/qualiopi'),
      (extract(day from v_today) = 1 and extract(month from v_today) = 8, 'revue_direction', 'Revue de direction',
       'Revue annuelle à réaliser', '/qualiopi')
    ) as r(actif, type, title, message, link)
    where r.actif
  loop
    if not exists (select 1 from public.notifications where type = n.type and created_at >= v_debut) then
      insert into public.notifications (type, title, message, link) values (n.type, n.title, n.message, n.link);
      v_notifs := v_notifs + 1;
    end if;
  end loop;

  -- Échéances de certification (NDA, audits, BPF) : fonction existante, une fois par seuil
  if to_regprocedure('public.cert_daily_notifications()') is not null then
    v_cert := public.cert_daily_notifications();
  end if;

  -- 3. Alertes qualité : notes de 1 à 3 dans les évaluations à chaud, une alerte par stagiaire, session et critère
  insert into public.quality_alerts (session_id, trainee_id, criterion_key, criterion_label, score, status)
  select e.session_id, e.trainee_id, c.cle, c.libelle, c.note, 'pending'
  from public.trainee_evaluations e
  cross join lateral (values
    ('q_org_documents', 'Communication des documents', e.q_org_documents),
    ('q_org_accueil', 'Accueil sur le lieu', e.q_org_accueil),
    ('q_org_locaux', 'Qualité des locaux', e.q_org_locaux),
    ('q_org_materiel', 'Adéquation des moyens matériels', e.q_org_materiel),
    ('q_contenu_organisation', 'Organisation et déroulement', e.q_contenu_organisation),
    ('q_contenu_supports', 'Qualité des supports pédagogiques', e.q_contenu_supports),
    ('q_contenu_duree', 'Durée de la formation', e.q_contenu_duree),
    ('q_contenu_programme', 'Respect du programme', e.q_contenu_programme),
    ('q_formateur_pedagogie', 'Pédagogie du formateur', e.q_formateur_pedagogie),
    ('q_formateur_expertise', 'Expertise du formateur', e.q_formateur_expertise),
    ('q_formateur_progression', 'Progression de la formation', e.q_formateur_progression),
    ('q_formateur_moyens', 'Moyens mis à disposition', e.q_formateur_moyens),
    ('q_global_adequation', 'Adéquation formation/métier', e.q_global_adequation),
    ('q_global_competences', 'Amélioration des connaissances', e.q_global_competences)
  ) as c(cle, libelle, note)
  where e.session_id is not null and e.trainee_id is not null
    and c.note between 1 and 3
    and not exists (select 1 from public.quality_alerts a
                    where a.session_id = e.session_id and a.trainee_id = e.trainee_id and a.criterion_key = c.cle);
  get diagnostics v_alertes = row_count;

  -- 4. Factures envoyées : « en retard » après l'échéance, « due » avant (avoirs exclus ; une facture due
  --    aujourd'hui n'est pas en retard)
  update public.invoices
     set status = 'overdue', updated_at = now()
   where coalesce(type, 'invoice') <> 'credit_note'
     and status in ('sent', 'due')
     and due_date is not null and due_date < v_today;
  get diagnostics v_retard = row_count;

  update public.invoices
     set status = 'due', updated_at = now()
   where coalesce(type, 'invoice') <> 'credit_note'
     and status = 'sent'
     and (due_date is null or due_date >= v_today);
  get diagnostics v_dues = row_count;

  return jsonb_build_object('jour', v_today, 'sessions_terminees', v_sessions, 'rappels', v_notifs,
                            'echeances_certification', v_cert, 'alertes_qualite', v_alertes,
                            'factures_en_retard', v_retard, 'factures_dues', v_dues);
end
$$;

revoke all on function public.daily_maintenance() from public, anon, authenticated;
grant execute on function public.daily_maintenance() to service_role;

insert into public.schema_migrations (version) values ('0376_maintenance_nuit') on conflict (version) do nothing;
