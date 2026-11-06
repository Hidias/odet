-- 0497 : notification d'une convention signée en ligne (constat du 06/11 sur l'inter d'essai).
-- La convention d'une entreprise inscrite à une session inter est publiée dans l'espace client sous le type
-- « contrat » (C4) ; sa signature en ligne notifiait l'équipe par « Contrat signé en ligne ». Pour le document d'un
-- groupe inter, le titre suit désormais le groupe : « Convention signée en ligne » pour une entreprise, « Contrat
-- signé en ligne » pour un particulier (contrat de formation). Type de notification inchangé (contrat_signe) ; devis,
-- bon d'intervention et autres contrats inchangés. Seul le titre des notifications à venir change.

do $do$
declare
  v_def text := pg_get_functiondef('app.portail_signer_document(uuid,text,uuid,uuid,uuid,text,text,text,text)'::regprocedure);
  a1 text := $a$    case when d.kind = 'devis' then 'Devis signé en ligne' when d.kind = 'rapport' then 'Bon d''intervention signé à distance' else 'Contrat signé en ligne' end,$a$;
  b1 text := $b$    -- Convention d'une entreprise d'une session inter (0497) : titre selon le groupe, le particulier signe un contrat
    case when d.kind = 'devis' then 'Devis signé en ligne' when d.kind = 'rapport' then 'Bon d''intervention signé à distance'
      when d.object_type = 'session_group' and coalesce((select g.kind from public.session_groups g where g.id = d.object_id), '') <> 'particulier'
        then 'Convention signée en ligne'
      else 'Contrat signé en ligne' end,$b$;
begin
  if position('(0497)' in v_def) > 0 then return; end if;
  if position(a1 in v_def) = 0 then
    raise exception 'Fonction portail_signer_document inattendue : rien n''est changé';
  end if;
  execute replace(v_def, a1, b1);
end
$do$;
revoke all on function app.portail_signer_document(uuid, text, uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;

insert into public.schema_migrations (version) values ('0497_notification_convention_signee') on conflict (version) do nothing;
