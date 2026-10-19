-- 0384_bascule_rib.sql : bascule vers le réel, émission refusée avec le RIB de démonstration (décision de H du 19/10 au soir).
--
--   Le vrai RIB n'arrivera peut-être pas avant jeudi. Tant que la société porte les coordonnées bancaires de
--   démonstration (BIC commençant par DEMO, ou IBAN d'exemple FR76 3000 6000 0112 3456 7890 189), aucune facture ni
--   facture d'acompte n'est émise : le refus est posé en base, au moment de l'émission (date d'émission renseignée),
--   quel que soit l'écran. Les avoirs restent possibles (ils ne demandent aucun paiement). Le Factur-X est refusé de
--   même par la route serveur. Le contrôle avant émission (billing_missing_mentions) l'affiche comme point bloquant.
--   La numérotation reprend déjà la suite du dernier numéro saisi (billing_settings.invoice_last_number_before, 0360) :
--   rien à changer.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0384_bascule_rib_retour.sql

-- Vrai si les coordonnées bancaires de la société (ou, à défaut, de l'organisme) sont celles de la démonstration
create or replace function app.rib_demo(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with r as (
    select coalesce(nullif(btrim(c.bic), ''), nullif(btrim(o.bic), '')) as bic,
           regexp_replace(upper(coalesce(nullif(btrim(c.iban), ''), nullif(btrim(o.iban), ''), '')), '\s', '', 'g') as iban
    from (select 1) x
    left join public.companies c on c.id = p_company
    left join lateral (select os.bic, os.iban from public.organization_settings os limit 1) o on true
  )
  select coalesce(upper(r.bic) like 'DEMO%', false) or r.iban = 'FR7630006000011234567890189' from r
$$;
revoke all on function app.rib_demo(uuid) from public, anon;
grant execute on function app.rib_demo(uuid) to authenticated, service_role;

-- Refus à l'émission (passage de la date d'émission de vide à renseignée), hors avoirs
create or replace function app.billing_refus_rib_demo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.issued_at is null and new.issued_at is not null and coalesce(new.type, 'invoice') <> 'credit_note'
     and app.rib_demo(new.company_id) then
    raise exception 'Émission impossible : les coordonnées bancaires sont celles de la démonstration. Saisissez le RIB réel de la société (Paramètres › Banque et facturation).'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
revoke all on function app.billing_refus_rib_demo() from public, anon, authenticated;
drop trigger if exists invoices_refus_rib_demo on public.invoices;
create trigger invoices_refus_rib_demo before update of issued_at on public.invoices
  for each row execute function app.billing_refus_rib_demo();

-- Contrôle avant émission : point bloquant affiché à l'écran
create or replace function public.billing_missing_mentions(p_invoice uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
  v_type text;
  v_co uuid;
begin
  /* société (C2) */ perform app.exiger_societe('invoices', p_invoice, false);
  if not app.a_le_droit('facturation.factures.voir') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  v := app.billing_check(p_invoice);
  select i.type, i.company_id into v_type, v_co from public.invoices i where i.id = p_invoice;
  if coalesce(v_type, 'invoice') <> 'credit_note' and app.rib_demo(v_co) then
    v := jsonb_set(v, '{points}', coalesce(v -> 'points', '[]'::jsonb) || jsonb_build_object(
      'code', 'rib_demo', 'libelle', 'RIB réel de la société (les coordonnées bancaires sont celles de la démonstration)',
      'ou', 'parametres', 'bloquant', true));
  end if;
  return v;
end
$$;
revoke all on function public.billing_missing_mentions(uuid) from public, anon;
grant execute on function public.billing_missing_mentions(uuid) to authenticated, service_role;

insert into public.schema_migrations (version) values ('0384_bascule_rib') on conflict (version) do nothing;
