// Documents mis à disposition par le prestataire (0404) : rapports d'intervention, factures, devis, contrats et
// autres PDF, rangés tels quels. Chaque téléchargement est noté au journal de l'espace client (0401).

import { useEffect, useState } from 'react'
import { FileText, Receipt, Wrench, FileSignature, ScrollText, Download, Loader2, FolderOpen, PenLine, BadgeCheck, Printer, Clock, AlertCircle, Upload } from 'lucide-react'
import { imprimer } from '../../../core/fichiers/imprimer'
import { rechargerSiMiseAJour } from '../../../core/errors/chunkReload'

const TYPES = {
  rapport: { label: "Rapports d'intervention", icone: Wrench },
  avis_passage: { label: 'Avis de passage', icone: Clock },
  facture: { label: 'Factures et avoirs', icone: Receipt },
  devis: { label: 'Devis', icone: FileSignature },
  contrat: { label: 'Contrats', icone: ScrollText },
  convention: { label: 'Conventions', icone: FileSignature },
  attestation: { label: 'Attestations', icone: FileText },
  autre: { label: 'Autres documents', icone: FileText },
}
const ORDRE = ['rapport', 'avis_passage', 'facture', 'devis', 'contrat', 'convention', 'attestation', 'autre']
const quand = (d) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

function sauver(buf, nom) {
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url; a.download = nom
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const SIGNABLES = ['devis', 'contrat']

/**
 * charger() → liste ; lire(doc) → ArrayBuffer ; noter(doc, buf) facultatif.
 * Signature (0406) : signatureDe(doc) → signature ou null, onSigner(doc) ouvre la fenêtre de signature,
 * avecPreuve(doc, buf, sig) → ArrayBuffer du document signé suivi de sa page de preuve.
 */
// Dépôt signé à la main (0431) : onDeposer(doc) ouvre la fenêtre, depotDe(doc) → dernier dépôt du client ou null
export default function MesDocuments({ charger, lire, noter, titre = 'Vos documents', signatureDe = null, onSigner = null, avecPreuve = null, rafraichir = 0, onDeposer = null, depotDe = null, aSignerEnPlus = null }) {
  const [docs, setDocs] = useState(null)
  const [busy, setBusy] = useState(null)
  const [erreur, setErreur] = useState('')
  useEffect(() => { charger().then((d) => setDocs(Array.isArray(d) ? d : [])).catch(() => setDocs([])) // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rafraichir])
  if (!docs || docs.length === 0) return null

  // Le document tel que remis (signé : suivi de sa page de preuve)
  const contenu = async (d) => {
    let buf = await lire(d)
    const sig = signatureDe ? signatureDe(d) : null
    if (sig && avecPreuve) buf = await avecPreuve(d, buf, sig)
    return { buf, sig }
  }

  const ouvrir = async (d) => {
    setBusy(d.id); setErreur('')
    try {
      const { buf, sig } = await contenu(d)
      sauver(buf, `${d.label.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().replace(/\s+/g, '_') || 'document'}${sig ? '_signe' : ''}.pdf`)
      if (noter) noter(d, buf)
    } catch (e) { if (!rechargerSiMiseAJour(e)) setErreur(e.message || 'Document indisponible') } finally { setBusy(null) }
  }

  // Impression directe (22/10) : noté au journal comme un téléchargement
  const imprimerDoc = (d) => {
    setBusy(`imp:${d.id}`); setErreur('')
    imprimer(async () => { const { buf } = await contenu(d); if (noter) noter(d, buf); return buf })
      .catch((e) => { if (!rechargerSiMiseAJour(e)) setErreur(e.message || 'Impression impossible') })
      .finally(() => setBusy(null))
  }

  const groupes = ORDRE.map((k) => [k, docs.filter((d) => d.kind === k)]).filter(([, l]) => l.length)
  return (
    <section className="vitrine-monte mb-8">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3 flex items-center gap-1.5"><FolderOpen className="w-4 h-4" aria-hidden="true" />{titre}</h2>
      {erreur && <p role="alert" className="mb-3 text-sm text-[rgb(var(--c-danger))]">{erreur}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        {groupes.map(([k, liste]) => {
          const T = TYPES[k]
          return (
            <div key={k} className="vitrine-carte rounded-ui-lg border border-gray-200 bg-white p-4">
              <h3 className="font-display font-semibold text-gray-900 flex items-center gap-2 mb-2"><T.icone className="w-4 h-4 text-accent-600" aria-hidden="true" />{T.label}<span className="text-xs font-normal text-gray-400">({liste.length})</span></h3>
              <ul className="divide-y divide-gray-100">
                {liste.slice(0, 12).map((d) => {
                  const sig = signatureDe ? signatureDe(d) : null
                  const aSigner = !sig && onSigner && (SIGNABLES.includes(d.kind) || (d.kind === 'rapport' && aSignerEnPlus?.has?.(d.id)))
                  const depot = depotDe ? depotDe(d) : null
                  const deposable = !sig && onDeposer && d.kind === 'devis' && (!depot || depot.status === 'refuse')
                  return (
                    <li key={d.id} className="flex flex-wrap items-center gap-x-2">
                      <button type="button" onClick={() => ouvrir(d)} disabled={!!busy} className="flex-1 min-w-[12rem] py-2 flex items-center gap-3 text-left text-sm hover:text-primary-800 disabled:opacity-50">
                        <span className="min-w-0 flex-1"><span className="block text-gray-800 break-words">{d.label}</span>
                          <span className="block text-xs text-gray-400">{sig
                            ? <span className="text-[rgb(var(--c-success))] inline-flex items-center gap-1"><BadgeCheck className="w-3.5 h-3.5" aria-hidden="true" />Signé le {quand(sig.signed_at)}, avec sa preuve</span>
                            : depot?.status === 'recu' ? <span className="text-accent-700 inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" aria-hidden="true" />Signé et déposé le {quand(depot.deposited_at)}, en cours de validation</span>
                            : depot?.status === 'valide' ? <span className="text-[rgb(var(--c-success))] inline-flex items-center gap-1"><BadgeCheck className="w-3.5 h-3.5" aria-hidden="true" />Signé et déposé, validé par votre organisme</span>
                            : depot?.status === 'refuse' ? <span className="text-[rgb(var(--c-danger))] inline-flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />Dépôt refusé{depot.motif ? ` : ${depot.motif}` : ''}</span>
                            : `Mis à disposition le ${quand(d.published_at)}`}</span></span>
                        {busy === d.id ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Download className="w-4 h-4 text-gray-400" aria-hidden="true" />}
                      </button>
                      <button type="button" onClick={() => imprimerDoc(d)} disabled={!!busy} title="Imprimer" aria-label={`Imprimer ${d.label}`} className="p-2 shrink-0 text-gray-400 hover:text-primary-700 disabled:opacity-50">
                        {busy === `imp:${d.id}` ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Printer className="w-4 h-4" aria-hidden="true" />}
                      </button>
                      {aSigner && (!depot || depot.status === 'refuse') && <button type="button" onClick={() => onSigner(d)} className="btn btn-primary btn-sm shrink-0 gap-1"><PenLine className="w-3.5 h-3.5" aria-hidden="true" />Signer</button>}
                      {deposable && <button type="button" onClick={() => onDeposer(d)} title="Imprimer, signer à la main et déposer" aria-label={`Imprimer, signer et déposer ${d.label}`} className="btn btn-secondary btn-sm shrink-0 gap-1"><Upload className="w-3.5 h-3.5" aria-hidden="true" /><span className="hidden sm:inline">Déposer signé</span></button>}
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </section>
  )
}
