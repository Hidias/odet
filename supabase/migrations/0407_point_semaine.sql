-- 0407 : actions de l'équipe, point de la semaine (lundi) et bilan (vendredi), décision de H du 21/10.
-- Reprend la fonction 19 (« rapport du lundi », spec Manager § 6) sous une forme utile au quotidien : un point
-- préparé tout seul à partir des données (urgent, à faire cette semaine, pas fait la semaine passée, à relancer,
-- bravo, anniversaires de relation client), que la direction complète ou allège, puis envoie à une liste choisie.
-- Le bilan du vendredi reprend le point : chaque ligne est marquée faite, reportée ou abandonnée ; ce qui est
-- reporté devient une action qui revient au point suivant.
--
--   1. team_actions : une seule table d'actions pour toute l'équipe (point, bilan, réunions, saisie libre).
--      Une action reportée garde le nombre de reports ; une action faite garde qui et quand.
--   2. weekly_briefs : le point et le bilan de chaque semaine (lignes figées au moment de la préparation,
--      choix de la direction conservés quand on actualise), et la trace de l'envoi.
--   3. weekly_brief_recipients : qui reçoit le point et qui reçoit le bilan (choisi dans les utilisateurs).
--   4. Préparation : public.point_semaine_preparer (à la demande) et public.point_semaine_generer (chaque nuit :
--      le lundi pour le point, le vendredi pour le bilan, seulement là où des destinataires sont choisis).
--      Rien n'est envoyé automatiquement : une notification prévient que le point est prêt.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0407_point_semaine_retour.sql

-- ── 1. Actions de l'équipe ──
create table if not exists public.team_actions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  title text not null check (length(btrim(title)) between 2 and 300),
  detail text check (detail is null or length(detail) <= 2000),
  owner_id uuid references public.profiles(id) on delete set null,
  due_on date,
  status text not null default 'a_faire' check (status in ('a_faire', 'fait', 'abandonne')),
  urgent boolean not null default false,
  postponed_count integer not null default 0 check (postponed_count >= 0),
  source text not null default 'manuel' check (source in ('manuel', 'point', 'bilan', 'reunion')),
  source_id uuid,
  client_id uuid references public.clients(id) on delete cascade,
  link text check (link is null or (link ~ '^/[A-Za-z0-9]' and length(link) <= 300)),
  done_at timestamptz,
  done_by uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists team_actions_company_idx on public.team_actions (company_id, status, due_on);
create index if not exists team_actions_owner_idx on public.team_actions (owner_id, status, due_on);
create index if not exists team_actions_client_idx on public.team_actions (client_id);
comment on table public.team_actions is 'Actions de l''équipe (point de la semaine, bilan, réunions, saisie libre) : responsable, échéance, reports';

create or replace function app.team_actions_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.postponed_count := 0;
  else
    new.company_id := old.company_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.source := old.source;
    new.source_id := old.source_id;
    -- Report : l'échéance d'une action à faire recule
    new.postponed_count := old.postponed_count;
    if old.status = 'a_faire' and new.status = 'a_faire' and old.due_on is not null and new.due_on > old.due_on then
      new.postponed_count := old.postponed_count + 1;
    end if;
  end if;
  if new.status = 'fait' and (tg_op = 'INSERT' or old.status <> 'fait') then
    new.done_at := now();
    new.done_by := auth.uid();
  elsif new.status <> 'fait' then
    new.done_at := null;
    new.done_by := null;
  else
    new.done_at := old.done_at;
    new.done_by := old.done_by;
  end if;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function app.team_actions_maj() from public, anon, authenticated;
drop trigger if exists team_actions_maj on public.team_actions;
create trigger team_actions_maj before insert or update on public.team_actions
  for each row execute function app.team_actions_maj();

-- ── 2. Point et bilan de la semaine ──
create table if not exists public.weekly_briefs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  kind text not null check (kind in ('point', 'bilan')),
  lines jsonb not null default '[]'::jsonb check (jsonb_typeof(lines) = 'array'),
  note text check (note is null or length(note) <= 4000),
  prepared_at timestamptz,
  prepared_by uuid,
  sent_at timestamptz,
  sent_by uuid,
  sent_to jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, week_start, kind)
);
comment on table public.weekly_briefs is 'Point du lundi et bilan du vendredi : lignes préparées, choix de la direction, trace de l''envoi';

