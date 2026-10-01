import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { test, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test'
import { ADMIN_STORAGE_STATE } from './global-setup'

/**
 * Part A2 (G05/G06) as the seeded owner: the room lifecycle on the new pages,
 * a price correction that reaches the customer, a customer's whole access
 * story, a purchase adjustment refused inline, anonymisation, and the
 * settings page as a non-owner.
 */
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:8000/api/v1'
const API_ROOT = API_URL.replace(/\/api\/v1\/?$/, '')

test.use({ storageState: ADMIN_STORAGE_STATE, viewport: { width: 1400, height: 1000 } })

let api: APIRequestContext
let auth: { Authorization: string }
let org: string
let space: { id: string; name: string }
let me: { id: string; email: string }

test.beforeAll(async () => {
  api = await playwrightRequest.newContext()
  const login = await api.post(`${API_URL}/auth/login`, { data: { email: 'admin@demo.com', password: 'admin123' } })
  expect(login.ok(), await login.text()).toBeTruthy()
  auth = { Authorization: `Bearer ${(await login.json()).access_token}` }
  const { spaces } = await (await api.get(`${API_URL}/spaces`)).json()
  space = spaces[0]
  const detail = await (await api.get(`${API_URL}/spaces/${space.id}`)).json()
  org = detail.rooms[0].org_id
  me = await (await api.get(`${API_URL}/auth/me`, { headers: auth })).json()
})

test.afterAll(async () => {
  await api.dispose()
  // This file spends most of the auth tier's minute (logins, a reset, a
  // set-password); the next file starts with a fresh window.
  await delay(61_000)
})

function futureSlot(daysAhead: number, hour: number) {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + daysAhead); while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1)
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour))
  return { start_time: start.toISOString(), end_time: new Date(start.getTime() + 3.6e6).toISOString() }
}

/** A manual booking on the first free hour of that day: earlier runs may hold some. */
async function manualBooking(userId: string, roomId: string, daysAhead: number, hour: number) {
  let made
  for (const h of [hour, hour + 1, hour + 2, hour + 3, hour - 1, hour - 2]) {
    made = await api.post(`${API_URL}/admin/bookings`, { headers: auth, params: { org_id: org }, data: { user_id: userId, room_id: roomId, ...futureSlot(daysAhead, h) } })
    if (made.ok()) break
  }
  expect(made!.ok(), await made!.text()).toBeTruthy()
  return (await made!.json()).booking as { id: string; total_amount: string }
}

/** Sign in through NextAuth's credentials callback (as global-setup does), so
 * a refusal is read from the session and not from a form's hydration timing. */
async function sessionFor(baseURL: string, email: string, password: string): Promise<boolean> {
  const ctx = await playwrightRequest.newContext({ baseURL })
  try {
    const { csrfToken } = await (await ctx.get('/api/auth/csrf')).json()
    await ctx.post('/api/auth/callback/credentials', { form: { csrfToken, email, password, callbackUrl: new URL('/dashboard', baseURL).href, json: 'true' } })
    const session = await (await ctx.get('/api/auth/session')).json()
    return session?.user?.email === email
  } finally {
    await ctx.dispose()
  }
}

async function resetLinkFor(email: string): Promise<string> {
  const mailbox = await (await api.get(`${API_ROOT}/__test__/emails`)).json()
  const mine = [...mailbox.emails].reverse().find((m: { to: string }) => m.to === email)
  expect(mine, `an email for ${email} in the stub mailbox`).toBeTruthy()
  const link = mine.links.find((l: string) => l.includes('/reset-password/'))
  expect(link).toBeTruthy()
  return link
}

