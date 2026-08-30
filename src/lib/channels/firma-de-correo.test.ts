import { describe, expect, it } from 'vitest'
import type { ChannelConnection } from '@/types'
import { conFirma, firmaDe } from './firma-de-correo'

/**
 * El correo salía sin nada: ni el nombre de quien atiende, ni el del negocio.
 * En chat eso está bien —el nombre está arriba, en la conversación— pero un
 * correo llega solo a una bandeja llena, y sin firma se lee como enviado por
 * un sistema.
 */

const con = (signature?: unknown) =>
  ({ config: signature === undefined ? {} : { signature } }) as unknown as ChannelConnection

describe('la firma del correo', () => {
  it('sin firma configurada, el correo sale exactamente como salía', () => {
    // Una firma vacía no puede convertirse en dos saltos de línea al final de
    // cada correo.
    expect(conFirma('Hola, ya salió tu pedido.', con())).toBe('Hola, ya salió tu pedido.')
    expect(conFirma('Hola.', con(''))).toBe('Hola.')
    expect(conFirma('Hola.', con('   '))).toBe('Hola.')
  })

  it('con firma, va al pie con el separador de siempre', () => {
    // `-- ` (con el espacio) es el separador que los clientes de correo
    // entienden: pliegan la firma en las respuestas en vez de citarla una y
    // otra vez.
    expect(conFirma('Ya salió tu pedido.', con('Pilar\n+54 11 5555-5555'))).toBe(
      'Ya salió tu pedido.\n\n-- \nPilar\n+54 11 5555-5555',
    )
  })

  it('no deja líneas en blanco de más entre el cuerpo y la firma', () => {
    expect(conFirma('Gracias.\n\n\n', con('Pilar'))).toBe('Gracias.\n\n-- \nPilar')
  })

  it('lee la firma de la conexión, que es por buzón', () => {
    // Un comercio puede tener ventas y posventa, y no firman igual.
    expect(firmaDe(con('  Ventas · Pilar  '))).toBe('Ventas · Pilar')
    expect(firmaDe(con())).toBe('')
  })
})
