/**
 * Que no se note que lo escribió una máquina.
 *
 * Un modelo de lenguaje escribe con dos tics que ninguna persona tiene cuando
 * le contesta a un cliente por WhatsApp o abajo de una foto: la raya larga
 * («—») para encajar una aclaración en medio de la frase, y el markdown
 * (asteriscos para negrita, viñetas, títulos) porque así escribe para todos
 * lados. Los dos delatan al robot en el mismo segundo, y el segundo encima se
 * ve roto: WhatsApp no interpreta la doble estrella, Instagram y TikTok
 * tampoco, así que al cliente le llega `**Envío gratis**` con los asteriscos
 * puestos.
 *
 * Dos capas, y las dos hacen falta:
 *
 *   1. `ESTILO_HUMANO` en el prompt, para que el modelo no lo escriba.
 *   2. `humanizarTexto()` sobre lo que devolvió, para cuando lo escribe igual.
 *
 * La segunda no es desconfianza gratuita: la regla del voseo lleva meses en el
 * prompt y el modelo se sigue yendo al voseo cada tanto. Una instrucción baja
 * la frecuencia, no la lleva a cero, y acá el que paga el error es el cliente
 * que lee el mensaje.
 *
 * **Dónde va.** En toda superficie donde el texto de un modelo termina leído
 * por una persona: la respuesta del agente, el borrador que alguien manda a
 * mano, el seguimiento, el DM de Instagram, la respuesta pública a un
 * comentario, el reescritor de la bandeja y el Operator. No va sobre las
 * salidas que se parsean (JSON de research, puntajes, intención): ahí el
 * formato es la estructura, no el estilo.
 */

/** El idioma de la instrucción. El resto del prompt está en español, pero un
 *  agente configurado en inglés lee mejor su regla de estilo en inglés. */
type IdiomaEstilo = 'es' | 'en';

/**
 * La regla, en español. Nombra la forma prohibida con el carácter a la vista:
 * sin el ejemplo, el modelo no sabe qué es «la raya larga».
 */
export const ESTILO_HUMANO_ES =
  'Escribe como escribe una persona en un chat: texto y nada más. Prohibido el markdown: sin asteriscos, sin negritas, sin viñetas, sin títulos, sin comillas alrededor del mensaje. Prohibida la raya larga («—») para meter una aclaración o separar ideas: usa una coma, un punto o dos frases. Nada de muletillas de manual ("Además", "Es importante destacar", "En resumen", "Espero que esto te ayude"). Si el texto se puede leer en voz alta tal como está, va bien.';

/** La misma regla, en inglés. */
export const ESTILO_HUMANO_EN =
  'Write the way a person writes in a chat: plain text, nothing else. No markdown: no asterisks, no bold, no bullet points, no headings, no quotes wrapping the message. Never use the em dash ("—") to slip in an aside or split ideas: use a comma, a period, or two sentences. No stock filler ("Additionally", "It is important to note", "In summary", "I hope this helps"). If it reads out loud as written, it is fine.';

/** La regla para el idioma del agente. */
export function estiloHumano(idioma: string | null | undefined): string {
  const corto = (idioma || 'es').toLowerCase().slice(0, 2) as IdiomaEstilo;
  return corto === 'en' ? ESTILO_HUMANO_EN : ESTILO_HUMANO_ES;
}

/** Alias corto para los prompts que ya están en español y no reciben idioma. */
export const ESTILO_HUMANO = ESTILO_HUMANO_ES;

/**
 * La variante del panel: el Operator y su equipo.
 *
 * Es la única superficie donde el markdown NO se ve roto: lo que el Operator
 * escribe se dibuja con `ui/texto-rico.tsx`, que interpreta la negrita y la
 * convierte en negrita de verdad. Ahí una cifra o el nombre de lo que acaba de
 * crear resaltados se leen mejor, y por eso el dueño las quiere.
 *
 * Lo que no cambia: la raya larga se va igual, y las negritas NO entran en lo
 * que se le escribe a un cliente. Cuando el equipo redacta una plantilla o el
 * mensaje de una automatización, ese texto sale por WhatsApp o por Instagram,
 * donde el asterisco se lee tal cual.
 */
export const ESTILO_HUMANO_PANEL =
  'Escribe como escribe una persona, no como un informe. Prohibida la raya larga («—») para meter una aclaración o separar ideas: usa una coma, un punto o dos frases. Nada de muletillas de manual ("Además", "Es importante destacar", "En resumen", "Espero que esto te sirva"). Usa negritas sólo en lo que importa: cifras, nombres de lo que creaste, estados. Nunca uses negritas ni ningún otro asterisco DENTRO de un texto que va a leer un cliente (una plantilla, el mensaje de una automatización, una respuesta de la bandeja): ahí no se interpretan y llegan como asteriscos a la vista.';

