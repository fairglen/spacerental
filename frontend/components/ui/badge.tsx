import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-[#E8F4F0] text-[#3D7A5E]',
        secondary: 'bg-gray-100 text-gray-700',
        destructive: 'bg-red-100 text-red-700',
        outline: 'border border-[#3D7A5E] text-[#3D7A5E]',
        success: 'bg-green-100 text-green-700',
        warning: 'bg-yellow-100 text-yellow-800',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
