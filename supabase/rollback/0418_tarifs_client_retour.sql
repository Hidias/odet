-- Retour arrière de 0418_tarifs_client.sql. Les tarifs sont effacés ; les prix déjà posés (sessions, inscriptions,
-- pièces) restent. La fonction d'ajout de pièce reprend sa version de 0374. Idempotent.

drop trigger if exists session_groups_tarif_client on public.session_groups;
drop function if exists app.session_groups_tarif_client();
drop trigger if exists sessions_tarif_client on public.sessions;
drop function if exists app.sessions_tarif_client();

CREATE OR REPLACE FUNCTION public.itv_visit_part_add(p_visit uuid, p_part uuid DEFAULT NULL::uuid, p_label text DEFAULT NULL::text, p_quantity numeric DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_name text;
  v_price numeric := 0;
  v_id uuid;
begin
  if not app.itv_can_edit_visit_parts(p_visit) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if coalesce(p_quantity, 0) <= 0 then
    raise exception 'Quantité invalide' using errcode = '22023';
  end if;
  if p_part is not null then
    select p.name, p.price_ht into v_name, v_price from public.itv_parts p where p.id = p_part;
    if v_name is null then
      raise exception 'Pièce inconnue' using errcode = '22023';
    end if;
  end if;
  v_name := coalesce(nullif(btrim(p_label), ''), v_name);
  if v_name is null then
    raise exception 'Libellé de la pièce manquant' using errcode = '22023';
  end if;
  insert into public.itv_visit_parts (visit_id, part_id, label, quantity, unit_price_ht)
  values (p_visit, p_part, left(v_name, 300), p_quantity, coalesce(v_price, 0))
  returning id into v_id;
  return app.itv_visit_part_json(v_id);
end
$function$

;

drop function if exists app.prix_client(uuid, text, uuid, text);
drop table if exists public.client_prices;
drop function if exists app.client_prices_maj();

delete from public.schema_migrations where version = '0418_tarifs_client';
