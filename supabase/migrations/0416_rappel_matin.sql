-- 0416 : rappel du matin (suggestion validée par H le 21/10 : « relances automatiques vers H »). Chaque jour vers
-- 7 h 45 (heure de Paris), une notification par société résume ce qu'il y a à faire, comme « Ma journée » sur le
-- tableau de bord : sessions et visites du jour, relances à valider, actions de l'équipe, affaires et devis à
-- relancer, factures en retard. Elle arrive aussi sur les téléphones où les alertes sont actives (0411), juste après
-- les heures calmes. Rien quand il n'y a rien à faire. Aucun email.
--   1. app.rappel_matin() : prépare la notification du jour, une seule fois par société et par jour.
--   2. Tâche planifiée de la base odet_rappel_matin (5 h 45 et 6 h 45 UTC : la fonction ne fait rien hors de 7 h à
--      Paris, ce qui couvre l'heure d'été et l'heure d'hiver).
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0416_rappel_matin_retour.sql

create or replace function app.rappel_matin(p_force boolean default false)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_maintenant timestamp := now() at time zone 'Europe/Paris';
  v_jour date := v_maintenant::date;
  c record;
  n_ses int; n_vis int; n_rel int; n_act int; n_aff int; n_dev int; n_fac int;
  v_lignes text[];
  v_faits int := 0;
begin
  if not p_force and extract(hour from v_maintenant) <> 7 then return 0; end if;
  for c in select co.id from public.companies co where coalesce(co.status, 'active') = 'active' loop
    if exists (select 1 from public.notifications n where n.type = 'rappel_matin' and n.company_id = c.id
               and n.metadata->>'jour' = v_jour::text) then
      continue;
    end if;
    select count(*) into n_ses from public.sessions s
     where s.company_id = c.id and s.start_date <= v_jour and coalesce(s.end_date, s.start_date) >= v_jour
       and coalesce(s.status, '') not in ('cancelled', 'annulee');
    n_vis := 0;
    if to_regclass('public.itv_visits') is not null then
      execute 'select count(*) from public.itv_visits v where v.company_id = $1 and v.planned_on = $2
               and coalesce(v.status, '''') not in (''terminee'', ''annulee'')' into n_vis using c.id, v_jour;
    end if;
    select count(*) into n_rel from public.scheduled_actions a where a.company_id = c.id and a.status = 'a_valider';
    select count(*) into n_act from public.team_actions t where t.company_id = c.id and t.status = 'a_faire' and t.due_on <= v_jour;
    select count(*) into n_aff from public.opportunities o
     where o.company_id = c.id and o.stage not in ('gagnee', 'perdue') and o.next_action_on <= v_jour;
    select count(*) into n_dev from public.quotes q where q.company_id = c.id and q.status = 'sent' and q.next_followup_date <= v_jour;
    select count(*) into n_fac from public.invoices i
     where i.company_id = c.id and i.type = 'invoice' and i.issued_at is not null and i.due_date < v_jour and i.amount_due > 0;
    v_lignes := array_remove(array[
      case when n_ses > 0 then format('%s session%s aujourd''hui', n_ses, case when n_ses > 1 then 's' else '' end) end,
      case when n_vis > 0 then format('%s visite%s prévue%s', n_vis, case when n_vis > 1 then 's' else '' end, case when n_vis > 1 then 's' else '' end) end,
      case when n_rel > 0 then format('%s relance%s à valider', n_rel, case when n_rel > 1 then 's' else '' end) end,
      case when n_act > 0 then format('%s action%s de l''équipe à faire', n_act, case when n_act > 1 then 's' else '' end) end,
      case when n_aff > 0 then format('%s affaire%s à relancer', n_aff, case when n_aff > 1 then 's' else '' end) end,
      case when n_dev > 0 then format('%s devis à relancer', n_dev) end,
      case when n_fac > 0 then format('%s facture%s en retard de paiement', n_fac, case when n_fac > 1 then 's' else '' end) end
    ], null);
    if coalesce(array_length(v_lignes, 1), 0) = 0 then continue; end if;
    insert into public.notifications (type, title, message, link, company_id, metadata)
    values ('rappel_matin', 'Votre journée', array_to_string(v_lignes, ', ') || '.', '/', c.id,
            jsonb_build_object('jour', v_jour, 'sessions', n_ses, 'visites', n_vis, 'relances', n_rel, 'actions', n_act,
                               'affaires', n_aff, 'devis', n_dev, 'factures', n_fac));
    v_faits := v_faits + 1;
  end loop;
  return v_faits;
end
$$;
revoke all on function app.rappel_matin(boolean) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'odet_rappel_matin';
    perform cron.schedule('odet_rappel_matin', '45 5,6 * * *', 'select app.rappel_matin()');
  end if;
end $$;

insert into public.schema_migrations (version) values ('0416_rappel_matin') on conflict (version) do nothing;
