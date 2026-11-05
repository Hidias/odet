-- 0492 : retrait des colonnes héritées de l'import Sellsy (B22). Depuis 0491 et #294, l'import est générique et les
-- identifiants de l'ancien outil vont dans external_source et external_ref ; plus aucun écran ni aucune fonction ne lit
-- ni n'écrit clients.sellsy_id, client_contacts.sellsy_contact_id, invoices.sellsy_reference, courses.sellsy_id
-- (contrôle du 05/11 : 0 valeur dans les quatre colonnes en production, seule dépendance la vue v_clients_a_appeler).
-- La vue est recréée avec les seules colonnes du contact qu'elle utilise (mêmes colonnes en sortie). Le retrait est
-- refusé si une des colonnes n'est pas nulle (même une chaîne vide ou d'espaces) : rien n'est perdu. La contrainte clients_sellsy_id_key et les index
-- idx_clients_sellsy et idx_courses_sellsy_id partent avec leurs colonnes.
-- Idempotente. Retour arrière : supabase/rollback/0492_retrait_sellsy_retour.sql, à jouer AVANT celui de 0491
-- (0491_import_generique_retour.sql écrit dans ces colonnes).

do $$
declare
  v record;
  v_plein boolean;
begin
  for v in select * from (values ('clients', 'sellsy_id'), ('client_contacts', 'sellsy_contact_id'),
                                 ('invoices', 'sellsy_reference'), ('courses', 'sellsy_id')) t(tbl, col) loop
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = v.tbl and column_name = v.col) then
      execute format('select exists (select 1 from public.%I where %I is not null)', v.tbl, v.col) into v_plein;
      if v_plein then
        raise exception '0492 : %.% n''est pas vide, retrait refusé (recopier d''abord la valeur ailleurs, ou la vider)', v.tbl, v.col;
      end if;
    end if;
  end loop;
end $$;

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
  select x.id, x.name, x.first_name, x.last_name, x.mobile, x.phone from public.client_contacts x where x.client_id = e.client_id
  order by x.is_primary desc nulls last, x.created_at limit 1
) ct on true
where coalesce(c.status, '') not in ('archive', 'inactif');

alter table public.clients drop column if exists sellsy_id;
alter table public.client_contacts drop column if exists sellsy_contact_id;
alter table public.invoices drop column if exists sellsy_reference;
alter table public.courses drop column if exists sellsy_id;

insert into public.schema_migrations (version) values ('0492_retrait_sellsy') on conflict (version) do nothing;
