// Petits éléments d'interface du module Certification (sans couleur d'organisme en dur : classes du thème).

import { Link } from 'react-router-dom'
import { ChevronRight, Check } from 'lucide-react'
import { STATUS_LABEL } from '../lib/proofs'
import { daysUntil, frDate } from '../lib/certData'

export const STATUS_BADGE = {
  preuves: 'badge-success',
  a_completer: 'badge-warning',
  manquant: 'badge-danger',
  non_applicable: 'badge-neutral',
}

export function StatusBadge({ status, children }) {
  return <span className={`badge ${STATUS_BADGE[status] || 'badge-neutral'}`}>{children || STATUS_LABEL[status] || status}</span>
}

// Pastille numérotée d'un indicateur (vue d'ensemble des 33)
export function IndicatorTile({ ind, active, onClick }) {
  const cls = {
    preuves: 'bg-[rgb(var(--c-success))] text-white border-[rgb(var(--c-success)/0.3)]',
    a_completer: 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))] border-[rgb(var(--c-warning)/0.3)]',
    manquant: 'bg-accent-500 text-accent-fg border-accent-500',
    non_applicable: 'bg-white text-gray-400 border-gray-300 border-dashed',
  }[ind.status] || 'bg-white text-gray-700 border-gray-300'
  return (
    <button type="button" onClick={onClick} title={`Indicateur ${ind.number} : ${STATUS_LABEL[ind.status]}`}
      aria-label={`Indicateur ${ind.number}, ${STATUS_LABEL[ind.status]}`}
      className={`w-9 h-9 rounded-ui-sm border text-ui-sm font-semibold flex items-center justify-center ${cls} ${active ? 'ring-2 ring-offset-1 ring-gray-900' : ''}`}>
      {ind.number}
    </button>
  )
}

export function DueBadge({ date }) {
  if (!date) return <span className="badge badge-neutral">À faire</span>
  const n = daysUntil(date)
  if (n < 0) return <span className="badge badge-danger">Dépassé</span>
  if (n <= 30) return <span className="badge badge-danger">Dans {n} j</span>
  if (n <= 90) return <span className="badge badge-warning">Dans {n} j</span>
  return <span className="badge badge-neutral">{frDate(date, { month: 'short', year: 'numeric' })}</span>
}

export function Step({ done, current, title, children, aside }) {
  return (
    <div className="flex gap-3 items-start">
      <span className={`mt-0.5 w-5 h-5 rounded-full flex-none flex items-center justify-center ${done ? 'bg-[rgb(var(--c-success))]' : current ? 'border-2 border-[rgb(var(--c-warning)/0.3)] bg-white' : 'border-2 border-gray-300 bg-white'}`}>
        {done && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
      </span>
      <div className="flex-1 min-w-0">
        <div className={`font-semibold text-ui ${done || current ? 'text-gray-900' : 'text-gray-500'}`}>{title}</div>
        <div className="text-ui-sm text-gray-500 space-y-1">{children}</div>
      </div>
      {aside && <div className="flex-none">{aside}</div>}
    </div>
  )
}

export function RowLink({ to, title, detail, aside }) {
  return (
    <Link to={to} className="flex items-center gap-3 min-h-[56px] px-4 py-2 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 text-gray-900 no-underline">
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-ui">{title}</div>
        {detail && <div className="text-ui-sm text-gray-500">{detail}</div>}
      </div>
      {aside}
      <ChevronRight className="w-4 h-4 text-gray-400 flex-none" />
    </Link>
  )
}

export function Progress({ value, tone = 'accent' }) {
  const v = Math.max(0, Math.min(100, Math.round(value || 0)))
  return (
    <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full ${tone === 'green' ? 'bg-[rgb(var(--c-success))]' : 'bg-accent-500'}`} style={{ width: `${v}%` }} />
    </div>
  )
}

export function DateField({ label, value, onChange, disabled, hint }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input type="date" className="input" value={value || ''} disabled={disabled} onChange={(e) => onChange(e.target.value || null)} />
      {hint && <span className="block text-ui-sm text-gray-500 mt-1">{hint}</span>}
    </label>
  )
}
