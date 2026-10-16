import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { STATIONS, SEVERITY, TASK_TYPES, STATION_KINDS, ROOM } from '../../shared/layout.js';
import { buildWorld } from './world.js';
import { Player } from './player.js';
import { Avatar } from './avatars.js';
import { Net } from './net.js';
import { RoomNet } from './room-net.js';
import { TASK_UI } from './tasks.js';
import { initAudio, sfx } from './audio.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

/* ------------------------------------------------------------------ */
/* Renderer, scene, post-processing                                    */
/* ------------------------------------------------------------------ */

const canvasEl = $('game');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: false, powerPreference: 'high-performance' });
} catch (e) {
  $('fatal').classList.remove('hidden');
  $('fatal').textContent = '你的瀏覽器不支援 WebGL，無法執行 RDSIM。';
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10141b);
scene.fog = new THREE.Fog(0x1a1f2a, 30, 70);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.38;

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 140);

// Lighting: warm low sun through the west windows + cool ceiling fill.
const hemi = new THREE.HemisphereLight(0xdde7ff, 0x40362e, 0.55);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffb27a, 4.2);
sun.position.set(-44, 13, 6);
sun.target.position.set(0, 0, 0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -26;
sun.shadow.camera.right = 26;
sun.shadow.camera.top = 18;
sun.shadow.camera.bottom = -18;
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 90;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

const world = buildWorld(scene);

// First-person viewmodel: the engineer's trusty coffee mug.
scene.add(camera);
const viewmodel = new THREE.Group();
{
  const mugMat = new THREE.MeshStandardMaterial({ color: 0x115e59, roughness: 0.4, envMapIntensity: 0.6 });
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.1, 24, 1, true), mugMat);
  mugMat.side = THREE.DoubleSide;
  viewmodel.add(mug);
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.04, 24), mugMat);
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = -0.05;
  viewmodel.add(bottom);
  const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.042, 24), new THREE.MeshStandardMaterial({ color: 0x3b2314, roughness: 0.2 }));
  coffee.rotation.x = -Math.PI / 2;
  coffee.position.y = 0.035;
  viewmodel.add(coffee);
  viewmodel.userData.coffee = coffee;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.008, 8, 16, Math.PI), mugMat);
  handle.rotation.z = -Math.PI / 2;
  handle.position.set(0.045, 0, 0);
  viewmodel.add(handle);
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.03), new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.5 }));
  logo.position.set(-0.012, 0, 0.0445);
  logo.rotation.y = -0.25;
  viewmodel.add(logo);
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), new THREE.MeshStandardMaterial({ color: 0xe8b796, roughness: 0.7 }));
  hand.scale.set(1.1, 0.8, 1.3);
  hand.position.set(0.06, -0.03, 0.02);
  viewmodel.add(hand);
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.3, 16), new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.9 }));
  sleeve.rotation.x = Math.PI / 2.4;
  sleeve.position.set(0.09, -0.08, 0.17);
  viewmodel.add(sleeve);
  viewmodel.position.set(0.26, -0.24, -0.42);
  viewmodel.rotation.y = -0.35;
  viewmodel.scale.setScalar(0.8);
  viewmodel.visible = false;
  viewmodel.traverse((o) => {
    if (o.material) o.material.depthTest = true;
  });
  camera.add(viewmodel);
}

// Post-processing chain.
const rt = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.5, 0.55, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const gradePass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uTired: { value: 0 },
    uAlarm: { value: 0 },
    uVignette: { value: 0.9 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uTired, uAlarm, uVignette; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      float r2 = dot(d, d);
      // Subtle chromatic aberration toward the edges.
      float ca = 0.0018 * r2 * 4.0 + uTired * 0.004;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + d * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - d * ca).b;
      // Gentle filmic grade: lift shadows toward teal, warm highlights.
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, col * vec3(0.94, 1.0, 1.06), (1.0 - l) * 0.35);
      col = mix(col, col * vec3(1.05, 1.0, 0.94), l * 0.25);
      col = mix(vec3(l), col, 1.08 - uTired * 0.8);
      // Vignette.
      float vig = smoothstep(0.85, 0.2, r2 * (1.6 + uTired * 2.0)) ;
      col *= mix(1.0, vig, uVignette);
      col = mix(col, col * vec3(1.35, 0.6, 0.6), uAlarm * (0.5 + 0.5 * sin(uTime * 6.0)) * 0.35 * smoothstep(0.05, 0.45, r2));
      col += (hash(uv * 1000.0 + uTime) - 0.5) * 0.018;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
