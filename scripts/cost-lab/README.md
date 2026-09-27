# Anthropic cost lab / Laboratorio de costos Anthropic

Run / Ejecutar: `node scripts/cost-lab/preflight.mjs`

ES: La fase inicial analiza únicamente los resultados históricos guardados. No
conecta a producción, no ejecuta herramientas comerciales, no llama a proveedores
ni carga consumo a comercios. El informe agregado se guarda en
`output/cost-lab/preflight.json`, sin textos ni datos personales de las conversaciones.
No cambia el asistente ni activa automáticamente optimizaciones. Las pruebas
comparativas con Anthropic requieren un proceso aislado, presupuesto limitado,
casos representativos por comercio y herramientas simuladas. La ausencia de
regresiones en una muestra no garantiza riesgo cero: después hace falta un piloto.

EN: The initial phase only analyzes saved historical results. It does not connect
to production, execute business tools, call providers or bill merchants. Its
aggregate report is saved to `output/cost-lab/preflight.json` without conversation
text or personal information. It does not change assistants or automatically
enable optimizations. Anthropic replay evaluations require an isolated process,
a fixed budget, representative cases per merchant and simulated tools. No
regressions in a sample is not a zero-risk guarantee; a pilot is still required.
