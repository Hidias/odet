-- Retour arrière de 0443_devis_metier.sql. Idempotent. Les pièces de l'entreprise saisies sont perdues (table retirée) :
-- leurs fichiers restent dans le stockage « documents ».
drop table if exists public.company_papers;
alter table public.billing_settings drop constraint if exists billing_settings_objets_devis_check;
alter table public.billing_settings drop column if exists objets_devis;
alter table public.quote_items drop constraint if exists quote_items_metier_check;
alter table public.quote_items drop column if exists metier;
alter table public.quotes drop constraint if exists quotes_metier_check;
alter table public.quotes drop column if exists metier;
delete from public.schema_migrations where version = '0443_devis_metier';
