-- 0465 : contrats de maintenance, lot 5 : types d'intervention, dépannage d'urgence, facture à préparer à la clôture.
--
-- 1. Les natures posées en 0463 (vérification, inventaire, dépannage, installation, livraison, mise en service, exercice
--    d'évacuation) servent à toutes les interventions. Seule une vérification pose « dernière » et « prochaine
--    vérification » à la clôture (0464 l'avait fait pour l'inventaire, ici pour toutes les autres natures).
-- 2. Dépannage d'urgence : délai promis au contrat (itv_contracts.emergency_hours, en heures, vide = aucun). Sur
--    l'intervention : urgent, demandé le (requested_at), à faire avant (deadline_at, calculé depuis le contrat et
--    modifiable). Le respect se lit sur l'heure d'arrivée (started_at) : public.contrat_urgences(contrat).
-- 3. Clôture d'une intervention : si quelque chose reste à facturer (hors contrat, nature autre que vérification sous
--    échéancier, ou pièce non comprise au contrat), un rappel « facture à préparer » arrive dans Relances à valider,
--    avec le lien vers l'intervention. Le technicien ne crée pas la facture ; le bureau la prépare en un clic.
--
-- Retour arrière (manuel) : en fin de fichier.

alter table public.itv_contracts add column if not exists emergency_hours integer check (emergency_hours is null or emergency_hours between 1 and 720);
comment on column public.itv_contracts.emergency_hours is '0465 : délai promis pour un dépannage urgent, en heures après la demande (vide : aucun engagement).';

alter table public.itv_visits add column if not exists urgent boolean not null default false;
alter table public.itv_visits add column if not exists requested_at timestamptz;
alter table public.itv_visits add column if not exists deadline_at timestamptz;
comment on column public.itv_visits.urgent is '0465 : dépannage urgent, soumis au délai promis du contrat.';
comment on column public.itv_visits.requested_at is '0465 : heure de la demande du client.';
comment on column public.itv_visits.deadline_at is '0465 : arrivée promise au plus tard (demande + délai du contrat), modifiable.';

