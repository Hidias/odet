// Analyse du besoin remplie par l'entreprise dans son espace (0486) : l'organisme relit les réponses, écrit son
// analyse (ce qu'il retient et les adaptations prévues) puis valide. Seule l'analyse validée compte comme preuve
// de l'indicateur 4. Rouvrir rend la main à l'entreprise.
import { useState } from 'react'
import { CheckCircle, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../../../core/supabase'
import { confirmer } from '../../../ui/Confirm'
import { etatBesoinOrganisme, lignesBesoin } from '../lib/besoinClient'

const dateHeure = (d) => (d ? new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')

export default function BesoinClientRelecture({ analysis, peutEcrire, onChange }) {
  const [conclusion, setConclusion] = useState(analysis?.org_conclusion || '')
  const [busy, setBusy] = useState(false)
  if (!analysis?.client_submitted_at) return null
  const etat = etatBesoinOrganisme(analysis)
  const a = analysis

  const ecrire = async (champs, message) => {
    setBusy(true)
    const { data, error } = await supabase.from('session_needs_analysis').update(champs).eq('id', a.id).select('id')
    setBusy(false)
    if (error) { toast.error(error.message || 'Enregistrement impossible'); return }
    if (!data?.length) { toast.error('Enregistrement impossible : vos droits ne permettent pas de modifier cette session'); return }
    toast.success(message)
    onChange?.()
  }
  const valider = () => {
    if (!conclusion.trim()) { toast.error('Écrivez votre analyse avant de valider'); return }
    // La date réelle de validation est posée par la base (0486)
    ecrire({ org_conclusion: conclusion.trim(), org_validated_at: new Date().toISOString() }, 'Analyse du besoin validée')
  }
  const rouvrir = async () => {
    // Reprise par l'organisme après l'envoi (0486) : l'entreprise reste bloquée, seul l'organisme modifie
    const reprise = a.filled_at && new Date(a.filled_at) > new Date(a.client_submitted_at)
    const message = reprise
      ? 'Vous avez repris cette analyse après l\'envoi de l\'entreprise : vous seul pourrez la modifier. Votre analyse est conservée ; il faudra valider à nouveau.'
      : 'L\'entreprise pourra de nouveau modifier ses réponses dans son espace. Votre analyse est conservée ; il faudra valider à nouveau.'
    const ok = await confirmer({ title: 'Rouvrir l\'analyse ?', message, confirmLabel: 'Rouvrir' })
    if (ok) ecrire({ org_validated_at: null }, 'Analyse rouverte')
  }

  const lignes = lignesBesoin(a)

  return (
    <div className={`rounded-ui-sm border p-4 text-ui space-y-3 ${etat === 'validee' ? 'border-[rgb(var(--c-success)/0.4)] bg-[rgb(var(--c-success-bg))]' : 'border-[rgb(var(--c-warning)/0.4)] bg-[rgb(var(--c-warning-bg))]'}`}>
      <div className="font-medium text-gray-900">
        Réponses de l'entreprise, envoyées depuis son espace le {dateHeure(a.client_submitted_at)}
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-[14rem_1fr] gap-x-4 gap-y-1">
        {lignes.map(([k, v]) => (
          <div key={k} className="contents"><dt className="text-gray-600">{k}</dt><dd className="text-gray-900 whitespace-pre-line break-words">{v}</dd></div>
        ))}
      </dl>
      {a.psh_adaptation && (
        <p className="text-ui-sm text-gray-700">Besoin d'adaptation signalé : le référent handicap prend contact avec la personne indiquée et note les adaptations prévues dans l'analyse ci-dessous.</p>
      )}
      <label className="block">
        <span className="font-medium text-gray-900">Analyse de l'organisme *</span>
        <textarea className="w-full mt-1 px-3 py-2 border rounded-ui-sm text-ui bg-white" rows={3} value={conclusion}
          disabled={!peutEcrire || etat === 'validee' || busy} onChange={(e) => setConclusion(e.target.value)}
          placeholder="Ce que vous retenez du besoin, objectifs confirmés, adaptations prévues (contenu, matériel, rythme)" />
      </label>
      {etat === 'validee' ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[rgb(var(--c-success))] flex items-center gap-1"><CheckCircle className="w-4 h-4" />Validée le {dateHeure(a.org_validated_at)}</span>
          {peutEcrire && <button type="button" className="btn btn-sm btn-secondary flex items-center gap-1" onClick={rouvrir} disabled={busy}><RotateCcw className="w-4 h-4" />Rouvrir</button>}
        </div>
      ) : peutEcrire && (
        <button type="button" className="btn btn-sm btn-primary flex items-center gap-1" onClick={valider} disabled={busy}><CheckCircle className="w-4 h-4" />Valider l'analyse</button>
      )}
    </div>
  )
}
