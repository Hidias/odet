-- Retour arrière de 0044_inter_groupes.sql : retire les colonnes des groupes inter, la garde des paiements d'un
-- particulier et les demandes d'inscription. Idempotent.
-- Refusé si des données y ont été saisies (payeur, document, rétractation, demande, numéro CPF, facture d'un groupe).

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'session_groups' and column_name = 'retractation_end') then
    if exists (select 1 from public.session_groups where site_id is not null or payer_kind is not null or payer_client_id is not null
                 or dossier_number is not null or doc_status <> 'a_envoyer' or doc_signed_path is not null or retractation_end is not null
                 or source <> 'back_office' or invoice_id is not null)
       or exists (select 1 from public.inter_requests)
       or exists (select 1 from public.session_trainees where cpf_dossier_number is not null)
       or exists (select 1 from public.session_fundings where group_id is not null)
       or exists (select 1 from public.invoices where session_group_id is not null) then
      raise exception 'Retour arrière refusé : des groupes inter ou des demandes ont été saisis';
    end if;
  end if;
end $$;

drop trigger if exists invoice_payments_particulier on public.invoice_payments;
drop trigger if exists invoices_lien_groupe on public.invoices;
drop trigger if exists session_groups_maj on public.session_groups;
drop function if exists app.paiement_particulier_garde();
drop function if exists app.invoice_lien_groupe();
drop function if exists app.session_group_maj();
drop table if exists public.inter_requests;
drop function if exists app.inter_request_maj();

drop index if exists public.session_trainees_group_idx;
drop index if exists public.invoices_session_group_idx;
alter table public.invoices drop column if exists session_group_id;
alter table public.session_fundings drop column if exists group_id;
alter table public.session_trainees drop column if exists cpf_dossier_number;
alter table public.session_groups drop constraint if exists session_groups_kind_check;
alter table public.session_groups drop constraint if exists session_groups_payer_check;
alter table public.session_groups drop constraint if exists session_groups_doc_check;
alter table public.session_groups drop constraint if exists session_groups_source_check;
alter table public.session_groups drop column if exists invoice_id;
alter table public.session_groups drop column if exists source;
alter table public.session_groups drop column if exists retractation_end;
alter table public.session_groups drop column if exists doc_signed_path;
alter table public.session_groups drop column if exists doc_signed_at;
alter table public.session_groups drop column if exists doc_sent_at;
alter table public.session_groups drop column if exists doc_status;
alter table public.session_groups drop column if exists dossier_number;
alter table public.session_groups drop column if exists payer_client_id;
alter table public.session_groups drop column if exists payer_kind;
alter table public.session_groups drop column if exists site_id;
alter table public.session_groups drop column if exists kind;

delete from public.schema_migrations where version = '0044_inter_groupes';
