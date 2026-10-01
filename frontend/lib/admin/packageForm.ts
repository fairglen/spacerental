import { z } from 'zod'
import type { Package } from '@/types'

export const packageSchema = z.object({
  name: z.string().min(2, 'Nome obrigatório'),
  hours: z.coerce.number().int('Horas inteiras').min(1, 'Pelo menos 1 hora').max(999, 'No máximo 999 horas'),
  price: z.coerce.number().min(0, 'Valor inválido'),
  validity_days: z.coerce.number().int().min(1, 'Pelo menos 1 dia').max(3650, 'No máximo 10 anos'),
})
export type PackageFormValues = z.infer<typeof packageSchema>

export function packageToForm(p: Package): PackageFormValues {
  return { name: p.name, hours: p.hours, price: p.price, validity_days: p.validity_days }
}
