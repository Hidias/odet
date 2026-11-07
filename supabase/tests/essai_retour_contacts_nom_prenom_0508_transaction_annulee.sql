-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (contacts_nom_prenom_0508) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0508_contacts_nom_prenom.sql, retour arrière,
-- comparaison. Se termine TOUJOURS par l'erreur volontaire « RÉSULTAT DE L'ESSAI DU RETOUR ARRIÈRE » : tout est annulé.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

create temp view etat_essai as
  select 'règle' as kind, schemaname || '.' || tablename || '.' || policyname as name,
         md5(concat_ws('|', permissive, roles::text, cmd, qual, with_check)) as v
  from pg_policies where schemaname in ('public', 'storage')
  union all
  select 'fonction', p.oid::regprocedure::text,
         md5(concat_ws('|', pg_get_functiondef(p.oid), p.prosecdef::text, p.proconfig::text,
             (select string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',' order by a.grantee::regrole::text, a.privilege_type)
              from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a)))
  from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace) and p.prokind in ('f', 'p')
  union all
  select 'droits table', c.oid::regclass::text,
         md5(coalesce((select string_agg(a.grantee::regrole::text || ':' || a.privilege_type || ':' || a.is_grantable::text, ','
                               order by a.grantee::regrole::text, a.privilege_type)
                       from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a), '') || c.relrowsecurity::text)
  from pg_class c where c.relnamespace in ('public'::regnamespace, 'app'::regnamespace) and c.relkind in ('r', 'v', 'm', 'p')
  union all
  select 'vue', c.oid::regclass::text, md5(pg_get_viewdef(c.oid) || coalesce(c.reloptions::text, ''))
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
  union all
  select 'colonne', table_schema || '.' || table_name || '.' || column_name, md5(data_type || is_nullable || coalesce(column_default, ''))
  from information_schema.columns where table_schema in ('public', 'app')
  union all
  select 'contrainte', conrelid::regclass::text || '.' || conname, md5(pg_get_constraintdef(oid))
  from pg_constraint where connamespace in ('public'::regnamespace, 'app'::regnamespace)
  union all
  select 'index', indexrelid::regclass::text, md5(pg_get_indexdef(indexrelid))
  from pg_index where indrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace, 'app'::regnamespace))
  union all
  select 'déclencheur', tgrelid::regclass::text || '.' || tgname, md5(tgfoid::regprocedure::text || tgenabled::text)
  from pg_trigger where not tgisinternal
    and tgrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace, 'app'::regnamespace))
  union all
  select 'migrations', 'public.schema_migrations', md5(coalesce(string_agg(version, ',' order by version), ''))
  from public.schema_migrations
  union all
  select 'données', 'organization_settings', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.organization_settings t
  union all
  select 'données', 'profiles', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.profiles t
  union all
  select 'données', 'org_modules', md5(coalesce(string_agg(t::text, ',' order by t.key), '')) from public.org_modules t
  union all
  select 'données', 'company_members', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.company_members t
  union all
  select 'données', 'company_member_roles', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.company_member_roles t;
create temp table etat_essai_avant as select * from etat_essai;

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
--      client_to_primary_contact) l'emporte quand il désigne une autre personne (autres mots) : nom et prénom séparés sont
--      vidés, pour ne jamais garder deux noms différents. Le même nom renvoyé dans un autre ordre ou une autre casse (« Paul
--      Durand » d'une fiche client pas encore rechargée, d'une inscription, d'un écran) ne vide rien : le nom est recalculé
--      (app.memes_mots).
--   6. Espaces insécables, fines et invisibles (copier-coller, import) traités comme des espaces (app.espaces_nom) ; la
--      comparaison des mots ignore aussi tirets et virgules (« Jean Pierre Durand » = « DURAND Jean-Pierre »).
--   7. Reprise des contacts déjà séparés : ceux dont le nom affiché désigne une autre personne (séparés périmés, renommés
--      avant 0508 par la fiche client) perdent leurs séparés et gardent leur nom ; les autres sont recalculés (le principal
--      est recopié sur sa fiche client). Production le 07/11 : 10 séparés, 0 périmé, 0 client à deux principaux.
-- Le déclencheur s'exécute avant client_contact_to_client (après), qui recopie donc le nom remis en forme sur la fiche client.

create or replace function app.espaces_nom(p text) returns text
  language sql immutable set search_path = pg_catalog as
$$ select btrim(regexp_replace(coalesce(p, ''), '[\s\u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g')) $$;

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
$$ select coalesce((select array_agg(x order by x) from regexp_split_to_table(lower(app.espaces_nom(a)), '[ ,-]+') x where x <> '')
                 = (select array_agg(x order by x) from regexp_split_to_table(lower(app.espaces_nom(b)), '[ ,-]+') x where x <> ''), false) $$;

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

-- Règle 7 : séparés périmés retirés (le nom affiché reste), puis recalcul des autres (recopie sur la fiche)
update public.client_contacts set last_name = null, first_name = null
 where coalesce(last_name, first_name) is not null and not app.memes_mots(name, concat_ws(' ', last_name, first_name));
update public.client_contacts set last_name = last_name where coalesce(last_name, first_name) is not null;

insert into public.schema_migrations (version) values ('0508_contacts_nom_prenom') on conflict (version) do nothing;

-- ===== supabase/rollback/0508_contacts_nom_prenom_retour.sql =====
-- Retour arrière de 0508 (contacts en « NOM Prénom »). Les noms déjà remis en forme le restent (sans effet sans 0508) ;
-- nom et prénom séparés vidés par la règle 5 (nom libre d'une autre personne) ne sont pas rétablis.
drop trigger if exists client_contacts_nom on public.client_contacts;
drop function if exists app.contact_nom_prenom();
drop function if exists app.contact_nom_affiche(text, text);
drop function if exists app.prenom_forme(text);
drop function if exists app.nom_majuscules(text);
drop function if exists app.memes_mots(text, text);
drop function if exists app.espaces_nom(text);
delete from public.schema_migrations where version = '0508_contacts_nom_prenom';

do $verif$
declare
  v_diff text[];
  v_n int;
  v_par text;
begin
  select count(*), (array_agg(coalesce(a.kind, b.kind) || ' ' || coalesce(a.name, b.name) || case
           when a.name is null then ' (en trop après retour)' when b.name is null then ' (manquant après retour)'
           else ' (différent)' end order by coalesce(a.kind, b.kind) desc, coalesce(a.name, b.name)))[1:40]
    into v_n, v_diff
  from etat_essai_avant a full join etat_essai b on a.kind = b.kind and a.name = b.name
  where a.v is distinct from b.v;
  select string_agg(k || ' ' || n, ', ') into v_par from (
    select coalesce(a.kind, b.kind) k, count(*) n
    from etat_essai_avant a full join etat_essai b on a.kind = b.kind and a.name = b.name
    where a.v is distinct from b.v group by 1) z;
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE contacts_nom_prenom_0508 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
