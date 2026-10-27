-- 0460 : contrats de maintenance, du devis signé au contrat signé (lot 1, décisions de H du 27/10/2026,
-- claude/odet-decisions-2026-10-27-contrats.md § 1). Étend itv_contracts sans rien refaire.
--   1. Conditions du contrat portées par le devis (quotes.contrat) : durée 1, 3 ou 5 ans, reconduction tacite ou non,
--      période de reconduction, préavis, périodicité de facturation, mois de visite. Une seule saisie : le contrat
--      les reprend du devis signé.
--   2. Devis de maintenance accepté : contrat « à valider » préparé (une seule fois par devis), direction prévenue.
--      Prix annuel = lignes de maintenance du devis, hors frais d'établissement (code FRAIS-CONTRAT).
--   3. contrat_valider : un clic de la direction, échéance calculée ; sans reconduction, la fin du contrat est
--      l'échéance (les visites s'arrêtent, la relance de fin de contrat existante joue).
--   4. Signature en ligne (0406, document « contrat » rattaché au contrat) ou dépôt d'un contrat signé à la main :
--      le contrat est noté signé ; ses conditions sont ensuite figées (changement = avenant, lot 4).
--   5. Visites : générées seulement pour un contrat actif (faille : un contrat suspendu ou terminé en générait).
--   6. Nuit : échéance avancée à la reconduction ; relance interne avant la fin du préavis ; pour un particulier,
--      courrier d'information avant la reconduction, préparé dans « Relances à valider » (rien ne part seul).
-- Réglages par société (billing_settings) : frais d'établissement par durée (vides par défaut : montants à confirmer
-- par l'entreprise), préavis par défaut (3 mois : carnet GLD et projet de CGV), période de reconduction par défaut
-- (1 an, recommandation à faire valider par l'expert).
-- Migration additive, rejouable. Retour arrière en fin de fichier.

-- ── Réglages ──
alter table public.billing_settings add column if not exists contrat_frais_etablissement jsonb not null default '{}'::jsonb;
alter table public.billing_settings add column if not exists contrat_preavis_mois int not null default 3;
alter table public.billing_settings add column if not exists contrat_reconduction_ans int not null default 1;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_settings_contrat_chk') then
    alter table public.billing_settings add constraint billing_settings_contrat_chk check (
      jsonb_typeof(contrat_frais_etablissement) = 'object'
      and contrat_preavis_mois between 0 and 12 and contrat_reconduction_ans between 1 and 5);
  end if;
end $$;
comment on column public.billing_settings.contrat_frais_etablissement is 'Frais d''établissement d''un contrat de maintenance par durée en années, HT : {"3": 50, "5": 80} ; vide = aucune ligne ajoutée (0460)';

-- ── Conditions portées par le devis ──
alter table public.quotes add column if not exists contrat jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'quotes_contrat_chk') then
    alter table public.quotes add constraint quotes_contrat_chk check (contrat is null or (
      jsonb_typeof(contrat) = 'object'
      and coalesce((contrat ->> 'duree_ans')::int, 1) in (1, 3, 5)
      and coalesce((contrat ->> 'reconduction_ans')::int, 1) between 1 and 5
      and coalesce((contrat ->> 'preavis_mois')::int, 0) between 0 and 12
      and coalesce(contrat ->> 'periodicite', 'annuel') in ('mensuel', 'trimestriel', 'annuel', 'visite')));
  end if;
end $$;
comment on column public.quotes.contrat is 'Conditions du contrat de maintenance proposé par le devis : duree_ans, reconduction, reconduction_ans, preavis_mois, periodicite, mois_visite (0460)';

-- ── Contrat ──
alter table public.itv_contracts add column if not exists quote_id uuid references public.quotes(id) on delete set null;
alter table public.itv_contracts add column if not exists duration_years int;
alter table public.itv_contracts add column if not exists tacit_renewal boolean not null default false;
alter table public.itv_contracts add column if not exists renewal_years int not null default 1;
alter table public.itv_contracts add column if not exists notice_months int;
alter table public.itv_contracts add column if not exists billing_period text;
alter table public.itv_contracts add column if not exists term_on date;
alter table public.itv_contracts add column if not exists validated_at timestamptz;
alter table public.itv_contracts add column if not exists validated_by uuid;
alter table public.itv_contracts add column if not exists signed_at timestamptz;
alter table public.itv_contracts add column if not exists signed_name text;
alter table public.itv_contracts add column if not exists signature_id uuid;
alter table public.itv_contracts add column if not exists signed_document_id uuid references public.client_shared_documents(id) on delete set null;
alter table public.itv_contracts add column if not exists signed_on_paper boolean not null default false;

