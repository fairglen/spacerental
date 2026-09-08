'use client'
import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/lib/api'
import { useApi } from '@/lib/hooks/useApi'
import { useOrg } from '@/contexts/OrgContext'
import { BookingsTable } from '@/components/admin/BookingsTable'
import { Skeleton } from '@/components/ui/skeleton'

const PAGE_SIZE = 20

export default function AdminBookingsPage() {
  const { currentOrgId } = useOrg()
  return <OrgBookings key={currentOrgId} currentOrgId={currentOrgId} />
}

function OrgBookings({ currentOrgId }: { currentOrgId: string | null }) {
  const { data: session } = useSession()
  const api = useApi()
  const qc = useQueryClient()
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'bookings', 'all', currentOrgId, page],
    queryFn: () => adminApi.getBookings({ page, page_size: PAGE_SIZE }, api),
    enabled: !!session?.accessToken && !!currentOrgId,
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => adminApi.updateBooking(id, status, api),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'bookings'] }),
  })

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-foreground mb-2">Todas as Reservas</h1>
      <p className="text-muted-foreground text-sm mb-8">Gere e acompanha todas as reservas.</p>
      {isLoading ? <Skeleton className="h-96 rounded-xl" /> : (
        <BookingsTable
          bookings={data?.bookings ?? []}
          total={data?.total ?? 0}
          page={data?.page ?? page}
          pageSize={data?.page_size ?? PAGE_SIZE}
          onPageChange={setPage}
          onUpdateStatus={(id, status) => updateMutation.mutate({ id, status })}
        />
      )}
    </div>
  )
}
