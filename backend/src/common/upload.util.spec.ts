import { describe, it, expect } from 'vitest';
import { safeUploadExtension, setUploadHeaders } from './upload.util';

describe('safeUploadExtension', () => {
  it('maps a declared type to a safe extension, never the client file name', () => {
    expect(safeUploadExtension('image/jpeg')).toBe('.jpg');
    expect(safeUploadExtension('application/pdf')).toBe('.pdf');
    expect(safeUploadExtension('audio/webm;codecs=opus')).toBe('.webm');
  });
  it('gives no extension to html, svg and other unlisted types', () => {
    expect(safeUploadExtension('text/html')).toBe('');
    expect(safeUploadExtension('image/svg+xml')).toBe('');
    expect(safeUploadExtension('application/x-sh')).toBe('');
    expect(safeUploadExtension(undefined)).toBe('');
  });
});

describe('setUploadHeaders', () => {
  const headersFor = (name: string) => {
    const h: Record<string, string> = {};
    setUploadHeaders({ setHeader: (k: string, v: string) => { h[k.toLowerCase()] = v; } } as never, name);
    return h;
  };
  it('always sets nosniff', () => {
    expect(headersFor('x.jpg')['x-content-type-options']).toBe('nosniff');
    expect(headersFor('x.bin')['x-content-type-options']).toBe('nosniff');
  });
  it('forces a download for anything not an image/pdf/recording', () => {
    const h = headersFor('note'); // no extension (was html/svg)
    expect(h['content-disposition']).toBe('attachment');
    expect(h['content-security-policy']).toContain('sandbox');
  });
  it('lets pictures and PDFs render inline', () => {
    expect(headersFor('p.jpg')['content-disposition']).toBeUndefined();
    expect(headersFor('p.pdf')['content-disposition']).toBeUndefined();
  });
});
