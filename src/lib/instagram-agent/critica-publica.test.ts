import { describe, it, expect } from 'vitest';
import { esCriticaPublica } from './merece-respuesta';

/**
 * La línea entre lo que se oculta y lo que se contesta.
 *
 * Los casos de abajo NO son inventados: son comentarios reales de la cuenta de
 * Pilar, leídos de producción el 2026-08-28. Los tres primeros del segundo
 * bloque son los que el agente contestó en público estando ya ocultos.
 */
describe('esCriticaPublica', () => {
  it('oculta el veredicto sobre la marca', () => {
    for (const t of [
      'Qué manera de hacer publicidades falsas mezclando rostros….',
      'Dejen de mentir, bastaaaa',
      'Basta de tanta IA en publicidades. Hace que creamos menos!!!',
      'Exactos. Hablar mal sin fundamento y mostrar efectos en personajes hechos con IA.',
      'A mi no me sirvió para nada la que promocionas',
      'Que mentira esa foto, no quiero pensar lo truchas q debe ser la crema',
      'Uhy…. Se van a comer algunos juicios por hablar mal de otras marcas!!!',
    ]) {
      expect(esCriticaPublica(t), t).toBe(true);
    }
  });

  it('NO oculta a quien pregunta, por incómoda que sea la pregunta', () => {
    for (const t of [
      '¿El producto tiene aprobación de ANMAT?',
      'Hola! El Sérum es argentino ?',
      '¿Esto funciona de verdad?',
      'Cuanto sale el serum',
    ]) {
      expect(esCriticaPublica(t), t).toBe(false);
    }
  });

  it('NO oculta el reclamo de alguien que ya compró', () => {
    for (const t of [
      'No me llegó el pedido y nadie contesta',
      'Quiero la devolución, el frasco vino roto',
      'Me cobraron de más y no responden',
    ]) {
      expect(esCriticaPublica(t), t).toBe(false);
    }
  });

  it('NO oculta un comentario cualquiera', () => {
    for (const t of ['Que lindo 😍', 'Lo quiero!!', 'Me encanta el aroma']) {
      expect(esCriticaPublica(t), t).toBe(false);
    }
  });
});
