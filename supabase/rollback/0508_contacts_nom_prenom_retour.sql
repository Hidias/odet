-- Retour arrière de 0508 (contacts en « NOM Prénom »). Les noms déjà remis en forme le restent (sans effet sans 0508).
drop trigger if exists client_contacts_nom on public.client_contacts;
drop function if exists app.contact_nom_prenom();
drop function if exists app.contact_nom_affiche(text, text);
drop function if exists app.prenom_forme(text);
drop function if exists app.nom_majuscules(text);
delete from public.schema_migrations where version = '0508_contacts_nom_prenom';
