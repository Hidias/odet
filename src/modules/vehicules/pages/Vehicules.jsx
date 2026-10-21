// Module Véhicules (0320) : mon véhicule (plein en moins de 30 secondes, incident, relevé), parc, échéances, pleins.
// Chaque onglet suit les droits ; la base décide (règles et contrôles des pleins).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Car, Fuel, Plus, Pencil, AlertTriangle, Camera, Wrench, Gauge, CalendarClock, Check, UserPlus, LogOut, Trash2, Eye } from 'lucide-react'
import { useAuthStore } from '../../../core/store'
import { supabase } from '../../../core/supabase'
import { PageHeader } from '../../../ui/PageHeader'
import { Tabs } from '../../../ui/Tabs'
import { Sheet } from '../../../ui/Sheet'
import { DataTable } from '../../../ui/DataTable'
import { EmptyState, Spinner } from '../../../ui/EmptyState'
import { demander } from '../../../ui/Confirm'
import {
  ENERGIES, ACQUISITIONS, STATUTS, REGLES, EVENEMENTS, ETATS, euros, km, chargerVehicules, chargerAttributions, chargerKm,
  chargerEcheances, chargerPleins, chargerConsommation, chargerEvenements, chargerRegles, chargerComptes, nomCompte,
  enregistrerVehicule, attribuer, restituer, releverKm, enregistrerRegle, supprimerRegle, enregistrerEvenement, marquerVerifie,
  enregistrerPlein, lienTicket,
} from '../lib/vehiculesData'
import { useAdapte } from '../../../core/branding/adapte'

const dateFr = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '')
const quand = (d) => (d ? new Date(d).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

function Champ({ label, children, aide = null, className = '' }) {
  return <label className={`block ${className}`}><span className="label">{label}</span>{children}{aide && <span className="block text-ui-sm muted mt-0.5">{aide}</span>}</label>
}
const Etat = ({ s }) => <span className={`badge ${ETATS[s]?.[1] || 'badge-neutral'}`}>{ETATS[s]?.[0] || s}</span>

// ─── Plein (téléphone) ───
function PleinSheet({ vehicule, kmActuel, onClose, onSaved }) {
  const [v, setV] = useState({ km: '', liters: '', amount: '', station: '', full: true, rembourser: false })
  const [photo, setPhoto] = useState(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)
  const valider = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await enregistrerPlein({ vehicle: vehicule, kmValue: v.km, liters: v.liters, amount: v.amount, fullTank: v.full, station: v.station, toReimburse: v.rembourser, photo })
      if (r.status === 'a_verifier') toast(`Plein enregistré, à vérifier : ${r.anomaly}`, { icon: '⚠️', duration: 6000 })
      else toast.success('Plein enregistré')
      onSaved()
    } catch (err) { toast.error(err.message) }
    setBusy(false)
  }
  return (
    <Sheet title={`Plein : ${vehicule.plate}`} onClose={onClose}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button><button type="submit" form="plein" className="btn btn-primary" disabled={busy}>Enregistrer</button></>}>
      <form id="plein" onSubmit={valider} className="space-y-3">
        <input ref={ref} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
        <button type="button" className="btn btn-secondary w-full h-auto py-3" onClick={() => ref.current?.click()}><Camera className="w-5 h-5" aria-hidden="true" />{photo ? 'Photo du ticket prise' : 'Photo du ticket'}</button>
        <div className="grid grid-cols-3 gap-2">
          <Champ label="Compteur (km)" aide={kmActuel ? `dernier : ${km(kmActuel)}` : null}><input className="input" inputMode="numeric" required value={v.km} onChange={(e) => setV({ ...v, km: e.target.value })} /></Champ>
          <Champ label="Litres"><input className="input" inputMode="decimal" required value={v.liters} onChange={(e) => setV({ ...v, liters: e.target.value })} /></Champ>
          <Champ label="Montant TTC"><input className="input" inputMode="decimal" required value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Champ>
        </div>
        <Champ label="Station (facultatif)"><input className="input" value={v.station} onChange={(e) => setV({ ...v, station: e.target.value })} /></Champ>
        <label className="flex items-center gap-2 min-h-[44px]"><input type="checkbox" className="w-5 h-5" checked={v.full} onChange={(e) => setV({ ...v, full: e.target.checked })} /><span className="text-ui">Plein complet (sert au calcul de la consommation)</span></label>
        <label className="flex items-center gap-2 min-h-[44px]"><input type="checkbox" className="w-5 h-5" checked={v.rembourser} onChange={(e) => setV({ ...v, rembourser: e.target.checked })} /><span className="text-ui">Payé avec ma carte personnelle (à rembourser)</span></label>
      </form>
    </Sheet>
  )
}

