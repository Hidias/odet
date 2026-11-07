-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (c1_0510) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0510_contrat_terme_fige.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0510_contrat_terme_fige_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0510_contrat_terme_fige.sql =====
-- 0510 : contrat signé, le moment de facturation (billing_term : à échoir ou à terme échu) est figé lui aussi.
-- Il change les dates de chaque facture de l'échéancier : après signature, il ne change plus que par un avenant, comme le
-- prix, la durée, la périodicité, le délai de dépannage et ce que le contrat comprend (0466). L'écran ne l'envoyait déjà
-- plus pour un contrat signé (Contrats.jsx) ; la base le refuse maintenant aussi. Corps de app.contrat_signe_fige repris
-- de 0466 à l'identique, une condition ajoutée.
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
    or new.billing_term is distinct from old.billing_term) then
    raise exception 'Contrat signé : ses conditions se changent par un avenant' using errcode = '42501';
  end if;
  return new;
end
$function$;

insert into public.schema_migrations (version) values ('0510_contrat_terme_fige') on conflict (version) do nothing;
