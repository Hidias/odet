-- 0462 : contrats de maintenance, lot 3 (décision de H du 27/10/2026, § 1.4) : révision annuelle du prix selon l'indice
-- inscrit au contrat, P = P0 × I / I0.
--   1. Indice du contrat : intitulé et identifiant de série (INSEE) saisis par l'entreprise, valeur et mois de
--      référence (I0). Aucun indice ni valeur par défaut : rien n'est inventé. Intitulé vérifié sur insee.fr le
--      29/10/2026 pour aide à la saisie : « Indice du coût horaire du travail révisé - Tous salariés (ICHTrev-TS) »,
--      publié chaque trimestre, base 100 en décembre 2008 ; la série exacte (activité) reste à choisir par l'entreprise.
--   2. 30 jours avant chaque date anniversaire : révision préparée, signalée dans « Relances à valider ». La direction
--      saisit la nouvelle valeur (I), l'outil calcule le nouveau prix, elle valide (ou écarte). Le prix validé
--      s'applique aux échéances non facturées à partir de l'anniversaire ; le courrier au client est préparé par l'écran.
--   3. Contrat signé : seule une révision validée change son prix (le reste passe par un avenant).
-- Migration additive, rejouable. Retour arrière en fin de fichier.

alter table public.itv_contracts add column if not exists index_label text;
alter table public.itv_contracts add column if not exists index_series text;
alter table public.itv_contracts add column if not exists index_base_value numeric(12,4);
alter table public.itv_contracts add column if not exists index_base_month date;
alter table public.itv_contracts add column if not exists base_price_ht numeric(12,2);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'itv_contracts_indice_chk') then
    alter table public.itv_contracts add constraint itv_contracts_indice_chk check (
      (index_label is null or length(index_label) <= 200) and (index_series is null or length(index_series) <= 40)
      and (index_base_value is null or index_base_value > 0));
  end if;
end $$;
comment on column public.itv_contracts.base_price_ht is 'Prix annuel HT de référence (P0), à la signature ; le prix en cours (annual_price_ht) suit les révisions (0462)';

create table if not exists public.itv_contract_revisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  contract_id uuid not null references public.itv_contracts(id) on delete cascade,
  anniversary date not null,
  index_label text,
  base_value numeric(12,4),
  new_value numeric(12,4) check (new_value is null or new_value > 0),
  new_value_month date,
  price_before numeric(12,2) not null,
  price_after numeric(12,2),
  status text not null default 'a_saisir' check (status in ('a_saisir', 'validee', 'ecartee')),
  decided_at timestamptz,
  decided_by uuid,
  note text check (note is null or length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (contract_id, anniversary)
);
alter table public.itv_contract_revisions enable row level security;
drop policy if exists itv_contract_revisions_sel on public.itv_contract_revisions;
create policy itv_contract_revisions_sel on public.itv_contract_revisions for select to authenticated
  using (company_id in (select app.societes_lisibles())
    and (((select app.module_on('interventions')) and (select app.a_le_droit('interventions.contrats.voir'))) or (select app.is_superadmin())));
revoke all on public.itv_contract_revisions from anon, authenticated;
grant select on public.itv_contract_revisions to authenticated;

-- Contrat signé : conditions figées, sauf le prix par une révision validée (drapeau posé par contrat_revision_decider)
create or replace function app.contrat_signe_fige()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_revision boolean := coalesce(current_setting('app.revision_prix', true), '') = 'oui';
begin
  if old.signed_at is not null and (
       (new.annual_price_ht is distinct from old.annual_price_ht and not v_revision) or new.duration_years is distinct from old.duration_years
    or new.tacit_renewal is distinct from old.tacit_renewal or new.renewal_years is distinct from old.renewal_years
    or new.notice_months is distinct from old.notice_months or new.billing_period is distinct from old.billing_period
    or new.start_on is distinct from old.start_on or new.client_id is distinct from old.client_id
    or new.signed_at is distinct from old.signed_at or new.signed_name is distinct from old.signed_name
    or new.signature_id is distinct from old.signature_id or new.base_price_ht is distinct from old.base_price_ht
    or new.index_base_value is distinct from old.index_base_value or new.index_series is distinct from old.index_series) then
    raise exception 'Contrat signé : ses conditions se changent par un avenant' using errcode = '42501';
  end if;
  return new;
end
$$;

