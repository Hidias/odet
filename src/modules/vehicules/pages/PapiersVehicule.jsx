// Papiers des véhicules (0447) : carte grise et attestation dans « Mon véhicule », guide accident (e-constat auto en
// premier, constat papier prérempli sinon), certificat de cession prérempli, suivi des sinistres sur la fiche.

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { FileText, Upload, Eye, Trash2, ShieldAlert, Phone, Camera, ExternalLink, Copy, FileSignature } from 'lucide-react'
import { Sheet } from '../../../ui/Sheet'
import { Spinner } from '../../../ui/EmptyState'
import { confirmer } from '../../../ui/Confirm'
import { orgIdentite } from '../../../core/org/currentOrg'
import { compresser } from '../../../core/feedback/retours'
import { euros, enregistrerEvenement } from '../lib/vehiculesData'
import {
  PAPIERS, ETATS_SINISTRE, RESPONSABILITES, CERFA_VIERGE, E_CONSTAT, chargerPapiers, chargerConstatsVierges, constatViergeDe,
  papierValable, dernier, deposerPapier, supprimerPapier, lienPapier, octetsPapier, echeanceSinistre, eConstatPossible,
  donneesVehicule, infosEConstat, remplirCerfaCession, remplirConstat, ouvrirPdf,
} from '../lib/papiersVehicule'

const dateFr = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '')
const aujourdhui = () => new Date().toISOString().slice(0, 10)
const plaqueFichier = (v) => String(v?.plate || 'vehicule').replace(/[^A-Za-z0-9]/g, '')

function Champ({ label, children, aide = null, className = '' }) {
  return <label className={`block ${className}`}><span className="label">{label}</span>{children}{aide && <span className="block text-ui-sm muted mt-0.5">{aide}</span>}</label>
}

async function ouvrir(p) {
  try { window.open(await lienPapier(p.file_path), '_blank', 'noopener') } catch (e) { toast.error(e.message) }
}

/** Constat prérempli (sur le constat vierge de la société), ou le vierge seul */
async function constatPrerempli({ vierge, vehicule, km, conducteur, attestation, vide = false }) {
  if (!vierge) throw new Error('Le constat vierge de la société n\'est pas encore déposé (Véhicules, Parc, « Constat vierge »)')
  const octets = await octetsPapier(vierge.file_path)
  if (vide) return ouvrirPdf(octets, 'constat-amiable-vierge.pdf')
  const d = donneesVehicule({ vehicule, km, societe: orgIdentite(), conducteur, attestation })
  ouvrirPdf(await remplirConstat(octets, d), `constat-amiable-${plaqueFichier(vehicule)}.pdf`)
}

// ─── Constat vierge de la société (responsable du parc) ───
export function ConstatVierge({ companyId }) {
  const [p, setP] = useState(undefined)
  const ref = useRef(null)
  const charger = useCallback(() => chargerConstatsVierges().then((l) => setP(companyId ? constatViergeDe(l, companyId) : l[0] || null)).catch(() => setP(null)), [companyId])
  useEffect(() => { charger() }, [charger])
  if (p === undefined) return null
  return (
    <span className="inline-flex items-center gap-1">
      <input ref={ref} type="file" accept="application/pdf" className="hidden" onChange={async (e) => {
        const f = e.target.files?.[0]; e.target.value = ''
        if (!f || !companyId) return
        try { await deposerPapier({ companyId, kind: 'constat_vierge', file: f, label: 'Constat amiable vierge' }); toast.success('Constat vierge déposé : les constats des véhicules sont préremplis dessus'); charger() } catch (err) { toast.error(err.message) }
      }} />
      {p && <button type="button" className="btn btn-ghost btn-sm" onClick={() => ouvrir(p)}><Eye className="w-4 h-4" aria-hidden="true" />Constat vierge</button>}
      <button type="button" className="btn btn-secondary btn-sm" title="Le constat amiable fourni par votre assureur, au modèle européen (PDF)" onClick={() => ref.current?.click()}><Upload className="w-4 h-4" aria-hidden="true" />{p ? 'Remplacer le constat vierge' : 'Déposer le constat vierge'}</button>
    </span>
  )
}

