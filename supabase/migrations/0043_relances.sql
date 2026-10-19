-- 0043_relances.sql : moteur commun des relances et envois programmés (lot 2, section 8).
--
-- Un seul mécanisme pour les relances de recyclage, puis les justificatifs des prestataires (sous-traitance), et les
-- fonctions 12 et 13. Chaque nuit, la tâche planifiée (api/maintenance-nuit.js) appelle
-- public.scheduled_actions_generate() : la base prépare les actions à valider, sans rien envoyer.
-- Validation manuelle par défaut (écran « À valider ») : Valider, Corriger, Ignorer. L'envoi automatique n'existe pas
-- encore : une action validée se transmet par la messagerie de la personne (texte prêt) puis se marque « envoyée ».
-- Relance de recyclage : une action par client et par obligation, quand au moins une échéance de formation du
-- personnel est « à prévoir » ou « dépassée » (délai de l'obligation, 90 jours par défaut) ; jamais deux fois la même
-- (clé de déduplication : client, obligation, mois de la première échéance). Client archivé ou marqué « ne pas
-- solliciter » : rien.
-- Table scheduled_actions : company_id, règles par droits (lecture et validation : droit d'envoyer aux clients ;
-- création et suppression : la tâche de nuit seulement) et isolement par société.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0043_relances_retour.sql

create table if not exists public.scheduled_actions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id),
  kind text not null check (kind in ('relance_recyclage', 'justificatif_prestataire', 'convocation', 'rappel',
                                     'evaluation_froid', 'relance_impaye', 'autre')),
  target_table text,
  target_id uuid,
  client_id uuid references public.clients(id) on delete cascade,
  rule_id uuid references public.obligation_rules(id) on delete set null,
  due_on date,
  title text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'a_valider' check (status in ('a_valider', 'valide', 'envoye', 'ignore', 'erreur')),
  dedup_key text not null,
  validated_by uuid,
  validated_at timestamptz,
  sent_at timestamptz,
  sent_by uuid,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, dedup_key)
);
create index if not exists scheduled_actions_status_idx on public.scheduled_actions (company_id, status, due_on);
comment on table public.scheduled_actions is 'Actions préparées par la base (relances, envois) : validées à la main, jamais envoyées sans une personne';

-- Statut tenu par la base : qui valide ou envoie, et quand ; une action envoyée ou ignorée ne revient pas en arrière
create or replace function app.scheduled_actions_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('envoye', 'ignore') and new.status is distinct from old.status and (select auth.uid()) is not null then
    raise exception 'Action déjà %, elle ne change plus de statut', case old.status when 'envoye' then 'envoyée' else 'ignorée' end
      using errcode = '22023';
  end if;
  if new.status = 'valide' and old.status is distinct from 'valide' then
    new.validated_by := (select auth.uid()); new.validated_at := now();
  end if;
  if new.status = 'envoye' and old.status is distinct from 'envoye' then
    new.sent_by := (select auth.uid()); new.sent_at := now();
  end if;
  -- Ce qui ne se corrige pas depuis l'écran
  new.company_id := old.company_id; new.kind := old.kind; new.dedup_key := old.dedup_key;
  new.client_id := old.client_id; new.target_table := old.target_table; new.target_id := old.target_id;
  new.created_at := old.created_at; new.updated_at := now();
  return new;
end
$$;
revoke all on function app.scheduled_actions_maj() from public, anon, authenticated;
drop trigger if exists scheduled_actions_maj on public.scheduled_actions;
create trigger scheduled_actions_maj before update on public.scheduled_actions
  for each row execute function app.scheduled_actions_maj();

alter table public.scheduled_actions enable row level security;
revoke all on table public.scheduled_actions from public, anon;
grant select, update on table public.scheduled_actions to authenticated;
grant all on table public.scheduled_actions to service_role;

-- ── Règles (générées par scripts/securite/regles.py, build_suite('0043')) ──

-- Pose des règles d'une liste de tables : une règle par action, garde du module ajoutée ici.
-- Lecture : module actif, ou super administrateur. Écriture : module actif.
create or replace function pg_temp.regles(p_tables text[], p_module text, p_sel text, p_ins text, p_upd text, p_del text)
returns void
language plpgsql
as $f$
declare
  t text;
  v_on text;
  v_sel text := p_sel; v_ins text := p_ins; v_upd text := p_upd; v_del text := p_del;
begin
  if p_module is not null then
    select '(' || string_agg(format('(select app.module_on(%L))', m), ' or ') || ')' into v_on
    from unnest(string_to_array(p_module, '|')) m;
    if v_sel is not null then v_sel := format('((%s and %s) or (select app.is_superadmin()))', v_on, v_sel); end if;
    if v_ins is not null then v_ins := format('(%s and %s)', v_on, v_ins); end if;
    if v_upd is not null then v_upd := format('(%s and %s)', v_on, v_upd); end if;
    if v_del is not null then v_del := format('(%s and %s)', v_on, v_del); end if;
  end if;
  foreach t in array p_tables loop
    execute format('alter table public.%I enable row level security', t);
    if v_sel is not null then
      execute format('create policy %I on public.%I for select to authenticated using (%s)', t || '_lire', t, v_sel);
    end if;
    if v_ins is not null then
      execute format('create policy %I on public.%I for insert to authenticated with check (%s)', t || '_creer', t, v_ins);
    end if;
    if v_upd is not null then
      execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', t || '_modifier', t, v_upd, v_upd);
    end if;
    if v_del is not null then
      execute format('create policy %I on public.%I for delete to authenticated using (%s)', t || '_supprimer', t, v_del);
    end if;
  end loop;
