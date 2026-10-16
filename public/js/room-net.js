// Serverless multiplayer for the claude.ai Artifact build.
//
// Everyone who has the page open shares the artifact's realtime `room`.
// Only presence is used (anyone may set it): each player publishes their
// position and a short queue of actions, and one player — elected
// deterministically — runs the game (sprint clock, tasks, scoring) and
// publishes the shared state in their own presence. If the host leaves, the
// next player adopts the last state they saw and carries on.
//
// RoomNet exposes the same interface and message types as the WebSocket
// `Net`, so main.js does not care which one it talks to. Without a room
// (opened outside claude.ai) it falls back to a local single-player room.
import {
  STATIONS,
  STATION_KINDS,
  SEVERITY,
  TASK_TYPES,
  SPRINT_SECONDS,
  INTERMISSION_SECONDS,
  SPAWN,
  operatorSpot,
} from '../../shared/layout.js';
import { generate, checkAnswer } from '../../shared/puzzles.js';

const TYPES = Object.keys(TASK_TYPES);
const EXPIRY = { P0: 75, P1: 150, P2: 210, P3: 270 };
const MAX_ACTS = 4;
// Presence is capped at 4 KiB per player; the host's game state gets most of
// it, leaving room for the host's own name, position and action queue.
const H_BUDGET = 2900;
const bytes = (o) => new TextEncoder().encode(JSON.stringify(o)).length;
const clean = (s, max) =>
  String(s ?? '')
    .replace(/[\u0000-\u001f\u007f<>\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g, '')
    .trim()
    .slice(0, max);

/* ------------------------------------------------------------------ */
/* Puzzle cache: tasks travel as seeds, everyone regenerates them      */
/* ------------------------------------------------------------------ */

const puzzleCache = new Map();
function puzzle(type, seed) {
  const k = `${type}:${seed}`;
  let p = puzzleCache.get(k);
  if (!p) {
    p = generate(type, seed);
    puzzleCache.set(k, p);
    if (puzzleCache.size > 200) puzzleCache.delete(puzzleCache.keys().next().value);
  }
  return p;
}

// Compact task tuple ⇄ object.
// [id, typeIdx, seed, stationIdx, severity, points, secondsLeft, assigneePeer|0, attempts]
const packTask = (t, now) => [t.id, TYPES.indexOf(t.type), t.seed, STATIONS.findIndex((s) => s.id === t.stationId), t.severity, t.points, Math.max(0, Math.round((t.expiresAt - now) / 1000)), t.assignee || 0, t.attempts];
function unpackTask(a, base) {
  const type = TYPES[a[1]];
  const st = STATIONS[a[3]];
  if (!type || !st || !SEVERITY[a[4]]) return null;
  const p = puzzle(type, a[2]);
  return {
    id: a[0],
    type,
    seed: a[2],
    stationId: st.id,
    severity: a[4],
    points: a[5],
    expiresAt: base + a[6] * 1000,
    assignee: a[7] || null,
    attempts: a[8] || 0,
    title: a[4] === 'P0' ? `【產線】${p.title}` : p.title,
  };
}

/* ------------------------------------------------------------------ */
/* Local fallback room (single player)                                 */
/* ------------------------------------------------------------------ */

class LocalRoom {
  constructor() {
    this.me = Object.freeze({ peer: 'solo', by: null, isMe: true, sameTab: true, kind: 'viewer', guest: false, presence: Object.freeze({}), updatedAt: Date.now() });
    this.fns = [];
  }
  presence(patch) {
    const p = { ...this.me.presence };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete p[k];
      else p[k] = v;
    }
    this.me = Object.freeze({ ...this.me, presence: Object.freeze(p), updatedAt: Date.now() });
    const peers = [this.me];
    queueMicrotask(() => this.fns.forEach((f) => f({ peers, joined: [], left: [], updated: peers })));
    return Promise.resolve();
  }
  peers() {
    return [this.me];
  }
  onPeers(fn) {
    this.fns.push(fn);
    return () => {};
  }
}

/* ------------------------------------------------------------------ */
/* Host: the authoritative game, run by one player                      */
/* ------------------------------------------------------------------ */

