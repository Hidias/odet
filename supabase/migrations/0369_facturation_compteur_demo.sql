-- 0369_facturation_compteur_demo.sql : compteur des numéros pendant la démonstration (Facturation fiable).
--
-- Décision de H (19/10) : le dernier numéro réel de GLD n'est pas encore connu et changera d'ici la mise en service.
-- Tant que l'organisme est en mode démonstration, le super administrateur peut remettre le compteur à zéro
-- (billing_counter_reset), même après des émissions de test ; le réglage « dernier numéro avant l'outil » redevient
-- alors modifiable. Hors mode démonstration, refusé : le compteur réel ne recule jamais.
-- Aucune nouvelle table, aucun verrou modifié. Idempotente.
-- Retour arrière : supabase/rollback/0369_facturation_compteur_demo_retour.sql

create or replace function public.billing_counter_reset()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := app.billing_company();
  v_n int;
begin
  if not app.a_le_droit('plateforme.administrer') then
    raise exception 'Réservé au super administrateur' using errcode = '42501';
  end if;
  if not coalesce((select o.demo_mode from public.organization_settings o limit 1), false) then
    raise exception 'Hors mode démonstration, le compteur des numéros ne se remet jamais à zéro' using errcode = '42501';
  end if;
  delete from public.billing_sequences where company_id = v_company;
  get diagnostics v_n = row_count;
  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_name, details)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'update', 'system',
          'Compteur des factures remis à zéro (démonstration)', jsonb_build_object('company_id', v_company, 'series', v_n));
  return v_n > 0;
end
$$;

revoke all on function public.billing_counter_reset() from public, anon;
grant execute on function public.billing_counter_reset() to authenticated;

insert into public.schema_migrations (version) values ('0369_facturation_compteur_demo') on conflict (version) do nothing;
