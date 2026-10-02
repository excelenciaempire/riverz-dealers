# Reembolsos propuestos desde una recepción

La ampliación enlaza la recepción declarada por el equipo con el motor actual de acciones sobre pedidos. Permanece oculta fuera de `NEXT_PUBLIC_RIVERZ_UI_STAGE=comparison`; no modifica precios ni activa autonomía financiera.

## Preparación y aprobación

1. Un miembro autorizado registra una recepción en una devolución local. El estado `recibida` sin un evento de recepción no basta.
2. El panel consulta la última recepción y permite proponer un importe o el saldo pagado disponible, con motivo obligatorio.
3. Riverz consulta el pedido actual y prepara una operación en `inbox_order_actions`, usando el motor y comprobaciones Shopify existentes. Preparar no ejecuta un reembolso.
4. La propuesta aparece en la conversación vinculada, con la referencia, cantidad y condición declaradas. La aprobación financiera conserva el flujo existente y su requisito de administrador.
5. Al aprobar se verifica de nuevo el expediente, última recepción, permisos, pedido, conversación, suscripción y fingerprint financiero. Una recepción corregida invalida la propuesta anterior.

La cantidad y condición son una declaración humana. No acreditan inspección física, cotejo de todas las líneas del pedido ni confirmación de una transportadora. El reembolso sigue limitado a los pedidos Shopify admitidos por el motor actual. Se conserva el contrato de membresía que exige ese motor; no se crean miembros ni se cambia la autorización del dinero para ampliar esta función.

## Identidad, concurrencia y privacidad

Las RPC de la migración 353 son privadas, con esquema de búsqueda fijo. Comprueban el actor real, Devoluciones, Pedidos y Bandeja, y respetan los buzones privados de su propietario actual. El cliente no puede elegir negocio, actor, contacto o pedido. Las tablas de enlaces no admiten consultas ni escrituras directas de los roles de cliente o servicio.

La preparación serializa por expediente y por identificador de propuesta. Repetir el mismo identificador y contenido recupera la operación guardada; un identificador reutilizado con otra recepción o expediente genera conflicto. No refresca silenciosamente hechos ya propuestos. Una operación activa sobre la misma recepción impide otra propuesta; estados `running` o `uncertain` impiden reemplazar la recepción hasta concluir o reconciliar la operación mediante el mecanismo existente. Una guía declarada puede seguir registrándose.

El enlace se elimina en cascada al eliminar su expediente. El marcador inmutable dentro de la operación financiera conserva su referencia de recepción, conforme al historial financiero existente. Una propuesta que pierde su enlace no puede ejecutarse como un reembolso ordinario. El registro final de una operación ya iniciada sigue permitido: borrar el expediente no debe impedir conservar su resultado financiero.

Las respuestas de preparación proyectan solo los metadatos necesarios. No incluyen cuerpos del proveedor, clientes ni credenciales. La API exige sesión y CSRF, JSON UTF-8 de hasta cuatro KB y consultas estrictas. La preparación tiene un límite de treinta solicitudes por minuto, actor y negocio; la distribución del límite depende de la configuración Redis del mecanismo actual y su fallback local.

## Operador y MCP

El mismo lector y escritor admiten historial de devoluciones, registro de evidencia y preparación de reembolso. El registro de evidencia exige revisión humana. Preparar un reembolso deja una propuesta pendiente de la aprobación financiera existente. No se añade una herramienta para ejecutar dinero ni se acepta el nombre de un token como identidad del usuario emisor. Las herramientas nuevas solo se registran en comparación y verifican también ese límite al invocarse directamente.

## Coste y aceptación

No se realiza una llamada de IA adicional para leer o preparar estos registros. Las consultas al pedido y operaciones de servidor tienen su coste normal; solicitarlo desde el Operador utiliza su turno habitual. Los precios y las políticas de facturación permanecen iguales.

La validación utiliza PostgreSQL aislado, fixtures sintéticos y proveedores simulados. Comprueba permisos, versiones, idempotencia, aprobación, estados inciertos, cascadas, proyección, API y UI bilingüe. No se ha devuelto dinero a clientes reales como QA. La ejecución financiera depende del proveedor y del contrato de aprobación ya existentes; preparación validada no equivale a un reembolso real aceptado.
