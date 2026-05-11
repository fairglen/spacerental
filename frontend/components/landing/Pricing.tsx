import Link from 'next/link'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

const plans = [
  {
    name: 'Hora a Hora',
    price: '€11',
    unit: '/ hora',
    desc: 'Sem compromisso. Paga apenas o que usas.',
    features: ['Reserva instantânea', 'Cancelamento gratuito 24h', 'Sem mensalidade'],
    cta: 'Reservar Agora',
    href: '/spaces',
    highlighted: false,
    badge: undefined,
  },
  {
    name: 'Pack 10 Horas',
    price: '€100',
    unit: '10 horas',
    desc: 'Poupa €10. Usa quando quiseres durante 1 ano.',
    features: ['10h pré-pagas', 'Válido 12 meses', 'Poupança de €10', 'Reserva prioritária'],
    cta: 'Comprar Pack',
    href: '/sign-up',
    highlighted: true,
    badge: 'Mais Popular',
  },
  {
    name: 'Pack 20 Horas',
    price: '€190',
    unit: '20 horas',
    desc: 'Poupa €30. Para quem usa regularmente.',
    features: ['20h pré-pagas', 'Válido 12 meses', 'Poupança de €30', 'Reserva prioritária'],
    cta: 'Comprar Pack',
    href: '/sign-up',
    highlighted: false,
    badge: undefined,
  },
]

export function Pricing() {
  return (
    <section id="precos" className="py-20 bg-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-[#1A1A2E] mb-4">Preços Transparentes</h2>
          <p className="text-[#6B7280]">Sem surpresas. Sem contratos. Sem taxas escondidas.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
          {plans.map((plan) => (
            <Card
              key={plan.name}
              className={
                plan.highlighted ? 'border-[#3D7A5E] border-2 shadow-lg relative' : 'relative'
              }
            >
              {plan.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-[#3D7A5E] text-white px-3 py-1">{plan.badge}</Badge>
                </div>
              )}
              <CardHeader className="text-center pb-2">
                <CardTitle className="text-lg">{plan.name}</CardTitle>
                <div className="mt-2">
                  <span className="text-4xl font-bold text-[#1A1A2E]">{plan.price}</span>
                  <span className="text-sm text-[#6B7280] ml-1">{plan.unit}</span>
                </div>
                <p className="text-xs text-[#6B7280] mt-1">{plan.desc}</p>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 mb-6">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-[#6B7280]">
                      <Check className="h-4 w-4 text-[#3D7A5E] flex-shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link href={plan.href} className="block">
                  <Button
                    variant={plan.highlighted ? 'default' : 'outline'}
                    className="w-full"
                  >
                    {plan.cta}
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}
