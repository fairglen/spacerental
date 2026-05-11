import { Shield, Calendar, Clock } from 'lucide-react'

const props = [
  {
    icon: Shield,
    title: 'Privacidade Total',
    desc: 'Cada sala é completamente isolada e insonorizada para sessões confidenciais.',
  },
  {
    icon: Calendar,
    title: 'Reserva Online',
    desc: 'Reserva a tua sala em segundos, a qualquer hora, sem telefonemas.',
  },
  {
    icon: Clock,
    title: 'Máxima Flexibilidade',
    desc: 'Por hora, por pacote de 10h ou mensalmente. Tu escolhes.',
  },
]

export function ValueProps() {
  return (
    <section className="py-16 bg-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {props.map((p) => (
            <div key={p.title} className="flex flex-col items-center text-center p-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#E8F4F0]">
                <p.icon className="h-6 w-6 text-[#3D7A5E]" />
              </div>
              <h3 className="text-lg font-semibold text-[#1A1A2E] mb-2">{p.title}</h3>
              <p className="text-sm text-[#6B7280]">{p.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
