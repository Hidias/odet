// Circuit premium (0437) : sessions d'un devis, fiche complète, contrôle de la confirmation, agenda
import { describe, it, expect } from 'vitest'
import { sessionsDuDevis, manquesFiche, erreursConfirmation } from '../src/modules/formation/components/CircuitSession'
import { contenuIcs } from '../src/core/fichiers/agenda'
import { texteRelance } from '../api/relances-circuit'

describe('sessions prévues par le devis', () => {
  it('lit le nombre en chiffres ou en lettres', () => {
    expect(sessionsDuDevis(['En intra, 2 sessions de 2 heures, 10 personnes maximum par session'])).toBe(2)
    expect(sessionsDuDevis(['Formation en deux groupes'])).toBe(2)
    expect(sessionsDuDevis(['Formation SST', null])).toBe(1)
  })
})

describe('fiche du stagiaire', () => {
  it('liste ce qui manque', () => {
    expect(manquesFiche({})).toEqual(['genre', 'date de naissance', 'e-mail', 'n° de sécurité sociale', 'poste'])
    expect(manquesFiche({ gender: 'female', birth_date: '1985-05-02', email_refused: true, refused_ssn: true, job_title: 'Cariste' })).toEqual([])
  })
})

describe('confirmation de la session', () => {
  it('exige date et horaires cohérents', () => {
    expect(erreursConfirmation({ start_date: '', start_time: '14:00', end_time: '16:00' })).toContain('date')
    expect(erreursConfirmation({ start_date: '2026-11-25', start_time: '16:00', end_time: '14:00' })).toContain('heure de fin avant le début')
    expect(erreursConfirmation({ start_date: '2026-11-25', start_time: '14:00', end_time: '16:00' })).toEqual([])
  })
})

describe('agenda', () => {
  it('un événement par jour, aux horaires de Paris', () => {
    const ics = contenuIcs({ id: 's1', reference: 'SES-1', start_date: '2026-11-25', end_date: '2026-11-26', start_time: '14:00:00', end_time: '16:00:00', courses: { title: 'Initiation, gestes' } }, { lieu: 'Lycée, Rennes' })
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    expect(ics).toContain('DTSTART;TZID=Europe/Paris:20261125T140000')
    expect(ics).toContain('DTEND;TZID=Europe/Paris:20261126T160000')
    expect(ics).toContain('LOCATION:Lycée\\, Rennes')
  })
})

describe('relances', () => {
  it('textes sans lien, avec la date', () => {
    const t = texteRelance({ kind: 'convention', course: 'Initiation', start_date: '2026-11-25', start_time: '14:00:00', contact_name: 'Ségolène' }, 'GLD')
    expect(t.sujet).toMatch(/Convention à signer/)
    expect(t.corps).toMatch(/Bonjour Ségolène/)
    expect(t.corps).toMatch(/14h00/)
    expect(t.corps).not.toMatch(/https?:/)
  })
})
