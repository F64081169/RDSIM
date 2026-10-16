// Builds dist/rdsim.html: a single self-contained page for publishing as a
// claude.ai Artifact. It plays multiplayer over the artifact's realtime room
// (public/js/room-net.js) instead of the Node WebSocket server.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THREE = '0.169.0';

const result = await build({
  entryPoints: [path.join(ROOT, 'public/js/main.js')],
  bundle: true,
  format: 'esm',
  minify: true,
  write: false,
  target: 'es2022',
  external: ['three', 'three/addons/*'],
  legalComments: 'none',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const body = html
  .slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
  .replace(/<script type="module" src="[^"]*"><\/script>/, '')
  .trim();
const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');

const page = `<title>RDSIM</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;800&family=Noto+Sans+TC:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>
${css}
/* Artifact build: a single dark look on any host theme. */
:root { color-scheme: dark; }
html, body { height: 100%; background: var(--bg); color: var(--text); }
</style>
${body}
<script>window.RDSIM_ARTIFACT = true;</script>
<script type="importmap">
{ "imports": {
  "three": "https://cdn.jsdelivr.net/npm/three@${THREE}/build/three.module.js",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@${THREE}/examples/jsm/"
} }
</script>
<script type="module">
${js}
</script>
`;
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist/rdsim.html'), page);
console.log(`dist/rdsim.html ${(page.length / 1024).toFixed(0)} KB`);
