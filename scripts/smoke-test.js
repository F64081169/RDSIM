// Smoke test: puzzle generator/verifier round-trips + a two-client
// multiplayer session against a freshly started server.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { GENERATORS, checkAnswer } from '../server/puzzles.js';
import { STATIONS, operatorSpot } from '../shared/layout.js';

/* ---------- Puzzles ---------- */
const solve = {
  codefix: (s) => ({ line: [].concat(s.line)[0] }),
  register: (s) => ({ value: s.value }),
  pwm: (s) => {
    // Brute-force a valid PSC/ARR like a player would.
    for (let psc = 0; psc < 65536; psc++) {
      const arr = Math.round(s.clk / (psc + 1) / s.freq) - 1;
      if (arr < 1 || arr > 65535) continue;
      const f = s.clk / ((psc + 1) * (arr + 1));
      if (Math.abs(f - s.freq) / s.freq > 0.005) continue;
      const ccr = Math.round(((arr + 1) * s.duty) / 100);
      return { psc, arr, ccr };
    }
    throw new Error('no pwm solution');
  },
  uart: (s) => ({ baud: s.baud, answer: s.answer }),
  flash: (s) => ({ file: s.file, steps: s.steps }),
};
for (const [type, gen] of Object.entries(GENERATORS)) {
  for (let i = 0; i < 200; i++) {
    const p = gen();
    assert.ok(p.title && p.pub && p.solution, `${type} shape`);
    assert.equal(checkAnswer(type, p.solution, solve[type](p.solution)).ok, true, `${type} solvable`);
    assert.equal(checkAnswer(type, p.solution, {}).ok, false, `${type} rejects empty`);
  }
  if (type === 'uart') {
    const p = gen();
    assert.ok(p.pub.options.includes(p.solution.answer), 'uart answer among options');
  }
  if (type === 'flash') {
    const p = gen();
    assert.ok(p.pub.files.includes(p.solution.file), 'flash file among options');
  }
}
console.log('✔ puzzles: all generators solvable and verifiable');

/* ---------- Multiplayer ---------- */
const PORT = 3900 + Math.floor(Math.random() * 90);
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => srv.stdout.once('data', r));

function client(name) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    inbox.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); }
  });
  const c = {
    ws,
    send: (m) => ws.send(JSON.stringify(m)),
    wait: (pred, ms = 8000) =>
      new Promise((res, rej) => {
        const hit = inbox.find(pred);
        if (hit) return res(hit);
        const w = { pred, res };
        waiters.push(w);
        setTimeout(() => rej(new Error(`${name}: timeout`)), ms);
      }),
    inbox,
  };
  return new Promise((r) => ws.on('open', () => r(c)));
}

try {
  const a = await client('A');
  const b = await client('B');
  a.send({ t: 'hello', name: 'Alice<script>', color: '#ff0000' });
  const wa = await a.wait((m) => m.t === 'welcome');
  assert.equal(wa.you.name, 'Alicescript', 'name sanitized');
  b.send({ t: 'hello', name: 'Bob' });
  await b.wait((m) => m.t === 'welcome');
  // Sprint starts within a few seconds once someone is online.
  const sp = await a.wait((m) => m.t === 'sprint' && m.sprint.phase === 'sprint', 10000);
  assert.ok(sp.sprint.goal > 0);
  const tasks = (await a.wait((m) => m.t === 'tasks' && m.list.length > 0)).list;
  const task = tasks[0];
  const st = STATIONS.find((s) => s.id === task.stationId);
  const spot = operatorSpot(st);

  // Too far away → refused.
  a.send({ t: 'claim', taskId: task.id });
  assert.match((await a.wait((m) => m.t === 'claimFail')).reason, /遠/);

  a.send({ t: 'move', x: spot.x, y: 0, z: spot.z, ry: 0, pitch: 0, moving: false });
  await new Promise((r) => setTimeout(r, 100));
  a.send({ t: 'claim', taskId: task.id });
  const claimed = await a.wait((m) => m.t === 'claimed');
  assert.equal(claimed.task.id, task.id);
  assert.equal(claimed.task.solution, undefined, 'solution not leaked');

  // B cannot take a task A is working on.
  b.send({ t: 'move', x: spot.x, y: 0, z: spot.z + 0.5, ry: 0, pitch: 0, moving: false });
  await new Promise((r) => setTimeout(r, 100));
  b.send({ t: 'claim', taskId: task.id });
  assert.match((await b.wait((m) => m.t === 'claimFail')).reason, /Alice/);

  a.send({ t: 'submit', taskId: task.id, answer: { nonsense: true } });
  const bad = await a.wait((m) => m.t === 'result');
  assert.equal(bad.ok, false);

  a.send({ t: 'chat', text: 'hello team' });
  const chat = await b.wait((m) => m.t === 'chat');
  assert.equal(chat.text, 'hello team');

  // Snapshots are broadcast with both players.
  const snap = await b.wait((m) => m.t === 'snap' && m.list.length === 2);
  assert.equal(snap.list.length, 2);

  a.send({ t: 'release' });
  b.send({ t: 'claim', taskId: task.id });
  await b.wait((m) => m.t === 'claimed');

  a.ws.close();
  await b.wait((m) => m.t === 'leave');
  b.ws.close();
  console.log('✔ multiplayer: join, claim lock, submit, chat, snapshots, leave');
} finally {
  srv.kill();
}
