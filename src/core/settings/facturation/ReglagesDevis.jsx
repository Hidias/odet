import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../supabase'
import { Field } from '../shared'
import { METIERS } from '../../../modules/commercial/lib/metierDevis'

// Paramètres › Banque et facturation › Devis (0443) :
//   - objets proposés par métier (liste dans le devis, texte libre gardé) ;
//   - pièces de l'entreprise jointes aux devis selon le métier (attestations d'assurance responsabilité civile
//     professionnelle et décennale pour l'installation et les travaux), avec leur validité.
// Les conditions générales de chaque métier sont dans Qualité › Documents › Conditions commerciales.

const KINDS = [
  ['rc_pro', 'Attestation responsabilité civile professionnelle'],
  ['decennale', 'Attestation décennale'],
  ['kbis', 'Extrait Kbis'],
  ['autre', 'Autre pièce'],
]
const libelleKind = (k) => KINDS.find(([id]) => id === k)?.[1] || k
const vide = { kind: 'rc_pro', label: '', insurer: '', policy_number: '', coverage: '', valid_from: '', valid_until: '' }
const frDate = (d) => (d ? d.split('-').reverse().join('/') : '')

// Fichier du stockage privé « documents » : lien signé de 5 minutes (fenêtre ouverte avant, pour ne pas être bloquée)
async function voirPiece(path) {
  const w = window.open('', '_blank')
  const { data, error } = await supabase.storage.from('documents').createSignedUrl(path, 300)
  if (error || !data?.signedUrl) { if (w) w.close(); toast.error('Fichier introuvable ou accès refusé'); return }
  if (w) w.location.href = data.signedUrl
  else window.location.href = data.signedUrl
}