/**
 * ¿El prompt lleva la regla? Lo usan los tests para que ninguna superficie
 * nueva salga sin ella, igual que con los guardrails de negocio.
 */
export function tieneEstiloHumano(systemPrompt: string): boolean {
  return (
    systemPrompt.includes('Prohibida la raya larga') ||
    systemPrompt.includes('Never use the em dash')
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

/** Invisibles que viajan pegados al texto de un modelo y no significan nada:
 *  ancho cero, juntador de palabras, marca de orden de bytes. */
const INVISIBLES = /[\u200B-\u200D\u2060\uFEFF]/g;

/** El rombo con el signo de pregunta: lo que queda de una codificación rota. */
const CARACTER_ROTO = /\uFFFD/g;

/** Controles que no son salto de línea ni tabulación. */
const CONTROLES = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Espacios que no son el espacio: duro, fino, de cifra. */
const ESPACIOS_RAROS = /[\u00A0\u2007\u2009\u200A\u202F]/g;

/** Las rayas. NO entra el guion normal (`-`): «post-venta» se escribe así. */
const RAYAS = '[\\u2012\\u2013\\u2014\\u2015]';

/**
 * Le saca al texto de un modelo todo lo que lo delata, sin tocar lo que dice.
 *
 * Es idempotente y no rompe enlaces: el guion de una URL es un guion normal y
 * acá no se toca ninguno.
 */
export function humanizarTexto(entrada: string | null | undefined): string {
  if (!entrada) return '';
  let t = entrada.replace(/\r\n?/g, '\n');

  // 1. Basura invisible.
  t = t.replace(INVISIBLES, '').replace(CARACTER_ROTO, '').replace(CONTROLES, '');
  t = t.replace(ESPACIOS_RAROS, ' ');
  t = t.replace(/\u2212/g, '-');

  // 2. Bloques de código. El contenido se queda; las comillas de cerca, no.
  t = t.replace(/```[a-zA-Z0-9]*\n?([\s\S]*?)```/g, '$1');
  t = t.replace(/`([^`\n]+)`/g, '$1');

  // 3. Enlaces de markdown: al cliente le sirve la URL, no el corchete.
  t = t.replace(/\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)/g, '$2');

  // 4. Negritas e itálicas. El asterisco suelto («2 * 3») se salva porque los
  //    dos lados de adentro tienen que pegar con algo que no sea un espacio.
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '$1');
  t = t.replace(/(?<![A-Za-z0-9_])__([^_\n]+)__(?![A-Za-z0-9_])/g, '$1');
  t = t.replace(/\*(?!\s)([^*\n]+?)(?<!\s)\*/g, '$1');

  // 5. Estructura de documento: títulos, citas y líneas de separación. Un
  //    mensaje de chat no tiene nada de eso.
  t = t
    .split('\n')
    .filter((l) => !/^\s*([-*_=])\1{2,}\s*$/.test(l))
    .map((l) =>
      l
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        .replace(/^\s{0,3}>\s?/, '')
        // Viñeta: se va el símbolo, se queda la línea. Una lista sin viñetas
        // es lo que escribe una persona apurada; con viñetas es un informe.
        .replace(/^\s*[-*•·‣▪]\s+/, ''),
    )
    .join('\n');

  // 6. Las rayas. En el medio de una frase pasan a ser una coma, que es lo que
  //    hace una persona; al principio de una línea sobran y se van.
  t = t
    .split('\n')
    .map((l) => l.replace(new RegExp(`^\\s*${RAYAS}\\s*`), ''))
    .join('\n');
  t = t.replace(new RegExp(`(\\S)\\s*${RAYAS}\\s*(\\S)`, 'g'), '$1, $2');
  // Y la que quedó suelta contra un salto de línea o el final.
  t = t.replace(new RegExp(`\\s*${RAYAS}\\s*`, 'g'), ' ');

  // 7. Lo que dejó el paso anterior: comas duplicadas, coma antes de punto,
  //    espacio antes de un signo.
  t = t.replace(/,\s*,+/g, ',');
  t = t.replace(/,\s*([.;:!?)])/g, '$1');
  t = t.replace(/\s+([,.;:!?])/g, '$1');
  t = t.replace(/([¡¿(])\s*,\s*/g, '$1');

  // 8. Espaciado. Se conservan los saltos de párrafo: el modelo separa ideas
  //    con ellos y el chat los muestra bien.
  t = t
    .split('\n')
    .map((l) => l.replace(/[ \t]{2,}/g, ' ').trimEnd())
    .join('\n');
  t = t.replace(/\n{3,}/g, '\n\n');

  return t.trim();
}
