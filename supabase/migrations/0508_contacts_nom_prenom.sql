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
--      client_to_primary_contact) l'emporte quand il désigne une autre personne (autres mots) : nom et prénom séparés sont
--      vidés, pour ne jamais garder deux noms différents. Le même nom renvoyé dans un autre ordre ou une autre casse (« Paul
--      Durand » d'une fiche client pas encore rechargée, d'une inscription, d'un écran) ne vide rien : le nom est recalculé
--      (app.memes_mots).
--   6. Espaces insécables (copier-coller, import) traités comme des espaces (app.espaces_nom).
--   7. Les contacts qui ont déjà nom ou prénom séparés sont recalculés ici (le principal est recopié sur sa fiche client).
-- Le déclencheur s'exécute avant client_contact_to_client (après), qui recopie donc le nom remis en forme sur la fiche client.

create or replace function app.espaces_nom(p text) returns text
  language sql immutable set search_path = pg_catalog as
$$ select btrim(regexp_replace(coalesce(p, ''), '[\s\u00a0]+', ' ', 'g')) $$;

create or replace function app.nom_majuscules(p text) returns text
  language sql immutable set search_path = pg_catalog as
$$ select nullif(upper(app.espaces_nom(p)), '') $$;

create or replace function app.prenom_forme(p text) returns text
  language plpgsql immutable set search_path = pg_catalog as
$$
declare
  s text := lower(app.espaces_nom(p));
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

-- Mêmes mots, sans tenir compte de l'ordre ni de la casse : « Paul Durand » et « DURAND Paul »
create or replace function app.memes_mots(a text, b text) returns boolean
  language sql immutable set search_path = pg_catalog as
$$ select coalesce((select array_agg(x order by x) from regexp_split_to_table(lower(app.espaces_nom(a)), ' ') x where x <> '')
                 = (select array_agg(x order by x) from regexp_split_to_table(lower(app.espaces_nom(b)), ' ') x where x <> ''), false) $$;

create or replace function app.contact_nom_prenom() returns trigger
  language plpgsql set search_path = pg_catalog, public as
$$
begin
  if tg_op = 'UPDATE'
     and new.name is distinct from old.name
     and new.last_name is not distinct from old.last_name
     and new.first_name is not distinct from old.first_name
     and coalesce(old.last_name, old.first_name) is not null
     and not app.memes_mots(new.name, concat_ws(' ', old.last_name, old.first_name)) then
    -- Règle 5 : nom libre d'une autre personne écrit seul, il l'emporte
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

-- Règle 7 : recalcul des contacts déjà séparés (mise à jour sans changement de nom : recalcul, recopie sur la fiche)
update public.client_contacts set last_name = last_name where coalesce(last_name, first_name) is not null;

insert into public.schema_migrations (version) values ('0508_contacts_nom_prenom') on conflict (version) do nothing;