-- ── Délai promis posé à la création (ou quand l'urgence est cochée) ──
create or replace function app.itv_visite_delai()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_h int;
begin
  if not new.urgent then return new; end if;
  if new.requested_at is null then new.requested_at := now(); end if;
  if new.deadline_at is null and (tg_op = 'INSERT' or not old.urgent or old.requested_at is distinct from new.requested_at) then
    select k.emergency_hours into v_h from public.itv_contracts k where k.id = new.contract_id;
    if v_h is null then
      select k.emergency_hours into v_h from public.itv_contracts k
      where k.client_id = new.client_id and k.status = 'actif' and k.emergency_hours is not null
        and (k.site_ids is null or cardinality(k.site_ids) = 0 or new.site_id = any(k.site_ids))
      order by k.created_at limit 1;
    end if;
    if v_h is not null then new.deadline_at := new.requested_at + make_interval(hours => v_h); end if;
  end if;
  return new;
end
$$;
revoke all on function app.itv_visite_delai() from public, anon, authenticated;
drop trigger if exists itv_visits_delai on public.itv_visits;
create trigger itv_visits_delai before insert or update of urgent, requested_at, deadline_at, contract_id on public.itv_visits
  for each row execute function app.itv_visite_delai();

-- ── Suivi du délai promis par contrat (12 derniers mois) ──
create or replace function public.contrat_urgences(p_contract uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare k public.itv_contracts;
begin
  perform app.require_right('interventions.contrats.voir');
  perform app.exiger_societe('itv_contracts', p_contract, false);
  select * into k from public.itv_contracts where id = p_contract;
  return (
    select jsonb_build_object(
      'delai_h', k.emergency_hours,
      'urgences', count(*),
      'respectees', count(*) filter (where v.started_at is not null and v.deadline_at is not null and v.started_at <= v.deadline_at),
      'en_retard', count(*) filter (where v.deadline_at is not null and coalesce(v.started_at, now()) > v.deadline_at),
      'en_attente', count(*) filter (where v.started_at is null and v.status <> 'annulee' and (v.deadline_at is null or v.deadline_at >= now())))
    from public.itv_visits v
    where v.urgent and v.status <> 'annulee' and v.requested_at > now() - interval '12 months'
      and (v.contract_id = k.id or (v.contract_id is null and v.client_id = k.client_id
        and (k.site_ids is null or cardinality(k.site_ids) = 0 or v.site_id = any(k.site_ids)))));
end
$$;
revoke all on function public.contrat_urgences(uuid) from public, anon;
grant execute on function public.contrat_urgences(uuid) to authenticated;

-- ── Clôture : seules les vérifications posent les dates (corps de 0464, condition élargie) ──
CREATE OR REPLACE FUNCTION public.itv_close_visit(p_visit uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v public.itv_visits%rowtype; v_day date; n_ok int; n_ko int; n_rp int; n_other int;
begin
  /* société (C2) */ perform app.exiger_societe('itv_visits', p_visit, true);
  /* garde chantier 2 */ if app.role() = 'technicien' and p_visit not in (select app.tech_visit_ids()) then raise exception 'Accès refusé' using errcode = '42501'; end if;

  if not public.itv_can_write() then raise exception 'Accès refusé' using errcode = '42501'; end if;
  select * into v from public.itv_visits where id = p_visit for update;
  if not found then raise exception 'Visite introuvable'; end if;
  v_day := coalesce((v.started_at at time zone 'Europe/Paris')::date, v.planned_on, current_date);

  update public.itv_equipment e set
    last_check_on = case when v.kind <> 'verification' then e.last_check_on else v_day end,
    next_check_on = case when v.kind <> 'verification' then e.next_check_on else (v_day + make_interval(months => t.verification_months))::date end,
    status = case when i.result = 'a_remplacer' then 'a_remplacer' else 'en_service' end,
    manufactured_year = case when i.result = 'remplace' then extract(year from v_day)::int else e.manufactured_year end,
    updated_at = now()
  from public.itv_visit_items i, public.itv_equipment_types t
  where i.visit_id = p_visit and i.equipment_id = e.id and t.id = e.type_id
    and i.result in ('conforme', 'remplace', 'a_remplacer');

  update public.itv_visits set status = 'terminee', finished_at = coalesce(finished_at, now()) where id = p_visit;

  select count(*) filter (where result = 'conforme'), count(*) filter (where result = 'a_remplacer'),
         count(*) filter (where result = 'remplace'), count(*) filter (where result in ('absent', 'inaccessible'))
    into n_ok, n_ko, n_rp, n_other
  from public.itv_visit_items where visit_id = p_visit;
  return jsonb_build_object('conforme', n_ok, 'a_remplacer', n_ko, 'remplace', n_rp, 'autre', n_other);
end $function$;

-- ── Facture à préparer à la clôture ──
create or replace function app.itv_visite_a_facturer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.itv_contracts;
  v_couvert boolean;
  v_nature text;
begin
  if not (new.status = 'terminee' and old.status is distinct from 'terminee') or new.invoice_id is not null then return new; end if;
  select * into k from public.itv_contracts where id = new.contract_id;
  -- Couvert : vérification d'un contrat facturé par échéancier, sans pièce hors contrat
  v_couvert := k.id is not null and new.kind = 'verification' and k.billing_period in ('mensuel', 'trimestriel', 'annuel')
    and not exists (
      select 1 from public.itv_visit_parts p left join public.itv_parts c on c.id = p.part_id
      where p.visit_id = new.id
        and coalesce((k.includes ->> case coalesce(c.category, 'piece') when 'recharge' then 'recharges' when 'deplacement' then 'deplacement' else 'pieces' end)::boolean, false) = false);
  if v_couvert then return new; end if;
  v_nature := case new.kind when 'inventaire' then 'Inventaire' when 'depannage' then 'Dépannage' when 'installation' then 'Installation'
    when 'livraison' then 'Livraison' when 'mise_en_service' then 'Mise en service' when 'exercice_evacuation' then 'Exercice d''évacuation' else 'Visite' end;
  insert into public.scheduled_actions (company_id, kind, target_table, target_id, client_id, due_on, title, payload, dedup_key)
  select new.company_id, 'rappel', 'itv_visits', new.id, new.client_id, current_date,
         v_nature || ' terminé' || case when new.kind in ('verification', 'livraison', 'installation', 'mise_en_service') then 'e' else '' end
           || ' chez ' || c.name || ' : facture à préparer',
         jsonb_build_object('interne', true, 'lien', '/interventions/visite/' || new.id,
           'texte', 'L''intervention ' || coalesce(new.reference, '') || ' est terminée. Ouvrez-la et appuyez sur « Préparer la facture » : '
             || 'le brouillon reprend le forfait, les pièces sorties et ce que le contrat comprend. Rien n''est émis sans vous.'),
         'visite_facture:' || new.id
  from public.clients c where c.id = new.client_id
  on conflict (company_id, dedup_key) do nothing;
  return new;
end
$$;
revoke all on function app.itv_visite_a_facturer() from public, anon, authenticated;
drop trigger if exists itv_visits_a_facturer on public.itv_visits;
create trigger itv_visits_a_facturer after update of status on public.itv_visits
  for each row execute function app.itv_visite_a_facturer();

-- Retour arrière (manuel) :
-- drop trigger if exists itv_visits_a_facturer on public.itv_visits; drop function if exists app.itv_visite_a_facturer();
-- réappliquer itv_close_visit de 0464 ; drop function if exists public.contrat_urgences(uuid);
-- drop trigger if exists itv_visits_delai on public.itv_visits; drop function if exists app.itv_visite_delai();
-- alter table public.itv_visits drop column if exists deadline_at, drop column if exists requested_at, drop column if exists urgent;
-- alter table public.itv_contracts drop column if exists emergency_hours;
