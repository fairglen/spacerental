import { detailOf, statusOf } from '@/lib/httpError'

/** Portuguese explanation of a refused operator action on a booking (A01/A02). */
export function adminBookingErrorMessage(error: unknown): string {
  const status = statusOf(error)
  const detail = detailOf(error)?.toLowerCase() ?? ''
  switch (status) {
    case 409:
      if (detail.includes('another block') || detail.includes('bloque')) return 'Já existe um bloqueio nesse horário.'
      if (detail.includes('hold this time')) return 'Há reservas nesse horário. Move-as ou cancela-as primeiro.'
      if (detail.includes('package')) return 'O pack do cliente já não tem as horas desta reserva.'
      if (detail.includes('already received')) return 'O pagamento já foi recebido; aguarda a confirmação.'
      if (detail.includes('cannot be marked')) return 'Esta reserva não é uma reserva por pagar.'
      return 'Este horário já está reservado ou bloqueado.'
    case 400:
      if (detail.includes('past')) return 'Esse horário já passou.'
      if (detail.includes('opening hours')) return 'Fora do horário de funcionamento da sala.'
      if (detail.includes('exceed')) return 'Demasiado longo para uma reserva.'
      return 'Horário inválido.'
    case 404:
      return 'Não encontrado. A reserva, a sala ou o cliente já não existem nesta organização.'
    case 422:
      return 'Verifica os campos.'
    case 502:
      return 'Não foi possível fechar a sessão de pagamento. Tenta novamente.'
    case undefined:
      return 'Sem ligação ao servidor. Verifica a internet e tenta novamente.'
    default:
      return 'Não foi possível guardar a alteração. Tenta novamente.'
  }
}
