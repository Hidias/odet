-- 0375_droits_validations.sql : circuit de validation commun (chantier C1b, décisions du 17/10).
--
-- Un seul circuit pour factures, commandes d'achat, absences, heures, frais et devis (tables de 0370) :
--   * approval_rules : réglage par société et par périmètre (validations.circuits.configurer) :
--       mode none (aucune validation), always (tout est validé, même 1 centime), threshold (au-delà d'un montant) ;
--       droit du valideur (ex. stock.commandes.valider) et étapes en plus (cumul de fonctions : liste de droits) ;
--       factures : une règle par client possible (circuit choisi par client) ; sinon la règle de la société ;
--     sans règle : réglage par défaut ci-dessous (le plus prudent : tout est validé), sauf les devis (aucune) ;
--   * approval_requests : une demande par objet en attente ; écrite seulement par ces fonctions ;
--   * approval_delegations : une personne valide pour une autre pendant une période (validations.deleguer).
-- Personne ne valide sa propre demande ; un refus demande un motif ; chaque décision est écrite au journal d'audit
-- (sans montant ni contenu de l'objet). Les modules (Facturation fiable, RH, Stock, frais, Manager) appellent
-- approval_submit à leur étape « à valider » : aucun module n'y est branché par C1b.
-- Migration idempotente. Retour arrière : supabase/rollback/0370-0375_droits_retour.sql

-- Réglage qui s'applique (règle du client, sinon de la société, sinon défaut du produit)
create or replace function app.approval_rule_for(p_company uuid, p_scope text, p_client uuid)
returns table (mode text, threshold numeric, validator_right text, extra_steps jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select r.mode, r.threshold, r.validator_right, r.extra_steps
  from (
    select r.mode, r.threshold, r.validator_right, r.extra_steps, 1 as rang
    from public.approval_rules r
    where r.company_id = p_company and r.scope = p_scope and r.is_active and p_client is not null and r.client_id = p_client
    union all
    select r.mode, r.threshold, r.validator_right, r.extra_steps, 2
    from public.approval_rules r
    where r.company_id = p_company and r.scope = p_scope and r.is_active and r.client_id is null
    union all
    select d.mode, null::numeric, d.validator_right, '[]'::jsonb, 3
    from (values ('invoice', 'always', 'facturation.factures.valider'),
                 ('purchase_order', 'always', 'stock.commandes.valider'),
                 ('absence', 'always', 'rh.absences.valider'),
                 ('timesheet', 'always', 'rh.heures.valider'),
                 ('expense', 'always', 'frais.notes.valider'),
                 ('quote', 'none', 'commercial.devis.modifier')) d(scope, mode, validator_right)
    where d.scope = p_scope
  ) r
  order by r.rang
  limit 1
$$;

-- Faut-il une validation ? (pour l'écran : avant d'envoyer, afficher « sera validé par… »)
create or replace function public.approval_required(p_scope text, p_amount numeric default null, p_client uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company uuid := app.current_company();
  r record;
begin
  if app.role() is null or v_company is null then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  select * into r from app.approval_rule_for(v_company, p_scope, p_client);
  if r.mode is null then
    raise exception 'Périmètre inconnu : %', p_scope using errcode = '22023';
  end if;
  return jsonb_build_object(
    'required', r.mode = 'always' or (r.mode = 'threshold' and coalesce(p_amount, 0) > r.threshold),
    'mode', r.mode, 'threshold', r.threshold,
    'steps', jsonb_build_array(r.validator_right) || coalesce(r.extra_steps, '[]'::jsonb));
end
$$;

-- Dépôt d'une demande ; renvoie l'identifiant, ou null si aucune validation n'est requise
create or replace function public.approval_submit(p_scope text, p_object_table text, p_object_id uuid,
                                                  p_amount numeric default null, p_client uuid default null,
                                                  p_label text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := app.current_company();
  v_need jsonb;
  v_id uuid;
begin
  if app.role() is null or v_company is null then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if p_object_table !~ '^[a-z_][a-z0-9_]{0,62}$' or to_regclass('public.' || p_object_table) is null then
    raise exception 'Objet inconnu' using errcode = '22023';
  end if;
  v_need := public.approval_required(p_scope, p_amount, p_client);
  if not (v_need ->> 'required')::boolean then
    return null;
  end if;
  insert into public.approval_requests (company_id, scope, object_table, object_id, client_id, amount, label,
                                        requested_by, steps, history)
  values (v_company, p_scope, p_object_table, p_object_id, p_client, p_amount, left(p_label, 200),
          (select auth.uid()), v_need -> 'steps',
          jsonb_build_array(jsonb_build_object('at', now(), 'by', (select auth.uid()), 'action', 'submitted')))
  returning id into v_id;
  return v_id;
end
$$;

-- Décision : approved (étape suivante, ou demande validée à la dernière étape) ou rejected (motif obligatoire)
create or replace function public.approval_decide(p_request uuid, p_decision text, p_comment text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.approval_requests;
  v_right text;
  v_as uuid;
  v_status text;
begin
  select * into r from public.approval_requests where id = p_request for update;
  if r.id is null then
    raise exception 'Demande introuvable' using errcode = '22023';
  end if;
  v_right := r.steps ->> r.current_step;
  if not app.approval_can_decide(r.company_id, r.scope, v_right, r.requested_by, r.status) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Décision inconnue : %', p_decision using errcode = '22023';
  end if;
  if p_decision = 'rejected' and char_length(btrim(coalesce(p_comment, ''))) < 3 then
    raise exception 'Un refus demande un motif' using errcode = '22023';
  end if;
  -- Décision au nom d'une autre personne (délégation) : notée
  if not app.a_le_droit_dans(r.company_id, v_right) then
    select d.from_profile into v_as from public.approval_delegations d
    where d.company_id = r.company_id and d.to_profile = (select auth.uid()) and d.revoked_at is null
      and now() >= d.starts_at and now() < d.ends_at and (d.scope is null or d.scope = r.scope)
      and v_right = any (app.rights_for(d.from_profile, r.company_id))
    order by d.created_at limit 1;
  end if;
  v_status := case when p_decision = 'rejected' then 'rejected'
                   when r.current_step + 1 >= jsonb_array_length(r.steps) then 'approved'
                   else 'pending' end;
  update public.approval_requests set
    status = v_status,
    current_step = case when v_status = 'pending' then r.current_step + 1 else r.current_step end,
    history = r.history || jsonb_build_array(jsonb_build_object('at', now(), 'by', (select auth.uid()), 'as', v_as,
                                                                'action', p_decision, 'step', r.current_step,
                                                                'comment', left(p_comment, 500))),
    decided_by = case when v_status <> 'pending' then (select auth.uid()) end,
    decided_at = case when v_status <> 'pending' then now() end,
    decision_comment = case when v_status <> 'pending' then left(p_comment, 500) end,
    updated_at = now()
  where id = r.id;
  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_id, entity_name, details)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'update', 'system', r.id, 'Validation : ' || p_decision,
          jsonb_build_object('company_id', r.company_id, 'scope', r.scope, 'object_table', r.object_table,
                             'step', r.current_step, 'on_behalf_of', v_as, 'status', v_status));
  return v_status;
end
$$;

-- Retrait d'une demande par son auteur, tant qu'elle est en attente
create or replace function public.approval_cancel(p_request uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.approval_requests set status = 'cancelled', updated_at = now(),
         history = history || jsonb_build_array(jsonb_build_object('at', now(), 'by', (select auth.uid()), 'action', 'cancelled'))
  where id = p_request and status = 'pending' and requested_by = (select auth.uid());
  if not found then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
end
$$;

-- Délégation de ses validations à une autre personne de la société courante
create or replace function public.approval_delegate(p_to uuid, p_ends_at timestamptz, p_reason text,
                                                    p_scope text default null, p_starts_at timestamptz default now())
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := app.current_company();
  v_id uuid;
begin
  if v_company is null or not app.a_le_droit('validations.deleguer') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if not exists (select 1 from public.company_members m join public.profiles p on p.id = m.profile_id
                 where m.company_id = v_company and m.profile_id = p_to and m.is_active and p.is_active) then
    raise exception 'La personne choisie n''appartient pas à la société' using errcode = '22023';
  end if;
  insert into public.approval_delegations (company_id, from_profile, to_profile, scope, starts_at, ends_at, reason, created_by)
  values (v_company, (select auth.uid()), p_to, p_scope, coalesce(p_starts_at, now()), p_ends_at, btrim(p_reason),
          (select auth.uid()))
  returning id into v_id;
  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_id, entity_name, details)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'create', 'system', v_id, 'Délégation de validation',
          jsonb_build_object('company_id', v_company, 'to', p_to, 'scope', p_scope, 'until', p_ends_at));
  return v_id;
end
$$;

-- Fin d'une délégation (par celui qui l'a donnée, ou par le centre de validations)
create or replace function public.approval_delegation_revoke(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.approval_delegations d set revoked_at = now(), revoked_by = (select auth.uid())
  where d.id = p_id and d.revoked_at is null
    and (d.from_profile = (select auth.uid()) or app.a_le_droit_dans(d.company_id, 'manager.validations.voir'));
  if not found then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
end
$$;

revoke all on function app.approval_rule_for(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.approval_required(text, numeric, uuid), public.approval_submit(text, text, uuid, numeric, uuid, text),
  public.approval_decide(uuid, text, text), public.approval_cancel(uuid),
  public.approval_delegate(uuid, timestamptz, text, text, timestamptz), public.approval_delegation_revoke(uuid)
  from public, anon;
grant execute on function public.approval_required(text, numeric, uuid), public.approval_submit(text, text, uuid, numeric, uuid, text),
  public.approval_decide(uuid, text, text), public.approval_cancel(uuid),
  public.approval_delegate(uuid, timestamptz, text, text, timestamptz), public.approval_delegation_revoke(uuid)
  to authenticated, service_role;

insert into public.schema_migrations (version) values ('0375_droits_validations') on conflict (version) do nothing;
