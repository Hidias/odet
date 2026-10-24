// Fenêtre « Dossier de relecture » (24/10) : un PDF par prestation et par variante, des PDF mixtes au choix, une page
// pour le relecteur en tête de chacun, les fichiers Word en plus ; le tout dans un seul fichier ZIP.
import { useState } from 'react'
import toast from 'react-hot-toast'
import { X, Loader2, Download, Plus, Trash2 } from 'lucide-react'
import { loadPdfOrg } from '../../../core/pdf/pdfOrg'
import { loadTemplateContext } from '../../../core/org/templateContext'
import { docCode } from '../../../core/org/currentOrg'
import { libelleMetier } from '../../commercial/lib/metierDevis'
import { PRESTATIONS, planDossier, fabriquerDossier, documentsDe, aVarianteParticuliers } from './dossierRelecture'
import { fromTemplate } from './model'

export default function DossierRelecture({ templates, onFermer, relecteurInitial = '', prestationsInitiales = PRESTATIONS }) {
  const [prestations, setPrestations] = useState(prestationsInitiales)
  const [particuliers, setParticuliers] = useState(true)
  const [mixtes, setMixtes] = useState([['maintenance', 'vente']])
  const [relecteur, setRelecteur] = useState(relecteurInitial)
  const [consigne, setConsigne] = useState('')
  const [echeance, setEcheance] = useState('')
  const [avecWord, setAvecWord] = useState(true)
  const [busy, setBusy] = useState(false)
  const aPart = (id) => templates?.[id] ? aVarianteParticuliers(fromTemplate(templates[id])) : false
  const plan = planDossier({ prestations, particuliers, mixtes }, aPart)
  const basculer = (m) => setPrestations(prestations.includes(m) ? prestations.filter((x) => x !== m) : PRESTATIONS.filter((x) => x === m || prestations.includes(x)))

  const preparer = async () => {
    if (!plan.length) { toast.error('Choisissez au moins une prestation'); return }
    setBusy(true)
    try {
      const [{ default: JSZip }, ORG, ctx] = await Promise.all([import('jszip'), loadPdfOrg(true), loadTemplateContext()])
      const fichiers = await fabriquerDossier({ plan, templates, ORG, ctx, codeDe: docCode, relecteur: relecteur.trim(), consigne: consigne.trim(), echeance, avecWord })
      const zip = new JSZip()
      fichiers.forEach((f) => zip.file(f.nom, f.bytes))
      const blob = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `Dossier de relecture ${new Date().toISOString().slice(0, 10)}.zip`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 2000)
      toast.success(`${fichiers.filter((f) => f.nom.endsWith('.pdf')).length} PDF prêts`)
    } catch (e) { console.error(e); toast.error(e.message || 'Dossier impossible') }
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="Dossier de relecture">
      <div className="bg-white rounded-ui-lg w-full max-w-lg max-h-[92vh] overflow-y-auto p-4 space-y-3">
        <div className="flex items-center justify-between"><h2 className="font-semibold text-lg">Dossier de relecture</h2><button type="button" className="btn btn-ghost btn-icon" aria-label="Fermer" onClick={onFermer}><X className="w-5 h-5" /></button></div>
        <p className="text-ui-sm text-gray-500">Un PDF par prestation, avec la mise en page remise aux clients, précédé d'une page pour le relecteur (points à valider, passages à compléter, choix déjà faits). Le texte est celui de la relecture en cours, sinon le brouillon, sinon le modèle.</p>
        <fieldset>
          <legend className="label">Prestations</legend>
          {PRESTATIONS.map((m) => (
            <label key={m} className="flex items-center gap-2 min-h-[40px] text-ui">
              <input type="checkbox" className="w-4 h-4" checked={prestations.includes(m)} onChange={() => basculer(m)} />
              <span>{libelleMetier(m)} <span className="text-gray-500 text-ui-sm">({documentsDe([m]).map((d) => d.label).join(', ')})</span></span>
            </label>
          ))}
        </fieldset>
        <label className="flex items-center gap-2 min-h-[40px] text-ui"><input type="checkbox" className="w-4 h-4" checked={particuliers} onChange={(e) => setParticuliers(e.target.checked)} />Ajouter la version pour les particuliers quand elle existe</label>
        <div className="space-y-2">
          <p className="label">PDF mixtes (prestations vendues ensemble)</p>
          {mixtes.map((ms, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-ui-sm border border-gray-200 p-2">
              {PRESTATIONS.map((m) => (
                <label key={m} className="flex items-center gap-1.5 text-ui-sm min-h-[36px]">
                  <input type="checkbox" className="w-4 h-4" checked={ms.includes(m)} onChange={() => setMixtes(mixtes.map((x, j) => (j === i ? (x.includes(m) ? x.filter((y) => y !== m) : PRESTATIONS.filter((y) => y === m || x.includes(y))) : x)))} />{libelleMetier(m)}
                </label>
              ))}
              <button type="button" className="btn btn-ghost btn-icon ml-auto" aria-label="Retirer ce mixte" onClick={() => setMixtes(mixtes.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMixtes([...mixtes, []])}><Plus className="w-4 h-4" />Ajouter un mixte</button>
        </div>
        <label className="block"><span className="label">Relecteur (facultatif)</span><input className="input" value={relecteur} maxLength={120} placeholder="Nom et qualité de l'expert" onChange={(e) => setRelecteur(e.target.value)} /></label>
        <label className="block"><span className="label">Précision pour le relecteur (facultatif)</span><textarea className="input w-full" rows={2} maxLength={1000} value={consigne} onChange={(e) => setConsigne(e.target.value)} /></label>
        <label className="block"><span className="label">Réponse souhaitée avant le (facultatif)</span><input type="date" className="input" value={echeance} onChange={(e) => setEcheance(e.target.value)} /></label>
        <label className="flex items-center gap-2 min-h-[40px] text-ui"><input type="checkbox" className="w-4 h-4" checked={avecWord} onChange={(e) => setAvecWord(e.target.checked)} />Joindre aussi les fichiers Word (corrections en modifications suivies, réimportées dans la relecture)</label>
        <p className="text-ui-sm text-gray-600">{plan.length} PDF : {plan.map((e) => e.titre).join(' · ') || 'aucun'}</p>
        <button type="button" className="btn btn-primary w-full" disabled={busy || !plan.length} onClick={preparer}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}Télécharger le dossier (ZIP)</button>
      </div>
    </div>
  )
}
