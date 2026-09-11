const GRAPH = 'https://graph.facebook.com/v21.0';

export const TEMPLATE_HEADER_MIME: Record<'image' | 'video' | 'document', string[]> = {
  image: ['image/jpeg', 'image/png'],
  video: ['video/mp4'],
  document: ['application/pdf'],
};

export async function uploadTemplateHeaderMedia(input: {
  appId: string;
  accessToken: string;
  file: File;
}): Promise<string> {
  const start = new URL(`${GRAPH}/${input.appId}/uploads`);
  start.searchParams.set('file_length', String(input.file.size));
  start.searchParams.set('file_type', input.file.type);
  start.searchParams.set('file_name', input.file.name || 'header');
  const session = await fetch(start, {
    method: 'POST',
    headers: { Authorization: `Bearer ${input.accessToken}` },
  });
  if (!session.ok) throw new Error(`Meta rechazó el archivo (${session.status})`);
  const { id } = (await session.json()) as { id?: string };
  if (!id) throw new Error('Meta no creó la carga del archivo');

  const uploaded = await fetch(`${GRAPH}/${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      'file_offset': '0',
      'Content-Type': 'application/octet-stream',
    },
    body: await input.file.arrayBuffer(),
  });
  if (!uploaded.ok) throw new Error(`Meta no pudo subir el archivo (${uploaded.status})`);
  const { h } = (await uploaded.json()) as { h?: string };
  if (!h) throw new Error('Meta no devolvió el archivo de ejemplo');
  return h;
}
