-- 0417 : émargement sans réseau (suggestion validée par H le 21/10). En salle, le réseau peut tomber : la signature
-- faite sur le portail est gardée sur le téléphone du stagiaire et envoyée dès le retour du réseau, avec l'heure à
-- laquelle elle a été faite. Pour la preuve, l'heure de réception par le serveur est notée à côté.
--   1. attendance_halfdays : heure de réception d'une signature envoyée en différé (matin, après-midi).
--   2. public.portal_sign_halfday_differe : mêmes contrôles que la signature en direct (lien de la session,
--      stagiaire inscrit et présent, demi-journée de la formation, après-midi à partir de 13 h, déjà signée),
--      appliqués à l'heure de la signature ; celle-ci doit dater de moins de 48 heures et ne pas être dans le futur.
-- La signature en direct (portal_sign_halfday) n'est pas modifiée. Migration additive. Idempotente.
-- Retour arrière : supabase/rollback/0417_emargement_sans_reseau_retour.sql

alter table public.attendance_halfdays add column if not exists signed_morning_received_at timestamptz;
alter table public.attendance_halfdays add column if not exists signed_afternoon_received_at timestamptz;
comment on column public.attendance_halfdays.signed_morning_received_at is
  'Signature du matin faite sans réseau : heure de réception par le serveur (signed_morning_at = heure de la signature)';
comment on column public.attendance_halfdays.signed_afternoon_received_at is
  'Signature de l''après-midi faite sans réseau : heure de réception par le serveur (signed_afternoon_at = heure de la signature)';

create or replace function public.portal_sign_halfday_differe(p_token text, p_trainee_id uuid, p_period text,
                                                              p_signature text, p_signed_at timestamptz)
returns json
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  s record;
  v_refus text;
  v_date date;
  v_heure time;
  v_name text;
begin
  select id, signature_mode into s from sessions where attendance_token = p_token;
  if s.id is null then return json_build_object('ok', false, 'error', 'Lien invalide'); end if;
  if s.signature_mode = 'ferme' then
    return json_build_object('ok', false, 'error', 'Les signatures sont fermées : voyez avec votre formateur');
  end if;
  if p_signed_at is null or p_signed_at > now() + interval '5 minutes' or p_signed_at < now() - interval '48 hours' then
    return json_build_object('ok', false, 'error', 'Signature trop ancienne pour être envoyée : voyez avec votre formateur');
  end if;
  v_date := (p_signed_at at time zone 'Europe/Paris')::date;
  v_heure := (p_signed_at at time zone 'Europe/Paris')::time;
  if s.signature_mode is distinct from 'ouvert' and p_period = 'afternoon' and v_heure < '13:00'::time then
    return json_build_object('ok', false, 'error', 'L''après-midi se signe à partir de 13h');
  end if;
  v_refus := signature_refusal(s.id, p_trainee_id, v_date, p_period, p_signature);
  if v_refus is not null then return json_build_object('ok', false, 'error', v_refus); end if;

  select trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) into v_name from trainees where id = p_trainee_id;
  perform write_halfday_signature(s.id, p_trainee_id, v_date, p_period, p_signature, least(p_signed_at, now()), v_name);
  update attendance_halfdays
     set signed_morning_received_at = case when p_period = 'morning' then now() else signed_morning_received_at end,
         signed_afternoon_received_at = case when p_period = 'afternoon' then now() else signed_afternoon_received_at end
   where session_id = s.id and trainee_id = p_trainee_id and date = v_date;
  return json_build_object('ok', true, 'date', v_date, 'period', p_period);
end
$$;
revoke all on function public.portal_sign_halfday_differe(text, uuid, text, text, timestamptz) from public;
grant execute on function public.portal_sign_halfday_differe(text, uuid, text, text, timestamptz) to anon, authenticated;

insert into public.schema_migrations (version) values ('0417_emargement_sans_reseau') on conflict (version) do nothing;