composer.addPass(gradePass);

let hq = params.get('lq') == null;
function applyQuality() {
  renderer.shadowMap.enabled = hq;
  sun.castShadow = hq;
  scene.traverse((o) => {
    if (o.material) o.material.needsUpdate = true;
  });
  renderer.setPixelRatio(hq ? Math.min(window.devicePixelRatio, 2) : 1);
  resize();
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, h);
}
window.addEventListener('resize', resize);

/* ------------------------------------------------------------------ */
/* Particles (task completion bursts)                                  */
/* ------------------------------------------------------------------ */

const bursts = [];
const dotTexture = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
function burst(x, y, z, color) {
  const n = 80;
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  const vel = [];
  for (let i = 0; i < n; i++) {
    pos.set([x, y, z], i * 3);
    const a = Math.random() * Math.PI * 2;
    const u = Math.random() * 0.8 + 0.2;
    vel.push(new THREE.Vector3(Math.cos(a) * u * 2, 2 + Math.random() * 3, Math.sin(a) * u * 2));
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ color, size: 0.09, map: dotTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  m.color.multiplyScalar(hq ? 2.2 : 1);
  const p = new THREE.Points(g, m);
  scene.add(p);
  bursts.push({ p, vel, life: 1.6 });
}
function updateBursts(dt) {
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i];
    b.life -= dt;
    const a = b.p.geometry.attributes.position;
    for (let k = 0; k < b.vel.length; k++) {
      b.vel[k].y -= 6 * dt;
      a.array[k * 3] += b.vel[k].x * dt;
      a.array[k * 3 + 1] = Math.max(0.02, a.array[k * 3 + 1] + b.vel[k].y * dt);
      a.array[k * 3 + 2] += b.vel[k].z * dt;
    }
    a.needsUpdate = true;
    b.p.material.opacity = Math.max(0, b.life / 1.6);
    if (b.life <= 0) {
      scene.remove(b.p);
      b.p.geometry.dispose();
      b.p.material.dispose();
      bursts.splice(i, 1);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Game state                                                          */
/* ------------------------------------------------------------------ */

const player = new Player(camera, canvasEl, world.colliders);
// The claude.ai Artifact build has no server: it plays over the artifact's room.
const net = window.RDSIM_ARTIFACT ? new RoomNet() : new Net();
const state = {
  joined: false,
  myId: null,
  players: new Map(),
  avatars: new Map(),
  tasks: [],
  sprint: null,
  clockOffset: 0,
  incident: false,
  modal: null, // { task, ui }
  pendingClaim: null,
  coffeeReadyAt: 0,
  lastFocus: null,
  chatOpen: false,
  tiredWarned: false,
};
const now = () => Date.now() + state.clockOffset;

/* ------------------------------------------------------------------ */
/* Login                                                               */
/* ------------------------------------------------------------------ */

const COLORS = ['#4fc3f7', '#ff8a65', '#81c784', '#ba68c8', '#ffd54f', '#f06292', '#4db6ac', '#9575cd', '#e57373', '#aed581'];
const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};
let chosenColor = store.get('rdsim.color') || COLORS[Math.floor(Math.random() * COLORS.length)];
for (const c of COLORS) {
  const b = document.createElement('button');
  b.style.background = c;
  b.className = c === chosenColor ? 'on' : '';
  b.onclick = () => {
    chosenColor = c;
    [...$('colors').children].forEach((x) => x.classList.toggle('on', x === b));
  };
  $('colors').append(b);
}
$('name').value = params.get('name') || store.get('rdsim.name') || '';
$('name').addEventListener('keydown', (e) => e.key === 'Enter' && join());
$('join').onclick = join;

async function join() {
  if (state.joined) return;
  initAudio();
  const name = $('name').value.trim() || `工程師${Math.floor(Math.random() * 900 + 100)}`;
  store.set('rdsim.name', name);
  store.set('rdsim.color', chosenColor);
  $('join').disabled = true;
  $('conn').textContent = '連線中…';
  try {
    await net.connect();
  } catch (e) {
    $('conn').textContent = '❌ ' + e.message;
    $('join').disabled = false;
    return;
  }
  net.send({ t: 'hello', name, color: chosenColor });
}

/* ------------------------------------------------------------------ */
/* Network handlers                                                    */
/* ------------------------------------------------------------------ */

net.on('welcome', (m) => {
  state.joined = true;
  state.myId = m.id;
  state.clockOffset = m.now - Date.now();
  $('login').classList.add('hidden');
  $('hud').classList.remove('hidden');
  player.setPosition(m.spawn.x, m.spawn.z, 0);
  player.pitch = -0.05;
  player.enabled = true;
  setPlayers(m.players);
  setTasks(m.tasks);
  setSprint(m.sprint);
  $('me-name').textContent = m.you.name;
  addChat(null, '系統', '#94a3b8', '歡迎來到研發部！走到有發光標記的工作台按 E 開始修 bug。');
  if (!params.has('nolock')) ensureLock();
  else showPause(false);
});

net.on('players', (m) => setPlayers(m.list));
net.on('tasks', (m) => {
  state.clockOffset = m.now - Date.now();
  setTasks(m.list);
});
net.on('sprint', (m) => setSprint(m.sprint));
net.on('leave', (m) => {
  const a = state.avatars.get(m.id);
  if (a) a.dispose();
  state.avatars.delete(m.id);
});
net.on('snap', (m) => {
  for (const [id, x, y, z, ry, pitch, moving] of m.list) {
    if (id === state.myId) continue;
    const a = state.avatars.get(id);
    if (a) a.setTarget(x, y, z, ry, pitch, !!moving, !a.seen);
    if (a) a.seen = true;
  }
});
net.on('toast', (m) => toast(m.text, m.kind));
net.on('chat', (m) => {
  addChat(m.id, m.name, m.color, m.text);
  state.avatars.get(m.id)?.say(m.text);
});
net.on('emote', (m) => state.avatars.get(m.id)?.emote(m.e));
net.on('incident', (m) => {
  state.incident = !!m.taskId;
  world.setIncident(state.incident);
  if (state.incident) sfx.alarm();
});
net.on('claimed', (m) => openModal(m.task));
net.on('claimFail', (m) => {
  state.pendingClaim = null;
  toast(m.reason, 'bad');
  sfx.bad();
});
net.on('result', (m) => {
  const modal = state.modal;
  if (!modal || modal.task.id !== m.taskId) return;
  modal.resolve?.(m);
  modal.resolve = null;
  if (m.ok) {
    sfx.ok();
    feedback(`✅ 修好了！+${m.points} pts${m.buddy ? `（和 ${m.buddy} 結對加成 ×1.5）` : ''}${m.msg ? '<br>💡 ' + m.msg : ''}`, 'good');
    const so = world.stations[modal.task.stationId];
    burst(so.group.position.x, 1.4, so.group.position.z, new THREE.Color(SEVERITY[modal.task.severity].color));
    modal.done = true;
    setTimeout(() => state.modal?.done && closeModal(false), m.msg ? 3200 : 1500);
  } else {
    sfx.bad();
    player.energy = Math.max(0, player.energy - 6);
    feedback('❌ ' + (m.msg || '失敗'), 'bad');
    $('task-modal').querySelector('.modal-card').classList.remove('shake');
    void $('task-modal').offsetWidth;
    $('task-modal').querySelector('.modal-card').classList.add('shake');
    if (m.closed) setTimeout(() => closeModal(false), 1200);
  }
});
net.on('disconnect', () => {
  $('fatal').classList.remove('hidden');
  $('fatal').innerHTML = '與伺服器的連線中斷了 🔌<br><br><button class="btn primary" onclick="location.reload()">重新連線</button>';
  player.unlock();
});

function setPlayers(list) {
  const seen = new Set();
  state.players = new Map(list.map((p) => [p.id, p]));
  for (const p of list) {
    seen.add(p.id);
    if (p.id === state.myId) {
      $('me-score').textContent = p.score;
      continue;
    }
    let a = state.avatars.get(p.id);
    if (!a) {
      a = new Avatar(scene, p);
      a.setTarget(0, 0, 10.5, 0, 0, false, true);
      state.avatars.set(p.id, a);
    }
    a.setInfo(p);
  }
  for (const [id, a] of state.avatars) {
    if (!seen.has(id)) {
      a.dispose();
      state.avatars.delete(id);
    }
  }
  $('st-online').textContent = list.length;
  renderBoard();
}

function setTasks(list) {
  state.tasks = list;
  const byStation = new Map(list.map((t) => [t.stationId, t]));
  for (const st of STATIONS) world.setStationTask(st.id, byStation.get(st.id) || null, byStation.get(st.id)?.assignee === state.myId);
  if (state.modal && !state.modal.done && !list.some((t) => t.id === state.modal.task.id)) {
    feedback('這個任務已經被關閉了（Sprint 結束或已過期）', 'bad');
    setTimeout(() => closeModal(false), 1200);
  }
  if (!list.some((t) => t.severity === 'P0') && state.incident) {
    state.incident = false;
    world.setIncident(false);
  }
  world.drawBoards({ tasks: list, sprint: state.sprint, players: state.players, now: now() });
}

function setSprint(s) {
  const prev = state.sprint;
  state.sprint = s;
  $('sprint-name').textContent = `Sprint ${s.n || '—'}`;
  $('sprint-ver').textContent = s.version;
  $('st-fixed').textContent = s.fixed;
  $('st-escaped').textContent = s.escaped;
  const pct = Math.min(100, (s.progress / s.goal) * 100);
  $('sprint-bar').style.width = pct + '%';
  $('sprint-bar').classList.toggle('done', pct >= 100);
  $('sprint-pct').textContent = `${s.progress} / ${s.goal}`;
  const review = $('review');
  if (s.phase === 'review' && s.shipped !== null) {
    review.classList.remove('hidden');
    const last = s.history[s.history.length - 1];
    review.innerHTML = `<h2>${s.shipped ? '🚀 出貨成功！' : '💥 Release 延期'}</h2>
      <div class="big" style="color:${s.shipped ? '#34d399' : '#f43f5e'}">${s.version}</div>
      <p>進度 ${s.progress}/${s.goal} · 修復 ${s.fixed} · 外流 ${s.escaped}${last?.mvp ? ` · MVP：<b>${last.mvp}</b>` : ''}</p>
      <p id="review-count"></p>`;
    if (prev && prev.phase === 'sprint') (s.shipped ? sfx.ship : sfx.fail)();
    if (state.modal) closeModal(false);
  } else {
    review.classList.add('hidden');
  }
  renderBoard();
}

/* ------------------------------------------------------------------ */
/* HUD                                                                 */
/* ------------------------------------------------------------------ */

function toast(text, kind = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  $('toasts').prepend(el);
  while ($('toasts').children.length > 5) $('toasts').lastChild.remove();
  if (kind !== 'alarm') sfx.toast();
  setTimeout(() => el.classList.add('out'), 5500);
  setTimeout(() => el.remove(), 6100);
}

function addChat(id, name, color, text) {
  const line = document.createElement('div');
  line.className = 'chat-line';
  const b = document.createElement('b');
  b.style.color = color;
  b.textContent = name;
  line.append(b, document.createTextNode(text));
  $('chat-log').append(line);
  while ($('chat-log').children.length > 30) $('chat-log').firstChild.remove();
  setTimeout(() => line.classList.add('fade'), 9000);
}

function fmtTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

const SEV_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 };
function renderTaskList() {
  const ul = $('tasks');
  const list = [...state.tasks].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || a.expiresAt - b.expiresAt);
  $('task-count').textContent = list.length;
  ul.innerHTML = '';
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = state.sprint?.phase === 'review' ? 'Sprint Review 中…' : '目前沒有 bug 🎉';
    ul.append(li);
    return;
  }
  const t0 = now();
  for (const t of list.slice(0, 7)) {
    const so = world.stations[t.stationId];
    const dx = so.spot.x - player.pos.x;
    const dz = so.spot.z - player.pos.z;
    const dist = Math.hypot(dx, dz);
    // Angle relative to view direction: 0 = straight ahead.
    const ang = Math.atan2(dx, -dz) + player.yaw;
    const li = document.createElement('li');
    if (t.assignee === state.myId) li.className = 'mine';
    else if (dist < 2) li.className = 'near';
    const who = t.assignee ? state.players.get(t.assignee)?.name || '?' : null;
    const left = (t.expiresAt - t0) / 1000;
    li.innerHTML = `<span class="sev-bar" style="background:${SEVERITY[t.severity].color}"></span>
      <span class="t-title"></span>
      <span class="t-right"><b>${t.points}</b>${fmtTime(left)}</span>
      <span class="t-meta">${t.severity} · ${STATION_KINDS[STATIONS.find((s) => s.id === t.stationId).kind].label} ${t.stationId} · <span class="dir" style="transform:rotate(${ang}rad)">↑</span> ${dist.toFixed(0)}m${who ? ` · 🔧${who}` : ''}</span>`;
    li.querySelector('.t-title').textContent = `#${t.id} ${t.title}`;
    if (left < 30) li.querySelector('.t-right').style.color = '#fda4af';
    ul.append(li);
  }
}

