import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createShortLink } from '@/lib/links/short-link'
import { prepararTextoParaCanal } from './enlaces-salientes'

vi.mock('@/lib/links/short-link', () => ({
  createShortLink: vi.fn(),
}))

const db = {} as Parameters<typeof prepararTextoParaCanal>[0]

describe('prepararTextoParaCanal', () => {
  beforeEach(() => {
    vi.mocked(createShortLink).mockReset()
    vi.mocked(createShortLink).mockResolvedValue('AbC123xy')
  })

  it('muestra un enlace corto y guarda como destino la atribución del canal', async () => {
    const texto = await prepararTextoParaCanal(db, {
      texto:
        'Catálogo: https://tienda.example/productos/rascador-grande?variant=rosa&campaign=promocion-septiembre',
      canal: 'instagram',
      workspaceId: 'workspace-a',
      contactId: 'contact-a',
    })

    expect(texto).toBe('Catálogo: https://riverz.co/r/AbC123xy')
    expect(createShortLink).toHaveBeenCalledOnce()
    expect(createShortLink).toHaveBeenCalledWith(db, {
      workspaceId: 'workspace-a',
      contactId: 'contact-a',
      targetUrl:
        'https://tienda.example/productos/rascador-grande?variant=rosa&campaign=promocion-septiembre&riverz=instagram&utm_source=riverz&utm_medium=instagram',
    })
  })

  it('conserva exactamente una URL de producto que ya es corta', async () => {
    const texto = await prepararTextoParaCanal(db, {
      texto: 'Mira https://www.rasmiaw.shop/products/ref-4',
      canal: 'instagram',
      workspaceId: 'workspace-a',
    })

    expect(texto).toBe('Mira https://www.rasmiaw.shop/products/ref-4')
    expect(createShortLink).not.toHaveBeenCalled()
  })

  it('reutiliza el token para el mismo enlace repetido en un mensaje', async () => {
    const texto = await prepararTextoParaCanal(db, {
      texto:
        'Uno https://tienda.example/products/rascador?variant=123456789&campaign=recuperacion-septiembre. Dos https://tienda.example/products/rascador?variant=123456789&campaign=recuperacion-septiembre',
      canal: 'whatsapp',
      workspaceId: 'workspace-a',
    })

    expect(texto).toBe(
      'Uno https://riverz.co/r/AbC123xy. Dos https://riverz.co/r/AbC123xy',
    )
    expect(createShortLink).toHaveBeenCalledOnce()
  })

  it('crea destinos separados para cada comercio', async () => {
    vi.mocked(createShortLink)
      .mockResolvedValueOnce('ComercioA')
      .mockResolvedValueOnce('ComercioB')

    const a = await prepararTextoParaCanal(db, {
      texto: 'https://tienda.example/products/rascador?variant=123456789&campaign=recuperacion-septiembre',
      canal: 'instagram',
      workspaceId: 'workspace-a',
    })
    const b = await prepararTextoParaCanal(db, {
      texto: 'https://tienda.example/products/rascador?variant=123456789&campaign=recuperacion-septiembre',
      canal: 'instagram',
      workspaceId: 'workspace-b',
    })

    expect(a).toBe('https://riverz.co/r/ComercioA')
    expect(b).toBe('https://riverz.co/r/ComercioB')
    expect(vi.mocked(createShortLink).mock.calls[0][1].workspaceId).toBe(
      'workspace-a',
    )
    expect(vi.mocked(createShortLink).mock.calls[1][1].workspaceId).toBe(
      'workspace-b',
    )
  })

  it('no acorta canales sin atribución ni enlaces propios de Riverz', async () => {
    const comentario = await prepararTextoParaCanal(db, {
      texto:
        'Mira https://tienda.example/products/rascador?variant=123456789&campaign=contenido-organico&riverz=instagram',
      canal: 'ig_comment',
      workspaceId: 'workspace-a',
    })
    const propio = await prepararTextoParaCanal(db, {
      texto:
        'Mira https://riverz.co/ayuda/documentacion/enlaces-y-atribucion-de-conversaciones',
      canal: 'instagram',
      workspaceId: 'workspace-a',
    })

    expect(comentario).toBe(
      'Mira https://tienda.example/products/rascador?variant=123456789&campaign=contenido-organico&riverz=instagram',
    )
    expect(propio).toBe(
      'Mira https://riverz.co/ayuda/documentacion/enlaces-y-atribucion-de-conversaciones',
    )
    expect(createShortLink).not.toHaveBeenCalled()
  })

  it('conserva la URL marcada si falla la creación del token', async () => {
    vi.mocked(createShortLink).mockRejectedValueOnce(new Error('db down'))

    const texto = await prepararTextoParaCanal(db, {
      texto:
        'Mira https://tienda.example/products/rascador?variant=123456789&campaign=recuperacion-septiembre',
      canal: 'messenger',
      workspaceId: 'workspace-a',
    })

    expect(texto).toBe(
      'Mira https://tienda.example/products/rascador?variant=123456789&campaign=recuperacion-septiembre&riverz=messenger&utm_source=riverz&utm_medium=messenger',
    )
  })
})
