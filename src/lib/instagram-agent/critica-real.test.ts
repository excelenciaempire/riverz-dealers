import { describe, it, expect } from 'vitest';
import { esCriticaPublica } from './merece-respuesta';

/**
 * Los comentarios REALES que aparecieron bajo las publicaciones del comercio
 * piloto entre el 27 y el 28 de agosto de 2026, con lo que el sistema hizo con
 * cada uno ese día.
 *
 * Los tres primeros se contestaron en público —"No es la idea hablar mal de
 * nadie", "Lamento que no hayas visto el cambio"— porque la regla todavía no
 * existía. Contestar una crítica la sube al principio del hilo y la deja
 * discutiendo con la marca a la vista de todos; el dueño pidió lo contrario.
 *
 * Van acá con el texto textual, tildes incluidas, porque una regla escrita
 * contra ejemplos inventados no prueba nada: los casos que se escapan son
 * siempre los que nadie imaginó.
 */
describe('la crítica pública que llegó de verdad', () => {
  const SE_OCULTAN = [
    'No deberías hablar mal de otras marcas',
    'Exactos. Hablar mal sin fundamento y mostrar efectos en personajes hechos con IA.',
    'Uhy…. Se van a comer algunos juicios por hablar mal de otras marcas!!!😢',
    'Dejen de mentir, bastaaaa',
    'Qué video tan boludo!!!!!',
    'Creo que sí a vos no te resultó, no tienes porqué decir que las otras cremas no sirven,en especial Revitalift , yo la uso hace mucho y me encanta',
  ];

  for (const texto of SE_OCULTAN) {
    it(`oculta: ${texto.slice(0, 45)}`, () => {
      expect(esCriticaPublica(texto)).toBe(true);
    });
  }

  /**
   * Y lo que NO se puede tratar como crítica: quien pregunta está evaluando
   * comprar. Callarse con estos cuesta la venta, que es el error opuesto y
   * más caro que contestar de más.
   */
  const SE_CONTESTAN = [
    'Hola ! El Sérum es argentino ?',
    'Donde lo consigo en venezuela',
    'Hola no puedo ver precio. Se me tilda la página. Me pasarías por favor?',
    'Cuánto sale?',
    '¿Sirve para la papada?',
  ];

  for (const texto of SE_CONTESTAN) {
    it(`contesta: ${texto.slice(0, 45)}`, () => {
      expect(esCriticaPublica(texto)).toBe(false);
    });
  }
});