function renderBoard() {
  const tb = $('board-body');
  tb.innerHTML = '';
  [...state.players.values()]
    .sort((a, b) => b.score - a.score)
    .forEach((p, i) => {
      const tr = document.createElement('tr');
      const task = p.taskId ? state.tasks.find((t) => t.id === p.taskId) : null;
      tr.innerHTML = `<td class="num">${i + 1}</td><td><span class="dot" style="background:${p.color}"></span><span class="nm"></span></td><td class="num">${p.fixed}</td><td class="num">${p.score}</td><td>${task ? '🔧 #' + task.id : p.energy < 15 ? '😴 想睡' : '🚶 閒晃'}</td>`;
      tr.querySelector('.nm').textContent = p.name + (p.id === state.myId ? '（你）' : '');
      tb.append(tr);
    });
  const hist = state.sprint?.history || [];
  $('history').innerHTML = hist.length ? '' : '<span>尚無發佈紀錄</span>';
  for (const h of hist) {
    const s = document.createElement('span');
    s.className = h.shipped ? 'ok' : 'no';
    s.textContent = `${h.shipped ? '✔' : '✖'} ${h.version} ${h.progress}/${h.goal}`;
    $('history').append(s);
  }
}

function hudTick() {
  if (!state.joined || !state.sprint) return;
  const s = state.sprint;
  const left = (s.endsAt - now()) / 1000;
  const tEl = $('sprint-time');
  tEl.textContent = s.phase === 'sprint' ? fmtTime(left) : fmtTime(left);
  tEl.classList.toggle('urgent', s.phase === 'sprint' && left < 45);
  if (s.phase === 'review' && $('review-count')) $('review-count').textContent = `下一個 Sprint 將在 ${Math.max(0, Math.ceil(left))} 秒後開始…`;
  renderTaskList();
  world.drawBoards({ tasks: state.tasks, sprint: s, players: state.players, now: now() });
}
setInterval(hudTick, 500);

