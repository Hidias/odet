// Fichier d'agenda (.ics) d'une session, à ajouter au calendrier du client ou du stagiaire (0437, 22/10).
// Heures de Paris ; une session sur plusieurs jours donne un événement par jour, aux mêmes horaires.

const pad = (n) => String(n).padStart(2, '0')
const echapper = (t) => String(t || '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const heure = (h, defaut) => String(h || defaut).slice(0, 5).replace(':', '') + '00'

function jours(debut, fin) {
  const out = []
  const d = new Date(`${debut}T12:00:00`)
  const f = new Date(`${fin || debut}T12:00:00`)
  for (let i = 0; i < 60 && d <= f; i++) {
    out.push(`${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`)
    d.setDate(d.getDate() + 1)
  }
  return out
}

/** s : { id, reference, start_date, end_date, start_time, end_time, courses.title, lieu, organisme } */
export function contenuIcs(s, { lieu = '', organisme = '', maintenant = new Date() } = {}) {
  const stamp = maintenant.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const lignes = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//odet//formation//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH']
  jours(s.start_date, s.end_date).forEach((j, i) => {
    lignes.push('BEGIN:VEVENT',
      `UID:${s.id || s.reference}-${j}@odet`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Europe/Paris:${j}T${heure(s.start_time, '09:00')}`,
      `DTEND;TZID=Europe/Paris:${j}T${heure(s.end_time, '17:00')}`,
      `SUMMARY:${echapper(`Formation : ${s.courses?.title || 'formation'}`)}`,
      ...(lieu ? [`LOCATION:${echapper(lieu)}`] : []),
      `DESCRIPTION:${echapper([organisme ? `Organisme : ${organisme}` : '', s.reference ? `Session ${s.reference}` : '', s.courses?.material ? `À prévoir : ${s.courses.material}` : ''].filter(Boolean).join('\n'))}`,
      ...(i === 0 ? ['BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', `DESCRIPTION:${echapper('Formation demain')}`, 'END:VALARM'] : []),
      'END:VEVENT')
  })
  lignes.push('END:VCALENDAR')
  return lignes.join('\r\n')
}

export function telechargerIcs(s, opts) {
  const url = URL.createObjectURL(new Blob([contenuIcs(s, opts)], { type: 'text/calendar;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url; a.download = `Formation_${s.reference || 'session'}.ics`
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
