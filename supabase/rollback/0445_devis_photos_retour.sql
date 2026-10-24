-- Retour arrière de 0445_devis_photos.sql. Idempotent. Les fichiers déposés restent dans le stockage « documents ».
drop policy if exists odet_documents_articles_supprimer on storage.objects;
drop policy if exists odet_documents_articles_creer on storage.objects;
drop policy if exists odet_documents_articles_lire on storage.objects;
drop function if exists public.devis_articles();
drop index if exists public.quote_items_stock_item_idx;
alter table public.quote_items drop constraint if exists quote_items_photo_0445_check;
alter table public.quote_items drop column if exists show_photo;
alter table public.quote_items drop column if exists photo_path;
alter table public.quote_items drop column if exists stock_item_id;
alter table public.stock_items drop constraint if exists stock_items_fichiers_0445_check;
alter table public.stock_items drop column if exists eco_ht;
alter table public.stock_items drop column if exists fiche_technique_path;
alter table public.stock_items drop column if exists photo_path;
delete from public.schema_migrations where version = '0445_devis_photos';
