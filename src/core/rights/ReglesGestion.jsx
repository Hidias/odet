import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Trash2, Plus } from 'lucide-react'
import { supabase } from '../supabase'
import { useAuthStore } from '../store'
import { useDroits } from './useDroit'
import { Card, CardHeader, CardBody, Banner, Spinner, SearchSelect, useConfirm } from '../../ui'

// Règles de gestion (direction, administrateur, super administrateur ; jamais dans les Paramètres) :
//  - circuits de validation par périmètre (droit validations.circuits.configurer), factures par client ;
//  - devis visibles ou non du comptable externe (droit facturation.comptable_externe.regler).
// La base applique ces règles (approval_rule_for, approval_submit) : l'écran ne fait qu'enregistrer les choix.

const PERIMETRES = [
  { scope: 'invoice', label: 'Factures', valideur: 'facturation.factures.valider', defaut: 'always', parClient: true },
  { scope: 'quote', label: 'Devis', valideur: 'commercial.devis.modifier', defaut: 'none' },
  { scope: 'purchase_order', label: 'Commandes d\'achat', valideur: 'stock.commandes.valider', defaut: 'always' },
  { scope: 'absence', label: 'Absences', valideur: 'rh.absences.valider', defaut: 'always' },
  { scope: 'timesheet', label: 'Heures', valideur: 'rh.heures.valider', defaut: 'always' },
  { scope: 'expense', label: 'Notes de frais', valideur: 'frais.notes.valider', defaut: 'always' },
]
const MODES = { none: 'Aucune validation', always: 'Toujours validé', threshold: 'Validé au-delà d\'un montant' }

function LigneRegle({ titre, regle, perimetre, onSave, onRemove, occupe }) {
  const [mode, setMode] = useState(regle?.mode || perimetre.defaut)
  const [seuil, setSeuil] = useState(regle?.threshold ?? '')
  useEffect(() => { setMode(regle?.mode || perimetre.defaut); setSeuil(regle?.threshold ?? '') }, [regle, perimetre.defaut])
  const change = (regle?.mode || perimetre.defaut) !== mode || String(regle?.threshold ?? '') !== String(seuil)
  const seuilInvalide = mode === 'threshold' && (seuil === '' || Number(seuil) < 0)
  return (
    <li className="py-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="font-medium">{titre}</div>
        <div className="text-ui-sm text-gray-500">{regle ? 'Règle de la société' : 'Réglage par défaut du produit'}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select className="select" style={{ minHeight: 36, width: 230 }} value={mode} disabled={occupe} aria-label={`Validation : ${titre}`}
          onChange={(e) => setMode(e.target.value)}>
          {Object.entries(MODES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {mode === 'threshold' && (
          <label className="flex items-center gap-1">
            <input type="number" min="0" step="1" className="input" style={{ width: 110 }} value={seuil} onChange={(e) => setSeuil(e.target.value)} aria-label="Montant en euros" />
            <span className="text-ui-sm text-gray-500">€ HT</span>
          </label>
        )}
        <button type="button" className="btn btn-primary btn-sm" disabled={!change || seuilInvalide || occupe}
          onClick={() => onSave(mode, mode === 'threshold' ? Number(seuil) : null)}>Enregistrer</button>
        {onRemove && <button type="button" className="btn btn-ghost btn-icon" aria-label={`Retirer la règle : ${titre}`} disabled={occupe} onClick={onRemove}><Trash2 className="w-4 h-4" /></button>}
      </div>
    </li>
  )
}

function Circuits({ companyId }) {
  const confirm = useConfirm()
  const [regles, setRegles] = useState(null)
  const [clients, setClients] = useState([])
  const [nouveauClient, setNouveauClient] = useState(null)
  const [occupe, setOccupe] = useState(false)

  const charger = async () => {
    const [{ data, error }, { data: cl }] = await Promise.all([
      supabase.from('approval_rules').select('*').eq('company_id', companyId),
      supabase.from('clients').select('id, name').order('name'),
    ])
    if (error) { toast.error(error.message); setRegles([]); return }
    setRegles(data || [])
    setClients(cl || [])
  }
  useEffect(() => { charger() }, [companyId])

  const enregistrer = async (p, clientId, mode, seuil) => {
    setOccupe(true)
    try {
      const existante = regles.find((r) => r.scope === p.scope && (r.client_id || null) === (clientId || null))
      const ligne = { mode, threshold: seuil, validator_right: existante?.validator_right || p.valideur, is_active: true, updated_at: new Date().toISOString() }
      const { error } = existante
        ? await supabase.from('approval_rules').update(ligne).eq('id', existante.id)
        : await supabase.from('approval_rules').insert({ ...ligne, company_id: companyId, scope: p.scope, client_id: clientId || null })
      if (error) throw error
      toast.success('Circuit enregistré')
      await charger()
    } catch (e) {
      toast.error(e.message || 'Enregistrement refusé')
    } finally {
      setOccupe(false)
    }
  }
  const retirer = async (r, titre) => {
    if (!await confirm({ title: 'Retirer cette règle ?', message: `${titre} reprendra la règle générale.`, confirmLabel: 'Retirer' })) return
    setOccupe(true)
    const { error } = await supabase.from('approval_rules').delete().eq('id', r.id)
    setOccupe(false)
    if (error) return toast.error(error.message)
    toast.success('Règle retirée'); charger()
  }

  const nomClient = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients])
  if (regles === null) return <Spinner />
  const facture = PERIMETRES[0]
  const parClient = regles.filter((r) => r.scope === 'invoice' && r.client_id)

  return (
    <>
      <ul className="divide-y hairline">
        {PERIMETRES.map((p) => (
          <LigneRegle key={p.scope} titre={p.label} perimetre={p} occupe={occupe}
            regle={regles.find((r) => r.scope === p.scope && !r.client_id) || null}
            onSave={(m, s) => enregistrer(p, null, m, s)} />
        ))}
      </ul>
      <h3 className="font-semibold mt-2">Factures : règle propre à un client</h3>
      <p className="text-ui-sm text-gray-500">Pour un client, la règle ci-dessous l'emporte sur la règle des factures.</p>
      <ul className="divide-y hairline">
        {parClient.map((r) => {
          const titre = nomClient.get(r.client_id) || 'Client'
          return <LigneRegle key={r.id} titre={titre} perimetre={facture} regle={r} occupe={occupe}
            onSave={(m, s) => enregistrer(facture, r.client_id, m, s)} onRemove={() => retirer(r, titre)} />
        })}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[16rem] flex-1 max-w-md">
          <SearchSelect value={nouveauClient} onChange={setNouveauClient} placeholder="Choisir un client"
            options={clients.filter((c) => !parClient.some((r) => r.client_id === c.id)).map((c) => ({ value: c.id, label: c.name }))} />
        </div>
        <button type="button" className="btn btn-secondary" disabled={!nouveauClient || occupe}
          onClick={() => { enregistrer(facture, nouveauClient, 'always', null); setNouveauClient(null) }}><Plus className="w-4 h-4" />Ajouter une règle</button>
      </div>
    </>
  )
}

