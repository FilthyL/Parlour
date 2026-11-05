#!/usr/bin/env node
/**
 * Turns the Vite build into a hosted-page entry: the host wraps the file in
 * its own document skeleton, so this keeps only the title, the stylesheet,
 * the module script and the app mount, with every asset referenced
 * relatively. Writes dist/parlour.html and dist/files.json (the asset list).
 */
import fs from 'node:fs';
import path from 'node:path';
const dist = path.resolve('dist');
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
const js = [...html.matchAll(/<script type="module"[^>]*src="([^"]+)"/g)].map((m) => m[1]);
const icon = html.match(/<link rel="icon"[^>]*>/)?.[0] ?? '';
const page = `<title>Parlour</title>
<meta name="description" content="Classic card games with a dealer who does cardistry.">
${icon}
${css.map((h) => `<link rel="stylesheet" href="${h.replace(/^\.\//, '')}">`).join('\n')}
<style>html,body{height:100%;background:#0e1a2b}</style>
<div id="app"></div>
${js.map((s) => `<script type="module" src="${s.replace(/^\.\//, '')}"></script>`).join('\n')}
`;
fs.writeFileSync(path.join(dist, 'parlour.html'), page);
const files = [];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
  const p = path.join(d, e.name);
  if (e.isDirectory()) walk(p);
  else if (!['index.html', 'parlour.html', 'files.json'].includes(path.relative(dist, p))) files.push(path.relative(dist, p));
});
walk(dist);
fs.writeFileSync(path.join(dist, 'files.json'), JSON.stringify(files));
console.log(page);
console.log(files.length, 'files');