// ─── Certificat de cession (Cerfa 15776) ───
function CessionSheet({ vehicule, km, onClose }) {
  const [v, setV] = useState({ date: aujourdhui(), heure: '', km: km ?? '', destruction: false, agrement: '', situationRemise: false, sansTransformation: false, morale: false, sexe: '', nom: '', siret: '', naissance: '', lieuNaissance: '', adresse: '', cp: '', ville: '' })
  const [busy, setBusy] = useState(false)
  const m = (k) => (e) => setV({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const manque = ['type_variant', 'national_genre', 'registration_formula', 'vin', 'first_registration_on'].filter((k) => !vehicule[k])
  const generer = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const vierge = new Uint8Array(await (await fetch(CERFA_VIERGE)).arrayBuffer())
      const d = donneesVehicule({ vehicule, km: v.km === '' ? null : Number(String(v.km).replace(/\s/g, '')), societe: orgIdentite() })
      const pdf = await remplirCerfaCession(vierge, d, v, { morale: v.morale, sexe: v.sexe, nom: v.nom, siret: v.siret, naissance: v.naissance, lieuNaissance: v.lieuNaissance, adresse: v.adresse, cp: v.cp, ville: v.ville })
      ouvrirPdf(pdf, `certificat-cession-${plaqueFichier(vehicule)}.pdf`)
      toast.success('Certificat prérempli : imprimez les deux exemplaires et faites-les signer')
    } catch (err) { toast.error(err.message) }
    setBusy(false)
  }
  return (
    <Sheet title={`Certificat de cession : ${vehicule.plate}`} onClose={onClose} size="lg"
      footer={<><a className="btn btn-ghost mr-auto" href={CERFA_VIERGE} target="_blank" rel="noopener noreferrer"><FileText className="w-4 h-4" aria-hidden="true" />Cerfa vierge</a><button type="button" className="btn btn-secondary" onClick={onClose}>Fermer</button><button type="submit" form="cession" className="btn btn-primary" disabled={busy}>Préremplir le Cerfa</button></>}>
      <form id="cession" onSubmit={generer} className="space-y-4">
        <p className="text-ui-sm text-gray-600">Le véhicule et l'ancien propriétaire (la société) sont repris de la fiche. L'acheteur n'est pas enregistré : ses informations ne servent qu'à remplir le formulaire. Après la vente, déclarez la cession sur le site de l'ANTS dans les 15 jours.</p>
        {manque.length > 0 && <p className="text-ui-sm text-[rgb(var(--c-warning))]">À compléter sur la fiche du véhicule (sinon à la main) : {manque.map((k) => ({ type_variant: 'type (D.2)', national_genre: 'genre (J.1)', registration_formula: 'numéro de formule', vin: 'numéro de série', first_registration_on: 'date de 1re immatriculation' }[k])).join(', ')}.</p>}
        <fieldset className="grid gap-3 sm:grid-cols-4">
          <Champ label="Date de la vente"><input className="input" type="date" required value={v.date} onChange={m('date')} /></Champ>
          <Champ label="Heure"><input className="input" type="time" value={v.heure} onChange={m('heure')} /></Champ>
          <Champ label="Compteur (km)"><input className="input" inputMode="numeric" value={v.km} onChange={m('km')} /></Champ>
          <label className="flex items-center gap-2 min-h-[44px] self-end"><input type="checkbox" className="w-5 h-5" checked={v.destruction} onChange={m('destruction')} /><span className="text-ui">Cédé pour destruction</span></label>
          {v.destruction && <Champ label="N° d'agrément VHU du professionnel" className="sm:col-span-2"><input className="input" required value={v.agrement} onChange={m('agrement')} /></Champ>}
          <label className="flex items-center gap-2 sm:col-span-4"><input type="checkbox" className="w-5 h-5" checked={v.situationRemise} onChange={m('situationRemise')} /><span className="text-ui-sm">Certificat de situation administrative (moins de 15 jours) remis à l'acheteur</span></label>
          <label className="flex items-center gap-2 sm:col-span-4"><input type="checkbox" className="w-5 h-5" checked={v.sansTransformation} onChange={m('sansTransformation')} /><span className="text-ui-sm">Le véhicule n'a pas subi de transformation notable</span></label>
        </fieldset>
        <fieldset className="grid gap-3 sm:grid-cols-4">
          <legend className="font-semibold text-ui mb-1">Nouveau propriétaire (facultatif : sinon à la main)</legend>
          <Champ label="Personne"><select className="select" value={v.morale ? 'm' : 'p'} onChange={(e) => setV({ ...v, morale: e.target.value === 'm' })}><option value="p">Physique</option><option value="m">Morale (société)</option></select></Champ>
          {!v.morale && <Champ label="Sexe"><select className="select" value={v.sexe} onChange={m('sexe')}><option value="">—</option><option value="M">M</option><option value="F">F</option></select></Champ>}
          <Champ label={v.morale ? 'Raison sociale' : 'Nom et prénom'} className="sm:col-span-2"><input className="input" value={v.nom} onChange={m('nom')} /></Champ>
          {v.morale ? <Champ label="SIRET"><input className="input" inputMode="numeric" value={v.siret} onChange={m('siret')} /></Champ> : <>
            <Champ label="Né(e) le"><input className="input" type="date" value={v.naissance} onChange={m('naissance')} /></Champ>
            <Champ label="à"><input className="input" value={v.lieuNaissance} onChange={m('lieuNaissance')} /></Champ>
          </>}
          <Champ label="Adresse" className="sm:col-span-2"><input className="input" value={v.adresse} onChange={m('adresse')} placeholder="12 rue des Lilas" /></Champ>
          <Champ label="Code postal"><input className="input" inputMode="numeric" value={v.cp} onChange={m('cp')} /></Champ>
          <Champ label="Commune"><input className="input" value={v.ville} onChange={m('ville')} /></Champ>
        </fieldset>
      </form>
    </Sheet>
  )
}

