# Riverz 2.0 — runbook

Cómo volver atrás, cómo aplicar una migración y cómo prender la experiencia
nueva. Riverz 2.0 se construye **detrás de un flag**: mientras `riverz_2` esté
apagado, un comercio ve exactamente la aplicación de siempre.

## Punto de retorno

**Código** — tag `riverz-1-estable`, creado antes del primer commit de 2.0.

```
git checkout riverz-1-estable          # ver el estado previo
git revert <sha>                       # deshacer un commit puntual
```

**Datos** — backups físicos diarios de Supabase (proyecto `ozurxrnujkgjqmilttln`).
Verificado el 2026-08-19: 8 backups diarios disponibles, el más reciente de ese
mismo día 01:37 UTC. PITR está **apagado**; el grano de recuperación es un día.

```
curl -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  https://api.supabase.com/v1/projects/ozurxrnujkgjqmilttln/database/backups
```

La restauración se hace desde el dashboard de Supabase (Database → Backups).
No hay `pg_dump` local: el proyecto no guarda la contraseña de Postgres.

El esquema no depende de esos backups para reconstruirse: `supabase/migrations/`
es el historial completo y cada archivo es idempotente.

## Aplicar una migración

Son manuales — no corren en el deploy de Render. Se aplican por la Management
API, una por una y **antes** del commit que las necesita:

```
POST https://api.supabase.com/v1/projects/ozurxrnujkgjqmilttln/database/query
Authorization: Bearer $SUPABASE_ACCESS_TOKEN
{ "query": "<contenido del archivo .sql>" }
```

Numeración: usar **163 o mayor**. Hay prefijos duplicados de antes (116, 120,
147, 149), así que conviene mirar la carpeta antes de elegir número.

## Prender / apagar Riverz 2.0

Por comercio (lo habitual): `/admin/comercios/<id>` → *Funcionalidades de este
comercio* → fila **Riverz 2.0**, botón "Prendida". Apagarla lo devuelve a la
aplicación actual en la siguiente carga; no se pierde nada de lo configurado.

Global: `/admin/funcionalidades` → sección *Experiencias*. Prenderlo ahí la
enciende para toda la base salvo los comercios con excepción propia.

La clave es `riverz_2` en `feature_flags` / `workspace_feature_flags`. Su
semántica es opt-in (sin fila = apagada), al revés que el resto del catálogo:
vive en `OPT_IN_FEATURES` y se lee con `isRiverz2()`, nunca con
`isFeatureEnabled()`. Ver `src/lib/admin/feature-flags.ts`.
