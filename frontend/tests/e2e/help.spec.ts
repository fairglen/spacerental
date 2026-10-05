import { randomUUID } from 'node:crypto'
import { test, expect, API_ORIGIN, at, contextAs, createBooking, freshDay } from './fixtures'

/**
 * C17 — "Ajuda": a visitor who is not signed in reports a problem from the
 * navbar and gets a reference back. The row's arrival is checked from the
 * operator side in admin-support.spec.ts (C19), which sends requests of its
 * own: the visitor address here is unique per run (Q41), so neither spec can
 * match the other's row or mailbox entries.
 */
test('a signed-out visitor sends a help request and gets a reference, and both emails go out', async ({ page, request }) => {
  const visitorEmail = `visitante-${randomUUID().slice(0, 8)}@example.com`

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
  await dialog.getByLabel('Email').fill(visitorEmail)
  await dialog.getByLabel('Mensagem').fill('E2E: o calendário não carrega na primeira visita, só depois de recarregar.')
  await dialog.getByRole('button', { name: /^Enviar$/ }).click()

  const status = dialog.getByRole('status')
  await expect(status).toBeVisible({ timeout: 10000 })
  await expect(status).toContainText(/#[0-9A-F]{8}/)
  await expect(status).toContainText(`Enviámos uma cópia para ${visitorEmail}`)
  await expect(status).toContainText('respondemos por email')
  const reference = (await status.textContent())!.match(/#([0-9A-F]{8})/)![1]
  await dialog.getByRole('button', { name: 'Fechar' }).click()
  await expect(dialog).toHaveCount(0)

  // K03: the inbox copy (answerable to the visitor) and the visitor's own copy
  // (answerable to the inbox), both from the stub mailbox.
  const mailbox = await request.get(`${API_ORIGIN}/__test__/emails`)
  expect(mailbox.ok(), await mailbox.text()).toBeTruthy()
  const { emails } = (await mailbox.json()) as { emails: Array<{ to: string; subject: string; reply_to: string | null; links: string[] }> }
  const inbox = emails.find((m) => m.subject === `[Ajuda] Problema técnico — #${reference}`)
  expect(inbox, 'the inbox copy reached the stub mailbox').toBeTruthy()
  expect(inbox!.to).toBe('geral+support@flowspace.pt')
  expect(inbox!.reply_to).toBe(visitorEmail)
  expect(inbox!.links.some((l) => l.includes('/admin/support/'))).toBe(true)
  const copy = emails.find((m) => m.subject === `[FlowSpace] Recebemos o seu pedido #${reference}`)
  expect(copy, 'the requester copy reached the stub mailbox').toBeTruthy()
  expect(copy!.to).toBe(visitorEmail)
  expect(copy!.reply_to).toBe('geral+support@flowspace.pt')
})

// C18: from the cancel dialog of a paid booking, the money question goes to a
// person through the help dialog, with the booking preselected. The customer
// and the room are this test's own, so the dashboard holds exactly one card.
test('a customer opens the help dialog from the cancel dialog and submits about that booking', async ({ browser, contextOptions, api, room, customer }) => {
  // A confirmed hourly booking a week out, made through the stub gateways.
  const day = freshDay(8)
  const { booking } = await createBooking(api, customer, { roomId: room.id, start: at(day, 15), end: at(day, 16), pay: true })

  const context = await contextAs(browser, customer, contextOptions)
  try {
    const page = await context.newPage()
    await page.goto('/dashboard')
    const card = page.locator('div.rounded-xl').filter({ hasText: room.name }).filter({ has: page.getByText('Confirmado') }).first()
    await card.getByRole('button', { name: /^Cancelar$/ }).click()

    const cancelDialog = page.getByRole('dialog', { name: /Cancelar reserva/ })
    await expect(cancelDialog).toBeVisible()
    await expect(cancelDialog.getByRole('button', { name: /Sim, cancelar/ })).toBeEnabled()
    await expect(cancelDialog).not.toContainText(/reembols/i)
    await cancelDialog.getByRole('button', { name: /Fale connosco/ }).click()

    const help = page.getByRole('dialog', { name: /Ajuda/ })
    await expect(help).toBeVisible()
    await expect(help.getByLabel('Assunto')).toHaveValue('payment')
    await expect(help.getByLabel(/Reserva/)).toHaveValue(booking.id)
    await expect(help.getByLabel('Email')).toHaveValue(customer.email)
    await help.getByLabel('Mensagem').fill('E2E: tenho uma dúvida sobre o valor desta reserva antes de a cancelar.')
    await help.getByRole('button', { name: /^Enviar$/ }).click()
    await expect(help.getByRole('status')).toContainText(/#[0-9A-F]{8}/, { timeout: 10000 })
  } finally {
    await context.close()
  }
})
