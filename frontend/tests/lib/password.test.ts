import { describe, expect, it } from 'vitest'
import {
  PASSWORD_EMAIL_MESSAGE,
  PASSWORD_LENGTH_MESSAGE,
  PASSWORD_PRODUCT_MESSAGE,
  passwordProblems,
  passwordReasonsOf,
} from '@/lib/password'

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
