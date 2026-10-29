-- 0471 : contrats de maintenance, résiliation en ligne par le client particulier (décisions du 27/10 § 7.7, CGV
-- maintenance « Résiliation (particuliers) »).
--
-- Espace entreprise : rubrique « Contrats » (contrats du client, échéance, reconduction, date limite de refus) ; un
-- client particulier peut demander la résiliation en ligne. La demande est horodatée, un accusé de réception s'affiche
-- tout de suite (numéro, date et heure) et reste consultable ; la direction reçoit un rappel pour confirmer la date
-- d'effet. Le contrat n'est pas arrêté tout seul : son statut ne change que par la direction.
-- Retour arrière (manuel) : en fin de fichier.

alter table public.itv_contracts add column if not exists termination_requested_at timestamptz;
alter table public.itv_contracts add column if not exists termination_requested_by uuid;
alter table public.itv_contracts add column if not exists termination_reason text check (termination_reason is null or length(termination_reason) <= 1000);
alter table public.itv_contracts add column if not exists termination_receipt text;
comment on column public.itv_contracts.termination_requested_at is '0471 : résiliation demandée en ligne par le client (horodatage de l''accusé de réception).';
comment on column public.itv_contracts.termination_receipt is '0471 : numéro de l''accusé de réception remis au client.';

create or replace function public.ent_contrats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.client_accounts := app.ent_compte();
  v_type text;
begin
  select coalesce(c.client_type, 'entreprise') into v_type from public.clients c where c.id = v.client_id;
  return jsonb_build_object(
    'particulier', v_type = 'particulier',
    'contrats', coalesce((select jsonb_agg(jsonb_build_object(
        'id', k.id, 'label', coalesce(nullif(k.label, ''), 'Contrat de maintenance'), 'reference', k.reference, 'status', k.status,
        'start_on', k.start_on, 'term_on', k.term_on, 'tacit_renewal', k.tacit_renewal, 'renewal_years', k.renewal_years,
        'notice_months', k.notice_months,
        'limite_refus', case when k.tacit_renewal and k.term_on is not null then (k.term_on - make_interval(months => coalesce(k.notice_months, 0)))::date end,
        'signed', k.signed_at is not null,
        'termination_requested_at', k.termination_requested_at, 'termination_receipt', k.termination_receipt) order by k.start_on desc)
      from public.itv_contracts k
      where k.client_id = v.client_id and k.company_id = v.company_id and k.status in ('actif', 'suspendu')), '[]'::jsonb));
end
$$;
revoke all on function public.ent_contrats() from public, anon;
grant execute on function public.ent_contrats() to authenticated;

create or replace function public.ent_contrat_resilier(p_contract uuid, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.client_accounts := app.ent_compte();
  k public.itv_contracts;
  c public.clients;
  v_recu text;
begin
  select * into k from public.itv_contracts where id = p_contract for update;
  if k.id is null or k.client_id <> v.client_id or k.company_id <> v.company_id or k.status not in ('actif', 'suspendu') then
    raise exception 'Contrat introuvable' using errcode = 'P0002';
  end if;
  select * into c from public.clients where id = k.client_id;
  if coalesce(c.client_type, 'entreprise') <> 'particulier' then
    raise exception 'Résiliation en ligne réservée aux particuliers : écrivez à votre prestataire' using errcode = '42501';
  end if;
  if k.termination_requested_at is not null then
    return jsonb_build_object('deja', true, 'at', k.termination_requested_at, 'receipt', k.termination_receipt);
  end if;
  v_recu := 'RES-' || to_char(now() at time zone 'Europe/Paris', 'YYYYMMDD-HH24MI') || '-' || upper(substr(md5(k.id::text || now()::text), 1, 4));
  update public.itv_contracts set termination_requested_at = now(), termination_requested_by = (select auth.uid()),
    termination_reason = nullif(left(btrim(coalesce(p_motif, '')), 1000), ''), termination_receipt = v_recu, updated_at = now()
  where id = k.id;
  insert into public.scheduled_actions (company_id, kind, target_table, target_id, client_id, due_on, title, payload, dedup_key)
  values (k.company_id, 'rappel', 'itv_contracts', k.id, k.client_id, current_date,
          'Résiliation demandée en ligne par ' || c.name || ' : date d''effet à confirmer',
          jsonb_build_object('interne', true, 'lien', '/interventions/contrats?contrat=' || k.id,
            'texte', c.name || ' a demandé la résiliation de son contrat ' || coalesce(nullif(k.label, ''), 'de maintenance')
              || ' le ' || to_char(now() at time zone 'Europe/Paris', 'DD/MM/YYYY à HH24:MI') || ' (accusé de réception ' || v_recu || ').'
              || coalesce(E'\nMotif : ' || nullif(btrim(coalesce(p_motif, '')), ''), '')
              || E'\n\nConfirmez-lui la date d''effet (échéance en cours, ou immédiate s''il n''a pas été informé de la reconduction, article L215-1 du code de la consommation), puis passez le contrat en « Terminé » à cette date.'),
          'resiliation:' || k.id)
  on conflict (company_id, dedup_key) do nothing;
  return jsonb_build_object('deja', false, 'at', now(), 'receipt', v_recu);
end
$$;
revoke all on function public.ent_contrat_resilier(uuid, text) from public, anon;
grant execute on function public.ent_contrat_resilier(uuid, text) to authenticated;

-- Retour arrière (manuel) :
-- drop function if exists public.ent_contrat_resilier(uuid, text); drop function if exists public.ent_contrats();
-- alter table public.itv_contracts drop column if exists termination_receipt, drop column if exists termination_reason,
--   drop column if exists termination_requested_by, drop column if exists termination_requested_at;
