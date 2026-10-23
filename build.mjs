// Build: esbuild bundles src/main.js → one self-contained dist/knit.html
// (<title>, Google Fonts <link>, <style>, markup, inline <script>; no doctype/html/head/body — the host adds them).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');
const dev = process.argv.includes('--dev');

const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600&family=Zilla+Slab:wght@400;500;600;700&family=Roboto+Slab:wght@400;500;600;700;800;900&family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,800&family=Libre+Caslon+Text:wght@400;700&family=DM+Serif+Display&family=Abril+Fatface&family=Alfa+Slab+One&family=Archivo+Black&family=Rubik:wght@500;700;900&family=Silkscreen&display=swap';

async function once() {
  const t0 = Date.now();
  const res = await build({
    entryPoints: [join(root, 'src/main.js')],
    bundle: true, format: 'iife', target: 'es2020', minify: !dev, write: false,
    legalComments: 'none', charset: 'utf8', logLevel: 'warning',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  let js = res.outputFiles[0].text;
  // keep the inline script from closing its own tag
  js = js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
  const css = readFileSync(join(root, 'src/app/styles.css'), 'utf8');
  const markup = readFileSync(join(root, 'src/app/index.template.html'), 'utf8');
  const html = [
    '<title>Knit</title>',
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    `<link rel="stylesheet" href="${FONTS_HREF}">`,
    `<style>\n${css}</style>`,
    markup.trim(),
    `<script>\n${js}</script>`,
    '',
  ].join('\n');
  mkdirSync(join(root, 'dist'), { recursive: true });
  const out = join(root, 'dist/knit.html');
  writeFileSync(out, html);

  // Standalone website build (knit.liam.site): same app in a full HTML document.
  const icon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23fff' stroke='%23141414' stroke-width='1.5'/%3E%3Cpath d='M8.5 7.5c1 5 4.2 9 7.5 11.5 3.3-2.5 6.5-6.5 7.5-11.5M8.5 14c1 5 4.2 9 7.5 11.5 3.3-2.5 6.5-6.5 7.5-11.5' fill='none' stroke='%23141414' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E";
  const site = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
    '<meta name="description" content="Knit — design knitted-type book covers on a real knitting chart and export photoreal knitted cover art.">',
    '<meta name="color-scheme" content="light dark">',
    `<link rel="icon" href="${icon}">`,
    '<title>Knit</title>',
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    `<link rel="stylesheet" href="${FONTS_HREF}">`,
    '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px/1.4 system-ui,-apple-system,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>',
    `<style>\n${css}</style>`,
    '</head>',
    '<body>',
    markup.trim(),
    `<script>\n${js}</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
  mkdirSync(join(root, 'site'), { recursive: true });
  writeFileSync(join(root, 'site/index.html'), site);

  // CSP check: the bundle must not fetch anything external at runtime (fonts are the <link> above).
  const urls = [...new Set((js.match(/https?:\/\/[^\s"'`)\\]+/g) || []))];
  const fetchy = /\b(fetch|importScripts|XMLHttpRequest)\s*\(|new\s+Worker\s*\(\s*["'`]http/;
  const external = urls.filter((u) => !u.startsWith('https://fonts.googleapis.com') && !/^https?:\/\/(www\.)?w3\.org\//.test(u));
  console.log(`dist/knit.html  ${(html.length / 1024).toFixed(0)} KB  (${Date.now() - t0} ms)`);
  if (external.length) console.log('  URL strings in bundle (not fetched, informational):', external.join(' '));
  if (fetchy.test(js)) {
    const m = js.match(/.{0,80}\b(fetch|importScripts|XMLHttpRequest)\s*\(.{0,80}/);
    console.log('  note: bundle references a network API:', m && m[0]);
  }
}

await once();
if (watch) {
  const { watch: fsWatch } = await import('node:fs');
  let t = 0;
  fsWatch(join(root, 'src'), { recursive: true }, () => { clearTimeout(t); t = setTimeout(() => once().catch((e) => console.error(e.message)), 120); });
  console.log('watching src/ …');
}
