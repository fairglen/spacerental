import { test, expect } from '@playwright/test'

test.describe('Spaces and bookings', () => {
  test('browse spaces page', async ({ page }) => {
    await page.goto('/spaces')
    await expect(page.getByText(/Todos os Espaços/i)).toBeVisible()
  })

  test.skip('admin can create a booking flow end to end', async ({ page }) => {
    // Placeholder for full booking flow — requires availability slot selection
  })
})
