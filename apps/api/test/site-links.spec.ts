/** Every internal link in the website points at a page that exists (catches "page not found" links). */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB = path.resolve(__dirname, '../../web');
const APP = path.join(WEB, 'app');

function walk(dir: string, out: string[] = []) {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** App routes as regexes: "(group)" folders vanish, "[id]" matches one segment. */
const routes = walk(APP)
  .filter((f) => /[\\/]page\.tsx$/.test(f))
  .map((f) => {
    const segs = path.relative(APP, path.dirname(f)).split(path.sep).filter((s) => s && !/^\(.*\)$/.test(s));
    const pattern = segs.map((s) => (/^\[.*\]$/.test(s) ? '[^/]+' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/');
    return { route: '/' + segs.join('/'), re: new RegExp(`^/${pattern}/?$`) };
  });

/** Internal paths written in the source: href="/x", href={`/x/${id}`}, push('/x'), withRange('/x'), link('/x'). */
function linksIn(file: string) {
  const src = readFileSync(file, 'utf8');
  const found: string[] = [];
  const patterns = [
    /href=["'](\/[^"'#]*)["']/g,
    /href=\{`(\/[^`]*)`/g,
    /(?:push|replace|withRange|link)\(\s*[`'"](\/[^`'"]*)[`'"]/g,
    /href:\s*[`'"](\/[^`'"]*)[`'"]/g,
    /window\.location\.href\s*=\s*`(\/[^`]*)`/g,
  ];
  for (const re of patterns) for (const m of src.matchAll(re)) found.push(m[1]);
  return found
    .map((l) => l.replace(/\$\{[^}]*\}/g, 'X').split(/[?#]/)[0])
    .filter((l) => l && !l.startsWith('/api/') && !l.startsWith('//'));
}

describe('Website links', () => {
  const files = [...walk(APP), ...walk(path.join(WEB, 'components')), ...walk(path.join(WEB, 'lib'))].filter((f) => /\.tsx?$/.test(f));
  const links = files.flatMap((f) => linksIn(f).map((l) => ({ file: path.relative(WEB, f), link: l })));

  it('finds the pages and the links', () => {
    expect(routes.length).toBeGreaterThan(20);
    expect(links.length).toBeGreaterThan(50);
  });

  it('every internal link opens an existing page', () => {
    const broken = links.filter(({ link }) => {
      const clean = link.replace(/\/X$/, '/1').replace(/\/X\//g, '/1/');
      return !routes.some((r) => r.re.test(clean));
    });
    expect(broken, JSON.stringify(broken, null, 1)).toEqual([]);
  });

  it('server-built links (audit log) also open existing pages', () => {
    const src = readFileSync(path.resolve(__dirname, '../src/audit/audit.controller.ts'), 'utf8');
    const built = [...src.matchAll(/link = `(\/[^`?]*)/g)].map((m) => m[1].replace(/\$\{[^}]*\}/g, '1'));
    expect(built.length).toBeGreaterThan(0);
    for (const l of built) expect(routes.some((r) => r.re.test(l)), l).toBe(true);
  });
});
