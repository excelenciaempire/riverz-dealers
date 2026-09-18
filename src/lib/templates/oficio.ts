/**
 * Cómo se escribe un mensaje de WhatsApp que se lee.
 *
 * Vive en un solo lugar porque hay dos que escriben plantillas —el especialista
 * del Operador y el botón «Escribir con IA» del editor— y dos oficios distintos
 * es tener dos productos.
 *
 * Las cifras no son de opinión. Salen de medir plantillas de WhatsApp Business:
 * el largo donde cae la lectura completa, cuántos emojis empiezan a leerse como
 * spam, y cuánto rinde un botón contra «respondé este mensaje». Están acá
 * escritas como reglas porque un modelo sigue una regla con un número mucho
 * mejor que un consejo.
 *
 * La regla de los bloques está además cableada en `forma.ts`: el cuerpo que
 * escribe Riverz pasa por ahí antes de guardarse. Un párrafo compacto que se
 * cuela no llega a Meta, porque una plantilla aprobada ya no se corrige gratis.
 */
/**
 * Lo que Meta hace con una plantilla según su categoría. No es estilo: decide
 * si el mensaje LLEGA.
 *
 * Aprendido con clientes reales el 2026-09-18: Rasmiaw mandaba tres plantillas
 * de MARKETING en 27 horas a cada pedido contra entrega y Meta topaba el 2.º y
 * el 3.º (código 131049, "healthy ecosystem engagement": a quien no contesta
 * le limita el marketing que recibe). Los mismos mensajes escritos como
 * UTILIDAD —sin descuento en el texto— no tienen ese tope. Lo lee el redactor
 * del editor, el especialista de plantillas del Operador y el de
 * automatizaciones, para que los tres decidan lo mismo.
 */
export const REGLAS_META_CATEGORIA = `LA CATEGORÍA DECIDE SI EL MENSAJE LLEGA

Meta clasifica cada plantilla y la trata distinto según la categoría:

- **UTILIDAD**: habla de algo que la persona ya hizo o ya tiene —un pedido, un
  pago, un envío, una cita, una cuenta— y le pide o le informa algo sobre ESO:
  confirmar los datos, avisar que salió, recordar un pago pendiente, pedir que
  elija forma de pago. No tiene tope por persona, cuesta menos, y si la
  conversación ya está abierta (la persona escribió hace menos de 24 h) sale
  gratis.
- **MARKETING**: invita a comprar algo nuevo o a volver: descuentos, ofertas,
  novedades, carritos abandonados, "última oportunidad", cupones. Meta LIMITA
  cuántos mensajes de marketing recibe cada persona y baja ese tope a quien no
  contesta: el segundo o el tercero en pocas horas se rechaza (código 131049,
  "no entregado para mantener un ecosistema sano"). No se entrega a números de
  Estados Unidos. Necesita consentimiento previo.

Reglas que salen de ahí:

1. **Un descuento en el texto vuelve marketing la plantilla**, elija lo que
   elija quien la crea: Meta la recategoriza o la rechaza. Si el objetivo es
   confirmar o recordar un pedido, se escribe como UTILIDAD, sin oferta, y el
   beneficio se lo cuenta el asistente cuando la persona responde (ya con la
   conversación abierta, sin plantilla y sin tope).
2. **En una secuencia, nunca dos marketing seguidas a la misma persona en 48
   horas.** Lo que persuade puede ir en la primera; los recordatorios van como
   utilidad ("tu pedido sigue pendiente de confirmación", "¿mantienes tu pago
   contra entrega?").
3. **Si Meta topó el marketing a una persona hoy, no se insiste:** el sistema
   pausa 24 horas las de marketing a esa persona; las de utilidad siguen.
4. **Los botones de respuesta rápida son el camino de vuelta.** El texto dice
   con claridad qué hace cada botón ("Responde MANTENER CONTRAENTREGA para
   confirmar"), porque el asistente reconoce esas palabras.
5. Una plantilla aprobada no se edita: cada cambio es una plantilla nueva con
   otro nombre y otra aprobación. Se piensa antes de mandar.`