create or replace function app.weekly_briefs_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.company_id := old.company_id;
    new.week_start := old.week_start;
    new.kind := old.kind;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function app.weekly_briefs_maj() from public, anon, authenticated;
drop trigger if exists weekly_briefs_maj on public.weekly_briefs;
create trigger weekly_briefs_maj before insert or update on public.weekly_briefs
  for each row execute function app.weekly_briefs_maj();

-- ── 3. Destinataires ──
create table if not exists public.weekly_brief_recipients (
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  point boolean not null default false,
  bilan boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (company_id, profile_id)
);
comment on table public.weekly_brief_recipients is 'Qui reçoit le point du lundi et le bilan du vendredi (choisi dans les utilisateurs)';

-- ── 4. Préparation ──
-- Montant lisible : 1 234,50 €
create or replace function app.euros(p numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p is null then '' else
    replace(replace(to_char(round(p, 2), 'FM999,999,999,990.00'), ',', ' '), '.', ',') || ' €' end
$$;

create or replace function app.nom_profil(p_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email)
  from public.profiles p where p.id = p_id
$$;
revoke all on function app.nom_profil(uuid) from public, anon, authenticated;

-- Lignes préparées à partir des données d'une société, pour la semaine qui commence le lundi p_week.
-- Point : bravo de la semaine passée. Bilan : bravo de la semaine en cours, lignes du point reprises.
create or replace function app.point_lignes(p_company uuid, p_week date, p_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  w date := p_week;
  e date := p_week + 6;
  t date := (now() at time zone 'Europe/Paris')::date;
  b1 date := case when p_kind = 'bilan' then p_week else p_week - 7 end;
  b2 date := case when p_kind = 'bilan' then p_week + 6 else p_week - 1 end;
  v jsonb := '[]'::jsonb;
  v_point jsonb;
begin
  -- Bilan : les lignes du point de la semaine (gardées), puis les actions de la semaine et le bravo
  if p_kind = 'bilan' then
    select coalesce(jsonb_agg(l - 'retire' - 'suite'), '[]'::jsonb) into v_point
    from public.weekly_briefs wb, jsonb_array_elements(wb.lines) l
    where wb.company_id = p_company and wb.week_start = w and wb.kind = 'point'
      and coalesce((l->>'retire')::boolean, false) = false and l->>'section' not in ('bravo', 'anniversaire');
    v := v || v_point;
    v := v || coalesce((select jsonb_agg(x.l order by x.d) from (
      select a.due_on d, jsonb_build_object('id', 'act:' || a.id, 'section', 'semaine', 'action_id', a.id,
        'texte', a.title || coalesce(' (' || c.name || ')', ''), 'lien', coalesce(a.link, '/actions'),
        'owner_id', a.owner_id, 'owner_nom', app.nom_profil(a.owner_id),
        'suite', case a.status when 'fait' then 'fait' when 'abandonne' then 'abandonne' end) l
      from public.team_actions a left join public.clients c on c.id = a.client_id
      where a.company_id = p_company and a.due_on between w and e
        and not exists (select 1 from jsonb_array_elements(v_point) p where p->>'action_id' = a.id::text or p->>'id' = 'act:' || a.id)
      limit 40) x), '[]'::jsonb);
  else
    -- Urgent : factures en retard
    v := v || coalesce((select jsonb_agg(x.l order by x.d) from (
      select i.due_date d, jsonb_build_object('id', 'inv:' || i.id, 'section', 'urgent',
        'texte', format('Facture %s (%s) en retard de %s jours : %s dus', i.reference, c.name, t - i.due_date, app.euros(i.amount_due)),
        'lien', '/factures?open=' || i.id, 'owner_id', c.owner_id, 'owner_nom', app.nom_profil(c.owner_id)) l
      from public.invoices i join public.clients c on c.id = i.client_id
      where i.company_id = p_company and i.issued_at is not null and i.type = 'invoice' and i.due_date < t and i.amount_due > 0
      order by i.due_date limit 25) x), '[]'::jsonb);
    -- Urgent : conventions non signées à moins de 7 jours
    v := v || coalesce((select jsonb_agg(x.l order by x.d) from (
      select s.start_date d, jsonb_build_object('id', 'conv:' || s.id, 'section', 'urgent',
        'texte', format('Convention non signée : %s%s, session du %s', coalesce(co.title, 'session'), coalesce(' chez ' || c.name, ''), to_char(s.start_date, 'DD/MM')),
        'lien', '/sessions/' || s.id, 'owner_id', c.owner_id, 'owner_nom', app.nom_profil(c.owner_id)) l
      from public.sessions s left join public.courses co on co.id = s.course_id left join public.clients c on c.id = s.client_id
      where s.company_id = p_company and s.client_id is not null and s.start_date between t and t + 7
        and coalesce(s.convention_signed, false) = false and coalesce(s.status, '') not in ('cancelled', 'annulee')
      order by s.start_date limit 25) x), '[]'::jsonb);
    -- Urgent : affaires dont la prochaine action est dépassée
    v := v || coalesce((select jsonb_agg(x.l order by x.d) from (
      select o.next_action_on d, jsonb_build_object('id', 'opp:' || o.id, 'section', 'urgent',
        'texte', format('Affaire en retard : %s (%s)%s, prévu le %s', o.title, c.name, coalesce(', ' || nullif(btrim(o.next_action), ''), ''), to_char(o.next_action_on, 'DD/MM')),
        'lien', '/affaires', 'owner_id', o.owner_id, 'owner_nom', app.nom_profil(o.owner_id)) l
      from public.opportunities o join public.clients c on c.id = o.client_id
      where o.company_id = p_company and o.stage not in ('gagnee', 'perdue') and o.next_action_on < w
      order by o.next_action_on limit 25) x), '[]'::jsonb);
    -- Cette semaine : sessions, visites, affaires, actions
    v := v || coalesce((select jsonb_agg(x.l order by x.d) from (
      select s.start_date d, jsonb_build_object('id', 'ses:' || s.id, 'section', 'semaine',
        'texte', format('Session %s%s, du %s', coalesce(co.title, ''), coalesce(' (' || c.name || ')', ' (inter)'), to_char(s.start_date, 'DD/MM')),
        'lien', '/sessions/' || s.id) l
      from public.sessions s left join public.courses co on co.id = s.course_id left join public.clients c on c.id = s.client_id
      where s.company_id = p_company and s.start_date between w and e and coalesce(s.status, '') not in ('cancelled', 'annulee')
      order by s.start_date limit 30) x), '[]'::jsonb);
    v := v || coalesce((select jsonb_agg(x.l order by x.d) from (
      select vi.planned_on d, jsonb_build_object('id', 'itv:' || vi.id, 'section', 'semaine',
        'texte', format('Visite %s chez %s, le %s', coalesce(vi.reference, ''), c.name, to_char(vi.planned_on, 'DD/MM')),
        'lien', '/interventions/visite/' || vi.id, 'owner_id', p.id, 'owner_nom', app.nom_profil(p.id)) l
      from public.itv_visits vi join public.clients c on c.id = vi.client_id left join public.profiles p on p.id = vi.technician_id
      where vi.company_id = p_company and vi.planned_on between w and e and coalesce(vi.status, '') not in ('terminee', 'annulee')
      order by vi.planned_on limit 30) x), '[]'::jsonb);
    v := v || coalesce((select jsonb_agg(x.l order by x.d) from (
      select o.next_action_on d, jsonb_build_object('id', 'opp:' || o.id, 'section', 'semaine',
        'texte', format('Affaire %s (%s)%s, le %s', o.title, c.name, coalesce(' : ' || nullif(btrim(o.next_action), ''), ''), to_char(o.next_action_on, 'DD/MM')),
        'lien', '/affaires', 'owner_id', o.owner_id, 'owner_nom', app.nom_profil(o.owner_id)) l
      from public.opportunities o join public.clients c on c.id = o.client_id
      where o.company_id = p_company and o.stage not in ('gagnee', 'perdue') and o.next_action_on between w and e
      order by o.next_action_on limit 25) x), '[]'::jsonb);
    v := v || coalesce((select jsonb_agg(x.l order by x.d) from (
      select a.due_on d, jsonb_build_object('id', 'act:' || a.id, 'section', case when a.urgent then 'urgent' else 'semaine' end, 'action_id', a.id,
        'texte', a.title || coalesce(' (' || c.name || ')', ''), 'lien', coalesce(a.link, '/actions'),
        'owner_id', a.owner_id, 'owner_nom', app.nom_profil(a.owner_id)) l
      from public.team_actions a left join public.clients c on c.id = a.client_id
      where a.company_id = p_company and a.status = 'a_faire' and (a.due_on between w and e or (a.due_on is null and a.urgent))
      order by a.due_on limit 40) x), '[]'::jsonb);
    -- Pas fait : actions à faire dont l'échéance est passée
    v := v || coalesce((select jsonb_agg(x.l order by x.d) from (
      select a.due_on d, jsonb_build_object('id', 'act:' || a.id, 'section', 'non_fait', 'action_id', a.id,
        'texte', format('%s%s, prévu le %s%s', a.title, coalesce(' (' || c.name || ')', ''), to_char(a.due_on, 'DD/MM'),
          case when a.postponed_count > 0 then format(', reporté %s fois', a.postponed_count) else '' end),
        'lien', coalesce(a.link, '/actions'), 'owner_id', a.owner_id, 'owner_nom', app.nom_profil(a.owner_id)) l
      from public.team_actions a left join public.clients c on c.id = a.client_id
      where a.company_id = p_company and a.status = 'a_faire' and a.due_on < w
      order by a.due_on limit 40) x), '[]'::jsonb);
    -- À relancer : devis envoyés sans réponse
    v := v || coalesce((select jsonb_agg(x.l order by x.d) from (
      select q.quote_date d, jsonb_build_object('id', 'quo:' || q.id, 'section', 'relancer',
        'texte', format('Devis %s (%s) envoyé le %s, %s HT', q.reference, c.name, to_char(q.quote_date, 'DD/MM'), app.euros(q.total_ht)),
        'lien', '/devis?open=' || q.id, 'owner_id', c.owner_id, 'owner_nom', app.nom_profil(c.owner_id)) l
      from public.quotes q join public.clients c on c.id = q.client_id
      where q.company_id = p_company and q.status in ('sent', 'partial')
        and coalesce(q.next_followup_date, q.quote_date + 15) <= e
      order by q.quote_date limit 25) x), '[]'::jsonb);
    -- Anniversaires de la relation : première facture émise, il y a un an ou plus, cette semaine
    v := v || coalesce((select jsonb_agg(x.l order by x.d) from (
      select (f.d + make_interval(years => n))::date d, jsonb_build_object('id', 'anniv:' || c.id, 'section', 'anniversaire',
        'texte', format('Client depuis %s an%s : %s (première facture le %s)', n, case when n > 1 then 's' else '' end, c.name, to_char(f.d, 'DD/MM/YYYY')),
        'lien', '/clients/' || c.id, 'owner_id', c.owner_id, 'owner_nom', app.nom_profil(c.owner_id)) l
      from (select i.client_id, min((i.issued_at at time zone 'Europe/Paris')::date) d
            from public.invoices i where i.company_id = p_company and i.issued_at is not null and i.type = 'invoice' group by 1) f
      join public.clients c on c.id = f.client_id
      cross join lateral unnest(array[extract(year from w)::int - extract(year from f.d)::int,
                                      extract(year from e)::int - extract(year from f.d)::int]) n
      where n >= 1 and (f.d + make_interval(years => n))::date between w and e
      limit 25) x), '[]'::jsonb);
  end if;

  -- Bravo : affaires gagnées, paiements reçus, sessions réalisées, visites terminées
  v := v || coalesce((select jsonb_agg(x.l order by x.d) from (
    select o.closed_at d, jsonb_build_object('id', 'won:' || o.id, 'section', 'bravo',
      'texte', format('Affaire gagnée : %s (%s)%s', o.title, c.name, coalesce(', ' || app.euros(o.amount_ht) || ' HT', '')),
      'lien', '/affaires', 'owner_id', o.owner_id, 'owner_nom', app.nom_profil(o.owner_id)) l
    from public.opportunities o join public.clients c on c.id = o.client_id
    where o.company_id = p_company and o.stage = 'gagnee' and (o.closed_at at time zone 'Europe/Paris')::date between b1 and b2
    limit 25) x), '[]'::jsonb);
  v := v || coalesce((select jsonb_agg(jsonb_build_object('id', 'pay:' || b1, 'section', 'bravo',
      'texte', format('%s paiement%s reçu%s, %s', n, case when n > 1 then 's' else '' end, case when n > 1 then 's' else '' end, app.euros(s)),
      'lien', '/factures'))
    from (select count(*) n, sum(p.amount) s from public.invoice_payments p
          where p.company_id = p_company and p.payment_date between b1 and b2 and p.amount > 0) y where n > 0), '[]'::jsonb);
  v := v || coalesce((select jsonb_agg(jsonb_build_object('id', 'sesok:' || b1, 'section', 'bravo',
      'texte', format('%s session%s de formation réalisée%s', n, case when n > 1 then 's' else '' end, case when n > 1 then 's' else '' end),
      'lien', '/sessions'))
    from (select count(*) n from public.sessions s
          where s.company_id = p_company and s.end_date between b1 and b2 and coalesce(s.status, '') not in ('cancelled', 'annulee')) y where n > 0), '[]'::jsonb);
  v := v || coalesce((select jsonb_agg(jsonb_build_object('id', 'itvok:' || b1, 'section', 'bravo',
      'texte', format('%s visite%s de maintenance terminée%s', n, case when n > 1 then 's' else '' end, case when n > 1 then 's' else '' end),
      'lien', '/interventions'))
    from (select count(*) n from public.itv_visits vi
          where vi.company_id = p_company and vi.status = 'terminee' and (vi.finished_at at time zone 'Europe/Paris')::date between b1 and b2) y where n > 0), '[]'::jsonb);

  -- Une ligne n'apparaît qu'une fois (la première section l'emporte)
  return coalesce((select jsonb_agg(l order by o) from (
    select distinct on (l->>'id') l, o from jsonb_array_elements(v) with ordinality a(l, o) order by l->>'id', o) z), '[]'::jsonb);
end
$$;
revoke all on function app.point_lignes(uuid, date, text) from public, anon, authenticated;

-- Prépare ou actualise : lignes recalculées, choix conservés (ligne retirée, suite, action liée, note), lignes
-- ajoutées à la main gardées telles quelles
create or replace function app.point_preparer(p_company uuid, p_week date, p_kind text, p_by uuid)
returns public.weekly_briefs
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  w date := date_trunc('week', p_week)::date;
  v_old jsonb;
  v_new jsonb;
  r public.weekly_briefs;
begin
  if p_kind not in ('point', 'bilan') then raise exception 'Type inconnu' using errcode = '22023'; end if;
  select lines into v_old from public.weekly_briefs where company_id = p_company and week_start = w and kind = p_kind;
  v_old := coalesce(v_old, '[]'::jsonb);
  select coalesce(jsonb_agg(a.l || coalesce((
      select jsonb_strip_nulls(jsonb_build_object('retire', o->'retire', 'suite', o->'suite', 'action_id', o->'action_id', 'note', o->'note'))
      from jsonb_array_elements(v_old) o where o->>'id' = a.l->>'id' limit 1), '{}'::jsonb) order by a.n), '[]'::jsonb)
    into v_new
  from jsonb_array_elements(app.point_lignes(p_company, w, p_kind)) with ordinality a(l, n);
  v_new := v_new || coalesce((select jsonb_agg(o) from jsonb_array_elements(v_old) o
                              where coalesce((o->>'manuel')::boolean, false)
                                and not exists (select 1 from jsonb_array_elements(v_new) x where x->>'id' = o->>'id')), '[]'::jsonb);
  insert into public.weekly_briefs (company_id, week_start, kind, lines, prepared_at, prepared_by)
  values (p_company, w, p_kind, v_new, now(), p_by)
  on conflict (company_id, week_start, kind) do update set lines = excluded.lines, prepared_at = now(), prepared_by = p_by
  returning * into r;
  return r;
end
$$;
revoke all on function app.point_preparer(uuid, date, text, uuid) from public, anon, authenticated;

-- À la demande (page Point de la semaine) : société courante, droit du cockpit de direction
create or replace function public.point_semaine_preparer(p_week date default null, p_kind text default 'point')
returns public.weekly_briefs
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_company uuid := app.current_company();
begin
  if v_company is null then raise exception 'Choisissez une société' using errcode = '42501'; end if;
  if not app.a_le_droit('manager.cockpit.voir') then raise exception 'Accès refusé' using errcode = '42501'; end if;
  return app.point_preparer(v_company, coalesce(p_week, (now() at time zone 'Europe/Paris')::date), p_kind, auth.uid());
end
$$;
revoke all on function public.point_semaine_preparer(date, text) from public, anon;
grant execute on function public.point_semaine_preparer(date, text) to authenticated;

-- Chaque nuit (maintenance de nuit) : le lundi le point, le vendredi le bilan, dans les sociétés qui ont choisi des
-- destinataires ; une notification prévient. Rien n'est envoyé. Une préparation déjà faite n'est pas refaite.
create or replace function public.point_semaine_generer(p_jour date default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  d date := coalesce(p_jour, (now() at time zone 'Europe/Paris')::date);
  k text := case extract(isodow from d) when 1 then 'point' when 5 then 'bilan' end;
  w date := date_trunc('week', d)::date;
  c uuid;
  n int := 0;
begin
  if k is null then return jsonb_build_object('prepares', 0); end if;
  for c in select distinct r.company_id from public.weekly_brief_recipients r
           where (k = 'point' and r.point) or (k = 'bilan' and r.bilan) loop
    if not exists (select 1 from public.weekly_briefs b where b.company_id = c and b.week_start = w and b.kind = k) then
      perform app.point_preparer(c, w, k, null);
      insert into public.notifications (type, title, message, link, company_id)
      values ('point_semaine', case k when 'point' then 'Point de la semaine prêt' else 'Bilan de la semaine prêt' end,
              'À relire, compléter et envoyer aux destinataires choisis.', '/point-semaine?semaine=' || w || '&type=' || k, c);
      n := n + 1;
    end if;
  end loop;
  return jsonb_build_object('prepares', n, 'type', k);
end
$$;
revoke all on function public.point_semaine_generer(date) from public, anon, authenticated;
grant execute on function public.point_semaine_generer(date) to service_role;

-- Règles d'accès (générées par scripts/securite/regles.py, build_suite('0407'))


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
           where schemaname = 'public' and tablename = any (array['team_actions', 'weekly_brief_recipients', 'weekly_briefs'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- team_actions
select pg_temp.regles(array['team_actions'], null,
  $r$(company_id in (select app.societes_avec_droit('manager.cockpit.voir')) or (company_id in (select app.visible_companies()) and (owner_id = (select auth.uid()) or created_by = (select auth.uid()))))$r$,
  $r$company_id in (select app.visible_companies())$r$,
  $r$(company_id in (select app.societes_avec_droit('manager.cockpit.voir')) or (company_id in (select app.visible_companies()) and (owner_id = (select auth.uid()) or created_by = (select auth.uid()))))$r$,
  $r$(company_id in (select app.societes_avec_droit('manager.cockpit.voir')) or (company_id in (select app.visible_companies()) and created_by = (select auth.uid())))$r$);

-- weekly_brief_recipients
select pg_temp.regles(array['weekly_brief_recipients'], null,
  $r$((company_id in (select app.societes_avec_droit('manager.cockpit.voir')) or company_id in (select app.societes_avec_droit('parametres.utilisateurs.gerer'))) or profile_id = (select auth.uid()))$r$,
  $r$(company_id in (select app.societes_avec_droit('manager.cockpit.voir')) or company_id in (select app.societes_avec_droit('parametres.utilisateurs.gerer')))$r$,
  $r$(company_id in (select app.societes_avec_droit('manager.cockpit.voir')) or company_id in (select app.societes_avec_droit('parametres.utilisateurs.gerer')))$r$,
  $r$(company_id in (select app.societes_avec_droit('manager.cockpit.voir')) or company_id in (select app.societes_avec_droit('parametres.utilisateurs.gerer')))$r$);

-- weekly_briefs
select pg_temp.regles(array['weekly_briefs'], null,
  $r$company_id in (select app.societes_avec_droit('manager.cockpit.voir'))$r$,
  $r$company_id in (select app.societes_avec_droit('manager.cockpit.voir'))$r$,
  $r$company_id in (select app.societes_avec_droit('manager.cockpit.voir'))$r$,
  $r$company_id in (select app.societes_avec_droit('manager.cockpit.voir'))$r$);


insert into public.schema_migrations (version) values ('0407_point_semaine') on conflict (version) do nothing;
