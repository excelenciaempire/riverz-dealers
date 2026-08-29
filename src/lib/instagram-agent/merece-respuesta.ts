/**
 * ¿ESTE COMENTARIO MERECE RESPUESTA AUNQUE NO QUIERA COMPRAR?
 *
 * OJO CON EL ALCANCE (2026-08-28). Esto decide CÓMO se contesta un comentario
 * que llegó hasta acá, y no si se oculta. Lo que el clasificador manda a spam
 * —el insulto, la autopromo, el ataque a la marca— se oculta antes y no pasa
 * por esta función: es una decisión del comercio, no un descuido. Ver
 * `autonomousCommentReply` en `realtime.ts`.
 *
 * El filtro "Solo a quien quiere comprar" existe para no perseguir por privado
 * al que sólo dejó un emoji. Pero se llevaba puesto algo distinto: la pregunta
 * concreta y el reclamo de post-venta, que no son intención de compra y sí
 * merecen respuesta. Un "no me llegó el pedido" debajo de una foto no es un
 * cliente frío: es un problema sin resolver a la vista de todos.
 *
 * Eso es lo que arregla esta función, y sólo eso. La hostilidad pura —"dejen de
 * mentir, bastaaaa"— no llega hasta acá: la ataja el clasificador de spam, que
 * la oculta y no la contesta. Contestarle subiría el hilo y le daría tribuna
 * delante de todos los que pasan por la publicación.
 *
 * El motivo que devuelve viaja al prompt: contestar una duda sobre la marca no
 * se escribe igual que contestar un reclamo de un pedido.
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
export type MotivoRespuesta = 'duda' | 'reclamo' | 'pregunta' | 'legal';

/**
 * Lo que hay que contestar CON CUIDADO: cómo se hizo la publicidad, si el
 * producto está aprobado o registrado, y cualquier cosa con olor a juicio.
 *
 * Se contesta igual —el agente ES el equipo y derivar es no contestar—, pero
 * sólo con lo que de verdad se sabe. Lo que no está cargado no se completa de
 * memoria: se dice que se confirma y se pasa.
 *
 * No es prudencia de más. Puesto a redactar estas respuestas contra la base de
 * producción el 2026-08-28, el agente escribió, para publicar debajo de la
 * foto:
 *
 *   "No mezclamos nada, las fotos y testimonios son reales de clientas."
 *   "No usamos IA para mostrar resultados, son testimonios reales."
 *   "Y no tenemos aprobación ANMAT, es un cosmético, no un medicamento."
 *
 * Las tres son afirmaciones que el agente no puede saber y que comprometen a
 * la marca ante un regulador o un juez. La tercera además declara en público
 * que el producto no tiene una aprobación — un renglón que cualquiera captura.
 * Nadie le pidió que mintiera: le preguntaron y contestó, porque un modelo
 * siempre prefiere contestar antes que decir que no sabe. La salida no es
 * mandarla a esperar a otro —eso es no contestar con buenos modales— sino
 * prohibirle afirmar y negar lo que no le consta, y dejarle decir en primera
 * persona que lo confirma.
 */
const LEGAL = [
  'anmat', 'invima', 'registro sanitario', 'aprobación', 'aprobacion',
  'aprobado', 'aprobada', 'certificado', 'certificación', 'certificacion',
  'habilitado', 'habilitación', 'habilitacion', 'permiso', 'licencia',
  'juicio', 'demanda', 'denuncia', 'abogado', 'defensa del consumidor',
  'publicidad engañosa', 'publicidad enganosa', 'publicidades falsas',
  'hecho con ia', 'hechos con ia', 'generado con ia', 'generada con ia',
  'con inteligencia artificial', 'rostros', 'actrices', 'actores',
  'testimonios falsos', 'antes y después falso',
  'fda', 'lawsuit', 'ai generated', 'deepfake',
];

