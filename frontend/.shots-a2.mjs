import { chromium, request } from '@playwright/test'
const out = '/Users/leo/workspace/spacerental-admin/.pr-evidence/a2'
const base = 'http://localhost:3100'
const api = 'http://localhost:8100/api/v1'
const shot = async (page, path, name, ready) => {
  await page.goto(`${base}${path}`)
  if (ready) await page.getByText(ready).first().waitFor({ timeout: 20000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true })
}
async function login(email, password) {
  const ctx = await request.newContext({ baseURL: base })
  const { csrfToken } = await (await ctx.get('/api/auth/csrf')).json()
  await ctx.post('/api/auth/callback/credentials', { form: { csrfToken, email, password, callbackUrl: `${base}/dashboard`, json: 'true' } })
  const state = await ctx.storageState()
  await ctx.dispose()
  return state
}
const api1 = await request.newContext()
const login1 = await api1.post(`${api}/auth/login`, { data: { email: 'admin@demo.com', password: 'admin123' } })
const auth = { Authorization: `Bearer ${(await login1.json()).access_token}` }
const { spaces } = await (await api1.get(`${api}/spaces`)).json()
const detail = await (await api1.get(`${api}/spaces/${spaces[0].id}`)).json()
const org = detail.rooms[0].org_id
const me = await (await api1.get(`${api}/auth/me`, { headers: auth })).json()
const bookings = await (await api1.get(`${api}/admin/bookings`, { headers: auth, params: { org_id: org, page_size: 5 } })).json()
const users = await (await api1.get(`${api}/admin/users`, { headers: auth, params: { org_id: org, page_size: 5 } })).json()
const purchases = await (await api1.get(`${api}/admin/purchases`, { headers: auth, params: { org_id: org, page_size: 5 } })).json()
const packages = await (await api1.get(`${api}/admin/packages`, { headers: auth, params: { org_id: org } })).json()
const support = await (await api1.get(`${api}/admin/support/requests`, { headers: auth, params: { org_id: org, page_size: 5 } })).json()
const customer = users.users.find((u) => u.role === 'member') ?? users.users[0]

const browser = await chromium.launch()
const owner = await browser.newContext({ storageState: await login('admin@demo.com', 'admin123'), viewport: { width: 1400, height: 1000 } })
const page = await owner.newPage()
await shot(page, '/admin/spaces', 'list-spaces', 'Espaços')
await shot(page, '/admin/rooms', 'list-rooms', 'Salas')
await shot(page, '/admin/bookings', 'list-bookings', 'Reservas')
await shot(page, '/admin/users', 'list-users', 'Clientes')
await shot(page, '/admin/packages', 'list-packages', 'Pacotes')
await shot(page, '/admin/purchases', 'list-purchases', 'Banco de horas')
await shot(page, '/admin/support', 'list-support', 'Pedidos de ajuda')
await shot(page, `/admin/spaces/${spaces[0].id}`, 'detail-space', 'Zona de perigo')
await shot(page, `/admin/rooms/${detail.rooms[0].id}`, 'detail-room', 'Zona de perigo')
if (bookings.bookings[0]) await shot(page, `/admin/bookings/${bookings.bookings[0].id}`, 'detail-booking', 'Zona de perigo')
await shot(page, `/admin/users/${customer.id}`, 'detail-user', 'Zona de perigo')
await page.getByRole('heading', { name: 'Acesso' }).scrollIntoViewIfNeeded()
await page.getByRole('heading', { name: 'Acesso' }).locator('..').screenshot({ path: `${out}/user-acesso.png` })
if (packages.packages[0]) await shot(page, `/admin/packages/${packages.packages[0].id}`, 'detail-package', 'Zona de perigo')
if (purchases.purchases[0]) await shot(page, `/admin/purchases/${purchases.purchases[0].id}`, 'detail-purchase', 'Zona de perigo')
if (support.requests[0]) await shot(page, `/admin/support/${support.requests[0].id}`, 'detail-support', 'Zona de perigo')
await shot(page, '/admin/audit', 'audit', 'Histórico')
await shot(page, '/admin/settings', 'settings-owner', 'Definições')
await owner.close()

// An admin who is not the owner: made on the fly.
const email = `admin-shot-${Date.now()}@example.com`
await api1.post(`${api}/admin/users`, { headers: auth, params: { org_id: org }, data: { name: 'Admin Captura', email, password: 'captura-123' } })
const u = await (await api1.get(`${api}/admin/users`, { headers: auth, params: { org_id: org, q: email } })).json()
await api1.put(`${api}/admin/users/${u.users[0].id}/role`, { headers: auth, params: { org_id: org }, data: { role: 'admin' } })
const admin = await browser.newContext({ storageState: await login(email, 'captura-123'), viewport: { width: 1400, height: 1000 } })
const apage = await admin.newPage()
await shot(apage, '/admin/settings', 'settings-admin', 'Só o proprietário')
await admin.close()
await browser.close()
await api1.dispose()
console.log('done')
