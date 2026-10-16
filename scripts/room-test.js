// Tests the serverless (Artifact) multiplayer layer: several RoomNet clients
// share an in-memory room that behaves like the claude.ai `room` presence API.
import assert from 'node:assert/strict';
import { RoomNet } from '../public/js/room-net.js';
import { generate } from '../shared/puzzles.js';
import { STATIONS, operatorSpot } from '../shared/layout.js';

const hub = { peers: new Map(), listeners: new Map() };
function makeRoom(peer) {
  hub.peers.set(peer, { peer, presence: Object.freeze({}), updatedAt: Date.now() });
  const view = () =>
    [...hub.peers.values()].map((p) => Object.freeze({ ...p, by: null, kind: 'viewer', guest: false, isMe: p.peer === peer, sameTab: p.peer === peer }));
  const notify = () => setTimeout(() => hub.listeners.forEach((fn, who) => hub.peers.has(who) && fn({ peers: [] })), 5);
  return {
    presence(patch) {
      const cur = hub.peers.get(peer);
      if (!cur) return Promise.resolve();
      const p = { ...cur.presence };
      for (const [k, v] of Object.entries(patch)) v === null ? delete p[k] : (p[k] = v);
      const size = new TextEncoder().encode(JSON.stringify(p)).length;
      if (size > 4096) return Promise.reject({ code: 'invalid_argument', message: `presence ${size} bytes` });
      hub.peers.set(peer, { ...cur, presence: Object.freeze(p), updatedAt: Date.now() });
      notify();
      return Promise.resolve();
    },
    peers: view,
    onPeers(fn) {
      hub.listeners.set(peer, fn);
      return () => hub.listeners.delete(peer);
    },
    leave() {
      hub.peers.delete(peer);
      hub.listeners.delete(peer);
      notify();
    },
  };
}

async function client(peer, name) {
  const room = makeRoom(peer);
  globalThis.window = { claude: { use: async (n) => (n === 'room' ? room : null) } };
  const net = new RoomNet();
  await net.connect();
  const inbox = [];
  for (const t of ['welcome', 'tasks', 'sprint', 'players', 'toast', 'claimed', 'claimFail', 'result', 'chat', 'snap', 'leave', 'incident'])
    net.on(t, (m) => inbox.push({ ...m, t }));
  net.send({ t: 'hello', name, color: '#4fc3f7' });
  const wait = async (pred, ms = 12000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const hit = inbox.find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`${name}: timeout`);
  };
  return { net, room, inbox, wait, peer };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const a = await client('aaaa', 'Alice');
  await sleep(300);
  const b = await client('bbbb', 'Bob');
  const wa = await a.wait((m) => m.t === 'welcome');
  const wb = await b.wait((m) => m.t === 'welcome');
  assert.equal(wa.id, 'aaaa');
  assert.equal(wb.id, 'bbbb');
  assert.ok(a.net.core && !b.net.core, 'exactly one host');

  const sprint = await b.wait((m) => m.t === 'sprint' && m.sprint.phase === 'sprint');
  assert.ok(sprint.sprint.goal >= 230, 'goal scales with two players');
  const tasks = (await b.wait((m) => m.t === 'tasks' && m.list.length > 0)).list;
  const task = tasks[0];
  const spot = operatorSpot(STATIONS.find((s) => s.id === task.stationId));

  // Too far → refused by the host.
  b.net.send({ t: 'claim', taskId: task.id });
  assert.match((await b.wait((m) => m.t === 'claimFail')).reason, /遠/);

  b.net.send({ t: 'move', x: spot.x, y: 0, z: spot.z, ry: 0, pitch: 0, moving: false, energy: 90 });
  await sleep(200);
  b.net.send({ t: 'claim', taskId: task.id });
  const claimed = await b.wait((m) => m.t === 'claimed');
  assert.equal(claimed.task.id, task.id);
  assert.ok(claimed.task.pub, 'puzzle regenerated from seed');

  // Alice cannot take it; she sees Bob as the assignee.
  a.net.send({ t: 'move', x: spot.x + 0.5, y: 0, z: spot.z, ry: 0, pitch: 0, moving: false, energy: 90 });
  await sleep(200);
  a.net.send({ t: 'claim', taskId: task.id });
  assert.match((await a.wait((m) => m.t === 'claimFail')).reason, /Bob/);

  b.net.send({ t: 'submit', taskId: task.id, answer: { wrong: 1 } });
  const bad = await b.wait((m) => m.t === 'result');
  assert.equal(bad.ok, false);

  const sol = generate(task.type, task.seed).solution;
  const answer = {
    codefix: { line: [].concat(sol.line)[0] },
    register: { value: sol.value },
    uart: { baud: sol.baud, answer: sol.answer },
    flash: { file: sol.file, steps: sol.steps },
    pwm: (() => {
      for (let psc = 0; psc < 65536; psc++) {
        const arr = Math.round(sol.clk / (psc + 1) / sol.freq) - 1;
        if (arr < 1 || arr > 65535) continue;
        if (Math.abs(sol.clk / ((psc + 1) * (arr + 1)) - sol.freq) / sol.freq > 0.005) continue;
        return { psc, arr, ccr: Math.round(((arr + 1) * sol.duty) / 100) };
      }
    })(),
  }[task.type];
  b.net.send({ t: 'submit', taskId: task.id, answer });
  const ok = await b.wait((m) => m.t === 'result' && m.ok);
  assert.ok(ok.points > 0);
  assert.equal(ok.buddy, 'Alice', 'pair bonus from standing nearby');
  await a.wait((m) => m.t === 'toast' && /Bob 解決了/.test(m.text));
  const pa = await a.wait((m) => m.t === 'players' && m.list.find((p) => p.id === 'bbbb')?.score > 0);
  assert.ok(pa);

  a.net.send({ t: 'chat', text: '午餐吃什麼？' });
  assert.equal((await b.wait((m) => m.t === 'chat')).text, '午餐吃什麼？');
  await b.wait((m) => m.t === 'snap' && m.list.some((p) => p[0] === 'aaaa'));

  // Presence stays within the platform's 4 KiB limit.
  for (const p of hub.peers.values()) assert.ok(new TextEncoder().encode(JSON.stringify(p.presence)).length <= 4096);

  // Host hand-off: Alice leaves, Bob adopts the game and keeps his score.
  const n = sprint.sprint.n;
  clearInterval(a.net.timer);
  a.room.leave();
  await b.wait((m) => m.t === 'leave' && m.id === 'aaaa');
  await sleep(600);
  assert.ok(b.net.core, 'Bob became host');
  assert.equal(b.net.core.sprint.n, n, 'sprint carried over');
  assert.ok(b.net.core.scores.bbbb[0] > 0, 'score carried over');
  clearInterval(b.net.timer);
  console.log('✔ room: election, claim lock, solve with pair bonus, chat, snapshots, host hand-off');
  process.exit(0);
} catch (e) {
  console.error(e);
  process.exit(1);
}
