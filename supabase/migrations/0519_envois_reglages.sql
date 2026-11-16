-- 0519 : contrôle des envois sortants, lot 2 (décisions de H du 08/11 et du 16/11).
-- Jusqu'ici, 11 interrupteurs « ouvert / fermé » dans la Console, dont 8 ne commandaient rien, et un seul sens pour
-- « ouvert » : les questionnaires à froid ouverts restaient validés à la main, les relances du circuit ouvertes
-- partaient seules. Désormais un réglage par société et par type d'envoi, à trois modes :
--   « ferme »      rien n'est préparé ni envoyé ;
--   « a_valider »  préparé, puis validé et envoyé depuis l'outil par une personne (défaut) ;
--   « auto »       part seul, sans validation (super administrateur seul, jamais en mode démonstration ni en
--                  préversion : la route ne fait alors rien et ne marque rien).
--   1. Types réels (app.envoi_types) : les relances envoyables de la file (0518 : à valider ou automatique ; leur
--      préparation de nuit ne lit pas le réglage, donc pas de « fermé » qui ne fermerait rien), les relances du circuit
--      (les trois modes), les questionnaires à froid (fermé ou à valider : leur envoi automatique n'existe pas encore) et
--      la demande du n° de sécurité sociale (à valider, c'est-à-dire envoyée depuis la session, ou automatique).
--      Suspension de 24 h : plus rien ne part, ni à la main depuis la file ni seul (relance_envoi_reserver revérifie). Les interrupteurs des
--      relances de devis, convocations et attestations, qui ne commandaient rien, sont retirés (choix de H du 16/11).
--      Colonne mode de auto_send_switches ; enabled n'est plus lu (gardé pour le retour arrière).
--   2. Reprise à l'identique : questionnaires à froid ouverts → à valider ; relances du circuit et demande du n°
--      ouvertes → automatique, sinon fermé (circuit) ou à valider (n°) ; types de la file → à valider.
--   3. app.envoi_ouvert (préparer et envoyer après validation) et app.envoi_auto_autorise (partir seul), suspension
--      de 24 h comprise ; public.envoi_regler (administrateur de la société, automatique par le super administrateur).
--   4. public.envois_reglages(société ou toutes) : modes, suspension, et proposition de l'automatique après 5 envois
--      validés sans retouche d'un même type depuis le dernier changement de mode. L'outil ne bascule jamais seul.
--   5. Relances du circuit (J-10, J-7) : préparées dans la file (type relance_circuit), validées puis envoyées depuis
--      l'outil, ou parties seules en automatique ; écartées si la situation est réglée avant l'envoi.
--   6. Envoi automatique de la file : relances_auto_a_envoyer et relance_auto_reserver (clé de service seule), fin par
--      relance_envoi_terminer (0518) sans auteur ; un envoi au résultat incertain n'est jamais repris seul. Seules
--      partent les relances préparées après le passage en automatique (mode_at), à échéance depuis 3 jours au plus,
--      jamais remises à valider par une personne ni refusées par le serveur : le stock en attente reste à la main.
--   7. Questionnaires à froid : réservation soumise à app.envoi_ouvert ; fin d'envoi par la clé de service seule, au
--      nom de la personne qui a réservé.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0519_envois_reglages_retour.sql

-- 1. Types et modes
create or replace function app.envoi_types()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['relance_recyclage', 'relance_impaye', 'renouvellement_contrat', 'visite_hors_contrat', 'justificatif_prestataire',
               'avis_financeur', 'rappel', 'autre', 'relance_circuit', 'evaluation_froid', 'demande_nir']
$$;

-- Liste lue par la suspension (0382) : les mêmes types
create or replace function app.envoi_auto_types()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select app.envoi_types()
$$;

create or replace function app.envoi_modes_permis(p_kind text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case when p_kind is null or not (p_kind = any (app.envoi_types())) then null
              when p_kind = 'evaluation_froid' then array['ferme', 'a_valider']
              when p_kind = 'demande_nir' then array['a_valider', 'auto']
              when p_kind = 'relance_circuit' then array['ferme', 'a_valider', 'auto']
              else array['a_valider', 'auto'] end
$$;

alter table public.auto_send_switches add column if not exists mode text;
-- Dernier changement de mode (la suspension ne le touche pas) : départ du compteur et des envois automatiques
alter table public.auto_send_switches add column if not exists mode_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.auto_send_switches'::regclass and conname = 'auto_send_switches_mode_check') then
    alter table public.auto_send_switches add constraint auto_send_switches_mode_check check (mode is null or mode in ('ferme', 'a_valider', 'auto'));
  end if;
end
$$;
alter table public.auto_send_switches drop constraint if exists auto_send_switches_kind_check;
alter table public.auto_send_switches add constraint auto_send_switches_kind_check check (kind = any (array[
  'relance_recyclage', 'relance_devis', 'relance_facture', 'convocation', 'attestation', 'evaluation_froid', 'renouvellement_contrat',
  'visite_hors_contrat', 'justificatif_prestataire', 'relance_circuit', 'demande_nir',
  'relance_impaye', 'avis_financeur', 'rappel', 'autre']));
comment on column public.auto_send_switches.mode is 'ferme, a_valider ou auto (0519) ; écrit par envoi_regler seulement. enabled n''est plus lu.';

alter table public.auto_send_switch_log drop constraint if exists auto_send_switch_log_action_check;
alter table public.auto_send_switch_log add constraint auto_send_switch_log_action_check
  check (action in ('ouvert', 'ferme', 'suspendu', 'repris', 'a_valider', 'automatique'));

-- 2. Reprise à l'identique (seulement là où le mode n'est pas encore posé)
insert into public.auto_send_switches (company_id, kind, enabled, mode, mode_at, updated_at)
select c.id, t.kind, coalesce(s.enabled, false),
  case t.kind
    when 'evaluation_froid' then case when coalesce(s.enabled, false) then 'a_valider' else 'ferme' end
    when 'relance_circuit' then case when coalesce(s.enabled, false) then 'auto' else 'ferme' end
    when 'demande_nir' then case when coalesce(s.enabled, false) then 'auto' else 'a_valider' end
    else 'a_valider' end,
  now(), now()
from public.companies c
cross join unnest(app.envoi_types()) t(kind)
left join public.auto_send_switches s on s.company_id = c.id and s.kind = t.kind
on conflict (company_id, kind) do update set mode = excluded.mode, mode_at = excluded.mode_at
  where public.auto_send_switches.mode is null;

-- 3. Règles d'envoi
-- Mode du type pour la société ; sans ligne (société créée ensuite) : à valider
create or replace function app.envoi_mode(p_company uuid, p_kind text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when app.envoi_modes_permis(p_kind) is null then 'ferme'
              else coalesce((select s.mode from public.auto_send_switches s where s.company_id = p_company and s.kind = p_kind), 'a_valider') end
$$;

create or replace function app.envoi_suspendu(p_company uuid, p_kind text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.auto_send_switches s where s.company_id = p_company and s.kind = p_kind and s.suspended_until > now())
$$;

-- Préparer, et envoyer après validation d'une personne
create or replace function app.envoi_ouvert(p_company uuid, p_kind text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.envoi_mode(p_company, p_kind) in ('a_valider', 'auto') and not app.envoi_suspendu(p_company, p_kind)
$$;

-- Partir seul, sans validation (même nom qu'en 0382 : la demande du n° de sécurité sociale l'appelle)
create or replace function app.envoi_auto_autorise(p_company uuid, p_kind text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.envoi_mode(p_company, p_kind) = 'auto' and not app.envoi_suspendu(p_company, p_kind)
$$;

revoke all on function app.envoi_types() from public, anon;
revoke all on function app.envoi_modes_permis(text) from public, anon;
revoke all on function app.envoi_mode(uuid, text) from public, anon;
revoke all on function app.envoi_suspendu(uuid, text) from public, anon;
revoke all on function app.envoi_ouvert(uuid, text) from public, anon;
revoke all on function app.envoi_auto_autorise(uuid, text) from public, anon;
grant execute on function app.envoi_types() to authenticated, service_role;
grant execute on function app.envoi_modes_permis(text) to authenticated, service_role;
revoke execute on function app.envoi_mode(uuid, text) from authenticated;
revoke execute on function app.envoi_suspendu(uuid, text) from authenticated;
revoke execute on function app.envoi_ouvert(uuid, text) from authenticated;
grant execute on function app.envoi_mode(uuid, text) to service_role;
grant execute on function app.envoi_suspendu(uuid, text) to service_role;
grant execute on function app.envoi_ouvert(uuid, text) to service_role;
grant execute on function app.envoi_auto_autorise(uuid, text) to authenticated, service_role;

-- Régler un type : droit de modifier les réglages de l'organisme (même droit que la lecture) ; « automatique » par le
-- super administrateur seul
create or replace function public.envoi_regler(p_company uuid, p_kind text, p_mode text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_avant text;
begin
  if (select auth.uid()) is null then raise exception 'Connexion requise' using errcode = '42501'; end if;
  if app.envoi_modes_permis(p_kind) is null then raise exception 'Type d''envoi inconnu' using errcode = '22023'; end if;
  if p_mode is null or not (p_mode = any (app.envoi_modes_permis(p_kind))) then
    raise exception 'Réglage impossible pour cet envoi' using errcode = '22023';
  end if;
  if not exists (select 1 from public.companies where id = p_company) then raise exception 'Société inconnue' using errcode = '22023'; end if;
  if not (app.is_superadmin() or app.a_le_droit('plateforme.administrer')
          or p_company in (select app.societes_avec_droit('parametres.organisme.modifier'))) then
    raise exception 'Droit de modifier les réglages de l''organisme requis' using errcode = '42501';
  end if;
  v_avant := app.envoi_mode(p_company, p_kind);
  if p_mode = 'auto' and v_avant <> 'auto' and not app.is_superadmin() then
    raise exception 'Seul le super administrateur passe un envoi en automatique' using errcode = '42501';
  end if;
  if p_mode = v_avant then return; end if;
  insert into public.auto_send_switches (company_id, kind, enabled, mode, mode_at, updated_by, updated_at)
  values (p_company, p_kind, false, p_mode, now(), (select auth.uid()), now())
  on conflict (company_id, kind) do update set mode = excluded.mode, mode_at = now(), updated_by = excluded.updated_by, updated_at = now();
  insert into public.auto_send_switch_log (company_id, kind, action, motif, user_id)
  values (p_company, p_kind, case p_mode when 'auto' then 'automatique' when 'ferme' then 'ferme' else 'a_valider' end,
          'Avant : ' || case v_avant when 'auto' then 'automatique' when 'ferme' then 'fermé' else 'à valider' end, (select auth.uid()));
end
$$;
revoke all on function public.envoi_regler(uuid, text, text) from public, anon;
grant execute on function public.envoi_regler(uuid, text, text) to authenticated;

-- L'ancien réglage ouvert / fermé n'est plus appelé par l'écran
revoke execute on function public.envoi_auto_regler(uuid, text, boolean) from authenticated;

-- 4. Lecture des réglages et proposition de l'automatique
-- Envois validés par une personne, sans retouche, depuis la dernière retouche et le dernier changement de réglage
create or replace function app.envoi_sans_retouche(p_company uuid, p_kind text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.scheduled_actions a
   where a.company_id = p_company and a.kind = p_kind and a.status = 'envoye' and a.validated_by is not null
     and not a.texte_retouche and a.envoi_possible
     and a.sent_at > coalesce((select max(b.sent_at) from public.scheduled_actions b
                                where b.company_id = p_company and b.kind = p_kind and b.status = 'envoye' and b.texte_retouche), '-infinity')
     and a.sent_at > coalesce((select s.mode_at from public.auto_send_switches s where s.company_id = p_company and s.kind = p_kind), '-infinity')
$$;
revoke all on function app.envoi_sans_retouche(uuid, text) from public, anon, authenticated;
grant execute on function app.envoi_sans_retouche(uuid, text) to service_role;

-- Société donnée (refus sans le droit), ou toutes celles où l'appelant a le droit (null)
create or replace function public.envois_reglages(p_company uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_plateforme boolean := app.a_le_droit('plateforme.administrer');
begin
  if (select auth.uid()) is null then raise exception 'Connexion requise' using errcode = '42501'; end if;
  if p_company is not null and not v_plateforme
     and p_company not in (select app.societes_avec_droit('parametres.organisme.modifier')) then
    raise exception 'Droit de modifier les réglages de l''organisme requis' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('company_id', x.company_id, 'kind', x.kind, 'mode', x.mode, 'modes', to_jsonb(x.modes),
             'suspended_until', x.suspended_until, 'suspended_reason', x.suspended_reason,
             'sans_retouche', x.n, 'proposition', x.mode = 'a_valider' and 'auto' = any (x.modes) and x.n >= 5)
           order by x.company_id, x.rang)
      from (
        select c.id company_id, t.kind, t.rang, app.envoi_mode(c.id, t.kind) mode, app.envoi_modes_permis(t.kind) modes,
               case when s.suspended_until > now() then s.suspended_until end suspended_until,
               case when s.suspended_until > now() then s.suspended_reason end suspended_reason,
               case when 'auto' = any (app.envoi_modes_permis(t.kind)) and t.kind <> 'demande_nir'
                    then app.envoi_sans_retouche(c.id, t.kind) end n
          from public.companies c
          cross join unnest(app.envoi_types()) with ordinality t(kind, rang)
          left join public.auto_send_switches s on s.company_id = c.id and s.kind = t.kind
         where (p_company is not null and c.id = p_company)
            or (p_company is null and (v_plateforme or c.id in (select app.societes_avec_droit('parametres.organisme.modifier'))))
      ) x), '[]'::jsonb);
end
$$;
revoke all on function public.envois_reglages(uuid) from public, anon;
grant execute on function public.envois_reglages(uuid) to authenticated;

-- 5. Relances du circuit dans la file
alter table public.scheduled_actions drop constraint if exists scheduled_actions_kind_check;
alter table public.scheduled_actions add constraint scheduled_actions_kind_check check (kind = any (array[
  'relance_recyclage', 'justificatif_prestataire', 'convocation', 'rappel', 'evaluation_froid', 'relance_impaye', 'autre',
  'renouvellement_contrat', 'visite_hors_contrat', 'emargement_manquant', 'eval_chaud', 'attestations', 'facture_brouillon',
  'avis_financeur', 'relance_circuit']));

create or replace function app.relance_envoyable(p_kind text, p_payload jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_kind in ('relance_recyclage', 'justificatif_prestataire', 'rappel', 'relance_impaye', 'avis_financeur',
                             'renouvellement_contrat', 'visite_hors_contrat', 'autre', 'relance_circuit'), false)
     and coalesce((p_payload->>'interne')::boolean, false) = false
     and coalesce((p_payload->>'a_valider_par_expert')::boolean, false) = false
     and coalesce(p_payload->>'etape', '') not in ('convocation', 'attestations', 'emargement', 'eval_chaud', 'eval_froid', 'facture', 'mise_en_demeure')
$$;
revoke all on function app.relance_envoyable(text, jsonb) from public, anon;
grant execute on function app.relance_envoyable(text, jsonb) to authenticated, service_role;
-- Colonne calculée : recalcul des lignes existantes
update public.scheduled_actions set kind = kind where kind = 'relance_circuit';

-- Relances dues : réglage ouvert (fermé : rien n'est préparé), pas déjà envoyée avant 0519 ni déjà dans la file
create or replace function public.circuit_relances_dues()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('session_id', x.id, 'company_id', x.company_id, 'kind', x.kind, 'reference', x.reference,
    'start_date', x.start_date, 'start_time', x.start_time, 'course', x.course, 'client', x.client, 'contact_name', x.contact_name,
    'email', x.email)), '[]'::jsonb)
  from (
    select s.id, s.company_id, k.kind, s.reference, s.start_date, s.start_time, co.title course, c.name client,
      coalesce(cc.first_name, cc.name) contact_name,
      coalesce(nullif(cc.email, ''), nullif(c.billing_email, ''), nullif(c.contact_email, ''), nullif(c.email, '')) email
    from public.sessions s
    join public.clients c on c.id = s.client_id
    left join public.courses co on co.id = s.course_id
    left join public.client_contacts cc on cc.id = s.contact_id
    cross join lateral (values ('participants'), ('convention')) k(kind)
    where s.quote_id is not null and not coalesce(s.validation_requise, false) and s.start_date > current_date
      and app.envoi_ouvert(s.company_id, 'relance_circuit')
      and not exists (select 1 from public.demo_records r where r.tbl = 'sessions' and r.id = s.id)
      and not exists (select 1 from public.circuit_relances r where r.session_id = s.id and r.kind = k.kind)
      and not exists (select 1 from public.scheduled_actions a where a.company_id = s.company_id
                        and a.dedup_key = 'circuit:' || s.id || ':' || k.kind)
      and ((k.kind = 'participants' and s.start_date - current_date <= 10
            and not exists (select 1 from public.session_trainees st where st.session_id = s.id))
        or (k.kind = 'convention' and s.start_date - current_date <= 7 and not coalesce(s.convention_signed, false)
            and exists (select 1 from public.session_trainees st where st.session_id = s.id)))
  ) x
  where x.email is not null
$$;
revoke all on function public.circuit_relances_dues() from public, anon, authenticated;
grant execute on function public.circuit_relances_dues() to service_role;

-- Relance du circuit encore utile (revérifiée à l'envoi, à la main comme seul) : session à venir, non annulée, et
-- participants toujours absents, ou convention toujours non signée
create or replace function app.circuit_relance_utile(p_session uuid, p_circuit text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.sessions s where s.id = p_session and s.start_date > current_date and coalesce(s.status, '') <> 'cancelled'
                   and ((p_circuit = 'participants' and not exists (select 1 from public.session_trainees st where st.session_id = s.id))
                     or (p_circuit = 'convention' and not coalesce(s.convention_signed, false))))
$$;
revoke all on function app.circuit_relance_utile(uuid, text) from public, anon, authenticated;
grant execute on function app.circuit_relance_utile(uuid, text) to service_role;

-- Préparer une relance du circuit (texte écrit par la route) : à valider, une seule par session et par objet
create or replace function public.circuit_relance_preparer(p_session uuid, p_kind text, p_destinataire text, p_objet text, p_texte text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare s public.sessions; v_id uuid;
begin
  if p_kind not in ('participants', 'convention') then raise exception 'Relance du circuit inconnue' using errcode = '22023'; end if;
  select * into s from public.sessions where id = p_session;
  if not found or not app.envoi_ouvert(s.company_id, 'relance_circuit') then return null; end if;
  insert into public.scheduled_actions (company_id, kind, target_table, target_id, session_id, client_id, due_on, title, payload, dedup_key)
  values (s.company_id, 'relance_circuit', 'sessions', s.id, s.id, s.client_id, current_date,
          left(coalesce(nullif(btrim(p_objet), ''), 'Relance du circuit'), 300),
          jsonb_build_object('circuit', p_kind, 'lien', '/sessions/' || s.id, 'destinataire', left(btrim(coalesce(p_destinataire, '')), 320),
                             'objet', left(coalesce(p_objet, ''), 300), 'texte', p_texte),
          'circuit:' || s.id || ':' || p_kind)
  on conflict (company_id, dedup_key) do nothing
  returning id into v_id;
  return v_id;
end
$$;
revoke all on function public.circuit_relance_preparer(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.circuit_relance_preparer(uuid, text, text, text, text) to service_role;

-- Relances du circuit pas encore parties dont la situation est réglée (participants saisis, convention signée,
-- formation commencée, session supprimée ou annulée) : écartées par la base, motif noté
create or replace function public.circuit_relances_ecarter()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_n integer;
begin
  update public.scheduled_actions a
     set status = 'ignore',
         error = case when s.id is null then 'Session supprimée'
                      when s.status = 'cancelled' then 'Session annulée'
                      when s.start_date <= current_date then 'Formation commencée'
                      when a.payload->>'circuit' = 'participants' then 'Participants saisis entre-temps'
                      else 'Convention signée entre-temps' end
    from public.scheduled_actions a2
    left join public.sessions s on s.id = a2.session_id
   where a.id = a2.id and a2.kind = 'relance_circuit' and a2.status in ('a_valider', 'valide') and a2.envoi_reserve_at is null
     and (s.id is null or s.status = 'cancelled' or s.start_date <= current_date
          or (a2.payload->>'circuit' = 'participants' and exists (select 1 from public.session_trainees st where st.session_id = s.id))
          or (a2.payload->>'circuit' = 'convention' and coalesce(s.convention_signed, false)));
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
revoke all on function public.circuit_relances_ecarter() from public, anon, authenticated;
grant execute on function public.circuit_relances_ecarter() to service_role;

-- 6. Envoi automatique de la file (clé de service seule, route planifiée)
-- Conditions propres à l'automatique : préparée après le passage en automatique (le stock en attente reste à la main),
-- jamais remise à valider par une personne (validée puis revenue « à valider »), jamais refusée par le serveur de
-- messagerie (elle repartirait chaque jour), relance du circuit encore utile, session pas encore commencée
create or replace function app.relance_auto_eligible(a public.scheduled_actions)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select a.created_at >= coalesce((select s.mode_at from public.auto_send_switches s where s.company_id = a.company_id and s.kind = a.kind), 'infinity')
     and not (a.status = 'a_valider' and a.validated_at is not null)
     and coalesce(a.error, '') not like 'Adresse refusée par le serveur%'
     and (a.kind <> 'relance_circuit' or app.circuit_relance_utile(a.session_id, a.payload->>'circuit'))
     -- Relance liée à une session : jamais seule une fois la formation commencée (rappel « la veille » d'une session
     -- du lundi, préparé le dimanche, alors que la tâche d'envoi ne passe qu'en semaine)
     and (a.session_id is null or exists (select 1 from public.sessions s where s.id = a.session_id and s.start_date > current_date))
$$;
revoke all on function app.relance_auto_eligible(public.scheduled_actions) from public, anon, authenticated;
grant execute on function app.relance_auto_eligible(public.scheduled_actions) to service_role;

-- Relances qui peuvent partir seules aujourd'hui
create or replace function public.relances_auto_a_envoyer(p_limite integer default 30)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id from public.scheduled_actions a
   where a.status in ('a_valider', 'valide') and a.envoi_possible and a.blocked_reason is null and a.envoi_reserve_at is null
     and (a.due_on is null or a.due_on between current_date - 3 and current_date)
     and app.envoi_auto_autorise(a.company_id, a.kind)
     and app.relance_auto_eligible(a)
     and not exists (select 1 from public.demo_records r where r.tbl = 'scheduled_actions' and r.id = a.id)
   order by a.due_on nulls first, a.created_at
   limit greatest(1, least(coalesce(p_limite, 30), 100))
$$;
revoke all on function public.relances_auto_a_envoyer(integer) from public, anon, authenticated;
grant execute on function public.relances_auto_a_envoyer(integer) to service_role;

-- Réservation d'un envoi automatique : mêmes contrôles que relance_envoi_reserver, sans personne ; la relance passe
-- « à envoyer » (validée par la base, validated_by vide) et réservée. Refus : null (la route passe à la suivante).
create or replace function public.relance_auto_reserver(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare a public.scheduled_actions;
begin
  select * into a from public.scheduled_actions where id = p_id for update;
  if not found or a.status not in ('a_valider', 'valide') or not a.envoi_possible or a.blocked_reason is not null
     or a.envoi_reserve_at is not null or (a.due_on is not null and a.due_on not between current_date - 3 and current_date)
     or not app.envoi_auto_autorise(a.company_id, a.kind) or not app.relance_auto_eligible(a)
     or not app.financeur_email_valide(a.payload->>'destinataire')
     or coalesce(btrim(a.payload->>'texte'), '') = ''
     or exists (select 1 from public.demo_records r where r.tbl = 'scheduled_actions' and r.id = a.id) then
    return null;
  end if;
  perform set_config('app.relance_envoi', 'on', true);
  update public.scheduled_actions set status = 'valide', envoi_reserve_at = now(), envoi_reserve_par = null, error = null where id = a.id;
  -- Validée par la base, jamais au nom d'un compte (la règle d'état pose l'utilisateur connecté, s'il y en a un) ;
  -- une relance déjà validée par une personne garde sa validation
  if a.status = 'a_valider' then update public.scheduled_actions set validated_by = null where id = a.id; end if;
  perform set_config('app.relance_envoi', '', true);
  return jsonb_build_object('id', a.id, 'company_id', a.company_id, 'kind', a.kind,
    'destinataire', btrim(a.payload->>'destinataire'),
    'objet', coalesce(nullif(btrim(a.payload->>'objet'), ''), a.title),
    'texte', a.payload->>'texte');
end
$$;
revoke all on function public.relance_auto_reserver(uuid) from public, anon, authenticated;
grant execute on function public.relance_auto_reserver(uuid) to service_role;

-- Envoi à la main depuis la file : corps de 0518, plus le réglage et la situation du circuit revérifiés
create or replace function public.relance_envoi_reserver(p_id uuid, p_destinataire text, p_valide_le timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare a public.scheduled_actions;
begin
  if (select auth.uid()) is null then raise exception 'Connexion requise' using errcode = '42501'; end if;
  select * into a from public.scheduled_actions where id = p_id for update;
  if not found or a.company_id not in (select app.societes_avec_droit('formation.convocations.envoyer'))
     or a.company_id not in (select app.societes_ecriture()) then
    raise exception 'Relance introuvable, ou droit d''envoyer aux stagiaires et aux clients requis' using errcode = '42501';
  end if;
  if a.status <> 'valide' then
    raise exception 'Cette relance n''est plus à envoyer : la liste est mise à jour' using errcode = '22023';
  end if;
  if not a.envoi_possible then
    raise exception 'Cette relance ne s''envoie pas depuis l''outil : faites l''action indiquée, puis marquez-la' using errcode = '22023';
  end if;
  -- 0519 : type suspendu (ou fermé) dans la Console, relance du circuit devenue inutile
  if not app.envoi_ouvert(a.company_id, a.kind) then
    raise exception 'Envoi de ce type suspendu ou fermé dans la Console : rien ne part pour le moment' using errcode = '22023';
  end if;
  if a.kind = 'relance_circuit' and not app.circuit_relance_utile(a.session_id, a.payload->>'circuit') then
    raise exception 'Situation réglée depuis la préparation (participants saisis, convention signée ou formation commencée) : ignorez cette relance' using errcode = '22023';
  end if;
  if a.blocked_reason is not null then
    raise exception 'Relance bloquée : %', a.blocked_reason using errcode = '22023';
  end if;
  if a.envoi_reserve_at is not null then
    if a.envoi_reserve_at > now() - interval '10 minutes' then
      raise exception 'Envoi déjà en cours pour cette relance' using errcode = '22023';
    end if;
    raise exception 'Envoi précédent sans suite : vérifiez dans votre boîte d''envoi s''il est parti, puis marquez la relance envoyée ou remettez-la à valider' using errcode = '22023';
  end if;
  if not app.financeur_email_valide(a.payload->>'destinataire') then
    raise exception 'Adresse du destinataire absente ou invalide' using errcode = '22023';
  end if;
  if lower(btrim(a.payload->>'destinataire')) is distinct from lower(btrim(p_destinataire)) then
    raise exception 'Le destinataire a changé depuis l''aperçu : la liste est mise à jour' using errcode = '22023';
  end if;
  -- Validée de nouveau depuis l'aperçu (texte peut-être changé entre-temps) : nouvel aperçu
  if a.validated_at is distinct from p_valide_le then
    raise exception 'La relance a été modifiée depuis l''aperçu : ouvrez de nouveau « Voir le mail »' using errcode = '22023';
  end if;
  if coalesce(btrim(a.payload->>'texte'), '') = '' then
    raise exception 'Texte vide : rien à envoyer' using errcode = '22023';
  end if;
  perform set_config('app.relance_envoi', 'on', true);
  update public.scheduled_actions set envoi_reserve_at = now(), envoi_reserve_par = (select auth.uid()), error = null where id = a.id;
  perform set_config('app.relance_envoi', '', true);
  return jsonb_build_object('id', a.id, 'company_id', a.company_id, 'kind', a.kind,
    'destinataire', btrim(a.payload->>'destinataire'),
    'objet', coalesce(nullif(btrim(a.payload->>'objet'), ''), a.title),
    'texte', a.payload->>'texte');
end
$$;
revoke all on function public.relance_envoi_reserver(uuid, text, timestamptz) from public, anon;
grant execute on function public.relance_envoi_reserver(uuid, text, timestamptz) to authenticated;

-- 7. Questionnaires à froid
-- Réservation : corps de 0482 inchangé, sauf le réglage lu (ouvert = à valider)
create or replace function public.froid_envois_reserver(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v jsonb := '[]'::jsonb; e record; v_refus jsonb := '[]'::jsonb;
begin
  if (select auth.uid()) is null then raise exception 'Connexion requise' using errcode = '42501'; end if;
  if cardinality(p_ids) > 200 then raise exception 'Au plus 200 envois à la fois' using errcode = '22023'; end if;
  -- Une réservation à la fois par adresse : deux personnes qui envoient en même temps à la même adresse passent
  -- l'une après l'autre, la seconde voit la première « en cours » et attend le lendemain.
  -- Verrous pris dans l'ordre des adresses, pour que deux réservations ne s'attendent jamais l'une l'autre.
  perform pg_advisory_xact_lock(hashtextextended('froid_envoi:' || a.adresse, 0))
     from (select distinct lower(x.destinataire) as adresse from public.froid_envois x
            where x.id = any (p_ids) and x.destinataire is not null order by 1) a;
  for e in
    select x.* from public.froid_envois x where x.id = any (p_ids) order by x.session_id, x.destinataire for update
  loop
    if e.company_id not in (select app.societes_avec_droit('formation.convocations.envoyer')) then
      v_refus := v_refus || jsonb_build_object('id', e.id, 'raison', 'Droit d''envoyer aux stagiaires et aux clients requis'); continue;
    end if;
    if not app.envoi_ouvert(e.company_id, 'evaluation_froid') then
      v_refus := v_refus || jsonb_build_object('id', e.id, 'raison', 'Envoi « Questionnaires à froid » fermé dans la Console'); continue;
    end if;
    if e.statut <> 'prepare' then
      v_refus := v_refus || jsonb_build_object('id', e.id, 'raison', 'Déjà traité'); continue;
    end if;
    if not app.froid_email_valide(e.destinataire) then
      v_refus := v_refus || jsonb_build_object('id', e.id, 'raison', 'Adresse invalide'); continue;
    end if;
    -- Une adresse, un envoi par jour
    -- Seule exception : contact et employeur d'une même session choisis ensemble, qui partent dans un seul mail.
    -- Choisis en deux fois, la seconde attend le lendemain ; une autre session aussi.
    if exists (select 1 from public.froid_envois y where lower(y.destinataire) = lower(e.destinataire) and y.id <> e.id
        and not (e.cible <> 'stagiaire' and y.cible <> 'stagiaire' and y.session_id = e.session_id and y.id = any (p_ids)
                 and (y.statut = 'prepare' or (y.statut = 'en_cours' and y.reserve_le = now() and y.envoye_par = (select auth.uid()))))
        and (y.statut = 'en_cours' or (y.statut = 'envoye' and y.envoye_le > now() - interval '1 day'))) then
      v_refus := v_refus || jsonb_build_object('id', e.id, 'raison', 'Adresse déjà écrite depuis moins d''un jour'); continue;
    end if;
    if e.cible = 'stagiaire' and exists (select 1 from public.evaluations_cold ec where ec.session_id = e.session_id and ec.trainee_id = e.trainee_id and ec.completed_at is not null) then
      update public.froid_envois set statut = 'ignore', motif = 'Réponse reçue' where id = e.id;
      v_refus := v_refus || jsonb_build_object('id', e.id, 'raison', 'Réponse déjà reçue'); continue;
    end if;
    -- La session et la personne sont-elles toujours concernées ? (session terminée, ni sous-traitance ni autre organisme ;
    -- stagiaire inscrit et présent ; employeur client de la session ou d'un stagiaire présent). Sinon : refus sans toucher
    -- à la ligne, qui repart dès que la situation est corrigée (une absence notée par erreur, par exemple).
    if not exists (select 1 from public.sessions se left join public.clients oc on oc.id = se.client_id
                    where se.id = e.session_id and se.status = 'completed' and coalesce(se.session_type, 'intra') <> 'subcontract'
                      and coalesce(oc.client_type, '') <> 'organisme_formation')
       or (e.trainee_id is not null and not exists (select 1 from public.session_trainees st
                    where st.session_id = e.session_id and st.trainee_id = e.trainee_id and not coalesce(st.absent, false)))
       or (e.cible = 'employeur' and not exists (select 1 from public.sessions se where se.id = e.session_id and se.client_id = e.client_id)
           and not exists (select 1 from public.session_trainees st join public.trainees tr on tr.id = st.trainee_id
                    where st.session_id = e.session_id and tr.client_id = e.client_id and not coalesce(st.absent, false))) then
      v_refus := v_refus || jsonb_build_object('id', e.id, 'raison', 'Session ou stagiaire plus concerné (vérifiez la session, l''inscription ou la présence)'); continue;
    end if;
    update public.froid_envois set statut = 'en_cours', envoye_par = (select auth.uid()), reserve_le = now() where id = e.id;
    v := v || (select jsonb_build_object(
        'id', e.id, 'company_id', e.company_id, 'session_id', e.session_id, 'cible', e.cible, 'rang', e.rang,
        'destinataire', e.destinataire, 'destinataire_nom', e.destinataire_nom,
        'formation', co.title, 'debut', se.start_date, 'fin', coalesce(se.end_date, se.start_date), 'jeton', se.attendance_token,
        'prenom', tr.first_name, 'nom', tr.last_name, 'code', st.access_code, 'entreprise', cl.name)
      from public.sessions se left join public.courses co on co.id = se.course_id
      left join public.trainees tr on tr.id = e.trainee_id
      left join public.session_trainees st on st.session_id = e.session_id and st.trainee_id = e.trainee_id
      left join public.clients cl on cl.id = e.client_id
      where se.id = e.session_id);
  end loop;
  return jsonb_build_object('envois', v, 'refus', v_refus);
end
$$;
revoke all on function public.froid_envois_reserver(uuid[]) from public, anon;
grant execute on function public.froid_envois_reserver(uuid[]) to authenticated;

-- Fin d'envoi : clé de service seule (la route), au nom de la personne qui a réservé
drop function if exists public.froid_envoi_terminer(uuid, boolean, text, text, text);
create or replace function public.froid_envoi_terminer(p_id uuid, p_auteur uuid, p_ok boolean, p_message_id text default null, p_boite text default null, p_erreur text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare e public.froid_envois;
begin
  select * into e from public.froid_envois where id = p_id and statut = 'en_cours' and envoye_par = p_auteur for update;
  if e.id is null then raise exception 'Envoi introuvable ou déjà terminé' using errcode = '22023'; end if;
  if p_ok then
    update public.froid_envois set statut = 'envoye', envoye_le = now(), message_id = left(p_message_id, 300), boite = left(p_boite, 255), motif = null where id = p_id;
    if e.cible in ('stagiaire', 'contact') then
      insert into public.evaluations_cold (session_id, trainee_id, sent_at) values (e.session_id, e.trainee_id, now())
      on conflict (session_id, trainee_id) do update set sent_at = coalesce(public.evaluations_cold.sent_at, now())
       where public.evaluations_cold.completed_at is null;
      update public.session_trainees set cold_eval_sent_individual = true, cold_eval_sent_individual_date = coalesce(cold_eval_sent_individual_date, now())
       where session_id = e.session_id and trainee_id = e.trainee_id;
    end if;
  else
    update public.froid_envois set statut = 'erreur', motif = left(coalesce(p_erreur, 'Échec de l''envoi'), 300) where id = p_id;
  end if;
end
$$;
revoke all on function public.froid_envoi_terminer(uuid, uuid, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.froid_envoi_terminer(uuid, uuid, boolean, text, text, text) to service_role;

insert into public.schema_migrations (version) values ('0519_envois_reglages') on conflict (version) do nothing;
