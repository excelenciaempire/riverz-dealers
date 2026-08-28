import { describe, it, expect } from "vitest";
import { patchFor, type CommentRow } from "./comment-sync";
import { COMMENT_DELETED_TEXT } from "./display";

/**
 * Ocultar no puede borrar lo que la persona dijo.
 *
 * Es la diferencia entre las dos acciones y no se ve en pantalla: las dos
 * sacan el comentario de la publicación, pero ocultar es reversible y
 * conserva el texto, y borrar no. Si `hide` llegara a tocar `content_text`,
 * el comercio esconde un comentario, lo vuelve a mostrar, y lo que aparece en
 * la publicación es "[deleted]" — sin ningún error de por medio.
 */

const fila = (over: Partial<CommentRow> = {}): CommentRow => ({
  id: "row-1",
  message_id: "17900000000000000",
  is_hidden: false,
  status: "received",
  content_text: "¿Hacen envíos a Córdoba?",
  ...over,
});

describe("ocultar", () => {
  it("marca la columna y no toca el texto", () => {
    const p = patchFor(fila(), "hide")!
    expect(p).toEqual({ is_hidden: true })
    expect(p).not.toHaveProperty("content_text")
    expect(p).not.toHaveProperty("status")
  })

  it("volver a mostrar sólo baja la marca", () => {
    expect(patchFor(fila({ is_hidden: true }), "unhide")).toEqual({ is_hidden: false })
  })

  it("repetir el mismo estado no escribe nada", () => {
    // El webhook de Facebook y el cron de conciliación pueden traer el mismo
    // cambio; sin esto cada corrida generaría un UPDATE y un evento de
    // tiempo real que refresca la bandeja de todos por nada.
    expect(patchFor(fila({ is_hidden: true }), "hide")).toBeNull()
    expect(patchFor(fila({ is_hidden: false }), "unhide")).toBeNull()
  })
})

describe("borrar", () => {
  it("sí reemplaza el texto, que es lo que lo hace irreversible", () => {
    expect(patchFor(fila(), "delete")).toEqual({
      status: "failed",
      content_text: COMMENT_DELETED_TEXT,
    })
  })

  it("un comentario borrado ya no se oculta, ni se muestra, ni se edita", () => {
    // Nada lo resucita: el texto original ya se perdió, así que dejarlo
    // volver a la bandeja mostraría "[deleted]" como si fuera lo que dijo.
    const borrado = fila({ status: "failed", content_text: COMMENT_DELETED_TEXT })
    expect(patchFor(borrado, "hide")).toBeNull()
    expect(patchFor(borrado, "unhide")).toBeNull()
    expect(patchFor(borrado, "delete")).toBeNull()
    expect(patchFor(borrado, "edit", "otra cosa")).toBeNull()
  })
})

describe("editar", () => {
  it("guarda el texto nuevo", () => {
    expect(patchFor(fila(), "edit", "¿Hacen envíos a Rosario?")).toEqual({
      content_text: "¿Hacen envíos a Rosario?",
    })
  })

  it("no lo vacía ni reescribe lo mismo", () => {
    expect(patchFor(fila(), "edit", "")).toBeNull()
    expect(patchFor(fila(), "edit", undefined)).toBeNull()
    expect(patchFor(fila(), "edit", "¿Hacen envíos a Córdoba?")).toBeNull()
  })
})

describe("una fila que nunca se tocó", () => {
  it("con is_hidden en null se puede mostrar igual", () => {
    // Las filas anteriores a la migración 095 tienen null, no false. Tratarlo
    // como "ya visible" dejaría sin arreglo a un comentario que Meta reporta
    // oculto.
    expect(patchFor(fila({ is_hidden: null }), "unhide")).toEqual({ is_hidden: false })
    expect(patchFor(fila({ is_hidden: null }), "hide")).toEqual({ is_hidden: true })
  })
})

describe("patchFor — edición nuestra vs lectura de Graph", () => {
  it("no deshace una edición recién hecha desde la bandeja", () => {
    const recien = fila({
      content_text: "texto nuevo",
      edited_at: new Date().toISOString(),
    })
    expect(patchFor(recien, "edit", "texto viejo")).toBeNull()
  })

  it("pasada la ventana, lo que diga Facebook manda", () => {
    const viejo = fila({
      content_text: "texto nuestro",
      edited_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    })
    expect(patchFor(viejo, "edit", "editado desde Facebook")).toEqual({
      content_text: "editado desde Facebook",
    })
  })
})
