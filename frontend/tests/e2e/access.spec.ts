import { request as playwrightRequest, type APIRequestContext } from '@playwright/test'
import {
  adminSession,
  at,
  createBooking,
  createCustomer,
  createRoom,
  expect,
  freshDay,
  loginAs,
  removeRoom,
  test,
  type Admin,
  type Room,
} from './fixtures'

// L01: a confirmed booking gives the customer one door PIN; the dashboard
// access card shows it (masked until tapped). The dev/e2e stack maps every
// space to one lock (NUKI_DEVICE_ID_MAP={"*":...}), so a confirmed booking is
// enough for the card to appear.
test.describe('Código de acesso', () => {
  let api: APIRequestContext
  let admin: Admin
  let room: Room

  test.beforeAll(async () => {
    api = await playwrightRequest.newContext()
    admin = await adminSession(api)
    room = await createRoom(api, admin, { name: `Acesso ${Date.now().toString(36)}` })
  })

  test.afterAll(async () => {
    if (api && admin && room) await removeRoom(api, admin, room.id)
  })

  test('aparece no painel depois de uma reserva paga', async ({ browser }) => {
    const customer = await createCustomer(api, { tag: 'acesso' })
    const day = freshDay(10)
    await createBooking(api, customer, {
      roomId: room.id,
      start: at(day, 10),
      end: at(day, 11),
      pay: true,
    })

    const context = await browser.newContext({
      timezoneId: 'UTC',
      storageState: await loginAs(customer),
    })
    const page = await context.newPage()
    await page.goto('/dashboard')

    const card = page.getByTestId('access-card')
    await expect(card).toBeVisible()

    // Masked until tapped, then a 6-digit Keypad code (digits 1-9).
    const pin = page.getByTestId('access-pin')
    await expect(pin).toHaveText(/•/)
    await pin.click()
    await expect(pin).toHaveText(/^[1-9]{6}$/)

    await context.close()
  })
})
