import { Send } from 'lucide-react'
import { Sheet } from '../../../ui/Sheet'
import { Banner } from '../../../ui/Banner'
import { groupesActifs, inscritsDuGroupe, destinataireDuGroupe, refusPublicationGroupe, signataireDuGroupe } from '../lib/conventionGroupe'
import { pluriel } from '../../../core/genre'

// Session inter suivie par groupes (06/11, décision de H) : on choisit le groupe avant de préparer l'envoi ; chaque
// entreprise ou particulier ne reçoit que ses documents et les convocations ou attestations de ses propres stagiaires.
const ETAT = { a_envoyer: 'À envoyer', envoye: 'Envoyé', signe: 'Signé' }

export default function ChoixGroupeEnvoi({ session, groupes, emailType, onChoisir, onClose }) {
  const actifs = groupesActifs(groupes)
  const sansGroupe = (session?.session_trainees || []).filter((st) => !st.group_id).length
  const titre = emailType === 'after' ? 'Envoi après formation' : 'Envoi avant formation'
  return (
    <Sheet title={titre} onClose={onClose} size="md"
      footer={<button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button>}>
      <div className="space-y-3">
        <p className="text-ui text-gray-600">Session inter : choisissez le groupe. Il reçoit seulement ses documents et ceux de ses stagiaires.</p>
        {sansGroupe > 0 && (
          <Banner tone="warning">
            {sansGroupe > 1
              ? `${sansGroupe} stagiaires ne sont dans aucun groupe : ils ne recevront rien. Rattachez-les dans l'onglet Groupes.`
              : '1 stagiaire n\'est dans aucun groupe : il ne recevra rien. Rattachez-le dans l\'onglet Groupes.'}
          </Banner>
        )}
        <ul className="divide-y hairline">
          {actifs.map((g) => {
            const nb = inscritsDuGroupe(session, g).length
            const mail = destinataireDuGroupe(g)
            // Avant formation : la convention du groupe doit pouvoir être faite (stagiaires, prix, signataire)
            const refus = emailType === 'after' ? null : refusPublicationGroupe(g, nb, signataireDuGroupe(g, [g.contact].filter(Boolean)))
            const raison = !nb ? 'Aucun stagiaire dans ce groupe' : refus || (!mail ? 'Pas d\'adresse e-mail pour ce groupe : ajoutez-en une au contact ou à la fiche.' : null)
            return (
              <li key={g.id} className="py-2 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">{g.clients?.name || g.group_name || 'Groupe'}</p>
                  <p className="text-ui-sm text-gray-500 break-words">
                    {pluriel(nb, 'stagiaire')} · {mail || 'aucune adresse'}{emailType !== 'after' ? ` · ${g.kind === 'particulier' ? 'Contrat' : 'Convention'} : ${(ETAT[g.doc_status] || ETAT.a_envoyer).toLowerCase()}` : ''}
                  </p>
                  {raison && <p className="text-ui-sm text-[rgb(var(--c-warning))]">{raison}</p>}
                </div>
                <button type="button" className="btn btn-primary btn-sm" disabled={!!raison} onClick={() => onChoisir(g)}>
                  <Send className="w-4 h-4" /> Préparer l'envoi
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </Sheet>
  )
}
