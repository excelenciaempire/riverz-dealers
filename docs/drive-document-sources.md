# Fuentes de Google Drive / Google Drive sources

## Español

La conexión nueva permanece reservada para comparación. Aparece plegada dentro de Documentos del asistente existente; no añade una sección al menú ni activa archivos automáticamente.

Un administrador con acceso al asistente conecta la cuenta de Google del negocio. OAuth solicita `drive.readonly`, `openid` y `email`, independiente de Gmail. El permiso de Google permite leer Drive; Riverz procesa únicamente los archivos elegidos mediante su enlace. No enumera carpetas ni incorpora archivos nuevos sin selección. Los tokens y el verificador PKCE se guardan cifrados en tablas privadas. El consentimiento caduca a los diez minutos y requiere la sesión actual y la cookie del navegador que lo inició.

PDF, Word y Excel conservan los límites del importador: 5 MB por archivo, extracción local aislada, texto verificable y rechazo de fórmulas. Documentos y hojas nativos de Google se exportan a Word y Excel. La sincronización consulta permisos y versión antes y después de descargar; los cambios durante esa lectura se rechazan. No utiliza URLs arbitrarias, shortcuts ni enlaces de exportación devueltos por un archivo.

Cada versión con contenido nuevo queda como borrador. El administrador revisa, corrige y activa desde los controles existentes de Documentos. Una versión remota sin cambios de texto conserva el estado revisado; una edición humana hecha durante el procesamiento no se sobrescribe. Retirar un archivo, perder sus permisos o desconectar impide su uso en la siguiente lectura de contexto sin caché. Una llamada de modelo ya iniciada no se cancela retroactivamente.

La cola propia procesa hasta seis archivos por corrida con dos parsers simultáneos. Los trabajos de lectura pueden recuperarse con otro lease después de cinco minutos; publicar exige el lease y permiso actuales. Cada fuente pasa a estar pendiente de revisión de permisos a los quince minutos. Si el cron se retrasa o falla, una verificación de más de veinte minutos deja de ser válida para el contexto. No se promete una frecuencia exacta bajo carga. Desconectar afecta a los archivos enlazados de todo el negocio, elimina las credenciales almacenadas y retira sus documentos, conservando los documentos locales independientes.

### Configuración y alcance de aceptación

1. Aplicar la migración 345 antes de desplegar; el guard de build comprueba tablas y RPC privados sin leer documentos ni tokens.
2. Configurar `GOOGLE_DRIVE_CLIENT_ID` y `GOOGLE_DRIVE_CLIENT_SECRET`. Existe fallback a las credenciales OAuth generales de Google, sin modificar los scopes de Gmail.
3. Registrar en ese cliente OAuth la URI exacta `${NEXT_PUBLIC_SITE_URL}/api/ai/drive/callback`, obtenida de `publicBaseUrl()` (fallback `https://riverz.co`), y habilitar Drive API en el proyecto de Google.
4. Verificar la autorización de scopes y distribución del cliente con Google antes de ofrecerlo a comercios. `drive.readonly` es un scope restringido; las pruebas locales no acreditan aprobación del proveedor ni consentimiento de una cuenta real.
5. En el entorno autorizado de comparación, conectar una cuenta de prueba y comprobar importación, revisión, cambio remoto y revocación antes de declarar aceptación externa. La UI de producción actual sigue sin cambios hasta la comparación final.

Importar y sincronizar no llama a modelos de IA. Usar texto documental en una respuesta puede aumentar los tokens de contexto; se conservan los límites existentes y no se cambia el precio ni la política de facturación.

## English

The new connection remains reserved for comparison. It is collapsed inside the existing assistant Documents controls, with no navigation changes or automatic activation.

An administrator with assistant access connects the business Google account. Independent OAuth requests `drive.readonly`, `openid` and `email`; it does not change Gmail scopes. Google's permission allows reading Drive, while Riverz processes only explicitly selected file links, without folder enumeration, shortcuts or automatic discovery. Tokens and PKCE verifiers are encrypted in private tables. Ten-minute consent requires the current authenticated actor and the initiating browser cookie.

PDF, Word and Excel share the existing isolated local importer and 5 MB limit. Native Google documents and spreadsheets export to Word and Excel. Permission and version are checked before and after download; concurrent remote changes fail closed. New text requires draft review and explicit activation. Unchanged text preserves reviewed state; concurrent human edits are not overwritten.

The native queue leases up to six files per run with two concurrent parsers. Read jobs can be reclaimed after five minutes, but publication requires the current lease and permission. Sources become due after fifteen minutes; verifications older than twenty minutes are excluded from the next uncached context read even if the scheduler is delayed. An already running model call is not retroactively cancelled. Disconnecting removes stored credentials and withdraws linked sources across the business, preserving independent local documents.

Deployment requires migration 345, Drive API enabled, OAuth client credentials and the exact public `/api/ai/drive/callback` redirect URI registered with Google. Dedicated `GOOGLE_DRIVE_CLIENT_ID` / `GOOGLE_DRIVE_CLIENT_SECRET` are preferred, with fallback to the existing generic Google OAuth configuration. Google approval for restricted scopes and real-account acceptance must be verified separately; mocked tests and a successful build do not establish either. Production comparison remains disabled.

Synchronization makes no model calls. Documentary context may increase response tokens within existing limits; this implementation changes neither prices nor billing policy.

## Referencias / References

- [Google: descarga, exportación y permisos](https://developers.google.com/workspace/drive/api/guides/manage-downloads).
- [Google: campos y versión del archivo](https://developers.google.com/workspace/drive/api/reference/rest/v3/files).
- [Google: OAuth para aplicaciones web](https://developers.google.com/identity/protocols/oauth2/web-server).
- [Google: scopes de Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).
