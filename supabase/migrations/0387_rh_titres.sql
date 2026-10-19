-- 0387_rh_titres.sql : titres d'habilitation électrique et autorisations de conduite édités par l'outil, signatures.
--
-- Décisions de H (19/10, 22h50 et 23h15) : l'outil édite les titres d'habilitation électrique et les autorisations de
-- conduite des salariés de l'entreprise, signés par l'employeur et par le salarié, avec l'attestation médicale de 5 ans ;
-- le signataire est un associé choisi au moment d'éditer le titre, et sa signature est enregistrée une fois.
--
--   1. user_signatures : la signature dessinée de chaque compte, enregistrée une fois et réutilisée (titres, plus tard
--      certificats et attestations). Chacun écrit la sienne ; la RH et qui édite les documents la lisent pour la poser.
--   2. hr_qualifications : délivrance du titre par l'employeur (date, signataire, signature du salarié, document PDF).
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0387_rh_titres_retour.sql

create table if not exists public.user_signatures (
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  image text not null check (image like 'data:image/%' and length(image) < 400000),
  signer_title text check (signer_title is null or length(signer_title) <= 120),
  updated_at timestamptz not null default now(),
  primary key (company_id, profile_id)
);
comment on table public.user_signatures is 'Signature dessinée de chaque compte, enregistrée une fois et posée sur les documents qu''il signe';
alter table public.user_signatures enable row level security;
revoke all on public.user_signatures from anon;
grant select, insert, update, delete on public.user_signatures to authenticated;

alter table public.hr_qualifications add column if not exists delivered_at date;
alter table public.hr_qualifications add column if not exists delivered_by uuid references public.profiles(id) on delete set null;
alter table public.hr_qualifications add column if not exists employee_signed_at timestamptz;
alter table public.hr_qualifications add column if not exists title_document_id uuid references public.hr_documents(id) on delete set null;
comment on column public.hr_qualifications.delivered_at is 'Titre délivré par l''employeur (habilitation, autorisation de conduite) : date de délivrance';

-- Règles d'accès (générées par scripts/securite/regles.py, build_suite('0387'))

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
           where schemaname = 'public' and tablename = any (array['user_signatures'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- user_signatures
select pg_temp.regles(array['user_signatures'], null,
  $r$(profile_id = (select auth.uid()) or company_id in (select app.societes_avec_droit('rh.dossiers.gerer')) or company_id in (select app.societes_avec_droit('formation.sessions.creer')))$r$,
  $r$profile_id = (select auth.uid())$r$,
  $r$profile_id = (select auth.uid())$r$,
  $r$profile_id = (select auth.uid())$r$);

insert into public.schema_migrations (version) values ('0387_rh_titres') on conflict (version) do nothing;
