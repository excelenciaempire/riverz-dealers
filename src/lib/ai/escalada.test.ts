import { describe, expect, it } from 'vitest'
import { detectarEscalada, señalDura } from './escalada'
import { textoDelAviso } from './aviso-escalada'

describe('señalDura', () => {
  it('caza lo que no puede esperar', () => {
    expect(señalDura('esto es una estafa, voy a hablar con mi abogado')?.clase).toBe('legal')
    expect(señalDura('voy a hacer la denuncia en defensa del consumidor')?.clase).toBe('legal')
    expect(señalDura('me cobraron dos veces el mismo pedido')?.clase).toBe('cobro')
    expect(señalDura('me salió alergia en el cuello después de usarlo')?.clase).toBe('salud')
  })

  it('caza los reclamos de siempre', () => {
    expect(señalDura('hola, no me llegó el pedido')?.clase).toBe('no_llego')
    expect(señalDura('figura como entregado y yo no recibí nada')?.clase).toBe('no_llego')
    expect(señalDura('quiero la devolución del dinero')?.clase).toBe('devolucion')
    expect(señalDura('quiero hablar con una persona, no con un bot')?.clase).toBe('pide_persona')
  })

  it('lo grave gana sobre lo leve', () => {
    // "no me llegó" y "denuncia" en el mismo mensaje: se anuncia como legal,
    // que es lo que cambia cómo hay que atenderlo.
    expect(
      señalDura('no me llegó nada y voy a hacer la denuncia')?.clase,
    ).toBe('legal')
  })

  it('no escala una conversación normal', () => {
    // Escalar de más entrena al comercio a ignorar los avisos.
    expect(señalDura('hola, cuánto sale?')).toBeNull()
    expect(señalDura('sirve para el cuello?')).toBeNull()
    expect(señalDura('gracias!')).toBeNull()
    expect(señalDura('me encanta, ya lo compré dos veces')).toBeNull()
    expect(señalDura('quiero pagar por transferencia')).toBeNull()
  })

  it('escala una transferencia ya realizada o con comprobante', () => {
    expect(señalDura('ya transferí, ¿lo recibieron?')?.clase).toBe('cobro')
    expect(señalDura('te adjunto el comprobante')?.clase).toBe('cobro')
    expect(señalDura('ya pagué con Addi, ¿aparece el pago?')?.clase).toBe('cobro')
    expect(señalDura('el pago por Bold no figura')?.clase).toBe('cobro')
  })

  it('no escala por una pregunta informativa sobre medios de pago', () => {
    expect(señalDura('¿Recibes pagos con Addi?')).toBeNull()
    expect(señalDura('¿puedo pagar por Nequi o Bancolombia?')).toBeNull()
  })

  it('escala cuando quiere pagar y una persona debe enviar el enlace', async () => {
    await expect(
      detectarEscalada({
        mensaje: 'quiero pagar con Addi',
        hilo: [],
        db: {} as never,
        workspaceId: 'w1',
      }),
    ).resolves.toMatchObject({ clase: 'pago_asistido' })
    await expect(
      detectarEscalada({
        mensaje: 'Quiero el grande de la promoción',
        hilo: [
          'Cliente: ¿Recibes pagos con Addi?',
          'Nosotros: Sí. ¿Cómo puedo ayudarte?',
          'Cliente: Quiero el grande de la promoción',
        ],
        db: {} as never,
        workspaceId: 'w1',
      }),
    ).resolves.toMatchObject({ clase: 'pago_asistido' })
  })

  it('no clasifica como incidente un checkout por transferencia', async () => {
    await expect(
      detectarEscalada({
        mensaje:
          'Quiero comprar y pagar por transferencia con el descuento. Envíame el enlace de checkout.',
        hilo: ['cliente: hola', 'agente: hola', 'cliente: quiero el serum'],
        hayPedido: true,
        db: {} as never,
        workspaceId: 'w1',
      }),
    ).resolves.toBeNull()
  })
})

describe('textoDelAviso', () => {
  const base = {
    workspaceId: 'w1',
    conversationId: 'c1',
    cliente: 'Rosanna',
    contacto: '+5492804123456',
    canal: 'whatsapp',
    escalada: {
      clase: 'envio_mal' as const,
      urgencia: 'ahora' as const,
      porQue: 'El envío va a Carlos Casares y ella vive en Puerto Madryn',
    },
    ultimoMensaje: 'Y yo vivo en Puerto Madryn',
  }

  it('dice quién, por dónde, qué pasa y con qué palabras', () => {
    const { titulo, cuerpo } = textoDelAviso(base)
    expect(titulo).toContain('Rosanna')
    expect(titulo).toContain('ahora')
    expect(cuerpo).toContain('Puerto Madryn')
    expect(cuerpo).toContain('WhatsApp')
    expect(cuerpo).toContain('+5492804123456')
    expect(cuerpo).toContain('/bandeja?c=c1')
  })

  it('no gasta renglones en decir que no sabe', () => {
    // Un aviso con "Pedido: —" ocupa una línea para no informar nada.
    const { cuerpo } = textoDelAviso({ ...base, pedido: null, esperandoHoras: null })
    expect(cuerpo).not.toContain('Pedido')
    expect(cuerpo).not.toContain('esperando')
  })

  it('con pedido y espera, los incluye', () => {
    const { cuerpo } = textoDelAviso({
      ...base,
      pedido: { numero: '#1042', estado: 'En camino' },
      esperandoHoras: 26,
    })
    expect(cuerpo).toContain('#1042')
    expect(cuerpo).toContain('En camino')
    expect(cuerpo).toContain('26 h')
  })
})