test('room: create → duplicate → edit hours → block an hour → deactivate refused with a future booking, then done', async ({ page }) => {
  const name = `Sala E2E ${randomUUID().slice(0, 4)}`
  await page.goto(`/admin/spaces/${space.id}`)
  await expect(page.getByRole('heading', { level: 1 })).toContainText(space.name)
  await page.getByRole('button', { name: 'Nova sala' }).click()
  const form = page.getByRole('form', { name: 'Nova sala' })
  await form.getByLabel('Nome').fill(name)
  await form.getByLabel('€/hora').fill('12')
  await form.getByRole('button', { name: 'Criar sala' }).click()
  const card = page.getByTestId('admin-room-card').filter({ hasText: name })
  await expect(card).toBeVisible({ timeout: 10000 })

  // Open the room, duplicate it: the copy's page opens.
  await card.getByRole('link', { name }).click()
  await page.waitForURL(/\/admin\/rooms\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name)
  const roomId = page.url().split('/').pop()!
  await page.getByRole('button', { name: 'Duplicar' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`${name} (cópia)`, { timeout: 10000 })
  const copyId = page.url().split('/').pop()!
  expect(copyId).not.toBe(roomId)

  // Hours: a fresh room has none. Open Sunday 09–18, save, then copy Sunday
  // to every day; the API ends with seven windows.
  await page.getByLabel('Domingo aberto').check()
  await page.getByRole('button', { name: 'Guardar horário' }).click()
  await expect(page.getByText('Horário guardado.').first()).toBeVisible()
  await page.getByRole('button', { name: 'Copiar Domingo para todos os dias' }).click()
  await expect(page.getByText('Horário copiado para todos os dias.').first()).toBeVisible()
  const rules = await (await api.get(`${API_URL}/admin/rooms/${copyId}/availability`, { headers: auth, params: { org_id: org } })).json()
  expect(rules.rules.map((r: { day_of_week: number }) => r.day_of_week).sort()).toEqual([0, 1, 2, 3, 4, 5, 6])

  // Block an hour a week out; it shows in the list and the API has it.
  const slot = futureSlot(7, 9)
  const local = (iso: string) => { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}` }
  await page.getByLabel('Início').fill(local(slot.start_time))
  await page.getByLabel('Fim').fill(local(slot.end_time))
  await page.getByLabel('Motivo').fill('Manutenção E2E')
  await page.getByRole('button', { name: 'Bloquear' }).click()
  await expect(page.getByText('Manutenção E2E')).toBeVisible({ timeout: 10000 })

  // A future booking refuses the deactivation and is listed; cancelled, it goes through.
  const booking = await manualBooking(me.id, copyId, 10, 11)
  await page.getByRole('button', { name: 'Desativar' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Ainda há' })).toContainText('Ainda há 1 reserva(s)')
  await api.put(`${API_URL}/admin/bookings/${booking.id}`, { headers: auth, params: { org_id: org }, data: { status: 'cancelled' } })
  await page.getByRole('button', { name: 'Desativar' }).click()
  await expect(page.getByRole('heading', { level: 1 }).getByText('Inativa')).toBeVisible({ timeout: 10000 })

  // Leave the seeded space as found: the original (no bookings, no blocks)
  // is hard-deleted; the copy is inactive and therefore off the public
  // detail, which the other specs read their "last room" from.
  const gone = await api.delete(`${API_URL}/admin/rooms/${roomId}`, { headers: auth, params: { org_id: org, confirm: name } })
  expect(gone.status(), await gone.text()).toBe(204)
})

test('booking: correct the amount with a reason → history diff → the customer sees the new amount', async ({ page }) => {
  const { rooms } = await (await api.get(`${API_URL}/spaces/${space.id}`)).json()
  // A paid hourly booking (the dashboard prices those; a manual one reads "Pago no local").
  let created
  for (const h of [15, 16, 17, 14, 13]) {
    created = await api.post(`${API_URL}/bookings`, { headers: auth, data: { room_id: rooms[0].id, ...futureSlot(12, h), payment_method: 'hourly' } })
    if (created.ok()) break
  }
  expect(created!.ok(), await created!.text()).toBeTruthy()
  const { booking, checkout_url } = await created!.json()
  const sessionId = new URL(checkout_url).pathname.split('/').pop()
  expect((await api.post(`${API_ROOT}/checkout/stub/${sessionId}/pay`, { maxRedirects: 0 })).status()).toBe(303)
  await page.goto(`/admin/bookings/${booking.id}`)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Reserva #')
  await page.getByRole('button', { name: 'Corrigir valor' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Novo valor (€)').fill('9')
  await dialog.getByLabel('Motivo').fill('Desconto de fidelidade')
  await dialog.getByRole('button', { name: 'Corrigir valor' }).click()
  await expect(page.getByTestId('booking-amount')).toHaveText(/9,00/, { timeout: 10000 })
  const row = page.getByRole('button', { name: /Valor corrigido/ })
  await row.click()
  await expect(page.getByText(/→ 9\.00/)).toBeVisible()
  // The customer's dashboard (the owner is the customer here) shows it.
  await page.goto('/dashboard')
  const card = page.locator('div.rounded-xl').filter({ hasText: rooms[0].name }).filter({ hasText: '9,00' })
  await expect(card.first()).toBeVisible({ timeout: 15000 })
  await api.put(`${API_URL}/admin/bookings/${booking.id}`, { headers: auth, params: { org_id: org }, data: { status: 'cancelled' } })
})

test('customer: create with the link → set password → sign in → suspend → refused → set password → still refused → reactivate → sign in', async ({ page, browser, baseURL }) => {
  const email = `cliente-${randomUUID().slice(0, 8)}@example.com`
  await page.goto('/admin/users/new')
  await page.getByLabel('Nome').fill('Cliente E2E')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await expect(page.getByRole('radio', { name: /Enviar ligação/ })).toBeChecked()
  await page.getByRole('button', { name: 'Criar cliente' }).click()
  await page.waitForURL(/\/admin\/users\/[0-9a-f-]{36}$/, { timeout: 15000 })
  const userId = page.url().split('/').pop()!

  // The person follows the link and picks a password.
  const link = await resetLinkFor(email)
  const customer = await browser.newContext()
  const cpage = await customer.newPage()
  await cpage.goto(link)
  await cpage.getByLabel('Nova password', { exact: true }).fill('primeira-123')
  await cpage.getByLabel('Confirmar a nova password').fill('primeira-123')
  await cpage.getByRole('button', { name: 'Guardar a nova password' }).click()
  await cpage.waitForURL('**/sign-in?password=reset')
  // The first sign-in through the real form; the later checks through the
  // credentials callback, which cannot be lost to hydration timing.
  await cpage.goto('/sign-in')
  await cpage.getByRole('button', { name: /Entrar/i }).waitFor()
  await cpage.getByLabel(/Email/i).fill(email)
  await cpage.getByLabel('Password').fill('primeira-123')
  await cpage.getByRole('button', { name: /Entrar/i }).click()
  await cpage.waitForURL('**/dashboard', { timeout: 15000 })
  await customer.close()

  // Suspended: refused, even after the operator sets a password; reactivated: in.
  await page.getByRole('button', { name: 'Suspender conta' }).click()
  await expect(page.getByText('Conta suspensa.').first()).toBeVisible()
  await expect(page.getByText(/Suspensa desde/)).toBeVisible()
  expect(await sessionFor(baseURL!, email, 'primeira-123')).toBe(false)
  await page.getByRole('button', { name: 'Definir password' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('#new-password').fill('segunda-123')
  await dialog.locator('#confirm-password').fill('segunda-123')
  await dialog.getByRole('button', { name: 'Definir password' }).click()
  await expect(page.getByText('Password definida.').first()).toBeVisible()
  expect(await sessionFor(baseURL!, email, 'segunda-123')).toBe(false)
  await page.getByRole('button', { name: 'Reativar conta' }).click()
  await expect(page.getByText('Conta reativada.').first()).toBeVisible()
  expect(await sessionFor(baseURL!, email, 'primeira-123')).toBe(false)
  expect(await sessionFor(baseURL!, email, 'segunda-123')).toBe(true)
  expect(userId).toBeTruthy()
})

test('purchase: adjusting below the hours already booked is refused inline, naming the booking', async ({ page }) => {
  // Fresh customer with 3 complimentary hours, of which a pack booking draws 2.
  const email = `banco-${randomUUID().slice(0, 8)}@example.com`
  const created = await api.post(`${API_URL}/admin/users`, { headers: auth, params: { org_id: org }, data: { name: 'Banco E2E', email, password: 'banco-pass-123' } })
  expect(created.ok(), await created.text()).toBeTruthy()
  const user = (await created.json()).user
  const { packages } = await (await api.get(`${API_URL}/packages`, { params: { org_id: org } })).json()
  const granted = await api.post(`${API_URL}/admin/users/${user.id}/complimentary-hours`, { headers: auth, params: { org_id: org }, data: { hours: '3', package_id: packages[0].id, reason: 'E2E' } })
  expect(granted.ok(), await granted.text()).toBeTruthy()
  const purchase = (await granted.json()).purchase
  const login = await api.post(`${API_URL}/auth/login`, { data: { email, password: 'banco-pass-123' } })
  const customerAuth = { Authorization: `Bearer ${(await login.json()).access_token}` }
  const { rooms } = await (await api.get(`${API_URL}/spaces/${space.id}`)).json()
  // Any free two-hour block in the next weeks: earlier runs may hold some.
  let booked
  for (const days of [14, 15, 16, 17, 18, 19, 21, 22]) {
    const slot = futureSlot(days, 10)
    booked = await api.post(`${API_URL}/bookings`, { headers: customerAuth, data: { room_id: rooms[1]?.id ?? rooms[0].id, start_time: slot.start_time, end_time: new Date(new Date(slot.start_time).getTime() + 2 * 3.6e6).toISOString(), payment_method: 'package' } })
    if (booked.ok()) break
  }
  expect(booked!.ok(), await booked!.text()).toBeTruthy()

  await page.goto(`/admin/purchases/${purchase.id}`)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Banco E2E')
  await expect(page.getByText(/1h de 3h por gastar/)).toBeVisible()
  await page.getByRole('button', { name: 'Ajustar horas' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Horas (±)').fill('-2')
  await dialog.getByLabel('Motivo').fill('Erro no registo')
  await dialog.getByRole('button', { name: 'Ajustar' }).click()
  await expect(dialog.getByRole('alert')).toContainText('held by bookings')
  await expect(dialog.getByRole('alert')).toContainText('2.00 h')
  const { booking } = await booked!.json()
  await api.put(`${API_URL}/admin/bookings/${booking.id}`, { headers: auth, params: { org_id: org }, data: { status: 'cancelled' } })
})

test('anonymise: the booking lists the placeholder and the old session is dead', async ({ page }) => {
  const email = `anon-${randomUUID().slice(0, 8)}@example.com`
  const created = await api.post(`${API_URL}/admin/users`, { headers: auth, params: { org_id: org }, data: { name: 'Anon E2E', email, password: 'anon-pass-123' } })
  const user = (await created.json()).user
  const login = await api.post(`${API_URL}/auth/login`, { data: { email, password: 'anon-pass-123' } })
  const oldToken = (await login.json()).access_token
  const { rooms } = await (await api.get(`${API_URL}/spaces/${space.id}`)).json()
  const booking = await manualBooking(user.id, rooms[0].id, 16, 12)

  await page.goto(`/admin/users/${user.id}`)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Anon E2E')
  await page.getByLabel(/para confirmar/).fill(email)
  await page.getByRole('button', { name: 'Eliminar' }).click()
  const dialog = page.getByRole('dialog', { name: 'Anonimizar esta conta' })
  await dialog.getByLabel('Motivo').fill('Pedido RGPD')
  await dialog.getByRole('button', { name: 'Anonimizar' }).click()
  await expect(page.getByText('Conta anonimizada.').first()).toBeVisible()

  await page.goto('/admin/bookings')
  await expect(page.getByText(/utilizador-[0-9a-f]{8}@anon\.invalid/).first()).toBeVisible({ timeout: 15000 })
  const dead = await api.get(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${oldToken}` } })
  expect(dead.status()).toBe(401)
  await api.put(`${API_URL}/admin/bookings/${booking.id}`, { headers: auth, params: { org_id: org }, data: { status: 'cancelled' } })
})

test('settings: an admin who is not the owner reads with a note and cannot save', async ({ browser }) => {
  const email = `admin2-${randomUUID().slice(0, 8)}@example.com`
  const created = await api.post(`${API_URL}/admin/users`, { headers: auth, params: { org_id: org }, data: { name: 'Admin Dois', email, password: 'admin2-pass-123' } })
  const user = (await created.json()).user
  const promoted = await api.put(`${API_URL}/admin/users/${user.id}/role`, { headers: auth, params: { org_id: org }, data: { role: 'admin' } })
  expect(promoted.ok(), await promoted.text()).toBeTruthy()

  // The auth tier is shared by everything above; give it a moment.
  await delay(5000)
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/sign-in')
  await page.getByLabel(/Email/i).fill(email)
  await page.getByLabel('Password').fill('admin2-pass-123')
  await page.getByRole('button', { name: /Entrar/i }).click()
  await page.waitForURL('**/dashboard', { timeout: 15000 })
  await page.goto('/admin/settings')
  await expect(page.getByText(/Só o proprietário/)).toBeVisible({ timeout: 15000 })
  await expect(page.getByLabel('Nome')).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Guardar' })).toBeDisabled()
  await context.close()
})
