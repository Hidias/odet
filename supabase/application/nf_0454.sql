-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (nf_0454) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0454_frais_formateur.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0454_frais_formateur_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0454_frais_formateur.sql =====
-- 0454 : notes de frais du formateur (pilotage de H du 24/10, partie 5 e ; piste 16 « espace formateur : … notes de
-- frais »). Le formateur externe déclare ses frais depuis son espace (photo du ticket, session concernée), l'organisme
-- les valide ou les refuse avec un motif, puis note le remboursement. Rien n'est ressaisi : la note, le justificatif et
-- la décision restent ensemble ; le formateur suit l'état de chacune.
--   1. trainer_expenses : une note par dépense (date, nature, montant TTC, kilomètres, session, justificatif, état).
--      Lue par qui gère les coûts des sessions ; écrite par le formateur seulement par les fonctions ext_frais_* ;
--      décision par qui gère les coûts (garde : soumise → validée ou refusée avec motif, validée → remboursée).
--   2. Bucket privé « frais » : chemin société/formateur/fichier ; le formateur dépose et relit les siens.
--   3. Espace formateur : public.ext_frais, public.ext_frais_ajouter, public.ext_frais_annuler ; notification à
--      l'organisme à chaque note.
-- Le montant des kilomètres est donné par le formateur (aucun barème supposé). Migration additive. Idempotente.
-- Retour arrière : supabase/rollback/0454_frais_formateur_retour.sql

create table if not exists public.trainer_expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  trainer_id uuid not null references public.trainers(id) on delete cascade,
  session_id uuid references public.sessions(id) on delete set null,
  spent_on date not null,
  category text not null check (category in ('kilometres', 'transport', 'repas', 'hebergement', 'parking_peage', 'materiel', 'autre')),
  amount_ttc numeric(10,2) not null check (amount_ttc > 0 and amount_ttc <= 10000),
  km numeric(8,1) check (km is null or (km > 0 and km <= 5000)),
  description text check (description is null or length(description) <= 500),
  receipt_path text check (receipt_path is null or length(receipt_path) <= 300),
  status text not null default 'soumise' check (status in ('soumise', 'validee', 'refusee', 'remboursee', 'annulee')),
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  decided_by uuid,
  decided_at timestamptz,
  paid_on date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists trainer_expenses_trainer_idx on public.trainer_expenses (trainer_id, spent_on desc);
create index if not exists trainer_expenses_company_idx on public.trainer_expenses (company_id, status);
comment on table public.trainer_expenses is 'Notes de frais du formateur : déclarées depuis son espace, validées ou refusées par l''organisme, puis remboursées';

-- Décision tenue par la base : seuls l'état, le motif et la date de remboursement changent, dans le bon ordre
create or replace function app.frais_garde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.company_id, new.trainer_id, new.session_id, new.spent_on, new.category, new.amount_ttc, new.km, new.description, new.receipt_path, new.created_by, new.created_at)
     is distinct from (old.company_id, old.trainer_id, old.session_id, old.spent_on, old.category, old.amount_ttc, old.km, old.description, old.receipt_path, old.created_by, old.created_at) then
    raise exception 'Une note de frais déclarée ne se modifie pas : refusez-la avec un motif' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'soumise' and new.status in ('validee', 'refusee', 'annulee'))
         or (old.status = 'validee' and new.status in ('remboursee', 'soumise'))
         or (old.status = 'refusee' and new.status = 'soumise')) then
      raise exception 'Passage impossible de « % » à « % »', old.status, new.status using errcode = '23514';
    end if;
    if new.status = 'refusee' and length(btrim(coalesce(new.decision_note, ''))) < 3 then
      raise exception 'Indiquez le motif du refus' using errcode = '23514';
    end if;
    if new.status = 'remboursee' and new.paid_on is null then new.paid_on := public.paris_today(); end if;
    if new.status = 'soumise' then new.decided_by := null; new.decided_at := null; new.paid_on := null;
    else new.decided_by := (select auth.uid()); new.decided_at := now(); end if;
  end if;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function app.frais_garde() from public, anon, authenticated;