/**
 * "IA" suelta, que es como lo escribe casi todo el mundo: "tanta IA en
 * publicidades", "eso es con IA", "I.A.". Con `includes` no se puede —
 * atraparía familia, día, media—, así que va por límite de palabra.
 */
const IA_SUELTA = /(^|[^a-záéíóúñ])(i\.?\s?a\.?|inteligencia artificial)([^a-záéíóúñ]|$)/i;

/**
 * Interrogativos que no se pueden leer como reproche. Es `PREGUNTA` sin "qué"
 * ni "porque": con esos dos empieza tanto la consulta como la acusación.
 */
/**
 * Hostilidad pura: no discute un dato, descalifica. No entra en `DUDA` a
 * propósito — `mereceRespuesta` tiene que seguir devolviendo `null` para
 * "dejen de mentir", porque contestarlo no ayuda a nadie. Acá sirve para lo
 * contrario: decidir que se oculta.
 */
const HOSTILIDAD = [
  'mentir', 'mentiras', 'trucha', 'truchas', 'trucho', 'truchos',
  'chanta', 'chantas', 'verguenza', 'vergüenza', 'basura', 'porqueria',
  'porquería', 'no le crean', 'no compren',
  // Insultos al contenido o a la marca. Estaban afuera y no deberían: el
  // 2026-08-28 "Qué video tan boludo!!!!!" pasó el filtro y quedó a la vista
  // debajo de la publicación. No discute ningún dato, así que no hay nada
  // que contestarle. Van con y sin tilde porque `normalizar` no las saca y
  // la gente escribe de las dos formas.
  'boludo', 'boluda', 'pelotudo', 'pelotuda', 'idiota',
  'estupido', 'estupida', 'estúpido', 'estúpida',
  'ridiculo', 'ridicula', 'ridículo', 'ridícula',
  'pesimo', 'pesima', 'pésimo', 'pésima',
  'estafa', 'estafan', 'estafador', 'estafadores',
  'chamuyo', 'chamuyeros',
];

/**
 * El reproche por la CONDUCTA de la marca, que no usa ninguna palabra
 * hostil y por eso se colaba entero.
 *
 * Tres comentarios en dos días sobre la misma publicación decían la misma
 * cosa —"no deberías hablar mal de otras marcas"— y a dos de ellos se les
 * contestó en público, que es justo lo que sube el hilo al principio.
 *
 * `horrible`, `asco` y `mala` quedan deliberadamente afuera de todas estas
 * listas: "tengo la piel horrible" es una clienta contando su problema, no
 * una crítica, y ocultarla sería perder la venta y taparle la boca.
 */
const REPROCHE = [
  'hablar mal', 'habla mal', 'hablan mal', 'hablas mal',
  'no deberia', 'no debería', 'no deberian', 'no deberían',
  'no deberias', 'no deberías',
];

const INTERROGATIVOS = [
  'cuando', 'cuándo', 'como', 'cómo', 'donde', 'dónde', 'cual', 'cuál',
  'quien', 'quién', 'puedo', 'puede', 'pueden', 'podrán', 'podran',
  'tienen', 'hay ', 'se puede', 'sirve', 'funciona', 'venden', 'llega',
];

/**
 * ¿ESTO ES UNA CRÍTICA PÚBLICA, DE LAS QUE SE OCULTAN Y NO SE CONTESTAN?
 *
 * Decisión del dueño, y hay que sostenerla: a la crítica se le saca la
 * tribuna, no se le da. Contestar sube el hilo, lo pone arriba en la
 * publicación y deja la acusación a la vista de todos los que pasan.
 *
 * La línea NO es "negativo o positivo": es VEREDICTO contra PREGUNTA.
 *
 *   "Qué manera de hacer publicidades falsas mezclando rostros"  → veredicto
 *   "¿El producto tiene aprobación de ANMAT?"                    → pregunta
 *
 * Los dos tocan las mismas palabras. El primero se oculta; el segundo es de
 * alguien que está evaluando comprar y merece una respuesta cuidada. Por eso
 * una pregunta nunca se oculta, por más incómoda que sea.
 *
 * Y un reclamo de post-venta tampoco: "no me llegó el pedido" es un problema
 * real de un cliente real. Ocultarlo sería taparle la boca a quien ya pagó.
 */
