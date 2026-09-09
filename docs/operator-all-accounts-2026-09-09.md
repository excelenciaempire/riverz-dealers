# Operador en cuentas nuevas y antiguas

Verificación del 9 de septiembre de 2026 sobre la base configurada en este repositorio.

- 12 cuentas no eliminadas; las 12 tienen `riverz_2` y `operator_flota` habilitados. No hay excepciones que los apaguen.
- Ambas experiencias pasan al catálogo de disponibilidad general. Una cuenta sin filas de flags también las recibe. Un apagado explícito de emergencia sigue teniendo efecto.
- Se verificó el esquema de hilos, mensajes, acciones, corridas, planes, pasos, uso por agente y reservas de billetera.
- Se inicializaron las seis billeteras ausentes, a cero y con `ON CONFLICT DO NOTHING`. Las 12 cuentas tienen ahora billetera. No se modificaron saldos, tarjetas, suscripciones ni acuerdos de cortesía.
- Dos cuentas no tienen fila de suscripción. Conservan el tratamiento de compatibilidad existente; no se les asignó un plan ni una prueba nueva. El consumo de IA sigue requiriendo saldo salvo cortesía.
- Las cuentas antiguas con hilos largos ahora cargan los últimos 200 mensajes en orden cronológico. El contexto del modelo usa los últimos 20, no una ventana estancada en los primeros mensajes. Los mensajes anteriores permanecen en la base.
- Las 114 capacidades generales se ofrecen a cualquier cuenta. Las tres recetas específicas de Rasmiaw se ofrecen sólo a esa cuenta. Se verifica tanto al anunciar herramientas como al ejecutar, construir, proponer y aprobar acciones. Los prompts generales no dependen de una marca particular.
- Inicializar una billetera concurrentemente ya no puede actualizar una fila creada por otro proceso. Los errores de inicialización se reportan en lugar de inventar un saldo cero.

Validación: 660 pruebas en 50 archivos aprobadas; TypeScript y ESLint sin errores. Incluye cuentas sin flags, historias antiguas, aislamiento por workspace, inicialización concurrente, reservas, liquidación e idempotencia.

Comprobación reutilizable de todas las cuentas, con paginación y sin mostrar datos personales:

```sh
node --env-file=.env.local scripts/audit-operator-accounts.mjs
```

El indicador `--initialize-wallets` crea sólo las billeteras que falten. No hace recargas ni cobros.

Disponibilidad global no equivale a una garantía de funcionamiento perfecto de proveedores externos ni elimina las brechas funcionales documentadas en `operator-audit-2026-09-09.md`. La comprobación de despliegue utiliza `https://riverz.co/api/version`; `riverzai.com/api/version` redirige a autenticación y no permite verificar públicamente el commit.
