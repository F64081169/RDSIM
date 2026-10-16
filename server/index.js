// RDSIM server: static file hosting + authoritative multiplayer game state
// over WebSocket.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  STATIONS,
  STATION_KINDS,
  SEVERITY,
  TASK_TYPES,
  SPRINT_SECONDS,
  INTERMISSION_SECONDS,
  SPAWN,
  operatorSpot,
} from '../shared/layout.js';
import { GENERATORS, checkAnswer } from './puzzles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;

/* ------------------------------------------------------------------ */
/* Static files                                                        */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// URL prefix → directory on disk.
const MOUNTS = [
  ['/vendor/three/build/', path.join(ROOT, 'node_modules/three/build')],
  ['/vendor/three/addons/', path.join(ROOT, 'node_modules/three/examples/jsm')],
  ['/shared/', path.join(ROOT, 'shared')],
  ['/', path.join(ROOT, 'public')],
];

function serveStatic(req, res) {
  let url;
  try {
    url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, players: players.size }));
    return;
  }
  for (const [prefix, dir] of MOUNTS) {
    if (!url.startsWith(prefix)) continue;
    let rel = url.slice(prefix.length);
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(dir, rel);
    if (!file.startsWith(dir + path.sep)) break;
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
        return;
      }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'cache-control': prefix.startsWith('/vendor') ? 'public, max-age=86400' : 'no-cache',
      });
      fs.createReadStream(file).pipe(res);
    });
    return;
  }
  res.writeHead(404).end('Not found');
}

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

/* ------------------------------------------------------------------ */
/* Game state                                                          */
/* ------------------------------------------------------------------ */

const players = new Map();
const tasks = new Map();
let nextPlayerId = 1;
let nextTaskId = 101;

const sprint = {
  n: 0,
  phase: 'review', // 'sprint' | 'review'
  endsAt: Date.now() + 3000,
  progress: 0,
  goal: 100,
  escaped: 0,
  fixed: 0,
  shipped: null,
  incidentAt: 0,
  history: [],
};

const PALETTE = ['#4fc3f7', '#ff8a65', '#81c784', '#ba68c8', '#ffd54f', '#f06292', '#4db6ac', '#9575cd', '#e57373', '#aed581'];
const EXPIRY = { P0: 75, P1: 150, P2: 210, P3: 270 };

const send = (ws, msg) => {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
};
const broadcast = (msg, except) => {
  const data = JSON.stringify(msg);
  for (const p of players.values()) if (p.ws !== except && p.ws.readyState === 1) p.ws.send(data);
};

const publicPlayer = (p) => ({
  id: p.id,
  name: p.name,
  color: p.color,
  score: p.score,
  fixed: p.fixed,
  taskId: p.taskId,
  energy: Math.round(p.energy),
});

const publicTask = (t) => ({
  id: t.id,
  type: t.type,
  title: t.title,
  stationId: t.stationId,
  severity: t.severity,
  points: t.points,
  expiresAt: t.expiresAt,
  assignee: t.assignee,
});

const sendPlayers = () => broadcast({ t: 'players', list: [...players.values()].map(publicPlayer) });
const sendTasks = () => broadcast({ t: 'tasks', list: [...tasks.values()].map(publicTask), now: Date.now() });
const sprintInfo = () => ({
  n: sprint.n,
  version: `v1.${sprint.n}.0`,
  phase: sprint.phase,
  endsAt: sprint.endsAt,
  progress: Math.round(sprint.progress),
  goal: sprint.goal,
  escaped: sprint.escaped,
  fixed: sprint.fixed,
  shipped: sprint.shipped,
  history: sprint.history.slice(-5),
});
const sendSprint = () => broadcast({ t: 'sprint', sprint: sprintInfo(), now: Date.now() });
const toast = (text, kind = 'info') => broadcast({ t: 'toast', text, kind });

function startSprint() {
  sprint.n += 1;
  sprint.phase = 'sprint';
  sprint.endsAt = Date.now() + SPRINT_SECONDS * 1000;
  sprint.progress = 0;
  sprint.escaped = 0;
  sprint.fixed = 0;
  sprint.shipped = null;
  sprint.goal = 90 + 70 * Math.max(1, players.size);
  sprint.incidentAt = Date.now() + (60 + Math.random() * 60) * 1000;
  tasks.clear();
  for (const p of players.values()) p.taskId = null;
  for (let i = 0; i < Math.min(4, 1 + players.size * 2); i++) spawnTask();
  toast(`Sprint ${sprint.n} 開始！目標：在時限內完成 v1.${sprint.n}.0 的發佈`, 'sprint');
  sendSprint();
  sendTasks();
  sendPlayers();
}