class HostCore {
  constructor(prev, now) {
    this.r = {};
    if (prev && prev.s) {
      // Adopt the previous host's state.
      const s = prev.s;
      this.ep = (prev.ep || 0) + 1;
      this.sprint = { n: s.n, phase: s.ph, endsAt: now + s.l, progress: s.pr, goal: s.g, escaped: s.es, fixed: s.fx, shipped: s.sh, history: s.hi || [] };
      this.tasks = (prev.t || []).map((a) => unpackTask(a, now)).filter(Boolean);
      this.scores = { ...(prev.sc || {}) };
      this.log = (prev.lg || []).slice();
      this.logId = this.log.length ? this.log[this.log.length - 1][0] : 0;
      this.nextId = prev.ni || 101;
      this.done = { ...(prev.d || {}) };
      this.incident = prev.in || 0;
      this.known = null;
    } else {
      this.ep = 1;
      this.sprint = { n: 0, phase: 'review', endsAt: now + 3000, progress: 0, goal: 100, escaped: 0, fixed: 0, shipped: null, history: [] };
      this.tasks = [];
      this.scores = {};
      this.log = [];
      this.logId = 0;
      this.nextId = 101;
      this.done = {};
      this.incident = 0;
      this.known = null;
    }
    this.incidentAt = now + (60 + Math.random() * 60) * 1000;
    this.lastTick = 0;
    this.dirty = true;
  }

  say(text, kind = 'info') {
    this.log.push([++this.logId, clean(text, 70), kind]);
    if (this.log.length > 4) this.log.shift();
    this.dirty = true;
  }

  score(peer) {
    return (this.scores[peer] ||= [0, 0, 0]); // [total, fixed, this sprint]
  }

  spawnTask(now, nPlayers, forceSeverity) {
    const busy = new Set(this.tasks.map((t) => t.stationId));
    const free = STATIONS.filter((s) => !busy.has(s.id));
    if (!free.length) return null;
    const st = free[Math.floor(Math.random() * free.length)];
    const types = STATION_KINDS[st.kind].tasks;
    const type = types[Math.floor(Math.random() * types.length)];
    const r = Math.random();
    const severity = forceSeverity || (r < 0.2 ? 'P1' : r < 0.7 ? 'P2' : 'P3');
    const seed = 1 + Math.floor(Math.random() * 2 ** 30);
    const p = puzzle(type, seed);
    const t = {
      id: this.nextId++,
      type,
      seed,
      stationId: st.id,
      severity,
      points: Math.round(TASK_TYPES[type].base * SEVERITY[severity].mult),
      expiresAt: now + EXPIRY[severity] * 1000,
      assignee: null,
      attempts: 0,
      title: severity === 'P0' ? `【產線】${p.title}` : p.title,
    };
    this.tasks.push(t);
    this.dirty = true;
    return t;
  }

  startSprint(now, nPlayers) {
    const s = this.sprint;
    s.n += 1;
    s.phase = 'sprint';
    s.endsAt = now + SPRINT_SECONDS * 1000;
    s.progress = 0;
    s.escaped = 0;
    s.fixed = 0;
    s.shipped = null;
    s.goal = 90 + 70 * Math.max(1, nPlayers);
    this.incidentAt = now + (60 + Math.random() * 60) * 1000;
    this.incident = 0;
    this.tasks = [];
    for (let i = 0; i < Math.min(4, 1 + nPlayers * 2); i++) this.spawnTask(now, nPlayers);
    this.say(`Sprint ${s.n} 開始！目標：在時限內完成 v1.${s.n}.0 的發佈`, 'sprint');
  }

  endSprint(now, players) {
    const s = this.sprint;
    s.phase = 'review';
    s.endsAt = now + INTERMISSION_SECONDS * 1000;
    s.shipped = s.progress >= s.goal;
    let mvp = null;
    for (const p of players.values()) {
      const sc = this.score(p.peer);
      if (sc[2] > 0 && (!mvp || sc[2] > this.score(mvp.peer)[2])) mvp = p;
    }
    s.history.push([s.n, s.shipped ? 1 : 0, Math.round(s.progress), s.goal, mvp ? clean(mvp.presence.n, 16) : '']);
    if (s.history.length > 3) s.history.shift();
    for (const sc of Object.values(this.scores)) sc[2] = 0;
    this.tasks = [];
    this.incident = 0;
    this.say(s.shipped ? `🚀 v1.${s.n}.0 成功出貨！客戶很滿意` : `💥 v1.${s.n}.0 延期了…老闆在找你`, s.shipped ? 'good' : 'bad');
  }

  release(peer) {
    for (const t of this.tasks) if (t.assignee === peer) {
      t.assignee = null;
      this.dirty = true;
    }
  }

