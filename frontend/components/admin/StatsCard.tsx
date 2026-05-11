import { Card, CardContent } from '@/components/ui/card'
import type { LucideIcon } from 'lucide-react'

interface StatsCardProps {
  title: string
  value: string | number
  icon: LucideIcon
  trend?: string
}

export function StatsCard({ title, value, icon: Icon, trend }: StatsCardProps) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[#6B7280]">{title}</p>
            <p className="text-2xl font-bold text-[#1A1A2E] mt-1">{value}</p>
            {trend && <p className="text-xs text-[#3D7A5E] mt-1">{trend}</p>}
          </div>
          <div className="h-10 w-10 rounded-full bg-[#E8F4F0] flex items-center justify-center">
            <Icon className="h-5 w-5 text-[#3D7A5E]" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
