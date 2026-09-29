/**
 * Small HTTP safety helpers shared by controllers that stream files.
 */

/**
 * Content-Disposition that never breaks on user-supplied names: an ASCII fallback
 * (quotes, control characters and path parts removed) plus the UTF-8 name per RFC 6266,
 * so Hindi or Gujarati file names download correctly instead of failing the response.
 */
export function contentDisposition(type: 'inline' | 'attachment', name: string) {
  const base = (name.split(/[\\/]/).pop() || 'file').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 150) || 'file';
  const ascii = base.replace(/[^\x20-\x7e]/g, '_').replace(/["\\;]/g, '_');
  const utf8 = encodeURIComponent(base).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

