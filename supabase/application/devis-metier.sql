-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (devis-metier) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0443_devis_metier.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0443_devis_metier_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0443_devis_metier.sql =====
-- 0443 : métier du devis (demandes de l'équipe du 23/10, pilotage de H du 24/10). Un devis dit ce qu'il vend :
-- formation, maintenance et vérification, vente de matériel, installation ou travaux, dépannage, DUERP ou audit, ou
-- mixte. Le métier pilote les pièces jointes (CGV du bon métier, programme, fiche technique, attestations
-- d'assurance) et, ensuite, les mentions du devis.
--   1. quotes.metier : choix de l'équipe ; vide = déduit des lignes par l'écran (règle unique metierDevis.js).
--   2. quote_items.metier : métier d'une ligne (formation pour une ligne du catalogue de formation, posé par l'écran
--      à l'ajout ; modifiable sur une ligne libre). Un devis aux lignes de métiers différents est « mixte » et reçoit
--      les pièces de chacun.
--   3. billing_settings.objets_devis : objets proposés par métier (liste réglable dans Paramètres, texte libre gardé).
--   4. company_papers : pièces de l'entreprise jointes aux devis (attestations d'assurance responsabilité civile
--      professionnelle et décennale, Kbis…), avec assureur, contrat, couverture et validité.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0443_devis_metier_retour.sql

-- ── 1 et 2. Métier ──
alter table public.quotes add column if not exists metier text;
alter table public.quote_items add column if not exists metier text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'quotes_metier_check') then
    alter table public.quotes add constraint quotes_metier_check
      check (metier is null or metier in ('formation', 'maintenance', 'vente', 'installation', 'depannage', 'audit', 'mixte'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quote_items_metier_check') then
    alter table public.quote_items add constraint quote_items_metier_check
      check (metier is null or metier in ('formation', 'maintenance', 'vente', 'installation', 'depannage', 'audit'));
  end if;
end
$$;
comment on column public.quotes.metier is 'Métier du devis choisi par l''équipe (formation, maintenance, vente, installation, depannage, audit, mixte) ; vide : déduit des lignes';
comment on column public.quote_items.metier is 'Métier de la ligne ; vide : déduit (formation du catalogue, matériel = vente)';

-- Aucune donnée existante n'est réécrite : une ligne rattachée à une formation du catalogue est déduite « formation »
-- par l'écran (course_id), y compris sur les devis signés, dont les lignes restent figées (0435).

-- ── 3. Objets proposés par métier ──
alter table public.billing_settings add column if not exists objets_devis jsonb not null default $j${
  "formation": ["Formation sauveteur secouriste du travail (SST)", "Formation habilitation électrique", "Formation à la manipulation des extincteurs", "Formation gestes et postures", "Formation à la conduite d'engins (autorisation de conduite)"],
  "maintenance": ["Contrat de maintenance et de vérification des moyens de secours", "Vérification annuelle des extincteurs", "Vérification de l'éclairage de sécurité", "Maintenance du système d'alarme incendie", "Vérification du désenfumage"],
  "vente": ["Fourniture d'extincteurs", "Fourniture de blocs d'éclairage de sécurité", "Fourniture de signalétique de sécurité", "Fourniture de matériel de premiers secours"],
  "installation": ["Installation d'un système d'alarme incendie", "Installation d'éclairage de sécurité", "Travaux d'électricité", "Installation de ventilation mécanique (VMC)", "Installation de vidéoprotection ou de contrôle d'accès"],
  "depannage": ["Dépannage", "Intervention de remise en état"],
  "audit": ["Accompagnement à l'évaluation des risques professionnels (DUERP)", "Audit de sécurité incendie"]
}$j$::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'billing_settings_objets_devis_check') then
    alter table public.billing_settings add constraint billing_settings_objets_devis_check
      check (jsonb_typeof(objets_devis) = 'object' and octet_length(objets_devis::text) <= 20000);
  end if;
end
$$;
comment on column public.billing_settings.objets_devis is 'Objets de devis proposés par métier ({ "formation": [..], "maintenance": [..] }), modifiables dans Paramètres ; le texte libre reste possible';

-- ── 4. Pièces de l'entreprise ──
create table if not exists public.company_papers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  kind text not null check (kind in ('rc_pro', 'decennale', 'kbis', 'autre')),
  label text not null check (length(btrim(label)) between 1 and 200),
  insurer text check (insurer is null or length(insurer) <= 200),
  policy_number text check (policy_number is null or length(policy_number) <= 100),
  coverage text check (coverage is null or length(coverage) <= 500),
  valid_from date,
  valid_until date,
  file_path text check (file_path is null or length(file_path) <= 500),
  file_name text check (file_name is null or length(file_name) <= 200),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_until is null or valid_from is null or valid_until >= valid_from)
);
create index if not exists company_papers_company_idx on public.company_papers (company_id, kind);
comment on table public.company_papers is 'Pièces de l''entreprise jointes aux devis : attestations d''assurance (responsabilité civile professionnelle, décennale), Kbis… Fichier dans le stockage privé « documents »';

revoke all on table public.company_papers from public, anon;
grant select, insert, update, delete on table public.company_papers to authenticated;
grant all on table public.company_papers to service_role;

-- Pose des règles d'une liste de tables (même générateur que 0418)
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

do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and tablename = any (array['company_papers'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- company_papers : lues par qui voit les devis (pour les joindre), tenues par qui modifie l'organisme
select pg_temp.regles(array['company_papers'], null,
  $r$company_id in (select app.societes_avec_droit('commercial.devis.voir'))$r$,
  $r$company_id in (select app.societes_avec_droit('parametres.organisme.modifier'))$r$,
  $r$company_id in (select app.societes_avec_droit('parametres.organisme.modifier'))$r$,
  $r$company_id in (select app.societes_avec_droit('parametres.organisme.modifier'))$r$);

insert into public.schema_migrations (version) values ('0443_devis_metier') on conflict (version) do nothing;
