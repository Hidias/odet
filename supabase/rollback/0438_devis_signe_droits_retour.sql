-- Retour arrière de 0438_devis_signe_droits.sql (rétablit l'erreur de droits : à n'utiliser qu'avec le retour de 0435)
alter function app.devis_signe_fige() security invoker;
alter function app.lignes_devis_signe_figees() security invoker;
delete from public.schema_migrations where version = '0438_devis_signe_droits';
