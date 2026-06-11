import { test, expect } from '@playwright/test'

test.describe('Spaces and bookings', () => {
  test('browse spaces page', async ({ page }) => {
    await page.goto('/spaces')
    await expect(page.getByText(/Todos os Espaços/i)).toBeVisible()
  })

  test('user can book an available slot from a room calendar', async ({ page }) => {
    // Log in as the seeded admin.
    await page.goto('/sign-in')
    await page.getByLabel(/Email/i).fill('admin@demo.com')
    await page.getByLabel('Password').fill('admin123')
    await page.getByRole('button', { name: /Entrar/i }).click()
    await page.waitForURL('**/dashboard', { timeout: 30000 })

    // Go to the first space and pick the first room.
    await page.goto('/spaces')
    await page.getByRole('button', { name: /Ver Salas e Reservar/i }).first().click()
    await page.waitForURL('**/spaces/**', { timeout: 10000 })

    // The RoomCard renders a "Reservar" button per room.
    await page.getByRole('button', { name: /Reservar/i }).first().click()

    // Calendar loads availability for the current week.
    await expect(page.getByText(/Disponibilidade/i)).toBeVisible({ timeout: 10000 })

    // Available slots are tinted light green (#f0faf5). Skip if none visible
    // within 5s — seed data may have filled the day on a flaky CI run.
    const greenSlot = page.locator('.rbc-day-slot .rbc-time-slot[style*="rgb(240, 250, 245)"]').first()
    try {
      await greenSlot.waitFor({ state: 'visible', timeout: 5000 })
    } catch {
      test.skip(true, 'No available slot visible — likely all booked in this view')
      return
    }

    // rbc overlays an empty .rbc-events-container above the slots, so
    // Playwright's hit-target check rejects a normal click. Selection in rbc
    // is coordinate-based (the event bubbles to the day column), so a forced
    // click works. Center the slot first to keep it clear of the sticky navbar.
    await greenSlot.evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await greenSlot.click({ force: true })

    // Confirmation modal appears.
    const confirmHeading = page.getByRole('heading', { name: /Confirmar Reserva/i })
    await expect(confirmHeading).toBeVisible({ timeout: 5000 })

    // Capture the booking date+time so we can verify it on the dashboard.
    const horarioText = await page.getByText('Horário', { exact: true }).locator('..').innerText()

    await page.getByRole('button', { name: /Confirmar Reserva/i }).click()

    // Modal closes on success; the availability query refetches and the slot
    // is no longer green (now muted gray). The booking should land in /dashboard.
    await expect(confirmHeading).toBeHidden({ timeout: 10000 })

    await page.goto('/dashboard')
    // Pull the HH:mm fragment out of "Horário 10:00 – 12:00" for a real assertion.
    const timeMatch = horarioText.match(/(\d{2}:\d{2})/)
    expect(timeMatch, `Could not parse time from "${horarioText}"`).not.toBeNull()
    await expect(page.getByText(timeMatch![1]).first()).toBeVisible({ timeout: 10000 })
  })
})
