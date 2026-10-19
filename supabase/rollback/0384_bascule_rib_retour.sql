-- Retour arrière de 0384_bascule_rib.sql : retire le refus d'émission avec le RIB de démonstration et remet le
-- contrôle avant émission de 0363. Idempotent.

drop trigger if exists invoices_verrou_rib_demo on public.invoices;
drop function if exists app.billing_refus_rib_demo();

create or replace function public.billing_missing_mentions(p_invoice uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  /* société (C2) */ perform app.exiger_societe('invoices', p_invoice, false);
  if not app.a_le_droit('facturation.factures.voir') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  return app.billing_check(p_invoice);
end
$$;
revoke all on function public.billing_missing_mentions(uuid) from public, anon;
grant execute on function public.billing_missing_mentions(uuid) to authenticated, service_role;

drop function if exists app.rib_demo(uuid);

delete from public.schema_migrations where version = '0384_bascule_rib';
