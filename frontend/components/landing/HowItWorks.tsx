const steps = [
  { n: '01', title: 'Regista-te', desc: 'Cria a tua conta em segundos com o Google ou e-mail.' },
  { n: '02', title: 'Escolhe o espaço', desc: 'Consulta as salas disponíveis e as suas comodidades.' },
  { n: '03', title: 'Reserva o horário', desc: 'Seleciona a data e hora no calendário e confirma a reserva.' },
  { n: '04', title: 'Acede ao espaço', desc: 'Recebe as instruções de acesso e começa a trabalhar.' },
]

export function HowItWorks() {
  return (
    <section id="como-funciona" className="py-20 bg-background">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-foreground mb-4">Como Funciona</h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            De zero a sala reservada em menos de 2 minutos.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {steps.map((step, i) => (
            <div key={step.n} className="relative flex flex-col items-center text-center">
              {i < steps.length - 1 && (
                <div className="hidden lg:block absolute top-6 left-1/2 w-full h-px bg-border" />
              )}
              <div className="relative z-10 mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-lg">
                {step.n}
              </div>
              <h3 className="font-semibold text-foreground mb-2">{step.title}</h3>
              <p className="text-sm text-muted-foreground">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
