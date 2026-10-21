-- Retour arrière de 0430_circuit_participants.sql : déclencheurs et fonctions retirés, colonnes retirées. Les sessions,
-- stagiaires et notifications créés entre-temps restent (données réelles). Idempotent.
drop trigger if exists quotes_signe_sessions on public.quotes;
drop trigger if exists sessions_convention_convocations on public.sessions;
drop function if exists app.devis_signe_sessions();
drop function if exists app.convention_signee_convocations();
drop function if exists app.devis_prepare_sessions(uuid);
drop function if exists public.session_preparee_valider(uuid);
drop function if exists public.client_portal_participants(text, text);
drop function if exists public.client_portal_participants_enregistrer(text, text, uuid, jsonb);
drop function if exists public.ent_participants();
drop function if exists public.ent_participants_enregistrer(uuid, jsonb);
drop function if exists app.participants_enregistrer(uuid, text, uuid, uuid, uuid, jsonb);
drop function if exists app.participants_etat(uuid);
drop function if exists app.date_fr_du_texte(text);
-- Journal du portail figé : l'ancienne liste d'événements n'est remise que si aucun événement nouveau n'y figure
do $r$
begin
  if not exists (select 1 from public.portal_events where event in ('participants', 'depot')) then
    alter table public.portal_events drop constraint if exists portal_events_event_check;
    alter table public.portal_events add constraint portal_events_event_check check ((event = any (array['connexion'::text, 'document'::text, 'signature'::text])));
  end if;
end
$r$;
alter table public.sessions drop column if exists participants_saisis_le;
alter table public.sessions drop column if exists validation_requise;
delete from public.schema_migrations where version = '0430_circuit_participants';
