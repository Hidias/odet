-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (adapte_0388) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur odet-gld : 0388_affichage_adapte.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0388_affichage_adapte_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0388_affichage_adapte.sql =====
-- 0388_affichage_adapte.sql : affichage adapté réglé pour une autre personne (décision de H du 19/10, 23h15).
--
--   Chacun règle son affichage adapté lui-même (français facile, lecture à voix haute, texte agrandi, contraste
--   renforcé), dans le menu Affichage. La RH, l'administrateur, la direction et le super administrateur peuvent aussi
--   le régler pour une personne de leur société (par exemple un technicien, à son arrivée). Le motif n'est jamais
--   demandé ni enregistré : le réglage ne doit rien révéler de la santé de la personne.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0388_affichage_adapte_retour.sql

create or replace function public.affichage_adapte_regler(p_profile uuid, p_adapte jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ok boolean;
  v jsonb := '{}'::jsonb;
  k text;
begin
  if p_profile is null then raise exception 'Personne inconnue' using errcode = '22023'; end if;
  -- Soi-même, ou RH / administrateur / direction d'une société commune
  v_ok := p_profile = (select auth.uid()) or app.is_superadmin() or exists (
    select 1 from public.company_members m
    where m.profile_id = p_profile and m.is_active
      and (coalesce(app.company_role(m.company_id), '') in ('admin', 'direction')
           or m.company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))));
  if not v_ok then
    raise exception 'Réservé à la personne, à la RH et à la direction' using errcode = '42501';
  end if;
  foreach k in array array['facile', 'voix', 'grand', 'contraste'] loop
    if coalesce((p_adapte ->> k)::boolean, false) then v := v || jsonb_build_object(k, true); end if;
  end loop;
  update public.profiles set ui_prefs = coalesce(ui_prefs, '{}'::jsonb) || jsonb_build_object('adapte', v) where id = p_profile;
  return v;
end
$$;
revoke all on function public.affichage_adapte_regler(uuid, jsonb) from public, anon;
grant execute on function public.affichage_adapte_regler(uuid, jsonb) to authenticated;

-- Lecture du réglage d'une personne (mêmes droits)
create or replace function public.affichage_adapte_lire(p_profile uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p.ui_prefs -> 'adapte', '{}'::jsonb) from public.profiles p
  where p.id = p_profile and (p_profile = (select auth.uid()) or app.is_superadmin() or exists (
    select 1 from public.company_members m where m.profile_id = p_profile and m.is_active
      and (coalesce(app.company_role(m.company_id), '') in ('admin', 'direction')
           or m.company_id in (select app.societes_avec_droit('rh.dossiers.gerer')))))
$$;
revoke all on function public.affichage_adapte_lire(uuid) from public, anon;
grant execute on function public.affichage_adapte_lire(uuid) to authenticated;

insert into public.schema_migrations (version) values ('0388_affichage_adapte') on conflict (version) do nothing;
