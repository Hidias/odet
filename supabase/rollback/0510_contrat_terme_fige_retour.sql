-- Retour arrière de 0510 : app.contrat_signe_fige remise à la définition de 0466 (moment de facturation de nouveau
-- modifiable par la base sur un contrat signé ; l'écran ne l'envoie toujours pas), contrainte de l'indice retirée. Un
-- moment des factures fixé à la signature reste écrit (même valeur que la règle par défaut à ce moment).

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
    or new.emergency_hours is distinct from old.emergency_hours or new.includes is distinct from old.includes) then
    raise exception 'Contrat signé : ses conditions se changent par un avenant' using errcode = '42501';
  end if;
  return new;
end
$function$;

alter table public.itv_contracts drop constraint if exists itv_contracts_indice_complet;

delete from public.schema_migrations where version = '0510_contrat_terme_fige';
