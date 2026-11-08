// Kanban des affaires et des devis envoyés (consigne de H du 04/11, inspiré d'Odoo), sur le Kanban commun
// (`src/ui/Kanban.jsx`). Montant exact sur la carte, totaux de colonne en K€ arrondis.
// Un devis pas encore suivi comme affaire suit le statut du devis : il ne se déplace pas, son menu ouvre le devis.

import { Link } from 'react-router-dom'
import { Kanban, CLASSE_ITEM_MENU } from '../../../ui/Kanban'
import { BadgeTest } from '../../../core/demo/BadgeTest'
import { money } from '../../../core/utils'
import { kEuros, etapesProposees, deplacementPossible } from '../lib/affaires'

const fr = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : 'Relance à dater')
const cle = (l) => `${l.origine}-${l.id}`

export function KanbanAffaires({ colonnes, etapes, peutModifier, onOuvrir, onChanger }) {
  const cols = colonnes.map((c) => ({ ...c, sousTitre: `${kEuros(c.montant)} · pondéré ${kEuros(c.pondere)} · ${c.probability} %` }))
  return (
    <Kanban colonnes={cols} cle={cle} label="Affaires par étape" labelMenu="Actions de l'affaire" vide="Aucune affaire"
      onOuvrir={onOuvrir}
      deplacable={(l) => peutModifier && l.origine === 'affaire'}
      peutDeposer={(l, code) => deplacementPossible(l, code, peutModifier)}
      onDeposer={onChanger}
      libelleMenu={peutModifier ? (l) => `Actions : ${l.client_name}, ${l.title}` : null}
      carte={(l) => (
        <>
          <div className="text-ui font-medium truncate">{l.client_name} <BadgeTest tbl="clients" id={l.client_id} /></div>
          <div className="text-ui-sm text-gray-500 truncate">{l.title}</div>
          <div className="text-ui-sm text-gray-400 flex justify-between gap-2">
            <span className="tabular-nums">{l.amount_ht != null ? money(l.amount_ht) : 'Montant à estimer'}</span>
            <span>{fr(l.next_action_on)}</span>
          </div>
          {l.origine === 'devis' && <div className="text-ui-sm text-gray-400">Devis envoyé</div>}
        </>
      )}
      menu={({ ligne, fermer, choisir }) => (ligne.origine === 'devis' ? (
        <Link to={`/devis?open=${ligne.id}`} className={`block ${CLASSE_ITEM_MENU}`} onClick={fermer}>
          Ouvrir le devis (l'étape suit son statut)
        </Link>
      ) : (
        <>
          <div className="px-3 pt-1.5 pb-1 text-ui-sm text-gray-500">Changer d'étape</div>
          {etapesProposees(etapes, ligne.stage).map((e) => (
            <button key={e.code} type="button" className={CLASSE_ITEM_MENU} onClick={() => choisir(() => onChanger(ligne, e.code))}>
              {e.code === 'perdue' || e.code === 'gagnee' ? `${e.label}…` : e.label}
            </button>
          ))}
        </>
      ))}
    />
  )
}
