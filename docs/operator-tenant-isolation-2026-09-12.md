# Operador: aislamiento por comercio

Validación del 12 de septiembre de 2026, posterior a `fbf7d403`.

La cuenta de Operador se resuelve en el servidor desde el usuario autenticado. Usa la misma prioridad de selección que la interfaz: comercio propio activo y, en su defecto, membresía más antigua. Ni el texto del usuario, ni un parámetro `workspace_id`, ni una cabecera pueden cambiar ese contexto. El catálogo de Operador no ofrece listado global de cuentas, SQL libre ni herramientas administrativas de plataforma.

## Refuerzos realizados

- Una conversación ajena o inexistente se rechaza. Antes, al enviarla en POST se creaba una nueva conversación propia; no se accedía a la ajena, pero el comportamiento ocultaba el identificador inválido.
- GET comprueba la pertenencia de la conversación antes de cargar historial, propuestas, planes y ejecución.
- Crear una regla de IA verifica que el agente pertenezca al comercio y no esté eliminado.
- Las actualizaciones del historial y de los resultados/propuestas de acciones añaden el filtro explícito del comercio, incluso cuando el identificador ya procedía de una consulta autorizada.

## Evidencia

- 594 pruebas aprobadas en 43 archivos de Operador, capacidades, selección de comercio y API.
- Pruebas de API con sesión simulada: cabecera y parámetro de cuenta falsificados no abren una conversación ajena; POST no inicia el modelo ni crea registros; una petición anónima no resuelve cuentas.
- Pruebas con registros de dos comercios: no se leen mensajes, acciones, planes ni ejecuciones ajenas; no se aprueban/rechazan acciones, reclaman planes, detienen ejecuciones ni borran conversaciones ajenas.
- La revisión de rutas de artefactos, deshacer y activar confirma el filtro por cuenta autenticada antes de obtener la acción.
- Inspección real de relaciones: 59 mensajes, 57 acciones, 17 ejecuciones y 9 planes; cero enlaces a conversaciones de otro comercio. Solo se consultaron identificadores y pertenencia, no contenido de clientes.
- La versión `fbf7d403` está confirmada en `https://riverz.co/api/health`, con Supabase y WhatsApp en estado `ok`.

La validación visual no se realizó: la revisión automática de permisos rechazó el comando para abrir Chrome aislado con el motivo genérico `blocked by policy`. No se reintentó por otra vía ni se usó el Chrome personal. Las pruebas autenticadas de API usan sesiones simuladas, no una sesión real de navegador; no deben presentarse como un recorrido visual completo ni como un pentest exhaustivo.
