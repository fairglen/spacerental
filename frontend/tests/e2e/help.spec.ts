import { test, expect } from '@playwright/test'

/**
 * C17 — "Ajuda": a visitor who is not signed in reports a problem from the
 * navbar and gets a reference back. The row's arrival is checked from the
 * operator side in admin-support.spec.ts (C19).
 *
 * The help form is throttled at 5 requests an hour per client: this file
 * sends exactly one, and the loop stack's backend is restarted before a
 * full run so a previous run's requests do not count.
 */
test('a signed-out visitor sends a help request and gets a reference', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('navigation').getByRole('button', { name: /^Ajuda$/ }).click()

  const dialog = page.getByRole('dialog', { name: /Ajuda/ })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Email')).toBeEditable()
  await expect(dialog.getByLabel(/Reserva/)).toHaveCount(0)

  // What is captured is disclosed, collapsed by default.
  const details = dialog.locator('details')
  await expect(details).not.toHaveAttribute('open', '')
  await dialog.getByText('O que enviamos com o pedido').click()
  await expect(details).toContainText(/browser/i)

  await dialog.getByLabel('Assunto').selectOption('technical')
  await dialog.getByLabel('Email').fill('visitante-e2e@example.com')
  await dialog.getByLabel('Mensagem').fill('E2E: o calendário não carrega na primeira visita, só depois de recarregar.')
  await dialog.getByRole('button', { name: /^Enviar$/ }).click()

  const status = dialog.getByRole('status')
  await expect(status).toBeVisible({ timeout: 10000 })
  await expect(status).toContainText(/#[0-9A-F]{8}/)
  await expect(status).toContainText('Respondemos por email')
  await expect(status).toContainText('visitante-e2e@example.com')
  await dialog.getByRole('button', { name: 'Fechar' }).click()
  await expect(dialog).toHaveCount(0)
})