create unique index if not exists itv_contracts_quote_unique on public.itv_contracts (quote_id) where quote_id is not null;

alter table public.itv_contracts drop constraint if exists itv_contracts_status_check;
alter table public.itv_contracts add constraint itv_contracts_status_check check (status in ('a_valider', 'actif', 'suspendu', 'termine'));
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'itv_contracts_conditions_chk') then
    alter table public.itv_contracts add constraint itv_contracts_conditions_chk check (
      (duration_years is null or duration_years in (1, 3, 5))
      and renewal_years between 1 and 5
      and (notice_months is null or notice_months between 0 and 12)
      and (billing_period is null or billing_period in ('mensuel', 'trimestriel', 'annuel', 'visite'))
      and (signed_name is null or length(signed_name) <= 120));
  end if;
end $$;
comment on column public.itv_contracts.term_on is 'Dernier jour de la période en cours (échéance) ; avancé à chaque reconduction tacite (0460)';

-- ── Contrat préparé depuis un devis de maintenance accepté ──
create or replace function app.devis_prepare_contrat(p_quote uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
  c public.clients;
  bs public.billing_settings;
  v_prix numeric;
  v_mois int[];
  v_id uuid;
  v_cond jsonb;
  v_periode text;
  v_ancien uuid;
  v_ancien_statut text;
begin
  select * into q from public.quotes where id = p_quote;
  if q.id is null or q.status not in ('accepted', 'partial') then return null; end if;
  if exists (select 1 from public.itv_contracts k where k.quote_id = q.id) then return null; end if;
  -- Avenant à un devis signé : il modifie le contrat existant (lot 4), il n'en prépare jamais un second
  if q.amendment_of is not null then return null; end if;
  -- Lignes de maintenance acceptées : métier de la ligne, sinon celui du devis ; jamais les frais d'établissement
  select round(sum(coalesce(i.quantity, 1) * coalesce(i.unit_price_ht, 0) * (1 - coalesce(q.discount_percent, 0) / 100)), 2)
    into v_prix
  from public.quote_items i
  where i.quote_id = q.id and coalesce(i.accepted, true)
    and coalesce(i.metier, case when q.metier = 'maintenance' then 'maintenance' end) = 'maintenance'
    and coalesce(i.code, '') <> 'FRAIS-CONTRAT';
  if v_prix is null then return null; end if;

  -- Nouvelle version d'un devis signé (V2, V3…) : le contrat de la version précédente la suit (jamais un second
  -- contrat). Encore à valider : il reprend le prix et les conditions de la nouvelle version ; déjà validé : la
  -- direction est prévenue (le changement passe par un avenant).
  with recursive anc(id) as (
    select q.previous_quote_id where q.previous_quote_id is not null
    union
    select p.previous_quote_id from public.quotes p join anc on p.id = anc.id where p.previous_quote_id is not null)
  select k.id, k.status into v_ancien, v_ancien_statut from public.itv_contracts k where k.quote_id in (select id from anc) limit 1;
  if v_ancien is not null then
    if v_ancien_statut = 'a_valider' then
      update public.itv_contracts set quote_id = q.id, annual_price_ht = v_prix,
        duration_years = coalesce((q.contrat ->> 'duree_ans')::int, duration_years),
        tacit_renewal = coalesce((q.contrat ->> 'reconduction')::boolean, tacit_renewal),
        renewal_years = coalesce((q.contrat ->> 'reconduction_ans')::int, renewal_years),
        notice_months = coalesce((q.contrat ->> 'preavis_mois')::int, notice_months),
        billing_period = coalesce(q.contrat ->> 'periodicite', billing_period), updated_at = now()
      where id = v_ancien;
    else
      insert into public.notifications (company_id, type, title, message, link, metadata)
      values (q.company_id, 'contrat_a_valider', 'Nouvelle version signée',
        'Devis ' || coalesce(q.reference, '') || ' accepté : le contrat en cours ne change pas tout seul. Faites un avenant si le prix ou le périmètre change.',
        '/interventions/contrats?contrat=' || v_ancien, jsonb_build_object('contract_id', v_ancien, 'quote_id', q.id));
    end if;
    return v_ancien;
  end if;

  select * into c from public.clients where id = q.client_id;
  select * into bs from public.billing_settings where company_id = q.company_id;
  v_cond := coalesce(q.contrat, '{}'::jsonb);
  -- Mois de visite : ceux du devis, sinon les échéances du parc du client, sinon le mois qui suit la signature
  select array_agg(distinct m order by m) into v_mois
  from jsonb_array_elements_text(case when jsonb_typeof(v_cond -> 'mois_visite') = 'array' then v_cond -> 'mois_visite' else '[]'::jsonb end) x(m0)
  cross join lateral (select m0::int as m) y where y.m between 1 and 12;
  if v_mois is null then
    select array_agg(distinct extract(month from e.next_check_on)::int order by extract(month from e.next_check_on)::int) into v_mois
    from public.itv_equipment e where e.client_id = q.client_id and e.next_check_on is not null and e.status = 'en_service';
  end if;
  if v_mois is null then v_mois := array[extract(month from (current_date + interval '1 month'))::int]; end if;
  -- Client public : trimestriel proposé par défaut (décision 4.2) ; sinon annuel
  v_periode := coalesce(v_cond ->> 'periodicite', case when c.client_type = 'public' then 'trimestriel' else 'annuel' end);

  insert into public.itv_contracts (client_id, company_id, quote_id, label, reference, start_on, annual_price_ht, visit_months,
    status, duration_years, tacit_renewal, renewal_years, notice_months, billing_period, notes)
  values (q.client_id, q.company_id, q.id, 'Contrat de maintenance', null, current_date, v_prix, v_mois,
    'a_valider', coalesce((v_cond ->> 'duree_ans')::int, 1), coalesce((v_cond ->> 'reconduction')::boolean, true),
    coalesce((v_cond ->> 'reconduction_ans')::int, bs.contrat_reconduction_ans, 1),
    coalesce((v_cond ->> 'preavis_mois')::int, bs.contrat_preavis_mois, 3), v_periode,
    'Préparé depuis le devis signé ' || coalesce(q.reference, '') || ' : vérifiez les mois de visite, puis validez.')
  returning id into v_id;

  insert into public.notifications (company_id, type, title, message, link, metadata)
  values (q.company_id, 'contrat_a_valider', 'Contrat à valider',
    'Devis ' || coalesce(q.reference, '') || ' accepté par ' || coalesce(c.name, 'le client') || ' : contrat de maintenance préparé, à valider.',
    '/interventions/contrats?contrat=' || v_id, jsonb_build_object('contract_id', v_id, 'quote_id', q.id));
  return v_id;
