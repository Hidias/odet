// Journal de l'espace client (0401) : connexions et documents remis au client, avec date, heure, adresse IP,
// appareil et empreinte du document. Lecture seule ; export en PDF comme pièce justificative.

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { History, FileDown, LogIn, FileText, PenLine, Loader2 } from 'lucide-react'
import jsPDF from 'jspdf'
import 'jspdf-autotable'
import { supabase } from '../../../core/supabase'
import { startDocument } from '../../../core/pdf/layout'
import { loadPdfOrg } from '../../../core/pdf/pdfOrg'

const quand = (d) => new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' })
const EVENEMENTS = { connexion: { label: 'Connexion', icone: LogIn }, document: { label: 'Document téléchargé', icone: FileText }, signature: { label: 'Signature', icone: PenLine } }
const CANAUX = { lien: 'lien et code', compte: 'compte' }

/** Appareil lisible à partir de l'identifiant du navigateur */
export function appareil(ua) {
  const u = String(ua || '')
  if (!u) return ''
  const os = /iPhone|iPad/.test(u) ? 'iPhone ou iPad' : /Android/.test(u) ? 'Android' : /Windows/.test(u) ? 'Windows' : /Mac OS X/.test(u) ? 'Mac' : /Linux/.test(u) ? 'Linux' : 'autre système'
  const nav = /Edg\//.test(u) ? 'Edge' : /Firefox\//.test(u) ? 'Firefox' : /Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : 'navigateur'
  return `${nav}, ${os}`
}

export async function exporterJournal(client, lignes) {
  const ORG = await loadPdfOrg(true)
  const doc = new jsPDF({ orientation: 'landscape', compress: true })
  const f = startDocument(doc, ORG, { code: 'JOURNAL', docLabel: "Journal de l'espace client", title: "Journal de l'espace client", subtitle: `${client.name} : connexions et documents mis à disposition` })
  f.para(`Extrait le ${quand(new Date())}. Chaque ligne est enregistrée par le serveur au moment de l'action et ne peut pas être modifiée. L'empreinte SHA-256 permet de vérifier qu'un document présenté est identique à celui remis.`, { size: 8.5 })
  f.table(['Date et heure', 'Événement', 'Accès', 'Document', 'Adresse IP', 'Appareil', 'Empreinte SHA-256'],
    lignes.map((l) => [quand(l.created_at), EVENEMENTS[l.event]?.label || l.event, CANAUX[l.channel] || l.channel, l.document_label || '', l.ip || '', appareil(l.user_agent), l.document_sha256 || '']),
    { styles: { fontSize: 7, cellPadding: 1.5 }, columnStyles: { 6: { cellWidth: 52, fontSize: 6 } } })
  f.finish()
  doc.save(`Journal-espace-client-${(client.name || 'client').replace(/[^\w-]+/g, '-')}.pdf`)
}

export default function JournalEspaceClient({ client }) {
  const [lignes, setLignes] = useState(null)
  const [tout, setTout] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase.from('portal_events').select('*').eq('client_id', client.id).order('created_at', { ascending: false }).limit(500)
      .then(({ data, error }) => setLignes(error ? [] : (data || [])))
  }, [client.id])

  if (!lignes) return null
  const visibles = tout ? lignes : lignes.slice(0, 8)
  const derniere = lignes.find((l) => l.event === 'connexion')

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><History className="w-5 h-5 text-gray-500" aria-hidden="true" />Activité de l'espace client</h3>
          <p className="text-ui text-gray-500">
            {lignes.length === 0 ? "Aucune connexion pour l'instant." : `Dernière connexion le ${quand(derniere?.created_at || lignes[0].created_at)}. ${lignes.filter((l) => l.event === 'document').length} document(s) téléchargé(s).`}
          </p>
        </div>
        {lignes.length > 0 && (
          <button type="button" className="btn btn-secondary btn-sm flex items-center gap-1.5" disabled={busy}
            onClick={async () => { setBusy(true); try { await exporterJournal(client, lignes) } catch (e) { toast.error(e.message) } setBusy(false) }}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <FileDown className="w-4 h-4" aria-hidden="true" />} Exporter la preuve (PDF)
          </button>
        )}
      </div>
      {lignes.length > 0 && (
        <ul className="mt-3 divide-y divide-gray-100">
          {visibles.map((l) => {
            const E = EVENEMENTS[l.event] || EVENEMENTS.document
            return (
              <li key={l.id} className="py-2 flex items-start gap-3 text-ui">
                <E.icone className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap gap-x-2"><span className="font-medium">{E.label}</span>{l.document_label && <span className="text-gray-700">{l.document_label}</span>}</div>
                  <div className="text-ui-sm text-gray-500 flex flex-wrap gap-x-3">
                    <span>{quand(l.created_at)}</span><span>par {CANAUX[l.channel] || l.channel}</span>
                    {l.ip && <span>IP {l.ip}</span>}{l.user_agent && <span>{appareil(l.user_agent)}</span>}
                    {l.document_sha256 && <span className="font-mono" title={l.document_sha256}>empreinte {l.document_sha256.slice(0, 12)}…</span>}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {lignes.length > 8 && <button type="button" className="mt-2 text-ui-sm text-[rgb(var(--c-primary))] underline" onClick={() => setTout((v) => !v)}>{tout ? 'Voir moins' : `Voir les ${lignes.length} lignes`}</button>}
    </div>
  )
}
