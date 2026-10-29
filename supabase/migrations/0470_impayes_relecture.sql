-- 0470 : impayés, relecture de #247.
-- 1. Une relance ou une mise en demeure préparée devient sans objet si la facture est réglée, annulée ou passée en avoir
--    avant d'être traitée : elle est écartée (statut « ignorée », motif noté), au paiement même et chaque nuit. Une
--    relance déjà envoyée ne change pas.
-- 2. Intérêts de retard : calculés jour par jour sur le solde réellement dû chaque jour (paiements partiels déduits à
--    leur date), au lieu du solde restant appliqué à toute la durée.
-- Corps de 0469 repris, seuls ces points changent. Retour arrière : réappliquer 0469, supprimer le déclencheur
-- invoices_impayes_rapprocher et les fonctions app.impayes_rapprocher, app.impayes_rapprocher_facture.

create or replace function app.impayes_rapprocher(p_invoice uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_n int;
begin
  update public.scheduled_actions a set status = 'ignore',
         error = 'Facture ' || coalesce(i.reference, '') || case when i.status in ('cancelled', 'credited') then ' annulée' else ' réglée' end || ' avant l''envoi'
  from public.invoices i
  where a.target_table = 'invoices' and a.target_id = i.id and a.status in ('a_valider', 'valide')
    and (a.kind = 'relance_impaye' or a.dedup_key like 'impaye_suspension:%')
    and (p_invoice is null or i.id = p_invoice)
    and (i.status in ('paid', 'cancelled', 'credited') or coalesce(i.amount_due, i.total_ttc, 0) <= 0);
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
revoke all on function app.impayes_rapprocher(uuid) from public, anon, authenticated;

create or replace function app.impayes_rapprocher_facture()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('paid', 'cancelled', 'credited') or coalesce(new.amount_due, new.total_ttc, 0) <= 0 then
    perform app.impayes_rapprocher(new.id);
  end if;
  return new;
end
$$;
revoke all on function app.impayes_rapprocher_facture() from public, anon, authenticated;
drop trigger if exists invoices_impayes_rapprocher on public.invoices;
create trigger invoices_impayes_rapprocher after update of status, amount_due on public.invoices
  for each row execute function app.impayes_rapprocher_facture();

create or replace function public.impayes_generer()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  p int;
  v_n int := 0;
  v_md int := 0;
  v_susp int := 0;
  v_k int;
  v_retard int;
  v_taux numeric;
  v_interets numeric;
  v_ton text;
  v_texte text;
  v_obj text;
  v_dest text;
begin
  if coalesce((select auth.role()), '') not in ('service_role', '') and not app.a_le_droit('plateforme.administrer') then
    raise exception 'Réservé à la tâche de nuit' using errcode = '42501';
  end if;
  -- Relances devenues sans objet (facture réglée, annulée ou avoir) : écartées avant toute nouvelle préparation
  perform app.impayes_rapprocher(null);
  for r in
    select i.id, i.company_id, i.reference, i.invoice_date, i.due_date, i.session_id, coalesce(i.total_ttc, 0) as ttc, coalesce(i.billing_client_id, i.client_id) as client_id,
           coalesce(i.amount_due, i.total_ttc, 0) as du, c.name as client_name, coalesce(c.client_type, 'entreprise') as client_type,
           coalesce(nullif(btrim(c.billing_email), ''), nullif(btrim(c.contact_email), ''), nullif(btrim(c.email), '')) as email,
           coalesce(bs.relance_paliers, '{7,15,30}') as paliers, bs.mise_en_demeure_jours as md, bs.taux_bce, bs.taux_bce_au
    from public.invoices i
    left join public.clients c on c.id = coalesce(i.billing_client_id, i.client_id)
    left join public.billing_settings bs on bs.company_id = i.company_id
    where i.type = 'invoice' and coalesce(i.status, 'draft') in ('sent', 'due', 'overdue', 'partial')
      and coalesce(i.amount_due, i.total_ttc, 0) > 0 and i.due_date is not null and i.due_date < current_date
  loop
    v_ton := case r.client_type when 'public' then 'public' when 'particulier' then 'particulier' else 'pro' end;
    -- Relances graduées
    foreach p in array r.paliers loop
      continue when p is null or p <= 0 or r.due_date + p not between current_date - 14 and current_date;
      v_obj := case when p = r.paliers[array_upper(r.paliers, 1)] then 'Facture ' || r.reference || ' : dernier rappel avant mise en demeure'
                    when p = r.paliers[1] then 'Facture ' || r.reference || ' : règlement en attente'
                    else 'Facture ' || r.reference || ' : relance' end;
      v_texte := 'Bonjour,' || E'\n\n'
        || case
             when p = r.paliers[1] then 'Sauf erreur de notre part, la facture ' || r.reference || ' du ' || to_char(r.invoice_date, 'DD/MM/YYYY')
               || ', arrivée à échéance le ' || to_char(r.due_date, 'DD/MM/YYYY') || ', reste à régler pour ' || app.euros_fr(r.du) || '. '
               || case when v_ton = 'public' then 'Pourriez-vous nous indiquer où en est son mandatement ?' else 'Pourriez-vous nous indiquer la date prévue du règlement ?' end
               || ' Si le paiement vient d''être fait, merci de ne pas tenir compte de ce message.'
             when p = r.paliers[array_upper(r.paliers, 1)] then 'Malgré nos précédents messages, la facture ' || r.reference || ' du ' || to_char(r.invoice_date, 'DD/MM/YYYY')
               || ' (' || app.euros_fr(r.du) || ', échue le ' || to_char(r.due_date, 'DD/MM/YYYY') || ') reste impayée. '
               || 'Sans règlement de votre part, nous serons contraints de vous adresser une mise en demeure'
               || case when v_ton = 'particulier' then '.' else ', avec les intérêts de retard et l''indemnité forfaitaire prévus par la loi.' end
             else 'Nous revenons vers vous au sujet de la facture ' || r.reference || ' du ' || to_char(r.invoice_date, 'DD/MM/YYYY')
               || ', échue depuis le ' || to_char(r.due_date, 'DD/MM/YYYY') || ', qui reste à régler pour ' || app.euros_fr(r.du) || '. '
               || 'Merci de procéder au règlement dans les meilleurs délais, ou de nous indiquer ce qui le retarde.'
           end
        || E'\n\n' || 'Bien cordialement,';
      insert into public.scheduled_actions (company_id, kind, target_table, target_id, session_id, client_id, due_on, title, payload, dedup_key)
      values (r.company_id, 'relance_impaye', 'invoices', r.id, r.session_id, r.client_id, r.due_date + p,
              'Facture ' || r.reference || ' impayée (' || p || ' jours après l''échéance)' || coalesce(' : ' || r.client_name, ''),
              jsonb_build_object('lien', '/factures?open=' || r.id, 'etape', 'impaye', 'palier', p, 'destinataire', r.email, 'objet', v_obj, 'texte', v_texte),
              'impaye:' || r.id || ':' || p)
      on conflict (company_id, dedup_key) do nothing;
      get diagnostics v_k = row_count; v_n := v_n + v_k;
    end loop;

    -- Mise en demeure
    continue when r.md is null or r.due_date + r.md not between current_date - 14 and current_date;
    v_retard := r.md;
    -- Professionnel et public : intérêts dus dès le lendemain de l'échéance ; particulier : seulement à compter de la mise en demeure
    v_taux := case v_ton when 'pro' then r.taux_bce + 10 when 'public' then r.taux_bce + 8 end;
    -- Intérêts jour par jour sur le solde réellement dû ce jour-là (paiements partiels déduits à leur date)
    v_interets := case when v_taux is null then null else round((
      select sum(greatest(r.ttc - coalesce((select sum(pm.amount) from public.invoice_payments pm
                                             where pm.invoice_id = r.id and pm.payment_date <= d::date), 0), 0))
      from generate_series(r.due_date + 1, r.due_date + v_retard, interval '1 day') d) * v_taux / 100 / 365, 2) end;
    v_texte := 'Madame, Monsieur,' || E'\n\n'
      || 'Malgré nos relances, la facture ' || r.reference || ' du ' || to_char(r.invoice_date, 'DD/MM/YYYY') || ', échue le '
      || to_char(r.due_date, 'DD/MM/YYYY') || ', reste impayée pour ' || app.euros_fr(r.du) || '.' || E'\n\n'
      || 'Par la présente, nous vous mettons en demeure de régler cette somme sous huit jours à compter de la réception de ce courrier.' || E'\n\n'
      || case v_ton
           when 'pro' then 'Conformément à l''article L441-10 du code de commerce, cette somme porte intérêts au taux directeur de la Banque centrale européenne majoré de 10 points'
             || case when v_interets is not null then ', soit ' || app.euros_fr(v_interets) || ' pour ' || v_retard || ' jours de retard (taux appliqué : ' || replace(v_taux::text, '.', ',') || ' %' || coalesce(', taux BCE au ' || to_char(r.taux_bce_au, 'DD/MM/YYYY'), '') || ')' else ' (montant à calculer)' end
             || ', auxquels s''ajoute l''indemnité forfaitaire pour frais de recouvrement de 40 € (article D441-5 du code de commerce).'
           when 'public' then 'Conformément aux articles L2192-13 et R2192-31 du code de la commande publique, le retard de paiement fait courir de plein droit des intérêts moratoires au taux de la Banque centrale européenne majoré de 8 points'
             || case when v_interets is not null then ', soit ' || app.euros_fr(v_interets) || ' pour ' || v_retard || ' jours de retard (taux appliqué : ' || replace(v_taux::text, '.', ',') || ' %)' else ' (montant à calculer)' end
             || ', ainsi que l''indemnité forfaitaire pour frais de recouvrement de 40 € (article D2192-35).'
           else 'À défaut, cette somme portera intérêts au taux légal à compter de la présente mise en demeure (article 1231-6 du code civil).'
         end
      || E'\n\n' || 'À défaut de règlement dans ce délai, nous nous réservons la possibilité d''engager une procédure de recouvrement.'
      || E'\n\n' || 'Veuillez agréer, Madame, Monsieur, nos salutations distinguées.';
    insert into public.scheduled_actions (company_id, kind, target_table, target_id, session_id, client_id, due_on, title, payload, dedup_key)
    values (r.company_id, 'relance_impaye', 'invoices', r.id, r.session_id, r.client_id, r.due_date + r.md,
            'Mise en demeure : facture ' || r.reference || coalesce(' de ' || r.client_name, '') || ' (' || r.md || ' jours de retard)',
            jsonb_build_object('lien', '/factures?open=' || r.id, 'etape', 'mise_en_demeure', 'destinataire', r.email,
              'objet', 'Mise en demeure de payer : facture ' || r.reference, 'texte', v_texte,
              'interets', v_interets, 'indemnite', case when v_ton = 'particulier' then null else 40 end,
              'note', 'À envoyer aussi en lettre recommandée avec accusé de réception. Texte à faire relire par l''expert avant le premier envoi.'),
            'impaye:' || r.id || ':mise_en_demeure')
    on conflict (company_id, dedup_key) do nothing;
    get diagnostics v_k = row_count; v_md := v_md + v_k;

    -- Suspension des visites proposée (jamais appliquée seule)
    if v_k > 0 and exists (select 1 from public.itv_contracts k where k.client_id = r.client_id and k.status = 'actif') then
      insert into public.scheduled_actions (company_id, kind, target_table, target_id, client_id, due_on, title, payload, dedup_key)
      values (r.company_id, 'rappel', 'invoices', r.id, r.client_id, current_date,
              'Impayé de ' || r.client_name || ' : suspendre les visites du contrat ?',
              jsonb_build_object('interne', true, 'lien', '/interventions/contrats',
                'texte', 'La facture ' || r.reference || ' (' || app.euros_fr(r.du) || ') est en mise en demeure. Le client a un contrat de maintenance actif : '
                  || 'à vous de décider de suspendre les visites (statut « Suspendu » sur le contrat) jusqu''au règlement. Rien n''a été changé.'),
              'impaye_suspension:' || r.id)
      on conflict (company_id, dedup_key) do nothing;
      get diagnostics v_k = row_count; v_susp := v_susp + v_k;
    end if;
  end loop;
  return jsonb_build_object('relances', v_n, 'mises_en_demeure', v_md, 'suspensions_proposees', v_susp);
end
$$;