  handle(p, act, players, now) {
    const peer = p.peer;
    const res = (code, ...rest) => {
      this.r[peer] = [act.q, code, ...rest];
      this.dirty = true;
    };
    if (act.t === 'claim') {
      const t = this.tasks.find((x) => x.id === Number(act.id));
      if (!t || this.sprint.phase !== 'sprint') return res('f', '這個任務已經不存在了');
      if (t.assignee && t.assignee !== peer) {
        const other = players.get(t.assignee);
        return res('f', `${other ? clean(other.presence.n, 16) : '別人'} 正在處理這個 bug`);
      }
      const spot = operatorSpot(STATIONS.find((s) => s.id === t.stationId));
      const pos = Array.isArray(p.presence.p) ? p.presence.p : [99, 0, 99];
      if (Math.hypot(pos[0] - spot.x, pos[2] - spot.z) > 4) return res('f', '離工作台太遠了');
      this.release(peer);
      t.assignee = peer;
      return res('c', t.id);
    }
    if (act.t === 'release') {
      this.release(peer);
      return;
    }
    if (act.t === 'submit') {
      const t = this.tasks.find((x) => x.id === Number(act.id));
      if (!t || t.assignee !== peer) return res('x');
      const sol = puzzle(t.type, t.seed).solution;
      const out = checkAnswer(t.type, sol, act.ans);
      if (!out.ok) {
        t.attempts += 1;
        return res('n', clean(out.msg, 80), t.attempts);
      }
      const spot = operatorSpot(STATIONS.find((s) => s.id === t.stationId));
      let buddy = null;
      for (const o of players.values()) {
        const op = o.presence.p;
        if (o.peer !== peer && Array.isArray(op) && Math.hypot(op[0] - spot.x, op[2] - spot.z) < 3.2) buddy = o;
      }
      const pts = Math.round(t.points * Math.max(0.4, 1 - 0.2 * t.attempts) * (buddy ? 1.5 : 1));
      this.tasks = this.tasks.filter((x) => x !== t);
      const sc = this.score(peer);
      sc[0] += pts;
      sc[1] += 1;
      sc[2] += pts;
      if (buddy) {
        const b = this.score(buddy.peer);
        const bonus = Math.round(pts * 0.25);
        b[0] += bonus;
        b[2] += bonus;
      }
      this.sprint.progress += pts;
      this.sprint.fixed += 1;
      if (t.severity === 'P0') this.incident = 0;
      const buddyName = buddy ? clean(buddy.presence.n, 16) : '';
      res('o', pts, buddyName, clean(out.msg || '', 90));
      this.say(`✅ ${clean(p.presence.n, 16)} 解決了 #${t.id}「${t.title}」+${pts}${buddyName ? `（與 ${buddyName} 結對加成）` : ''}`, t.severity === 'P0' ? 'good' : 'info');
    }
  }

  update(now, players) {
    // Arrivals and departures.
    const ids = new Set(players.keys());
    if (!this.known) this.known = ids;
    for (const id of ids) if (!this.known.has(id)) this.say(`👋 ${clean(players.get(id).presence.n, 16)} 加入了研發部`);
    for (const id of this.known) {
      if (!ids.has(id)) {
        this.release(id);
        delete this.scores[id];
        delete this.done[id];
        delete this.r[id];
        this.say('🚪 有同事下班了');
      }
    }
    this.known = ids;

    // Player actions.
    for (const p of players.values()) {
      const acts = Array.isArray(p.presence.a) ? p.presence.a : [];
      const last = this.done[p.peer];
      if (last === undefined) {
        // First sight of this player: don't replay their history.
        this.done[p.peer] = acts.reduce((m, a) => Math.max(m, Number(a?.q) || 0), 0);
        continue;
      }
      for (const a of acts) {
        if (!a || typeof a !== 'object' || !(Number(a.q) > this.done[p.peer])) continue;
        this.done[p.peer] = Number(a.q);
        this.handle(p, a, players, now);
      }
    }

    // Clock-driven state, once a second.
    if (now - this.lastTick < 1000) return;
    this.lastTick = now;
    const s = this.sprint;
    const n = players.size;
    if (now >= s.endsAt) {
      if (s.phase === 'sprint') this.endSprint(now, players);
      else if (n > 0) this.startSprint(now, n);
      return;
    }
    if (s.phase !== 'sprint') return;
    for (const t of [...this.tasks]) {
      if (now >= t.expiresAt) {
        this.tasks = this.tasks.filter((x) => x !== t);
        const penalty = Math.round(t.points / 2);
        s.progress = Math.max(0, s.progress - penalty);
        s.escaped += 1;
        if (t.severity === 'P0' && this.incident === t.id) this.incident = 0;
        this.say(`🐛 Bug #${t.id}「${t.title}」流到客戶端了！進度 -${penalty}`, 'bad');
      }
    }
    const target = Math.min(STATIONS.length - 2, 2 + n * 2);
    if (this.tasks.length < target && Math.random() < 0.5) this.spawnTask(now, n);
    if (now >= this.incidentAt) {
      this.incidentAt = now + (70 + Math.random() * 70) * 1000;
      const t = this.spawnTask(now, n, 'P0');
      if (t) {
        this.incident = t.id;
        this.say(`🚨 產線緊急事件！Bug #${t.id}：${t.title}`, 'alarm');
      }
    }
    this.dirty = true; // timers moved
  }

