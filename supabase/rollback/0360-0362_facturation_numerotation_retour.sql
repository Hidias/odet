-- Retour arrière de 0360, 0361 et 0362 (numérotation par la base, émission, verrou). Idempotent.
-- Les factures émises gardent leur numéro ; les brouillons créés entre-temps gardent leur référence « BROUILLON-… ».
-- Les dates d'émission et les coordonnées figées sont perdues (colonnes retirées). Revenir aussi au code d'avant.

drop trigger if exists invoices_verrou_creation on public.invoices;
drop trigger if exists invoices_verrou on public.invoices;
drop trigger if exists invoice_items_verrou on public.invoice_items;
drop function if exists app.invoices_verrou();
drop function if exists app.invoice_items_verrou();

drop function if exists public.billing_issue(uuid);
drop function if exists public.billing_next_number(text);
drop function if exists public.billing_compute_totals(uuid);
drop function if exists app.billing_format(text, text, date, bigint);
drop function if exists app.billing_company();

alter table public.invoices drop column if exists issued_at;
alter table public.invoices drop column if exists issued_by;
alter table public.invoices drop column if exists seller_snapshot;
alter table public.invoices drop column if exists buyer_snapshot;

drop table if exists public.billing_sequences;
drop table if exists public.billing_settings;

delete from public.schema_migrations
where version in ('0360_facturation_reglages', '0361_facturation_emission', '0362_facturation_verrou');
