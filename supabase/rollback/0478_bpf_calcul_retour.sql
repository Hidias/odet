-- Retour arrière de 0478 : remet le calcul du BPF de 0477 et la livraison de 0468, retire la garde des déclarations.
-- À lancer dans cet ordre, dans une même transaction :
--   1. ce fichier ;
--   2. la section « 5. Calcul » de supabase/migrations/0477_bpf_donnees.sql (fonction bpf_calculer et ses droits) ;
--   3. la section « 2. Préparation de la livraison » de supabase/migrations/0468_vente_relecture.sql.
drop trigger if exists bpf_declarations_garde on public.bpf_declarations;
drop function if exists app.bpf_declaration_garde();
delete from public.schema_migrations where version = '0478_bpf_calcul';
