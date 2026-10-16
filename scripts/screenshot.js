// Visual QA: launches the game in headless Chromium with two players and
// captures screenshots from several viewpoints into ./screenshots.
//   PORT=3000 npm start   (in another shell)
//   npm run screenshot
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { GENERATORS } from '../shared/puzzles.js';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}

const BASE = process.env.URL || `http://localhost:${process.env.PORT || 3000}`;
const OUT = 'screenshots';
fs.mkdirSync(OUT, { recursive: true });

// Each player gets its own browser so they don't share one (software) GPU
// process, which would starve the second page.
const browsers = [];
const launch = async () => {
  const b = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  browsers.push(b);
  return b;
};
const W = Number(process.env.W || 1280);
const H = Number(process.env.H || 720);

async function open(name, extra = '') {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('console', (m) => m.type() === 'error' && console.log(`[${name}] console:`, m.text()));
  page.on('pageerror', (e) => console.log(`[${name}] pageerror:`, e.message));
  await page.goto(`${BASE}/?nolock&name=${encodeURIComponent(name)}${extra}`, { waitUntil: 'commit', timeout: 120000 });
  await page.waitForFunction(() => window.__rdsim, null, { timeout: 120000 });
  return page;
}

const title = await open('Title');
await title.waitForTimeout(2500);
await title.screenshot({ path: `${OUT}/00-title.png` });
await title.close();

const a = await open('Alice', '&autojoin');
const b = await open('Bob', '&autojoin&lq');
await a.waitForTimeout(3500);

const views = (process.env.VIEWS ? JSON.parse(process.env.VIEWS) : [
  ['01-spawn', 0, 10.5, 0, -0.05],
  ['02-desks', -10, 3.6, 0.35, -0.12],
  ['03-benches', 15.5, -1.5, -1.2, -0.12],
  ['04-windows', 0, -2, 1.45, 0.02],
  ['05-coffee', 13, 9, -2.3, -0.1],
  ['06-kanban', -4, -9.5, 0, 0.12],
  ['07-lounge', -12, 7, 1.2, -0.1],
]);

// Put Bob somewhere visible in front of Alice for the spawn shot.
await b.evaluate(() => window.__rdsim.setView(1.2, 7.5, Math.PI, 0));
await a.waitForTimeout(800);

for (const [name, x, z, yaw, pitch] of views) {
  await a.evaluate(([x, z, yaw, pitch]) => window.__rdsim.setView(x, z, yaw, pitch), [x, z, yaw, pitch]);
  await a.waitForTimeout(900);
  await a.screenshot({ path: `${OUT}/${name}.png` });
  console.log('saved', name);
}

if (process.env.TASK) {
  // Walk to the first open task and open its UI.
  const opened = await a.evaluate(async () => {
    const { state, world, setView } = window.__rdsim;
    const t = state.tasks.find((x) => !x.assignee);
    if (!t) return null;
    const so = world.stations[t.stationId];
    const st = so.st;
    setView(so.spot.x, so.spot.z, st.ry, -0.3);
    await new Promise((r) => setTimeout(r, 3000));
    return { type: t.type, focus: state.lastFocus && state.lastFocus.id, station: t.stationId };
  });
  await a.keyboard.press('e');
  await a.waitForTimeout(3000);
  console.log('opened task', opened);
  await a.screenshot({ path: `${OUT}/10-task-${opened?.type}.png` });
}

if (process.env.GALLERY) {
  // Render every task UI with a freshly generated puzzle (no server claim).
  let id = 9000;
  for (const [type, gen] of Object.entries(GENERATORS)) {
    const p = gen();
    const task = { id: id++, type, title: p.title, stationId: 'D1', severity: 'P1', points: 20, attempts: 0, pub: p.pub };
    await a.evaluate((t) => window.__rdsim.openModal(t), task);
    await a.waitForTimeout(1500);
    await a.screenshot({ path: `${OUT}/20-ui-${type}.png` });
    console.log('saved ui', type);
  }
}

for (const br of browsers) await br.close();
