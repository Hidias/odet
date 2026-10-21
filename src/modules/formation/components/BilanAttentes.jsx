import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Target } from 'lucide-react'
import { supabase } from '../../../core/supabase'

// Bilan des attentes en fin de formation (0413) : pour chaque stagiaire, l'attente écrite dans sa fiche de
// renseignements, la réponse prévue par l'organisme (observation), l'avis du stagiaire sur le portail et le bilan
// de l'organisme, noté ici. Sert au suivi de la session et à l'audit (prise en compte des attentes).

export const VERDICTS = { oui: 'Satisfaites', en_partie: 'En partie', non: 'Non satisfaites' }
const TONS = {
  oui: 'text-[rgb(var(--c-success))] border-[rgb(var(--c-success))]',
  en_partie: 'text-[rgb(var(--c-warning))] border-[rgb(var(--c-warning))]',
  non: 'text-[rgb(var(--c-danger))] border-[rgb(var(--c-danger))]',
}

// Lignes du bilan : stagiaires ayant écrit une attente, dans l'ordre alphabétique
export function lignesBilan(inscrits, fiches, avis) {
  const fiche = Object.fromEntries((fiches || []).map((f) => [f.trainee_id, f]))
  const eva = Object.fromEntries((avis || []).map((e) => [e.trainee_id, e]))
  return (inscrits || [])
    .map((st) => ({
      ...st,
      attente: (fiche[st.trainee_id]?.training_expectations || '').trim(),
      avis: eva[st.trainee_id]?.attentes_satisfaites || null,
      avisCommentaire: eva[st.trainee_id]?.attentes_commentaire || '',
    }))
    .filter((l) => l.attente)
    .sort((a, b) => `${a.trainees?.last_name || ''} ${a.trainees?.first_name || ''}`.localeCompare(`${b.trainees?.last_name || ''} ${b.trainees?.first_name || ''}`, 'fr'))
}

export function resumeBilan(lignes) {
  const avecAvis = lignes.filter((l) => l.avis)
  return {
    total: lignes.length,
    avis: avecAvis.length,
    satisfaites: avecAvis.filter((l) => l.avis === 'oui').length,
    enPartie: avecAvis.filter((l) => l.avis === 'en_partie').length,
    non: avecAvis.filter((l) => l.avis === 'non').length,
  }
}

const Badge = ({ v }) => (v
  ? <span className={`inline-block border rounded-ui-sm px-2 py-0.5 text-ui-sm font-medium ${TONS[v]}`}>{VERDICTS[v]}</span>
  : <span className="text-ui-sm text-gray-400">pas encore</span>)

export default function BilanAttentes({ sessionId }) {
  const [lignes, setLignes] = useState(null)
  const [sansAttente, setSansAttente] = useState(0)
  const [enregistre, setEnregistre] = useState(null)

  useEffect(() => {
    if (!sessionId) return
    let actif = true
    Promise.all([
      supabase.from('session_trainees').select('id, trainee_id, admin_observation, attentes_bilan, attentes_bilan_note, trainees(first_name, last_name)').eq('session_id', sessionId),
      supabase.from('trainee_info_sheets').select('trainee_id, training_expectations').eq('session_id', sessionId),
      supabase.from('trainee_evaluations').select('trainee_id, attentes_satisfaites, attentes_commentaire').eq('session_id', sessionId),
    ]).then(([st, fi, ev]) => {
      if (!actif) return
      // Avant la migration 0413 (colonnes absentes) : le bloc ne s'affiche pas
      if (st.error || ev.error) { setLignes([]); return }
      const l = lignesBilan(st.data, fi.data, ev.data)
      setSansAttente((st.data || []).length - l.length)
      setLignes(l)
    })
    return () => { actif = false }
  }, [sessionId])

  const noter = async (ligne, champs) => {
    setLignes((ls) => ls.map((l) => (l.id === ligne.id ? { ...l, ...champs } : l)))
    const { error } = await supabase.from('session_trainees')
      .update({ ...champs, attentes_bilan_at: new Date().toISOString() }).eq('id', ligne.id)
    if (error) { toast.error(`Bilan non enregistré : ${error.message}`); return }
    setEnregistre(ligne.id)
    setTimeout(() => setEnregistre((x) => (x === ligne.id ? null : x)), 1500)
  }

  if (!lignes || lignes.length === 0) return null
  const r = resumeBilan(lignes)
  return (
    <div className="card space-y-3">
      <div>
        <h3 className="font-semibold flex items-center gap-2"><Target className="w-5 h-5 text-accent-600" aria-hidden="true" />Bilan des attentes</h3>
        <p className="text-ui text-gray-500 mt-1">
          {r.avis === 0
            ? `${r.total} stagiaire${r.total > 1 ? 's ont' : ' a'} écrit des attentes ; leur avis arrive avec l'évaluation à chaud.`
            : `Selon les stagiaires : ${r.satisfaites} sur ${r.avis} satisfaites${r.enPartie ? `, ${r.enPartie} en partie` : ''}${r.non ? `, ${r.non} non` : ''}.`}
          {sansAttente > 0 && ` ${sansAttente} stagiaire${sansAttente > 1 ? 's' : ''} sans attente écrite.`}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-ui">
          <thead>
            <tr className="text-left text-ui-sm text-gray-500 border-b border-gray-100">
              <th className="py-2 pr-3 font-medium">Stagiaire</th>
              <th className="py-2 pr-3 font-medium">Attente</th>
              <th className="py-2 pr-3 font-medium">Avis du stagiaire</th>
              <th className="py-2 font-medium">Bilan de l'organisme</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.id} className="border-b border-gray-50 align-top">
                <td className="py-2 pr-3 whitespace-nowrap font-medium text-gray-900">{l.trainees?.first_name} {l.trainees?.last_name?.toUpperCase()}</td>
                <td className="py-2 pr-3 text-gray-700 min-w-[14rem]">
                  <div className="whitespace-pre-line">{l.attente}</div>
                  {l.admin_observation && <div className="text-ui-sm text-gray-500 mt-1">Réponse prévue : {l.admin_observation}</div>}
                </td>
                <td className="py-2 pr-3 min-w-[9rem]">
                  <Badge v={l.avis} />
                  {l.avisCommentaire && <div className="text-ui-sm text-gray-600 mt-1 italic">« {l.avisCommentaire} »</div>}
                </td>
                <td className="py-2 min-w-[14rem] space-y-1">
                  <select className="select" aria-label={`Bilan des attentes de ${l.trainees?.first_name || ''} ${l.trainees?.last_name || ''}`}
                    value={l.attentes_bilan || ''} onChange={(e) => noter(l, { attentes_bilan: e.target.value || null })}>
                    <option value="">À noter</option>
                    {Object.entries(VERDICTS).map(([v, lab]) => <option key={v} value={v}>{lab}</option>)}
                  </select>
                  <input className="input" placeholder="Remarque (facultatif)" defaultValue={l.attentes_bilan_note || ''}
                    aria-label="Remarque sur le bilan des attentes"
                    onBlur={(e) => { if ((e.target.value || '') !== (l.attentes_bilan_note || '')) noter(l, { attentes_bilan_note: e.target.value || null }) }} />
                  {enregistre === l.id && <div className="text-ui-sm text-[rgb(var(--c-success))]">Enregistré</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
