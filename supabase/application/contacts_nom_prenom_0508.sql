-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (contacts_nom_prenom_0508) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0508_contacts_nom_prenom.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0508_contacts_nom_prenom_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0508_contacts_nom_prenom.sql =====
-- 0508 : contacts des fiches clients en « NOM Prénom » (demande de H du 07/11, décisions du 07/11 dans la nuit, V36).
-- Règle commune, écrite une seule fois ici et reprise à l'identique côté écran par src/core/nomPersonne.js :
--   1. Nom de famille en majuscules, particules comprises (« LE RÉGENT ») : app.nom_majuscules.
--   2. Prénom avec une majuscule au début de chaque partie, prénoms composés compris (« Jean-Pierre », « Marie Claire ») :
--      app.prenom_forme. Espaces en trop retirés dans les deux.
--   3. Nom affiché (client_contacts.name, lu par tous les écrans, PDF et e-mails) : « NOM Prénom », ou le seul élément connu
--      (« MARTIN » pour « Mme Martin », la civilité restant dans sa colonne) : app.contact_nom_affiche.
--   4. Un contact sans nom ni prénom séparés garde son nom libre (« Contact général », contact créé depuis la fiche client par
--      client_to_primary_contact) : rien n'est deviné en base.
--   5. Un nom libre écrit seul sur un contact qui avait nom et prénom séparés (champ « contact » de la fiche client, recopié par
--      client_to_primary_contact) l'emporte : nom et prénom séparés sont vidés, pour ne jamais garder deux noms différents.
-- Le déclencheur s'exécute avant client_contact_to_client (après), qui recopie donc le nom remis en forme sur la fiche client.

create or replace function app.nom_majuscules(p text) returns text
  language sql immutable set search_path = pg_catalog as
$$ select nullif(upper(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g')), '') $$;

create or replace function app.prenom_forme(p text) returns text
  language plpgsql immutable set search_path = pg_catalog as
$$
declare
  s text := lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'));
  r text := '';
  prec text := ' ';
  ch text;
begin
  if s = '' then return null; end if;
  for i in 1 .. length(s) loop
    ch := substr(s, i, 1);
    r := r || case when prec in (' ', '-') then upper(ch) else ch end;
    prec := ch;
  end loop;
  return r;
end
$$;

create or replace function app.contact_nom_affiche(p_nom text, p_prenom text) returns text
  language sql immutable set search_path = pg_catalog as
$$ select nullif(concat_ws(' ', app.nom_majuscules(p_nom), app.prenom_forme(p_prenom)), '') $$;

create or replace function app.contact_nom_prenom() returns trigger
  language plpgsql set search_path = pg_catalog, public as
$$
begin
  if tg_op = 'UPDATE'
     and new.name is distinct from old.name
     and new.last_name is not distinct from old.last_name
     and new.first_name is not distinct from old.first_name
     and coalesce(old.last_name, old.first_name) is not null then
    -- Règle 5 : nom libre écrit seul, il l'emporte
    new.last_name := null;
    new.first_name := null;
    return new;
  end if;
  new.last_name := app.nom_majuscules(new.last_name);
  new.first_name := app.prenom_forme(new.first_name);
  if coalesce(new.last_name, new.first_name) is not null then
    new.name := app.contact_nom_affiche(new.last_name, new.first_name);
  end if;
  return new;
end
$$;

revoke all on function app.contact_nom_prenom() from public;

drop trigger if exists client_contacts_nom on public.client_contacts;
create trigger client_contacts_nom before insert or update on public.client_contacts
  for each row execute function app.contact_nom_prenom();

insert into public.schema_migrations (version) values ('0508_contacts_nom_prenom') on conflict (version) do nothing;