end
$$;
revoke all on function app.devis_prepare_contrat(uuid) from public, anon, authenticated;

create or replace function app.devis_accepte_contrat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('accepted', 'partial') and coalesce(old.status, '') not in ('accepted', 'partial') then
    perform app.devis_prepare_contrat(new.id);
  end if;
  return new;
end
$$;
revoke all on function app.devis_accepte_contrat() from public, anon, authenticated;
drop trigger if exists quotes_accepte_contrat on public.quotes;
create trigger quotes_accepte_contrat after update of status on public.quotes
  for each row execute function app.devis_accepte_contrat();

-- ── Validation par la direction (un clic) ──
create or replace function public.contrat_valider(p_contract uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare k public.itv_contracts; v_term date;
begin
  perform app.require_right('interventions.contrats.gerer');
  perform app.exiger_societe('itv_contracts', p_contract, true);
  select * into k from public.itv_contracts where id = p_contract for update;
  if k.id is null then raise exception 'Contrat introuvable' using errcode = 'P0002'; end if;
  if k.status <> 'a_valider' then return jsonb_build_object('ok', true, 'deja', true); end if;
  if coalesce(cardinality(k.visit_months), 0) = 0 then raise exception 'Choisissez au moins un mois de visite' using errcode = '22023'; end if;
  v_term := (k.start_on + make_interval(years => coalesce(k.duration_years, 1)) - interval '1 day')::date;
  update public.itv_contracts set status = 'actif', validated_at = now(), validated_by = auth.uid(), term_on = v_term,
    end_on = case when tacit_renewal then end_on else coalesce(end_on, v_term) end, updated_at = now()
  where id = p_contract;
  return jsonb_build_object('ok', true, 'term_on', v_term);
end
$$;
revoke all on function public.contrat_valider(uuid) from public, anon;
grant execute on function public.contrat_valider(uuid) to authenticated;

-- ── Contrat signé à la main (mairie, papier) : document déposé dans l'espace client, nom et date saisis ──
create or replace function public.contrat_signe_papier(p_contract uuid, p_document uuid, p_nom text, p_date date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare k public.itv_contracts; d public.client_shared_documents;
begin
  perform app.require_right('interventions.contrats.gerer');
  perform app.exiger_societe('itv_contracts', p_contract, true);
  select * into k from public.itv_contracts where id = p_contract for update;
  if k.id is null then raise exception 'Contrat introuvable' using errcode = 'P0002'; end if;
  if k.signed_at is not null then raise exception 'Ce contrat est déjà signé' using errcode = '22023'; end if;
  select * into d from public.client_shared_documents where id = p_document and client_id = k.client_id and withdrawn_at is null;
  if d.id is null then raise exception 'Document introuvable pour ce client' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_nom, ''))) < 2 then raise exception 'Nom du signataire requis' using errcode = '22023'; end if;
  if p_date is null or p_date > current_date then raise exception 'Date de signature invalide' using errcode = '22023'; end if;
  update public.itv_contracts set signed_at = p_date::timestamptz, signed_name = left(btrim(p_nom), 120), signed_document_id = d.id,
    signed_on_paper = true, updated_at = now() where id = p_contract;
  return jsonb_build_object('ok', true);
