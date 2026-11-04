-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (angles_morts_0488) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0488_angles_morts_lot4.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0488_angles_morts_lot4_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0488_angles_morts_lot4.sql =====
-- 0488 : angles morts, lot 4 (revue du 04/11, A3 à A6 et A10) et complétude alignée sur l'état de la convention.
--  1. app.convention_etat(session) : état de la convention lu comme à l'écran (src/modules/formation/lib/etatConvention.js,
--     écrit à l'identique) : sous-traitance sans objet ; signée vaut envoyée ; inter calculée depuis ses groupes non
--     annulés, la signature ou l'envoi au niveau de la session primant. detect_completude_blockers (alertes
--     « Convention non envoyée » et « Convention non signée », et leur levée) l'utilise désormais. Point d'attention :
--     cette fonction n'est appelée par aucune tâche ni aucun écran en production (relevé le 04/11).
--  2. app.devis_a_relancer(devis, jour) : devis à relancer, même règle que le Suivi commercial (devisARelancer et
--     quoteNextDue dans suiviUtils.js, écrits à l'identique) : devis envoyé ou partiel non perdu, hors veille, échéance
--     de la cadence atteinte (J+7, J+21 ou 7 jours après la relance, puis tous les 30 jours ; date fixée à la main ou
--     date de réveil en priorité). Le rappel du matin (0416) l'utilise : les relances par mail et la veille comptent.
--  3. Un appel enregistré (pas un rappel planifié) clôt les rappels encore en attente du même client et de la même
--     société, notés plus tôt : le rappel n'apparaît plus « à faire » après qu'on a rappelé (A10). Une note datée dit
--     pourquoi le rappel est clos ; le nouvel appel porte lui-même son éventuel prochain rappel.
-- Rien ne part par e-mail. Aucune donnée réelle supprimée. Idempotente. Retour arrière :
-- supabase/rollback/0488_angles_morts_lot4_retour.sql

-- ── 1. État de la convention ──
create or replace function app.convention_etat(p_session uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with s as (
    select se.id, se.session_type, coalesce(se.convention_sent, false) as envoyee, coalesce(se.convention_signed, false) as signee
    from public.sessions se where se.id = p_session
  ), g as (
    select count(*) as n,
           count(*) filter (where gr.doc_status = 'signe') as n_signes,
           count(*) filter (where gr.doc_status in ('signe', 'envoye')) as n_envoyes
    from public.session_groups gr
    where gr.session_id = p_session and coalesce(gr.status, '') <> 'cancelled'
  )
  select case
    when s.id is null then 'a_envoyer'
    when s.session_type = 'subcontract' then 'sans_objet'
    when s.signee then 'signee'
    when s.session_type = 'inter' and g.n > 0 then
      case when s.envoyee and g.n_signes < g.n then 'envoyee'
           when g.n_signes = g.n then 'signee'
           when g.n_envoyes = g.n then 'envoyee'
           else 'a_envoyer' end
    when s.envoyee then 'envoyee'
    else 'a_envoyer'
  end
  from g left join s on true
$$;
revoke all on function app.convention_etat(uuid) from public, anon, authenticated;
comment on function app.convention_etat(uuid) is 'État de la convention d''une session (a_envoyer, envoyee, signee, sans_objet), comme etatConvention.js (0488)';

do $$
declare v_def text; v_n int;
begin
  select pg_get_functiondef('public.detect_completude_blockers()'::regprocedure) into v_def;
  if position('app.convention_etat' in v_def) > 0 then return; end if;
  v_n := (length(v_def) - length(replace(v_def, E'AND (s.convention_sent = false OR s.convention_sent IS NULL)', ''))) / length(E'AND (s.convention_sent = false OR s.convention_sent IS NULL)');
  if v_n <> 1 then raise exception 'detect_completude_blockers : % occurrence(s) de %', v_n, E'AND (s.convention_sent = false OR s.convention_sent IS NULL)'; end if;
  v_def := replace(v_def, E'AND (s.convention_sent = false OR s.convention_sent IS NULL)', E'AND app.convention_etat(s.id) = \'a_envoyer\'');
  v_n := (length(v_def) - length(replace(v_def, E'AND s.convention_sent = true\n    AND (s.convention_signed = false OR s.convention_signed IS NULL)', ''))) / length(E'AND s.convention_sent = true\n    AND (s.convention_signed = false OR s.convention_signed IS NULL)');
  if v_n <> 1 then raise exception 'detect_completude_blockers : % occurrence(s) de %', v_n, E'AND s.convention_sent = true\n    AND (s.convention_signed = false OR s.convention_signed IS NULL)'; end if;
  v_def := replace(v_def, E'AND s.convention_sent = true\n    AND (s.convention_signed = false OR s.convention_signed IS NULL)', E'AND app.convention_etat(s.id) = \'envoyee\'');
  v_n := (length(v_def) - length(replace(v_def, E'WHERE s.id = ca.entity_id \n        AND s.convention_sent = true\n    );', ''))) / length(E'WHERE s.id = ca.entity_id \n        AND s.convention_sent = true\n    );');
  if v_n <> 1 then raise exception 'detect_completude_blockers : % occurrence(s) de %', v_n, E'WHERE s.id = ca.entity_id \n        AND s.convention_sent = true\n    );'; end if;
  v_def := replace(v_def, E'WHERE s.id = ca.entity_id \n        AND s.convention_sent = true\n    );', E'WHERE s.id = ca.entity_id \n        AND app.convention_etat(s.id) <> \'a_envoyer\'\n    );');
  v_n := (length(v_def) - length(replace(v_def, E'WHERE s.id = ca.entity_id \n        AND s.convention_signed = true\n    );', ''))) / length(E'WHERE s.id = ca.entity_id \n        AND s.convention_signed = true\n    );');
  if v_n <> 1 then raise exception 'detect_completude_blockers : % occurrence(s) de %', v_n, E'WHERE s.id = ca.entity_id \n        AND s.convention_signed = true\n    );'; end if;
  v_def := replace(v_def, E'WHERE s.id = ca.entity_id \n        AND s.convention_signed = true\n    );', E'WHERE s.id = ca.entity_id \n        AND app.convention_etat(s.id) in (\'signee\', \'sans_objet\')\n    );');
  execute v_def;
end $$;

-- ── 2. Devis à relancer ──
create or replace function app.devis_a_relancer(q public.quotes, p_jour date)
returns boolean
language sql
stable
set search_path = ''
as $$
  with b as (
    select coalesce(q.quote_date, (q.created_at at time zone 'UTC')::date, p_jour) as base, coalesce(q.relance_count, 0) as n
  ), d as (
    select case
      when q.followup_state = 'veille' and q.veille_until is not null then q.veille_until
      when q.next_followup_date is not null then q.next_followup_date
      when b.n = 0 then b.base + 7
      when b.n = 1 then greatest(b.base + 21, q.last_relance_date + 7)
      else coalesce(q.last_relance_date, b.base) + 30
    end as due
    from b
  )
  select (q.status = 'sent' or (q.status = 'partial' and q.lost_reason is null))
     and not (q.followup_state = 'veille' and q.veille_until is not null and q.veille_until > p_jour)
     and coalesce(d.due <= p_jour, false)
  from d
$$;
revoke all on function app.devis_a_relancer(public.quotes, date) from public, anon, authenticated;
comment on function app.devis_a_relancer(public.quotes, date) is 'Devis à relancer à cette date, même règle que devisARelancer (suiviUtils.js) (0488)';

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
    select count(*) into n_dev from public.quotes q where q.company_id = c.id and q.status in ('sent', 'partial') and app.devis_a_relancer(q, v_jour);
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

-- ── 3. Un appel clôt les rappels en attente du même client ──
create or replace function app.rappels_clore_appel_suivant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.is_planned, false) or new.client_id is null then return null; end if;
  update public.prospect_calls p
     set needs_callback = false,
         notes = concat_ws(E'\n', nullif(p.notes, ''),
                           'Rappel clos par l''appel du ' || to_char(new.called_at at time zone 'Europe/Paris', 'DD/MM/YYYY')),
         updated_at = now()
   where p.client_id = new.client_id
     and p.company_id is not distinct from new.company_id
     and p.id <> new.id
     and p.needs_callback
     and p.called_at <= new.called_at;
  return null;
end
$$;
revoke all on function app.rappels_clore_appel_suivant() from public, anon, authenticated;

drop trigger if exists zz_rappels_clore_appel_suivant on public.prospect_calls;
create trigger zz_rappels_clore_appel_suivant after insert on public.prospect_calls
  for each row execute function app.rappels_clore_appel_suivant();

insert into public.schema_migrations (version) values ('0488_angles_morts_lot4') on conflict (version) do nothing;
