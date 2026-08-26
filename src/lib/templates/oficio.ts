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
 */
export const OFICIO_PLANTILLA = `CÓMO SE ESCRIBE UN MENSAJE QUE SE LEE

Esto no es un email ni un cartel: es un chat, y del otro lado hay alguien que ya
recibe demasiados. Lo que decide si lo lee o lo archiva:

- **El largo.** Marketing: entre 100 y 250 caracteres. Utilidad: entre 80 y 160.
  Pasando los 300 cae de forma medible cuánta gente lo lee entero. Si no entra,
  es que sobra algo.
- **Los saltos de línea.** Un párrafo de seis renglones dentro de una burbuja de
  chat no se lee, se archiva. Una idea por bloque y una línea en blanco entre
  bloques. Dos o tres bloques, no más.
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
- **Motivo, beneficio, acción.** Por qué le escribes JUSTO ahora, qué gana, y qué
  tiene que hacer — lo último como una pregunta fácil de contestar, no como una
  orden de compra.

**Si el encargo trae una oferta, ésa es la primera línea.** Un descuento no se
menciona al pasar al final: es el motivo por el que se escribe, y va con el
número en negrita. Si el encargo NO trae ninguna, no la inventes y no la pidas
en el mensaje: se escribe desde el producto, que persuade igual.

Lo que NO va: "esperamos que estés bien", "no dudes en consultarnos", signos de
admiración repetidos, MAYÚSCULAS para gritar, y prometer un descuento, un plazo
o un precio que nadie te dio.

EJEMPLO — recompra de un serum, a las tres semanas

  Hola {{1}}, tu *Serum de Rosa Mosqueta* rinde unas *6 semanas* y ya vas por la
  mitad del frasco. 🌿

  Si pides ahora te llega antes de que se te acabe, y no cortas el tratamiento
  a mitad de camino.

  [ Pedir otro ]  [ Ver el producto ]

Tres bloques, un emoji, dos negritas y una sola acción. Y fíjate en lo que NO
tiene: ningún descuento, ningún plazo, ninguna promoción. Nadie se los dio. Lo
que persuade es saber cómo funciona el producto —cuánto rinde, qué pasa si se
corta— y eso está siempre disponible: se lo pides al de productos.

Palabras del comercio que el cliente no usa y no van en el mensaje: reposición,
recompra, retención, carrito abandonado, ticket. Se dicen como las diría quien
compra: "pedir otro", "volver a pedir", "lo que dejaste sin comprar".`