/* ------------------------------------------------------------------ */
/* Interaction                                                         */
/* ------------------------------------------------------------------ */

const fwd = new THREE.Vector3();
function findFocus() {
  if (state.modal) return null;
  camera.getWorldDirection(fwd);
  let best = null;
  let bestD = 1.7;
  for (const id in world.stations) {
    const o = world.stations[id];
    const dx = o.group.position.x - player.pos.x;
    const dz = o.group.position.z - player.pos.z;
    const dSpot = Math.hypot(o.spot.x - player.pos.x, o.spot.z - player.pos.z);
    const facing = (dx * fwd.x + dz * fwd.z) / Math.max(0.001, Math.hypot(dx, dz));
    if (dSpot < bestD && facing > 0.2) {
      best = { kind: 'station', id, o };
      bestD = dSpot;
    }
  }
  const cdx = world.coffeeSpot.x - player.pos.x;
  const cdz = world.coffeeSpot.z - player.pos.z;
  if (Math.hypot(cdx, cdz) < 1.6 && (cdx * fwd.x + (cdz + 1) * fwd.z) > -0.2) best = { kind: 'coffee' };
  return best;
}

function updatePrompt() {
  const f = findFocus();
  state.lastFocus = f;
  const el = $('prompt');
  if (!f || (!player.locked && !isTouch && !params.has('nolock'))) {
    el.classList.add('hidden');
    return;
  }
  let html = '';
  if (f.kind === 'coffee') {
    const cd = Math.ceil((state.coffeeReadyAt - Date.now()) / 1000);
    html = cd > 0 ? `☕ 咖啡機加熱中… <span class="muted">${cd}s</span>` : `<kbd>E</kbd> 來杯咖啡 <span class="muted">恢復精神</span>`;
  } else {
    const t = state.tasks.find((x) => x.stationId === f.id);
    const label = `${STATION_KINDS[f.o.st.kind].label} ${f.id}`;
    if (!t) html = `${label} · <span class="muted">目前一切正常</span>`;
    else if (t.assignee && t.assignee !== state.myId) html = `${label} · 🔧 ${esc(state.players.get(t.assignee)?.name || '同事')} 正在處理 <span class="muted">站旁邊可獲得結對加成</span>`;
    else
      html = `<kbd>E</kbd> ${TASK_TYPES[t.type].label}：<b>${esc(t.title)}</b> <span class="muted">${t.severity} · ${t.points} pts</span>`;
  }
  if (el.dataset.html !== html) {
    el.innerHTML = html;
    el.dataset.html = html;
  }
  el.classList.remove('hidden');
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function interact() {
  const f = state.lastFocus;
  if (!f) return;
  if (f.kind === 'coffee') {
    if (Date.now() < state.coffeeReadyAt) return;
    state.coffeeReadyAt = Date.now() + 15000;
    player.energy = Math.min(100, player.energy + 45);
    state.tiredWarned = false;
    sfx.coffee();
    toast('☕ 咖啡因注入完成，精神 +45', 'good');
    net.send({ t: 'emote', e: '☕' });
    return;
  }
  const t = state.tasks.find((x) => x.stationId === f.id);
  if (!t) return;
  if (t.assignee && t.assignee !== state.myId) {
    toast('同事正在處理這個 bug，站在旁邊可以拿結對加成！', 'info');
    return;
  }
  state.pendingClaim = t.id;
  net.send({ t: 'claim', taskId: t.id });
}

/* ------------------------------------------------------------------ */
/* Task modal                                                          */
/* ------------------------------------------------------------------ */

function feedback(html, kind = '') {
  const fb = $('tm-foot').querySelector('.feedback');
  if (!fb) return;
  fb.className = `feedback ${kind}`;
  fb.innerHTML = html;
}

function openModal(task) {
  state.pendingClaim = null;
  if (state.modal) closeModal(true);
  player.enabled = false;
  player.keys.clear();
  player.unlock();
  sfx.open();
  $('pause').classList.add('hidden');
  $('prompt').classList.add('hidden');
  const sev = SEVERITY[task.severity];
  $('tm-sev').textContent = sev.label;
  $('tm-sev').style.background = sev.color;
  $('tm-title').textContent = `#${task.id} ${task.title}`;
  $('tm-type').textContent = `${TASK_TYPES[task.type].label} · 工作站 ${task.stationId} · ${task.points} pts${task.attempts ? ` · 已失敗 ${task.attempts} 次` : ''}`;
  const body = $('tm-body');
  const foot = $('tm-foot');
  body.innerHTML = '';
  foot.innerHTML = '<div class="feedback"></div>';
  const modal = { task, resolve: null, done: false };
  const api = {
    submit(answer) {
      return new Promise((resolve) => {
        modal.resolve = resolve;
        net.send({ t: 'submit', taskId: task.id, answer });
      });
    },
    button(label, cls, onClick) {
      const b = document.createElement('button');
      b.className = `btn ${cls}`;
      b.textContent = label;
      b.onclick = onClick;
      foot.append(b);
      return b;
    },
  };
  modal.ui = TASK_UI[task.type](body, task, api) || {};
  state.modal = modal;
  $('task-modal').classList.remove('hidden');
}

function closeModal(silent) {
  const m = state.modal;
  if (!m) return;
  m.ui.dispose?.();
  state.modal = null;
  $('task-modal').classList.add('hidden');
  if (!m.done) net.send({ t: 'release' });
  if (!silent) sfx.close();
  player.enabled = true;
  if (state.joined && !params.has('nolock')) ensureLock();
}
$('tm-close').onclick = () => closeModal(false);

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

function showPause(show) {
  $('pause').classList.toggle('hidden', !show);
}
const isTouch = matchMedia('(pointer: coarse)').matches;
// Pointer lock can be refused outside a user gesture; fall back to the
// "click to continue" overlay so the player is never stuck.
function ensureLock() {
  if (isTouch) return;
  player.lock();
  setTimeout(() => {
    if (state.joined && !player.locked && !state.modal && !state.chatOpen) showPause(true);
  }, 350);
}
document.addEventListener('pointerlockerror', () => state.joined && !state.modal && showPause(true));
if (isTouch) {
  const b = document.createElement('button');
  b.className = 'touch-e';
  b.textContent = 'E';
  b.addEventListener('touchstart', (e) => {
    e.preventDefault();
    interact();
  });
  $('hud').append(b);
}
player.onLockChange = (locked) => {
  if (!state.joined) return;
  showPause(!locked && !state.modal && !state.chatOpen && $('fatal').classList.contains('hidden'));
};
$('pause').addEventListener('click', (e) => {
  if (e.target.closest('.pause-card')) return;
  player.lock();
});
canvasEl.addEventListener('click', () => state.joined && !state.modal && player.lock());
$('opt-hq').checked = hq;
$('opt-hq').addEventListener('change', (e) => {
  hq = e.target.checked;
  applyQuality();
});
$('opt-sens').addEventListener('input', (e) => (player.sensitivity = Number(e.target.value)));

const EMOTES = { Digit1: '👍', Digit2: '😂', Digit3: '🔥', Digit4: '🙏' };

window.addEventListener('keydown', (e) => {
  if (!state.joined) return;
  if (state.modal) {
    if (e.key === 'Escape') closeModal(false);
    else if (e.key === 'Enter' && e.target.tagName !== 'INPUT') state.modal.ui.onEnter?.();
    return;
  }
  if (state.chatOpen) {
    if (e.key === 'Escape') closeChat();
    return;
  }
  if (e.code === 'Tab') {
    e.preventDefault();
    renderBoard();
    $('board').classList.remove('hidden');
  } else if (e.code === 'KeyE') {
    interact();
  } else if (e.key === 'Enter' || e.code === 'KeyT') {
    e.preventDefault();
    openChat();
  } else if (EMOTES[e.code]) {
    net.send({ t: 'emote', e: EMOTES[e.code] });
    addChat(state.myId, '你', '#94a3b8', EMOTES[e.code]);
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Tab') $('board').classList.add('hidden');
});

function openChat() {
  state.chatOpen = true;
  player.keys.clear();
  player.enabled = false;
  $('chat').classList.add('open');
  const input = $('chat-input');
  input.classList.remove('hidden');
  input.value = '';
  setTimeout(() => input.focus(), 0);
}
function closeChat() {
  state.chatOpen = false;
  player.enabled = true;
  $('chat').classList.remove('open');
  $('chat-input').classList.add('hidden');
  $('chat-input').blur();
  if (!player.locked && !params.has('nolock')) ensureLock();
}
$('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const text = e.target.value.trim();
    if (text) net.send({ t: 'chat', text });
    closeChat();
    e.stopPropagation();
  } else if (e.key === 'Escape') {
    closeChat();
  }
});

