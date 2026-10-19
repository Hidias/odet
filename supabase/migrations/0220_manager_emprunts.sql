-- 0220_manager_emprunts.sql : module Manager, emprunts et crédits (spec odet-spec-manager.md § 5, note de Léandra :
-- « Ajouter l'échéancier et l'évolution des crédits de la boîte en cours dans Manager »).
--
--   - emprunts (loans) : prêteur, nature, objet, capital, taux, durée, dates, périodicité, différé, assurance, frais,
--     garanties, statut ;
--   - échéancier (loan_schedule_lines), une seule source : le tableau d'amortissement de la banque (importé, relu par
--     l'utilisateur), sinon un calcul à échéances constantes marqué « calculé » ; un tableau importé remplace le calcul
--     et n'est jamais recalculé ;
--   - événements (loan_events) : remboursement anticipé, renégociation, changement de taux, report ; un remboursement
--     anticipé est pris en compte par le calcul (échéances suivantes réduites, durée gardée) ;
--   - rapprochement d'une échéance avec une transaction bancaire du Budget (écart gardé) et propositions ;
--   - vue v_loans_summary : capital restant dû aujourd'hui, prochaine échéance, charge de la période, date de fin,
--     part remboursée, intérêts payés.
-- Module « manager » ajouté, coupé : il s'active dans la Console. Droits (build_suite('0220')) : « Gérer les emprunts »
-- (direction, administrateur) ; aucun accès pour les autres profils ; isolement par société ; journal par app.audit_row.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0220_manager_emprunts_retour.sql

insert into public.org_modules (key, label, enabled, position, description)
values ('manager', 'Manager (direction)', false, 150, 'Cockpit de direction, emprunts et crédits, validations')
on conflict (key) do nothing;

create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  lender_name text not null check (length(btrim(lender_name)) > 0),
  label text not null check (length(btrim(label)) > 0),
  nature text not null default 'amortissable' check (nature in ('amortissable', 'in_fine', 'pge', 'credit_bail', 'loa', 'lld', 'compte_courant')),
  purpose text,
  principal numeric(14,2) not null check (principal > 0),
  rate_nominal numeric(7,4) not null default 0 check (rate_nominal >= 0 and rate_nominal < 100),
  rate_kind text not null default 'fixe' check (rate_kind in ('fixe', 'variable')),
  taeg numeric(7,4) check (taeg is null or (taeg >= 0 and taeg < 100)),
  duration_months integer not null check (duration_months between 1 and 600),
  disbursed_on date,
  first_due_on date not null,
  periodicity text not null default 'mensuelle' check (periodicity in ('mensuelle', 'trimestrielle', 'semestrielle', 'annuelle')),
  deferral_months integer not null default 0 check (deferral_months >= 0),
  deferral_kind text not null default 'aucun' check (deferral_kind in ('aucun', 'partiel', 'total')),
  insurance_per_term numeric(12,2) not null default 0 check (insurance_per_term >= 0),
  fees numeric(12,2) check (fees is null or fees >= 0),
  guarantees text,
  bank_account text,
  status text not null default 'en_cours' check (status in ('en_cours', 'solde', 'rembourse_anticipe')),
  schedule_source text not null default 'aucun' check (schedule_source in ('aucun', 'calcule', 'banque')),
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loans_differe check (deferral_months < duration_months)
);
create index if not exists loans_company_idx on public.loans (company_id);
comment on table public.loans is 'Emprunts et crédits de la société (Manager)';

create table if not exists public.loan_schedule_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  loan_id uuid not null references public.loans(id) on delete cascade,
  number integer not null check (number > 0),
  due_on date not null,
  payment numeric(14,2) not null,
  interest numeric(14,2) not null default 0,
  principal_part numeric(14,2) not null default 0,
  insurance numeric(12,2) not null default 0,
  remaining numeric(14,2) not null,
  origin text not null check (origin in ('calcule', 'banque')),
  transaction_id uuid references public.budget_transactions(id) on delete set null,
  gap numeric(14,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (loan_id, number)
);
create index if not exists loan_schedule_lines_company_idx on public.loan_schedule_lines (company_id);
create index if not exists loan_schedule_lines_due_idx on public.loan_schedule_lines (loan_id, due_on);
comment on table public.loan_schedule_lines is 'Échéancier : tableau de la banque (origine banque) ou calcul (origine calcule)';

create table if not exists public.loan_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  loan_id uuid not null references public.loans(id) on delete cascade,
  kind text not null check (kind in ('remboursement_anticipe', 'renegociation', 'taux', 'report')),
  happened_on date not null,
  amount numeric(14,2) check (amount is null or amount >= 0),
  new_rate numeric(7,4) check (new_rate is null or (new_rate >= 0 and new_rate < 100)),
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists loan_events_company_idx on public.loan_events (company_id);
create index if not exists loan_events_loan_idx on public.loan_events (loan_id, happened_on);

