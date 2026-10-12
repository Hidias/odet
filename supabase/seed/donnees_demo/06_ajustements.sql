-- Données de démonstration fictives (généré par generer_donnees_demo.py)
begin;
with c as (select id from invoices where status = 'paid' and due_date between date '2026-10-12' - 40 and date '2026-10-12' - 5 order by due_date desc limit 2)
, d as (delete from invoice_payments where invoice_id in (select id from c) returning invoice_id)
update invoices set status = 'sent', amount_paid = 0, amount_due = total_ttc where id in (select id from c);
commit;
