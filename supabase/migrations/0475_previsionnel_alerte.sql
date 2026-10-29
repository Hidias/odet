-- 0475 : prévisionnel, relecture de #250 : l'alerte « sous le pessimiste » ne contient plus aucun montant.
-- Les actions de Relances à valider sont lisibles au-delà de la direction ; les chiffres du prévisionnel restent
-- derrière le droit « voir le cockpit de direction ». Corps de 0474 repris, seul le texte de l'alerte change.
-- Retour arrière : réappliquer 0474.

create or replace function public.previsionnel_nuit()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare co record; v jsonb; h jsonb; m jsonb; g int; v_p int := 0; v_a int := 0; v_debut date := date_trunc('month', current_date)::date;
  r1 numeric; r2 numeric; p1 numeric; p2 numeric;
begin
  if coalesce((select auth.role()), '') not in ('service_role', '') and not app.a_le_droit('plateforme.administrer') then
    raise exception 'Réservé à la tâche de nuit' using errcode = '42501';
  end if;
  for co in select c.id from public.companies c loop
    if not exists (select 1 from public.previsionnel_photos p where p.company_id = co.id and p.prise_le >= v_debut) then
      v := app.previsionnel_calcul(co.id);
      h := v -> 'hypotheses';
      for g in 0 .. 11 loop
        m := v -> 'mois' -> g;
        insert into public.previsionnel_photos (company_id, prise_le, mois, pessimiste, realiste, optimiste)
        values (co.id, current_date, (m ->> 'mois')::date,
          round((m->>'certain')::numeric * (h->'certain'->>'pessimiste')::numeric / 100 + (m->>'devis')::numeric * (h->'devis'->>'pessimiste')::numeric / 100 + (m->>'recurrent')::numeric * (h->'recurrent'->>'pessimiste')::numeric / 100, 2),
          round((m->>'certain')::numeric * (h->'certain'->>'realiste')::numeric / 100 + (m->>'devis')::numeric * (h->'devis'->>'realiste')::numeric / 100 + (m->>'recurrent')::numeric * (h->'recurrent'->>'realiste')::numeric / 100, 2),
          round((m->>'certain')::numeric * (h->'certain'->>'optimiste')::numeric / 100 + (m->>'devis')::numeric * (h->'devis'->>'optimiste')::numeric / 100 + (m->>'recurrent')::numeric * (h->'recurrent'->>'optimiste')::numeric / 100, 2))
        on conflict do nothing;
      end loop;
      v_p := v_p + 1;
      -- Les deux derniers mois clos : réalisé face à la première photo de chacun
      select coalesce(sum(i.total_net_ht), 0) into r1 from public.invoices i where i.company_id = co.id and i.type = 'invoice' and i.status not in ('draft', 'cancelled') and date_trunc('month', i.invoice_date) = (v_debut - interval '1 month');
      select coalesce(sum(i.total_net_ht), 0) into r2 from public.invoices i where i.company_id = co.id and i.type = 'invoice' and i.status not in ('draft', 'cancelled') and date_trunc('month', i.invoice_date) = (v_debut - interval '2 months');
      select p.pessimiste into p1 from public.previsionnel_photos p where p.company_id = co.id and p.mois = (v_debut - interval '1 month')::date order by p.prise_le limit 1;
      select p.pessimiste into p2 from public.previsionnel_photos p where p.company_id = co.id and p.mois = (v_debut - interval '2 months')::date order by p.prise_le limit 1;
      if p1 is not null and p2 is not null and r1 < p1 and r2 < p2 then
        insert into public.scheduled_actions (company_id, kind, target_table, client_id, due_on, title, payload, dedup_key)
        values (co.id, 'rappel', 'previsionnel', null, current_date, 'Chiffre d''affaires sous le scénario pessimiste deux mois de suite',
          -- Aucun montant dans l'alerte : elle peut être lue hors de la direction ; les chiffres restent derrière le droit
          jsonb_build_object('interne', true, 'lien', '/previsionnel',
            'texte', 'Le chiffre d''affaires facturé des deux derniers mois est sous le scénario pessimiste. '
              || 'Ouvrez le prévisionnel (direction) : prévu face au réalisé, devis en attente, échéances à facturer.'),
          'previsionnel_alerte:' || to_char(v_debut, 'YYYY-MM'))
        on conflict (company_id, dedup_key) do nothing;
        v_a := v_a + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('photos', v_p, 'alertes', v_a);
end
$$;
