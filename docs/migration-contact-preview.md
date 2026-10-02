# X2: revisión local de contactos

Primera entrega de migraciones, dentro del importador existente y oculta fuera de comparación. No reemplaza la importación CSV vigente. Es revisión local, sin llamadas a Riverz, proveedores, modelos o almacenamiento persistente.

## Alcance

CSV UTF-8, máximo 2 MB, 5.000 filas de datos, 64 columnas y 4.096 caracteres por celda. Coma, punto y coma o tabulador, BOM, CRLF, comillas duplicadas y campos multilínea. Las columnas incompletas, comillas dañadas y límites se rechazan explícitamente; no se recortan muestras y declaran completas. El control muestra hasta 25 filas pero contabiliza todo el archivo.

El usuario indica herramienta y cuenta de origen y selecciona columnas independientes para ID, teléfono, nombre, correo y empresa. Las seis herramientas nombradas en X2 se admiten como procedencia de CSV: **esto no acredita un conector de API ni compatibilidad con todos sus formatos nativos**. La documentación primaria confirma opciones y límites diferentes: [Kommo](https://developers.kommo.com/docs/limitations), [Chatwoot](https://developers.chatwoot.com/api-reference/contacts/list-contacts), [ManyChat](https://help.manychat.com/hc/en-us/articles/14281439451036-How-to-export-contacts-data). No se ejecutan esos procedimientos contra cuentas reales.

## Identidad y errores

El ID original permanece ligado a su origen; no se copia como identificador de WhatsApp, Messenger o Instagram. Teléfono requiere prefijo internacional explícito y validez: no se adivina el país ni se admiten extensiones o texto adicional. Un teléfono no acredita consentimiento ni capacidad de enviar por un canal.

Repetición exacta conserva una fila y excluye sus repeticiones. Un ID con datos distintos excluye todas sus filas conflictivas; distintos IDs con el mismo teléfono también se excluyen para revisión. Compartir correo no vincula contactos. Las filas inválidas permanecen en la revisión con sus errores, sin sobrescribir datos ni descartarlas como un éxito.

Esta entrega no consulta contactos ya guardados ni prueba pertenencia a una cuenta externa. Una fila «para revisar» no significa «importada» o identidad verificada. No incorpora conversaciones, adjuntos, automatizaciones, etiquetas, mensajes ni opt-in. La persistencia y conectores requieren su siguiente entrega con autorización actual y comprobantes.

## Privacidad y costes

El archivo se procesa en memoria del navegador. No se sube, guarda en localStorage, descarga un adjunto remoto o ejecuta fórmulas. HTML se representa como texto mediante React. Cerrar el control retira los datos; resultados de una lectura anterior no sobrescriben una selección nueva. La vista nueva sigue el flag único de comparación.

No hay consumo de tokens o cobro de IA por esta revisión. La importación CSV existente conserva su comportamiento y precio. La interfaz nueva tiene español e inglés y se incluye en la comparación local; no se muestra en producción.

## Validación de la entrega

**36 pruebas en dos archivos**, TypeScript completo y compilaciones completas normal/comparación correctas. Lint de componentes, contrato, catálogos y scripts sin errores o avisos. Una corrección final de redacción del contador se comprobó en el bundle privado y ambos idiomas; no modifica lógica o estructura del catálogo.

Cuatro revisiones visuales y ocho paneles: ES/EN, 1280×800 y 390×844. El archivo ficticio de cuatro filas devuelve una revisable y tres excluidas, sin llamadas a APIs, desbordamiento, errores de consola o alertas inesperadas. Fuente Inter Tight cargada, ID conservado, control ausente de Actual y archivo/revisión vaciados al cerrar. [Evidencia](migration-contact-preview-qa.json). El check de aislamiento del nuevo bundle también pasó; ninguna prueba importa datos en un comercio real.
