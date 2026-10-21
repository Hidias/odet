import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Repeat, Plus, Loader2, Pause, Play, Trash2 } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { Sheet } from '../../../ui/Sheet'
import { confirmer } from '../../../ui/Confirm'

// Créneaux récurrents des sessions inter (0422, série du 21/10 n° 31) : « MAC SST le premier mardi du mois à
// Quimper ». Le créneau est décrit une fois ; la base crée les sessions des douze mois à venir, publiées au calendrier
// public, et complète l'horizon chaque matin. Jours fériés non travaillés écartés ; une session supprimée n'est pas
// recréée. Réserve de maintien : celle des paramètres (calendrier, inscription, convention, contrat).

export const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']
const RANGS = [[1, 'premier'], [2, 'deuxième'], [3, 'troisième'], [4, 'quatrième'], [-1, 'dernier']]

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const jourIso = (d) => ((d.getDay() + 6) % 7) + 1 // 1 = lundi … 7 = dimanche
const dateLocale = (s) => { const [y, m, j] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, j) }

// Mêmes règles que app.recurrence_dates (0422), pour l'aperçu avant enregistrement (hors jours fériés)
export function datesCreneau(c, du, nombre = 6) {
  const res = []
  const debut = dateLocale(c.date_debut)
  const fin = c.date_fin ? dateLocale(c.date_fin) : null
  const min = du > debut ? du : debut
  const js = Number(c.jour_semaine)
  const pas = Math.max(1, Number(c.intervalle) || 1)
  if (c.frequence === 'mensuel') {
    let mois = new Date(debut.getFullYear(), debut.getMonth(), 1)
    for (let n = 0; n < 240 && res.length < nombre; n++) {
      let j
      if (Number(c.rang) === -1) {
        const dernier = new Date(mois.getFullYear(), mois.getMonth() + 1, 0)
        j = new Date(dernier); j.setDate(dernier.getDate() - ((jourIso(dernier) - js + 7) % 7))
      } else {
        j = new Date(mois); j.setDate(1 + ((js - jourIso(mois) + 7) % 7) + (Number(c.rang) - 1) * 7)
      }
      if (fin && j > fin) break
      if (j.getMonth() === mois.getMonth() && j >= min) res.push(iso(j))
      mois = new Date(mois.getFullYear(), mois.getMonth() + pas, 1)
    }
  } else {
    const j = new Date(debut); j.setDate(debut.getDate() + ((js - jourIso(debut) + 7) % 7))
    for (let n = 0; n < 1000 && res.length < nombre; n++) {
      if (fin && j > fin) break
      if (j >= min) res.push(iso(j))
      j.setDate(j.getDate() + 7 * pas)
    }
  }
  return res
}

export function libelleCreneau(c) {
  const pas = Number(c.intervalle) || 1
  if (c.frequence === 'mensuel') {
    const r = RANGS.find(([v]) => v === Number(c.rang))?.[1] || ''
    return `Le ${r} ${JOURS[c.jour_semaine - 1]} ${pas > 1 ? `tous les ${pas} mois` : 'du mois'}`
  }
  return `Chaque ${JOURS[c.jour_semaine - 1]}${pas > 1 ? `, toutes les ${pas} semaines` : ''}`
}

const fmt = (s) => dateLocale(s).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const vide = () => ({
  course_id: '', frequence: 'mensuel', rang: 1, jour_semaine: 2, intervalle: 1, nb_jours: 1, start_time: '09:00', end_time: '17:00',
  location_name: '', location_address: '', location_postal_code: '', location_city: '', trainer_id: '',
  min_participants: '', max_participants: '', public_price_per_person: '', date_debut: iso(new Date()), date_fin: '',
})

