/*
 * ¿Por qué `downloadPublicMedia` devuelve null para una URL que `fetch` baja
 * bien? Repite sus pasos (DNS fijado, https.request sin agente, sin
 * compresión) imprimiendo cada uno.
 *
 *   npx tsx scripts/diag-download-public-media.ts "<url>"
 */
import { request } from 'node:https'
import { lookup } from 'node:dns/promises'
import type { IncomingMessage } from 'node:http'

async function main() {
  const raw = process.argv[2]
  if (!raw) throw new Error('falta la URL')
  const url = new URL(raw)
  const addresses = await lookup(url.hostname, { all: true, verbatim: true })
  console.log('dns:', addresses)
  for (const candidate of addresses) {
    const res = await new Promise<IncomingMessage | Error>((resolve) => {
      const out = request(url, {
        method: 'GET',
        headers: { 'accept-encoding': 'identity', 'user-agent': 'Riverz/1.0 (+https://riverz.co)' },
        agent: false,
        lookup: (_h, options, cb) => (options.all ? cb(null, [candidate]) : cb(null, candidate.address, candidate.family)),
        signal: AbortSignal.timeout(15_000),
      }, resolve)
      out.once('error', resolve)
      out.end()
    })
    if (res instanceof Error) {
      console.log(candidate.address, '-> ERROR', res.message)
      continue
    }
    let bytes = 0
    for await (const chunk of res) bytes += (chunk as Buffer).length
    console.log(candidate.address, '->', res.statusCode, {
      'content-type': res.headers['content-type'],
      'content-encoding': res.headers['content-encoding'],
      'content-length': res.headers['content-length'],
      location: res.headers.location,
    }, 'bytes', bytes)
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
