import { describe, it, expect } from 'vitest'
import { MAX_IMAGENES, imagenesDeRaw, unirImagenes } from './imagenes'

/**
 * El producto se veía con UNA foto aunque la tienda tuviera ocho: el sync sólo
 * guarda `image_url`. Estas dos piezas son las que arman la galería completa —
 * leer las fotos del payload de cada plataforma y sumarlas sin repetir.
 */

describe('imagenesDeRaw', () => {
  it('lee la galería de Shopify sin duplicar la principal', () => {
    const raw = {
      image: { src: 'https://cdn.shopify.com/a.jpg?v=1' },
      images: [
        { src: 'https://cdn.shopify.com/a.jpg?v=1' },
        { src: 'https://cdn.shopify.com/b.jpg?v=2' },
      ],
    }
    // La principal viene suelta Y dentro de `images`: la repetición la corta
    // la unión, que es donde vive la normalización de la query string.
    expect(unirImagenes([], imagenesDeRaw('shopify', raw))).toEqual([
      'https://cdn.shopify.com/a.jpg?v=1',
      'https://cdn.shopify.com/b.jpg?v=2',
    ])
  })

  it('lee Tiendanube y WooCommerce por images[].src', () => {
    const raw = { images: [{ src: 'https://x/1.jpg' }, { src: 'https://x/2.jpg' }] }
    expect(imagenesDeRaw('tiendanube', raw)).toEqual([
      'https://x/1.jpg',
      'https://x/2.jpg',
    ])
    expect(imagenesDeRaw('woocommerce', raw)).toEqual([
      'https://x/1.jpg',
      'https://x/2.jpg',
    ])
  })

  it('lee Mercado Libre por pictures[] y prefiere la segura', () => {
    const raw = {
      pictures: [
        { url: 'http://mla/1.jpg', secure_url: 'https://mla/1.jpg' },
        { url: 'http://mla/2.jpg' },
      ],
    }
    expect(imagenesDeRaw('mercadolibre', raw)).toEqual([
      'https://mla/1.jpg',
      'http://mla/2.jpg',
    ])
  })

  it('un producto cargado a mano no rompe nada', () => {
    expect(imagenesDeRaw('shopify', null)).toEqual([])
    expect(imagenesDeRaw(null, { images: 'no es lista' })).toEqual([])
  })
})

describe('unirImagenes', () => {
  it('no repite la misma foto aunque cambie la query string', () => {
    // Es el caso que haría crecer la galería en cada resincronización: Shopify
    // devuelve `?v=<timestamp>` distinto cada vez que se toca el producto.
    const actuales = ['https://cdn.shopify.com/a.jpg?v=1']
    expect(unirImagenes(actuales, ['https://cdn.shopify.com/a.jpg?v=9999'])).toEqual(
      actuales,
    )
  })

  it('conserva lo que el comercio subió y agrega lo nuevo al final', () => {
    const propias = ['https://supabase/storage/mia.jpg']
    expect(unirImagenes(propias, ['https://cdn/1.jpg', 'https://cdn/2.jpg'])).toEqual([
      'https://supabase/storage/mia.jpg',
      'https://cdn/1.jpg',
      'https://cdn/2.jpg',
    ])
  })

  it('descarta lo que no es una URL', () => {
    expect(unirImagenes([], ['', 'data:image/png;base64,x', 'https://cdn/1.jpg'])).toEqual(
      ['https://cdn/1.jpg'],
    )
  })

  it('corta en el mismo tope que acepta el guardado', () => {
    // Si trajera más de las que `write.ts` guarda, el editor las mostraría y
    // el siguiente "Guardar cambios" borraría el resto sin avisar.
    const muchas = Array.from({ length: 40 }, (_, i) => `https://cdn/${i}.jpg`)
    expect(unirImagenes([], muchas)).toHaveLength(MAX_IMAGENES)
    expect(MAX_IMAGENES).toBe(12)
  })
})
