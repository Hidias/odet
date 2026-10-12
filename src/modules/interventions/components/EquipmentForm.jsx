// Fiche d'un appareil du parc (ajout ou modification). Les champs propres au type viennent des réglages.

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { loadSites, saveEquipment, retireEquipment } from '../lib/itvData'
import { Sheet } from './ui'

export default function EquipmentForm({ equipment = null, clientId, siteId = null, types, onClose, onSaved }) {
  const [sites, setSites] = useState([])
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState(() => ({
    type_id: equipment?.type_id || types.find((t) => t.is_active)?.id || '',
    site_id: equipment?.site_id || siteId || '',
    location: equipment?.location || '',
    brand: equipment?.brand || '',
    manufactured_year: equipment?.manufactured_year || '',
    installed_on: equipment?.installed_on || '',
    next_check_on: equipment?.next_check_on || '',
    details: { ...(equipment?.details || {}) },
    notes: equipment?.notes || '',
    label_code: equipment?.label_code || '',
  }))
  useEffect(() => { loadSites(clientId).then((s) => { setSites(s || []); if (!f.site_id && s?.[0]) setF((x) => ({ ...x, site_id: s[0].id })) }) }, [clientId]) // eslint-disable-line react-hooks/exhaustive-deps

  const type = types.find((t) => t.id === f.type_id)
  const save = async () => {
    if (!f.type_id || !f.site_id) { toast.error('Type et site obligatoires'); return }
    setBusy(true)
    try {
      const row = {
        ...(equipment?.id ? { id: equipment.id } : {}), client_id: clientId, site_id: f.site_id, type_id: f.type_id,
        location: f.location || null, brand: f.brand || null, manufactured_year: f.manufactured_year ? Number(f.manufactured_year) : null,
        installed_on: f.installed_on || null, next_check_on: f.next_check_on || (equipment ? null : new Date().toISOString().slice(0, 10)), details: f.details, notes: f.notes || null,
        ...(f.label_code ? { label_code: f.label_code.trim().toUpperCase() } : {}),
      }
      const saved = await saveEquipment(row)
      toast.success(equipment ? 'Appareil mis à jour' : `Appareil ajouté : ${saved.label_code}`)
      onSaved(saved)
    } catch (e) { toast.error(e.message?.includes('duplicate') ? 'Ce code d\'étiquette existe déjà' : e.message) } finally { setBusy(false) }
  }
  const retire = async () => {
    if (!window.confirm('Retirer cet appareil du parc ? Son historique est conservé.')) return
    try { await retireEquipment(equipment.id); toast.success('Appareil retiré du parc'); onSaved(null) } catch (e) { toast.error(e.message) }
  }

  return (
    <Sheet title={equipment ? `Appareil ${equipment.label_code}` : 'Ajouter un appareil'} onClose={onClose}
      footer={<>
        {equipment && <button type="button" className="btn btn-ghost text-red-700 mr-auto" onClick={retire}>Retirer du parc</button>}
        <button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>Enregistrer</button>
      </>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label className="label" htmlFor="eq-type">Type</label>
          <select id="eq-type" className="select" value={f.type_id} onChange={(e) => setF({ ...f, type_id: e.target.value })}>
            {types.filter((t) => t.is_active || t.id === f.type_id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select></div>
        <div><label className="label" htmlFor="eq-site">Site</label>
          <select id="eq-site" className="select" value={f.site_id} onChange={(e) => setF({ ...f, site_id: e.target.value })}>
            {sites.map((s) => <option key={s.id} value={s.id}>{[s.name, s.city].filter(Boolean).join(', ')}</option>)}
          </select></div>
      </div>
      <div><label className="label" htmlFor="eq-loc">Emplacement</label><input id="eq-loc" className="input" placeholder="Bâtiment, étage, pièce" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label" htmlFor="eq-brand">Marque</label><input id="eq-brand" className="input" value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} /></div>
        <div><label className="label" htmlFor="eq-year">Année de fabrication</label><input id="eq-year" className="input" inputMode="numeric" value={f.manufactured_year} onChange={(e) => setF({ ...f, manufactured_year: e.target.value.replace(/\D/g, '').slice(0, 4) })} /></div>
      </div>
      {(type?.fields || []).length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {type.fields.map((k) => (
            <div key={k}><label className="label" htmlFor={`eq-d-${k}`}>{k}</label>
              <input id={`eq-d-${k}`} className="input" value={f.details[k] || ''} onChange={(e) => setF({ ...f, details: { ...f.details, [k]: e.target.value } })} /></div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label" htmlFor="eq-inst">Mise en service</label><input id="eq-inst" type="date" className="input" value={f.installed_on || ''} onChange={(e) => setF({ ...f, installed_on: e.target.value })} /></div>
        <div><label className="label" htmlFor="eq-next">Prochaine vérification</label><input id="eq-next" type="date" className="input" value={f.next_check_on || ''} onChange={(e) => setF({ ...f, next_check_on: e.target.value })} /></div>
      </div>
      <div><label className="label" htmlFor="eq-code">Code d'étiquette</label><input id="eq-code" className="input uppercase" placeholder="Attribué automatiquement" value={f.label_code} onChange={(e) => setF({ ...f, label_code: e.target.value })} disabled={!!equipment} /></div>
      <div><label className="label" htmlFor="eq-notes">Notes</label><textarea id="eq-notes" className="textarea" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
      {!f.next_check_on && <p className="muted text-ui-sm">Sans date, l'appareil est à vérifier dès maintenant ; ensuite tous les {type?.verification_months || 12} mois.</p>}
    </Sheet>
  )
}