function ComptableExterne() {
  const [visible, setVisible] = useState(null)
  const [occupe, setOccupe] = useState(false)
  useEffect(() => {
    supabase.rpc('external_accountant_quotes_visible').then(({ data, error }) => setVisible(error ? null : !!data))
  }, [])
  const changer = async (v) => {
    setOccupe(true)
    const { error } = await supabase.rpc('external_accountant_set_quotes', { p_visible: v })
    setOccupe(false)
    if (error) return toast.error(error.message)
    setVisible(v)
    toast.success(v ? 'Devis visibles du comptable externe' : 'Devis masqués au comptable externe')
  }
  if (visible === null) return <p className="text-ui-sm text-gray-500">Réglage indisponible.</p>
  return (
    <label className="flex items-start gap-3">
      <input type="checkbox" className="mt-1" checked={visible} disabled={occupe} onChange={(e) => changer(e.target.checked)} />
      <span>
        <span className="font-medium">Le comptable externe voit les devis</span>
        <span className="block text-ui-sm text-gray-500">Utile s'il vous conseille sur les relances. Il ne peut jamais les modifier.</span>
      </span>
    </label>
  )
}

export default function ReglesGestion() {
  const rights = useAuthStore((s) => s.rights)
  const d = useDroits({ circuits: 'validations.circuits.configurer', comptable: 'facturation.comptable_externe.regler' })
  const companyId = rights?.companyId || null
  if (!rights) return <Banner tone="info" title="Réglages indisponibles">Les droits par société ne sont pas encore actifs sur cette base.</Banner>
  return (
    <div className="grid gap-4">
      {d.circuits && companyId && (
        <Card>
          <CardHeader title="Circuits de validation" subtitle="Qui valide quoi avant envoi ou paiement. Sans règle, le réglage par défaut du produit s'applique." />
          <CardBody><Circuits companyId={companyId} /></CardBody>
        </Card>
      )}
      {d.comptable && (
        <Card>
          <CardHeader title="Comptable externe" />
          <CardBody><ComptableExterne /></CardBody>
        </Card>
      )}
    </div>
  )
}
