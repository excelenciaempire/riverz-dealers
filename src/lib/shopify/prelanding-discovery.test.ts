import { describe, expect, it } from 'vitest'
import { discoverPrelandings } from './prelanding-discovery'

const root = 'https://shop.example/sitemap.xml'
const pages = 'https://shop.example/sitemap_pages_1.xml'

function response(body: string, status = 200): Response {
  return new Response(body, { status })
}

describe('discoverPrelandings', () => {
  it('asocia una página por handle y otra que enlaza a un único producto', async () => {
    const fetcher = async (url: string) => {
      if (url === root) return response(`<sitemapindex><sitemap><loc>${pages}</loc></sitemap></sitemapindex>`)
      if (url === pages) {
        return response(`<urlset>
          <url><loc>https://shop.example/pages/serum-pilar</loc></url>
          <url><loc>https://shop.example/pages/oferta-especial</loc></url>
          <url><loc>https://shop.example/products/serum-pilar</loc></url>
        </urlset>`)
      }
      if (url === 'https://shop.example/pages/oferta-especial') {
        return response('<a href="/products/serum-pilar">Comprar</a>')
      }
      return response('', 404)
    }

    const result = await discoverPrelandings(
      'shop.example',
      [{ handle: 'serum-pilar' }],
      fetcher as unknown as typeof fetch,
    )

    expect(result.ok).toBe(true)
    expect(result.byHandle.get('serumpilar')).toEqual([
      'https://shop.example/pages/serum-pilar',
      'https://shop.example/pages/oferta-especial',
    ])
  })

  it('no convierte una página con varios productos en una fuente de uno solo', async () => {
    const fetcher = async (url: string) => {
      if (url === root) return response(`<urlset><url><loc>https://shop.example/pages/catalogo</loc></url></urlset>`)
      return response('<a href="/products/serum-pilar">A</a><a href="/products/crema-pilar">B</a>')
    }

    const result = await discoverPrelandings(
      'shop.example',
      [{ handle: 'serum-pilar' }, { handle: 'crema-pilar' }],
      fetcher as unknown as typeof fetch,
    )

    expect(result.byHandle.size).toBe(0)
  })
})

