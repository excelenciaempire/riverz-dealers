# Recursos para los PDFs visuales de Riverz

Los dos PDFs se regeneran con `py -X utf8 scripts/build-riverz-visual-pdfs.py`.
El Word original permanece intacto; el generador lee sus ejemplos y presenta la guía
en lenguaje para clientes. Las notas internas de grabación no se incluyen.
Para actualizar solo la guía, usa `py -X utf8 scripts/build-riverz-visual-pdfs.py --guide-only`.
La guía tiene 13 páginas y se organiza por capacidades. Incluye 22 automatizaciones,
un mapa de 5 roles y 20 ejemplos breves en 5 páginas, incluidos comentarios,
campañas y llamadas. Cada sección va seguida inmediatamente de cuatro ejemplos
en una cuadrícula de dos columnas. No se repiten las
automatizaciones en listas de funciones de los agentes o escenarios resumidos.
Personalización y control se explican en una sola sección.
La portada contiene únicamente título, descripción e ilustración de marca.
La navegación se conserva en los marcadores del PDF; no hay índice en la portada
ni textos a la derecha del logo en ninguna página. Los diálogos llevan una nota de ejemplo ilustrativo.
Las conversaciones dibujadas son ejemplos ilustrativos, no métricas ni testimonios reales.
Los 20 ejemplos usan productos y situaciones diferentes: moda, accesorios,
tecnología, muebles, hogar, mascotas, deporte, joyería y libros. Las preguntas,
respuestas y referencias de pedidos varían sin cambiar la capacidad que ilustran.

## Orden editorial de la guía

Cada página responde una pregunta y prepara la siguiente; estas razones son
notas editoriales y no se añaden al PDF para clientes.

1. Portada: presenta el alcance sin cargar la entrada de información.
2. Asistentes: distingue automatizaciones y conversaciones, y presenta los cinco roles.
3. Antes de la compra: muestra cómo atender el interés y acompañar la decisión.
4. Ventas, ejemplos: recomendación, disponibilidad, cotización y compra de varias unidades.
5. Recuperación: continúa con la compra que quedó pendiente.
6. Recuperación, ejemplos: carrito, pago rechazado, transferencia y contra entrega.
7. Pedidos y logística: pasa a lo que ocurre después de confirmar una compra.
8. Pedidos, ejemplos: estado, dirección, demora y pedido no encontrado.
9. Postventa y retención: completa el recorrido con atención y nuevas compras.
10. Postventa, ejemplos: producto dañado, uso, reposición y compra complementaria.
11. Canales y alcance: amplía las capacidades a comentarios, campañas y llamadas.
12. Canales, ejemplos: comentario, mensaje privado, campaña y llamada.
13. Personalización y control: cierra con cómo se adapta a la marca y qué decide el equipo.

## Branding

- Fondo `#F3F0EB`, tinta `#12201F`, acento `#F7FF9E`.
- Instrument Serif para títulos; Instrument Sans para texto y seminegrita.
- Inter Tight para el logotipo original. Las licencias OFL están en `fonts/`.
- Los iconos de canales se reutilizan desde `public/channels/`.

## Ilustraciones

`riverz-flota-original.png` se extrajo del PDF comercial aportado por el dueño.

`riverz-control-humano.png` se creó el 29 de septiembre de 2026 con la herramienta integrada
`image_gen`, tomando como referencia visual la ilustración original. Se guardó en el proyecto
para que ningún PDF dependa de una ruta temporal o de una cuenta externa.

Prompt final utilizado:

> Use case: stylized-concept. Create one polished wide 3D illustration for a Spanish ecommerce AI company PDF. Style reference is the Riverz illustration visible in the conversation: soft clay miniature dark forest green friendly robot with luminous pale yellow face, cream retail objects, subtle warm shadows, minimal studio aesthetic. Create a DIFFERENT scene: one helpful green robot standing beside an elegant cream desktop monitor containing three simple chat bubbles, a small parcel and a tiny shipping pin in front; a friendly human store owner sits on the right reviewing a floating cream card with a green checkmark, visually communicating AI handling routine conversations and human approving a decision. Wide composition 3:2, all objects fully visible, lots of clean breathing room, warm solid pale cream background #F3F0EB, restrained lime #F7FF9E highlights and dark forest #12201F. Premium clay render, friendly adult professional mood. No lettering, no text, no logos, no watermark, no numbers. This is an illustration, not a screenshot or testimonial.

## Fuentes comerciales

Oferta y preguntas frecuentes consultadas el 29 de septiembre de 2026:
[Riverz](https://riverz.co). Primer mes US$259 (35% OFF publicado); después US$399/mes,
más saldo para consumo de IA. WhatsApp facturable por Meta, número y minutos de voz aparte.

La comparación visual conserva la columna Riverz destacada. Las alternativas también
ofrecen agentes, automatizaciones o servicios de implementación; el alcance varía por plan.
Referencias primarias: [Manychat](https://manychat.com/pricing),
[Kommo](https://www.kommo.com/es/precios/comparar-planes/),
[Leadsales](https://leadsales.io/blog/leadsales-que-es-como-funciona/).
