-- 219 — Las claves de los proveedores, administrables desde el panel
--
-- Hasta ahora cada clave vivía sólo en una variable de entorno de Render, así
-- que cambiar una era entrar al dashboard de Render, editarla y esperar un
-- redeploy de varios minutos. El 2026-08-28 eso se notó de golpe: Gemini tenía
-- una clave que no era una clave, OpenAI no tenía ninguna, y no había forma de
-- arreglarlo desde donde se veía el problema.
--
-- El patrón no es nuevo: `platform_ai_settings.anthropic_key_encrypted` ya
-- guardaba la de Anthropic exactamente así, y /admin/ia ya la edita. Esto lo
-- generaliza a los proveedores de IA y voz, que son los que se agotan.
--
-- Reglas que se mantienen:
--
--   · La clave se guarda CIFRADA (`lib/whatsapp/encryption`, AES-GCM). La
--     columna nunca guarda texto plano.
--   · El texto plano NUNCA vuelve al navegador: el panel muestra el prefijo y
--     los últimos cuatro caracteres, que alcanzan para reconocer una clave sin
--     poder usarla.
--   · Render sigue siendo el respaldo. Borrar acá no apaga al proveedor: lo
--     devuelve a la variable de entorno, y la pantalla dice de dónde sale cada
--     una para que eso nunca sea una sorpresa.
--
-- Sin RLS abierta a nadie: sólo la clave de servicio la lee, igual que
-- `platform_ai_settings`. El alta y la baja pasan por /api/admin/claves, que
-- exige ser del equipo, la segunda llave del panel y el token CSRF.
--
-- Idempotente. Se aplica a mano por la Management API.

CREATE TABLE IF NOT EXISTS public.platform_keys (
  -- El id del proveedor en el catálogo de `lib/admin/claves.ts`
  -- ('anthropic', 'telnyx', …). No es la variable de entorno: un proveedor
  -- puede tener más de una, y el catálogo es el que sabe cuáles.
  proveedor     TEXT PRIMARY KEY,
  clave_cifrada TEXT NOT NULL,
  -- Para mostrar «sk-ant-…7f2a» sin descifrar en cada carga de la pantalla.
  -- No es un secreto: son los mismos caracteres que el proveedor imprime en su
  -- propio tablero.
  pista         TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID
);

ALTER TABLE public.platform_keys ENABLE ROW LEVEL SECURITY;

-- Sin políticas a propósito: con RLS activada y ninguna política, `anon` y
-- `authenticated` no leen ni una fila. Sólo la clave de servicio entra.
REVOKE ALL ON public.platform_keys FROM anon, authenticated;

COMMENT ON TABLE public.platform_keys IS
  'Claves de proveedores de IA y voz, cifradas. Pisan a la variable de entorno del mismo proveedor. Borrar una fila devuelve el control a Render.';
COMMENT ON COLUMN public.platform_keys.pista IS
  'Prefijo y últimos 4, para mostrar en el panel sin descifrar. Nunca la clave entera.';
