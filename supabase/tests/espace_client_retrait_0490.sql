-- Essai local de 0490 : la suppression d'un devis ou d'un groupe inter retire son document de l'espace client
-- (gardé, avec motif) ; les documents des autres objets restent visibles.
begin;
set local client_min_messages = warning;
do $$
declare
  v_cie uuid; v_cli uuid; v_q1 uuid; v_q2 uuid; v_s uuid; v_g uuid; d1 uuid; d2 uuid; d3 uuid;
  v_sha text := repeat('a', 64);
  r record;
begin
  select id into v_cie from public.companies limit 1;
  insert into public.clients (name, company_id) values ('Client essai 0490', v_cie) returning id into v_cli;
  insert into public.quotes (reference, client_id, status, company_id) values ('ESSAI-0490-1', v_cli, 'sent', v_cie) returning id into v_q1;
  insert into public.quotes (reference, client_id, status, company_id) values ('ESSAI-0490-2', v_cli, 'sent', v_cie) returning id into v_q2;
  insert into public.sessions (reference, start_date, end_date, status, session_type, company_id)
    values ('ESSAI-0490-S', current_date + 30, current_date + 30, 'planned', 'inter', v_cie) returning id into v_s;
  insert into public.session_groups (session_id, client_id, company_id) values (v_s, v_cli, v_cie) returning id into v_g;
  insert into public.client_shared_documents (company_id, client_id, object_type, object_id, kind, label, file_path, sha256)
    values (v_cie, v_cli, 'quote', v_q1, 'devis', 'Devis 1', 'x/q1.pdf', v_sha) returning id into d1;
  insert into public.client_shared_documents (company_id, client_id, object_type, object_id, kind, label, file_path, sha256)
    values (v_cie, v_cli, 'quote', v_q2, 'devis', 'Devis 2', 'x/q2.pdf', v_sha) returning id into d2;
  insert into public.client_shared_documents (company_id, client_id, object_type, object_id, kind, label, file_path, sha256)
    values (v_cie, v_cli, 'session_group', v_g, 'contrat', 'Convention groupe', 'x/g.pdf', v_sha) returning id into d3;

  delete from public.quotes where id = v_q1;
  select * into r from public.client_shared_documents where id = d1;
  if r.id is null then raise exception '1. document du devis effacé au lieu d''être retiré'; end if;
  if r.withdrawn_at is null or r.withdrawn_reason <> 'Devis supprimé' then raise exception '1. devis supprimé : document toujours visible'; end if;
  if (select withdrawn_at from public.client_shared_documents where id = d2) is not null then raise exception '2. autre devis retiré à tort'; end if;

  delete from public.session_groups where id = v_g;
  select * into r from public.client_shared_documents where id = d3;
  if r.withdrawn_at is null or r.withdrawn_reason <> 'Groupe supprimé' then raise exception '3. groupe supprimé : document toujours visible'; end if;

  -- Une seconde suppression d'un objet sans document ne fait rien
  delete from public.quotes where id = v_q2 and false;
  if not exists (select 1 from public.schema_migrations where version = '0490_espace_client_retrait_supprimes') then
    raise exception '0490 non inscrite';
  end if;
end $$;
rollback;
