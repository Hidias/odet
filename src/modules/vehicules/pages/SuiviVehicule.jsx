// Suivi des véhicules (0448) : avis de contravention (désignation sous 45 jours), équipements du véhicule, photos des
// états des lieux, coût total.

import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Receipt, ShieldCheck, Camera, Plus, Pencil, Trash2, ExternalLink, Copy, Wallet, Upload, Eye } from 'lucide-react'
import { Spinner } from '../../../ui/EmptyState'
import { confirmer } from '../../../ui/Confirm'
import { compresser } from '../../../core/feedback/retours'
import { euros } from '../lib/vehiculesData'
import { deposerPapier, chargerPapiers, lienPapier } from '../lib/papiersVehicule'
import {
  STATUTS_AMENDE, EQUIPEMENTS, ANTAI, chargerAmendes, conducteurA, enregistrerAmende, echeanceAmende, ficheDesignation,
  chargerEquipements, enregistrerEquipement, supprimerEquipement, coutTotal,
} from '../lib/suiviVehicule'

const dateFr = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '')
const BADGE = { retard: 'badge-danger', afaire: 'badge-warning', fait: 'badge-success' }

function Champ({ label, children, aide = null, className = '' }) {
  return <label className={`block ${className}`}><span className="label">{label}</span>{children}{aide && <span className="block text-ui-sm muted mt-0.5">{aide}</span>}</label>
}