  serialize(now) {
    const s = this.sprint;
    const h = {
      ep: this.ep,
      s: { n: s.n, ph: s.phase, l: Math.max(0, Math.round(s.endsAt - now)), pr: Math.round(s.progress), g: s.goal, es: s.escaped, fx: s.fixed, sh: s.shipped, hi: s.history },
      t: this.tasks.map((t) => packTask(t, now)),
      sc: this.scores,
      lg: this.log,
      ni: this.nextId,
      d: this.done,
      in: this.incident,
      r: this.r,
    };
    // Keep within the presence budget: trim the least important parts first.
    while (bytes(h) > H_BUDGET && (h.lg.length > 1 || h.s.hi.length > 0)) {
      if (h.lg.length > 1) h.lg = h.lg.slice(1);
      else h.s = { ...h.s, hi: h.s.hi.slice(1) };
    }
    if (bytes(h) > H_BUDGET) {
      // Last resort: drop explanations from per-player results.
      h.r = Object.fromEntries(Object.entries(h.r).map(([k, v]) => [k, v.slice(0, 3)]));
    }
    return h;
  }
}

/* ------------------------------------------------------------------ */
/* RoomNet                                                             */
/* ------------------------------------------------------------------ */

export class RoomNet {
  constructor() {
    this.handlers = {};
    this.open = false;
    this.room = null;
    this.solo = true;
    this.q = 0;
    this.acts = [];
    this.core = null;
    this.hostPeer = null;
    this.lastHostH = null;
    this.seenH = null;
    this.hRecv = 0;
    this.sig = {};
    this.lastLog = null;
    this.lastRes = 0;
    this.lastIncident = 0;
    this.chatSeen = new Map();
    this.prevPlayers = new Set();
    this.welcomed = false;
  }
  on(type, fn) {
    (this.handlers[type] ||= []).push(fn);
    return this;
  }
  emit(type, msg) {
    for (const fn of this.handlers[type] || []) fn(msg);
  }

  async connect() {
    let room = null;
    try {
      room = window.claude?.use ? await window.claude.use('room') : null;
    } catch {
      room = null;
    }
    this.solo = !room;
    this.room = room || new LocalRoom();
    this.open = true;
  }

  presence(patch) {
    this.room.presence(patch).catch(() => {});
  }

  me() {
    return this.room.peers().find((p) => p.sameTab) || null;
  }

  send(m) {
    if (!this.open) return;
    switch (m.t) {
      case 'hello': {
        this.name = clean(m.name, 16) || '工程師';
        this.color = /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : '#4fc3f7';
        this.spawn = { x: SPAWN.x + (Math.random() - 0.5) * 3, z: SPAWN.z };
        this.presence({ n: this.name, c: this.color, p: [+this.spawn.x.toFixed(2), 0, this.spawn.z, 0, 0, 0], e: 100, a: [] });
        this.room.onPeers?.(() => this.onRoom(), () => {});
        // Give the room a moment to introduce everyone (and the current host).
        setTimeout(() => {
          this.loop();
          this.timer = setInterval(() => this.loop(), 100);
        }, this.solo ? 50 : 1500);
        break;
      }
      case 'move': {
        const p = [m.x, m.y, m.z, m.ry, m.pitch].map((v) => +(+v || 0).toFixed(2));
        p.push(m.moving ? 1 : 0);
        const key = p.join(',') + '|' + Math.round(m.energy / 5);
        if (key === this.lastMove) return;
        this.lastMove = key;
        this.presence({ p, e: Math.round(m.energy) });
        break;
      }
      case 'claim':
        return this.act({ t: 'claim', id: m.taskId });
      case 'release':
        return this.act({ t: 'release' });
      case 'submit':
        return this.act({ t: 'submit', id: m.taskId, ans: m.answer });
      case 'chat': {
        const text = clean(m.text, 60);
        if (!text) return;
        this.act({ t: 'chat', x: text });
        const me = this.me();
        this.emit('chat', { t: 'chat', id: me?.peer, name: this.name, color: this.color, text });
        return;
      }
      case 'emote':
        return this.act({ t: 'emote', e: clean(m.e, 8) });
      default:
    }
  }

