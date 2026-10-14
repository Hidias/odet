// Réglages Passeport de chaque formation du catalogue : déclarable ou non (avec motif), catégorie, ADF ou JDR,
// champs JDR, codes ROME, Formacodes, NSF, certifiante et code RS, validité, qualification du formateur, modalité.
// Valeurs proposées d'après les fiches officielles (pp_presets), toujours modifiables.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { saveSettings } from '../lib/ppData'
import { reglagesManquants } from '../lib/rules'

const VIDE = {
  declarable: true, motif: '', categorie: null, type_decl: 'ADF', type_jdr: '', nom_jdr: '', nom_option: '', mode_obtention: '',
  rome: [], formacodes: [], nsf: [], certifiante: false, code_rs: '', validite_mois: null,
  qualification_formateur: 'FORMATEUR_D_ADULTES_FORMATION_SPECIALISEE', modalite: 'PRESENTIEL', nom_formation: '', preset_code: null,
  valeurs_confirmees: false,
}

const toCodes = (txt) => String(txt || '').split(/[\s/,;]+/).map((c) => c.trim()).filter(Boolean)

function etiquette(s, contrat) {
  if (!s) return { label: 'À régler', cls: 'badge-warning' }
  if (!s.declarable) return { label: 'Non déclarable', cls: 'badge-neutral' }
  if (reglagesManquants(s, contrat).length) return { label: 'À compléter', cls: 'badge-warning' }
  return { label: s.type_decl, cls: s.type_decl === 'JDR' ? 'badge-success' : 'badge-info' }
}

