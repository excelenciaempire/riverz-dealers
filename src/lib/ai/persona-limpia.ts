/**
 * La persona del agente, sin la basura de un bug ya arreglado.
 *
 * La generación desde el producto hacía `String(x)` sobre listas que a veces
 * traen objetos (`{objection, rebuttal}`), y escribía "[object Object]" DENTRO
 * de la persona — o sea, dentro del prompt. Se arregló en el editor
 * (`researchText`), pero eso sólo protege a las personas que se generen desde
 * entonces: los agentes que ya lo tenían guardado lo siguen mandando en cada
 * respuesta. Medido en el asesor de Serum Pilar: "Maneja con tacto estas
 * objeciones comunes: [object Object]; [object Object]; [object Object]".
 *
 * Se limpia en los dos extremos: al armar el prompt (para que el modelo no la
 * lea) y al mostrarla en el panel (para que el comercio no la lea, y para que
 * su próximo guardado la deje limpia en la base). Módulo PURO por eso: el
 * editor es un componente de cliente y no puede importar el runner. Si al sacar la
 * lista la oración se queda sin contenido, se va entera — una instrucción vacía
 * ocupa lugar y no dice nada.
 */
export function limpiarPersona(persona: string): string {
  if (!persona.includes('[object Object]')) return persona.trim();
  return persona
    .split('\n')
    .map((linea) => {
      if (!linea.includes('[object Object]')) return linea;
      // Se cortan las oraciones que quedaron sin nada que decir.
      const limpio = linea
        .split(/(?<=\.)\s+/)
        .filter((oracion) => !oracion.includes('[object Object]'))
        .join(' ')
        .trim();
      return limpio;
    })
    .filter((linea, i, todas) => linea !== '' || (i > 0 && todas[i - 1] !== ''))
    .join('\n')
    .trim();
}
