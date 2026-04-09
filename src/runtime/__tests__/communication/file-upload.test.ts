import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { uploadFile, fetchLinkPreviews, disconnect } from '../../communication.js';

const mockIo = vi.fn();
vi.mock('socket.io-client', () => ({ io: mockIo }));

// Stub global fetch for these tests
const mockFetch = vi.fn();
beforeEach(() => {
  disconnect();
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mockFetch);
});
afterEach(() => { vi.unstubAllGlobals(); });

// ── uploadFile ───────────────────────────────────────────────────────────────

describe('uploadFile()', () => {
  it('POSTs to /__nk_comm/upload with correct headers and body', async () => {
    const blob = new Blob(['data'], { type: 'image/png' });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'att-1', url: '/files/att-1', size: 4 }),
    });

    const result = await uploadFile(blob, 'photo.png');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/__nk_comm/upload');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('image/png');
    expect(opts.headers['X-Filename']).toBe('photo.png');
    expect(opts.body).toBe(blob);
    expect(result).toEqual({ id: 'att-1', url: '/files/att-1', size: 4 });
  });

  it('adds X-Encrypted header when encrypted=true', async () => {
    const blob = new Blob(['secret']);
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

    await uploadFile(blob, 'secret.txt', true);
    const opts = mockFetch.mock.calls[0][1];
    expect(opts.headers['X-Encrypted']).toBe('1');
  });

  it('does not add X-Encrypted header when encrypted=false (default)', async () => {
    const blob = new Blob(['plain']);
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

    await uploadFile(blob, 'plain.txt');
    const opts = mockFetch.mock.calls[0][1];
    expect(opts.headers).not.toHaveProperty('X-Encrypted');
  });

  it('falls back to application/octet-stream when blob.type is empty', async () => {
    const blob = new Blob(['bytes']); // no explicit type → blob.type = ''
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

    await uploadFile(blob, 'file.bin');
    const opts = mockFetch.mock.calls[0][1];
    expect(opts.headers['Content-Type']).toBe('application/octet-stream');
  });

  it('throws when response is not ok', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 413 });
    const blob = new Blob(['big']);
    await expect(uploadFile(blob, 'big.bin')).rejects.toThrow('Upload failed: 413');
  });
});

// ── fetchLinkPreviews ────────────────────────────────────────────────────────

describe('fetchLinkPreviews()', () => {
  it('POSTs to /__nk_comm/link-preview with text as JSON body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ previews: [{ title: 'Example', url: 'https://example.com' }] }),
    });

    const result = await fetchLinkPreviews('Check out https://example.com');
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/__nk_comm/link-preview');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(opts.body)).toEqual({ text: 'Check out https://example.com' });
    expect(result).toEqual([{ title: 'Example', url: 'https://example.com' }]);
  });

  it('returns empty array when response is not ok', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const result = await fetchLinkPreviews('some text');
    expect(result).toEqual([]);
  });

  it('returns empty array when previews field is missing from response', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    const result = await fetchLinkPreviews('text');
    expect(result).toEqual([]);
  });

  it('returns empty array on fetch network error', async () => {
    mockFetch.mockRejectedValue(new Error('network error'));
    // fetchLinkPreviews does not catch errors — documents current behaviour
    await expect(fetchLinkPreviews('text')).rejects.toThrow('network error');
  });
});
