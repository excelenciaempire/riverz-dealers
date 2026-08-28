import { describe, it, expect } from 'vitest'
import { darFormaAlCuerpo } from './forma'

describe('darFormaAlCuerpo', () => {
  it('parte un párrafo largo en bloques con una línea en blanco', () => {
    const crudo =
      'Hola {{1}}, tu Serum de Rosa Mosqueta rinde unas 6 semanas y ya vas por la mitad del frasco. Si pides ahora te llega antes de que se te acabe y no cortas el tratamiento a mitad de camino. ¿Te lo mando?'
    const salida = darFormaAlCuerpo(crudo)
    expect(salida).toContain('\n\n')
    expect(salida.split('\n\n').length).toBeGreaterThanOrEqual(2)
    // No se pierde ni se agrega texto: sólo cambia la separación.
    expect(salida.replace(/\n+/g, ' ')).toBe(crudo)
  })

  it('no toca un cuerpo que ya trae saltos de línea', () => {
    const conForma = 'Hola {{1}}, te guardamos el carrito.\n\nLo retomas donde lo dejaste.'
    expect(darFormaAlCuerpo(conForma)).toBe(conForma)
  })

  it('deja en paz un renglón corto', () => {
    const corto = 'Tu código es 8421. Vence en 10 minutos.'
    expect(darFormaAlCuerpo(corto)).toBe(corto)
  })

  it('no parte una sola frase larga', () => {
    const unaFrase = `Hola {{1}}, ${'te escribimos para contarte algo bastante largo '.repeat(4)}y nada más`
    expect(darFormaAlCuerpo(unaFrase)).not.toContain('\n')
  })

  it('no corta dentro de un número con punto', () => {
    const conPrecio =
      'Hola {{1}}, tu pedido quedó reservado por 1.500 pesos y esperando la transferencia. Cuando la hagas, mándanos el comprobante por aquí y lo despachamos el mismo día.'
    const salida = darFormaAlCuerpo(conPrecio)
    expect(salida).not.toContain('1.\n')
    expect(salida).toContain('1.500 pesos')
  })

  it('nunca deja más de tres bloques', () => {
    const muchas = Array.from({ length: 9 }, (_, i) => `Esta es la frase número ${i + 1}.`).join(' ')
    expect(darFormaAlCuerpo(muchas).split('\n\n')).toHaveLength(3)
  })

  it('es idempotente', () => {
    const crudo =
      'Hola {{1}}, no pudimos procesar el pago de tu pedido. Suele ser el límite de la tarjeta o un dato mal escrito. ¿Lo intentamos con otro medio?'
    const una = darFormaAlCuerpo(crudo)
    expect(darFormaAlCuerpo(una)).toBe(una)
  })

  it('deja el cuerpo como estaba si los saltos no entran en el tope de Meta', () => {
    // 1024 justos: cualquier salto que se agregue lo pasa de largo.
    const largo = 'Una frase de relleno para llegar al tope. '.repeat(30).slice(0, 1024)
    expect(largo).toHaveLength(1024)
    expect(darFormaAlCuerpo(largo)).toBe(largo)
  })

  it('aguanta el vacío', () => {
    expect(darFormaAlCuerpo('')).toBe('')
    expect(darFormaAlCuerpo('   ')).toBe('')
  })
})
