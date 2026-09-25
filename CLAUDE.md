@AGENTS.md

# Todo cambio se sube a `main` (no negociable)

Autorización permanente del dueño del repo para todas las sesiones de Claude: cada cambio terminado se sube directo a `main`, aunque la sesión arranque en otra rama (por ejemplo `claude/...`). No abras PR salvo que se pida.

1. `git fetch origin main` y haz rebase de tu trabajo sobre `origin/main`: el historial de `main` es lineal, sin merges.
2. Antes de subir, corre las comprobaciones de lo que tocaste: typecheck, lint y pruebas.
3. `git push origin HEAD:main`. Nunca hagas force push sobre `main`; si el push se rechaza porque `main` avanzó, vuelve al paso 1.
