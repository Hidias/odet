-- 0039_comptable_parametres_organisme.sql : les coordonnées du comptable rejoignent les paramètres de l'organisme.
--
-- La table org_settings répétait l'identité de l'organisme (nom, SIRET, NDA, adresse...) déjà tenue dans
-- organization_settings, uniquement pour porter les coordonnées du cabinet comptable. Ces coordonnées sont
-- désormais des colonnes d'organization_settings (même règle d'accès : utilisateurs connectés).
-- org_settings n'est plus lue ni modifiée ; elle reste en base, intacte, pour mémoire.

alter table public.organization_settings
  add column if not exists comptable_name text,
  add column if not exists comptable_cabinet text,
  add column if not exists comptable_email text,
  add column if not exists comptable_cc text,
  add column if not exists comptable_bcc text;

-- Reprise d'une éventuelle saisie antérieure (sans écraser une valeur déjà présente)
update public.organization_settings o
   set comptable_name = coalesce(o.comptable_name, s.comptable_name),
       comptable_cabinet = coalesce(o.comptable_cabinet, s.comptable_cabinet),
       comptable_email = coalesce(o.comptable_email, s.comptable_email),
       comptable_cc = coalesce(o.comptable_cc, s.comptable_cc),
       comptable_bcc = coalesce(o.comptable_bcc, s.comptable_bcc)
  from (select * from public.org_settings order by updated_at desc nulls last limit 1) s;

insert into public.schema_migrations (version) values ('0039_comptable_parametres_organisme') on conflict (version) do nothing;
