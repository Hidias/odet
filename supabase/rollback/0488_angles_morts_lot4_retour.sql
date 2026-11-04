-- Retour arrière de 0488 : complétude et rappel du matin remis comme avant, déclencheur et fonctions retirés.
-- Les rappels déjà clos par un appel restent clos (une note datée le dit sur chacun).
drop trigger if exists zz_rappels_clore_appel_suivant on public.prospect_calls;
drop function if exists app.rappels_clore_appel_suivant();

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
declare v_def text; v_n int;
begin
  select pg_get_functiondef('public.detect_completude_blockers()'::regprocedure) into v_def;
  if position('app.convention_etat' in v_def) = 0 then return; end if;
  v_n := (length(v_def) - length(replace(v_def, E'AND app.convention_etat(s.id) = \'a_envoyer\'', ''))) / length(E'AND app.convention_etat(s.id) = \'a_envoyer\'');
  if v_n <> 1 then raise exception 'detect_completude_blockers : % occurrence(s) de %', v_n, E'AND app.convention_etat(s.id) = \'a_envoyer\''; end if;
  v_def := replace(v_def, E'AND app.convention_etat(s.id) = \'a_envoyer\'', E'AND (s.convention_sent = false OR s.convention_sent IS NULL)');
  v_n := (length(v_def) - length(replace(v_def, E'AND app.convention_etat(s.id) = \'envoyee\'', ''))) / length(E'AND app.convention_etat(s.id) = \'envoyee\'');
  if v_n <> 1 then raise exception 'detect_completude_blockers : % occurrence(s) de %', v_n, E'AND app.convention_etat(s.id) = \'envoyee\''; end if;
  v_def := replace(v_def, E'AND app.convention_etat(s.id) = \'envoyee\'', E'AND s.convention_sent = true\n    AND (s.convention_signed = false OR s.convention_signed IS NULL)');
  v_n := (length(v_def) - length(replace(v_def, E'WHERE s.id = ca.entity_id \n        AND app.convention_etat(s.id) <> \'a_envoyer\'\n    );', ''))) / length(E'WHERE s.id = ca.entity_id \n        AND app.convention_etat(s.id) <> \'a_envoyer\'\n    );');
  if v_n <> 1 then raise exception 'detect_completude_blockers : % occurrence(s) de %', v_n, E'WHERE s.id = ca.entity_id \n        AND app.convention_etat(s.id) <> \'a_envoyer\'\n    );'; end if;
  v_def := replace(v_def, E'WHERE s.id = ca.entity_id \n        AND app.convention_etat(s.id) <> \'a_envoyer\'\n    );', E'WHERE s.id = ca.entity_id \n        AND s.convention_sent = true\n    );');
  v_n := (length(v_def) - length(replace(v_def, E'WHERE s.id = ca.entity_id \n        AND app.convention_etat(s.id) in (\'signee\', \'sans_objet\')\n    );', ''))) / length(E'WHERE s.id = ca.entity_id \n        AND app.convention_etat(s.id) in (\'signee\', \'sans_objet\')\n    );');
  if v_n <> 1 then raise exception 'detect_completude_blockers : % occurrence(s) de %', v_n, E'WHERE s.id = ca.entity_id \n        AND app.convention_etat(s.id) in (\'signee\', \'sans_objet\')\n    );'; end if;
  v_def := replace(v_def, E'WHERE s.id = ca.entity_id \n        AND app.convention_etat(s.id) in (\'signee\', \'sans_objet\')\n    );', E'WHERE s.id = ca.entity_id \n        AND s.convention_signed = true\n    );');
  execute v_def;
end $$;

drop function if exists app.devis_a_relancer(public.quotes, date);
drop function if exists app.convention_etat(uuid);
delete from public.schema_migrations where version = '0488_angles_morts_lot4';