-- Périodes de l'échéancier (0461) : prix de chaque période selon les révisions validées
create or replace function app.contrat_periodes(p_contract uuid)
returns table (period_start date, period_end date, amount_ht numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  k public.itv_contracts;
  v_fin date;
  d date;
  f date;
  v_plein date;
  v_part numeric;
  v_jours numeric;
  v_total numeric;
  v_annuel numeric;
begin
  select * into k from public.itv_contracts where id = p_contract;
  if k.id is null or k.billing_period is null or k.billing_period = 'visite' or coalesce(k.annual_price_ht, 0) <= 0 then return; end if;
  v_fin := least(coalesce(k.term_on, (k.start_on + interval '1 year' - interval '1 day')::date), coalesce(k.end_on, 'infinity'::date));
  d := k.start_on;
  while d <= v_fin loop
    -- Prix de la période (0462) : celui de la dernière révision validée à cette date, sinon le prix de référence
    select coalesce((select r.price_after from public.itv_contract_revisions r where r.contract_id = k.id and r.status = 'validee' and r.anniversary <= d order by r.anniversary desc limit 1),
                    k.base_price_ht, k.annual_price_ht) into v_annuel;
    if k.billing_period = 'mensuel' then
      v_plein := (date_trunc('month', d) + interval '1 month' - interval '1 day')::date;
      v_part := v_annuel / 12;
      v_total := extract(day from v_plein);
    elsif k.billing_period = 'trimestriel' then
      v_plein := (date_trunc('quarter', d) + interval '3 months' - interval '1 day')::date;
      v_part := v_annuel / 4;
      v_total := (v_plein - date_trunc('quarter', d)::date) + 1;
    else -- annuel : année de contrat
      v_plein := (d + interval '1 year' - interval '1 day')::date;
      v_part := v_annuel;
      v_total := (v_plein - d) + 1;
    end if;
    -- Une période ne chevauche jamais une date anniversaire (le prix peut y changer)
    f := least(v_plein, v_fin, (k.start_on + make_interval(years => (extract(year from age(d, k.start_on)))::int + 1) - interval '1 day')::date);
    -- Prorata au jour d'une période incomplète (début en cours de mois ou de trimestre, fin anticipée)
    if k.billing_period = 'annuel' then
      v_jours := (f - d) + 1;
    elsif k.billing_period = 'mensuel' then
      v_jours := (f - greatest(d, date_trunc('month', d)::date)) + 1;
    else
      v_jours := (f - greatest(d, date_trunc('quarter', d)::date)) + 1;
    end if;
    period_start := d; period_end := f; amount_ht := round(v_part * least(1, v_jours / v_total), 2);
    return next;
    d := f + 1;
  end loop;
end
$$;
revoke all on function app.contrat_periodes(uuid) from public, anon, authenticated;

-- Nouveau prix : P0 × I / I0, arrondi au centime
create or replace function app.prix_revise(p_p0 numeric, p_i0 numeric, p_i numeric)
returns numeric language sql immutable as $$ select round(p_p0 * p_i / p_i0, 2) $$;

-- Décision de la direction : valeur de l'indice saisie, révision validée (ou écartée)
create or replace function public.contrat_revision_decider(p_revision uuid, p_valeur numeric, p_mois date, p_valider boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare r public.itv_contract_revisions; k public.itv_contracts; v_prix numeric;
begin
  select * into r from public.itv_contract_revisions where id = p_revision for update;
  if r.id is null then raise exception 'Révision introuvable' using errcode = 'P0002'; end if;
  perform app.require_right('interventions.contrats.gerer');
  perform app.exiger_societe('itv_contracts', r.contract_id, true);
  if r.status <> 'a_saisir' then raise exception 'Révision déjà traitée' using errcode = '22023'; end if;
  select * into k from public.itv_contracts where id = r.contract_id for update;
  if not p_valider then
    update public.itv_contract_revisions set status = 'ecartee', decided_at = now(), decided_by = auth.uid(), note = left(p_note, 500) where id = r.id;
    return jsonb_build_object('ok', true, 'ecartee', true);
  end if;
  if p_valeur is null or p_valeur <= 0 then raise exception 'Saisissez la nouvelle valeur de l''indice' using errcode = '22023'; end if;
  if coalesce(k.index_base_value, 0) <= 0 then raise exception 'Valeur de référence de l''indice absente du contrat' using errcode = '22023'; end if;
  v_prix := app.prix_revise(coalesce(k.base_price_ht, r.price_before), k.index_base_value, p_valeur);
  perform set_config('app.revision_prix', 'oui', true);
  update public.itv_contracts set annual_price_ht = v_prix, updated_at = now() where id = k.id;
  perform set_config('app.revision_prix', '', true);
  update public.itv_contract_revisions set status = 'validee', new_value = p_valeur, new_value_month = p_mois, price_after = v_prix,
    decided_at = now(), decided_by = auth.uid(), note = left(p_note, 500) where id = r.id;
  -- Échéances non facturées à partir de l'anniversaire : nouveau prix (les autres ne bougent pas)
  perform app.contrat_echeancier(k.id);
  return jsonb_build_object('ok', true, 'prix', v_prix);
end
$$;
revoke all on function public.contrat_revision_decider(uuid, numeric, date, boolean, text) from public, anon;
grant execute on function public.contrat_revision_decider(uuid, numeric, date, boolean, text) to authenticated;

-- P0 posé à la validation du contrat (prix de départ) ; contrats existants : prix en cours
update public.itv_contracts set base_price_ht = annual_price_ht where base_price_ht is null;
create or replace function app.contrat_prix_reference()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.base_price_ht is null then new.base_price_ht := new.annual_price_ht; end if;
  -- Avant signature, le prix de référence suit le prix saisi
  if tg_op = 'UPDATE' and old.signed_at is null and new.annual_price_ht is distinct from old.annual_price_ht
     and coalesce(current_setting('app.revision_prix', true), '') <> 'oui' then
    new.base_price_ht := new.annual_price_ht;
  end if;
  return new;
end $$;
drop trigger if exists itv_contracts_prix_reference on public.itv_contracts;
create trigger itv_contracts_prix_reference before insert or update on public.itv_contracts
  for each row execute function app.contrat_prix_reference();

-- Révisions préparées : 30 jours avant chaque anniversaire d'un contrat actif qui a un indice
create or replace function public.contrats_revisions_generer()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v_n int;
begin
  with a as (
    select k.*, (k.start_on + make_interval(years => (extract(year from age(current_date + 30, k.start_on)))::int))::date as anniv
    from public.itv_contracts k
    where k.status = 'actif' and k.index_base_value is not null and k.start_on < current_date)
  , ins as (
    insert into public.itv_contract_revisions (company_id, contract_id, anniversary, index_label, base_value, price_before)
    select a.company_id, a.id, a.anniv, a.index_label, a.index_base_value, a.annual_price_ht
    from a where a.anniv > a.start_on and a.anniv between current_date and current_date + 30
    on conflict (contract_id, anniversary) do nothing
    returning id, contract_id, anniversary, company_id)
  insert into public.scheduled_actions (company_id, kind, target_table, target_id, client_id, due_on, title, payload, dedup_key)
  select ins.company_id, 'rappel', 'itv_contracts', ins.contract_id, k.client_id, ins.anniversary,
         'Révision du prix du contrat de ' || c.name || ' au ' || to_char(ins.anniversary, 'DD/MM/YYYY'),
         jsonb_build_object('interne', true, 'lien', '/interventions/contrats?contrat=' || ins.contract_id,
           'texte', 'Saisissez la dernière valeur publiée de l''indice ' || coalesce(nullif(k.index_label, ''), 'du contrat')
             || coalesce(' (série ' || nullif(k.index_series, '') || ')', '') || ' : le nouveau prix est calculé, vous le validez ou l''écartez, puis le courrier au client est prêt.'),
         'revision:' || ins.id
  from ins join public.itv_contracts k on k.id = ins.contract_id join public.clients c on c.id = k.client_id
  on conflict (company_id, dedup_key) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
revoke all on function public.contrats_revisions_generer() from public, anon, authenticated;
grant execute on function public.contrats_revisions_generer() to service_role;

-- Retour arrière :
-- drop function if exists public.contrats_revisions_generer();
-- drop trigger if exists itv_contracts_prix_reference on public.itv_contracts; drop function if exists app.contrat_prix_reference();
-- drop function if exists public.contrat_revision_decider(uuid, numeric, date, boolean, text); drop function if exists app.prix_revise(numeric, numeric, numeric);
-- (app.contrat_signe_fige : reprendre la définition de 0460 ; app.contrat_periodes : celle de 0461)
-- drop table if exists public.itv_contract_revisions;
-- alter table public.itv_contracts drop constraint if exists itv_contracts_indice_chk;
-- alter table public.itv_contracts drop column if exists base_price_ht, drop column if exists index_base_month,
--   drop column if exists index_base_value, drop column if exists index_series, drop column if exists index_label;