function endSprint() {
  sprint.phase = 'review';
  sprint.endsAt = Date.now() + INTERMISSION_SECONDS * 1000;
  sprint.shipped = sprint.progress >= sprint.goal;
  const mvp = [...players.values()].sort((a, b) => b.sprintScore - a.sprintScore)[0];
  sprint.history.push({
    version: `v1.${sprint.n}.0`,
    shipped: sprint.shipped,
    progress: Math.round(sprint.progress),
    goal: sprint.goal,
    mvp: mvp && mvp.sprintScore > 0 ? mvp.name : null,
  });
  for (const p of players.values()) {
    p.sprintScore = 0;
    p.taskId = null;
  }
  tasks.clear();
  toast(
    sprint.shipped ? `🚀 v1.${sprint.n}.0 成功出貨！客戶很滿意` : `💥 v1.${sprint.n}.0 延期了…老闆在找你`,
    sprint.shipped ? 'good' : 'bad',
  );
  sendSprint();
  sendTasks();
  sendPlayers();
}

function weightedSeverity() {
  const r = Math.random();
  if (r < 0.2) return 'P1';
  if (r < 0.7) return 'P2';
  return 'P3';
}

function spawnTask(forceSeverity) {
  const busy = new Set([...tasks.values()].map((t) => t.stationId));
  const free = STATIONS.filter((s) => !busy.has(s.id));
  if (!free.length) return null;
  const st = free[Math.floor(Math.random() * free.length)];
  const types = STATION_KINDS[st.kind].tasks;
  const type = types[Math.floor(Math.random() * types.length)];
  const severity = forceSeverity || weightedSeverity();
  const { title, pub, solution } = GENERATORS[type]();
  const now = Date.now();
  const task = {
    id: nextTaskId++,
    type,
    stationId: st.id,
    severity,
    title: severity === 'P0' ? `【產線】${title}` : title,
    points: Math.round(TASK_TYPES[type].base * SEVERITY[severity].mult),
    createdAt: now,
    expiresAt: now + EXPIRY[severity] * 1000,
    assignee: null,
    attempts: 0,
    pub,
    solution,
  };
  tasks.set(task.id, task);
  return task;
}

function releaseTask(p) {
  if (!p.taskId) return;
  const t = tasks.get(p.taskId);
  if (t && t.assignee === p.id) t.assignee = null;
  p.taskId = null;
}

function tick() {
  const now = Date.now();
  if (now >= sprint.endsAt) {
    if (sprint.phase === 'sprint') endSprint();
    else if (players.size > 0) startSprint();
    else sprint.endsAt = now + 2000;
    return;
  }
  if (sprint.phase !== 'sprint') return;

  let changed = false;
  for (const t of [...tasks.values()]) {
    if (now >= t.expiresAt) {
      tasks.delete(t.id);
      const penalty = Math.round(t.points / 2);
      sprint.progress = Math.max(0, sprint.progress - penalty);
      sprint.escaped += 1;
      for (const p of players.values()) if (p.taskId === t.id) p.taskId = null;
      toast(`🐛 Bug #${t.id}「${t.title}」流到客戶端了！進度 -${penalty}`, 'bad');
      changed = true;
    }
  }

  const target = Math.min(STATIONS.length - 2, 2 + players.size * 2);
  if (tasks.size < target && Math.random() < 0.5) {
    if (spawnTask()) changed = true;
  }

  if (now >= sprint.incidentAt) {
    sprint.incidentAt = now + (70 + Math.random() * 70) * 1000;
    const t = spawnTask('P0');
    if (t) {
      broadcast({ t: 'incident', taskId: t.id, stationId: t.stationId });
      toast(`🚨 產線緊急事件！Bug #${t.id}：${t.title}`, 'alarm');
      changed = true;
    }
  }

  if (changed) {
    sendTasks();
    sendSprint();
    sendPlayers();
  }
}

setInterval(tick, 1000);

// Position snapshots at 15 Hz.
setInterval(() => {
  if (players.size < 2) return;
  const list = [];
  for (const p of players.values()) {
    list.push([p.id, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.ry.toFixed(3), +p.pitch.toFixed(3), p.moving ? 1 : 0]);
  }
  broadcast({ t: 'snap', list });
}, 1000 / 15);

/* ------------------------------------------------------------------ */
/* Connections                                                         */
/* ------------------------------------------------------------------ */

const clean = (s, max) =>
  String(s ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, max);

