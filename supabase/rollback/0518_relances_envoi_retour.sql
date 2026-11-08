-- Retour arrière de 0518 : envoi des relances depuis l'outil retiré. Les relances déjà envoyées par l'outil restent
-- « envoyées » (auteur et date gardés) ; seules la trace de la boîte, l'identifiant du message et la retouche partent.

drop function if exists public.relance_envoi_terminer(uuid, uuid, boolean, text, text, text);
drop function if exists public.relance_envoi_reserver(uuid, text);
drop trigger if exists scheduled_actions_envoi_garde on public.scheduled_actions;
drop function if exists app.scheduled_actions_envoi_garde();

alter table public.scheduled_actions drop column if exists envoi_possible;
alter table public.scheduled_actions drop column if exists envoi_message_id;
alter table public.scheduled_actions drop column if exists envoi_boite;
alter table public.scheduled_actions drop column if exists envoi_reserve_par;
alter table public.scheduled_actions drop column if exists envoi_reserve_at;
alter table public.scheduled_actions drop column if exists texte_retouche;
drop function if exists app.relance_envoyable(text, jsonb);

delete from public.schema_migrations where version = '0518_relances_envoi';