end
$f$;

-- Suppression des règles nommées du générateur (lire, créer, modifier, supprimer) ; les autres règles
-- (règle restrictive des notifications de 0070, etc.) ne sont pas touchées
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and tablename = any (array['scheduled_actions'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- scheduled_actions
select pg_temp.regles(array['scheduled_actions'], null,
  $r$company_id in (select app.societes_avec_droit('formation.convocations.envoyer'))$r$,
  null,
  $r$company_id in (select app.societes_avec_droit('formation.convocations.envoyer'))$r$,
  null);

drop policy if exists scheduled_actions_societe_lire on public.scheduled_actions;
drop policy if exists scheduled_actions_societe_creer on public.scheduled_actions;
drop policy if exists scheduled_actions_societe_modifier on public.scheduled_actions;
drop policy if exists scheduled_actions_societe_supprimer on public.scheduled_actions;
create policy scheduled_actions_societe_lire on public.scheduled_actions as restrictive for select to authenticated
  using (company_id in (select app.societes_lisibles()));
create policy scheduled_actions_societe_creer on public.scheduled_actions as restrictive for insert to authenticated
  with check (company_id in (select app.societes_ecriture()));
create policy scheduled_actions_societe_modifier on public.scheduled_actions as restrictive for update to authenticated
  using (company_id in (select app.societes_ecriture())) with check (company_id in (select app.societes_ecriture()));
create policy scheduled_actions_societe_supprimer on public.scheduled_actions as restrictive for delete to authenticated
  using (company_id in (select app.societes_ecriture()));

-- ── Génération (tâche de nuit, clé de service) ──
create or replace function public.scheduled_actions_generate()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int := 0;
begin
  if coalesce((select auth.role()), '') not in ('service_role', '') and not app.a_le_droit('plateforme.administrer') then
    raise exception 'Réservé à la tâche de nuit' using errcode = '42501';
  end if;

  with echeances as (
    select d.company_id, d.client_id, d.rule_id, d.rule_label, d.due_on, d.objet_label, d.status
    from public.v_obligation_deadlines d
    where d.kind = 'formation' and d.status in ('a_prevoir', 'depasse') and d.client_id is not null and d.rule_id is not null
  ), par_client as (
    select e.company_id, e.client_id, e.rule_id, min(e.rule_label) as rule_label, min(e.due_on) as premiere,
           count(*) as nb, bool_or(e.status = 'depasse') as depasse,
           jsonb_agg(jsonb_build_object('nom', e.objet_label, 'echeance', e.due_on) order by e.due_on) as personnes
    from echeances e
    group by e.company_id, e.client_id, e.rule_id
  ), avec_client as (
    select p.*, c.name as client_name,
           coalesce(nullif(btrim(c.contact_email), ''), nullif(btrim(c.email), ''),
                    (select nullif(btrim(cc.email), '') from public.client_contacts cc
                      where cc.client_id = c.id and cc.email is not null order by cc.is_primary desc nulls last limit 1)) as email
    from par_client p
    join public.clients c on c.id = p.client_id
    where coalesce(c.status, 'actif') not in ('archive', 'archived', 'inactif')
      and not coalesce((to_jsonb(c) ->> 'do_not_mail')::boolean, false)
  )
  insert into public.scheduled_actions (company_id, kind, target_table, target_id, client_id, rule_id, due_on, title, payload, dedup_key)
  select a.company_id, 'relance_recyclage', 'clients', a.client_id, a.client_id, a.rule_id, a.premiere,
         a.rule_label || ' : ' || a.nb || ' salarié' || case when a.nb > 1 then 's' else '' end || ' à recycler chez ' || a.client_name,
         jsonb_build_object(
           'destinataire', a.email,
           'objet', 'Recyclage ' || a.rule_label || ' à prévoir',
           'texte', 'Bonjour,' || E'\n\n'
             || case when a.depasse then 'La validité de la formation « ' || a.rule_label || ' » est dépassée ou arrive à échéance pour une partie de votre personnel :'
                     else 'La validité de la formation « ' || a.rule_label || ' » arrive à échéance pour une partie de votre personnel :' end
             || E'\n' || (select string_agg('- ' || coalesce(x ->> 'nom', 'salarié') || ' : ' || to_char((x ->> 'echeance')::date, 'DD/MM/YYYY'), E'\n')
                          from jsonb_array_elements(a.personnes) x)
             || E'\n\n' || 'Nous pouvons organiser le recyclage dans vos locaux ou dans les nôtres. Souhaitez-vous que nous vous proposions des dates ?'
             || E'\n\n' || 'Bien cordialement,',
           'personnes', a.personnes,
           'depasse', a.depasse),
         'recyclage:' || a.client_id || ':' || a.rule_id || ':' || to_char(a.premiere, 'YYYY-MM')
  from avec_client a
  on conflict (company_id, dedup_key) do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('relance_recyclage', v_n);
end
$$;
revoke all on function public.scheduled_actions_generate() from public, anon;
grant execute on function public.scheduled_actions_generate() to authenticated, service_role;

insert into public.schema_migrations (version) values ('0043_relances') on conflict (version) do nothing;
