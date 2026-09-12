export class PayloadTooLargeError extends Error {
  constructor() {
    super('Request body exceeds upload limit');
    this.name = 'PayloadTooLargeError';
  }
}

/** Bound actual bytes before multipart parsing, including chunked requests. */
export async function limitedFormData(request: Request, maxBytes: number): Promise<FormData> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError('Invalid body limit');
  if (Number(request.headers.get('content-length')) > maxBytes) {
    await request.body?.cancel().catch(() => undefined);
    throw new PayloadTooLargeError();
  }
  if (!/^multipart\/form-data\s*;/i.test(request.headers.get('content-type') ?? '')) {
    await request.body?.cancel().catch(() => undefined);
    throw new TypeError('Expected multipart form data');
  }
  if (!request.body) throw new TypeError('Missing request body');

  const reader = request.body.getReader();
  let received = 0;
  const bounded = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        received += value.byteLength;
        if (received > maxBytes) {
          controller.error(new PayloadTooLargeError());
          await reader.cancel().catch(() => undefined);
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) { return reader.cancel(reason); },
  });
  try {
    return await new Response(bounded, { headers: request.headers }).formData();
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