export default function ReglagesDevis() {
  const [r, setR] = useState(null)
  const [textes, setTextes] = useState({})
  const [occupe, setOccupe] = useState(false)
  const [pieces, setPieces] = useState([])
  const [nouvelle, setNouvelle] = useState(vide)
  const [fichier, setFichier] = useState(null)

  const chargerPieces = () => supabase.from('company_papers').select('*').order('kind').order('valid_until', { ascending: false })
    .then(({ data }) => setPieces(data || []), () => setPieces([]))

  useEffect(() => {
    supabase.from('billing_settings').select('company_id, objets_devis').limit(1).maybeSingle().then(({ data }) => {
      if (!data || !('objets_devis' in data)) return
      setR(data)
      setTextes(Object.fromEntries(METIERS.map((m) => [m.id, (data.objets_devis?.[m.id] || []).join('\n')])))
    })
    chargerPieces()
  }, [])
  if (!r) return null

  const enregistrerObjets = async () => {
    setOccupe(true)
    const objets = Object.fromEntries(METIERS.map((m) => [m.id, [...new Set(String(textes[m.id] || '').split('\n').map((l) => l.trim()).filter(Boolean))].slice(0, 40)]))
    const { error } = await supabase.from('billing_settings').update({ objets_devis: objets, updated_at: new Date().toISOString() }).eq('company_id', r.company_id)
    setOccupe(false)
    if (error) return toast.error(error.message)
    toast.success('Objets des devis enregistrés')
  }

  const ajouterPiece = async () => {
    if (!nouvelle.label.trim()) return toast.error('Donnez un nom à la pièce')
    if (!fichier) return toast.error('Choisissez le fichier PDF de la pièce')
    if (fichier.type !== 'application/pdf') return toast.error('La pièce doit être un PDF')
    if (fichier.size > 5 * 1024 * 1024) return toast.error('Fichier trop lourd (5 Mo au plus)')
    if (nouvelle.valid_from && nouvelle.valid_until && nouvelle.valid_until < nouvelle.valid_from) return toast.error('La fin de validité précède son début')
    setOccupe(true)
    try {
      const nom = fichier.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80)
      const path = `entreprise/${r.company_id}/pieces/${Date.now()}-${nom}`
      const { error: eUp } = await supabase.storage.from('documents').upload(path, fichier, { contentType: 'application/pdf', upsert: false })
      if (eUp) throw eUp
      const { error } = await supabase.from('company_papers').insert({
        kind: nouvelle.kind, label: nouvelle.label.trim(), insurer: nouvelle.insurer.trim() || null,
        policy_number: nouvelle.policy_number.trim() || null, coverage: nouvelle.coverage.trim() || null,
        valid_from: nouvelle.valid_from || null, valid_until: nouvelle.valid_until || null, file_path: path, file_name: nom,
      })
      if (error) throw error
      toast.success('Pièce ajoutée')
      setNouvelle(vide); setFichier(null)
      chargerPieces()
    } catch (e) {
      toast.error(e.message || 'Ajout impossible')
    }
    setOccupe(false)
  }

  const retirerPiece = async (pc) => {
    const { error } = await supabase.from('company_papers').delete().eq('id', pc.id)
    if (error) return toast.error(error.message)
    toast.success('Pièce retirée des devis')
    chargerPieces()
  }

  const jour = new Date().toISOString().slice(0, 10)
  return (
    <>
      <h2 className="section-title">Devis : objets proposés par métier</h2>
      <p className="text-ui-sm text-gray-500">Un objet par ligne. Le devis les propose selon son métier ; on peut toujours écrire un objet libre.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {METIERS.map((m) => (
          <Field key={m.id} label={m.label}>
            <textarea className="input" rows={4} value={textes[m.id] || ''} onChange={(e) => setTextes({ ...textes, [m.id]: e.target.value })} />
          </Field>
        ))}
      </div>
      <div><button type="button" className="btn btn-secondary" disabled={occupe} onClick={enregistrerObjets}>Enregistrer les objets</button></div>

      <h2 className="section-title">Devis : pièces de l'entreprise</h2>
      <p className="text-ui-sm text-gray-500">Jointes toutes seules aux devis d'installation et de travaux (responsabilité civile professionnelle, décennale) tant qu'elles sont valables. Les conditions générales de chaque métier se rédigent dans Qualité › Documents › Conditions commerciales.</p>
      {pieces.length > 0 && (
        <ul className="divide-y border rounded-ui-sm">
          {pieces.map((pc) => {
            const echue = pc.valid_until && pc.valid_until < jour
            return (
              <li key={pc.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">{pc.label}</p>
                  <p className="text-ui-sm text-gray-500">{libelleKind(pc.kind)}{pc.insurer ? ` · ${pc.insurer}` : ''}{pc.policy_number ? `, contrat ${pc.policy_number}` : ''}{pc.coverage ? ` · ${pc.coverage}` : ''}</p>
                  <p className={`text-ui-sm ${echue ? 'text-[rgb(var(--c-danger))] font-semibold' : 'text-gray-500'}`}>{pc.valid_until ? `${echue ? 'Échue le' : 'Valable jusqu\'au'} ${frDate(pc.valid_until)}` : 'Sans date de fin'}</p>
                </div>
                <div className="flex gap-2">
                  {pc.file_path && <button type="button" className="btn btn-sm btn-secondary" onClick={() => voirPiece(pc.file_path)}>Voir</button>}
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => retirerPiece(pc)}>Retirer</button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Type de pièce">
          <select className="select" value={nouvelle.kind} onChange={(e) => setNouvelle({ ...nouvelle, kind: e.target.value })}>
            {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Nom de la pièce"><input className="input" value={nouvelle.label} onChange={(e) => setNouvelle({ ...nouvelle, label: e.target.value })} placeholder="Ex : Attestation décennale 2027" /></Field>
        <Field label="Assureur"><input className="input" value={nouvelle.insurer} onChange={(e) => setNouvelle({ ...nouvelle, insurer: e.target.value })} /></Field>
        <Field label="Numéro de contrat"><input className="input" value={nouvelle.policy_number} onChange={(e) => setNouvelle({ ...nouvelle, policy_number: e.target.value })} /></Field>
        <Field label="Couverture géographique" hint="Repris dans les mentions des devis de travaux"><input className="input" value={nouvelle.coverage} onChange={(e) => setNouvelle({ ...nouvelle, coverage: e.target.value })} placeholder="Ex : France métropolitaine" /></Field>
        <Field label="Fichier (PDF)"><input className="input" type="file" accept="application/pdf" onChange={(e) => setFichier(e.target.files?.[0] || null)} /></Field>
        <Field label="Valable à partir du"><input className="input" type="date" value={nouvelle.valid_from} onChange={(e) => setNouvelle({ ...nouvelle, valid_from: e.target.value })} /></Field>
        <Field label="Valable jusqu'au"><input className="input" type="date" value={nouvelle.valid_until} onChange={(e) => setNouvelle({ ...nouvelle, valid_until: e.target.value })} /></Field>
      </div>
      <div><button type="button" className="btn btn-secondary" disabled={occupe} onClick={ajouterPiece}>Ajouter la pièce</button></div>
    </>
  )
}