function IncidentSheet({ vehicule, onClose, onSaved }) {
  const [v, setV] = useState({ kind: 'panne', description: '', km: '', immobilise: false })
  const valider = async (e) => {
    e.preventDefault()
    try {
      await enregistrerEvenement({ vehicle_id: vehicule.id, kind: v.immobilise ? 'immobilisation' : v.kind, description: v.description, km: v.km })
      toast.success('Incident déclaré')
      onSaved()
    } catch (err) { toast.error(err.message) }
  }
  return (
    <Sheet title={`Incident : ${vehicule.plate}`} onClose={onClose}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button><button type="submit" form="incident" className="btn btn-primary">Déclarer</button></>}>
      <form id="incident" onSubmit={valider} className="space-y-3">
        <Champ label="Type"><select className="select" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}><option value="panne">Panne</option><option value="sinistre">Sinistre (accident, choc)</option><option value="reparation">Réparation à prévoir</option></select></Champ>
        <Champ label="Ce qui s'est passé"><textarea className="input min-h-[5rem]" required value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Champ>
        <Champ label="Compteur (km, facultatif)"><input className="input" inputMode="numeric" value={v.km} onChange={(e) => setV({ ...v, km: e.target.value })} /></Champ>
        <label className="flex items-center gap-2 min-h-[44px]"><input type="checkbox" className="w-5 h-5" checked={v.immobilise} onChange={(e) => setV({ ...v, immobilise: e.target.checked })} /><span className="text-ui">Le véhicule ne peut plus rouler</span></label>
      </form>
    </Sheet>
  )
}

// Permis du conducteur choisi (0395) : vérifié dans le dossier du personnel avant d'attribuer le véhicule
function PermisVerif({ vehicleId, profileId }) {
  const [etat, setEtat] = useState(undefined)
  useEffect(() => {
    let vivant = true
    setEtat(undefined)
    supabase.rpc('vehicule_permis_verifier', { p_vehicle: vehicleId, p_profile: profileId })
      .then(({ data, error }) => { if (vivant) setEtat(error ? 'erreur' : data) })
    return () => { vivant = false }
  }, [vehicleId, profileId])
  if (etat === undefined || etat === 'erreur') return null
  if (etat === null) return <p className="sm:col-span-2 text-ui-sm text-[rgb(var(--c-success))]">Permis de conduire en cours dans le dossier du personnel.</p>
  if (etat === 'sans_fiche') return <p className="sm:col-span-2 text-ui-sm text-[rgb(var(--c-warning))]">Ce conducteur n'a pas de fiche du personnel : le permis n'a pas pu être vérifié. Vérifiez-le vous-même.</p>
  return <p className="sm:col-span-2 text-ui-sm text-[rgb(var(--c-danger))] font-medium">{etat} : l'attribution sera refusée. Ajoutez le permis dans Personnel, fiche de la personne, Habilitations et titres.</p>
}

function MonVehicule() {
  const { facile } = useAdapte()
  const { user } = useAuthStore()
  const [d, setD] = useState(null)
  const [geste, setGeste] = useState(null)
  const charger = useCallback(async () => {
    try {
      const [vs, attr, kms, ech, pleins] = await Promise.all([chargerVehicules(), chargerAttributions(), chargerKm(), chargerEcheances(), chargerPleins()])
      const miens = attr.filter((a) => a.profile_id === user?.id && !a.end_on).map((a) => a.vehicle_id)
      setD({ vs: vs.filter((v) => miens.includes(v.id)), kms, ech, pleins: pleins.filter((p) => p.driver_id === user?.id).slice(0, 5) })
    } catch (e) { toast.error(e.message); setD({ vs: [], kms: {}, ech: [], pleins: [] }) }
  }, [user?.id])
  useEffect(() => { charger() }, [charger])
  if (!d) return <Spinner />
  if (!d.vs.length) return <EmptyState icon={Car} title="Aucun véhicule ne vous est attribué" compact>Le responsable du parc vous attribue un véhicule : il apparaît ici, avec le plein en deux gestes.</EmptyState>
  return (
    <div className="space-y-4">
      {d.vs.map((v) => {
        const ech = d.ech.filter((e) => e.vehicle_id === v.id && ['depassee', 'bientot'].includes(e.state))
        return (
          <section key={v.id} className="card space-y-3">
            <div className="flex items-center gap-3">
              <Car className="w-6 h-6 text-gray-400" aria-hidden="true" />
              <div className="flex-1 min-w-0"><div className="font-semibold text-ui">{v.plate}</div><div className="text-ui-sm text-gray-600">{[v.brand, v.model].filter(Boolean).join(' ')} · {km(d.kms[v.id])}</div></div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button type="button" className="btn btn-primary h-auto py-3 flex-col" onClick={() => setGeste({ kind: 'plein', v })}><Fuel className="w-5 h-5" aria-hidden="true" />{facile ? 'J\'ai fait le plein' : 'Plein'}</button>
              <button type="button" className="btn btn-secondary h-auto py-3 flex-col" onClick={() => setGeste({ kind: 'incident', v })}><AlertTriangle className="w-5 h-5" aria-hidden="true" />{facile ? 'Un problème' : 'Incident'}</button>
              <button type="button" className="btn btn-secondary h-auto py-3 flex-col" onClick={async () => {
                const val = await demander('Kilométrage au compteur', { title: 'Relevé du compteur', placeholder: 'En km' })
                if (!val) return
                try { await releverKm(v.id, val); toast.success('Kilométrage noté'); charger() } catch (e) { toast.error(e.message) }
              }}><Gauge className="w-5 h-5" aria-hidden="true" />{facile ? 'Les kilomètres' : 'Compteur'}</button>
            </div>
            {ech.length > 0 && <ul className="text-ui-sm space-y-1">{ech.map((e) => <li key={`${e.kind}-${e.rule_id}`} className="flex items-center gap-2"><Etat s={e.state} />{e.label}{e.due_on ? ` le ${dateFr(e.due_on)}` : ''}{e.due_km ? ` à ${km(e.due_km)}` : ''}</li>)}</ul>}
          </section>
        )
      })}
      {d.pleins.length > 0 && (
        <section className="space-y-1">
          <h2 className="section-title">Mes derniers pleins</h2>
          <ul className="card card-flush divide-y divide-gray-100 text-ui">
            {d.pleins.map((p) => <li key={p.id} className="px-4 py-2 flex flex-wrap gap-x-3"><span className="text-gray-500 w-32">{quand(p.filled_at)}</span><span>{Number(p.liters).toLocaleString('fr-FR')} L</span><span>{euros(p.amount_ttc)}</span>{p.status === 'a_verifier' && <span className="badge badge-warning">à vérifier</span>}</li>)}
          </ul>
        </section>
      )}
      {geste?.kind === 'plein' && <PleinSheet vehicule={geste.v} kmActuel={d.kms[geste.v.id]} onClose={() => setGeste(null)} onSaved={() => { setGeste(null); charger() }} />}
      {geste?.kind === 'incident' && <IncidentSheet vehicule={geste.v} onClose={() => setGeste(null)} onSaved={() => { setGeste(null); charger() }} />}
    </div>
  )
}