export default function CreneauxRecurrents({ courses = [], trainers = [], peutCreer, peutSupprimer, onFermer, onSessionsCreees }) {
  const [liste, setListe] = useState(null)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)

  const charger = async () => {
    const { data, error } = await supabase.from('session_recurrences').select('*, courses(title)').order('created_at')
    setListe(error ? [] : data || [])
  }
  useEffect(() => { charger() }, [])

  const f = (k, v) => setForm({ ...form, [k]: v })
  const nb = (v) => (v === '' || v == null ? null : Number(v))

  const generer = async (id) => {
    const { data, error } = await supabase.rpc('recurrence_generer', { p_id: id })
    if (error) { toast.error(error.message); return }
    const feries = data?.feries || []
    toast.success(`${data?.crees || 0} session${data?.crees > 1 ? 's' : ''} créée${data?.crees > 1 ? 's' : ''}${feries.length ? ` ; jour férié écarté : ${feries.map(fmt).join(', ')}` : ''}`, { duration: 8000 })
    onSessionsCreees?.()
  }

  const enregistrer = async (e) => {
    e.preventDefault()
    if (!form.course_id) return toast.error('Choisissez la formation')
    const ligne = {
      course_id: form.course_id, frequence: form.frequence, rang: form.frequence === 'mensuel' ? Number(form.rang) : null,
      jour_semaine: Number(form.jour_semaine), intervalle: Number(form.intervalle) || 1, nb_jours: Number(form.nb_jours) || 1,
      start_time: form.start_time, end_time: form.end_time,
      location_name: form.location_name || null, location_address: form.location_address || null,
      location_postal_code: form.location_postal_code || null, location_city: form.location_city || null,
      trainer_id: form.trainer_id || null, min_participants: nb(form.min_participants), max_participants: nb(form.max_participants),
      public_price_per_person: nb(form.public_price_per_person), date_debut: form.date_debut, date_fin: form.date_fin || null,
    }
    setBusy(true)
    const { data, error } = await supabase.from('session_recurrences').insert(ligne).select('id').single()
    if (error) { setBusy(false); return toast.error(error.message) }
    await generer(data.id)
    setBusy(false)
    setForm(null)
    await charger()
  }

  const basculer = async (c) => {
    const { error } = await supabase.from('session_recurrences').update({ actif: !c.actif }).eq('id', c.id)
    if (error) return toast.error(error.message)
    if (!c.actif) await generer(c.id)
    await charger()
  }
  const supprimer = async (c) => {
    if (!(await confirmer({ title: 'Supprimer ce créneau ?', message: 'Les sessions déjà créées restent dans le planning, sans lien au créneau. Aucune nouvelle session ne sera créée.', confirmLabel: 'Supprimer', danger: true }))) return
    const { error } = await supabase.from('session_recurrences').delete().eq('id', c.id)
    if (error) return toast.error(error.message)
    await charger()
  }

  const apercu = form ? datesCreneau(form, new Date(Date.now() + 86400000)) : []

  return (
    <Sheet title="Créneaux récurrents (sessions inter)" onClose={onFermer} size="lg">
      <div className="space-y-4 p-3">
        <p className="text-ui-sm text-gray-600">Décrivez le créneau une fois : les sessions des douze mois à venir sont créées et publiées au calendrier, puis complétées chaque matin. Jours fériés écartés ; une session supprimée n'est pas recréée. La réserve de maintien des paramètres s'applique.</p>

        {liste === null ? <Loader2 className="w-5 h-5 animate-spin text-gray-400" aria-label="Chargement" /> : liste.length === 0 && !form ? (
          <p className="text-ui text-gray-500">Aucun créneau pour le moment.</p>
        ) : (
          <ul className="space-y-2">
            {liste.map((c) => (
              <li key={c.id} className={`border rounded-ui p-3 text-ui ${c.actif ? 'border-gray-200' : 'border-gray-200 opacity-60'}`}>
                <div className="flex flex-wrap items-start gap-2">
                  <Repeat className="w-4 h-4 mt-0.5 text-gray-400" aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900">{c.courses?.title || 'Formation'}{c.location_city ? ` · ${c.location_city}` : ''}</div>
                    <div className="text-gray-600">{libelleCreneau(c)}, {c.nb_jours} jour{c.nb_jours > 1 ? 's' : ''}, {String(c.start_time).slice(0, 5)} à {String(c.end_time).slice(0, 5)}{c.date_fin ? `, jusqu'au ${fmt(c.date_fin)}` : ''}{c.actif ? '' : ' · en pause'}</div>
                  </div>
                  {peutCreer && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => basculer(c)}>
                      {c.actif ? <><Pause className="w-4 h-4" />Mettre en pause</> : <><Play className="w-4 h-4" />Reprendre</>}
                    </button>
                  )}
                  {peutSupprimer && <button type="button" className="btn btn-ghost btn-icon" aria-label="Supprimer le créneau" onClick={() => supprimer(c)}><Trash2 className="w-4 h-4" /></button>}
                </div>
              </li>
            ))}
          </ul>
        )}

        {peutCreer && !form && <button type="button" className="btn btn-primary btn-sm" onClick={() => setForm(vide())}><Plus className="w-4 h-4" />Nouveau créneau</button>}

        {form && (
          <form onSubmit={enregistrer} className="space-y-3 border-t hairline pt-3">
            <div>
              <label className="label" htmlFor="cr-course">Formation *</label>
              <select id="cr-course" className="select" value={form.course_id} onChange={(e) => {
                const co = courses.find((x) => x.id === e.target.value)
                setForm({ ...form, course_id: e.target.value, nb_jours: co?.duration_days || form.nb_jours })
              }} required>
                <option value="">Choisir…</option>
                {courses.map((co) => <option key={co.id} value={co.id}>{co.title}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <label className="label" htmlFor="cr-freq">Rythme</label>
                <select id="cr-freq" className="select" value={form.frequence} onChange={(e) => f('frequence', e.target.value)}>
                  <option value="mensuel">Chaque mois</option>
                  <option value="hebdo">Chaque semaine</option>
                </select>
              </div>
              {form.frequence === 'mensuel' && (
                <div>
                  <label className="label" htmlFor="cr-rang">Le</label>
                  <select id="cr-rang" className="select" value={form.rang} onChange={(e) => f('rang', e.target.value)}>
                    {RANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="label" htmlFor="cr-jour">Jour</label>
                <select id="cr-jour" className="select" value={form.jour_semaine} onChange={(e) => f('jour_semaine', e.target.value)}>
                  {JOURS.map((j, i) => <option key={j} value={i + 1}>{j}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="cr-int">{form.frequence === 'mensuel' ? 'Tous les … mois' : 'Toutes les … semaines'}</label>
                <input id="cr-int" type="number" min="1" max="12" className="input" value={form.intervalle} onChange={(e) => f('intervalle', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div><label className="label" htmlFor="cr-nbj">Jours ouvrés</label><input id="cr-nbj" type="number" min="1" max="10" className="input" value={form.nb_jours} onChange={(e) => f('nb_jours', e.target.value)} /></div>
              <div><label className="label" htmlFor="cr-hd">Début</label><input id="cr-hd" type="time" className="input" value={form.start_time} onChange={(e) => f('start_time', e.target.value)} /></div>
              <div><label className="label" htmlFor="cr-hf">Fin</label><input id="cr-hf" type="time" className="input" value={form.end_time} onChange={(e) => f('end_time', e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div><label className="label" htmlFor="cr-lieu">Lieu</label><input id="cr-lieu" className="input" value={form.location_name} onChange={(e) => f('location_name', e.target.value)} /></div>
              <div><label className="label" htmlFor="cr-adr">Adresse</label><input id="cr-adr" className="input" value={form.location_address} onChange={(e) => f('location_address', e.target.value)} /></div>
              <div><label className="label" htmlFor="cr-cp">Code postal</label><input id="cr-cp" className="input" inputMode="numeric" value={form.location_postal_code} onChange={(e) => f('location_postal_code', e.target.value)} /></div>
              <div><label className="label" htmlFor="cr-ville">Ville</label><input id="cr-ville" className="input" value={form.location_city} onChange={(e) => f('location_city', e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="col-span-2">
                <label className="label" htmlFor="cr-form">Formateur</label>
                <select id="cr-form" className="select" value={form.trainer_id} onChange={(e) => f('trainer_id', e.target.value)}>
                  <option value="">À désigner</option>
                  {trainers.map((t) => <option key={t.id} value={t.id}>{t.first_name} {t.last_name}</option>)}
                </select>
              </div>
              <div><label className="label" htmlFor="cr-min">Minimum</label><input id="cr-min" type="number" min="1" className="input" placeholder="formation" value={form.min_participants} onChange={(e) => f('min_participants', e.target.value)} /></div>
              <div><label className="label" htmlFor="cr-max">Maximum</label><input id="cr-max" type="number" min="1" className="input" placeholder="formation" value={form.max_participants} onChange={(e) => f('max_participants', e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div><label className="label" htmlFor="cr-prix">Prix public HT / pers.</label><input id="cr-prix" type="number" min="0" step="0.01" className="input" value={form.public_price_per_person} onChange={(e) => f('public_price_per_person', e.target.value)} /></div>
              <div><label className="label" htmlFor="cr-du">À partir du</label><input id="cr-du" type="date" className="input" value={form.date_debut} onChange={(e) => f('date_debut', e.target.value)} required /></div>
              <div><label className="label" htmlFor="cr-au">Jusqu'au (facultatif)</label><input id="cr-au" type="date" className="input" value={form.date_fin} onChange={(e) => f('date_fin', e.target.value)} /></div>
            </div>
            <div className="text-ui-sm text-gray-700">
              <span className="font-medium">{libelleCreneau(form)} : </span>
              {apercu.length ? apercu.map(fmt).join(' · ') : 'aucune date dans la période'}{apercu.length === 6 ? '…' : ''}
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary" disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Créer le créneau et ses sessions</button>
              <button type="button" className="btn btn-secondary" onClick={() => setForm(null)}>Annuler</button>
            </div>
          </form>
        )}
      </div>
    </Sheet>
  )
}
