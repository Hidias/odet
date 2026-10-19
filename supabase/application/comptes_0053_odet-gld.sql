-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (comptes_0053) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur odet-gld : 0053_nom_affiche_calcule.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0053_nom_affiche_calcule_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0053_nom_affiche_calcule.sql =====
-- 0053_nom_affiche_calcule.sql : le nom affiché d'un compte se calcule à partir du prénom et du nom (fin de la
-- double saisie signalée par H le 19/10 à 16h53 : nom de famille ajouté, mais l'écran montrait toujours « Anthony »).
--
-- profiles.display_name était un champ à part, saisi à l'invitation, que la plupart des écrans affichent. Désormais,
-- dès qu'un prénom ou un nom est renseigné, display_name = « Prénom Nom » (nom en majuscules ramené en casse
-- normale : « POUPARD » donne « Poupard »). Sans prénom ni nom, display_name reste tel quel (comptes d'essai,
-- comptes créés avec une adresse seule).
-- Rattrapage : comptes actifs seulement (les comptes d'essai désactivés ne sont pas touchés).
-- Aucune table nouvelle. Migration additive. Idempotente.
-- Retour arrière : supabase/rollback/0053_nom_affiche_calcule_retour.sql (les noms affichés recalculés restent).

create or replace function app.nom_affiche(p_prenom text, p_nom text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(concat_ws(' ',
    nullif(btrim(p_prenom), ''),
    case when btrim(p_nom) = upper(btrim(p_nom)) then initcap(lower(btrim(p_nom))) else nullif(btrim(p_nom), '') end
  )), '')
$$;

create or replace function app.profiles_nom_affiche()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v text := app.nom_affiche(new.first_name, new.last_name);
begin
  if v is not null then
    new.display_name := v;
  end if;
  return new;
end $$;

drop trigger if exists profiles_nom_affiche on public.profiles;
create trigger profiles_nom_affiche
  before insert or update of first_name, last_name, display_name on public.profiles
  for each row execute function app.profiles_nom_affiche();

update public.profiles p
   set display_name = app.nom_affiche(p.first_name, p.last_name)
 where p.is_active
   and app.nom_affiche(p.first_name, p.last_name) is not null
   and p.display_name is distinct from app.nom_affiche(p.first_name, p.last_name);

insert into public.schema_migrations (version) values ('0053_nom_affiche_calcule') on conflict (version) do nothing;
