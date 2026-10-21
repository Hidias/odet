import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import jsPDF from 'jspdf'
import { Printer, Unlock } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { orgName } from '../../../core/org/currentOrg'
import { publicBaseUrl } from '../../../core/org/orgUtils'

// Codes du portail stagiaire (0423) : le stagiaire entre avec son code personnel, aucune liste de noms n'est montrée.
// Le code figure sur la convocation ; pour ceux qui ne l'ont pas, le formateur imprime des coupons individuels
// (un par stagiaire, à découper et remettre en main propre). Après trop de codes faux, le portail de la session se
// bloque 30 minutes : l'équipe peut le débloquer ici.

export function couponsCodes({ titre, dates, lien, organisme, stagiaires }) {
  const doc = new jsPDF({ compress: true })
  const pw = doc.internal.pageSize.getWidth()
  const ph = doc.internal.pageSize.getHeight()
  const M = 10
  const colW = (pw - M * 2) / 2
  const rowH = (ph - M * 2) / 5
  stagiaires.forEach((s, i) => {
    const k = i % 10
    if (i > 0 && k === 0) doc.addPage()
    const x = M + (k % 2) * colW
    const y = M + Math.floor(k / 2) * rowH
    doc.setDrawColor(180); doc.setLineDashPattern([1.5, 1.5], 0); doc.rect(x, y, colW, rowH); doc.setLineDashPattern([], 0)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(110)
    doc.text((organisme || '').toUpperCase(), x + 5, y + 7)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(40)
    doc.text(doc.splitTextToSize(titre || '', colW - 10).slice(0, 2), x + 5, y + 13)
    doc.setFontSize(8); doc.setTextColor(110); doc.text(dates || '', x + 5, y + 22)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(20)
    doc.text(`${s.first_name || ''} ${(s.last_name || '').toUpperCase()}`.trim(), x + 5, y + 30)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(110); doc.text('Votre code personnel', x + 5, y + 37)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(20)
    doc.text(String(s.code || '').split('').join(' '), x + 5, y + 46)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(110)
    doc.text(doc.splitTextToSize(lien ? `Portail : ${lien}` : 'Portail : QR code affiché en salle', colW - 10).slice(0, 2), x + 5, y + rowH - 6)
  })
  return doc
}

export default function CodesPortail({ session, stagiaires, codes, peutModifier }) {
  const [bloque, setBloque] = useState(null)

  useEffect(() => {
    if (!session?.id) return
    supabase.from('sessions').select('portail_bloque_jusqua').eq('id', session.id).maybeSingle()
      .then(({ data, error }) => setBloque(!error && data?.portail_bloque_jusqua && new Date(data.portail_bloque_jusqua) > new Date() ? data.portail_bloque_jusqua : null))
  }, [session?.id])

  const imprimer = () => {
    const liste = (stagiaires || []).map((t) => ({ first_name: t.first_name, last_name: t.last_name, code: codes?.[t.id]?.code })).filter((t) => t.code)
    if (!liste.length) return toast.error('Aucun code à imprimer')
    const d1 = session.start_date ? new Date(`${session.start_date}T12:00:00`).toLocaleDateString('fr-FR') : ''
    const d2 = session.end_date && session.end_date !== session.start_date ? ` au ${new Date(`${session.end_date}T12:00:00`).toLocaleDateString('fr-FR')}` : ''
    const doc = couponsCodes({
      titre: session.courses?.title, dates: d1 ? `${d2 ? 'Du' : 'Le'} ${d1}${d2}` : '', organisme: orgName(),
      lien: session.attendance_token ? `${publicBaseUrl()}/#/portail/${session.attendance_token}` : '', stagiaires: liste,
    })
    doc.save(`Codes_portail_${session.reference || ''}.pdf`)
  }
  const debloquer = async () => {
    const { error } = await supabase.rpc('portail_debloquer', { p_session: session.id })
    if (error) return toast.error(error.message)
    setBloque(null)
    toast.success('Portail débloqué')
  }

  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      <button type="button" className="btn btn-secondary btn-sm" onClick={imprimer}><Printer className="w-4 h-4" />Imprimer les codes d'accès (un par stagiaire)</button>
      <span className="text-ui-sm text-gray-500">Chaque stagiaire entre avec son code (aussi sur sa convocation) : aucun nom n'est affiché sur le portail.</span>
      {bloque && (
        <span className="flex items-center gap-2 text-ui-sm text-[rgb(var(--c-danger))]">
          Portail bloqué jusqu'à {new Date(bloque).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} (trop de codes faux)
          {peutModifier && <button type="button" className="btn btn-secondary btn-sm" onClick={debloquer}><Unlock className="w-4 h-4" />Débloquer</button>}
        </span>
      )}
    </div>
  )
}
