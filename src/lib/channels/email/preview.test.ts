import { expect, it } from 'vitest';
import { emailPreview } from './preview';
it('removes Judge.me markup and decodes entities without rendering HTML', () => {
 expect(emailPreview('gmail', '<b><i>Martín Ferreira</i></b> dejó una reseña de 1 estrellas para <b>Revitaly</b> &amp; más')).toBe('Martín Ferreira dejó una reseña de 1 estrellas para Revitaly & más');
 expect(emailPreview('gmail', '<script>alert(1)</script><p>Hola</p><p>mundo</p>')).toBe('Hola mundo');
 expect(emailPreview('whatsapp', '<b>literal</b>')).toBe('<b>literal</b>');
 expect(emailPreview('gmail', null)).toBe('');
});
