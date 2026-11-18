// DPAE sur le contrat (0521) : état, récapitulatif des mentions à recopier, lien officiel, date d'envoi et accusé.
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { ExternalLink, Copy } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { Sheet } from '../../../ui/Sheet'
import {
  LIEN_DPAE_URSSAF, LIEN_DPAE_NET_ENTREPRISES, etatDpae, LIBELLES_ETAT_DPAE, recapitulatifDpae, texteRecapitulatif, erreurDateEnvoi,
} from '../lib/rhDpae'

const fr = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '')

/** Ligne d'état sous le contrat ; rien pour un contrat sans DPAE (stage, intérim...). */
export function EtatDpae({ contrat, peutGerer, onOuvrir }) {
  const e = etatDpae(contrat)
  if (e.etat === 'sans_objet') return null
  const l = LIBELLES_ETAT_DPAE[e.etat]
  const detail = e.etat === 'faite' ? `envoyée le ${fr(e.le)}${contrat.dpae_reference ? `, accusé ${contrat.dpae_reference}` : ''}`
    : e.etat === 'trop_tot' ? `possible à partir du ${fr(e.ouvre)}`
    : e.etat === 'a_faire' ? `avant le ${fr(contrat.start_on)}, et avant la prise de poste`
    : e.etat === 'jour_j' ? 'embauche aujourd\'hui : à faire avant la prise de poste'
    : e.etat === 'non_suivie' ? 'embauche de plus de 30 jours : la noter si elle a été faite'
    : 'embauche passée : faire la DPAE sans attendre si ce n\'est pas fait, puis la noter'
  return (
    <div className="flex items-center gap-2 flex-wrap text-ui-sm">
      <span className={`badge ${l.badge}`}>{l.label}</span>
      <span className="text-gray-600">{detail}</span>
      {peutGerer && <button type="button" className="btn btn-ghost btn-sm" onClick={onOuvrir}>{e.etat === 'faite' ? 'Voir la DPAE' : e.etat === 'non_suivie' ? 'Noter la DPAE' : 'Faire la DPAE'}</button>}
    </div>
  )
}

export function DpaeSheet({ personne, contrat, onClose, onSaved }) {
  const [donnees, setDonnees] = useState({ societe: {}, etablissement: null })
  const [v, setV] = useState({ dpae_sent_on: contrat.dpae_sent_on || '', dpae_reference: contrat.dpae_reference || '' })
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    (async () => {
      const { data: societe } = await supabase.from('companies').select('legal_name, naf, address, postal_code, city').eq('id', personne.company_id).maybeSingle()
      let q = supabase.from('company_establishments').select('siret, address, postal_code, city').eq('company_id', personne.company_id)
      q = contrat.establishment_id ? q.eq('id', contrat.establishment_id) : q.eq('is_head_office', true)
      const { data: etab } = await q.limit(1).maybeSingle()
      setDonnees({ societe: societe || {}, etablissement: etab || null })
    })().catch(() => toast.error('Informations de l\'employeur indisponibles : complétez-les sur le site de l\'Urssaf'))
  }, [personne.company_id, contrat.establishment_id])
  const lignes = recapitulatifDpae({ ...donnees, personne, contrat })
  const copier = async () => {
    try { await navigator.clipboard.writeText(texteRecapitulatif(lignes)); toast.success('Récapitulatif copié') } catch { toast.error('Copie impossible : sélectionnez le texte à la main') }
  }
  const enregistrer = async (e) => {
    e.preventDefault()
    if (v.dpae_reference && !v.dpae_sent_on) { toast.error('Indiquez la date d\'envoi'); return }
    const erreurDate = erreurDateEnvoi(v.dpae_sent_on, contrat.start_on)
    if (erreurDate) { toast.error(erreurDate); return }
    setBusy(true)
    const { data, error } = await supabase.from('hr_employments')
      .update({ dpae_sent_on: v.dpae_sent_on || null, dpae_reference: v.dpae_reference.trim() || null }).eq('id', contrat.id).select('id')
    setBusy(false)
    if (error) { toast.error(error.message); return }
    if (!data?.length) { toast.error('Enregistrement refusé : vous n\'avez pas le droit de modifier ce contrat'); return }
    toast.success(v.dpae_sent_on ? 'DPAE notée' : 'DPAE retirée')
    onSaved()
  }
  let groupe = null
  return (
    <Sheet title="Déclaration préalable à l'embauche" onClose={onClose}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Fermer</button><button type="submit" form="rh-dpae" className="btn btn-primary" disabled={busy}>Enregistrer</button></>}>
      <div className="space-y-4">
        <p className="text-ui-sm text-gray-700">
          La DPAE se fait sur le site de l'Urssaf, avant l'embauche, donc au plus tard avant la prise de poste
          (Code du travail, article L1221-10), et au plus tôt 8 jours avant (article R1221-4). Recopiez les informations ci-dessous, puis notez ici la date
          d'envoi et la référence de l'accusé de réception.
        </p>
        <div className="flex gap-2 flex-wrap">
          <a className="btn btn-primary" href={LIEN_DPAE_URSSAF} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-4 h-4" aria-hidden="true" />Ouvrir le site de l'Urssaf</a>
          <a className="btn btn-ghost" href={LIEN_DPAE_NET_ENTREPRISES} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-4 h-4" aria-hidden="true" />net-entreprises.fr</a>
          <button type="button" className="btn btn-secondary" onClick={copier}><Copy className="w-4 h-4" aria-hidden="true" />Copier le récapitulatif</button>
        </div>
        <dl className="space-y-1">
          {lignes.map((l) => {
            const titre = l.groupe !== groupe ? (groupe = l.groupe) : null
            return (
              <div key={l.label}>
                {titre && <dt className="section-title mt-3 mb-1">{titre}</dt>}
                <dd className="flex gap-2 text-ui"><span className="text-gray-500 w-48 flex-none">{l.label}</span>
                  {l.valeur ? <span className="min-w-0">{l.valeur}</span> : <span className="min-w-0 muted italic">{l.aide}</span>}</dd>
              </div>
            )
          })}
        </dl>
        <form id="rh-dpae" onSubmit={enregistrer} className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="label">Date d'envoi</span><input className="input" type="date" max={new Date().toISOString().slice(0, 10)} value={v.dpae_sent_on} onChange={(e) => setV({ ...v, dpae_sent_on: e.target.value })} /></label>
          <label className="block"><span className="label">Référence de l'accusé de réception</span><input className="input" maxLength={60} value={v.dpae_reference} onChange={(e) => setV({ ...v, dpae_reference: e.target.value })} /></label>
        </form>
        <p className="text-ui-sm muted">Rangez le PDF de l'accusé de réception dans Documents, catégorie « DPAE (accusé de réception) ».</p>
      </div>
    </Sheet>
  )
}
