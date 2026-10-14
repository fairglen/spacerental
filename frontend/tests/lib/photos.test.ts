import { describe, it, expect, afterEach } from 'vitest'
import { PHOTO_MESSAGES, photoFileProblem, photoUploadErrorMessage } from '@/lib/photos'
import { resetLocaleForTests, setLocale } from '@/lib/i18n'

afterEach(() => resetLocaleForTests())

// The limits mirror backend/app/media.py; the messages follow the UI locale (B65).
describe('photo upload messages', () => {
  const file = (type: string, size: number) => ({ type, size }) as File

  it('judge the file by type, then size, in Portuguese by default', () => {
    expect(photoFileProblem(file('image/gif', 10))).toBe('Formato não suportado. Use JPEG, PNG ou WebP.')
    expect(photoFileProblem(file('image/png', 9 * 1024 * 1024))).toBe('A imagem tem mais de 8 MB.')
    expect(photoFileProblem(file('image/webp', 10))).toBeNull()
    expect(photoUploadErrorMessage(409)).toBe(PHOTO_MESSAGES.limit)
    expect(photoUploadErrorMessage(409)).toBe('Já tem o máximo de 10 fotografias. Apague uma primeiro.')
    expect(photoUploadErrorMessage(429)).toBe('Demasiados envios seguidos. Aguarde um momento e tente de novo.')
    expect(photoUploadErrorMessage(undefined)).toBe('Não foi possível enviar a fotografia. Tente novamente.')
  })

  it('are read in the locale of the moment they are shown', () => {
    setLocale('en')
    expect(photoFileProblem(file('image/gif', 10))).toBe('Unsupported format. Use JPEG, PNG or WebP.')
    expect(photoUploadErrorMessage(413)).toBe('The image is larger than 8 MB.')
    expect(PHOTO_MESSAGES.limit).toBe('You already have the maximum of 10 photos. Delete one first.')
    expect(photoUploadErrorMessage(429)).toBe('Too many uploads in a row. Wait a moment and try again.')
    expect(photoUploadErrorMessage(500)).toBe('Could not upload the photo. Please try again.')
  })
})