/* ------------------------------------------------------------------ */
/* Main loop                                                           */
/* ------------------------------------------------------------------ */

const clock = new THREE.Clock();
let sendAcc = 0;
let titleT = 0;
let stepAcc = 0;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  world.update(dt, state.joined ? player.pos : null);
  updateBursts(dt);

  if (state.joined) {
    const speed = player.update(dt);
    // Energy model.
    const sprinting = speed > 4.5;
    player.energy = Math.max(0, player.energy - dt * (0.12 + (sprinting ? 0.35 : 0) + (state.modal ? 0.2 : 0)));
    const eb = $('energy-bar');
    eb.style.width = player.energy + '%';
    eb.classList.toggle('low', player.energy < 15);
    if (player.energy < 15 && !state.tiredWarned) {
      state.tiredWarned = true;
      toast('😴 你快睡著了…去咖啡補給站來杯咖啡吧！', 'bad');
    }
    gradePass.uniforms.uTired.value += ((player.energy < 15 ? 0.6 : 0) - gradePass.uniforms.uTired.value) * Math.min(1, dt * 2);
    if (player.moving && player.onGround) {
      stepAcc += dt * speed;
      if (stepAcc > 1.6) {
        stepAcc = 0;
        sfx.step();
      }
    }
    for (const a of state.avatars.values()) a.update(dt);
    // Viewmodel sway + coffee level follows energy.
    viewmodel.visible = !state.modal;
    const sway = Math.min(1, speed / 3.6);
    viewmodel.position.set(0.27 + Math.cos(player.bob) * 0.012 * sway, -0.25 + Math.abs(Math.sin(player.bob)) * 0.012 * sway - (state.chatOpen ? 0.1 : 0), -0.42);
    viewmodel.userData.coffee.position.y = -0.04 + 0.075 * (player.energy / 100);
    updatePrompt();
    sendAcc += dt;
    if (sendAcc > 1 / 15) {
      sendAcc = 0;
      net.send({ t: 'move', x: player.pos.x, y: player.pos.y, z: player.pos.z, ry: player.yaw, pitch: player.pitch, moving: player.moving, energy: player.energy });
    }
  } else {
    // Title-screen camera: a slow dolly through the lab.
    titleT += dt * 0.05;
    const a = titleT;
    camera.position.set(Math.sin(a) * 9 + 2, 2.3 + Math.sin(a * 2) * 0.3, Math.cos(a) * 5 + 4);
    camera.lookAt(Math.sin(a + 0.8) * 6, 1.2, Math.cos(a + 0.8) * 3 - 4);
  }

  gradePass.uniforms.uTime.value += dt;
  gradePass.uniforms.uAlarm.value += ((state.incident ? 1 : 0) - gradePass.uniforms.uAlarm.value) * Math.min(1, dt * 3);
  if (hq) composer.render(dt);
  else renderer.render(scene, camera);
}

applyQuality();
frame();

// Debug / screenshot hooks.
window.__rdsim = { state, player, camera, world, scene, join, openModal, net, setView: (x, z, yaw, pitch) => {
  player.pos.set(x, 0, z);
  player.yaw = yaw;
  player.pitch = pitch;
} };
if (params.has('autojoin')) join();
