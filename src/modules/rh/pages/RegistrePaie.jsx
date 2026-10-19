// Module RH, registre unique du personnel et éléments variables de paie (chantier 12, 0313) : onglet de Personnel
// réservé à qui voit les dossiers du personnel. Rien n'est saisi ici : tout vient des fiches, contrats, absences et
// semaines validées.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { FileDown, FileSpreadsheet, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react'
import { Spinner, EmptyState } from '../../../ui/EmptyState'
import { chargerRegistre, lignesRegistre, telechargerRegistrePDF, chargerVariablesMois, telechargerVariablesExcel } from '../lib/rhRegistre'

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const h = (min) => (min ? `${Math.floor(min / 60)} h${min % 60 ? String(min % 60).padStart(2, '0') : ''}` : '')
const jours = (n) => `${String(n).replace('.', ',')} j`

function Registre() {
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { chargerRegistre().then((r) => setRows(lignesRegistre(r))).catch((e) => { toast.error(e.message); setRows([]) }) }, [])
  if (!rows) return <Spinner />
  const incomplets = rows.filter((r) => r.incomplet)
  const pdf = async () => { setBusy(true); try { await telechargerRegistrePDF(rows) } catch (e) { toast.error(e.message) } setBusy(false) }
  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="section-title">Registre unique du personnel</h2>
          <p className="text-ui-sm text-gray-600">Obligatoire dès le premier salarié, généré depuis les fiches et les contrats, dans l'ordre des embauches.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={pdf} disabled={busy || !rows.length}><FileDown className="w-4 h-4" aria-hidden="true" />Télécharger le registre (PDF)</button>
      </div>
      {rows.length === 0 && <EmptyState title="Aucun contrat enregistré" compact>Le registre se remplit avec les contrats saisis sur les fiches du personnel.</EmptyState>}
      {incomplets.length > 0 && (
        <div className="rounded-ui-sm border border-[rgb(var(--c-warning)/0.4)] bg-[rgb(var(--c-warning-bg))] p-3 text-ui-sm space-y-1">
          <div className="font-semibold flex items-center gap-2"><AlertTriangle className="w-4 h-4" aria-hidden="true" />{incomplets.length} ligne{incomplets.length > 1 ? 's' : ''} incomplète{incomplets.length > 1 ? 's' : ''}</div>
          <p>Nationalité, sexe, date de naissance et emploi sont des mentions obligatoires. Complétez la fiche ou le contrat :</p>
          <ul className="list-disc pl-5">{incomplets.slice(0, 8).map((r) => <li key={r.numero}>{r.nom}</li>)}</ul>
        </div>
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-ui-sm">
            <thead><tr className="text-left text-gray-500 border-b">
              <th className="py-2 pr-2">N°</th><th className="py-2 pr-2">Nom et prénoms</th><th className="py-2 pr-2">Emploi</th><th className="py-2 pr-2">Entrée</th><th className="py-2 pr-2">Sortie</th><th className="py-2">Contrat</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.numero} className={r.incomplet ? 'bg-[rgb(var(--c-warning-bg)/0.4)]' : ''}>
                  <td className="py-2 pr-2 tabular-nums">{r.numero}</td><td className="py-2 pr-2 font-medium">{r.nom}</td><td className="py-2 pr-2">{r.emploi}</td>
                  <td className="py-2 pr-2 whitespace-nowrap">{r.entree}</td><td className="py-2 pr-2 whitespace-nowrap">{r.sortie}</td><td className="py-2">{r.contrat}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function VariablesPaie() {
  const now = new Date()
  const [periode, setPeriode] = useState({ annee: now.getFullYear(), mois: now.getMonth() + 1 })
  const [lignes, setLignes] = useState(null)
  const charger = useCallback(() => {
    setLignes(null)
    chargerVariablesMois(periode.annee, periode.mois).then(setLignes).catch((e) => { toast.error(e.message); setLignes([]) })
  }, [periode])
  useEffect(() => { charger() }, [charger])
  const decaler = (n) => {
    const d = new Date(periode.annee, periode.mois - 1 + n, 1)
    setPeriode({ annee: d.getFullYear(), mois: d.getMonth() + 1 })
  }
  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="section-title">Éléments variables de paie</h2>
          <p className="text-ui-sm text-gray-600">Absences et heures supplémentaires validées du mois, à transmettre au cabinet qui fait la paie. L'outil ne calcule pas la paie.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-ghost btn-icon" onClick={() => decaler(-1)} aria-label="Mois précédent"><ChevronLeft className="w-4 h-4" /></button>
          <span className="font-semibold min-w-[9rem] text-center">{MOIS[periode.mois - 1]} {periode.annee}</span>
          <button type="button" className="btn btn-ghost btn-icon" onClick={() => decaler(1)} aria-label="Mois suivant"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>
      {lignes === null ? <Spinner /> : lignes.length === 0 ? (
        <EmptyState title="Rien de validé ce mois-ci" compact>Les absences validées et les semaines d'heures validées du mois apparaissent ici.</EmptyState>
      ) : (
        <>
          <ul className="divide-y divide-gray-100">
            {lignes.map((l) => (
              <li key={l.personId} className="py-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <Link to={`/collaborateurs/${l.personId}`} className="font-semibold text-ui min-w-[10rem]">{l.nom}</Link>
                <span className="text-ui-sm text-gray-600">{Object.entries(l.absences).map(([t, n]) => `${t} : ${jours(n)}`).join(' · ') || 'Aucune absence'}</span>
                {(l.sup25 + l.sup50) > 0 && <span className="text-ui-sm text-gray-600">Heures sup. : {h(l.sup25)} à 25 %{l.sup50 ? `, ${h(l.sup50)} à 50 %` : ''}</span>}
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-secondary" onClick={() => telechargerVariablesExcel(lignes, periode.annee, periode.mois)}><FileSpreadsheet className="w-4 h-4" aria-hidden="true" />Télécharger le tableau (Excel)</button>
        </>
      )}
      <p className="text-ui-sm muted">Heures supplémentaires : semaines validées commencées dans le mois, majorées de 25 % les 8 premières puis 50 % (valeurs du Code du travail à défaut d'accord, à confirmer pour votre convention).</p>
    </section>
  )
}

export default function RegistrePaie() {
  return (
    <div className="space-y-4">
      <Registre />
      <VariablesPaie />
    </div>
  )
}