wss.on('connection', (ws) => {
  let me = null;
  let msgBudget = 60;
  const refill = setInterval(() => (msgBudget = 60), 1000);

  ws.on('message', (raw) => {
    if (--msgBudget < 0) return;
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (!m || typeof m.t !== 'string') return;

    if (!me) {
      if (m.t !== 'hello') return;
      const id = nextPlayerId++;
      const color = /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : PALETTE[id % PALETTE.length];
      me = {
        id,
        ws,
        name: clean(m.name, 16) || `工程師${id}`,
        color,
        x: SPAWN.x + (Math.random() - 0.5) * 3,
        y: 0,
        z: SPAWN.z,
        ry: 0,
        pitch: 0,
        moving: false,
        score: 0,
        sprintScore: 0,
        fixed: 0,
        energy: 100,
        taskId: null,
      };
      players.set(id, me);
      send(ws, {
        t: 'welcome',
        id,
        you: publicPlayer(me),
        spawn: { x: me.x, z: me.z },
        players: [...players.values()].map(publicPlayer),
        tasks: [...tasks.values()].map(publicTask),
        sprint: sprintInfo(),
        now: Date.now(),
      });
      sendPlayers();
      toast(`👋 ${me.name} 加入了研發部`, 'info');
      if (sprint.phase === 'review' && players.size === 1) sprint.endsAt = Math.min(sprint.endsAt, Date.now() + 3000);
      return;
    }

    switch (m.t) {
      case 'move': {
        const n = (v, lim) => (Number.isFinite(v) ? Math.max(-lim, Math.min(lim, v)) : 0);
        me.x = n(m.x, 30);
        me.y = n(m.y, 5);
        me.z = n(m.z, 30);
        me.ry = n(m.ry, 1e4);
        me.pitch = n(m.pitch, 2);
        me.moving = !!m.moving;
        if (Number.isFinite(m.energy)) me.energy = Math.max(0, Math.min(100, m.energy));
        break;
      }
      case 'claim': {
        const t = tasks.get(Number(m.taskId));
        if (!t || sprint.phase !== 'sprint') return send(ws, { t: 'claimFail', reason: '這個任務已經不存在了' });
        if (t.assignee && t.assignee !== me.id) {
          const other = players.get(t.assignee);
          return send(ws, { t: 'claimFail', reason: `${other ? other.name : '別人'} 正在處理這個 bug` });
        }
        const st = STATIONS.find((s) => s.id === t.stationId);
        const spot = operatorSpot(st);
        if (Math.hypot(me.x - spot.x, me.z - spot.z) > 4) return send(ws, { t: 'claimFail', reason: '離工作台太遠了' });
        if (me.taskId && me.taskId !== t.id) releaseTask(me);
        t.assignee = me.id;
        me.taskId = t.id;
        send(ws, { t: 'claimed', task: { ...publicTask(t), pub: t.pub, attempts: t.attempts } });
        sendTasks();
        sendPlayers();
        break;
      }
      case 'release': {
        releaseTask(me);
        sendTasks();
        sendPlayers();
        break;
      }
      case 'submit': {
        const t = tasks.get(Number(m.taskId));
        if (!t || t.assignee !== me.id) return send(ws, { t: 'result', taskId: m.taskId, ok: false, msg: '任務已失效', closed: true });
        const res = checkAnswer(t.type, t.solution, m.answer);
        if (!res.ok) {
          t.attempts += 1;
          send(ws, { t: 'result', taskId: t.id, ok: false, msg: res.msg, attempts: t.attempts });
          return;
        }
        // Pair-programming bonus: another engineer standing nearby.
        const st = STATIONS.find((s) => s.id === t.stationId);
        const spot = operatorSpot(st);
        const buddy = [...players.values()].find(
          (p) => p !== me && Math.hypot(p.x - spot.x, p.z - spot.z) < 3.2,
        );
        const attemptFactor = Math.max(0.4, 1 - 0.2 * t.attempts);
        const pts = Math.round(t.points * attemptFactor * (buddy ? 1.5 : 1));
        tasks.delete(t.id);
        me.taskId = null;
        me.score += pts;
        me.sprintScore += pts;
        me.fixed += 1;
        if (buddy) {
          const bonus = Math.round(pts * 0.25);
          buddy.score += bonus;
          buddy.sprintScore += bonus;
        }
        sprint.progress += pts;
        sprint.fixed += 1;
        send(ws, { t: 'result', taskId: t.id, ok: true, msg: res.msg, points: pts, buddy: buddy?.name, closed: true });
        toast(
          `✅ ${me.name} 解決了 #${t.id}「${t.title}」+${pts}${buddy ? `（與 ${buddy.name} 結對加成）` : ''}`,
          t.severity === 'P0' ? 'good' : 'info',
        );
        if (t.severity === 'P0') broadcast({ t: 'incident', taskId: null });
        sendTasks();
        sendSprint();
        sendPlayers();
        break;
      }
      case 'chat': {
        const text = clean(m.text, 140);
        if (text) broadcast({ t: 'chat', id: me.id, name: me.name, color: me.color, text });
        break;
      }
      case 'emote': {
        const e = clean(m.e, 8);
        if (e) broadcast({ t: 'emote', id: me.id, e }, ws);
        break;
      }
      case 'ping':
        send(ws, { t: 'pong', c: m.c, now: Date.now() });
        break;
      default:
    }
  });

  ws.on('close', () => {
    clearInterval(refill);
    if (!me) return;
    releaseTask(me);
    players.delete(me.id);
    broadcast({ t: 'leave', id: me.id });
    toast(`🚪 ${me.name} 下班了`, 'info');
    sendPlayers();
    sendTasks();
  });
});

server.listen(PORT, () => {
  console.log(`RDSIM server running at http://localhost:${PORT}`);
});