export default function PpReglages({ courses, settings, setSettings, presets, format, reload }) {
  const { courseId } = useParams()
  const navigate = useNavigate()
  const current = courseId || courses[0]?.id
  const course = courses.find((c) => c.id === current)
  const [form, setForm] = useState(VIDE)
  const [codes, setCodes] = useState({ rome: '', formacodes: '', nsf: '' })
  const [busy, setBusy] = useState(false)
  const v = format.contrat?.valeurs || {}

  useEffect(() => {
    const s = settings[current]
    const f = s ? { ...VIDE, ...s } : { ...VIDE }
    setForm(f)
    setCodes({ rome: (f.rome || []).join('/'), formacodes: (f.formacodes || []).join('/'), nsf: (f.nsf || []).join('/') })
  }, [current, settings])

  const merged = useMemo(() => ({ ...form, rome: toCodes(codes.rome), formacodes: toCodes(codes.formacodes), nsf: toCodes(codes.nsf) }), [form, codes])
  const manquants = reglagesManquants(merged, format.contrat)
  const set = (k, val) => setForm((f) => ({ ...f, [k]: val, valeurs_confirmees: k === 'valeurs_confirmees' ? val : f.valeurs_confirmees }))

  const appliquer = (code) => {
    const p = presets.find((x) => x.code === code)
    if (!p) return
    setForm((f) => ({
      ...f, preset_code: p.code, declarable: p.declarable, motif: p.motif || '', categorie: p.categorie, type_decl: p.type_decl || f.type_decl,
      type_jdr: p.type_jdr || '', nom_jdr: p.nom_jdr || '', mode_obtention: p.mode_obtention || '', certifiante: p.certifiante,
      code_rs: p.code_rs || '', validite_mois: p.validite_mois, valeurs_confirmees: false,
    }))
    setCodes({ rome: (p.rome || []).join('/'), formacodes: (p.formacodes || []).join('/'), nsf: (p.nsf || []).join('/') })
  }

  const enregistrer = async () => {
    if (!form.declarable && !String(form.motif || '').trim()) { toast.error('Indiquez le motif de non-déclaration'); return }
    setBusy(true)
    try {
      const values = {
        declarable: !!form.declarable, motif: form.declarable ? null : form.motif,
        categorie: form.categorie ? Number(form.categorie) : null, type_decl: form.declarable ? form.type_decl : null,
        type_jdr: form.type_jdr || null, nom_jdr: form.nom_jdr || null, nom_option: form.nom_option || null, mode_obtention: form.mode_obtention || null,
        rome: merged.rome, formacodes: merged.formacodes, nsf: merged.nsf, certifiante: !!form.certifiante, code_rs: form.certifiante ? (form.code_rs || null) : null,
        validite_mois: form.validite_mois ? Number(form.validite_mois) : null,
        qualification_formateur: form.qualification_formateur, modalite: form.modalite, nom_formation: form.nom_formation || null,
        preset_code: form.preset_code || null, valeurs_confirmees: !!form.valeurs_confirmees,
      }
      const saved = await saveSettings(current, values)
      setSettings({ ...settings, [current]: saved })
      toast.success('Réglages enregistrés')
      reload()
    } catch (e) { toast.error(e.message) }
    setBusy(false)
  }

  if (!courses.length) return <div className="card muted">Le catalogue est vide.</div>

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      <nav aria-label="Formations du catalogue" className="card p-2 space-y-0.5 self-start">
        <label className="lg:hidden block p-2">
          <span className="label">Formation</span>
          <select className="select" value={current} onChange={(e) => navigate(`../reglages/${e.target.value}`)}>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </label>
        <div className="hidden lg:block space-y-0.5">
          {courses.map((c) => {
            const e = etiquette(settings[c.id], format.contrat)
            return (
              <button key={c.id} type="button" onClick={() => navigate(`../reglages/${c.id}`)}
                className={`w-full text-left flex items-center gap-2 px-2.5 py-2 rounded-ui text-ui ${c.id === current ? 'bg-gray-100 font-semibold' : 'hover:bg-gray-50'}`}>
                <span className="flex-1 min-w-0 truncate">{c.title}</span>
                <span className={`badge ${e.cls}`}>{e.label}</span>
              </button>
            )
          })}
        </div>
      </nav>

      {course && (
        <section className="card space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="section-title flex-1">{course.title} <span className="muted text-ui font-normal">{course.code}</span></h2>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={enregistrer}>Enregistrer</button>
          </div>

          <div className="rounded-ui bg-amber-50 text-amber-900 p-3 text-ui-sm flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 flex-1 min-w-[220px]">Valeurs proposées
              <select className="select" value={form.preset_code || ''} onChange={(e) => appliquer(e.target.value)}>
                <option value="">Choisir une fiche officielle</option>
                {presets.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 font-semibold"><input type="checkbox" className="w-4 h-4" checked={!!form.valeurs_confirmees} onChange={(e) => set('valeurs_confirmees', e.target.checked)} /> Valeurs confirmées</label>
            {form.preset_code && <p className="w-full">{presets.find((p) => p.code === form.preset_code)?.source}</p>}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label><span className="label">À déclarer au Passeport</span>
              <select className="select" value={form.declarable ? 'oui' : 'non'} onChange={(e) => set('declarable', e.target.value === 'oui')}>
                <option value="oui">Oui</option><option value="non">Non (motif obligatoire)</option>
              </select></label>
            {form.declarable ? (
              <>
                <label><span className="label">Catégorie</span>
                  <select className="select" value={form.categorie || ''} onChange={(e) => set('categorie', e.target.value ? Number(e.target.value) : null)}>
                    <option value="">Choisir</option>
                    {(format.regles?.categories || []).map((c) => <option key={c.n} value={c.n}>{c.n} : {c.label}</option>)}
                  </select></label>
                <label><span className="label">Type de déclaration</span>
                  <select className="select" value={form.type_decl || 'ADF'} onChange={(e) => set('type_decl', e.target.value)}>
                    <option value="ADF">ADF : attestation de formation</option><option value="JDR">JDR : justificatif de réussite</option>
                  </select></label>
                <label><span className="label">Validité (mois)</span>
                  <input type="number" min="1" className="input" value={form.validite_mois || ''} onChange={(e) => set('validite_mois', e.target.value)} placeholder="Sans limite" /></label>
              </>
            ) : (
              <label className="sm:col-span-3"><span className="label">Motif de non-déclaration</span>
                <input className="input" value={form.motif || ''} onChange={(e) => set('motif', e.target.value)} /></label>
            )}
          </div>

          {form.declarable && (
            <>
              {form.type_decl === 'JDR' && (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <label><span className="label">TYPE_JDR</span>
                    <select className="select" value={form.type_jdr || ''} onChange={(e) => set('type_jdr', e.target.value)}>
                      <option value="">Choisir</option>{(v.TYPE_JDR || []).map((x) => <option key={x}>{x}</option>)}
                    </select></label>
                  <label className="xl:col-span-2"><span className="label">NOM_JDR</span><input className="input" value={form.nom_jdr || ''} onChange={(e) => set('nom_jdr', e.target.value)} /></label>
                  <label><span className="label">MODE_OBTENTION</span>
                    <select className="select" value={form.mode_obtention || ''} onChange={(e) => set('mode_obtention', e.target.value)}>
                      {(v.MODE_OBTENTION || ['']).map((x) => <option key={x || 'vide'} value={x}>{x || '(vide)'}</option>)}
                    </select></label>
                </div>
              )}
              <label className="block"><span className="label">Codes compétences ROME (3 à 10, séparés par /)</span>
                <input className="input font-mono" value={codes.rome} onChange={(e) => setCodes({ ...codes, rome: e.target.value })} />
                <span className="text-ui-sm muted">{toCodes(codes.rome).length} code{toCodes(codes.rome).length > 1 ? 's' : ''}</span></label>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <label><span className="label">Formation certifiante</span>
                  <select className="select" value={form.certifiante ? 'oui' : 'non'} onChange={(e) => set('certifiante', e.target.value === 'oui')}>
                    <option value="non">Non</option><option value="oui">Oui (code RS)</option>
                  </select></label>
                <label><span className="label">Code RS</span><input className="input" disabled={!form.certifiante} value={form.code_rs || ''} onChange={(e) => set('code_rs', e.target.value)} placeholder="Uniquement si certifiante" /></label>
                <label><span className="label">Qualification du formateur</span>
                  <select className="select" value={form.qualification_formateur} onChange={(e) => set('qualification_formateur', e.target.value)}>
                    {(v.QUALIFICATION_FORMATEUR || []).map((x) => <option key={x}>{x}</option>)}
                  </select></label>
                <label><span className="label">Modalité par défaut</span>
                  <select className="select" value={form.modalite} onChange={(e) => set('modalite', e.target.value)}>
                    {(v.MODALITE_DISPENSE || []).map((x) => <option key={x}>{x}</option>)}
                  </select></label>
              </div>
              {!form.certifiante && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label><span className="label">Formacodes (1 à 5)</span><input className="input font-mono" value={codes.formacodes} onChange={(e) => setCodes({ ...codes, formacodes: e.target.value })} /></label>
                  <label><span className="label">Codes NSF (1 à 3)</span><input className="input font-mono" value={codes.nsf} onChange={(e) => setCodes({ ...codes, nsf: e.target.value })} /></label>
                </div>
              )}
              <label className="block"><span className="label">Nom de la formation dans le fichier (si différent du catalogue)</span>
                <input className="input" value={form.nom_formation || ''} onChange={(e) => set('nom_formation', e.target.value)} placeholder={course.title} /></label>
              {manquants.length > 0
                ? <p className="text-ui-sm text-red-700">À compléter avant de déclarer : {manquants.join(', ')}.</p>
                : <p className="text-ui-sm text-green-800">Réglages complets.</p>}
            </>
          )}
          <p className="text-ui-sm muted">Les sessions réalisées pour le compte d'un autre organisme (sous-traitance) ne sont jamais déclarées par nous : c'est le donneur d'ordre qui déclare.</p>
        </section>
      )}
    </div>
  )
}