  act(a) {
    a.q = ++this.q;
    this.acts.push(a);
    if (this.acts.length > MAX_ACTS) this.acts.shift();
    this.presence({ a: this.acts });
  }

  players() {
    const map = new Map();
    for (const p of this.room.peers()) {
      if (p.kind === 'viewer' && p.presence && typeof p.presence.n === 'string') map.set(p.peer, p);
    }
    return map;
  }

  electHost(players) {
    const list = [...players.values()];
    const claimers = list.filter((p) => p.presence.h && typeof p.presence.h === 'object');
    if (claimers.length) {
      claimers.sort((a, b) => (b.presence.h.ep || 0) - (a.presence.h.ep || 0) || (a.peer < b.peer ? -1 : 1));
      return claimers[0];
    }
    list.sort((a, b) => (a.peer < b.peer ? -1 : 1));
    return list[0] || null;
  }

  loop() {
    const now = Date.now();
    const players = this.players();
    const me = this.me();
    if (!me || !players.has(me.peer)) return;
    const host = this.electHost(players);
    if (host && !host.sameTab && host.presence.h) this.lastHostH = host.presence.h;

    if (host && host.sameTab) {
      if (!this.core) this.core = new HostCore(this.lastHostH, now);
      this.core.update(now, players);
      if (this.core.dirty && now - (this.lastPublish || 0) > 250) {
        this.core.dirty = false;
        this.lastPublish = now;
        this.presence({ h: this.core.serialize(now) });
      }
    } else if (this.core) {
      // Someone with a newer claim took over.
      this.core = null;
      this.presence({ h: null });
    }
    this.derive(players, host, now);
  }

  onRoom() {
    if (!this.welcomed) return;
    this.sendSnap(this.players());
  }

  sendSnap(players) {
    const list = [];
    for (const p of players.values()) {
      if (p.sameTab) continue;
      const a = p.presence.p;
      if (!Array.isArray(a) || a.length < 6) continue;
      list.push([p.peer, +a[0] || 0, +a[1] || 0, +a[2] || 0, +a[3] || 0, +a[4] || 0, a[5] ? 1 : 0]);
    }
    this.emit('snap', { t: 'snap', list });
  }

