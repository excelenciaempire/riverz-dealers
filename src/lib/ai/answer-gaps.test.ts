import { describe, it, expect } from 'vitest';
import { claveDePregunta } from './answer-gaps';

/**
 * La clave es lo único que hace accionable esta lista.
 *
 * Sin agrupar, doce personas preguntando lo mismo son doce tareas y la pantalla
 * no sirve para nada. Agrupadas son UN párrafo que falta escribir, y el número
 * de veces es lo que decide por dónde empezar.
 */
describe('claveDePregunta', () => {
  it('junta la misma pregunta escrita de distintas formas', () => {
    const esperada = claveDePregunta('¿Hacen envíos?');
    for (const forma of ['hacen envios', 'HACEN ENVÍOS', '  ¿Hacen  envíos?  ', 'Hacen envios!!']) {
      expect(claveDePregunta(forma), forma).toBe(esperada);
    }
  });

  it('no junta preguntas distintas', () => {
    expect(claveDePregunta('hacen envios')).not.toBe(claveDePregunta('hacen cambios'));
  });

  it('sobrevive a lo que no es texto normal', () => {
    expect(claveDePregunta('')).toBe('');
    expect(claveDePregunta('¿¿¿???')).toBe('');
    expect(claveDePregunta('🙂 envíos 🙂')).toBe('envios');
  });

  it('no crece sin límite', () => {
    // El texto lo escribe un desconocido y termina en un índice.
    expect(claveDePregunta('a'.repeat(1000)).length).toBeLessThanOrEqual(200);
  });
});
