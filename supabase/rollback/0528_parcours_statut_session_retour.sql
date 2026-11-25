-- Retour arrière de 0528. Refusé si une session est « À clôturer » ou « À facturer », ou porte un motif
-- « pas de facture » : les remettre d'abord à la main (revenir en arrière ferait perdre ces états).
begin;
do $$ begin
  if exists (select 1 from public.sessions where status in ('to_close', 'to_invoice') or sans_facture_motif is not null) then
    raise exception 'Sessions À clôturer, À facturer ou sans facture : retour arrière refusé';
  end if;
end $$;

do $$
declare d text; v_avant text; v_apres text; n int;
begin
  d := pg_get_functiondef('public.daily_maintenance()'::regprocedure);
  v_avant := $b$  -- 1. Statut des sessions (B126, 0528) : sous-traitance « terminée » le lendemain de la fin (sauf verrou
  --    ou annulée) ; les autres suivent le parcours À clôturer, À facturer, Terminée (app.session_avancer)
  update public.sessions s
     set status = 'completed', updated_at = now()
   where coalesce(s.session_type, 'intra') = 'subcontract'
     and coalesce(s.status, '') not in ('completed', 'cancelled')
     and coalesce(s.status_locked, false) = false
     and s.end_date is not null
     and s.end_date < v_today;
  get diagnostics v_sessions = row_count;
  v_sessions := v_sessions + (select count(*) from (
    select app.session_avancer(s.id) as nouveau from public.sessions s
     where coalesce(s.session_type, 'intra') <> 'subcontract'
       and s.status in ('planned', 'confirmed', 'in_progress', 'to_close', 'to_invoice')
       and coalesce(s.end_date, s.start_date) <= v_today) x where x.nouveau is not null);$b$;
  v_apres := $b$  -- 1. Sessions passées : « terminée » le lendemain de la fin (sauf statut verrouillé)
  update public.sessions s
     set status = 'completed', updated_at = now()
   where s.status is distinct from 'completed'
     and coalesce(s.status_locked, false) = false
     and s.end_date is not null
     and s.end_date < v_today;
  get diagnostics v_sessions = row_count;$b$;
  n := (length(d) - length(replace(d, v_avant, ''))) / length(v_avant);
  if n <> 1 then raise exception 'Retour 0528 : étape 1 de daily_maintenance introuvable (% occurrence)', n; end if;
  execute replace(d, v_avant, v_apres);
end $$;

drop trigger if exists trg_facture_avancer_sessions on public.invoices;
drop trigger if exists trg_facture_avancer_sessions on public.invoice_sessions;
drop function if exists app.facture_avancer_sessions();
drop function if exists public.session_avancer_statut(uuid);
drop function if exists public.session_cloture_etat(uuid);
drop function if exists app.session_avancer(uuid);
drop function if exists app.session_facture_emise(uuid);
drop function if exists app.session_cloture_etat(uuid);
create or replace function app.session_realisee(p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$ select p_status = any (array['completed']) $$;
alter table public.sessions drop constraint if exists sessions_sans_facture_motif_check;
alter table public.sessions drop column if exists sans_facture_motif;
delete from public.schema_migrations where version = '0528_parcours_statut_session';
commit;