end
$$;
revoke all on function public.contrat_signe_papier(uuid, uuid, text, date) from public, anon;
grant execute on function public.contrat_signe_papier(uuid, uuid, text, date) to authenticated;

-- ── Signature en ligne d'un document « contrat » rattaché au contrat (0406) ──
create or replace function app.signature_contrat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.signer_type = 'client' and new.status = 'valid' and new.metadata ->> 'object_type' = 'itv_contract'
     and (new.metadata ->> 'object_id') ~ '^[0-9a-f-]{36}$' then
    update public.itv_contracts set signed_at = new.signed_at, signed_name = left(new.signer_name, 120), signature_id = new.id,
      signed_document_id = nullif(new.metadata ->> 'document_id', '')::uuid, signed_on_paper = false, updated_at = now()
    where id = (new.metadata ->> 'object_id')::uuid and signed_at is null;
  end if;
  return new;
end
$$;
revoke all on function app.signature_contrat() from public, anon, authenticated;
drop trigger if exists document_signatures_contrat on public.document_signatures;
create trigger document_signatures_contrat after insert on public.document_signatures
  for each row execute function app.signature_contrat();

-- ── Conditions figées après signature (changement = avenant, lot 4) ──
create or replace function app.contrat_signe_fige()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.signed_at is not null and (
       new.annual_price_ht is distinct from old.annual_price_ht or new.duration_years is distinct from old.duration_years
    or new.tacit_renewal is distinct from old.tacit_renewal or new.renewal_years is distinct from old.renewal_years
    or new.notice_months is distinct from old.notice_months or new.billing_period is distinct from old.billing_period
    or new.start_on is distinct from old.start_on or new.client_id is distinct from old.client_id
    or new.signed_at is distinct from old.signed_at or new.signed_name is distinct from old.signed_name
    or new.signature_id is distinct from old.signature_id) then
    raise exception 'Contrat signé : ses conditions se changent par un avenant' using errcode = '42501';
  end if;
  return new;
end
$$;
drop trigger if exists itv_contracts_signe_fige on public.itv_contracts;
create trigger itv_contracts_signe_fige before update on public.itv_contracts
  for each row execute function app.contrat_signe_fige();

