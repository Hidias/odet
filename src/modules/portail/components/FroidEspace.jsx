// Espace entreprise (0482) : évaluations à froid. L'employeur donne son avis une fois par formation ; pour les
// salariés sans adresse e-mail, il retrouve le lien de leur espace stagiaire et leur code personnel à leur transmettre.
// Deux espaces (0509) : par compte (ent_froid_repondre, par défaut) et par lien (repondre passé par ClientPortal,
// client_portal_froid_repondre, erreurs du lien en { error }).
import { useState } from 'react'
import { CheckCircle, Copy } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../../../core/supabase'
import { QuestionnaireFroid } from './QuestionnaireFroid'

// Message de la base montré tel quel (questionnaire fermé, réponse déjà reçue, réponses incomplètes), le reste en phrase simple
export const messageFroid = (error, defaut = 'Votre avis n\'a pas pu être enregistré. Réessayez plus tard.') =>
  (['22023', '42501', '23505'].includes(error?.code) && /^[A-ZÀ-Ý]/.test(error.message || '') ? error.message : defaut)

const dateFr = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR') : '')
const periode = (a, b) => (!b || String(a).slice(0, 10) === String(b).slice(0, 10) ? `le ${dateFr(a)}` : `du ${dateFr(a)} au ${dateFr(b)}`)

export default function FroidEspace({ donnees, onChange, Carte, repondre = null }) {
  const [ouvert, setOuvert] = useState(null)
  const [busy, setBusy] = useState(false)
  const [erreur, setErreur] = useState('')
  const sessions = donnees?.sessions || []
  if (!sessions.length) return <p className="text-sm text-gray-500 text-center py-6">Aucune évaluation à froid pour le moment.</p>
  const envoyer = async (s, reponses) => {
    setBusy(true); setErreur('')
    let res
    try {
      res = repondre
        ? await repondre(s.session_id, reponses)
        : await supabase.rpc('ent_froid_repondre', { p_session: s.session_id, p_reponses: reponses })
    } catch {
      res = { error: {} }
    }
    setBusy(false)
    const { data, error } = res || {}
    if (error || data?.error) {
      setErreur(data?.error || messageFroid(error))
      if (error?.code === '23505') onChange?.()
      return
    }
    toast.success('Merci, votre avis est enregistré')
    setOuvert(null)
    onChange?.()
  }
  const lien = (jeton) => `${window.location.origin}/#/portail/${encodeURIComponent(jeton)}`
  const copier = async (texte) => { try { await navigator.clipboard.writeText(texte); toast.success('Copié') } catch { toast.error('Copie impossible : sélectionnez le texte') } }
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">Quelques mois après une formation, votre avis nous aide à mesurer ce qu'elle apporte dans le travail.</p>
      {sessions.map((s) => (
        <Carte key={s.session_id}>
          <div className="font-medium text-gray-900">{s.formation || 'Formation'}</div>
          <div className="text-sm text-gray-500">{periode(s.debut, s.fin)}</div>
          {s.employeur && (
            s.employeur.recue ? (
              <p className="text-sm text-[rgb(var(--c-success))] mt-2 flex items-center gap-1"><CheckCircle className="w-4 h-4" />Votre avis est enregistré{s.employeur.recue_le ? ` (${dateFr(s.employeur.recue_le)})` : ''}, merci.</p>
            ) : ouvert === s.session_id ? (
              <div className="mt-3"><QuestionnaireFroid questions={s.employeur.questions} busy={busy} erreur={erreur} onAnnuler={() => setOuvert(null)} onEnvoyer={(r) => envoyer(s, r)} /></div>
            ) : (
              <button type="button" className="btn btn-primary btn-sm mt-2" onClick={() => { setOuvert(s.session_id); setErreur('') }}>Donner mon avis</button>
            )
          )}
          {s.stagiaires?.length > 0 && (
            <div className="mt-3 border-t pt-2">
              <p className="text-sm text-gray-700 mb-1">Salariés sans adresse e-mail : merci de leur transmettre le lien de leur espace et leur code.</p>
              <div className="space-y-1">
                {s.stagiaires.map((t) => (
                  <div key={`${t.nom}-${t.prenom}-${t.code}`} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{t.prenom} {t.nom}</span>
                    {t.recue ? <span className="text-[rgb(var(--c-success))]">a répondu</span> : <span className="text-gray-500">code {t.code}</span>}
                  </div>
                ))}
              </div>
              <button type="button" className="btn btn-secondary btn-sm mt-2 flex items-center gap-1" onClick={() => copier(lien(s.stagiaires[0].jeton))}><Copy className="w-4 h-4" />Copier le lien de l'espace stagiaire</button>
            </div>
          )}
        </Carte>
      ))}
    </div>
  )
}