// ─── Papiers sur la fiche du véhicule (responsable du parc) ───
export function PapiersSection({ vehicule, kmActuel, conducteur, peutGerer, evenements = [] }) {
  const [l, setL] = useState(null)
  const [vierge, setVierge] = useState(null)
  const [depot, setDepot] = useState(null)
  const [cession, setCession] = useState(false)
  const ref = useRef(null)
  const charger = useCallback(async () => {
    try {
      const [p, vs] = await Promise.all([chargerPapiers(vehicule.id), chargerConstatsVierges().catch(() => [])])
      setL(p); setVierge(constatViergeDe(vs, vehicule.company_id))
    } catch (e) { toast.error(e.message); setL([]) }
  }, [vehicule.id, vehicule.company_id])
  useEffect(() => { charger() }, [charger])
  const attestation = dernier(l, 'attestation_assurance')
  const deposer = async (e) => {
    e.preventDefault()
    try {
      await deposerPapier({ companyId: vehicule.company_id, vehicleId: vehicule.id, kind: depot.kind, file: depot.file, validFrom: depot.validFrom, validUntil: depot.validUntil, eventId: depot.eventId || null })
      toast.success('Document déposé'); setDepot(null); charger()
    } catch (err) { toast.error(err.message) }
  }
  const sinistres = evenements.filter((x) => x.kind === 'sinistre')
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-ui flex-1 flex items-center gap-2"><FileText className="w-4 h-4 text-gray-400" aria-hidden="true" />Papiers</h3>
        <button type="button" className="btn btn-ghost btn-sm" onClick={async () => { try { await constatPrerempli({ vierge, vehicule, km: kmActuel, conducteur, attestation }) } catch (err) { toast.error(err.message) } }}><FileSignature className="w-4 h-4" aria-hidden="true" />Constat prérempli</button>
        {peutGerer && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCession(true)}><FileText className="w-4 h-4" aria-hidden="true" />Certificat de cession</button>}
        {peutGerer && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDepot({ kind: 'carte_grise', file: null, validFrom: '', validUntil: '', eventId: '' })}><Upload className="w-4 h-4" aria-hidden="true" />Déposer</button>}
      </div>
      {depot && (
        <form className="card grid gap-2 sm:grid-cols-4" onSubmit={deposer}>
          <Champ label="Document"><select className="select" value={depot.kind} onChange={(e) => setDepot({ ...depot, kind: e.target.value })}>{Object.entries(PAPIERS).filter(([k]) => k !== 'constat_vierge').map(([k, x]) => <option key={k} value={k}>{x}</option>)}</select></Champ>
          {depot.kind === 'attestation_assurance' && <Champ label="Valable du"><input className="input" type="date" value={depot.validFrom} onChange={(e) => setDepot({ ...depot, validFrom: e.target.value })} /></Champ>}
          {depot.kind === 'attestation_assurance' && <Champ label="au"><input className="input" type="date" required value={depot.validUntil} onChange={(e) => setDepot({ ...depot, validUntil: e.target.value })} /></Champ>}
          {['constat', 'photo_sinistre'].includes(depot.kind) && sinistres.length > 0 && <Champ label="Sinistre"><select className="select" value={depot.eventId} onChange={(e) => setDepot({ ...depot, eventId: e.target.value })}><option value="">—</option>{sinistres.map((x) => <option key={x.id} value={x.id}>{dateFr(x.happened_on)} {x.description || ''}</option>)}</select></Champ>}
          <input ref={ref} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => setDepot({ ...depot, file: e.target.files?.[0] || null })} />
          <div className="flex flex-wrap gap-2 items-end sm:col-span-4">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => ref.current?.click()}><Upload className="w-4 h-4" aria-hidden="true" />{depot.file ? depot.file.name : 'Choisir le fichier'}</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={!depot.file}>Enregistrer</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDepot(null)}>Annuler</button>
          </div>
        </form>
      )}
      {!l ? <Spinner /> : l.length === 0 ? <p className="text-ui-sm muted">Aucun papier : déposez la carte grise et l'attestation d'assurance, le conducteur les retrouve dans « Mon véhicule ».</p> : (
        <ul className="divide-y divide-gray-100 text-ui-sm">
          {l.map((p) => (
            <li key={p.id} className="py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium">{PAPIERS[p.kind]}</span>
              {p.kind === 'attestation_assurance' && <span className={`badge ${papierValable(p) ? 'badge-success' : 'badge-danger'}`}>{papierValable(p) ? `valable jusqu'au ${dateFr(p.valid_until)}` : `échue le ${dateFr(p.valid_until)}`}</span>}
              <span className="text-gray-500">{p.file_name}</span>
              <span className="text-gray-400">{dateFr(p.created_at)}</span>
              <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={() => ouvrir(p)}><Eye className="w-4 h-4" aria-hidden="true" />Voir</button>
              {peutGerer && <button type="button" className="btn btn-ghost btn-icon" aria-label={`Supprimer ${PAPIERS[p.kind]}`} onClick={async () => { if (!(await confirmer(`Supprimer ce document (${PAPIERS[p.kind]}) ?`))) return; try { await supprimerPapier(p); charger() } catch (e) { toast.error(e.message) } }}><Trash2 className="w-4 h-4" /></button>}
            </li>
          ))}
        </ul>
      )}
      {cession && <CessionSheet vehicule={vehicule} km={kmActuel} onClose={() => setCession(false)} />}
    </section>
  )
}

