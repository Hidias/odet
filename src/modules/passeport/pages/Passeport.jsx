// Module Passeport de prévention : en bref, à déclarer, à corriger, fichiers et accusés, réglages des formations.
// Module activable (org_modules, clé « passeport »). Désactivé : entrée masquée et page « module désactivé ».

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Routes, Route, NavLink, Navigate, Link } from 'react-router-dom'
import { Loader2, BookUser } from 'lucide-react'
import { useAuthStore } from '../../../core/store'
import { loadFormat, loadSettings, loadDonnees, loadFichiers, loadCourses, loadPresets, PP_ROLES, apiPasseport } from '../lib/ppData'
import { Banner, Button } from '../../../ui'
import { statutInscription, dateLimite, obligatoire, couleurDelai, isoDate, daysBetween } from '../lib/rules'
import PpBref from './PpBref'
import PpADeclarer from './PpADeclarer'
import PpACorriger from './PpACorriger'
import PpFichiers from './PpFichiers'
import PpReglages from './PpReglages'

export default function Passeport() {
  const { modules, userRole } = useAuthStore()
  const enabled = (modules || []).includes('passeport')
  const allowed = PP_ROLES.includes(userRole)
  const [format, setFormat] = useState(null)
  const [settings, setSettings] = useState({})
  const [donnees, setDonnees] = useState([])
  const [fichiers, setFichiers] = useState([])
  const [courses, setCourses] = useState([])
  const [presets, setPresets] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  // Numéros saisis par l'ancien chemin, à reprendre dans le Passeport (source unique, décision du 17/10)
  const [ancien, setAncien] = useState(0)
  const [reprise, setReprise] = useState({ busy: false, message: null })

  const reload = useCallback(async () => {
    try {
      const [f, s, d, fi, c, p] = await Promise.all([loadFormat(), loadSettings(), loadDonnees(), loadFichiers(), loadCourses(), loadPresets()])
      setFormat(f); setSettings(s); setDonnees(d); setFichiers(fi); setCourses(c); setPresets(p)
      setError(null)
    } catch (e) { setError(e.message || String(e)) }
    setLoading(false)
  }, [])

  useEffect(() => { if (enabled && allowed) reload() }, [enabled, allowed, reload])
  useEffect(() => {
    if (!enabled || !allowed) return
    // Reprise automatique à l'ouverture (22/10) : seuls les numéros illisibles restent à vérifier
    apiPasseport('reprise-ancien').then((r) => { setAncien(r?.en_attente || 0); if (r?.repris) reload() }).catch(() => setAncien(0))
  }, [enabled, allowed, reload])

  const reprendre = async () => {
    setReprise({ busy: true, message: null })
    try {
      const r = await apiPasseport('reprise-ancien')
      setAncien(r?.en_attente || 0)
      setReprise({ busy: false, message: `${r?.repris || 0} numéro(s) repris dans le Passeport${r?.invalides ? `, ${r.invalides} à vérifier sur la fiche du stagiaire` : ''}.` })
      reload()
    } catch (e) {
      setReprise({ busy: false, message: `Reprise impossible : ${e.message || e}` })
    }
  }

  const today = isoDate(new Date())

  // Inscriptions enrichies : statut, blocages, date limite
  const inscriptions = useMemo(() => {
    if (!format) return []
    const fichiersNonDeposes = new Set(fichiers.filter((f) => f.marque_non_depose).map((f) => f.id))
    return donnees.map((row) => {
      const s = settings[row.course_id]
      const st = statutInscription(row, s, format.contrat)
      const reprise = st.statut === 'genere' && row.dernier_envoi && fichiersNonDeposes.has(row.dernier_envoi.fichier_id)
      const limite = dateLimite(row.end_date, format.regles)
      const oblig = s?.declarable ? obligatoire(s.categorie, row.start_date, format.regles) : false
      return {
        ...row, settings: s, ...st, reprise,
        statutAffiche: reprise ? 'a_declarer' : st.statut,
        limite, obligatoire: oblig,
        couleur: couleurDelai(limite?.date, today, format.regles, oblig),
      }
    })
  }, [donnees, settings, format, fichiers, today])

  // Sessions avec au moins une inscription encore à déclarer ou à corriger
  const sessions = useMemo(() => {
    const map = new Map()
    for (const i of inscriptions) {
      if (!i.settings?.declarable) continue
      if (!map.has(i.session_id)) {
        map.set(i.session_id, {
          session_id: i.session_id, reference: i.reference, course_title: i.course_title, course_id: i.course_id,
          client_name: i.client_name, client_id: i.client_id, start_date: i.start_date, end_date: i.end_date,
          type: i.settings?.type_decl, categorie: i.settings?.categorie, limite: i.limite, obligatoire: i.obligatoire, couleur: i.couleur,
          inscriptions: [],
        })
      }
      map.get(i.session_id).inscriptions.push(i)
    }
    return [...map.values()].map((s) => {
      const c = { prets: 0, bloques: 0, declares: 0, rejetes: 0, attente: 0, non: 0 }
      for (const i of s.inscriptions) {
        if (i.statutAffiche === 'declare') c.declares++
        else if (i.statutAffiche === 'rejete') c.rejetes++
        else if (i.statutAffiche === 'genere') c.attente++
        else if (i.statutAffiche === 'non_declarable') c.non++
        else if (i.bloquants.length) c.bloques++
        else c.prets++
      }
      return { ...s, ...c, aFaire: c.prets + c.bloques > 0 }
    }).sort((a, b) => (a.limite?.date || '').localeCompare(b.limite?.date || '') || a.reference.localeCompare(b.reference))
  }, [inscriptions])

  const alerteJours = format?.regles?.alerte_sans_accuse_jours ?? 15
  const fichiersSansAccuse = fichiers.filter((f) => !f.accuse_id && !f.marque_non_depose && daysBetween(isoDate(f.genere_le), today) >= alerteJours)
  const aCorriger = inscriptions.filter((i) => i.statutAffiche === 'rejete')

  if (!enabled) {
    return (
      <div className="card text-center space-y-2 max-w-lg mx-auto mt-8">
        <BookUser className="w-8 h-8 text-gray-400 mx-auto" />
        <p className="font-semibold">Module « Passeport de prévention » désactivé</p>
        <p className="muted text-ui-sm">Le support peut l'activer sur demande.</p>
        <Link to="/" className="btn btn-secondary">Retour au tableau de bord</Link>
      </div>
    )
  }
  if (!allowed) return <div className="card">Ce module est réservé à la direction et à la gestion.</div>
  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
  if (error) return <div className="card text-[rgb(var(--c-danger))]">Impossible de charger le Passeport de prévention : {error}</div>

  const aDeclarer = sessions.filter((s) => s.aFaire)
  const ctx = {
    format, settings, setSettings, inscriptions, sessions, fichiers, courses, presets, reload, today,
    fichiersSansAccuse, aCorriger, aDeclarer,
  }
  const TABS = [
    { to: '', label: 'En bref', end: true },
    { to: 'a-declarer', label: 'À déclarer', count: aDeclarer.length, tone: 'badge-danger' },
    { to: 'a-corriger', label: 'À corriger', count: aCorriger.length, tone: aCorriger.length ? 'badge-danger' : 'badge-neutral' },
    { to: 'fichiers', label: 'Fichiers et accusés', count: fichiersSansAccuse.length || null, tone: 'badge-warning' },
    { to: 'reglages', label: 'Réglages' },
  ]

  return (
    <div className="space-y-4">
      <div>
        <div className="muted text-ui-sm">Formation</div>
        <h1 className="page-title">Passeport de prévention</h1>
      </div>
      {ancien > 0 && (
        <Banner tone="warning" title={`${ancien} numéro(s) de sécurité sociale illisible(s) à vérifier`}
          action={<Button size="sm" variant="secondary" loading={reprise.busy} onClick={reprendre}>Réessayer</Button>}>
          Saisis hors du Passeport et refusés à la reprise (format ou clé) : à ressaisir sur la fiche du stagiaire. Les autres numéros passent ici automatiquement.
        </Banner>
      )}
      {reprise.message && <Banner tone="info" onClose={() => setReprise({ busy: false, message: null })}>{reprise.message}</Banner>}
      <nav className="tabs" aria-label="Rubriques du Passeport de prévention">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `tab ${isActive ? 'tab-active' : ''}`}>
            {t.label}{t.count ? <span className={`badge ${t.tone} ml-1.5`}>{t.count}</span> : null}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<PpBref {...ctx} />} />
        <Route path="a-declarer" element={<PpADeclarer {...ctx} />} />
        <Route path="a-corriger" element={<PpACorriger {...ctx} />} />
        <Route path="fichiers" element={<PpFichiers {...ctx} />} />
        <Route path="reglages" element={<PpReglages {...ctx} />} />
        <Route path="reglages/:courseId" element={<PpReglages {...ctx} />} />
        <Route path="*" element={<Navigate to="" replace />} />
      </Routes>
    </div>
  )
}