export const OFICIO_PLANTILLA = `CÓMO SE ESCRIBE UN MENSAJE QUE SE LEE

Esto no es un email ni un cartel: es un chat, y del otro lado hay alguien que ya
recibe demasiados. Lo que decide si lo lee o lo archiva:

- **Los saltos de línea, siempre.** El cuerpo va SIEMPRE en dos o tres bloques
  separados por una LÍNEA EN BLANCO. Un solo párrafo no es una opción, ni
  siquiera si es corto: un bloque de seis renglones dentro de una burbuja de
  chat no se lee, se archiva. Una idea por bloque, ningún bloque de más de tres
  renglones, y nunca dos líneas en blanco seguidas.
- **El largo.** Marketing: entre 100 y 250 caracteres. Utilidad: entre 80 y 160.
  Pasando los 300 cae de forma medible cuánta gente lo lee entero. Si no entra,
  es que sobra algo.
- **El nombre, arriba.** "Hola {{1}}," y a otra cosa. El cuerpo NUNCA empieza ni
  termina con una variable — Meta rechaza la plantilla entera— y nunca va un
  salto de línea ni un espacio de más DENTRO de {{1}}.
- **Un emoji, dos como mucho.** Van como ancla de un renglón, no de adorno. De
  tres para arriba se lee como spam y le baja la calidad a la plantilla.
- **Negrita en dos o tres cosas.** Con asteriscos: *así*. El precio, la fecha, el
  nombre del producto. Todo en negrita es nada en negrita.
- **Los botones son parte del mensaje**, no un extra. Un botón rinde mucho más
  que "responde este mensaje". Hasta tres: una respuesta rápida ("Quiero
  reponerlo", "Cuéntame más") o un enlace. Escribe el botón como lo diría quien
  contesta, no como una orden.
- **Una sola acción.** Dos llamados a la acción son ninguno.

QUÉ HACE QUE CONTESTEN

Persuade el que dice algo que la otra persona no sabía, no el que insiste. Los
tres bloques son, en este orden:

1. **El motivo de hoy.** Por qué se le escribe JUSTO ahora y no la semana
   pasada: se le está por acabar el frasco, el pedido quedó reservado, el pago
   no pasó. Sin motivo es publicidad; con motivo es un aviso útil, y un aviso
   útil se lee.
2. **Un dato concreto y lo que gana.** Un número, un plazo, el nombre del
   producto. "Rinde unas *6 semanas*" convence; "excelente calidad" no dice
   nada. Un solo beneficio, el que más pesa, dicho como lo diría quien compra —
   y cuando es verdad, qué se pierde si no hace nada: cortar el tratamiento a la
   mitad, quedarse sin el talle. Sin dramatizar y sin urgencia inventada.
3. **La acción, fácil.** Una pregunta que se contesta con un toque: "¿Te lo
   mando?", "¿Lo terminamos?". Nunca una orden de compra ("COMPRA YA").

**Si el encargo trae una oferta, ésa es la primera línea.** Un descuento no se
menciona al pasar al final: es el motivo por el que se escribe, y va con el
número en negrita. Si el encargo NO trae ninguna, no la inventes y no la pidas
en el mensaje: se escribe desde el producto, que persuade igual.

Lo que NO va: "esperamos que estés bien", "no dudes en consultarnos", "no te lo
pierdas", "última oportunidad" cuando no lo es, signos de admiración repetidos,
MAYÚSCULAS para gritar, y prometer un descuento, un plazo o un precio que nadie
te dio.

EJEMPLO — recompra de un serum, a las tres semanas

  Hola {{1}}, tu *Serum de Rosa Mosqueta* rinde unas *6 semanas* y ya vas por la
  mitad del frasco. 🌿

  Si pides ahora te llega antes de que se te acabe, y no cortas el tratamiento
  a mitad de camino.

  ¿Te mando otro?

  [ Pedir otro ]  [ Ver el producto ]

Tres bloques con una línea en blanco entre cada uno, un emoji, dos negritas y
una sola acción. Y fíjate en lo que NO tiene: ningún descuento, ningún plazo,
ninguna promoción. Nadie se los dio. Lo que persuade es saber cómo funciona el
producto —cuánto rinde, qué pasa si se corta— y eso está siempre disponible: se
lo pides al de productos.

Palabras del comercio que el cliente no usa y no van en el mensaje: reposición,
recompra, retención, carrito abandonado, ticket. Se dicen como las diría quien
compra: "pedir otro", "volver a pedir", "lo que dejaste sin comprar".

${REGLAS_META_CATEGORIA}`
