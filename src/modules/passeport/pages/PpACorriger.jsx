// « À corriger » : rejets du portail, cause probable, correction de la fiche, fichier de correction
// (nouvel identifiant -C1, -C2 et déclaration _C1, _C2 : seules les lignes corrigées repartent).

import { useState } from 'react'
import { X } from 'lucide-react'
import { causeLabel, frDate, identifiants } from '../lib/rules'
import GenerationModal from '../components/GenerationModal'
import PasseportTraineeBlock from '../components/PasseportTraineeBlock'

export default function PpACorriger({ aCorriger, format, reload }) {
  const [selection, setSelection] = useState(() => new Set())
  const [fiche, setFiche] = useState(null)
  const [generation, setGeneration] = useState(null)

  const toggle = (id) => setSelection((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const corrigees = aCorriger.filter((i) => i.ligne?.corrige_le && !i.bloquants.length)
  const ids = aCorriger.filter((i) => selection.has(i.inscription_id) && !i.bloquants.length).map((i) => i.inscription_id)

  if (aCorriger.length === 0) {
    return <div className="card text-ui muted">Aucun rejet à corriger. Les rejets apparaissent ici après l'import d'un accusé de traitement.</div>
  }

  return (
    <div className="space-y-3 pb-20 sm:pb-0">
      <div className="flex flex-wrap gap-2 items-center">
        <p className="text-ui text-gray-700 flex-1">Corrigez la fiche, puis préparez le fichier de correction : seules les lignes corrigées repartent, avec un nouvel identifiant pour que le portail ne les prenne pas pour un doublon.</p>
        {corrigees.length > 0 && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelection(new Set(corrigees.map((i) => i.inscription_id)))}>Sélectionner les corrigées ({corrigees.length})</button>}
      </div>

      <div className="grid gap-2">
        {aCorriger.map((i) => {
          const e = i.dernier_envoi || {}
          const prochain = identifiants(i.ligne?.id_unique_base, i.reference, (i.ligne?.tentative || 1) + 1, format.contrat)
          return (
            <div key={i.inscription_id} className="card p-3 flex gap-3 items-start">
              <input type="checkbox" className="w-5 h-5 mt-1" aria-label={`Sélectionner ${i.last_name}`} disabled={i.bloquants.length > 0}
                checked={selection.has(i.inscription_id)} onChange={() => toggle(i.inscription_id)} />
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <b>{i.last_name} {i.first_name}</b>
                  <span className="text-ui-sm muted">{i.gender === 'female' ? 'Femme' : i.gender === 'male' ? 'Homme' : ''}{i.nir_fin ? `, numéro finit par ${i.nir_fin}` : ''}</span>
                  {i.ligne?.corrige_le ? <span className="badge badge-success">Corrigé le {frDate(i.ligne.corrige_le)}</span> : <span className="badge badge-warning">À corriger</span>}
                </div>
                <div className="text-ui-sm text-gray-600">{i.course_title}, fin {frDate(i.end_date)} · {i.reference}</div>
                <div className="text-ui-sm"><span className="badge badge-danger">{e.code_erreur || 'Rejet'}</span> {e.description_erreur}{e.colonne ? ` (colonne ${e.colonne})` : ''}</div>
                <div className="text-ui-sm text-gray-800"><b>Cause probable :</b> {causeLabel(e, format.regles)}</div>
                {i.bloquants.map((b) => <div key={b.code} className="text-ui-sm text-red-700">{b.label}</div>)}
                <div className="text-ui-sm muted">Envoi n° {i.ligne?.tentative || 1}. Prochain envoi : <code>{prochain.idDeclaration}</code>, <code className="break-all">{prochain.idUnique}</code></div>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFiche(i)}>Corriger la fiche</button>
            </div>
          )
        })}
      </div>

      {fiche && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label="Corriger le stagiaire">
          <div className="bg-white w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-ui-lg sm:rounded-ui-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="section-title flex-1">{fiche.last_name} {fiche.first_name}</div>
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => { setFiche(null); reload() }} aria-label="Fermer"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-ui-sm text-gray-700">{causeLabel(fiche.dernier_envoi, format.regles)}</p>
            <PasseportTraineeBlock compact trainee={{
              id: fiche.trainee_id, last_name: fiche.last_name, gender: fiche.gender, nom_naissance: fiche.nom_naissance,
              nom_naissance_confirme_le: fiche.nom_naissance_confirme_le, refused_ssn: fiche.refused_ssn,
            }} />
            <button type="button" className="btn btn-secondary w-full" onClick={() => { setFiche(null); reload() }}>Terminé</button>
          </div>
        </div>
      )}

      {ids.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 sm:static z-30 bg-white sm:bg-transparent border-t sm:border-0 border-gray-200 p-3 sm:p-0">
          <button type="button" className="btn btn-primary w-full sm:w-auto" onClick={() => setGeneration(ids)}>Préparer le fichier de correction ({ids.length})</button>
        </div>
      )}
      {generation && <GenerationModal correction inscriptionIds={generation} onClose={() => { setGeneration(null); setSelection(new Set()); reload() }} />}
    </div>
  )
}