do $$
declare t text;
begin
  foreach t in array array['loans', 'loan_schedule_lines', 'loan_events'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_maj', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function app.hr_h_maj()', t || '_maj', t);
  end loop;
end $$;

-- Ligne d'échéancier et événement : même société que l'emprunt ; sur une ligne, seuls le rapprochement et l'écart
-- se modifient à la main (le reste vient du tableau de la banque ou du calcul)
create or replace function app.loan_enfant_garde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_co uuid;
begin
  select l.company_id into v_co from public.loans l where l.id = new.loan_id;
  if v_co is null then raise exception 'Emprunt introuvable' using errcode = 'P0002'; end if;
  new.company_id := v_co;
  if tg_table_name <> 'loan_schedule_lines' then return new; end if;
  if tg_op = 'UPDATE' and coalesce(current_setting('app.loan_calcul', true), '') <> 'on' then
    if (new.number, new.due_on, new.payment, new.interest, new.principal_part, new.insurance, new.remaining, new.origin, new.loan_id)
       is distinct from (old.number, old.due_on, old.payment, old.interest, old.principal_part, old.insurance, old.remaining, old.origin, old.loan_id) then
      raise exception 'Une échéance vient du tableau de la banque ou du calcul : importez un nouveau tableau' using errcode = '23514';
    end if;
  end if;
  if new.transaction_id is not null then
    if not exists (select 1 from public.budget_transactions t where t.id = new.transaction_id and t.company_id = v_co) then
      raise exception 'Transaction d''une autre société' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;
revoke all on function app.loan_enfant_garde() from public, anon, authenticated;
drop trigger if exists loan_schedule_lines_garde on public.loan_schedule_lines;
create trigger loan_schedule_lines_garde before insert or update on public.loan_schedule_lines for each row execute function app.loan_enfant_garde();
drop trigger if exists loan_events_garde on public.loan_events;
create trigger loan_events_garde before insert or update on public.loan_events for each row execute function app.loan_enfant_garde();

create or replace function app.loan_controle(p_loan uuid)
returns public.loans
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.loans;
begin
  select * into v from public.loans where id = p_loan for update;
  if v.id is null then raise exception 'Emprunt introuvable' using errcode = 'P0002'; end if;
  if not (v.company_id in (select app.societes_ecriture())) or not (v.company_id in (select app.societes_avec_droit('manager.emprunts.gerer'))) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  return v;
end
$$;
revoke all on function app.loan_controle(uuid) from public, anon, authenticated;

