-- Retour arrière de 0497 : titre de notification d'origine (« Contrat signé en ligne » pour tout contrat). Les
-- notifications déjà écrites gardent leur titre.

do $do$
declare
  v_def text := pg_get_functiondef('app.portail_signer_document(uuid,text,uuid,uuid,uuid,text,text,text,text)'::regprocedure);
  a1 text := $a$    -- Convention d'une entreprise d'une session inter (0497) : titre selon le groupe, le particulier signe un contrat
    case when d.kind = 'devis' then 'Devis signé en ligne' when d.kind = 'rapport' then 'Bon d''intervention signé à distance'
      when d.object_type = 'session_group' and coalesce((select g.kind from public.session_groups g where g.id = d.object_id), '') <> 'particulier'
        then 'Convention signée en ligne'
      else 'Contrat signé en ligne' end,$a$;
  b1 text := $b$    case when d.kind = 'devis' then 'Devis signé en ligne' when d.kind = 'rapport' then 'Bon d''intervention signé à distance' else 'Contrat signé en ligne' end,$b$;
begin
  if position(a1 in v_def) = 0 then return; end if;
  execute replace(v_def, a1, b1);
end
$do$;
revoke all on function app.portail_signer_document(uuid, text, uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;

delete from public.schema_migrations where version = '0497_notification_convention_signee';
