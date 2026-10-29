-- 0466 : contrat signé, le délai de dépannage promis et ce que le contrat comprend sont figés (relecture de #244).
-- Ils changent la facturation et l'engagement envers le client : après signature, ils ne changent plus que par un
-- avenant, comme le prix, la durée et la facturation. Corps de app.contrat_signe_fige repris de 0462 à l'identique,
-- deux conditions ajoutées (emergency_hours, includes).
-- Retour arrière : réappliquer la définition de 0462.

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