// ─── Fiche véhicule ───
function VehiculeSheet({ vehicule, onClose, onSaved }) {
  const [v, setV] = useState(() => ({ plate: '', vin: '', brand: '', model: '', energy: 'gazole', first_registration_on: '', acquisition: 'achat', lessor: '', contract_ref: '', contract_end_on: '', insurer: '', insurance_policy: '', insurance_due_on: '', fuel_card_last4: '', status: 'actif', notes: '', ...(vehicule || {}) }))
  const m = (k) => (e) => setV({ ...v, [k]: e.target.value })
  const enregistrer = async (e) => {
    e.preventDefault()
    try { const r = await enregistrerVehicule(v); toast.success('Véhicule enregistré'); onSaved(r.id) } catch (err) { toast.error(err.message) }
  }
  const loue = ['lld', 'loa', 'credit_bail', 'credit'].includes(v.acquisition)
  return (
    <Sheet title={vehicule?.id ? `Modifier ${vehicule.plate}` : 'Nouveau véhicule'} onClose={onClose} size="lg"
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button><button type="submit" form="vehicule" className="btn btn-primary">Enregistrer</button></>}>
      <form id="vehicule" onSubmit={enregistrer} className="grid gap-3 sm:grid-cols-2">
        <Champ label="Immatriculation"><input className="input uppercase" required value={v.plate} onChange={m('plate')} placeholder="AB-123-CD" /></Champ>
        <Champ label="Statut"><select className="select" value={v.status} onChange={m('status')}>{Object.entries(STATUTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Champ>
        <Champ label="Marque"><input className="input" value={v.brand || ''} onChange={m('brand')} /></Champ>
        <Champ label="Modèle"><input className="input" value={v.model || ''} onChange={m('model')} /></Champ>
        <Champ label="Énergie"><select className="select" value={v.energy} onChange={m('energy')}>{Object.entries(ENERGIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Champ>
        <Champ label="Mise en circulation"><input className="input" type="date" value={v.first_registration_on || ''} onChange={m('first_registration_on')} /></Champ>
        <Champ label="Numéro de série (VIN)"><input className="input" value={v.vin || ''} onChange={m('vin')} /></Champ>
        <Champ label="Acquisition"><select className="select" value={v.acquisition} onChange={m('acquisition')}>{Object.entries(ACQUISITIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Champ>
        {loue && <Champ label="Loueur ou organisme"><input className="input" value={v.lessor || ''} onChange={m('lessor')} /></Champ>}
        {loue && <Champ label="Fin du contrat"><input className="input" type="date" value={v.contract_end_on || ''} onChange={m('contract_end_on')} /></Champ>}
        <Champ label="Assureur"><input className="input" value={v.insurer || ''} onChange={m('insurer')} /></Champ>
        <Champ label="Échéance de l'assurance"><input className="input" type="date" value={v.insurance_due_on || ''} onChange={m('insurance_due_on')} /></Champ>
        <Champ label="Carte carburant (4 derniers chiffres)" aide="Jamais le numéro complet"><input className="input" inputMode="numeric" maxLength={4} pattern="[0-9]{4}" value={v.fuel_card_last4 || ''} onChange={m('fuel_card_last4')} /></Champ>
        <Champ label="Notes" className="sm:col-span-2"><textarea className="input min-h-[3rem]" value={v.notes || ''} onChange={m('notes')} /></Champ>
      </form>
    </Sheet>
  )
}

function FicheVehicule({ vehicule, kmActuel, comptes, attribution, peutGerer, onClose, onChange }) {
  const [d, setD] = useState(null)
  const [edite, setEdite] = useState(false)
  const [attr, setAttr] = useState(null)
  const [regle, setRegle] = useState(null)
  const [ev, setEv] = useState(null)
  const v = vehicule
  const charger = useCallback(async () => {
    try {
      const [regles, evs, pleins, conso, ech] = await Promise.all([chargerRegles(v.id), chargerEvenements(v.id), chargerPleins(v.id), chargerConsommation(v.id), chargerEcheances()])
      setD({ regles, evs, pleins, conso, ech: ech.filter((e) => e.vehicle_id === v.id) })
    } catch (e) { toast.error(e.message); setD({ regles: [], evs: [], pleins: [], conso: [], ech: [] }) }
  }, [v.id])
  useEffect(() => { charger() }, [charger])
  const actualiser = async () => { await charger(); onChange() }
  const conducteur = attribution ? nomCompte(comptes.find((c) => c.id === attribution.profile_id)) || attribution.driver_name : null
  const consoMoy = d?.conso?.length ? d.conso.reduce((t, c) => t + Number(c.liters), 0) * 100 / d.conso.reduce((t, c) => t + Number(c.distance), 0) : null
  const coutCarbu = d ? d.pleins.reduce((t, p) => t + Number(p.amount_ttc), 0) : 0
  const coutEntretien = d ? d.evs.reduce((t, e) => t + Number(e.cost_ttc || 0), 0) : 0
  return (
    <Sheet title={`${v.plate} · ${[v.brand, v.model].filter(Boolean).join(' ')}`} onClose={onClose} size="lg">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-ui">
          <span className="badge badge-neutral">{STATUTS[v.status]}</span>
          <span className="text-gray-600">{ENERGIES[v.energy]} · {ACQUISITIONS[v.acquisition]}{v.lessor ? ` (${v.lessor})` : ''}</span>
          {peutGerer && <button type="button" className="btn btn-ghost btn-icon ml-auto" aria-label="Modifier le véhicule" onClick={() => setEdite(true)}><Pencil className="w-4 h-4" /></button>}
        </div>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          <div className="card p-3"><div className="text-ui-sm text-gray-600">Compteur</div><div className="font-semibold text-ui tabular-nums">{km(kmActuel) || '—'}</div></div>
          <div className="card p-3"><div className="text-ui-sm text-gray-600">Conducteur</div><div className="font-semibold text-ui">{conducteur || 'aucun'}</div></div>
          <div className="card p-3"><div className="text-ui-sm text-gray-600">Consommation</div><div className="font-semibold text-ui">{consoMoy ? `${consoMoy.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} l/100` : 'à calculer'}</div></div>
          <div className="card p-3"><div className="text-ui-sm text-gray-600">Dépensé</div><div className="font-semibold text-ui tabular-nums">{euros(coutCarbu + coutEntretien)}</div><div className="text-ui-sm text-gray-500">carburant {euros(coutCarbu)}</div></div>
        </div>

        {peutGerer && (
          <section className="space-y-2">
            <h3 className="font-semibold text-ui">Conducteur</h3>
            {attribution ? (
              <div className="flex flex-wrap items-center gap-2 text-ui">
                <span>{conducteur} depuis le {dateFr(attribution.start_on)}{attribution.start_km != null ? ` (${km(attribution.start_km)})` : ''}</span>
                <button type="button" className="btn btn-secondary btn-sm ml-auto" onClick={() => setAttr({ mode: 'fin', endKm: kmActuel || '', endFuel: '', endNotes: '' })}><LogOut className="w-4 h-4" aria-hidden="true" />Restitution</button>
              </div>
            ) : <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAttr({ mode: 'debut', profileId: '', startKm: kmActuel || '', startFuel: '', startNotes: '' })}><UserPlus className="w-4 h-4" aria-hidden="true" />Attribuer</button>}
            {attr && (
              <form className="card grid gap-2 sm:grid-cols-2" onSubmit={async (e) => {
                e.preventDefault()
                try {
                  if (attr.mode === 'debut') await attribuer({ vehicleId: v.id, profileId: attr.profileId, startKm: attr.startKm, startFuel: attr.startFuel, startNotes: attr.startNotes })
                  else await restituer({ id: attribution.id, endKm: attr.endKm, endFuel: attr.endFuel, endNotes: attr.endNotes })
                  toast.success(attr.mode === 'debut' ? 'Véhicule attribué' : 'Restitution notée'); setAttr(null); actualiser()
                } catch (err) { toast.error(err.message) }
              }}>
                {attr.mode === 'debut' && <Champ label="Conducteur" className="sm:col-span-2"><select className="select" required value={attr.profileId} onChange={(e) => setAttr({ ...attr, profileId: e.target.value })}><option value="">Choisir…</option>{comptes.filter((c) => c.is_active !== false).map((c) => <option key={c.id} value={c.id}>{nomCompte(c)}</option>)}</select></Champ>}
                {attr.mode === 'debut' && attr.profileId && <PermisVerif vehicleId={v.id} profileId={attr.profileId} />}
                <Champ label="Compteur (km)"><input className="input" inputMode="numeric" value={attr.mode === 'debut' ? attr.startKm : attr.endKm} onChange={(e) => setAttr({ ...attr, [attr.mode === 'debut' ? 'startKm' : 'endKm']: e.target.value })} /></Champ>
                <Champ label="Carburant"><select className="select" value={attr.mode === 'debut' ? attr.startFuel : attr.endFuel} onChange={(e) => setAttr({ ...attr, [attr.mode === 'debut' ? 'startFuel' : 'endFuel']: e.target.value })}><option value="">—</option>{['Réserve', '1/4', '1/2', '3/4', 'Plein'].map((x) => <option key={x}>{x}</option>)}</select></Champ>
                <Champ label="État des lieux (observations)" className="sm:col-span-2"><input className="input" value={attr.mode === 'debut' ? attr.startNotes : attr.endNotes} onChange={(e) => setAttr({ ...attr, [attr.mode === 'debut' ? 'startNotes' : 'endNotes']: e.target.value })} placeholder="Rayures, propreté, équipements" /></Champ>
                <div className="flex gap-2 sm:col-span-2"><button type="submit" className="btn btn-primary btn-sm">Enregistrer</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setAttr(null)}>Annuler</button></div>
              </form>
            )}
          </section>
        )}

        <section className="space-y-2">
          <div className="flex items-center gap-2"><h3 className="font-semibold text-ui flex-1 flex items-center gap-2"><CalendarClock className="w-4 h-4 text-gray-400" aria-hidden="true" />Échéances</h3>
            {peutGerer && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRegle({ vehicle_id: v.id, kind: 'controle_technique', every_months: '24', every_km: '', last_on: '', last_km: '' })}><Plus className="w-4 h-4" aria-hidden="true" />Échéance</button>}</div>
          {!d ? <Spinner /> : d.ech.length === 0 ? <p className="text-ui-sm muted">Aucune échéance : ajoutez le contrôle technique, la vidange, la révision.</p> : (
            <ul className="divide-y divide-gray-100 text-ui">
              {d.ech.map((e) => {
                const r = d.regles.find((x) => x.id === e.rule_id)
                return (
                  <li key={`${e.kind}-${e.rule_id}`} className="py-2 flex flex-wrap items-center gap-3">
                    <Etat s={e.state} /><span className="flex-1 min-w-[8rem]">{REGLES[e.kind] || e.label}</span>
                    <span className="text-ui-sm text-gray-600">{[e.due_on && `le ${dateFr(e.due_on)}`, e.due_km && `à ${km(e.due_km)}`].filter(Boolean).join(' ou ')}</span>
                    {peutGerer && r && <button type="button" className="btn btn-ghost btn-icon" aria-label={`Modifier ${e.label}`} onClick={() => setRegle({ ...r })}><Pencil className="w-4 h-4" /></button>}
                  </li>
                )
              })}
            </ul>
          )}
          {regle && (
            <form className="card grid gap-2 sm:grid-cols-3" onSubmit={async (e) => { e.preventDefault(); try { await enregistrerRegle(regle); setRegle(null); actualiser() } catch (err) { toast.error(err.message) } }}>
              <Champ label="Type"><select className="select" value={regle.kind} onChange={(e) => setRegle({ ...regle, kind: e.target.value })}>{Object.entries(REGLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Champ>
              <Champ label="Tous les (mois)"><input className="input" inputMode="numeric" value={regle.every_months ?? ''} onChange={(e) => setRegle({ ...regle, every_months: e.target.value })} /></Champ>
              <Champ label="Ou tous les (km)"><input className="input" inputMode="numeric" value={regle.every_km ?? ''} onChange={(e) => setRegle({ ...regle, every_km: e.target.value })} /></Champ>
              <Champ label="Dernier passage le"><input className="input" type="date" value={regle.last_on || ''} onChange={(e) => setRegle({ ...regle, last_on: e.target.value })} /></Champ>
              <Champ label="À (km)"><input className="input" inputMode="numeric" value={regle.last_km ?? ''} onChange={(e) => setRegle({ ...regle, last_km: e.target.value })} /></Champ>
              <div className="flex gap-2 items-end">
                <button type="submit" className="btn btn-primary btn-sm">OK</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRegle(null)}>Annuler</button>
                {regle.id && <button type="button" className="btn btn-ghost btn-icon" aria-label="Supprimer l'échéance" onClick={async () => { try { await supprimerRegle(regle.id); setRegle(null); actualiser() } catch (err) { toast.error(err.message) } }}><Trash2 className="w-4 h-4" /></button>}
              </div>
            </form>
          )}
        </section>

        <section className="space-y-2">
          <div className="flex items-center gap-2"><h3 className="font-semibold text-ui flex-1 flex items-center gap-2"><Wrench className="w-4 h-4 text-gray-400" aria-hidden="true" />Entretiens et incidents</h3>
            {peutGerer && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEv({ vehicle_id: v.id, kind: 'entretien', happened_on: new Date().toISOString().slice(0, 10), km: kmActuel || '', provider: '', cost_ttc: '', invoice_ref: '', description: '', rule_id: '', unavailable_until: '' })}><Plus className="w-4 h-4" aria-hidden="true" />Ajouter</button>}</div>
          {ev && (
            <form className="card grid gap-2 sm:grid-cols-3" onSubmit={async (e) => { e.preventDefault(); try { await enregistrerEvenement({ ...ev, rule_id: ev.rule_id || null, unavailable_until: ev.unavailable_until || null }); toast.success('Enregistré'); setEv(null); actualiser() } catch (err) { toast.error(err.message) } }}>
              <Champ label="Type"><select className="select" value={ev.kind} onChange={(e) => setEv({ ...ev, kind: e.target.value })}>{Object.entries(EVENEMENTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Champ>
              <Champ label="Date"><input className="input" type="date" required value={ev.happened_on} onChange={(e) => setEv({ ...ev, happened_on: e.target.value })} /></Champ>
              <Champ label="Compteur (km)"><input className="input" inputMode="numeric" value={ev.km} onChange={(e) => setEv({ ...ev, km: e.target.value })} /></Champ>
              <Champ label="Garage ou prestataire"><input className="input" value={ev.provider} onChange={(e) => setEv({ ...ev, provider: e.target.value })} /></Champ>
              <Champ label="Coût TTC"><input className="input" inputMode="decimal" value={ev.cost_ttc} onChange={(e) => setEv({ ...ev, cost_ttc: e.target.value })} /></Champ>
              <Champ label="Facture n°"><input className="input" value={ev.invoice_ref} onChange={(e) => setEv({ ...ev, invoice_ref: e.target.value })} /></Champ>
              <Champ label="Remet à jour l'échéance"><select className="select" value={ev.rule_id} onChange={(e) => setEv({ ...ev, rule_id: e.target.value })}><option value="">Aucune</option>{(d?.regles || []).map((r) => <option key={r.id} value={r.id}>{REGLES[r.kind]}</option>)}</select></Champ>
              <Champ label="Indisponible jusqu'au"><input className="input" type="date" value={ev.unavailable_until} onChange={(e) => setEv({ ...ev, unavailable_until: e.target.value })} /></Champ>
              <Champ label="Détail"><input className="input" value={ev.description} onChange={(e) => setEv({ ...ev, description: e.target.value })} /></Champ>
              <div className="flex gap-2 sm:col-span-3"><button type="submit" className="btn btn-primary btn-sm">Enregistrer</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setEv(null)}>Annuler</button></div>
            </form>
          )}
          {d && (d.evs.length === 0 ? <p className="text-ui-sm muted">Aucun entretien ni incident.</p> : (
            <ul className="divide-y divide-gray-100 text-ui-sm">
              {d.evs.map((x) => <li key={x.id} className="py-1.5 flex flex-wrap gap-x-3"><span className="w-24 text-gray-500">{dateFr(x.happened_on)}</span><span className="font-medium">{EVENEMENTS[x.kind]}</span>{x.provider && <span>{x.provider}</span>}{x.cost_ttc != null && <span>{euros(x.cost_ttc)}</span>}{x.km != null && <span className="text-gray-500">{km(x.km)}</span>}{x.description && <span className="text-gray-600">{x.description}</span>}{x.unavailable_until && <span className="badge badge-warning">indisponible jusqu'au {dateFr(x.unavailable_until)}</span>}</li>)}
            </ul>
          ))}
        </section>

        <section className="space-y-2">
          <h3 className="font-semibold text-ui flex items-center gap-2"><Fuel className="w-4 h-4 text-gray-400" aria-hidden="true" />Pleins</h3>
          {d && (d.pleins.length === 0 ? <p className="text-ui-sm muted">Aucun plein.</p> : <ListePleins pleins={d.pleins.slice(0, 20)} peutGerer={peutGerer} onChange={actualiser} />)}
        </section>
      </div>
      {edite && <VehiculeSheet vehicule={v} onClose={() => setEdite(false)} onSaved={() => { setEdite(false); actualiser() }} />}
    </Sheet>
  )
}

function ListePleins({ pleins, vehicules = null, peutGerer, onChange }) {
  const plaque = vehicules ? Object.fromEntries(vehicules.map((v) => [v.id, v.plate])) : null
  return (
    <ul className="divide-y divide-gray-100 text-ui-sm">
      {pleins.map((p) => (
        <li key={p.id} className="py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-gray-500 w-32">{quand(p.filled_at)}</span>
          {plaque && <span className="font-medium">{plaque[p.vehicle_id]}</span>}
          <span>{km(p.km)}</span><span>{Number(p.liters).toLocaleString('fr-FR')} L</span><span>{euros(p.amount_ttc)}</span>
          {!p.full_tank && <span className="text-gray-500">partiel</span>}
          {p.to_reimburse && <span className="badge badge-info">à rembourser</span>}
          {p.status === 'a_verifier' && <span className="badge badge-warning" title={p.anomaly || ''}>à vérifier : {p.anomaly}</span>}
          {p.receipt_path && <button type="button" className="btn btn-ghost btn-sm" onClick={async () => { try { window.open(await lienTicket(p.receipt_path), '_blank', 'noopener') } catch (e) { toast.error(e.message) } }}><Eye className="w-4 h-4" aria-hidden="true" />Ticket</button>}
          {peutGerer && p.status === 'a_verifier' && <button type="button" className="btn btn-secondary btn-sm ml-auto" onClick={async () => { try { await marquerVerifie(p.id); toast.success('Plein vérifié'); onChange() } catch (e) { toast.error(e.message) } }}><Check className="w-4 h-4" aria-hidden="true" />Vérifié</button>}
        </li>
      ))}
    </ul>
  )
}

// ─── Parc ───
function Parc({ peutGerer }) {
  const [d, setD] = useState(null)
  const [nouveau, setNouveau] = useState(false)
  const [fiche, setFiche] = useState(null)
  const charger = useCallback(async () => {
    try {
      const [vs, attr, kms, ech, comptes] = await Promise.all([chargerVehicules(), chargerAttributions(), chargerKm(), chargerEcheances(), chargerComptes().catch(() => [])])
      setD({ vs, attr, kms, ech, comptes })
      return vs
    } catch (e) { toast.error(e.message); setD({ vs: [], attr: [], kms: {}, ech: [], comptes: [] }); return [] }
  }, [])
  useEffect(() => { charger() }, [charger])
  if (!d) return <Spinner />
  const ouverte = (id) => d.attr.find((a) => a.vehicle_id === id && !a.end_on)
  const alertes = (id) => d.ech.filter((e) => e.vehicle_id === id && ['depassee', 'bientot'].includes(e.state))
  return (
    <div className="space-y-3">
      {peutGerer && <div className="flex"><button type="button" className="btn btn-primary ml-auto" onClick={() => setNouveau(true)}><Plus className="w-4 h-4" aria-hidden="true" />Nouveau véhicule</button></div>}
      <DataTable rows={d.vs} onRowClick={setFiche} columns={[
        { key: 'plate', label: 'Véhicule', mobile: 'title', render: (v) => <span className={v.status === 'actif' ? '' : 'text-gray-400'}>{v.plate}</span> },
        { key: 'modele', label: 'Modèle', mobile: 'subtitle', render: (v) => [v.brand, v.model].filter(Boolean).join(' ') },
        { key: 'conducteur', label: 'Conducteur', render: (v) => { const a = ouverte(v.id); return a ? nomCompte(d.comptes.find((c) => c.id === a.profile_id)) || a.driver_name || 'attribué' : '' } },
        { key: 'km', label: 'Compteur', align: 'right', render: (v) => km(d.kms[v.id]) },
        { key: 'alertes', label: 'Échéances', mobile: 'aside', render: (v) => { const a = alertes(v.id); return a.length ? <span className="flex flex-wrap gap-1">{a.map((e) => <span key={`${e.kind}-${e.rule_id}`} className={`badge ${ETATS[e.state][1]}`}>{e.label}</span>)}</span> : <span className="text-gray-400">à jour</span> } },
        { key: 'statut', label: 'Statut', render: (v) => STATUTS[v.status] },
      ]} empty={<EmptyState icon={Car} title="Aucun véhicule" compact>Ajoutez les véhicules de la société : immatriculation, conducteur, échéances.</EmptyState>} />
      {nouveau && <VehiculeSheet onClose={() => setNouveau(false)} onSaved={async (id) => { setNouveau(false); const vs = await charger(); setFiche(vs.find((x) => x.id === id) || null) }} />}
      {fiche && <FicheVehicule key={fiche.id} vehicule={d.vs.find((x) => x.id === fiche.id) || fiche} kmActuel={d.kms[fiche.id]} comptes={d.comptes} attribution={ouverte(fiche.id)} peutGerer={peutGerer} onClose={() => setFiche(null)} onChange={charger} />}
    </div>
  )
}

function Echeances() {
  const [d, setD] = useState(null)
  useEffect(() => { chargerEcheances().then((e) => setD(e.map((x, i) => ({ ...x, cle: `${x.vehicle_id}-${x.kind}-${x.rule_id || i}` })).sort((a, b) => ['depassee', 'bientot', 'inconnue', 'ok'].indexOf(a.state) - ['depassee', 'bientot', 'inconnue', 'ok'].indexOf(b.state) || String(a.due_on || '').localeCompare(String(b.due_on || ''))))).catch((e) => { toast.error(e.message); setD([]) }) }, [])
  if (!d) return <Spinner />
  return (
    <DataTable rows={d} rowKey="cle" columns={[
      { key: 'plate', label: 'Véhicule', mobile: 'title', render: (e) => e.plate },
      { key: 'label', label: 'Échéance', mobile: 'subtitle', render: (e) => REGLES[e.kind] || e.label },
      { key: 'quand', label: 'Pour', render: (e) => [e.due_on && `le ${dateFr(e.due_on)}`, e.due_km && `à ${km(e.due_km)}`].filter(Boolean).join(' ou ') },
      { key: 'km', label: 'Compteur', align: 'right', render: (e) => km(e.current_km) },
      { key: 'etat', label: 'État', mobile: 'aside', render: (e) => <Etat s={e.state} /> },
    ]} empty={<EmptyState icon={CalendarClock} title="Aucune échéance" compact>Ajoutez les échéances sur la fiche de chaque véhicule.</EmptyState>} />
  )
}

function Pleins({ peutGerer }) {
  const [d, setD] = useState(null)
  const [filtre, setFiltre] = useState('tous')
  const charger = useCallback(() => { Promise.all([chargerPleins(), chargerVehicules()]).then(([p, v]) => setD({ p, v })).catch((e) => { toast.error(e.message); setD({ p: [], v: [] }) }) }, [])
  useEffect(() => { charger() }, [charger])
  if (!d) return <Spinner />
  const visibles = d.p.filter((p) => filtre === 'tous' || (filtre === 'verifier' ? p.status === 'a_verifier' : p.to_reimburse))
  const total = visibles.reduce((t, p) => t + Number(p.amount_ttc), 0)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <select className="select w-auto" value={filtre} onChange={(e) => setFiltre(e.target.value)} aria-label="Filtre">
          <option value="tous">Tous les pleins</option><option value="verifier">À vérifier ({d.p.filter((p) => p.status === 'a_verifier').length})</option><option value="rembourser">À rembourser</option>
        </select>
        <span className="text-ui-sm text-gray-600 ml-auto">{visibles.length} plein{visibles.length > 1 ? 's' : ''} · {euros(total)} TTC</span>
      </div>
      {visibles.length === 0 ? <EmptyState icon={Fuel} title="Aucun plein" compact>Les conducteurs saisissent leurs pleins depuis « Mon véhicule ».</EmptyState> : <div className="card"><ListePleins pleins={visibles} vehicules={d.v} peutGerer={peutGerer} onChange={charger} /></div>}
    </div>
  )
}

export default function Vehicules() {
  const { can } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const voir = can('vehicules.parc.voir') === true
  const gerer = can('vehicules.parc.gerer') === true
  const couts = can('vehicules.couts.voir') === true
  const sien = can('vehicules.siens.utiliser') === true
  const tabs = useMemo(() => [
    ...((sien || gerer) ? [{ id: 'mon-vehicule', label: 'Mon véhicule' }] : []),
    ...(voir ? [{ id: 'parc', label: 'Parc' }, { id: 'echeances', label: 'Échéances' }] : []),
    ...((voir || couts) ? [{ id: 'pleins', label: 'Pleins' }] : []),
  ], [sien, gerer, voir, couts])
  const chemin = location.pathname.replace(/^\/vehicules\/?/, '').split('/')[0]
  const onglet = tabs.some((t) => t.id === chemin) ? chemin : (tabs.find((t) => t.id === 'parc')?.id || tabs[0]?.id)
  if (!tabs.length) return <EmptyState icon={Car} title="Véhicules non accessibles" compact>Votre profil ne donne pas accès aux véhicules.</EmptyState>
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Maintenance" title="Véhicules" meta={<span>Le kilométrage vient des pleins, des entretiens et des relevés : il n'est jamais tapé deux fois.</span>} />
      <Tabs tabs={tabs} value={onglet} onChange={(id) => navigate(`/vehicules/${id}`)} />
      {onglet === 'mon-vehicule' && <MonVehicule />}
      {onglet === 'parc' && <Parc peutGerer={gerer} />}
      {onglet === 'echeances' && <Echeances />}
      {onglet === 'pleins' && <Pleins peutGerer={gerer} />}
    </div>
  )
}
