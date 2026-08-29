import { describe, it, expect } from 'vitest';
import { prometeAveriguar } from './salida';

/**
 * La regla: la IA contesta con lo que sabe, y si no sabe, se escala a una
 * persona. Lo que no puede pasar es prometer que vuelve y que no vuelva nadie.
 *
 * El primer caso es textual, de producción: esa respuesta salió por Instagram
 * el 2026-08-28 a las 10:07 y trece horas después nadie había vuelto.
 */
describe('promesas de volver', () => {
  const SE_ESCALAN = [
    'Hola! El dato del país de fabricación no lo tengo a mano, así que no te lo quiero afirmar de memoria. Lo confirmo y te lo digo acá mismo.',
    'Eso lo averiguo y te digo enseguida.',
    'Estoy averiguando el estado de tu envío.',
    'No tengo ese dato con certeza, prefiero no decirte cualquier cosa.',
    'No puedo confirmarte esa información con seguridad.',
    'Prefiero no asegurarte algo que no sé.',
  ];

  for (const texto of SE_ESCALAN) {
    it(`escala: ${texto.slice(0, 45)}`, () => {
      expect(prometeAveriguar(texto)).toBe(true);
    });
  }

  /**
   * Y lo que NO es una promesa vacía: o ya es una respuesta, o es algo que el
   * sistema cumple solo (el aviso de despacho lo manda una automatización).
   * Escalar acá sería llamar a una persona por cada mensaje normal.
   */
  const NO_SE_ESCALAN = [
    'Te confirmo que tu pedido ya salió, llega en 48 horas.',
    'Apenas se despache te llega el número de seguimiento por acá.',
    'Recibí el comprobante y lo estamos verificando.',
    'El sérum es argentino, se fabrica en Buenos Aires.',
    'Sale $39.990 la unidad y el envío es gratis a todo el país.',
    '¡Gracias por tu compra! Cualquier cosa que necesites, escribime.',
    // El caso que obliga a que el detector sea angosto: acá SÍ verifica, y
    // contesta con el dato en el mismo mensaje. Silenciarlo sería romper una
    // respuesta buena y llamar a una persona sin motivo.
    'Voy a verificar tu pedido: el #52711 figura pagado y sale mañana.',
    'Déjame revisar el stock… quedan 4 unidades, así que podés pedirlo hoy.',
    'Ya lo confirmé: el envío a Córdoba tarda 3 días hábiles.',
  ];

  for (const texto of NO_SE_ESCALAN) {
    it(`sigue normal: ${texto.slice(0, 45)}`, () => {
      expect(prometeAveriguar(texto)).toBe(false);
    });
  }
});
