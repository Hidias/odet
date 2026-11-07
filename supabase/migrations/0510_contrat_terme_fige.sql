-- 0510 : contrat signé, le moment de facturation (billing_term : à échoir ou à terme échu) est figé lui aussi.
-- Il change les dates de chaque facture de l'échéancier : après signature, il ne change plus que par un avenant, comme le
-- prix, la durée, la périodicité, le délai de dépannage et ce que le contrat comprend (0466). L'écran ne l'envoyait déjà
-- plus pour un contrat signé (Contrats.jsx) ; la base le refuse maintenant aussi. Corps de app.contrat_signe_fige repris
-- de 0466 ; ajouts : moment des factures, nom de l'indice et mois de la valeur de référence figés (ils sont imprimés sur
-- le contrat signé), moment des factures vide fixé à la signature selon la règle par défaut ; contrainte : une valeur de
-- référence va avec le nom ou l'identifiant de l'indice et son mois.
-- Retour arrière : supabase/rollback/0510_contrat_terme_fige_retour.sql (définition de 0466).

CREATE OR REPLACE FUNCTION app.contrat_signe_fige()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_revision boolean := coalesce(current_setting('app.revision_prix', true), '') = 'oui';
begin
  if old.signed_at is not null and (
       (new.annual_price_ht is distinct from old.annual_price_ht and not v_revision) or new.duration_years is distinct from old.duration_years
    or new.tacit_renewal is distinct from old.tacit_renewal or new.renewal_years is distinct from old.renewal_years
    or new.notice_months is distinct from old.notice_months or new.billing_period is distinct from old.billing_period
    or new.start_on is distinct from old.start_on or new.client_id is distinct from old.client_id
    or new.signed_at is distinct from old.signed_at or new.signed_name is distinct from old.signed_name
    or new.signature_id is distinct from old.signature_id or new.base_price_ht is distinct from old.base_price_ht
    or new.index_base_value is distinct from old.index_base_value or new.index_series is distinct from old.index_series
    or new.emergency_hours is distinct from old.emergency_hours or new.includes is distinct from old.includes
    or new.billing_term is distinct from old.billing_term
    or new.index_label is distinct from old.index_label or new.index_base_month is distinct from old.index_base_month) then
    raise exception 'Contrat signé : ses conditions se changent par un avenant' using errcode = '42501';
  end if;
  -- À la signature, le moment des factures vide prend la règle par défaut du moment (0461 : client public après la
  -- période, sinon au début) et ne change plus, même si le type du client change ensuite
  if old.signed_at is null and new.signed_at is not null and new.billing_term is null then
    new.billing_term := case when (select c.client_type from public.clients c where c.id = new.client_id) = 'public' then 'echu' else 'echoir' end;
  end if;
  return new;
end
$function$;

-- Clause de révision imprimée sur le contrat (relecture de 0510) : une valeur de référence ne va pas sans l'indice
-- qu'elle désigne (nom ou identifiant INSEE) ni le mois de sa publication. 0 contrat en production le 08/11.
alter table public.itv_contracts drop constraint if exists itv_contracts_indice_complet;
alter table public.itv_contracts add constraint itv_contracts_indice_complet
  check (index_base_value is null or (coalesce(nullif(btrim(index_label), ''), nullif(btrim(index_series), '')) is not null and index_base_month is not null));

insert into public.schema_migrations (version) values ('0510_contrat_terme_fige') on conflict (version) do nothing;
