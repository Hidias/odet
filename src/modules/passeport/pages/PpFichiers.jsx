// « Fichiers et accusés » : fichiers préparés (sans leur contenu, jamais stocké), alerte quand un fichier attend
// son accusé depuis trop longtemps, import de l'accusé de traitement renvoyé par le portail.

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Upload, Loader2, AlertTriangle } from 'lucide-react'
import { useDataStore } from '../../../core/store'
import { importerAccuse, marquerFichier, apiPasseport, telechargerTexte, loadAccuses } from '../lib/ppData'
import { lireAccuse, frDate, isoDate, daysBetween } from '../lib/rules'

export default function PpFichiers({ fichiers, fichiersSansAccuse, format, reload, today }) {
  const { organization, fetchOrganization } = useDataStore()
  const [busy, setBusy] = useState(false)
  const [resultat, setResultat] = useState(null)
  const [accuses, setAccuses] = useState([])
  const inputRef = useRef(null)

  useEffect(() => { if (!organization) fetchOrganization?.() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadAccuses().then(setAccuses).catch(() => {}) }, [fichiers])

  const importer = async (file) => {
    if (!file) return
    setBusy(true); setResultat(null)
    try {
      const text = await file.text()
      const lu = lireAccuse(text, format.contrat)
      if (!lu.ok) { toast.error(lu.error); setBusy(false); return }
      if (!lu.lignes.length) { toast.error('Aucune ligne dans cet accusé'); setBusy(false); return }
      const r = await importerAccuse(file.name, lu.lignes)
      setResultat(r)
      await reload()
    } catch (e) { toast.error(e.message) }
    setBusy(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  const accuseDemo = async (f) => {
    try {
      const r = await apiPasseport('demo-accuse', { fichier_id: f.id })
      telechargerTexte(r.nom, r.contenu)
      toast.success('Accusé fictif téléchargé : déposez-le ci-dessus')
    } catch (e) { toast.error(e.message) }
  }

  const nonDepose = async (f, v) => {
    try { await marquerFichier(f.id, v); await reload() } catch (e) { toast.error(e.message) }
  }

  const alerte = format.regles?.alerte_sans_accuse_jours ?? 15

  return (
    <div className="space-y-4">
      {fichiersSansAccuse.length > 0 && (
        <div className="card border-red-200 bg-red-50 text-red-900 flex gap-2 items-start">
          <AlertTriangle className="w-5 h-5 flex-none mt-0.5" aria-hidden="true" />
          <div className="text-ui">{fichiersSansAccuse.length} fichier{fichiersSansAccuse.length > 1 ? 's' : ''} sans accusé depuis plus de {alerte} jours. L'avez-vous déposé sur le portail ? Déposez son accusé, ou marquez-le « non déposé » pour que ses stagiaires reviennent dans « À déclarer ».</div>
        </div>
      )}

      <section className="card space-y-3">
        <h2 className="section-title">Déposer l'accusé de traitement</h2>
        <p className="text-ui-sm text-gray-600">Le fichier reçu du portail, tel quel (séparateur point-virgule). Succès : la déclaration passe en « Déclaré » et le numéro est effacé quand il ne sert plus. Rejet : il part dans « À corriger », le numéro est gardé.</p>
        <label className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-ui-lg p-6 text-center cursor-pointer hover:bg-gray-50 ${busy ? 'opacity-60' : ''}`}>
          {busy ? <Loader2 className="w-6 h-6 animate-spin text-gray-500" /> : <Upload className="w-6 h-6 text-gray-500" aria-hidden="true" />}
          <span className="text-ui"><b>Choisir l'accusé</b> (fichier .csv ou .txt)</span>
          <input ref={inputRef} type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" disabled={busy} onChange={(e) => importer(e.target.files?.[0])} />
        </label>
        {resultat && (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-ui bg-green-50 text-green-800 p-2"><div className="font-display text-2xl font-bold">{resultat.succes}</div><div className="text-ui-sm">acceptée{resultat.succes > 1 ? 's' : ''}</div></div>
              <div className="rounded-ui bg-red-50 text-red-800 p-2"><div className="font-display text-2xl font-bold">{resultat.echecs}</div><div className="text-ui-sm">rejetée{resultat.echecs > 1 ? 's' : ''}</div></div>
              <div className="rounded-ui bg-gray-100 text-gray-700 p-2"><div className="font-display text-2xl font-bold">{resultat.inconnus}</div><div className="text-ui-sm">inconnue{resultat.inconnus > 1 ? 's' : ''}</div></div>
            </div>
            <p className="text-ui-sm text-gray-700">{resultat.lignes} ligne{resultat.lignes > 1 ? 's' : ''} lue{resultat.lignes > 1 ? 's' : ''}. {resultat.numeros_effaces} numéro{resultat.numeros_effaces > 1 ? 's' : ''} effacé{resultat.numeros_effaces > 1 ? 's' : ''}.{resultat.inconnus > 0 ? ' Lignes inconnues : identifiants qui ne viennent pas de cet outil.' : ''}</p>
            {resultat.echecs > 0 && <Link to="../a-corriger" className="btn btn-primary">Voir les rejets à corriger</Link>}
          </div>
        )}
      </section>

      <section className="card p-0 overflow-x-auto">
        <table>
          <thead><tr><th>Préparé le</th><th>Fichier</th><th>Stagiaires</th><th>Accusé</th><th></th></tr></thead>
          <tbody>
            {fichiers.length === 0 && <tr><td colSpan={5} className="muted">Aucun fichier préparé pour l'instant.</td></tr>}
            {fichiers.map((f) => {
              const age = daysBetween(isoDate(f.genere_le), today)
              return (
                <tr key={f.id}>
                  <td className="whitespace-nowrap">{frDate(f.genere_le)}</td>
                  <td><span className={`badge ${f.type_decl === 'JDR' ? 'badge-success' : 'badge-info'} mr-1.5`}>{f.type_decl}</span>{f.correction && <span className="badge badge-warning mr-1.5">Correction</span>}<code className="text-ui-sm break-all">{f.nom}</code></td>
                  <td>{f.nb_lignes}</td>
                  <td className="whitespace-nowrap">
                    {f.accuse_id ? <span className="badge badge-success">Importé</span>
                      : f.marque_non_depose ? <span className="badge badge-neutral">Non déposé</span>
                        : <span className={`badge ${age >= alerte ? 'badge-danger' : 'badge-warning'}`}>Attendu{age > 0 ? `, ${age} j` : ''}</span>}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    {!f.accuse_id && !f.marque_non_depose && <button type="button" className="btn btn-ghost btn-sm" onClick={() => nonDepose(f, true)}>Non déposé</button>}
                    {f.marque_non_depose && <button type="button" className="btn btn-ghost btn-sm" onClick={() => nonDepose(f, false)}>Annuler</button>}
                    {organization?.demo_mode && !f.accuse_id && <button type="button" className="btn btn-secondary btn-sm" onClick={() => accuseDemo(f)}>Accusé fictif</button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      {accuses.length > 0 && (
        <section className="card space-y-1">
          <h2 className="section-title">Accusés importés</h2>
          <ul className="text-ui-sm divide-y divide-gray-100">
            {accuses.map((a) => (
              <li key={a.id} className="py-1.5 flex flex-wrap gap-2">
                <span className="w-24">{frDate(a.importe_le)}</span>
                <span className="flex-1 break-all">{a.nom_fichier}</span>
                <span>{a.nb_succes} acceptée{a.nb_succes > 1 ? 's' : ''}, {a.nb_echecs} rejetée{a.nb_echecs > 1 ? 's' : ''}{a.nb_inconnus ? `, ${a.nb_inconnus} inconnue${a.nb_inconnus > 1 ? 's' : ''}` : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
