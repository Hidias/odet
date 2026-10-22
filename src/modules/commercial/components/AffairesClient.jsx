import { useCallback, useEffect, useState } from 'react'
import OrigineSelect, { useOrigines } from '../../../core/apports/OrigineSelect'
import { valeurOrigine, lireOrigine } from '../../../core/apports/apports'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { KanbanSquare, Plus, MessageSquare, Pencil } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { StatusBadge } from '../../../ui/StatusBadge'
import { AffaireSheet, EchangeSheet, useListesCommerciales } from './AffaireSheets'
import { urgence, URGENCES, FERMEES, CANAUX, euros } from '../lib/affaires'
import { FILTRE_EQUIPE } from '../../../core/org/currentOrg'

// Fiche client, bloc « Commercial » (chantier 10, 0380) : ce que le client achète déjà (calculé), ses affaires,
// et les informations commerciales de la fiche (segment, source, responsable, opposition), modifiables en un clic.

const fr = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR') : '—')

export default function AffairesClient({ client, peutModifierFiche, peutAffaires, peutNoter, onClientChange }) {
  const listes = useListesCommerciales()
  const [affaires, setAffaires] = useState(null)
  const [metiers, setMetiers] = useState(null)
  const [comptes, setComptes] = useState([])
  const [edition, setEdition] = useState(null)
  const [echange, setEchange] = useState(null)
  const [fiche, setFiche] = useState(null)
  const origines = useOrigines()

  const charger = useCallback(async () => {
    const [a, m] = await Promise.all([
      supabase.from('opportunities').select('*').eq('client_id', client.id).order('created_at', { ascending: false }).limit(50),
      supabase.from('v_client_metiers').select('*').eq('client_id', client.id).maybeSingle(),
    ])
    setAffaires(a.error ? [] : a.data || [])
    setMetiers(m.error ? null : m.data)
  }, [client.id])
  useEffect(() => { charger() }, [charger])
  useEffect(() => {
    supabase.from('profiles').select('id, display_name').eq('is_active', true).or(FILTRE_EQUIPE).order('display_name')
      .then(({ data }) => setComptes(data || []))
  }, [])

  const ouvertes = (affaires || []).filter((a) => !FERMEES.includes(a.stage))
  const fermees = (affaires || []).filter((a) => FERMEES.includes(a.stage)).slice(0, 3)
  const label = (kind, code) => listes[kind]?.find((l) => l.code === code)?.label || code
  const etape = (code) => listes.etape.find((e) => e.code === code)?.label || code
  const responsable = comptes.find((c) => c.id === client.owner_id)?.display_name

  const enregistrerFiche = async () => {
    const maj = {
      segment: fiche.segment || null, source: fiche.source || null, source_detail: fiche.source_detail || null,
      owner_id: fiche.owner_id || null, first_contact_on: fiche.first_contact_on || null, informed_at: fiche.informed_at || null,
      opposition_canaux: fiche.opposition_canaux, opposition_motif: fiche.opposition_motif || null,
    }
    if (origines.disponible) Object.assign(maj, lireOrigine(fiche.origine))
    const { data, error } = await supabase.from('clients').update(maj).eq('id', client.id).select().single()
    if (error) return toast.error(error.message)
    toast.success('Fiche enregistrée')
    setFiche(null)
    onClientChange?.(data)
  }

  const canaux = client.opposition_canaux || []

  return (
    <div className="bg-white rounded-ui border border-gray-200">
      <div className="flex items-center gap-2 px-5 py-3.5 border-b border-gray-100 flex-wrap">
        <KanbanSquare className="w-5 h-5 text-primary-600" />
        <span className="font-semibold text-gray-900">Commercial</span>
        <div className="ml-auto flex gap-2">
          {peutNoter && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEchange({ affaire: ouvertes[0] || null })}><MessageSquare className="w-4 h-4" />Noter un échange</button>}
          {peutAffaires && <button type="button" className="btn btn-primary btn-sm" onClick={() => setEdition({})}><Plus className="w-4 h-4" />Affaire</button>}
        </div>
      </div>
      <div className="px-5 py-3 space-y-3 text-ui">
        {metiers && (
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-ui-sm text-gray-600">
            <span>Formation : {metiers.derniere_formation ? `dernière le ${fr(metiers.derniere_formation)} (${metiers.formations_24_mois} en 2 ans)` : 'jamais'}</span>
            <span>Maintenance : {metiers.contrat_maintenance ? 'contrat actif' : metiers.derniere_visite ? `dernière visite le ${fr(metiers.derniere_visite)}` : 'aucune'}{metiers.appareils ? ` · ${metiers.appareils} appareils` : ''}</span>
            {peutAffaires && <span>Facturé sur 12 mois : {euros(metiers.ca_12_mois)}</span>}
          </div>
        )}

        {affaires === null ? <div className="text-gray-400 text-ui-sm">Chargement…</div> : (
          <ul className="divide-y divide-gray-100">
            {ouvertes.length === 0 && <li className="py-2 text-ui-sm text-gray-500">Aucune affaire en cours.</li>}
            {[...ouvertes, ...fermees].map((a) => {
              const u = FERMEES.includes(a.stage) ? null : urgence(a.next_action_on)
              return (
                <li key={a.id} className="py-2 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{a.title}</div>
                    <div className="text-ui-sm text-gray-500">{etape(a.stage)}{a.amount_ht != null ? ` · ${euros(a.amount_ht)}` : ''}
                      {u ? ` · ${a.next_action || 'prochaine action'} le ${fr(a.next_action_on)}` : a.stage === 'perdue' && a.lost_reason ? ` · ${a.lost_reason}` : ''}</div>
                  </div>
                  {u && <StatusBadge tone={URGENCES[u][0]}>{URGENCES[u][1]}</StatusBadge>}
                  {peutAffaires && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdition({ affaire: a })} aria-label={`Ouvrir ${a.title}`}><Pencil className="w-4 h-4" /></button>}
                </li>
              )
            })}
          </ul>
        )}

        <div className="border-t border-gray-100 pt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-ui-sm text-gray-600">
          <span>Segment : {client.segment ? label('segment', client.segment) : '—'}</span>
          <span>Source : {client.source ? label('source', client.source) : '—'}{client.source_detail ? ` (${client.source_detail})` : ''}</span>
          <span>Responsable : {responsable || '—'}</span>
          {origines.disponible && <span>Apporté par : {(() => {
            const v = valeurOrigine(client.introduced_by_profile, client.introduced_by_contributor)
            if (!v) return '—'
            if (v.startsWith('p:')) { const p = origines.equipe.find((x) => x.id === v.slice(2)); return p ? (p.display_name || p.email) : 'Membre de l\'équipe' }
            return origines.apporteurs.find((x) => x.id === v.slice(2))?.name || 'Apporteur'
          })()}</span>}
          {canaux.length > 0 && <span style={{ color: 'rgb(var(--c-danger))' }}>Opposition : {canaux.map((c) => CANAUX[c]).join(', ')}{client.opposition_at ? ` depuis le ${fr(client.opposition_at)}` : ''}</span>}
          {peutModifierFiche && <button type="button" className="text-accent-700 hover:underline ml-auto" onClick={() => setFiche({
            segment: client.segment || '', source: client.source || '', source_detail: client.source_detail || '', owner_id: client.owner_id || '',
            origine: valeurOrigine(client.introduced_by_profile, client.introduced_by_contributor),
            first_contact_on: client.first_contact_on || '', informed_at: client.informed_at || '', opposition_canaux: canaux, opposition_motif: client.opposition_motif || '',
          })}>Modifier</button>}
        </div>

        {fiche && (
          <div className="rounded-ui border border-gray-200 p-3 space-y-3">
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="label" htmlFor="cf-seg">Segment</label>
                <select id="cf-seg" className="select" value={fiche.segment} onChange={(e) => setFiche((f) => ({ ...f, segment: e.target.value }))}>
                  <option value="">—</option>{listes.segment.filter((s) => s.is_active !== false).map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="cf-src">Source</label>
                <select id="cf-src" className="select" value={fiche.source} onChange={(e) => setFiche((f) => ({ ...f, source: e.target.value }))}>
                  <option value="">—</option>{listes.source.filter((s) => s.is_active !== false).map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="cf-resp">Responsable</label>
                <select id="cf-resp" className="select" value={fiche.owner_id} onChange={(e) => setFiche((f) => ({ ...f, owner_id: e.target.value }))}>
                  <option value="">—</option>{comptes.map((c) => <option key={c.id} value={c.id}>{c.display_name || 'Compte'}</option>)}
                </select>
              </div>
              {origines.disponible && (
                <div>
                  <label className="label" htmlFor="cf-apport">Apporté par</label>
                  <OrigineSelect id="cf-apport" value={fiche.origine} onChange={(v) => setFiche((f) => ({ ...f, origine: v }))} origines={origines} />
                </div>
              )}
              <div>
                <label className="label" htmlFor="cf-det">Précision sur la source</label>
                <input id="cf-det" className="input" value={fiche.source_detail} onChange={(e) => setFiche((f) => ({ ...f, source_detail: e.target.value }))} placeholder="Ex. : recommandé par…" />
              </div>
              <div>
                <label className="label" htmlFor="cf-prem">Premier contact</label>
                <input id="cf-prem" type="date" className="input" value={fiche.first_contact_on} onChange={(e) => setFiche((f) => ({ ...f, first_contact_on: e.target.value }))} />
              </div>
              <div>
                <label className="label" htmlFor="cf-info">Informé (données)</label>
                <input id="cf-info" type="date" className="input" value={fiche.informed_at} onChange={(e) => setFiche((f) => ({ ...f, informed_at: e.target.value }))} />
              </div>
            </div>
            <div>
              <span className="label">Ne veut plus être sollicité par</span>
              <div className="flex flex-wrap gap-3">
                {Object.entries(CANAUX).map(([k, v]) => (
                  <label key={k} className="inline-flex items-center gap-1.5 text-ui">
                    <input type="checkbox" checked={fiche.opposition_canaux.includes(k)}
                      onChange={(e) => setFiche((f) => ({ ...f, opposition_canaux: e.target.checked ? [...f.opposition_canaux, k] : f.opposition_canaux.filter((x) => x !== k) }))} />{v}
                  </label>
                ))}
              </div>
              {fiche.opposition_canaux.length > 0 && <input className="input mt-2" value={fiche.opposition_motif} placeholder="Motif ou demande du client (facultatif)"
                onChange={(e) => setFiche((f) => ({ ...f, opposition_motif: e.target.value }))} />}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFiche(null)}>Annuler</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={enregistrerFiche}>Enregistrer</button>
            </div>
          </div>
        )}
        <Link to="/affaires" className="text-ui-sm text-accent-700 hover:underline">Toutes les affaires</Link>
      </div>

      {edition && <AffaireSheet affaire={edition.affaire || null} clientId={client.id} listes={listes} onClose={() => setEdition(null)} onSaved={charger} />}
      {echange && <EchangeSheet clientId={client.id} clientName={client.name} affaire={echange.affaire} onClose={() => setEchange(null)} onSaved={charger} />}
    </div>
  )
}
