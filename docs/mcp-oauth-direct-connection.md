# Conexión personalizada MCP con OAuth

Entrada: https://riverz.co/ajustes?tab=mcp. Servidor: https://riverz.co/api/mcp.

## Recorrido

Dos acciones principales: ChatGPT y Claude. Tres pasos: añadir la app, autorizar la identidad de la sesión de Riverz y comprobar mediante una llamada real a `comprobar_conexion`. La comprobación dura 15 minutos, pertenece a un usuario y workspace, y necesita un token OAuth vigente. `initialize`, copiar la URL o actividad reciente no prueban la instalación. Los tokens y comandos quedan en configuración avanzada.

Claude permite precargar nombre y URL en su formulario. Se verificaron ambos campos y su aviso de confianza en una sesión real; no se oculta ese aviso. ChatGPT abre `/plugins`: `+ → Create MCP App`, nombre Riverz, URL del servidor y OAuth. Se verificó ese formulario; no se encontró una precarga oficial de nombre/URL. La dirección se copia desde Riverz.

Si existe una conexión con la misma URL se reutiliza. Riverz no tiene una API para enumerar/modificar la configuración privada de estos clientes: el recorrido indica cómo reutilizarla y nunca sustituye otros servidores. No se envía ninguna solicitud al directorio público ni se aceptan condiciones de publicación.

## Superficies y disponibilidad

- Claude web comparte conectores con Desktop y Claude Code cuando se usa la misma cuenta de Claude y su política lo permite. Claude Code con API key, Bedrock, Vertex o determinados tokens de configuración no recibe esos conectores. Una entrada local de igual URL tiene prioridad; añadir configuración local no instala el conector web.
- ChatGPT web y la configuración MCP local de Codex son recorridos distintos. Los clientes de escritorio, CLI e IDE en el mismo equipo pueden compartir la configuración local de Codex; esto no prueba sincronización con ChatGPT web.
- ChatGPT puede requerir modo desarrollador y permisos del workspace. Claude Team/Enterprise requiere que un propietario añada el conector, y que cada persona autorice su propia identidad. No se promete acceso cuando el cliente o la organización lo bloquea.

## Seguridad

Descubrimiento protegido RFC 9728, metadata OAuth, DCR, PKCE S256, redirect exacto y resource canónico. `initialize` sin credenciales recibe HTTP 401 y `WWW-Authenticate`. Tokens opacos almacenados como hashes, acceso de una hora, refresh rotativo con vigencia de 30 días y revocación RFC 7009. Reutilizar un refresh revocado invalida el grant de ese usuario, cliente y workspace. La membresía y las secciones se consultan en cada petición; errores de consulta deniegan acceso. Un miembro sin rol administrador nunca recibe escritura.

Migración: `324_mcp_connection_checks.sql`, con RLS sin políticas de navegador. Aplicador: `scripts/apply-mcp-connection-checks-schema.mjs`; usa la Management API de Supabase sin imprimir credenciales. Infraestructura vigente: Render y Supabase; no Vercel.

## Evidencia y fuentes oficiales (30 septiembre 2026)

Pruebas de transporte/auth en `src/lib/mcp/auth-flow.test.ts`: separación de usuarios incluso en el mismo equipo, permisos, errores de consulta, PKCE, redirect/resource, expiración, refresh, revocación y comprobación autenticada.

- https://developers.openai.com/plugins/build/auth
- https://developers.openai.com/plugins/deploy/connect-chatgpt
- https://learn.chatgpt.com/docs/extend/mcp?surface=cli
- https://code.claude.com/docs/en/mcp
- https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
- https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities
- https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization

La comprobación de formularios de los proveedores y las pruebas del servidor no equivalen por sí solas a una llamada de herramienta desde cada cliente. Registrar por separado cualquier validación de instalación completa.

## Validación en producción

Cambios de aplicación publicados en Render: `dd5acd71`, `18b1642c` y `2567f277`. Migración 324 aplicada antes del despliegue.

- 79 pruebas MCP pasan; ESLint y TypeScript de los archivos afectados pasan. El build de Render se publicó correctamente. El chequeo TypeScript local del repositorio completo agotó el heap predeterminado; no se usa como evidencia de aprobación.
- 35 comprobaciones contra `https://riverz.co`: descubrimiento, DCR, sesiones de dos usuarios temporales, PKCE, rechazo de replay, llamada real, separación de usuarios, refresh rotativo, revocación, permisos de un agente y retirada de membresía. Identidades y datos temporales eliminados al terminar.
- Comprobación final del ajuste `2567f277` ya publicado: el botón de ChatGPT sustituye un valor previo del portapapeles por la URL real antes de abrir el cliente. Chrome aislado con permisos explícitos de lectura y escritura de texto; móvil y escritorio en inglés pasan de nuevo. Si el navegador deniega el portapapeles, la interfaz ofrece la dirección seleccionable y una instrucción de copia manual. El smoke HTTP final confirma salud 200, `initialize` 401 con `WWW-Authenticate` y ambos documentos de descubrimiento 200 en las direcciones anunciadas.
- Claude web: conector personalizado de la URL CRM, herramientas descubiertas, aprobación de una sola llamada y `comprobar_conexion` real. Riverz confirmó `verified` a las 02:23:15 UTC del 1 de octubre (30 de septiembre en la zona del dueño).
- ChatGPT web: conexión personalizada privada mediante `Create MCP App`, OAuth con la sesión propia, llamada real en un chat y confirmación `verified` a las 02:32:07 UTC. No se publicó una ficha ni se presentó una solicitud al directorio.
- Codex: cliente MCP nativo del ejecutable de Codex, con configuración temporal mediante overrides, DCR, callback loopback y OAuth propios. Se invocó `mcpServer/tool/call` sin ejecutar un turno de IA. `comprobar_conexion` devolvió éxito y Riverz confirmó `verified` a las 02:37:15 UTC. Configuración existente conservada; credencial temporal cerrada y grants de QA revocados. Esto valida el cliente nativo, no la interacción visual de la ventana de Codex Desktop.
- La página de producción mostró las dos acciones con configuración manual cerrada. Tras desconectarse el navegador colaborativo, se completó la revisión en Chrome headless aislado con una identidad temporal: móvil a 390 px, logos cargados, tres pasos, aviso de confianza, ausencia de desbordamiento y configuración avanzada cerrada. Al volver desde la pestaña del asistente, la interfaz mostró `Conexión comprobada` únicamente después de la llamada autenticada. También se verificaron los tres pasos en inglés a 1280 px. Navegador e identidad temporal eliminados al terminar. Esta prueba usa un fixture de dashboard ya incorporado; no prueba aceptación de términos ni modifica perfiles reales.