async function enJpeg(f) {
  if (!f.type.startsWith('image/')) return f
  const blob = await (await fetch(await compresser(f))).blob()
  return new File([blob], f.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
}

// ─── Avis de contravention ───
function Designation({ f, onDesigne }) {
  const [fiche, setFiche] = useState(undefined)
  useEffect(() => { let vivant = true; ficheDesignation(f.profile_id).then((x) => { if (vivant) setFiche(x) }).catch(() => { if (vivant) setFiche(null) }); return () => { vivant = false } }, [f.profile_id])
  const lignes = [
    ['Avis n°', f.notice_number], ['Conducteur', fiche ? [fiche.last_name, fiche.first_name].join(' ') : f.driver_name],
    ['Né(e) le', fiche?.birth_date && dateFr(fiche.birth_date)],
    ['Adresse', fiche && [fiche.personal_address, [fiche.personal_postal_code, fiche.personal_city].filter(Boolean).join(' ')].filter(Boolean).join(', ')],
    ['Permis', fiche?.permis && [fiche.permis.label, fiche.permis.obtained_on && `obtenu le ${dateFr(fiche.permis.obtained_on)}`, fiche.permis.issuer].filter(Boolean).join(', ')],
  ].filter(([, x]) => x)
  return (
    <div className="card space-y-2 text-ui-sm">
      <p>Désignez le conducteur sur le site de l'ANTAI avec le numéro de l'avis. Le numéro de permis et le lieu de naissance sont demandés : complétez-les avec le conducteur.</p>
      {fiche === undefined ? <Spinner /> : <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5">{lignes.map(([k, x]) => <div key={k} className="contents"><dt className="text-gray-600">{k}</dt><dd className="font-medium">{x}</dd></div>)}</dl>}
      {fiche === null && f.profile_id && <p className="muted">Fiche du personnel non trouvée ou non accessible avec votre profil : complétez à la main.</p>}
      <div className="flex flex-wrap gap-2">
        <a className="btn btn-primary btn-sm" href={ANTAI} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-4 h-4" aria-hidden="true" />ANTAI</a>
        <button type="button" className="btn btn-secondary btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(lignes.map(([k, x]) => `${k} : ${x}`).join('\n')); toast.success('Copié') } catch { toast.error('Copie impossible') } }}><Copy className="w-4 h-4" aria-hidden="true" />Copier</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onDesigne}>Désignation faite aujourd'hui</button>
      </div>
    </div>
  )
}

export function AmendesSection({ vehicule, comptes = [], peutGerer, onAmendes }) {
  const [l, setL] = useState(null)
  const [form, setForm] = useState(null)
  const [trouve, setTrouve] = useState(undefined)
  const [ouvert, setOuvert] = useState(null)
  const ref = useRef(null)
  const charger = useCallback(async () => {
    try { const x = await chargerAmendes(vehicule.id); setL(x); onAmendes?.(x) } catch (e) { toast.error(e.message); setL([]) }
  }, [vehicule.id, onAmendes])
  useEffect(() => { charger() }, [charger])
  // Conducteur retrouvé dès que la date de l'infraction est saisie
  useEffect(() => {
    if (!form?.offense_at || !peutGerer) { setTrouve(undefined); return }
    let vivant = true
    conducteurA(vehicule.id, new Date(form.offense_at).toISOString()).then((x) => { if (vivant) setTrouve(x) }).catch(() => { if (vivant) setTrouve(undefined) })
    return () => { vivant = false }
  }, [form?.offense_at, vehicule.id, peutGerer])
  const enregistrer = async (e) => {
    e.preventDefault()
    try {
      const { fichier, ...a } = form
      const r = await enregistrerAmende({ ...a, vehicle_id: vehicule.id, offense_at: new Date(a.offense_at).toISOString(), profile_id: a.profile_id || null })
      if (fichier) await deposerPapier({ companyId: vehicule.company_id, vehicleId: vehicule.id, kind: 'avis_contravention', file: await enJpeg(fichier), fineId: r.id })
      toast.success(r.driver_name ? `Avis enregistré : conducteur ${r.driver_name}` : 'Avis enregistré : aucun conducteur attribué ce jour-là, choisissez-le')
      setForm(null); charger()
    } catch (err) { toast.error(err.message) }
  }
  if (!l) return null
  if (!l.length && !peutGerer) return null
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2"><h3 className="font-semibold text-ui flex-1 flex items-center gap-2"><Receipt className="w-4 h-4 text-gray-400" aria-hidden="true" />Avis de contravention</h3>
        {peutGerer && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm({ offense_at: '', notice_on: '', notice_number: '', place: '', offense: '', amount: '', profile_id: '', paid_by_company: false, fichier: null })}><Plus className="w-4 h-4" aria-hidden="true" />Avis reçu</button>}</div>
      {form && (
        <form className="card grid gap-2 sm:grid-cols-3" onSubmit={enregistrer}>
          <Champ label="Infraction le"><input className="input" type="datetime-local" required value={form.offense_at} onChange={(e) => setForm({ ...form, offense_at: e.target.value })} /></Champ>
          <Champ label="Date de l'avis" aide="Les 45 jours partent de cette date"><input className="input" type="date" required value={form.notice_on} onChange={(e) => setForm({ ...form, notice_on: e.target.value })} /></Champ>
          <Champ label="N° de l'avis"><input className="input" value={form.notice_number} onChange={(e) => setForm({ ...form, notice_number: e.target.value })} /></Champ>
          <Champ label="Lieu"><input className="input" value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value })} /></Champ>
          <Champ label="Infraction"><input className="input" value={form.offense} onChange={(e) => setForm({ ...form, offense: e.target.value })} placeholder="Excès de vitesse…" /></Champ>
          <Champ label="Montant"><input className="input" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Champ>
          <Champ label="Conducteur" className="sm:col-span-2" aide={trouve === undefined ? 'Retrouvé dans les attributions dès la date saisie' : trouve ? `Ce jour-là : ${trouve.name || 'conducteur attribué'}` : 'Aucun conducteur attribué ce jour-là'}>
            <select className="select" value={form.profile_id} onChange={(e) => setForm({ ...form, profile_id: e.target.value })}><option value="">{trouve ? `Celui de l'attribution (${trouve.name || '…'})` : 'À choisir'}</option>{comptes.map((c) => <option key={c.id} value={c.id}>{[c.first_name, c.last_name].filter(Boolean).join(' ') || c.email}</option>)}</select>
          </Champ>
          <label className="flex items-center gap-2 min-h-[44px] self-end"><input type="checkbox" className="w-5 h-5" checked={form.paid_by_company} onChange={(e) => setForm({ ...form, paid_by_company: e.target.checked })} /><span className="text-ui-sm">Payée par la société</span></label>
          <input ref={ref} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => setForm({ ...form, fichier: e.target.files?.[0] || null })} />
          <div className="flex flex-wrap gap-2 sm:col-span-3">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => ref.current?.click()}><Upload className="w-4 h-4" aria-hidden="true" />{form.fichier ? form.fichier.name : 'Avis (photo ou PDF)'}</button>
            <button type="submit" className="btn btn-primary btn-sm">Enregistrer</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm(null)}>Annuler</button>
          </div>
        </form>
      )}
      {l.length === 0 ? <p className="text-ui-sm muted">Aucun avis de contravention.</p> : (
        <ul className="divide-y divide-gray-100 text-ui-sm">
          {l.map((f) => {
            const ech = echeanceAmende(f)
            return (
              <li key={f.id} className="py-2 space-y-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="w-28 text-gray-500">{new Date(f.offense_at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="font-medium">{f.offense || 'Infraction'}</span>
                  {f.driver_name ? <span>{f.driver_name}{f.driver_source === 'attribution' ? <span className="text-gray-500"> (attribution)</span> : null}</span> : <span className="text-[rgb(var(--c-danger))]">conducteur à trouver</span>}
                  {f.amount != null && <span>{euros(f.amount)}</span>}
                  <span className={`badge ${BADGE[ech.etat]}`}>{ech.texte}</span>
                  {peutGerer && f.status === 'a_designer' && <button type="button" className="btn btn-secondary btn-sm ml-auto" onClick={() => setOuvert(ouvert === f.id ? null : f.id)}>Désigner</button>}
                  {peutGerer && <select className="select w-auto text-ui-sm" aria-label="État de l'avis" value={f.status} onChange={async (e) => { try { await enregistrerAmende({ ...f, status: e.target.value }); charger() } catch (err) { toast.error(err.message) } }}>{Object.entries(STATUTS_AMENDE).map(([k, x]) => <option key={k} value={k}>{x}</option>)}</select>}
                </div>
                {ouvert === f.id && <Designation f={f} onDesigne={async () => { try { await enregistrerAmende({ ...f, designated_on: new Date().toISOString().slice(0, 10), status: 'designe' }); toast.success('Désignation notée'); setOuvert(null); charger() } catch (err) { toast.error(err.message) } }} />}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// ─── Équipements du véhicule ───
export function EquipementsSection({ vehicule, peutGerer, onChange }) {
  const [l, setL] = useState(null)
  const [form, setForm] = useState(null)
  const charger = useCallback(() => chargerEquipements(vehicule.id).then(setL).catch((e) => { toast.error(e.message); setL([]) }), [vehicule.id])
  useEffect(() => { charger() }, [charger])
  if (!l) return null
  const fini = () => { setForm(null); charger(); onChange?.() }
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2"><h3 className="font-semibold text-ui flex-1 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-gray-400" aria-hidden="true" />Équipements du véhicule</h3>
        {peutGerer && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm({ vehicle_id: vehicule.id, kind: l.some((x) => x.kind === 'extincteur') ? 'trousse_secours' : 'extincteur', label: '', serial: '', checked_on: '', next_check_on: '', expires_on: '' })}><Plus className="w-4 h-4" aria-hidden="true" />Équipement</button>}</div>
      {form && (
        <form className="card grid gap-2 sm:grid-cols-3" onSubmit={async (e) => { e.preventDefault(); try { await enregistrerEquipement(form); fini() } catch (err) { toast.error(err.message) } }}>
          <Champ label="Équipement"><select className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{Object.entries(EQUIPEMENTS).map(([k, x]) => <option key={k} value={k}>{x}</option>)}</select></Champ>
          <Champ label="Précision" aide="Ex. 2 kg ABC"><input className="input" value={form.label || ''} onChange={(e) => setForm({ ...form, label: e.target.value })} /></Champ>
          <Champ label="N° de série"><input className="input" value={form.serial || ''} onChange={(e) => setForm({ ...form, serial: e.target.value })} /></Champ>
          <Champ label="Vérifié le"><input className="input" type="date" value={form.checked_on || ''} onChange={(e) => setForm({ ...form, checked_on: e.target.value })} /></Champ>
          <Champ label="Prochaine vérification"><input className="input" type="date" value={form.next_check_on || ''} onChange={(e) => setForm({ ...form, next_check_on: e.target.value })} /></Champ>
          <Champ label="Péremption"><input className="input" type="date" value={form.expires_on || ''} onChange={(e) => setForm({ ...form, expires_on: e.target.value })} /></Champ>
          <div className="flex gap-2 sm:col-span-3">
            <button type="submit" className="btn btn-primary btn-sm">Enregistrer</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm(null)}>Annuler</button>
            {form.id && <button type="button" className="btn btn-ghost btn-icon ml-auto" aria-label="Supprimer l'équipement" onClick={async () => { if (!(await confirmer('Supprimer cet équipement ?'))) return; try { await supprimerEquipement(form.id); fini() } catch (err) { toast.error(err.message) } }}><Trash2 className="w-4 h-4" /></button>}
          </div>
        </form>
      )}
      {l.length === 0 ? <p className="text-ui-sm muted">Aucun équipement : ajoutez l'extincteur et la trousse de secours, leurs vérifications remontent dans les échéances.</p> : (
        <ul className="divide-y divide-gray-100 text-ui-sm">
          {l.map((q) => (
            <li key={q.id} className="py-1.5 flex flex-wrap items-center gap-x-3">
              <span className="font-medium">{EQUIPEMENTS[q.kind]}{q.label ? ` · ${q.label}` : ''}</span>
              {q.serial && <span className="text-gray-500">n° {q.serial}</span>}
              {q.checked_on && <span>vérifié le {dateFr(q.checked_on)}</span>}
              {q.next_check_on && <span>prochaine le {dateFr(q.next_check_on)}</span>}
              {q.expires_on && <span>périme le {dateFr(q.expires_on)}</span>}
              {peutGerer && <button type="button" className="btn btn-ghost btn-icon ml-auto" aria-label={`Modifier ${EQUIPEMENTS[q.kind]}`} onClick={() => setForm({ ...q })}><Pencil className="w-4 h-4" /></button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ─── Photos de l'état des lieux (remise ou restitution) ───
export function PhotosEtatDesLieux({ vehicule, assignmentId, moment = 'remise', libelle = null }) {
  const ref = useRef(null)
  const [l, setL] = useState([])
  const [busy, setBusy] = useState(false)
  const charger = useCallback(() => chargerPapiers(vehicule.id).then((p) => setL(p.filter((x) => x.kind === 'etat_des_lieux' && x.assignment_id === assignmentId))).catch(() => {}), [vehicule.id, assignmentId])
  useEffect(() => { charger() }, [charger])
  if (!assignmentId) return null
  const n = l.filter((x) => x.moment === moment).length
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <input ref={ref} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={async (e) => {
        const fichiers = Array.from(e.target.files || []); e.target.value = ''
        setBusy(true)
        let ok = 0
        for (const f of fichiers) {
          try { await deposerPapier({ companyId: vehicule.company_id, vehicleId: vehicule.id, kind: 'etat_des_lieux', file: await enJpeg(f), assignmentId, moment }); ok++ } catch (err) { toast.error(`${f.name} : ${err.message}`) }
        }
        setBusy(false)
        if (ok) { toast.success(`${ok} photo${ok > 1 ? 's' : ''} ajoutée${ok > 1 ? 's' : ''}`); charger() }
      }} />
      <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => ref.current?.click()}><Camera className="w-4 h-4" aria-hidden="true" />{libelle || `Photos ${moment === 'remise' ? 'de la remise' : 'de la restitution'}`}{n ? ` · ${n}` : ''}</button>
      {l.map((p, i) => <button key={p.id} type="button" className="btn btn-ghost btn-sm" onClick={async () => { try { window.open(await lienPapier(p.file_path), '_blank', 'noopener') } catch (err) { toast.error(err.message) } }}><Eye className="w-4 h-4" aria-hidden="true" />{p.moment === 'restitution' ? 'R' : 'D'}{i + 1}</button>)}
    </span>
  )
}

// ─── Coût total ───
export function CoutVehicule({ vehicule, pleins, evenements, amendes }) {
  const c = coutTotal({ vehicule, pleins, evenements, amendes })
  const libelles = { achat: 'Achat', loyers: 'Loyers ou mensualités', assurance: 'Assurance', carburant: 'Carburant', entretien: 'Entretiens et réparations', sinistres: 'Sinistres (net)', amendes: 'Amendes payées' }
  return (
    <section className="space-y-2">
      <h3 className="font-semibold text-ui flex items-center gap-2"><Wallet className="w-4 h-4 text-gray-400" aria-hidden="true" />Coût total</h3>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-xl font-semibold tabular-nums">{euros(c.total)}</span>
        {c.parMois != null && <span className="text-ui-sm text-gray-600">{euros(c.parMois)} par mois sur {c.mois} mois</span>}
      </div>
      <ul className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2 text-ui-sm">{Object.entries(c.parts).filter(([, x]) => x).map(([k, x]) => <li key={k} className="flex justify-between gap-2"><span className="text-gray-600">{libelles[k]}</span><span className="tabular-nums">{euros(x)}</span></li>)}</ul>
      {!vehicule.acquired_on && <p className="text-ui-sm muted">Renseignez la date d'entrée dans le parc, le loyer ou la mensualité et l'assurance annuelle sur la fiche pour un coût complet.</p>}
    </section>
  )
}
