import { afterEach, describe, expect, it } from 'vitest'
import {
  PASSWORD_EMAIL_MESSAGE,
  PASSWORD_HINT,
  PASSWORD_LENGTH_MESSAGE,
  PASSWORD_PRODUCT_MESSAGE,
  passwordHint,
  passwordProblems,
  passwordReasonsOf,
} from '@/lib/password'
import { resetLocaleForTests, setLocale, tFor } from '@/lib/i18n'

// B66: the browser-side mirror of app/passwords.py — length and the address's
// local part; the breached list stays on the server.
describe('passwordProblems', () => {
  it('accepts a long enough phrase that is not the email', () => {
    expect(passwordProblems('uma frase bem comprida', 'ana.silva@example.pt')).toEqual([])
  })

  it('refuses fewer than 10 characters and more than 128', () => {
    expect(passwordProblems('curta1234', 'a@b.pt')).toEqual([PASSWORD_LENGTH_MESSAGE])
    expect(passwordProblems('x'.repeat(129), 'a@b.pt')).toEqual([PASSWORD_LENGTH_MESSAGE])
    expect(passwordProblems('x'.repeat(10), 'a@b.pt')).toEqual([])
    expect(passwordProblems('x'.repeat(128), 'a@b.pt')).toEqual([])
  })

  it('refuses the local part of the email, whatever the case, once it is 4+ characters', () => {
    expect(passwordProblems('Ana.Silva-2026!', 'ana.silva@example.pt')).toEqual([PASSWORD_EMAIL_MESSAGE])
    expect(passwordProblems('abc-is-fine-here', 'abc@example.pt')).toEqual([])
  })

  it('refuses the product name and reports every reason at once', () => {
    expect(passwordProblems('flowspace', 'ana@example.pt')).toEqual([PASSWORD_LENGTH_MESSAGE, PASSWORD_PRODUCT_MESSAGE])
  })
})

describe('password messages in English (B65)', () => {
  afterEach(() => resetLocaleForTests())

  it('follow the browser locale by default, or the locale the caller binds', () => {
    setLocale('en')
    expect(passwordProblems('flowspace', 'ana@example.pt')).toEqual([
      'The password must be between 10 and 128 characters.',
      'The password cannot contain "flowspace".',
    ])
    expect(passwordProblems('Ana.Silva-2026!', 'ana.silva@example.pt')).toEqual([
      'The password cannot contain the part of your email before the @.',
    ])
    expect(passwordHint()).toBe('Between 10 and 128 characters; a phrase only you know. Common passwords and the part of your email before the @ are refused.')
    expect(passwordProblems('curta1234', 'a@b.pt', tFor('pt'))).toEqual([PASSWORD_LENGTH_MESSAGE])
  })

  it('keep the Portuguese constants the admin forms read, whatever the locale', () => {
    setLocale('en')
    expect(PASSWORD_HINT).toBe('Entre 10 e 128 caracteres; uma frase que só a sua pessoa conhece. Passwords comuns e a parte do seu email antes do @ são recusadas.')
    expect(PASSWORD_LENGTH_MESSAGE).toBe('A password tem de ter entre 10 e 128 caracteres.')
    expect(PASSWORD_PRODUCT_MESSAGE).toBe('A password não pode conter "flowspace".')
  })
})

describe('passwordReasonsOf', () => {
  const axiosLike = (data: unknown) => ({ response: { status: 422, data } })

  it('returns the list a password route answers with', () => {
    expect(passwordReasonsOf(axiosLike({ detail: ['a', 'b'] }))).toEqual(['a', 'b'])
  })

  it('is undefined for a string detail, a validation-error list or a network failure', () => {
    expect(passwordReasonsOf(axiosLike({ detail: 'Este email já está registado.' }))).toBeUndefined()
    expect(passwordReasonsOf(axiosLike({ detail: [{ msg: 'field required' }] }))).toBeUndefined()
    expect(passwordReasonsOf(new Error('network'))).toBeUndefined()
  })
})