// ─── Suivi des sinistres (fiche du véhicule) ───
const BADGE_SINISTRE = { retard: 'badge-danger', afaire: 'badge-warning', fait: 'badge-success' }
export function SinistresSection({ evenements, peutGerer, onChange }) {
  const [edit, setEdit] = useState(null)
  const sinistres = (evenements || []).filter((x) => x.kind === 'sinistre')
  if (!sinistres.length) return null
  const m = (k) => (e) => setEdit({ ...edit, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  return (
    <section className="space-y-2">
      <h3 className="font-semibold text-ui flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-gray-400" aria-hidden="true" />Sinistres</h3>
      <ul className="divide-y divide-gray-100 text-ui-sm">
        {sinistres.map((s) => {
          const ech = echeanceSinistre(s)
          return (
            <li key={s.id} className="py-2 space-y-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="w-24 text-gray-500">{dateFr(s.happened_on)}</span>
                <span className="font-medium">{s.description || 'Sinistre'}</span>
                {ech && <span className={`badge ${BADGE_SINISTRE[ech.etat]}`}>{ech.texte}</span>}
                {s.claim_status && s.claim_status !== 'a_declarer' && <span className="badge badge-neutral">{ETATS_SINISTRE[s.claim_status]}</span>}
                {s.at_fault && <span className="text-gray-600">{RESPONSABILITES[s.at_fault]}</span>}
                {s.claim_ref && <span className="text-gray-600">dossier {s.claim_ref}</span>}
                {s.injuries && <span className="badge badge-danger">blessé</span>}
                {peutGerer && <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={() => setEdit({ id: s.id, claim_status: s.claim_status || 'a_declarer', claim_declared_on: s.claim_declared_on || '', claim_ref: s.claim_ref || '', third_party: s.third_party || '', at_fault: s.at_fault || 'inconnu', deductible: s.deductible ?? '', indemnity: s.indemnity ?? '', injuries: !!s.injuries })}>Suivre</button>}
              </div>
              {(s.deductible != null || s.indemnity != null) && <div className="text-gray-600 pl-24">{[s.deductible != null && `franchise ${euros(s.deductible)}`, s.indemnity != null && `indemnité ${euros(s.indemnity)}`].filter(Boolean).join(' · ')}</div>}
              {edit?.id === s.id && (
                <form className="card grid gap-2 sm:grid-cols-3" onSubmit={async (e) => {
                  e.preventDefault()
                  const { id, ...reste } = edit
                  try { await enregistrerEvenement({ id, ...reste }); toast.success('Sinistre suivi'); setEdit(null); onChange() } catch (err) { toast.error(err.message) }
                }}>
                  <Champ label="État"><select className="select" value={edit.claim_status} onChange={m('claim_status')}>{Object.entries(ETATS_SINISTRE).map(([k, x]) => <option key={k} value={k}>{x}</option>)}</select></Champ>
                  <Champ label="Déclaré à l'assureur le"><input className="input" type="date" value={edit.claim_declared_on} onChange={m('claim_declared_on')} /></Champ>
                  <Champ label="N° de dossier"><input className="input" value={edit.claim_ref} onChange={m('claim_ref')} /></Champ>
                  <Champ label="Responsabilité"><select className="select" value={edit.at_fault} onChange={m('at_fault')}>{Object.entries(RESPONSABILITES).map(([k, x]) => <option key={k} value={k}>{x}</option>)}</select></Champ>
                  <Champ label="Franchise"><input className="input" inputMode="decimal" value={edit.deductible} onChange={m('deductible')} /></Champ>
                  <Champ label="Indemnité reçue"><input className="input" inputMode="decimal" value={edit.indemnity} onChange={m('indemnity')} /></Champ>
                  <Champ label="Tiers (nom, assureur, immatriculation)" className="sm:col-span-2"><input className="input" value={edit.third_party} onChange={m('third_party')} /></Champ>
                  <label className="flex items-center gap-2 min-h-[44px] self-end"><input type="checkbox" className="w-5 h-5" checked={edit.injuries} onChange={m('injuries')} /><span className="text-ui">Blessé(s)</span></label>
                  <div className="flex gap-2 sm:col-span-3"><button type="submit" className="btn btn-primary btn-sm">Enregistrer</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(null)}>Annuler</button></div>
                </form>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ─── Mon véhicule : papiers et guide accident ───
export function MesPapiers({ vehicule, km, profile, onDeclarer }) {
  const [l, setL] = useState(null)
  const [vierge, setVierge] = useState(null)
  const [guide, setGuide] = useState(false)
  useEffect(() => {
    let vivant = true
    Promise.all([chargerPapiers(vehicule.id), chargerConstatsVierges().catch(() => [])])
      .then(([p, vs]) => { if (vivant) { setL(p); setVierge(constatViergeDe(vs, vehicule.company_id)) } })
      .catch(() => { if (vivant) setL([]) })
    return () => { vivant = false }
  }, [vehicule.id, vehicule.company_id])
  const cg = dernier(l, 'carte_grise')
  const att = dernier(l, 'attestation_assurance')
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-danger h-auto py-2.5 flex-1 min-w-[10rem]" onClick={() => setGuide(true)}><ShieldAlert className="w-5 h-5" aria-hidden="true" />Accident : que faire ?</button>
        {cg && <button type="button" className="btn btn-secondary btn-sm" onClick={() => ouvrir(cg)}><Eye className="w-4 h-4" aria-hidden="true" />Carte grise</button>}
        {att && <button type="button" className="btn btn-secondary btn-sm" onClick={() => ouvrir(att)}><Eye className="w-4 h-4" aria-hidden="true" />Attestation d'assurance{!papierValable(att) ? ' (échue)' : ''}</button>}
      </div>
      {l && (!cg || !att) && <p className="text-ui-sm muted">{!cg && !att ? 'Carte grise et attestation d\'assurance pas encore déposées' : !cg ? 'Carte grise pas encore déposée' : 'Attestation d\'assurance pas encore déposée'} par le responsable du parc.</p>}
      {guide && <GuideAccident vehicule={vehicule} km={km} profile={profile} vierge={vierge} attestation={att} onClose={() => setGuide(false)} onDeclarer={() => { setGuide(false); onDeclarer?.() }} />}
    </div>
  )
}

function GuideAccident({ vehicule, km, profile, vierge, attestation, onClose, onDeclarer }) {
  const [q, setQ] = useState({ vehicules: 2, france: true, blesses: false })
  const [infos, setInfos] = useState(false)
  const ec = eConstatPossible(q)
  const d = donneesVehicule({ vehicule, km, societe: orgIdentite(), conducteur: profile, attestation })
  const lignes = infosEConstat(d)
  const copier = async () => {
    try { await navigator.clipboard.writeText(lignes.map(([k, x]) => `${k} : ${x}`).join('\n')); toast.success('Copié') } catch { toast.error('Copie impossible : recopiez les lignes') }
  }
  return (
    <Sheet title="Accident : que faire ?" onClose={onClose} size="lg"
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Fermer</button><button type="button" className="btn btn-primary" onClick={onDeclarer}>Déclarer le sinistre</button></>}>
      <div className="space-y-4 text-ui">
        <ol className="list-decimal pl-5 space-y-1">
          <li><strong>Sécurité d'abord</strong> : feux de détresse, gilet, triangle si possible. S'il y a un blessé ou un danger, appelez le <a className="link" href="tel:112">112</a> (ou le 15, le 17, le 18).</li>
          <li><strong>Faites le constat sur place</strong>, avec l'autre conducteur : un seul constat pour les deux véhicules, signé par les deux.</li>
          <li><strong>Prenez des photos</strong> : les deux véhicules, les plaques, les dégâts, la scène.</li>
          <li><strong>Déclarez le sinistre ici</strong> : le responsable du parc est prévenu et déclare à l'assureur dans les 5 jours ouvrés.</li>
        </ol>
        <section className="card space-y-2">
          <h3 className="font-semibold">Constat sur téléphone (e-constat auto) ou papier ?</h3>
          <div className="grid gap-2 sm:grid-cols-3 text-ui-sm">
            <Champ label="Véhicules impliqués"><select className="select" value={q.vehicules} onChange={(e) => setQ({ ...q, vehicules: Number(e.target.value) })}><option value={1}>1 (le nôtre seul)</option><option value={2}>2</option><option value={3}>3 ou plus</option></select></Champ>
            <label className="flex items-center gap-2 min-h-[44px] self-end"><input type="checkbox" className="w-5 h-5" checked={q.france} onChange={(e) => setQ({ ...q, france: e.target.checked })} />En France, véhicules français</label>
            <label className="flex items-center gap-2 min-h-[44px] self-end"><input type="checkbox" className="w-5 h-5" checked={q.blesses} onChange={(e) => setQ({ ...q, blesses: e.target.checked })} />Un blessé</label>
          </div>
          {ec.possible ? (
            <div className="space-y-2">
              <p><strong>L'application e-constat auto des assureurs convient</strong> : même valeur que le papier, envoyée directement à l'assureur après signature des deux conducteurs.</p>
              <div className="flex flex-wrap gap-2">
                <a className="btn btn-primary btn-sm" href={E_CONSTAT} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-4 h-4" aria-hidden="true" />e-constat auto</a>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setInfos(!infos)}><Phone className="w-4 h-4" aria-hidden="true" />Mes infos pour l'e-constat</button>
              </div>
            </div>
          ) : <p><strong>Constat papier obligatoire</strong> ({ec.raisons.join(', ')}).</p>}
          {infos && ec.possible && (
            <div className="space-y-1">
              <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 text-ui-sm">{lignes.map(([k, x]) => <Fragment key={k}><dt className="text-gray-600">{k}</dt><dd className="font-medium">{x}</dd></Fragment>)}</dl>
              <button type="button" className="btn btn-ghost btn-sm" onClick={copier}><Copy className="w-4 h-4" aria-hidden="true" />Copier</button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary btn-sm" onClick={async () => { try { await constatPrerempli({ vierge, vehicule, km, conducteur: profile, attestation }) } catch (err) { toast.error(err.message) } }}><FileSignature className="w-4 h-4" aria-hidden="true" />Constat papier prérempli</button>
            {vierge && <button type="button" className="btn btn-ghost btn-sm" onClick={async () => { try { await constatPrerempli({ vierge, vide: true }) } catch (err) { toast.error(err.message) } }}><FileText className="w-4 h-4" aria-hidden="true" />Constat vierge</button>}
          </div>
          {!vierge && <p className="text-ui-sm muted">Le constat vierge de la société n'est pas encore déposé : utilisez celui de la boîte à gants.</p>}
        </section>
        <p className="text-ui-sm text-gray-600 flex items-start gap-2"><Camera className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />Après la déclaration, ajoutez la photo du constat signé et des dégâts au sinistre (bouton « Photos » dans la déclaration).</p>
      </div>
    </Sheet>
  )
}

/** Photos du constat et des dégâts, ajoutées à un sinistre par le conducteur */
export function PhotosSinistre({ vehicule, eventId, onDone }) {
  const ref = useRef(null)
  const [n, setN] = useState(0)
  const [busy, setBusy] = useState(false)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input ref={ref} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={async (e) => {
        const fichiers = Array.from(e.target.files || []); e.target.value = ''
        setBusy(true)
        let ok = 0
        for (const f of fichiers) {
          try {
            let fichier = f
            if (f.type.startsWith('image/')) {
              const blob = await (await fetch(await compresser(f))).blob()
              fichier = new File([blob], f.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
            }
            await deposerPapier({ companyId: vehicule.company_id, vehicleId: vehicule.id, eventId, kind: f.type === 'application/pdf' ? 'constat' : 'photo_sinistre', file: fichier })
            ok++
          } catch (err) { toast.error(`${f.name} : ${err.message}`) }
        }
        setBusy(false); setN(n + ok)
        if (ok) toast.success(`${ok} fichier${ok > 1 ? 's' : ''} ajouté${ok > 1 ? 's' : ''} au sinistre`)
      }} />
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => ref.current?.click()}><Camera className="w-4 h-4" aria-hidden="true" />Photos (constat, dégâts){n ? ` · ${n}` : ''}</button>
      <button type="button" className="btn btn-primary" onClick={onDone}>Terminé</button>
    </div>
  )
}