  derive(players, host, now) {
    const h = host?.presence.h;
    if (!h || !h.s) return; // no game state yet
    if (h !== this.seenH) {
      this.seenH = h;
      this.hRecv = now;
    }
    const base = this.hRecv;
    const me = this.me();

    const tasks = (Array.isArray(h.t) ? h.t : []).map((a) => unpackTask(a, base)).filter(Boolean);
    const scores = h.sc || {};
    const playerList = [...players.values()].map((p) => {
      const sc = Array.isArray(scores[p.peer]) ? scores[p.peer] : [0, 0];
      const task = tasks.find((t) => t.assignee === p.peer);
      return { id: p.peer, name: clean(p.presence.n, 16) || '工程師', color: /^#[0-9a-f]{6}$/i.test(p.presence.c) ? p.presence.c : '#94a3b8', score: +sc[0] || 0, fixed: +sc[1] || 0, taskId: task ? task.id : null, energy: Math.round(+p.presence.e || 0) };
    });
    const s = h.s;
    const sprint = {
      n: s.n,
      version: `v1.${s.n}.0`,
      phase: s.ph,
      endsAt: base + (+s.l || 0),
      progress: s.pr,
      goal: s.g,
      escaped: s.es,
      fixed: s.fx,
      shipped: s.sh,
      history: (s.hi || []).map((x) => ({ version: `v1.${x[0]}.0`, shipped: !!x[1], progress: x[2], goal: x[3], mvp: x[4] || null })),
    };

    if (!this.welcomed) {
      this.welcomed = true;
      this.lastLog = (h.lg || []).reduce((m, l) => Math.max(m, l[0]), 0);
      this.lastRes = (h.r && h.r[me.peer] && h.r[me.peer][0]) || 0;
      this.lastIncident = h.in || 0;
      for (const p of players.values()) this.chatSeen.set(p.peer, maxQ(p.presence.a));
      this.prevPlayers = new Set(players.keys());
      this.emit('welcome', {
        t: 'welcome',
        id: me.peer,
        you: playerList.find((p) => p.id === me.peer),
        spawn: this.spawn,
        players: playerList,
        tasks,
        sprint,
        now,
      });
      if (this.solo) this.emit('toast', { text: '目前是單人模式：在 claude.ai 開啟這個頁面就能和同事一起玩。', kind: 'info' });
      else if (players.size === 1) this.emit('toast', { text: '把這個頁面的連結分享給同事，大家打開後會出現在同一間實驗室。', kind: 'info' });
      if (h.in) this.emit('incident', { taskId: h.in });
      return;
    }

    // Changed state → the same messages the WebSocket server sends.
    const changed = (k, v) => {
      if (this.sig[k] === v) return false;
      this.sig[k] = v;
      return true;
    };
    if (changed('tasks', JSON.stringify(tasks.map((t) => [t.id, t.assignee, t.severity, t.attempts])))) this.emit('tasks', { t: 'tasks', list: tasks, now });
    if (changed('sprint', JSON.stringify([s.n, s.ph, s.pr, s.g, s.es, s.fx, s.sh, s.hi]))) this.emit('sprint', { t: 'sprint', sprint, now });
    if (changed('players', JSON.stringify(playerList.map((p) => [p.id, p.name, p.color, p.score, p.fixed, p.taskId, p.energy < 15])))) this.emit('players', { t: 'players', list: playerList });

    for (const l of h.lg || []) {
      if (l[0] > this.lastLog) {
        this.lastLog = l[0];
        this.emit('toast', { t: 'toast', text: String(l[1]), kind: String(l[2]) });
      }
    }
    if ((h.in || 0) !== this.lastIncident) {
      this.lastIncident = h.in || 0;
      this.emit('incident', { t: 'incident', taskId: h.in || null });
    }

    const r = h.r && h.r[me.peer];
    if (Array.isArray(r) && r[0] > this.lastRes) {
      this.lastRes = r[0];
      const act = this.acts.find((a) => a.q === r[0]);
      const code = r[1];
      if (code === 'c') {
        const t = tasks.find((x) => x.id === r[2]);
        if (t) this.emit('claimed', { t: 'claimed', task: { ...t, pub: puzzle(t.type, t.seed).pub } });
      } else if (code === 'f') this.emit('claimFail', { t: 'claimFail', reason: r[2] });
      else if (code === 'o') this.emit('result', { t: 'result', taskId: act?.id, ok: true, points: r[2], buddy: r[3] || undefined, msg: r[4] || undefined, closed: true });
      else if (code === 'n') this.emit('result', { t: 'result', taskId: act?.id, ok: false, msg: r[2], attempts: r[3] });
      else if (code === 'x') this.emit('result', { t: 'result', taskId: act?.id, ok: false, msg: '任務已失效', closed: true });
    }

    // Chat and emotes straight from each player's own action queue.
    for (const p of players.values()) {
      const seen = this.chatSeen.get(p.peer);
      const acts = Array.isArray(p.presence.a) ? p.presence.a : [];
      if (seen === undefined) {
        this.chatSeen.set(p.peer, maxQ(acts));
        continue;
      }
      let top = seen;
      for (const a of acts) {
        const q = Number(a?.q) || 0;
        if (q <= seen) continue;
        top = Math.max(top, q);
        if (p.sameTab) continue;
        const name = clean(p.presence.n, 16) || '工程師';
        if (a.t === 'chat' && a.x) this.emit('chat', { t: 'chat', id: p.peer, name, color: p.presence.c, text: clean(a.x, 100) });
        if (a.t === 'emote' && a.e) this.emit('emote', { t: 'emote', id: p.peer, e: clean(a.e, 8) });
      }
      this.chatSeen.set(p.peer, top);
    }

    for (const id of this.prevPlayers) if (!players.has(id)) this.emit('leave', { t: 'leave', id });
    this.prevPlayers = new Set(players.keys());
    this.sendSnap(players);
  }
}

function maxQ(acts) {
  return (Array.isArray(acts) ? acts : []).reduce((m, a) => Math.max(m, Number(a?.q) || 0), 0);
}
