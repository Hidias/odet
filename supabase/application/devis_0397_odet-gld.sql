-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (devis_0397) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur odet-gld : 0397_devis_financement.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0397_devis_financement_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0397_devis_financement.sql =====
-- 0397 : financement prévu dans le devis (décision de H du 21/10).
-- Le financeur se décidait sur la session, une fois le devis signé ; or la fin de la subrogation OPCO au 1er octobre
-- 2026 change le circuit de paiement (facture TTC à l'entreprise, remboursement HT par l'OPCO), et le client doit le
-- savoir dès le devis. Le devis porte donc le financement prévu, repris tel quel par la session créée depuis le devis.
-- Champs facultatifs : un devis sans financement reste valable. Idempotent.

alter table public.quotes add column if not exists funding_type text;
alter table public.quotes add column if not exists funding_client_id uuid references public.clients(id) on delete set null;
alter table public.quotes add column if not exists funding_name text;
alter table public.quotes add column if not exists funding_agreement_ref text;
alter table public.quotes add column if not exists funding_agreement_date date;
alter table public.quotes add column if not exists funding_subrogation boolean not null default false;
alter table public.quotes add column if not exists funding_amount_ht numeric;

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'quotes_funding_type_check') then
    alter table public.quotes add constraint quotes_funding_type_check
      check (funding_type is null or funding_type in ('opco', 'cpf', 'france_travail', 'region', 'autre'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quotes_funding_amount_check') then
    alter table public.quotes add constraint quotes_funding_amount_check
      check (funding_amount_ht is null or funding_amount_ht >= 0);
  end if;
end
$c$;

comment on column public.quotes.funding_type is 'Financement prévu : opco, cpf, france_travail, region, autre (vide = l''entreprise paie)';
comment on column public.quotes.funding_subrogation is 'Subrogation demandée : le financeur paie l''organisme directement (après le 01/10/2026, seulement apprentissage ou moins de 50 salariés sur demande)';

insert into public.schema_migrations (version) values ('0397_devis_financement') on conflict (version) do nothing;
