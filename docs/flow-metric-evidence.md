# Métricas de Flujos y evidencia autorizada

El mapa de entradas ya existe. La revisión detectó que su endpoint contaba las páginas de REST recibidas como si fueran el conjunto completo, y que una consulta fallida podía mostrarse como cero. La ampliación agrega en PostgreSQL todas las ejecuciones y entradas registradas del período autorizado. Mantiene el editor, el mapa y el historial existentes.

La cohorte comprende ejecuciones iniciadas en `[desde, hasta)`, con negocio, contacto, conversación y conexión coherentes y acceso actual del actor. Excluye fuentes eliminadas o no verificables. Los correos personales permanecen limitados al propietario de la conexión, también para administradores. Se comprueban las secciones actuales de Menús y Bandeja. No se anuncia como todo el historial del negocio si una fuente ya no es accesible.

Una entrada de nodo es un evento registrado: un mismo turno puede entrar varias veces. Una ejecución completada indica que terminó el flujo, sin demostrar entrega de cada mensaje, aceptación de una acción externa o resolución comercial. Los estados actuales y las entradas tienen contadores separados y ninguna cifra atribuye dinero o causalidad.

El resumen usa hasta noventa días, con ventanas explícitas y filtros estrictos. El detalle devuelve veinte ejecuciones por página, con cursor compuesto de timestamp completo y UUID. Filtrar un nodo muestra ejecuciones con una entrada registrada en ese nodo; no convierte visitas repetidas en clientes distintos. Los filtros del detalle no alteran el resumen de la cohorte. Cada solicitud es una lectura actual, sin prometer un snapshot congelado entre páginas.

Los registros contienen solo referencia técnica, caso, estado y fechas. No incluyen nombres, teléfonos, variables, respuestas HTTP ni payloads. Abrir el caso aplica de nuevo los permisos de Bandeja. La exportación conserva el resumen observado y su ventana; no consulta una nueva cohorte ni descarga datos de clientes.

Implementada y validada junto a evaluaciones de reglas: 307 pruebas en 26 archivos, incluidas 23 pruebas PostgreSQL específicas y una cohorte superior a mil ejecuciones. Lint sin errores y builds completos normal/comparación correctos. Migración 357 instalada y guard privado verificado. Publicación en curso; el control ampliado permanece oculto fuera de comparación. El plan de ejecución conserva la evidencia de despliegue por separado.