export function esCriticaPublica(texto: string): boolean {
  const t = normalizar(texto);
  if (t.length < 8) return false;
  // Quien pregunta no está acusando: contesta la duda, no la escondas.
  //
  // Acá NO sirve `esPregunta`: acepta cualquier frase que empiece con "qué", y
  // en español el reproche empieza igual que la pregunta. "Qué manera de hacer
  // publicidades falsas" no pregunta nada, y con `esPregunta` se salvaba de
  // ocultarse. Vale el signo, o un interrogativo que no admita esa lectura.
  if (t.includes('?') || t.includes('¿')) return false;
  if (INTERROGATIVOS.some((p) => t.startsWith(p))) return false;
  // Quien ya compró y tiene un problema se atiende, no se oculta.
  if (contiene(t, RECLAMO)) return false;
  return (
    contiene(t, DUDA) ||
    contiene(t, LEGAL) ||
    contiene(t, HOSTILIDAD) ||
    contiene(t, REPROCHE) ||
    IA_SUELTA.test(t)
  );
}

export function mereceRespuesta(texto: string): MotivoRespuesta | null {
  const t = normalizar(texto);
  // Un comentario de tres letras no es nada de esto.
  if (t.length < 8) return null;
  // Lo legal gana sobre todo lo demás: es lo que peor se puede contestar.
  if (contiene(t, LEGAL) || IA_SUELTA.test(t)) return 'legal';
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
    // Contestas TÚ. Nunca "te responde una persona del equipo": la IA es el
    // equipo, y mandar a alguien a esperar a otro es la forma elegante de no
    // contestar. Lo que no se puede es inventar, que no es lo mismo. El propio
    // `borrador.ts` ya tenía "un agente del equipo" en su lista de frases
    // prohibidas, así que derivar además se contradecía con el resto.
    'Contesta TÚ. Nunca digas que el tema lo ve "una persona del equipo", "alguien del equipo" ni "un agente": eres el equipo, y derivar es no contestar.',
    'Si te piden un dato que no tienes (un registro sanitario, un certificado, un estudio), la respuesta honesta va en primera persona: ese dato no lo tienes a mano, lo confirmas y se lo pasas. Nunca lo inventes, nunca lo aproximes y nunca lo cambies por una derivación.',
  ];
  switch (motivo) {
    case 'legal':
      return [
        '## Te preguntan por un registro, una aprobación o cómo se hizo la publicidad',
        ...comun,
        'Si el dato está en la información del producto o en las reglas del negocio, dilo con esas palabras: es lo que sabes, y contestarlo es tu trabajo.',
        'Si NO está, no lo completes de memoria: no digas que el producto tiene la aprobación ni que no la tiene, no digas que la publicidad es real ni que no usa IA. Dile en una línea que ese dato lo confirmas y se lo pasas, y sigue con lo que sí puedas responderle.',
        // Sin esto el modelo repite el MOTIVO como si fuera el guion: en la
        // prueba del 2026-08-28 le contestó a una clienta "no hice esa
        // publicidad", que despega a la marca de su propio anuncio y suena a
        // excusa. Las razones son para vos, no para el cliente.
        'NO le expliques por qué no lo sabes. Nada de "no hice esa publicidad", "no tengo forma de saberlo", "no quiero afirmar algo que no sé": eso despega a la marca de su propio contenido y suena a excusa. Se dice qué vas a hacer, no por qué no puedes.',
        'Tampoco arranques todas las respuestas igual ("tomo el comentario"): responde a lo que dijo.',
        'Y registra lo que no supiste contestar con la herramienta que tienes para eso: así el comercio lo carga una vez y la próxima lo contestas tú.',
        'La publicación es de la tienda: nunca digas "eso no lo manejamos nosotros" ni "es contenido del video".',
      ].join('\n');
    case 'duda':
      return [
        '## Están dudando de la marca en público',
        ...comun,
        'Reconoce lo que dice sin pelear, y responde tú con lo que sí sabes. Callarse acá se lee como que no hay nada que decir.',
      ].join('\n');
    case 'reclamo':
      return [
        '## Es un reclamo, a la vista de todos',
        ...comun,
        'Lo primero es que se sienta escuchada; lo segundo, llevarlo al privado —que es donde se resuelve y donde puede dar sus datos sin publicarlos— y resolverlo TÚ ahí, no anunciar que lo verá otro.',
      ].join('\n');
    case 'pregunta':
      return [
        '## Es una pregunta, no una compra',
        ...comun,
        'Contesta lo que preguntó y nada más. Si la respuesta ya está dada, se termina ahí.',
      ].join('\n');
  }
}

