/**
 * ¿ESTE COMENTARIO MERECE RESPUESTA AUNQUE NO QUIERA COMPRAR?
 *
 * El filtro "Solo a quien quiere comprar" existe para no perseguir por privado
 * al que sólo dejó un emoji. Pero se estaba llevando puesto algo distinto: las
 * críticas y las preguntas que no son de compra.
 *
 * El 2026-08-28, debajo de un mismo post, quedaron sin contestar:
 *
 *   "Muchos posteos con IA. No confío. ¿Podrán mostrar aprobación de ANMAT?"
 *   "No deberías hablar mal de otras marcas"
 *   "Qué manera de hacer publicidades falsas mezclando rostros…"
 *
 * Ninguna quiere comprar, así que las tres se descartaron. Pero un reclamo sin
 * responder debajo de una publicación se lee como que no hay nada que decir, y
 * la primera además hacía una pregunta concreta que la marca puede contestar.
 * Callarse ahí cuesta más que cualquier DM no enviado.
 *
 * Lo que NO entra: la hostilidad pura. "Dejen de mentir, bastaaaa" no tiene
 * pregunta ni afirmación que aclarar, y contestarle sube el hilo a la vista de
 * todos sin ayudar a nadie. Es un juicio distinto del de un reclamo con
 * contenido.
 */

/** Palabras que indican que se está poniendo en duda a la marca o el producto. */
const DUDA = [
  'no confío', 'no confio', 'desconfío', 'desconfio', 'estafa', 'engaño',
  'engano', 'falso', 'falsa', 'falsos', 'falsas', 'mentira', 'miente',
  'mienten', 'publicidad engañosa', 'publicidad enganosa', 'timo', 'fraude',
  'anmat', 'invima', 'registro sanitario', 'aprobación', 'aprobacion',
  'certificado', 'demanda', 'juicio', 'denuncia', 'ilegal',
  'no funciona', 'no sirve', 'no me sirvió', 'no me sirvio',
  'scam', 'fake', 'lawsuit', 'refund',
];

/** Un reclamo de post-venta: algo que ya se compró y salió mal. */
const RECLAMO = [
  'no me llegó', 'no me llego', 'no llegó', 'no llego', 'nunca llegó',
  'nunca llego', 'devolución', 'devolucion', 'reembolso', 'me cobraron',
  'cobraron de más', 'cobraron de mas', 'roto', 'rota', 'vino mal',
  'llegó mal', 'llego mal', 'defectuoso', 'vencido', 'sin respuesta',
  'nadie contesta', 'nadie responde', 'reclamo', 'queja',
];

/** Cómo empieza una pregunta cuando no lleva signo. */
const PREGUNTA = [
  'cuando', 'cuándo', 'como', 'cómo', 'donde', 'dónde', 'cual', 'cuál',
  'que ', 'qué ', 'quien', 'quién', 'por que', 'por qué', 'porque',
  'sirve', 'funciona', 'puedo', 'puede', 'pueden', 'podrán', 'podran',
  'tienen', 'hay ', 'se puede',
];

function normalizar(texto: string): string {
  return texto.toLowerCase().replace(/\s+/g, ' ').trim();
}

function contiene(hay: string, agujas: string[]): boolean {
  return agujas.some((a) => hay.includes(a));
}

/** ¿Hay una pregunta acá? Por el signo, o por cómo arranca la frase. */
export function esPregunta(texto: string): boolean {
  const t = normalizar(texto);
  if (!t) return false;
  if (t.includes('?') || t.includes('¿')) return true;
  return PREGUNTA.some((p) => t.startsWith(p));
}

/**
 * Por qué merece respuesta, o `null` si no la merece.
 *
 * El motivo viaja al prompt: contestar una duda sobre la marca no se escribe
 * igual que contestar un reclamo de un pedido.
 */
export type MotivoRespuesta = 'duda' | 'reclamo' | 'pregunta';

export function mereceRespuesta(texto: string): MotivoRespuesta | null {
  const t = normalizar(texto);
  // Un comentario de tres letras no es nada de esto.
  if (t.length < 8) return null;
  if (contiene(t, RECLAMO)) return 'reclamo';
  if (contiene(t, DUDA)) return 'duda';
  // Una pregunta suelta sólo cuenta si de verdad pregunta algo: sin esto,
  // "que lindo" entraba por empezar con "que".
  if (esPregunta(t) && (t.includes('?') || t.includes('¿'))) return 'pregunta';
  return null;
}

/**
 * Cómo contestar eso, en público y una sola vez.
 *
 * Va al prompt junto con las reglas de comentario público. La instrucción más
 * importante es la última: si la marca no puede probar lo que le piden, se
 * dice, no se improvisa un número de registro.
 */
export function instruccionPara(motivo: MotivoRespuesta): string {
  const comun = [
    'Esta persona NO está comprando: está cuestionando o preguntando algo. No le vendas nada, no cierres ofreciendo el producto y no la trates como una oportunidad.',
    'Una respuesta corta, tranquila y sin ponerse a la defensiva. No discutas, no ironices y no la contradigas dos veces: se contesta una vez y se deja ahí.',
    'Si te piden un dato que no tienes a mano (un registro sanitario, un certificado, un estudio), NO lo inventes ni lo aproximes: dile que te lo pasan por privado o que lo consulte con el equipo.',
  ];
  switch (motivo) {
    case 'duda':
      return [
        '## Están dudando de la marca en público',
        ...comun,
        'Reconoce lo que dice sin pelear, y responde con lo que sí sabes. Callarse acá se lee como que no hay nada que decir.',
      ].join('\n');
    case 'reclamo':
      return [
        '## Es un reclamo, a la vista de todos',
        ...comun,
        'Lo primero es que se sienta escuchada; lo segundo, llevarlo al privado, que es donde se resuelve y donde puede dar sus datos sin publicarlos.',
      ].join('\n');
    case 'pregunta':
      return [
        '## Es una pregunta, no una compra',
        ...comun,
        'Contesta lo que preguntó y nada más. Si la respuesta ya está dada, se termina ahí.',
      ].join('\n');
  }
}