-- ── Visites : seulement pour un contrat actif (le reste de la fonction est inchangé) ──
create or replace function public.itv_generate_contract_visits(p_contract uuid, p_year integer default (extract(year from current_date))::integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare c public.itv_contracts%rowtype; m int; s record; v_due date; n int := 0;
begin
  /* société (C2) */ perform app.exiger_societe('itv_contracts', p_contract, true);
  /* garde chantier 2 */ perform app.require_right('interventions.visites.gerer');

  if not public.itv_can_write() then raise exception 'Accès refusé' using errcode = '42501'; end if;
  select * into c from public.itv_contracts where id = p_contract;
  if not found then raise exception 'Contrat introuvable'; end if;
  /* 0460 */ if c.status <> 'actif' then raise exception 'Contrat non actif : validez-le avant de générer ses visites' using errcode = '22023'; end if;
  foreach m in array coalesce(c.visit_months, '{}') loop
    v_due := make_date(p_year, m, 1);
    if v_due < date_trunc('month', c.start_on)::date or (c.end_on is not null and v_due > c.end_on) then continue; end if;
    for s in select id from public.sites
             where client_id = c.client_id and is_active
               and (c.site_ids is null or cardinality(c.site_ids) = 0 or id = any(c.site_ids)) loop
      if not exists (select 1 from public.itv_visits where contract_id = c.id and site_id = s.id
                     and date_trunc('month', due_on) = date_trunc('month', v_due) and status <> 'annulee') then
        insert into public.itv_visits (client_id, site_id, contract_id, due_on, status)
        values (c.client_id, s.id, c.id, v_due, 'a_planifier');
        n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end $function$;

-- ── Nuit : reconduction, fin de préavis, information du particulier ──
create or replace function public.contrats_relances_generer()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_r int := 0; v_p int := 0; v_i int := 0; r record; v_t date;
begin
  -- Reconduction tacite : l'échéance passée avance d'une période de reconduction (autant de fois que nécessaire)
  for r in select id, term_on, renewal_years from public.itv_contracts
           where status = 'actif' and tacit_renewal and term_on is not null and term_on < current_date for update loop
    v_t := r.term_on;
    while v_t < current_date loop v_t := (v_t + 1 + make_interval(years => r.renewal_years) - interval '1 day')::date; end loop;
    update public.itv_contracts set term_on = v_t, updated_at = now() where id = r.id;
    v_r := v_r + 1;
  end loop;

  -- Relance interne 45 jours avant la fin du préavis (dernier jour pour refuser la reconduction)
  insert into public.scheduled_actions (company_id, kind, target_table, target_id, client_id, due_on, title, payload, dedup_key)
  select k.company_id, 'renouvellement_contrat', 'itv_contracts', k.id, k.client_id, x.limite,
         'Contrat de ' || c.name || ' : reconduit le ' || to_char(k.term_on + 1, 'DD/MM/YYYY') || ' sauf refus avant le ' || to_char(x.limite, 'DD/MM/YYYY'),
         jsonb_build_object('interne', true, 'texte',
           'Le contrat ' || coalesce(nullif(k.label, ''), 'de maintenance') || ' de ' || c.name || ' se reconduit le ' || to_char(k.term_on + 1, 'DD/MM/YYYY')
           || '. Le client peut le refuser jusqu''au ' || to_char(x.limite, 'DD/MM/YYYY') || ' (préavis de ' || coalesce(k.notice_months, 0) || ' mois).'
           || E'\n\n' || 'Bon moment pour faire le point avec lui : bilan des visites, matériel à remplacer, révision du prix.'),
         'contrat_preavis:' || k.id || ':' || to_char(k.term_on, 'YYYY-MM-DD')
  from public.itv_contracts k
  join public.clients c on c.id = k.client_id
  cross join lateral (select ((k.term_on + 1) - make_interval(months => coalesce(k.notice_months, 0)))::date - 1 as limite) x
  where k.status = 'actif' and k.tacit_renewal and k.term_on is not null
    and x.limite between current_date and current_date + 45
  on conflict (company_id, dedup_key) do nothing;
  get diagnostics v_p = row_count;

  -- Particulier : courrier d'information sur la possibilité de ne pas reconduire, au plus tôt trois mois et au plus
  -- tard un mois avant la date limite de refus (code de la consommation, L215-1 ; texte à valider par l'expert).
  -- Préparé 75 jours avant la date limite, dans la fenêtre ; rien ne part sans validation.
  insert into public.scheduled_actions (company_id, kind, target_table, target_id, client_id, due_on, title, payload, dedup_key)
  select k.company_id, 'renouvellement_contrat', 'itv_contracts', k.id, k.client_id, x.limite - 30,
         'Particulier : informer ' || c.name || ' de la reconduction de son contrat (au plus tard le ' || to_char(x.limite - 30, 'DD/MM/YYYY') || ')',
         jsonb_build_object(
           'destinataire', coalesce(nullif(btrim(c.contact_email), ''), nullif(btrim(c.email), '')),
           'objet', 'Votre contrat de maintenance : reconduction le ' || to_char(k.term_on + 1, 'DD/MM/YYYY'),
           'texte', 'Bonjour,' || E'\n\n' || 'Votre contrat ' || coalesce(nullif(k.label, ''), 'de maintenance') || ' arrive à son échéance le '
             || to_char(k.term_on, 'DD/MM/YYYY') || '. Sans demande de votre part, il sera reconduit le ' || to_char(k.term_on + 1, 'DD/MM/YYYY')
             || ' pour ' || k.renewal_years || case when k.renewal_years > 1 then ' ans.' else ' an.' end
             || E'\n\n' || 'Si vous ne souhaitez pas le reconduire, il vous suffit de nous le faire savoir avant le ' || to_char(x.limite, 'DD/MM/YYYY')
             || ', par écrit ou depuis votre espace client.' || E'\n\n' || 'Bien cordialement,',
           'a_valider_par_expert', true),
         'contrat_info_conso:' || k.id || ':' || to_char(k.term_on, 'YYYY-MM-DD')
  from public.itv_contracts k
  join public.clients c on c.id = k.client_id
  cross join lateral (select ((k.term_on + 1) - make_interval(months => coalesce(k.notice_months, 0)))::date - 1 as limite) x
  where k.status = 'actif' and k.tacit_renewal and k.term_on is not null and c.client_type = 'particulier'
    and current_date between x.limite - 75 and x.limite - 30
    and coalesce(c.status, 'actif') not in ('archive', 'archived', 'inactif')
  on conflict (company_id, dedup_key) do nothing;
  get diagnostics v_i = row_count;

  return jsonb_build_object('reconduits', v_r, 'preavis', v_p, 'information_particulier', v_i);
end
$$;
revoke all on function public.contrats_relances_generer() from public, anon, authenticated;
grant execute on function public.contrats_relances_generer() to service_role;

-- Retour arrière :
-- drop function if exists public.contrats_relances_generer();
-- drop trigger if exists itv_contracts_signe_fige on public.itv_contracts; drop function if exists app.contrat_signe_fige();
-- drop trigger if exists document_signatures_contrat on public.document_signatures; drop function if exists app.signature_contrat();
-- drop function if exists public.contrat_signe_papier(uuid, uuid, text, date); drop function if exists public.contrat_valider(uuid);
-- drop trigger if exists quotes_accepte_contrat on public.quotes; drop function if exists app.devis_accepte_contrat();
-- drop function if exists app.devis_prepare_contrat(uuid);
-- (fonction des visites : reprendre la définition précédente, sans la ligne « 0460 »)
-- update public.itv_contracts set status = 'suspendu' where status = 'a_valider';
-- alter table public.itv_contracts drop constraint if exists itv_contracts_status_check;
-- alter table public.itv_contracts add constraint itv_contracts_status_check check (status in ('actif', 'suspendu', 'termine'));
-- alter table public.itv_contracts drop constraint if exists itv_contracts_conditions_chk; drop index if exists itv_contracts_quote_unique;
-- alter table public.itv_contracts drop column if exists signed_on_paper, drop column if exists signed_document_id,
--   drop column if exists signature_id, drop column if exists signed_name, drop column if exists signed_at,
--   drop column if exists validated_by, drop column if exists validated_at, drop column if exists term_on,
--   drop column if exists billing_period, drop column if exists notice_months, drop column if exists renewal_years,
--   drop column if exists tacit_renewal, drop column if exists duration_years, drop column if exists quote_id;
-- alter table public.quotes drop constraint if exists quotes_contrat_chk; alter table public.quotes drop column if exists contrat;
-- alter table public.billing_settings drop constraint if exists billing_settings_contrat_chk;
-- alter table public.billing_settings drop column if exists contrat_reconduction_ans, drop column if exists contrat_preavis_mois,
--   drop column if exists contrat_frais_etablissement;
