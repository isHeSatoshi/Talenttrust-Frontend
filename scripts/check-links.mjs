// Fast smoke test: every internal link in the nav and in page sources must map to an app route.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not URL.pathname. On Windows `pathname` yields "/C:/Users/..."
// with a leading slash, so join() produced "C:\C:\Users\..." and this check
// could never run there — `npm test` failed before reaching the test runner.
const appDir = fileURLToPath(new URL('../src/app/', import.meta.url));
const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
const nav = JSON.parse(readFileSync(join(srcDir, 'lib/nav.json'), 'utf8'));

const routeExists = (href) => {
  const path = href.split('#')[0].split('?')[0];
  if (path === '/' || path === '') return existsSync(join(appDir, 'page.tsx'));
  return existsSync(join(appDir, path, 'page.tsx'));
};

const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
  });

const links = new Set(nav.map((n) => n.href));
for (const file of walk(srcDir)) {
  for (const m of readFileSync(file, 'utf8').matchAll(/href=["{`]+(\/[^"`}#?]*)/g)) links.add(m[1]);
}

const broken = [...links].filter((l) => !routeExists(l));
if (broken.length) {
  console.error('Broken internal links:', broken);
  process.exit(1);
}
console.log(`OK: ${links.size} internal links resolve (${[...links].join(', ')})`);