/**
 * ¿LA RESPUESTA AFIRMA ALGO QUE NO PUEDE SOSTENER?
 *
 * La prohibición estaba escrita en el prompt y aun así se coló: el modelo de
 * los agentes está fijado a Haiku por decisión de producto, y con una lista
 * larga de reglas se le escapan las del final. En la prueba del 2026-08-28
 * escribió, para publicar bajo la foto:
 *
 *   "La idea es mostrar mujeres reales, no una máquina hablando."
 *   "No es mentira, el efecto es real con uso continuo."
 *
 * Una regla que el modelo puede desobedecer no es una regla. Acá se comprueba
 * el texto YA ESCRITO, y si afirma lo que no le consta la respuesta no sale:
 * el comentario queda para una persona. Callarse es recuperable; publicar que
 * los testimonios son reales o que el efecto está garantizado, no.
 */
const AFIRMACIONES_PROHIBIDAS: RegExp[] = [
  // "mujeres reales", "testimonios reales": el adjetivo pegado al sustantivo,
  // que es como salió en la prueba y no lo cazaba el patrón con verbo.
  /\b(testimonios?|fotos?|im[áa]genes?|videos?|resultados?|mujeres|personas|rostros|clientas?|casos?)\s+(reales?|de verdad|genuinas?|genuinos?|aut[ée]nticas?|aut[ée]nticos?)\b/i,
  // "son reales", "es real", "son de verdad" cerca de lo que se muestra.
  /\b(testimonios?|fotos?|im[áa]genes?|videos?|resultados?|efectos?|antes y despu[ée]s|mujeres|personas|rostros)\b[^.!?]{0,60}\b(son|es|est[áa]n?)\b[^.!?]{0,20}\b(reales?|de verdad|genuinos?|aut[ée]nticos?)\b/i,
  /\b(no|nunca)\b[^.!?]{0,30}\b(usamos|usan|se us[óo]|hay|es)\b[^.!?]{0,20}\b(ia|inteligencia artificial|m[áa]quina)\b/i,
  // Afirmar o negar una aprobación.
  /\b(s[íi]|no)\b[^.!?]{0,20}\b(tenemos|tiene|cuenta con|est[áa])\b[^.!?]{0,20}\b(aprobaci[óo]n|anmat|invima|registro sanitario|certificado)\b/i,
  /\b(anmat|invima)\b[^.!?]{0,30}\b(aprobad|habilitad|registrad)/i,
  // Prometer el efecto.
  /\b(el|los)\s+(efectos?|resultados?)\b[^.!?]{0,30}\b(es|son|est[áa]n?)\b[^.!?]{0,20}\b(real|reales|garantizados?|seguros?)\b/i,
];

export function afirmaLoQueNoSabe(texto: string): boolean {
  const t = (texto ?? '').normalize('NFC');
  return AFIRMACIONES_PROHIBIDAS.some((re) => re.test(t));
}
