import { detailOf, statusOf } from '@/lib/httpError'

/** Portuguese explanation of a refused operator action on a booking (A01/A02). */
export function adminBookingErrorMessage(error: unknown): string {
  const status = statusOf(error)
  const detail = detailOf(error)?.toLowerCase() ?? ''
  switch (status) {
    case 409:
      if (detail.includes('another block') || detail.includes('bloque')) return 'Já existe um bloqueio nesse horário.'
      if (detail.includes('hold this time')) return 'Há reservas nesse horário. Mova-as ou cancele-as primeiro.'
      // H03: a refused write named by its constraint, never a server error.
      if (detail.includes('violates a constraint')) {
        return detail.includes('package_hours')
          ? 'Não foi possível acertar as horas do pack com o novo horário. Verifique a duração e tente de novo.'
          : 'A alteração foi recusada pela base de dados. Verifique os valores e tente de novo.'
      }
      if (detail.includes('package')) return 'O pack do cliente já não tem as horas desta reserva.'
      if (detail.includes('already received')) return 'O pagamento já foi recebido; aguarde a confirmação.'
      if (detail.includes('cannot be marked')) return 'Esta reserva não é uma reserva por pagar.'
      return 'Este horário já está reservado ou bloqueado.'
    case 400:
      // H03: the operator may keep a start that has gone by; the END may not.
      if (detail.includes('end_time cannot be in the past')) return 'O fim tem de ser depois de agora.'
      if (detail.includes('past')) return 'Não é possível mover o início para antes de agora.'
      if (detail.includes('opening hours')) return 'Fora do horário de funcionamento da sala.'
      if (detail.includes('exceed')) return 'Demasiado longo para uma reserva.'
      if (detail.includes('after start_time')) return 'O fim tem de ser depois do início.'
      return 'Horário inválido.'
    case 404:
      return 'Não encontrado. A reserva, a sala ou o cliente já não existem nesta organização.'
    case 422:
      return 'Verifique os campos.'
    case 502:
      return 'Não foi possível fechar a sessão de pagamento. Tente novamente.'
    case undefined:
      return 'Sem ligação ao servidor. Verifique a internet e tente novamente.'
    default:
      return 'Não foi possível guardar a alteração. Tente novamente.'
  }
}