drop trigger if exists trainer_expenses_garde on public.trainer_expenses;
create trigger trainer_expenses_garde before update on public.trainer_expenses for each row execute function app.frais_garde();
drop trigger if exists zz_audit_row on public.trainer_expenses;
create trigger zz_audit_row after insert or update or delete on public.trainer_expenses for each row execute function app.audit_row('formation');

alter table public.trainer_expenses enable row level security;
revoke all on table public.trainer_expenses from public, anon;
grant all on table public.trainer_expenses to service_role;
grant select, update on table public.trainer_expenses to authenticated;

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

drop policy if exists trainer_expenses_lire on public.trainer_expenses;
drop policy if exists trainer_expenses_modifier on public.trainer_expenses;
-- Lues et décidées par qui gère les coûts des sessions ; déclarées seulement par les fonctions de l'espace formateur
select pg_temp.regles(array['trainer_expenses'], null,
  $r$company_id in (select app.societes_avec_droit('formation.couts.gerer'))$r$,
  null,
  $r$company_id in (select app.societes_avec_droit('formation.couts.gerer'))$r$,
  null);
drop policy if exists trainer_expenses_societe_lire on public.trainer_expenses;
drop policy if exists trainer_expenses_societe_modifier on public.trainer_expenses;
create policy trainer_expenses_societe_lire on public.trainer_expenses as restrictive for select to authenticated
  using (company_id in (select app.societes_lisibles()));
create policy trainer_expenses_societe_modifier on public.trainer_expenses as restrictive for update to authenticated
  using (company_id in (select app.societes_ecriture())) with check (company_id in (select app.societes_ecriture()));

-- ── 2. Justificatifs : bucket privé « frais », chemin société/formateur/fichier ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('frais', 'frais', false, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do nothing;

-- Formateur externe du compte connecté (sans erreur), et sa société
create or replace function app.ext_formateur_ou_null()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.trainer_id from public.profiles p
  where p.id = (select auth.uid()) and p.role = 'formateur_externe' and coalesce(p.is_active, true) and p.trainer_id is not null
$$;
revoke all on function app.ext_formateur_ou_null() from public, anon;
grant execute on function app.ext_formateur_ou_null() to authenticated;

create or replace function app.ext_formateur_societe()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.company_id from public.trainers t where t.id = (select app.ext_formateur_ou_null())
$$;
revoke all on function app.ext_formateur_societe() from public, anon;
grant execute on function app.ext_formateur_societe() to authenticated;

drop policy if exists frais_lire on storage.objects;
drop policy if exists frais_creer on storage.objects;
create policy frais_lire on storage.objects for select to authenticated
  using (bucket_id = 'frais' and (
    (storage.foldername(name))[1] in (select x::text from app.societes_avec_droit('formation.couts.gerer') x)
    or (storage.foldername(name))[2] = (select app.ext_formateur_ou_null())::text));
create policy frais_creer on storage.objects for insert to authenticated
  with check (bucket_id = 'frais'
    and (storage.foldername(name))[2] = (select app.ext_formateur_ou_null())::text
    and (storage.foldername(name))[1] = (select app.ext_formateur_societe())::text);

-- ── 3. Espace formateur ──
create or replace function public.ext_frais()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_t uuid := app.ext_formateur();
begin
  return jsonb_build_object(
    'company_id', (select t.company_id from public.trainers t where t.id = v_t),
    'trainer_id', v_t,
    'frais', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'spent_on', e.spent_on, 'category', e.category, 'amount_ttc', e.amount_ttc, 'km', e.km,
               'description', e.description, 'receipt_path', e.receipt_path, 'status', e.status, 'decision_note', e.decision_note,
               'decided_at', e.decided_at, 'paid_on', e.paid_on, 'created_at', e.created_at,
               'session', case when e.session_id is null then null else (select jsonb_build_object('id', s.id, 'reference', s.reference,
                 'title', (select co.title from public.courses co where co.id = s.course_id)) from public.sessions s where s.id = e.session_id) end)
             order by e.spent_on desc, e.created_at desc)
      from public.trainer_expenses e where e.trainer_id = v_t), '[]'::jsonb));
