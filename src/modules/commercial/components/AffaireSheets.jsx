import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Loader2 } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { currentUserFirstName } from '../../../core/org/currentOrg'
import { Sheet } from '../../../ui/Sheet'
import SearchSelect, { clientOptions } from '../../../ui/SearchSelect'
import { METIERS, ECHANGES, FERMEES, ETAPES_DEPART, dansJours } from '../lib/affaires'

// Listes de la société (étapes, sources, motifs de perte, segments), lues une fois par écran
export function useListesCommerciales() {
  const [listes, setListes] = useState({ etape: ETAPES_DEPART, source: [], motif_perte: [], segment: [], lues: false })
  useEffect(() => {
    let vivant = true
    supabase.from('commercial_lists').select('id, kind, code, label, position, probability, is_active')
      .order('position').then(({ data, error }) => {
        if (!vivant || error || !data) return
        const par = (k) => data.filter((l) => l.kind === k)
        setListes({ etape: par('etape').length ? par('etape') : ETAPES_DEPART, source: par('source'), motif_perte: par('motif_perte'), segment: par('segment'), lues: true, toutes: data })
      })
    return () => { vivant = false }
  }, [])
  return listes
}

// Création ou modification d'une affaire : le strict nécessaire, prochaine action obligatoire
export function AffaireSheet({ affaire = null, clientId = null, listes, onClose, onSaved }) {
  const neuve = !affaire?.id
  const [f, setF] = useState(() => ({
    client_id: affaire?.client_id || clientId || '',
    title: affaire?.title || '',
    metier: affaire?.metier || '',
    stage: affaire?.stage || 'a_qualifier',
    amount_ht: affaire?.amount_ht ?? '',
    expected_on: affaire?.expected_on || '',
    next_action_on: affaire?.next_action_on || dansJours(2),
    next_action: affaire?.next_action || '',
    source: affaire?.source || '',
    lost_reason: affaire?.lost_reason || '',
  }))
  const [clients, setClients] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }))

  useEffect(() => {
    if (clientId || !neuve) return
    supabase.from('clients').select('id, name, city, postal_code, siret, siren, status, contact_name, group_name').order('name').limit(2000)
      .then(({ data }) => setClients(data || []))
  }, [clientId, neuve])

  const etapes = (listes?.etape || ETAPES_DEPART).filter((e) => e.is_active !== false)
  const fermee = FERMEES.includes(f.stage)

  const enregistrer = async () => {
    if (!f.client_id) return toast.error('Choisissez le client')
    if (!f.title.trim()) return toast.error('Donnez un titre à l\'affaire')
    if (!fermee && !f.next_action_on) return toast.error('La date de la prochaine action est obligatoire')
    if (f.stage === 'perdue' && !f.lost_reason) return toast.error('Indiquez le motif de perte')
    const ligne = {
      client_id: f.client_id, title: f.title.trim(), metier: f.metier || null, stage: f.stage,
      amount_ht: f.amount_ht === '' ? null : Number(String(f.amount_ht).replace(',', '.')),
      expected_on: f.expected_on || null, next_action_on: f.next_action_on || null, next_action: f.next_action.trim() || null,
      source: f.source || null, lost_reason: f.stage === 'perdue' ? f.lost_reason : null,
    }
    if (!neuve && ligne.stage === affaire.stage) delete ligne.stage
    setBusy(true)
    const req = neuve ? supabase.from('opportunities').insert(ligne).select('id').single()
      : supabase.from('opportunities').update(ligne).eq('id', affaire.id).select('id').single()
    const { error } = await req
    setBusy(false)
    if (error) return toast.error(error.message.includes('opportunities_prochaine_action') ? 'La date de la prochaine action est obligatoire' : error.message)
    toast.success(neuve ? 'Affaire créée' : 'Affaire enregistrée')
    onSaved?.()
    onClose()
  }

  return (
    <Sheet title={neuve ? 'Nouvelle affaire' : affaire.title} onClose={onClose}
      footer={<>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Annuler</button>
        <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Enregistrer</button>
      </>}>
      {neuve && !clientId && (
        <div>
          <label className="label" htmlFor="af-client">Client</label>
          <SearchSelect id="af-client" value={f.client_id} onChange={set('client_id')} options={clientOptions(clients || [])}
            placeholder={clients === null ? 'Chargement…' : 'Choisir un client'} />
        </div>
      )}
      <div>
        <label className="label" htmlFor="af-titre">Affaire</label>
        <input id="af-titre" className="input" value={f.title} onChange={set('title')} placeholder="Ex. : recyclage SST de 8 salariés" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="af-etape">Étape</label>
          <select id="af-etape" className="select" value={f.stage} onChange={set('stage')}>
            {etapes.map((e) => <option key={e.code} value={e.code}>{e.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="af-montant">Montant HT estimé</label>
          <input id="af-montant" className="input" inputMode="decimal" value={f.amount_ht} onChange={set('amount_ht')} placeholder="€" />
        </div>
      </div>
      {f.stage === 'perdue' && (
        <div>
          <label className="label" htmlFor="af-motif">Motif de perte</label>
          <select id="af-motif" className="select" value={f.lost_reason} onChange={set('lost_reason')}>
            <option value="">Choisir</option>
            {(listes?.motif_perte || []).filter((m) => m.is_active !== false).map((m) => <option key={m.code} value={m.label}>{m.label}</option>)}
            {f.lost_reason && !(listes?.motif_perte || []).some((m) => m.label === f.lost_reason) && <option value={f.lost_reason}>{f.lost_reason}</option>}
          </select>
        </div>
      )}
      {!fermee && (
        <div className="grid grid-cols-[150px_1fr] gap-3">
          <div>
            <label className="label" htmlFor="af-date">Prochaine action</label>
            <input id="af-date" type="date" className="input" value={f.next_action_on} onChange={set('next_action_on')} required />
          </div>
          <div>
            <label className="label" htmlFor="af-quoi">Quoi</label>
            <input id="af-quoi" className="input" value={f.next_action} onChange={set('next_action')} placeholder="Ex. : rappeler, envoyer le devis" />
          </div>
        </div>
      )}
      <details className="text-ui-sm">
        <summary className="cursor-pointer text-gray-600">Plus de détails (facultatif)</summary>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <div>
            <label className="label" htmlFor="af-metier">Métier</label>
            <select id="af-metier" className="select" value={f.metier} onChange={set('metier')}>
              <option value="">—</option>
              {Object.entries(METIERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="af-signature">Signature visée</label>
            <input id="af-signature" type="date" className="input" value={f.expected_on} onChange={set('expected_on')} />
          </div>
          <div className="col-span-2">
            <label className="label" htmlFor="af-source">Source</label>
            <select id="af-source" className="select" value={f.source} onChange={set('source')}>
              <option value="">—</option>
              {(listes?.source || []).filter((s) => s.is_active !== false).map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
            </select>
          </div>
        </div>
      </details>
    </Sheet>
  )
}

// Noter un échange (appel, email, rendez-vous, note) et fixer la prochaine action de l'affaire
export function EchangeSheet({ clientId, clientName, affaire = null, typeDepart = 'call', onClose, onSaved }) {
  const [f, setF] = useState({ type: typeDepart, content: '', next_action_on: affaire?.next_action_on || dansJours(3), next_action: affaire?.next_action || '' })
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))

  const enregistrer = async () => {
    if (!f.content.trim()) return toast.error('Notez en une phrase ce qui s\'est dit')
    setBusy(true)
    const { error } = await supabase.from('client_interactions').insert({
      client_id: clientId, type: f.type, title: `${ECHANGES[f.type]}${affaire ? ` · ${affaire.title}` : ''}`,
      content: f.content.trim(), author: currentUserFirstName(), interaction_date: new Date().toISOString(),
      metadata: affaire ? { opportunity_id: affaire.id } : {},
    })
    if (!error && affaire?.id && affaire.origine !== 'devis') {
      const r = await supabase.from('opportunities').update({ next_action_on: f.next_action_on || null, next_action: f.next_action.trim() || null }).eq('id', affaire.id)
      if (r.error) { setBusy(false); return toast.error(r.error.message.includes('opportunities_prochaine_action') ? 'La date de la prochaine action est obligatoire' : r.error.message) }
    }
    if (!error && affaire?.origine === 'devis' && f.next_action_on) {
      await supabase.from('quotes').update({ next_followup_date: f.next_action_on }).eq('id', affaire.id)
    }
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success('Échange noté')
    onSaved?.()
    onClose()
  }

  return (
    <Sheet title={`Noter un échange · ${clientName || ''}`} onClose={onClose} size="sm"
      footer={<>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Annuler</button>
        <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Enregistrer</button>
      </>}>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Type d'échange">
        {Object.entries(ECHANGES).map(([k, v]) => (
          <button key={k} type="button" role="radio" aria-checked={f.type === k} onClick={() => setF((x) => ({ ...x, type: k }))}
            className={`btn btn-sm ${f.type === k ? 'btn-primary' : 'btn-secondary'}`}>{v}</button>
        ))}
      </div>
      <div>
        <label className="label" htmlFor="ec-texte">Ce qui s'est dit</label>
        <textarea id="ec-texte" className="input min-h-[96px]" value={f.content} onChange={set('content')} autoFocus />
      </div>
      {affaire && (
        <div className="grid grid-cols-[150px_1fr] gap-3">
          <div>
            <label className="label" htmlFor="ec-date">Prochaine action</label>
            <input id="ec-date" type="date" className="input" value={f.next_action_on} onChange={set('next_action_on')} />
          </div>
          <div>
            <label className="label" htmlFor="ec-quoi">Quoi</label>
            <input id="ec-quoi" className="input" value={f.next_action} onChange={set('next_action')} placeholder="Ex. : relancer" />
          </div>
        </div>
      )}
    </Sheet>
  )
}
