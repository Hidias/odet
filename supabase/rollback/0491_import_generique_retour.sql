-- Retour arrière de 0491 : les identifiants rangés dans les colonnes génériques sont recopiés dans les colonnes héritées
-- quand c'est possible : colonne héritée vide et, pour les clients, identifiant libre (index unique clients_sellsy_id_key).
-- Sinon (même identifiant sur deux clients, colonne héritée déjà remplie d'une autre valeur), l'identifiant est ajouté
-- aux notes : aucune perte. Puis les colonnes génériques sont retirées.
with candidats as (
  select id, external_ref, count(*) over (partition by external_ref) as n
  from public.clients
  where nullif(btrim(external_ref), '') is not null and nullif(btrim(sellsy_id), '') is null
)
update public.clients c set sellsy_id = k.external_ref
  from candidats k
  where c.id = k.id and k.n = 1 and not exists (select 1 from public.clients x where x.sellsy_id = k.external_ref);
update public.clients
  set notes = concat_ws(E'\n', nullif(notes, ''), 'Identifiant d''origine (' || coalesce(external_source, 'import') || ') : ' || external_ref)
  where nullif(btrim(external_ref), '') is not null and sellsy_id is distinct from external_ref;

update public.client_contacts set sellsy_contact_id = external_ref
  where nullif(btrim(external_ref), '') is not null and nullif(btrim(sellsy_contact_id), '') is null;
update public.client_contacts
  set notes = concat_ws(E'\n', nullif(notes, ''), 'Identifiant d''origine : ' || external_ref)
  where nullif(btrim(external_ref), '') is not null and sellsy_contact_id is distinct from external_ref;

update public.invoices set sellsy_reference = external_ref
  where nullif(btrim(external_ref), '') is not null and nullif(btrim(sellsy_reference), '') is null;
update public.invoices
  set notes = concat_ws(E'\n', nullif(notes, ''), 'Référence d''origine : ' || external_ref)
  where nullif(btrim(external_ref), '') is not null and sellsy_reference is distinct from external_ref;

alter table public.clients drop column if exists external_source;
alter table public.clients drop column if exists external_ref;
alter table public.client_contacts drop column if exists external_ref;
alter table public.invoices drop column if exists external_ref;

delete from public.schema_migrations where version = '0491_import_generique';
