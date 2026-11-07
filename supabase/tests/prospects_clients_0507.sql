-- Essai de 0507 : une fiche passe « client » au premier devis accepté ou à la première facture émise, jamais l'inverse ;
-- statut « prospect » retiré ; audience des mailings lue par le type. Rouge sans 0507.
-- Données d'essai créées ici (une société existante seulement), tout est annulé.
begin;
set local client_min_messages = warning;

do $$
declare
  v_cie uuid; p1 uuid; p2 uuid; p3 uuid; p4 uuid; opco uuid; v_q uuid; v_f uuid; v_av uuid; v_cs timestamptz;
begin
  select id into v_cie from public.companies limit 1;

  -- 0. Création : prospect par défaut ; statut « prospect » réécrit en « actif » ; type vide refusé en silence
  insert into public.clients (name, company_id, status, contact_email) values ('ESSAI 0507 UN', v_cie, 'prospect', 'un.0507@example.invalid') returning id into p1;
  insert into public.clients (name, company_id, type) values ('ESSAI 0507 DEUX', v_cie, null) returning id into p2;
  insert into public.clients (name, company_id) values ('ESSAI 0507 TROIS', v_cie) returning id into p3;
  insert into public.clients (name, company_id) values ('ESSAI 0507 QUATRE', v_cie) returning id into p4;
  insert into public.clients (name, company_id, client_type) values ('ESSAI 0507 OPCO', v_cie, 'opco') returning id into opco;
  if (select status from public.clients where id = p1) <> 'actif' then raise exception '0. statut « prospect » gardé'; end if;
  if (select count(*) from public.clients where id in (p1, p2, p3, p4, opco) and type = 'prospect' and client_since is null) <> 5 then
    raise exception '0. fiches nouvelles pas toutes « prospect »'; end if;
  update public.clients set status = 'prospect' where id = p1;
  if (select status from public.clients where id = p1) <> 'actif' then raise exception '0. statut « prospect » remis par une mise à jour'; end if;

  -- 1. Devis envoyé : toujours prospect ; accepté : client, avec sa date
  insert into public.quotes (reference, client_id, company_id, status, object) values ('ESSAI-0507-1', p1, v_cie, 'sent', 'Formation') returning id into v_q;
  if (select type from public.clients where id = p1) <> 'prospect' then raise exception '1. client dès un devis envoyé'; end if;
  update public.quotes set status = 'accepted' where id = v_q;
  if (select type from public.clients where id = p1) <> 'client' then raise exception '1. devis accepté sans passage en client'; end if;
  select client_since into v_cs from public.clients where id = p1;
  if v_cs is null then raise exception '1. date de passage absente'; end if;

  -- 2. Jamais de retour en prospect, date gardée ; devis refusé ensuite sans effet
  update public.clients set type = 'prospect', client_since = null where id = p1;
  if (select type from public.clients where id = p1) <> 'client' then raise exception '2. client redevenu prospect'; end if;
  update public.quotes set status = 'refused' where id = v_q;
  if (select type from public.clients where id = p1) <> 'client' then raise exception '2. client perdu par un devis refusé'; end if;

  -- 3. Devis accepté en partie dès sa création
  insert into public.quotes (reference, client_id, company_id, status, object) values ('ESSAI-0507-2', p2, v_cie, 'partial', 'Formation');
  if (select type from public.clients where id = p2) <> 'client' then raise exception '3. devis partiel sans passage en client'; end if;

  -- 4. Facture : brouillon sans effet ; émise : client et client facturé ; avoir émis sans effet
  alter table public.invoices disable trigger invoices_verrou_creation, disable trigger invoices_verrou,
    disable trigger invoices_verrou_rib_demo, disable trigger invoices_siret_garde, disable trigger invoices_circuit_emis;
  insert into public.invoices (reference, type, client_id, billing_client_id, company_id, status, total_ht, total_net_ht, invoice_date)
    values ('ESSAI-0507-F1', 'invoice', p3, opco, v_cie, 'draft', 100, 100, current_date) returning id into v_f;
  if exists (select 1 from public.clients where id in (p3, opco) and type <> 'prospect') then raise exception '4. client dès un brouillon'; end if;
  update public.invoices set issued_at = now(), status = 'sent' where id = v_f;
  if (select count(*) from public.clients where id in (p3, opco) and type = 'client' and client_since is not null) <> 2 then
    raise exception '4. facture émise sans passage en client (client ou client facturé)'; end if;
  insert into public.invoices (reference, type, client_id, company_id, status, total_ht, total_net_ht, invoice_date, issued_at)
    values ('ESSAI-0507-AV', 'credit_note', p4, v_cie, 'sent', 10, 10, current_date, now()) returning id into v_av;
  if (select type from public.clients where id = p4) <> 'prospect' then raise exception '4. client par un avoir seul'; end if;

  -- 5. Audience des mailings : l'adresse d'une fiche cliente est « client », celle d'un prospect « crm »
  update public.clients set contact_email = 'quatre.0507@example.invalid' where id = p4;
  if not (select 'client' = any (source_types) from public.mailing_audience_v where email = 'un.0507@example.invalid') then
    raise exception '5. fiche cliente non comptée « client » au mailing'; end if;
  if (select 'client' = any (source_types) or not ('crm' = any (source_types)) from public.mailing_audience_v where email = 'quatre.0507@example.invalid') then
    raise exception '5. prospect compté « client » au mailing'; end if;
end
$$;

rollback;
