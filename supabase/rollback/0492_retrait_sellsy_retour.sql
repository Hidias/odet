-- Retour arrière de 0492 : les quatre colonnes héritées reviennent vides (elles l'étaient au retrait, 0492 refuse sinon),
-- avec la contrainte unique clients_sellsy_id_key, les index idx_clients_sellsy et idx_courses_sellsy_id, et la vue
-- v_clients_a_appeler dans sa définition d'avant 0492. Possible même après usage : aucune contrainte ajoutée ne peut
-- être violée par des lignes nouvelles (colonnes vides). Les identifiants importés restent dans external_ref.
-- À jouer avant le retour de 0491 (0491_import_generique_retour.sql écrit dans ces colonnes, il échoue sans elles).
-- Les colonnes reviennent en fin de table (position sans effet : aucune lecture par position).

alter table public.clients add column if not exists sellsy_id character varying(50);
alter table public.client_contacts add column if not exists sellsy_contact_id character varying(50);
alter table public.invoices add column if not exists sellsy_reference character varying;
alter table public.courses add column if not exists sellsy_id text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_sellsy_id_key') then
    alter table public.clients add constraint clients_sellsy_id_key unique (sellsy_id);
  end if;
end $$;
create index if not exists idx_clients_sellsy on public.clients using btree (sellsy_id);
create index if not exists idx_courses_sellsy_id on public.courses using btree (sellsy_id) where (sellsy_id is not null);

create or replace view public.v_clients_a_appeler
with (security_invoker = true)
as
with ech as (
  select d.company_id, d.client_id, min(d.due_on) as premiere_echeance, count(*)::int as nb_echeances,
         array_agg(distinct d.kind order by d.kind) as natures,
         bool_or(d.due_on < current_date) as depassee
  from public.v_obligation_deadlines d
  where d.due_on <= current_date + 90
  group by d.company_id, d.client_id
)
select e.company_id, e.client_id, c.name as client_name, c.city, c.status as client_status, e.premiere_echeance,
       e.nb_echeances, e.natures, e.depassee,
       ('appel' = any (c.opposition_canaux)) as ne_pas_appeler,
       ct.id as contact_id, coalesce(nullif(btrim(concat_ws(' ', ct.first_name, ct.last_name)), ''), ct.name, c.contact_name) as contact_name,
       coalesce(nullif(ct.mobile, ''), nullif(ct.phone, ''), nullif(c.contact_phone, ''), nullif(c.mobile, '')) as contact_phone,
       exists (select 1 from public.opportunities o where o.client_id = e.client_id and o.stage not in ('gagnee', 'perdue')) as affaire_en_cours,
       exists (select 1 from public.quotes q where q.client_id = e.client_id and q.status in ('draft', 'sent')) as devis_en_cours,
       (select max(i.interaction_date) from public.client_interactions i where i.client_id = e.client_id) as dernier_echange,
       c.owner_id
from ech e
join public.clients c on c.id = e.client_id
left join lateral (
  select x.id, x.client_id, x.name, x.role, x.email, x.phone, x.is_primary, x.created_at, x.updated_at, x.civilite,
         x.first_name, x.last_name, x.mobile, x.fonction, x.is_billing, x.is_followup, x.notes, x.sellsy_contact_id,
         x.is_document_contact, x.company_id, x.company_ids, x.site_id
  from public.client_contacts x where x.client_id = e.client_id
  order by x.is_primary desc nulls last, x.created_at limit 1
) ct on true
where coalesce(c.status, '') not in ('archive', 'inactif');

delete from public.schema_migrations where version = '0492_retrait_sellsy';
