import { describe, expect, it, vi } from 'vitest';
import { MAX_ATTACHMENT_BYTES, selectAttachments, sendAttachmentQueue } from './attachment-queue';

const file = (name: string, type: string, size = 100) => ({ name, type, size }) as File;
describe('attachment selection from paste, picker and drop', () => {
  it('keeps mixed files in order, including office files with no MIME', () => {
    const files = [file('photo.png', 'image/png'), file('invoice.pdf', 'application/pdf'), file('report.docx', '')];
    expect(selectAttachments(files, 'image/*,application/pdf,.docx', 20)).toEqual({ accepted: files, rejected: [] });
  });
  it('validates type, size and remaining slots without discarding valid siblings', () => {
    const files = [file('large.png', 'image/png', MAX_ATTACHMENT_BYTES + 1), file('report.pdf', 'application/pdf'), file('a.png', 'image/png'), file('b.png', 'image/png')];
    const result = selectAttachments(files, 'image/*', 1);
    expect(result.accepted).toEqual([files[2]]);
    expect(result.rejected.map(r => r.reason)).toEqual(['size', 'type', 'count']);
  });
  it('lets unrestricted channels attach any format within the size limit', () => {
    expect(selectAttachments([file('archive.zip', '')], undefined, 1).accepted).toHaveLength(1);
  });
});
describe('attachment send queue', () => {
  it('stops on failure and retains only failed and unsent files for retry', async () => {
    let pending = [1, 2, 3];
    const send = vi.fn(async (item: number) => { if (item === 2) throw new Error('upload failed'); });
    await expect(sendAttachmentQueue(pending, send, () => true, item => { pending = pending.filter(n => n !== item); })).rejects.toThrow('upload failed');
    expect(send.mock.calls.map(c => c[0])).toEqual([1, 2]);
    expect(pending).toEqual([2, 3]);
  });
  it('does not send the rest of a batch after switching conversation', async () => {
    let current = true;
    const send = vi.fn(async () => { current = false; });
    await sendAttachmentQueue([1, 2, 3], send, () => current, () => {});
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('sends sequentially in the selected order', async () => {
    const sent: number[] = [];
    await sendAttachmentQueue([3, 1, 2], async item => { sent.push(item); }, () => true, () => {});
    expect(sent).toEqual([3, 1, 2]);
  });
});
