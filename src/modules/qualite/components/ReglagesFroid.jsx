// Réglages des évaluations à froid (0482) : délais par société, délai et questions par formation.
import { useEffect, useState } from 'react'
import { Plus, Save, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../../../core/supabase'
import { QUESTIONS_BASE, nouvelleQuestion } from '../lib/froid'

const CHAMPS = [
  ['premier_envoi_jours', 'Premier envoi, jours après la fin de la formation', 7, 365],
  ['relance_apres_jours', 'Relance, jours après le premier envoi', 7, 365],
  ['entre_relances_jours', 'Jours entre deux relances', 7, 365],
  ['relances_max', 'Nombre de relances', 0, 3],
  ['anciennete_max_jours', 'Sessions exclues au-delà de (jours)', 30, 1095],
]

function Societe({ r, onEnregistre }) {
  const [v, setV] = useState(r)
  const enregistrer = async () => {
    const { error } = await supabase.rpc('froid_reglages_enregistrer', { p_company: r.company_id, p: v })
    if (error) return toast.error(error.message)
    toast.success('Réglages enregistrés')
    onEnregistre?.()
  }
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-ui"><input type="checkbox" className="w-4 h-4" checked={!!v.actif} onChange={(e) => setV({ ...v, actif: e.target.checked })} />Préparer les évaluations à froid</label>
      <label className="flex items-center gap-2 text-ui"><input type="checkbox" className="w-4 h-4" checked={!!v.employeur_actif} onChange={(e) => setV({ ...v, employeur_actif: e.target.checked })} />Demander aussi l'avis de l'employeur</label>
      <div className="grid sm:grid-cols-2 gap-2">
        {CHAMPS.map(([k, l, min, max]) => (
          <label key={k} className="text-ui-sm text-gray-600">{l}
            <input type="number" className="input mt-1" min={min} max={max} value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value === '' ? null : Number(e.target.value) })} />
          </label>
        ))}
      </div>
      <button type="button" className="btn btn-primary btn-sm flex items-center gap-1" onClick={enregistrer}><Save className="w-4 h-4" />Enregistrer</button>
    </div>
  )
}

function Formation() {
  const [courses, setCourses] = useState([])
  const [id, setId] = useState('')
  const [delai, setDelai] = useState('')
  const [questions, setQuestions] = useState(QUESTIONS_BASE)
  useEffect(() => { supabase.from('courses').select('id, title, froid_delai_jours, froid_questions').order('title').then(({ data }) => setCourses(data || [])) }, [])
  const choisir = (cid) => {
    setId(cid)
    const c = courses.find((x) => x.id === cid)
    setDelai(c?.froid_delai_jours ?? '')
    setQuestions(Array.isArray(c?.froid_questions) && c.froid_questions.length ? c.froid_questions : QUESTIONS_BASE)
  }
  const enregistrer = async () => {
    if (questions.some((q) => !String(q.libelle || '').trim())) return toast.error('Chaque question a besoin d\'un intitulé')
    const base = JSON.stringify(questions) === JSON.stringify(QUESTIONS_BASE)
    const { error } = await supabase.from('courses').update({ froid_delai_jours: delai === '' ? null : Number(delai), froid_questions: base ? null : questions }).eq('id', id)
    if (error) return toast.error(error.message)
    setCourses((l) => l.map((c) => (c.id === id ? { ...c, froid_delai_jours: delai === '' ? null : Number(delai), froid_questions: base ? null : questions } : c)))
    toast.success('Formation enregistrée')
  }
  const majQ = (i, k, val) => setQuestions((l) => l.map((q, j) => (j === i ? { ...q, [k]: val } : q)))
  const estBase = (q) => QUESTIONS_BASE.some((b) => b.cle === q.cle)
  return (
    <div className="space-y-2">
      <select className="input text-ui" value={id} onChange={(e) => choisir(e.target.value)} aria-label="Formation">
        <option value="">Choisir une formation</option>
        {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
      </select>
      {id && (
        <>
          <label className="text-ui-sm text-gray-600 block">Délai du premier envoi pour cette formation (jours, vide : réglage de la société)
            <input type="number" min={7} max={365} className="input mt-1" value={delai} onChange={(e) => setDelai(e.target.value)} />
          </label>
          <div className="space-y-2">
            {questions.map((q, i) => (
              <div key={q.cle} className="flex flex-wrap items-center gap-2">
                <input className="input text-ui flex-1 min-w-[14rem]" value={q.libelle} maxLength={300} onChange={(e) => majQ(i, 'libelle', e.target.value)} aria-label={`Question ${i + 1}`} />
                <select className="input text-ui w-auto" value={q.type} disabled={estBase(q)} onChange={(e) => majQ(i, 'type', e.target.value)} aria-label="Type de réponse">
                  <option value="oui_non">Oui ou non</option><option value="note">Note de 1 à 5</option><option value="texte">Texte libre</option>
                </select>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setQuestions((l) => l.filter((_, j) => j !== i))} aria-label="Retirer la question"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary btn-sm flex items-center gap-1" disabled={questions.length >= 20} onClick={() => setQuestions((l) => [...l, nouvelleQuestion(l)])}><Plus className="w-4 h-4" />Ajouter une question</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setQuestions(QUESTIONS_BASE)}>Revenir aux questions de base</button>
            <button type="button" className="btn btn-primary btn-sm flex items-center gap-1" onClick={enregistrer} disabled={!questions.length}><Save className="w-4 h-4" />Enregistrer</button>
          </div>
          <p className="text-ui-sm text-gray-500">Les réponses déjà reçues ne changent pas. Les questions de base alimentent les indicateurs.</p>
        </>
      )}
    </div>
  )
}

export default function ReglagesFroid({ reglages, onEnregistre, catalogue = false }) {
  return (
    <div className="card space-y-4">
      {(reglages || []).map((r) => (
        <div key={r.company_id}>
          <h2 className="font-semibold mb-2">Délais{(reglages || []).length > 1 && r.nom ? ` : ${r.nom}` : ''}</h2>
          <Societe r={r} onEnregistre={onEnregistre} />
        </div>
      ))}
      <div>
        <h2 className="font-semibold mb-2">Par formation</h2>
        {catalogue ? <Formation /> : <p className="text-ui-sm text-gray-500">Le délai et les questions propres à une formation se règlent avec le droit de gérer le catalogue des formations.</p>}
      </div>
    </div>
  )
}
