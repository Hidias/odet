import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import { Loader2, X } from 'lucide-react'
import { supabase } from '../../../core/supabase'

// Satisfaction de l'entreprise (0415) : avis donné en ligne depuis l'espace entreprise, après la formation.
// Note globale obligatoire, le reste facultatif ; modifiable ensuite.
// Espace par lien (0504) : mêmes questions, lecture et envoi passés en paramètres (`charger`, `enregistrer`).
// Une lecture qui échoue n'ouvre pas le formulaire : un envoi n'écrase jamais un avis qu'on n'a pas pu relire.

export const QUESTIONS_ENTREPRISE = [
  ['q_organisation', 'Organisation (dates, lieu, documents)'],
  ['q_communication', 'Échanges avec l\'organisme'],
  ['q_objectifs', 'Atteinte des objectifs pour vos salariés'],
  ['q_suivi', 'Suivi après la formation'],
]

const parCompte = {
  charger: (sessionId) => supabase.rpc('ent_satisfaction', { p_session: sessionId, p_reponses: null }),
  enregistrer: (sessionId, r) => supabase.rpc('ent_satisfaction', { p_session: sessionId, p_reponses: r }),
}

// Messages des règles de 0415 et 0504 (en français, majuscule en tête) montrés tels quels ; le reste (réseau, refus
// technique de PostgreSQL comme « permission denied », même code 42501) en phrase simple
export const messageAvis = (error, defaut) => (['22023', '42501'].includes(error?.code) && /^[A-ZÀ-Ý]/.test(error.message || '') ? error.message : defaut)

// Même critère que la base (0504) : session non annulée, dernier jour passé (fin, sinon début)
export const avisPossible = (s, aujourdhui) => s?.status !== 'cancelled' && !!(s?.end_date || s?.start_date) && (s.end_date || s.start_date) <= aujourdhui

const Notes = ({ valeur, onChange, label }) => (
  <div className="flex gap-1.5" role="radiogroup" aria-label={label}>
    {[1, 2, 3, 4, 5].map((n) => (
      <button key={n} type="button" role="radio" aria-checked={valeur === n} onClick={() => onChange(valeur === n ? null : n)}
        className={`w-10 h-10 rounded-ui border text-sm font-semibold ${valeur === n ? 'bg-accent-500 text-accent-fg border-accent-500' : 'bg-white text-gray-600 border-gray-200'}`}>{n}</button>
    ))}
  </div>
)

export default function AvisEntreprise({ session, onFermer, onEnvoye, charger = parCompte.charger, enregistrer = parCompte.enregistrer }) {
  const [r, setR] = useState({ note_globale: null, recommande: null, commentaire: '', besoins: '' })
  const [charge, setCharge] = useState(false)
  const [erreurLecture, setErreurLecture] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let actif = true
    Promise.resolve(charger(session.id)).then(({ data, error }) => {
      if (!actif) return
      if (error || data?.error) { setErreurLecture(data?.error || messageAvis(error, 'Votre avis ne peut pas être affiché pour le moment. Réessayez plus tard.')); return }
      if (data) setR({ ...data, commentaire: data.commentaire || '', besoins: data.besoins || '' })
      setCharge(true)
    }, () => { if (actif) setErreurLecture('Votre avis ne peut pas être affiché pour le moment. Réessayez plus tard.') })
    return () => { actif = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id])

  const envoyer = async () => {
    if (!r.note_globale) { toast.error('Indiquez une note globale'); return }
    setBusy(true)
    let res
    try { res = await enregistrer(session.id, r) } catch { res = { error: {} } }
    setBusy(false)
    const { data, error } = res
    if (error || data?.error) { toast.error(data?.error || messageAvis(error, 'Avis non enregistré. Réessayez dans un instant.')); return }
    toast.success('Merci pour votre avis')
    onEnvoye?.(session.id, r.note_globale)
    onFermer()
  }

  // Rendue au niveau de la page (22/10) : jamais coupée par une carte animée
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Votre avis sur la formation">
      <div className="bg-white w-full sm:max-w-lg rounded-t-ui-lg sm:rounded-ui-lg max-h-[92vh] overflow-y-auto p-4 space-y-4">
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <h2 className="font-display font-semibold text-gray-900">Votre avis sur la formation</h2>
            <p className="text-sm text-gray-500">{session.courses?.title || 'Formation'} · {session.reference}</p>
          </div>
          <button type="button" onClick={onFermer} disabled={busy} className="p-2 -m-1 text-gray-400 hover:text-gray-600" aria-label="Fermer"><X className="w-5 h-5" /></button>
        </div>
        {erreurLecture ? (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-gray-700">{erreurLecture}</p>
            <button type="button" onClick={onFermer} className="btn btn-secondary w-full">Fermer</button>
          </div>
        ) : !charge ? <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div> : (
          <>
            <div className="space-y-1">
              <div className="text-sm font-medium text-gray-800">Note globale (obligatoire)</div>
              <p className="text-xs text-gray-500">De 1 (pas satisfait) à 5 (très satisfait).</p>
              <Notes valeur={r.note_globale} label="Note globale" onChange={(v) => setR({ ...r, note_globale: v })} />
            </div>
            <div className="space-y-3">
              {QUESTIONS_ENTREPRISE.map(([k, l]) => (
                <div key={k} className="space-y-1">
                  <div className="text-sm text-gray-700">{l}</div>
                  <Notes valeur={r[k] || null} label={l} onChange={(v) => setR({ ...r, [k]: v })} />
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-gray-700">Recommanderiez-vous cette formation ?</span>
              <div className="flex gap-2">
                {[[true, 'Oui'], [false, 'Non']].map(([v, l]) => (
                  <button key={l} type="button" onClick={() => setR({ ...r, recommande: r.recommande === v ? null : v })}
                    className={`px-4 py-2.5 rounded-ui text-sm font-medium border ${r.recommande === v ? 'bg-accent-500 text-accent-fg border-accent-500' : 'bg-white text-gray-700 border-gray-200'}`}>{l}</button>
                ))}
              </div>
            </div>
            <label className="block space-y-1">
              <span className="text-sm text-gray-700">Vos remarques (facultatif)</span>
              <textarea className="w-full rounded-ui border border-gray-200 p-2 text-sm" rows={3} maxLength={2000}
                value={r.commentaire} onChange={(e) => setR({ ...r, commentaire: e.target.value })} />
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-gray-700">Des besoins de formation à venir ? (facultatif)</span>
              <textarea className="w-full rounded-ui border border-gray-200 p-2 text-sm" rows={2} maxLength={1000}
                value={r.besoins} onChange={(e) => setR({ ...r, besoins: e.target.value })} />
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={onFermer} disabled={busy} className="btn btn-secondary flex-1">Annuler</button>
              <button type="button" onClick={envoyer} disabled={busy} className="btn btn-primary flex-1">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Envoyer</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