end
$$;
revoke all on function public.ext_frais() from public, anon;
grant execute on function public.ext_frais() to authenticated;

create or replace function public.ext_frais_ajouter(p_spent_on date, p_category text, p_amount numeric, p_km numeric default null,
  p_session_id uuid default null, p_description text default null, p_receipt_path text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t uuid := app.ext_formateur();
  v_co uuid;
  v_nom text;
  v_id uuid;
begin
  select t.company_id, btrim(coalesce(t.first_name, '') || ' ' || coalesce(t.last_name, '')) into v_co, v_nom from public.trainers t where t.id = v_t;
  if p_spent_on is null or p_spent_on > public.paris_today() or p_spent_on < public.paris_today() - 365 then
    raise exception 'Date de la dépense : dans les 12 derniers mois, pas dans le futur' using errcode = '22023';
  end if;
  if p_category is null or p_category not in ('kilometres', 'transport', 'repas', 'hebergement', 'parking_peage', 'materiel', 'autre') then
    raise exception 'Nature de la dépense inconnue' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 10000 then
    raise exception 'Montant entre 0,01 et 10 000 €' using errcode = '22023';
  end if;
  if p_category = 'kilometres' and (p_km is null or p_km <= 0 or p_km > 5000) then
    raise exception 'Indiquez les kilomètres parcourus' using errcode = '22023';
  end if;
  if p_category <> 'kilometres' and p_receipt_path is null then
    raise exception 'Ajoutez la photo du ticket ou de la facture' using errcode = '22023';
  end if;
  if p_receipt_path is not null and p_receipt_path not like v_co::text || '/' || v_t::text || '/%' then
    raise exception 'Justificatif invalide' using errcode = '42501';
  end if;
  if p_session_id is not null and not app.ext_formateur_de(p_session_id) then
    raise exception 'Session inconnue' using errcode = '42501';
  end if;
  if p_category = 'autre' and length(btrim(coalesce(p_description, ''))) < 3 then
    raise exception 'Précisez la dépense' using errcode = '22023';
  end if;
  insert into public.trainer_expenses (company_id, trainer_id, session_id, spent_on, category, amount_ttc, km, description, receipt_path)
  values (v_co, v_t, p_session_id, p_spent_on, p_category, round(p_amount, 2), case when p_category = 'kilometres' then p_km end,
          nullif(btrim(coalesce(p_description, '')), ''), p_receipt_path)
  returning id into v_id;
  insert into public.notifications (company_id, type, title, message, link, metadata)
  values (v_co, 'frais_formateur', 'Note de frais : ' || coalesce(nullif(v_nom, ''), 'formateur'),
    to_char(round(p_amount, 2), 'FM999G990D00') || ' € du ' || to_char(p_spent_on, 'DD/MM/YYYY') || ', à valider',
    '/formateurs', jsonb_build_object('trainer_id', v_t, 'expense_id', v_id));
  return v_id;
end
$$;
revoke all on function public.ext_frais_ajouter(date, text, numeric, numeric, uuid, text, text) from public, anon;
grant execute on function public.ext_frais_ajouter(date, text, numeric, numeric, uuid, text, text) to authenticated;

create or replace function public.ext_frais_annuler(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_t uuid := app.ext_formateur();
begin
  update public.trainer_expenses set status = 'annulee' where id = p_id and trainer_id = v_t and status = 'soumise';
  if not found then raise exception 'Seule une note pas encore traitée peut être annulée' using errcode = '22023'; end if;
end
$$;
revoke all on function public.ext_frais_annuler(uuid) from public, anon;
grant execute on function public.ext_frais_annuler(uuid) to authenticated;

insert into public.schema_migrations (version) values ('0454_frais_formateur') on conflict (version) do nothing;
