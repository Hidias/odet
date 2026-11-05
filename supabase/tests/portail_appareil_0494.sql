-- Essai local de 0494 : première visite d'un appareil dans l'espace client, deux appels au même instant.
-- La course est simulée par un déclencheur d'essai qui insère la même ligne juste avant l'insertion de la fonction
-- (comme un second onglet qui gagne entre la recherche et l'insertion). Sans 0494 : erreur de doublon.
begin;
set local client_min_messages = warning;

create function pg_temp.essai_0494_double() returns trigger language plpgsql as $f$
begin
  if current_setting('essai.course_0494', true) = 'oui' then
    perform set_config('essai.course_0494', 'non', true);
    insert into public.portal_devices (company_id, client_id, access_id, profile_id, device_hash)
    values (new.company_id, new.client_id, new.access_id, new.profile_id, new.device_hash);
  end if;
  return new;
end
$f$;
create trigger essai_0494_double before insert on public.portal_devices
  for each row execute function pg_temp.essai_0494_double();

do $$
declare
  v_cie uuid; v_cl uuid; v_acc uuid; v_r jsonb; v_n int; v_notif int;
  h1 text := repeat('a', 64); h2 text := repeat('b', 64); h3 text := repeat('c', 64);
begin
  select id into v_cie from public.companies limit 1;
  insert into public.clients (name, company_id) values ('Client essai 0494', v_cie) returning id into v_cl;
  insert into public.client_portal_access (client_id, access_code, company_id) values (v_cl, '000000', v_cie) returning id into v_acc;

  -- 1. Première visite, appel concurrent simulé : pas d'erreur, une seule ligne, pas « nouveau »
  perform set_config('essai.course_0494', 'oui', true);
  v_r := app.portail_appareil_noter(v_cl, v_acc, null, h1);
  if v_r ? 'error' then raise exception '1. erreur à la première visite concurrente (%)', v_r; end if;
  if (v_r->>'nouveau')::boolean then raise exception '2. appel perdant compté comme nouvel appareil'; end if;
  select count(*) into v_n from public.portal_devices where access_id = v_acc;
  if v_n <> 1 then raise exception '3. % ligne(s) au lieu de 1', v_n; end if;
  if jsonb_array_length(v_r->'appareils') <> 1 or not (v_r->'appareils'->0->>'actuel')::boolean then
    raise exception '4. liste des appareils fausse (%)', v_r->'appareils';
  end if;

  -- 2. Même appareil plus tard : visite connue
  v_r := app.portail_appareil_noter(v_cl, v_acc, null, h1);
  if (v_r->>'nouveau')::boolean or jsonb_array_length(v_r->'appareils') <> 1 then raise exception '5. visite connue fausse (%)', v_r; end if;

  -- 3. Autre appareil : nouveau, une notification
  select count(*) into v_notif from public.notifications where type = 'espace_client_appareil' and metadata->>'client_id' = v_cl::text;
  v_r := app.portail_appareil_noter(v_cl, v_acc, null, h2);
  if not (v_r->>'nouveau')::boolean or jsonb_array_length(v_r->'appareils') <> 2 then raise exception '6. nouvel appareil non signalé (%)', v_r; end if;
  if (select count(*) from public.notifications where type = 'espace_client_appareil' and metadata->>'client_id' = v_cl::text) <> v_notif + 1 then
    raise exception '7. notification absente';
  end if;

  -- 4. Troisième appareil en course : ligne unique, pas de notification en double
  perform set_config('essai.course_0494', 'oui', true);
  v_r := app.portail_appareil_noter(v_cl, v_acc, null, h3);
  if v_r ? 'error' or (v_r->>'nouveau')::boolean then raise exception '8. course sur un troisième appareil fausse (%)', v_r; end if;
  if (select count(*) from public.portal_devices where access_id = v_acc and device_hash = h3) <> 1 then raise exception '9. doublon'; end if;
  if (select count(*) from public.notifications where type = 'espace_client_appareil' and metadata->>'client_id' = v_cl::text) <> v_notif + 1 then
    raise exception '10. notification en trop';
  end if;

  -- 5. Droits inchangés, migration inscrite
  if has_function_privilege('anon', 'app.portail_appareil_noter(uuid,uuid,uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'app.portail_appareil_noter(uuid,uuid,uuid,text)', 'execute') then
    raise exception '11. fonction ouverte à anon ou authenticated';
  end if;
  if not exists (select 1 from public.schema_migrations where version = '0494_portail_appareil_concurrence') then
    raise exception '12. 0494 non inscrite';
  end if;
end $$;
rollback;
