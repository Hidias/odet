// Heure de fin proposée selon la durée de la formation (même règle que 0498, A11 du 07/11)
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { finConseillee, finApresDebut } from '../src/modules/formation/lib/horaires'

describe('fin conseillée', () => {
  it('moins de 6 heures sur un jour : début + durée', () => {
    expect(finConseillee('09:00', 4, 1)).toBe('13:00')
    expect(finConseillee('09:00', 2)).toBe('11:00')
    expect(finConseillee('13:30', 3.5, 1)).toBe('17:00')
    expect(finConseillee('14:00', 2, 1)).toBe('16:00')
  })
  it('6 heures et plus, plusieurs jours, durée inconnue ou heure illisible : 17 h', () => {
    expect(finConseillee('09:00', 7, 1)).toBe('17:00')
    expect(finConseillee('09:00', 14, 2)).toBe('17:00')
    expect(finConseillee('09:00', 4, 2)).toBe('17:00')
    expect(finConseillee('09:00', null, 1)).toBe('17:00')
    expect(finConseillee('', 4, 1)).toBe('17:00')
    expect(finConseillee('22:00', 4, 1)).toBe('17:00')
  })
  it('nouvelle session et créneau récurrent proposent la fin au choix de la formation', () => {
    expect(readFileSync('src/modules/formation/pages/Sessions.jsx', 'utf8')).toContain('finConseillee(formData.start_time, co.duration_hours, co.duration_days)')
    expect(readFileSync('src/modules/formation/components/CreneauxRecurrents.jsx', 'utf8')).toContain('finConseillee(form.start_time, co.duration_hours, nbJours)')
  })
  it('début changé : la fin proposée suit, une fin saisie à la main reste', () => {
    expect(finApresDebut('09:00', '13:00', '13:00', 4, 1)).toBe('17:00')
    expect(finApresDebut('09:00', '13:00', '12:30', 4, 1)).toBe('12:30')
    expect(finApresDebut('09:00', '08:00', '17:00', 7, 1)).toBe('17:00')
    expect(finApresDebut('09:00', '10:00', '11:00', 2, 1)).toBe('12:00')
  })
})