-- Calcul de l'échéancier : échéances constantes (capital et intérêts), différé partiel (intérêts seuls) ou total
-- (intérêts ajoutés au capital), prêt in fine (intérêts seuls, capital à la dernière échéance), assurance par
-- échéance ; remboursements anticipés et changements de taux des événements pris en compte à leur date.
-- Refusé si un tableau de la banque est importé.
create or replace function public.loan_calculer(p_loan uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.loans;
  v_pas integer;
  v_n integer;
  v_d integer;
  v_r numeric;
  v_rem numeric;
  v_a numeric;
  v_int numeric;
  v_cap numeric;
  v_date date;
  v_k integer;
  e record;
  v_recalc boolean;
begin
  v := app.loan_controle(p_loan);
  if v.schedule_source = 'banque' then
    raise exception 'Le tableau de la banque est importé : il fait foi et ne se recalcule pas' using errcode = '22023';
  end if;
  v_pas := case v.periodicity when 'mensuelle' then 1 when 'trimestrielle' then 3 when 'semestrielle' then 6 else 12 end;
  v_n := greatest(1, v.duration_months / v_pas);
  v_d := least(v.deferral_months / v_pas, v_n - 1);
  v_r := v.rate_nominal / 100 * v_pas / 12;
  v_rem := v.principal;
  v_a := null;
  perform set_config('app.loan_calcul', 'on', true);
  delete from public.loan_schedule_lines where loan_id = v.id;
  for v_k in 1..v_n loop
    v_date := (v.first_due_on + make_interval(months => (v_k - 1) * v_pas))::date;
    v_recalc := false;
    for e in select * from public.loan_events ev
             where ev.loan_id = v.id and ev.happened_on < v_date
               and ev.happened_on >= coalesce((v.first_due_on + make_interval(months => (v_k - 2) * v_pas))::date, '-infinity'::date)
               and (v_k > 1 or ev.happened_on < v.first_due_on)
             order by ev.happened_on loop
      if e.kind = 'remboursement_anticipe' and coalesce(e.amount, 0) > 0 then
        v_rem := greatest(0, v_rem - e.amount); v_recalc := true;
      elsif e.kind in ('taux', 'renegociation') and e.new_rate is not null then
        v_r := e.new_rate / 100 * v_pas / 12; v_recalc := true;
      end if;
    end loop;
    exit when v_rem <= 0;
    v_int := round(v_rem * v_r, 2);
    if v_k <= v_d then
      if v.deferral_kind = 'total' then
        v_rem := v_rem + v_int;
        insert into public.loan_schedule_lines (company_id, loan_id, number, due_on, payment, interest, principal_part, insurance, remaining, origin)
        values (v.company_id, v.id, v_k, v_date, v.insurance_per_term, v_int, 0, v.insurance_per_term, round(v_rem, 2), 'calcule');
      else
        insert into public.loan_schedule_lines (company_id, loan_id, number, due_on, payment, interest, principal_part, insurance, remaining, origin)
        values (v.company_id, v.id, v_k, v_date, v_int + v.insurance_per_term, v_int, 0, v.insurance_per_term, round(v_rem, 2), 'calcule');
      end if;
      continue;
    end if;
    if v.nature = 'in_fine' then
      v_cap := case when v_k = v_n then v_rem else 0 end;
    else
      if v_a is null or v_recalc then
        v_a := case when v_r = 0 then v_rem / (v_n - v_k + 1)
                    else v_rem * v_r / (1 - power(1 + v_r, -(v_n - v_k + 1))) end;
      end if;
      v_cap := case when v_k = v_n then v_rem else least(v_rem, round(v_a - v_int, 2)) end;
    end if;
    v_rem := v_rem - v_cap;
    insert into public.loan_schedule_lines (company_id, loan_id, number, due_on, payment, interest, principal_part, insurance, remaining, origin)
    values (v.company_id, v.id, v_k, v_date, v_cap + v_int + v.insurance_per_term, v_int, v_cap, v.insurance_per_term, round(v_rem, 2), 'calcule');
  end loop;
  update public.loans set schedule_source = 'calcule' where id = v.id;
  perform set_config('app.loan_calcul', '', true);
  return (select count(*) from public.loan_schedule_lines where loan_id = v.id);
end
$$;
revoke all on function public.loan_calculer(uuid) from public, anon;
grant execute on function public.loan_calculer(uuid) to authenticated;

-- Import du tableau d'amortissement de la banque (relu dans l'écran) : remplace l'échéancier ;
-- p_lignes : [{ "number", "due_on", "payment", "interest", "principal", "insurance", "remaining" }]
create or replace function public.loan_importer(p_loan uuid, p_lignes jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.loans;
  v_n integer;
begin
  v := app.loan_controle(p_loan);
  if jsonb_typeof(p_lignes) <> 'array' or jsonb_array_length(p_lignes) = 0 then
    raise exception 'Tableau vide' using errcode = '22023';
  end if;
  perform set_config('app.loan_calcul', 'on', true);
  delete from public.loan_schedule_lines where loan_id = v.id;
  insert into public.loan_schedule_lines (company_id, loan_id, number, due_on, payment, interest, principal_part, insurance, remaining, origin)
  select v.company_id, v.id, coalesce((x ->> 'number')::integer, o.n::integer), (x ->> 'due_on')::date,
         round((x ->> 'payment')::numeric, 2), round(coalesce((x ->> 'interest')::numeric, 0), 2),
         round(coalesce((x ->> 'principal')::numeric, 0), 2), round(coalesce((x ->> 'insurance')::numeric, 0), 2),
         round((x ->> 'remaining')::numeric, 2), 'banque'
  from jsonb_array_elements(p_lignes) with ordinality o(x, n);
  get diagnostics v_n = row_count;
  update public.loans set schedule_source = 'banque' where id = v.id;
  perform set_config('app.loan_calcul', '', true);
  return v_n;
end
$$;
revoke all on function public.loan_importer(uuid, jsonb) from public, anon;
grant execute on function public.loan_importer(uuid, jsonb) to authenticated;

-- Propositions de rapprochement : échéances passées non rapprochées face aux débits du même montant (à 1 centime),
-- à 7 jours de la date prévue
create or replace function public.loan_propositions(p_loan uuid)
returns table (line_id uuid, number integer, due_on date, payment numeric, transaction_id uuid, tx_date date, tx_label text, tx_amount numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_co uuid;
begin
  select l.company_id into v_co from public.loans l where l.id = p_loan;
  if v_co is null or not (v_co in (select app.societes_avec_droit('manager.emprunts.gerer'))) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  return query
  select s.id, s.number, s.due_on, s.payment, t.id, t.date, t.description, t.debit
  from public.loan_schedule_lines s
  join public.budget_transactions t on t.company_id = v_co and abs(coalesce(t.debit, 0) - s.payment) <= 0.01
    and t.date between s.due_on - 7 and s.due_on + 7
  where s.loan_id = p_loan and s.transaction_id is null and s.due_on <= current_date + 7
    and not exists (select 1 from public.loan_schedule_lines x where x.transaction_id = t.id)
  order by s.due_on, abs(t.date - s.due_on);
end
$$;
revoke all on function public.loan_propositions(uuid) from public, anon;
grant execute on function public.loan_propositions(uuid) to authenticated;

-- Synthèse par emprunt (aux droits du lecteur)
create or replace view public.v_loans_summary with (security_invoker = true) as
  select l.id as loan_id, l.company_id, l.label, l.lender_name, l.status, l.principal, l.schedule_source,
    coalesce((select s.remaining from public.loan_schedule_lines s where s.loan_id = l.id and s.due_on <= current_date order by s.due_on desc limit 1),
             case when l.schedule_source = 'aucun' then null else l.principal end) as remaining_today,
    (select s.due_on from public.loan_schedule_lines s where s.loan_id = l.id and s.due_on > current_date order by s.due_on limit 1) as next_due_on,
    (select s.payment from public.loan_schedule_lines s where s.loan_id = l.id and s.due_on > current_date order by s.due_on limit 1) as next_payment,
    (select max(s.due_on) from public.loan_schedule_lines s where s.loan_id = l.id) as end_on,
    (select coalesce(sum(s.interest), 0) from public.loan_schedule_lines s where s.loan_id = l.id and s.due_on <= current_date) as interest_paid,
    (select coalesce(sum(s.interest), 0) from public.loan_schedule_lines s where s.loan_id = l.id) as interest_total,
    (select count(*) from public.loan_schedule_lines s where s.loan_id = l.id and s.due_on <= current_date and s.transaction_id is null) as unmatched_past
  from public.loans l;
comment on view public.v_loans_summary is 'Emprunts : capital restant dû aujourd''hui, prochaine échéance, fin, intérêts';
revoke all on public.v_loans_summary from public, anon;
grant select on public.v_loans_summary to authenticated;

-- Journal
do $$
declare r record;
begin
  for r in select * from (values ('loans', 'finance'), ('loan_schedule_lines', 'finance'), ('loan_events', 'finance')) as t(nom, type) loop
    execute format('drop trigger if exists zz_audit_row on public.%I', r.nom);
    execute format('create trigger zz_audit_row after insert or update or delete on public.%I for each row execute function app.audit_row(%L)', r.nom, r.type);
  end loop;
end $$;

-- ── Droits des tables ──
do $$
declare t text;
begin
  foreach t in array array['loans', 'loan_schedule_lines', 'loan_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

-- ── Règles (générées par scripts/securite/regles.py, build_suite('0220')) ──

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
           where schemaname = 'public' and tablename = any (array['loan_events', 'loan_schedule_lines', 'loans'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- loan_events, loans
select pg_temp.regles(array['loan_events', 'loans'], null,
  $r$company_id in (select app.societes_avec_droit('manager.emprunts.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('manager.emprunts.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('manager.emprunts.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('manager.emprunts.gerer'))$r$);

-- loan_schedule_lines
select pg_temp.regles(array['loan_schedule_lines'], null,
  $r$company_id in (select app.societes_avec_droit('manager.emprunts.gerer'))$r$,
  null,
  $r$company_id in (select app.societes_avec_droit('manager.emprunts.gerer'))$r$,
  null);


do $$
declare t text;
begin
  foreach t in array array['loans', 'loan_schedule_lines', 'loan_events'] loop
    execute format('drop policy if exists %I on public.%I', t || '_societe_lire', t);
    execute format('drop policy if exists %I on public.%I', t || '_societe_creer', t);
    execute format('drop policy if exists %I on public.%I', t || '_societe_modifier', t);
    execute format('drop policy if exists %I on public.%I', t || '_societe_supprimer', t);
    execute format('create policy %I on public.%I as restrictive for select to authenticated using (company_id in (select app.societes_lisibles()))', t || '_societe_lire', t);
    execute format('create policy %I on public.%I as restrictive for insert to authenticated with check (company_id in (select app.societes_ecriture()))', t || '_societe_creer', t);
    execute format('create policy %I on public.%I as restrictive for update to authenticated using (company_id in (select app.societes_ecriture())) with check (company_id in (select app.societes_ecriture()))', t || '_societe_modifier', t);
    execute format('create policy %I on public.%I as restrictive for delete to authenticated using (company_id in (select app.societes_ecriture()))', t || '_societe_supprimer', t);
  end loop;
end $$;

insert into public.schema_migrations (version) values ('0220_manager_emprunts') on conflict (version) do nothing;
