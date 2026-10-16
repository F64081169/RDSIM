// Builds the R&D lab: architecture, furniture, equipment, lighting and the
// dynamic in-world displays (Kanban board, dashboards, station markers).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ROOM, STATIONS, COFFEE, SEVERITY, operatorSpot } from '/shared/layout.js';
import * as TX from './textures.js';

const { w: W, d: D, h: H } = ROOM;

/* ------------------------------------------------------------------ */
/* Materials                                                           */
/* ------------------------------------------------------------------ */

const M = {};
function initMaterials() {
  const std = (o) => new THREE.MeshStandardMaterial(o);
  M.floor = std({ map: TX.floorTexture(), roughnessMap: TX.floorRoughness(), roughness: 0.82, metalness: 0.0, envMapIntensity: 0.6 });
  M.wall = std({ map: TX.wallTexture(), roughness: 0.92, color: 0xe6e3dc });
  M.wainscot = std({ color: 0x3b4656, roughness: 0.7 });
  M.teal = new THREE.MeshStandardMaterial({ color: 0x0f766e, emissive: 0x14b8a6, emissiveIntensity: 0.6, roughness: 0.4 });
  M.carpet = std({ map: TX.carpetTexture(), roughness: 1 });
  M.wallAccent = std({ color: 0x23344a, roughness: 0.85 });
  M.ceiling = std({ map: TX.ceilingTexture(), roughness: 1, color: 0xbfc3c9 });
  M.baseboard = std({ color: 0x3a4048, roughness: 0.6 });
  M.deskTop = std({ color: 0xe9e4da, roughness: 0.45 });
  M.wood = std({ color: 0xb98a5c, roughness: 0.55 });
  M.metal = std({ color: 0x9aa3ad, roughness: 0.35, metalness: 0.85 });
  M.darkMetal = std({ color: 0x2a2f36, roughness: 0.45, metalness: 0.7 });
  M.black = std({ color: 0x15181c, roughness: 0.5 });
  M.plastic = std({ color: 0x2b2f35, roughness: 0.6 });
  M.lightPlastic = std({ color: 0xd8dbdf, roughness: 0.55 });
  M.esd = std({ color: 0x2f6f9a, roughness: 0.8 });
  M.fabric = std({ color: 0x55657a, roughness: 1 });
  M.fabricWarm = std({ color: 0x8a5a44, roughness: 1 });
  M.chair = std({ color: 0x1d2128, roughness: 0.7 });
  M.glass = new THREE.MeshPhysicalMaterial({
    color: 0xcfe8ff,
    roughness: 0.05,
    metalness: 0,
    transmission: 0,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
  });
  M.frame = std({ color: 0x2b3038, roughness: 0.4, metalness: 0.6 });
  M.panelLight = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf4f8ff, emissiveIntensity: 1.6 });
  M.pot = std({ color: 0xe6e0d6, roughness: 0.7 });
  M.leaf = std({ color: 0x2f7d46, roughness: 0.8, side: THREE.DoubleSide });
  M.leaf2 = std({ color: 0x3d9a57, roughness: 0.8 });
  M.soil = std({ color: 0x3b2a1e, roughness: 1 });
  M.screenOff = std({ color: 0x0a0d12, roughness: 0.2, metalness: 0.4 });
  M.pegboard = std({ color: 0xc9ad83, roughness: 0.9 });
  M.whiteboard = std({ color: 0xfafafa, roughness: 0.25 });
  M.red = std({ color: 0xd8343c, roughness: 0.5 });
  M.yellow = std({ color: 0xf5c518, roughness: 0.5 });
  M.copper = std({ color: 0xc27a3c, roughness: 0.35, metalness: 0.9 });
  M.mug = std({ color: 0xf2f2f2, roughness: 0.3 });
  M.rubber = std({ color: 0x111111, roughness: 0.9 });
}

const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
};

function box(parent, w, h, d, mat, x, y, z, { cast = true, receive = true, solid = false, rounded = 0 } = {}) {
  const g = rounded ? new RoundedBoxGeometry(w, h, d, 2, rounded) : GEO.box;
  const m = new THREE.Mesh(g, mat);
  if (!rounded) m.scale.set(w, h, d);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = receive;
  if (solid) m.userData.solid = true;
  parent.add(m);
  return m;
}

function cyl(parent, rt, rb, h, mat, x, y, z, seg = 16) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function emissiveMat(texture, intensity = 1.25) {
  return new THREE.MeshStandardMaterial({
    color: 0x000000,
    emissive: 0xffffff,
    emissiveMap: texture,
    emissiveIntensity: intensity,
    roughness: 0.25,
    metalness: 0.2,
  });
}

function plane(parent, w, h, mat, x, y, z, ry = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  parent.add(m);
  return m;
}

/* ------------------------------------------------------------------ */
/* World                                                               */
/* ------------------------------------------------------------------ */

export function buildWorld(scene) {
  initMaterials();
  const animated = [];
  const blinkers = [];
  const screens = [];
  const codeScreens = [0, 1, 2, 3, 4].map((i) => new TX.CodeScreen(11 + i * 7));
  screens.push(...codeScreens);
  let codeIdx = 0;
  const nextCode = () => codeScreens[codeIdx++ % codeScreens.length].texture;

  /* ---------------- Architecture ---------------- */
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, D * 2), M.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, D * 2), M.ceiling);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = H;
  ceil.receiveShadow = true;
  scene.add(ceil);

  // North, south, east walls.
  const T = 0.3;
  box(scene, W * 2 + T * 2, H, T, M.wall, 0, H / 2, -D - T / 2, { cast: true });
  box(scene, W * 2 + T * 2, H, T, M.wall, 0, H / 2, D + T / 2, { cast: true });
  box(scene, T, H, D * 2, M.wall, W + T / 2, H / 2, 0, { cast: true });
  // Accent band on the north wall behind the Kanban board.
  box(scene, 16, H, 0.02, M.wallAccent, -4, H / 2, -D + 0.01, { cast: false });

  // West wall with three large windows.
  const wins = [
    [-11.5, -6.5],
    [-4.5, 0.5],
    [2.5, 7.5],
  ];
  const sillY = 0.9;
  const headY = 3.5;
  const wx = -W - T / 2;
  box(scene, T, sillY, D * 2, M.wall, wx, sillY / 2, 0);
  box(scene, T, H - headY, D * 2, M.wall, wx, (H + headY) / 2, 0);
  let zPrev = -D;
  for (const [z0, z1] of [...wins, [D, D]]) {
    if (z0 > zPrev) box(scene, T, headY - sillY, z0 - zPrev, M.wall, wx, (sillY + headY) / 2, (zPrev + z0) / 2);
    zPrev = z1;
  }
  for (const [z0, z1] of wins) {
    const cz = (z0 + z1) / 2;
    const len = z1 - z0;
    const gl = plane(scene, len, headY - sillY, M.glass, -W - 0.05, (sillY + headY) / 2, cz, Math.PI / 2);
    gl.renderOrder = 2;
    // Frames + mullions.
    box(scene, 0.12, 0.08, len, M.frame, -W + 0.02, sillY, cz);
    box(scene, 0.12, 0.08, len, M.frame, -W + 0.02, headY, cz);
    box(scene, 0.12, headY - sillY, 0.07, M.frame, -W + 0.02, (sillY + headY) / 2, z0);
    box(scene, 0.12, headY - sillY, 0.07, M.frame, -W + 0.02, (sillY + headY) / 2, z1);
    for (let k = 1; k < 3; k++) box(scene, 0.08, headY - sillY, 0.05, M.frame, -W + 0.02, (sillY + headY) / 2, z0 + (len * k) / 3, { cast: true });
    box(scene, 0.08, 0.05, len, M.frame, -W + 0.02, 2.5, cz);
    // Window sill.
    box(scene, 0.35, 0.05, len + 0.2, M.deskTop, -W + 0.15, sillY, cz);
  }
  // Outside skyline (unlit, so it can bloom).
  const sky = new THREE.Mesh(
    new THREE.PlaneGeometry(130, 32),
    new THREE.MeshBasicMaterial({ map: TX.skylineTexture(), toneMapped: false, fog: false }),
  );
  sky.position.set(-48, 6, 0);
  sky.rotation.y = Math.PI / 2;
  sky.scale.setScalar(1);
  sky.material.color.setScalar(1.35);
  scene.add(sky);

  // Baseboards.
  box(scene, W * 2, 0.1, 0.03, M.baseboard, 0, 0.05, -D + 0.015, { cast: false });
  box(scene, W * 2, 0.1, 0.03, M.baseboard, 0, 0.05, D - 0.015, { cast: false });
  box(scene, 0.03, 0.1, D * 2, M.baseboard, W - 0.015, 0.05, 0, { cast: false });

  // Ceiling light panels in a grid + a handful of real lights.
  const panelGeo = new THREE.BoxGeometry(1.2, 0.04, 0.6);
  const panels = new THREE.InstancedMesh(panelGeo, M.panelLight, 48);
  let pi = 0;
  const dummy = new THREE.Object3D();
  for (let ix = -3; ix <= 3; ix++)
    for (let iz = -2; iz <= 2; iz++) {
      if (pi >= 48) break;
      dummy.position.set(ix * 5.4, H - 0.02, iz * 5.2);
      dummy.updateMatrix();
      panels.setMatrixAt(pi++, dummy.matrix);
    }
  panels.count = pi;
  scene.add(panels);

  const lights = [];
  for (const [lx, lz] of [
    [-11, -3],
    [-11, 6],
    [0, -6],
    [0, 5],
    [11, -6],
    [11, 5],
  ]) {
    const l = new THREE.PointLight(0xf0f4ff, 6.5, 18, 1.6);
    l.position.set(lx, H - 0.35, lz);
    scene.add(l);
    lights.push(l);
  }

  /* ---------------- Furniture & equipment ---------------- */
  const stationObjs = {};
  for (const st of STATIONS) {
    const g = new THREE.Group();
    g.position.set(st.x, 0, st.z);
    g.rotation.y = st.ry;
    scene.add(g);
    const seed = st.id.charCodeAt(0) * 31 + st.id.charCodeAt(1);
    if (st.kind === 'pc') buildDesk(g, seed, nextCode, blinkers);
    else buildBench(g, st.kind, seed, screens, blinkers, nextCode, st.id.startsWith('I'));
    const marker = buildMarker();
    marker.position.set(0, 2.35, -0.1);
    g.add(marker);
    stationObjs[st.id] = { st, group: g, marker, spot: operatorSpot(st) };
  }

  // Island shelf between the back-to-back benches.
  {
    const a = STATIONS.find((x) => x.id === 'I1');
    const b = STATIONS.find((x) => x.id === 'I2');
    const z = (a.z + b.z) / 2;
    box(scene, 2.0, 0.04, 0.5, M.lightPlastic, a.x, 1.5, z);
    box(scene, 1.6, 0.02, 0.08, M.panelLight, a.x, 1.475, z, { cast: false });
    for (const sx of [-0.95, 0.95]) box(scene, 0.05, 0.6, 0.05, M.darkMetal, a.x + sx, 1.2, z);
    // Spare dev kits on the island shelf.
    for (let i = 0; i < 4; i++) box(scene, 0.25, 0.08, 0.18, [M.red, M.lightPlastic, M.esd, M.yellow][i], a.x - 0.6 + i * 0.4, 1.56, z, { rounded: 0.01 });
  }

  buildServerRacks(scene, blinkers);
  buildCoffee(scene);
  buildLounge(scene, screens);
  buildDecor(scene);
  buildInterior(scene);
  const kanban = buildKanban(scene);
  const tv = buildTV(scene);
  const alarms = buildAlarms(scene);

  // Pegboards with tools behind each east-wall bench.
  const pegMat = new THREE.MeshStandardMaterial({ map: TX.pegboardTexture(), roughness: 0.85 });
  for (const st of STATIONS.filter((x) => x.id.startsWith('B'))) {
    box(scene, 0.03, 1.1, 2.0, M.frame, W - 0.02, 1.95, st.z, { cast: false });
    plane(scene, 1.96, 1.06, pegMat, W - 0.04, 1.95, st.z, -Math.PI / 2);
  }

  /* ---------------- Colliders ---------------- */
  scene.updateMatrixWorld(true);
  const colliders = [];
  const b3 = new THREE.Box3();
  scene.traverse((o) => {
    if (o.userData.solid) {
      b3.setFromObject(o);
      colliders.push({ minX: b3.min.x, maxX: b3.max.x, minZ: b3.min.z, maxZ: b3.max.z, top: b3.max.y });
    }
  });

  /* ---------------- Runtime API ---------------- */
  let incident = false;
  let elapsed = 0;
  const world = {
    colliders,
    stations: stationObjs,
    coffeeSpot: { x: COFFEE.x, z: COFFEE.z - 1.0 },
    lights,
    sunTarget: null,
    update(dt, viewer) {
      elapsed += dt;
      for (const s of screens) s.update(dt);
      for (const b of blinkers) {
        const on = Math.sin(elapsed * b.speed + b.phase) > b.duty;
        b.mesh.material.emissiveIntensity = on ? b.max : 0.08;
      }
      for (const a of animated) a(dt, elapsed);
      for (const id in stationObjs) {
        const m = stationObjs[id].marker;
        if (!m.visible) continue;
        m.userData.gem.rotation.y += dt * 1.6;
        m.userData.gem.position.y = Math.sin(elapsed * 2.4 + m.userData.phase) * 0.07;
        m.userData.ring.scale.setScalar(1 + ((elapsed * 0.8 + m.userData.phase) % 1) * 1.4);
        m.userData.ring.material.opacity = 0.7 * (1 - ((elapsed * 0.8 + m.userData.phase) % 1));
        if (m.userData.urgent) m.userData.gem.material.emissiveIntensity = 2 + Math.sin(elapsed * 12) * 1.2;
        // Fade the beam/ring when you're standing at the bench so it doesn't block the view.
        if (viewer) {
          const sp = stationObjs[id].spot;
          const near = THREE.MathUtils.smoothstep(Math.hypot(viewer.x - sp.x, viewer.z - sp.z), 0.8, 2.6);
          m.userData.beam.material.opacity = m.userData.beamBase * near;
          m.userData.ring.material.opacity *= near;
          m.userData.gem.visible = near > 0.05;
        }
      }
      alarms.update(dt, elapsed, incident);
      if (incident) {
        const k = 0.55 + 0.45 * Math.max(0, Math.sin(elapsed * 6));
        for (const l of lights) l.color.setRGB(1, 0.35 + 0.65 * k, 0.35 + 0.65 * k);
      }
    },
    setStationTask(id, task, mine) {
      const o = stationObjs[id];
      if (!o) return;
      const m = o.marker;
      if (!task) {
        m.visible = false;
        return;
      }
      m.visible = true;
      const col = new THREE.Color(SEVERITY[task.severity].color);
      m.userData.gem.material.color.copy(col);
      m.userData.gem.material.emissive.copy(col);
      m.userData.gem.material.emissiveIntensity = task.assignee ? 0.6 : 1.8;
      m.userData.ring.material.color.copy(col);
      m.userData.ring.visible = !task.assignee;
      m.userData.beam.material.color.copy(col);
      m.userData.beamBase = task.assignee ? 0.05 : 0.16;
      m.userData.beam.material.opacity = m.userData.beamBase;
      m.userData.urgent = task.severity === 'P0' && !task.assignee;
      m.userData.mine = mine;
    },
    setIncident(on) {
      incident = on;
      if (!on) for (const l of lights) l.color.set(0xf0f4ff);
    },
    drawBoards(state) {
      kanban.draw(state);
      tv.draw(state);
    },
  };
  return world;
}

/* ------------------------------------------------------------------ */
/* Station builders                                                    */
/* ------------------------------------------------------------------ */

function buildMarker() {
  const g = new THREE.Group();
  const gem = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.16, 0),
    new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffd23f, emissiveIntensity: 1.8, roughness: 0.2, flatShading: true }),
  );
  gem.scale.y = 1.5;
  g.add(gem);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.2, 0.24, 40),
    new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -1.42;
  g.add(ring);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.22, 1.4, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
  );
  beam.position.y = -0.72;
  g.add(beam);
  g.userData = { gem, ring, beam, phase: Math.random() * 6 };
  g.visible = false;
  return g;
}

function buildChair(g, x, z, rot = 0) {
  const c = new THREE.Group();
  c.position.set(x, 0, z);
  c.rotation.y = rot;
  g.add(c);
  box(c, 0.5, 0.08, 0.48, M.chair, 0, 0.48, 0, { rounded: 0.03 });
  box(c, 0.46, 0.55, 0.06, M.chair, 0, 0.82, 0.24, { rounded: 0.03 }).rotation.x = -0.12;
  cyl(c, 0.025, 0.025, 0.36, M.metal, 0, 0.28, 0);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const leg = box(c, 0.04, 0.03, 0.3, M.darkMetal, Math.sin(a) * 0.15, 0.07, Math.cos(a) * 0.15);
    leg.rotation.y = a;
    cyl(c, 0.025, 0.025, 0.04, M.rubber, Math.sin(a) * 0.3, 0.025, Math.cos(a) * 0.3, 8).rotation.z = Math.PI / 2;
  }
  box(c, 0.05, 0.04, 0.3, M.chair, -0.27, 0.66, 0.02);
  box(c, 0.05, 0.04, 0.3, M.chair, 0.27, 0.66, 0.02);
  return c;
}

function buildMonitor(g, x, z, rotY, texture, w = 0.62, h = 0.36) {
  const m = new THREE.Group();
  m.position.set(x, 0.75, z);
  m.rotation.y = rotY;
  g.add(m);
  box(m, 0.22, 0.015, 0.16, M.plastic, 0, 0.008, 0);
  box(m, 0.04, 0.26, 0.03, M.plastic, 0, 0.14, -0.04);
  box(m, w + 0.03, h + 0.03, 0.03, M.black, 0, 0.2 + h / 2, -0.02, { rounded: 0.008 });
  const scr = plane(m, w, h, emissiveMat(texture, 1.1), 0, 0.2 + h / 2, -0.004);
  return scr;
}

function buildDevBoard(g, x, y, z, seed, blinkers, scale = 1) {
  const b = new THREE.Group();
  b.position.set(x, y, z);
  b.scale.setScalar(scale);
  g.add(b);
  const pcbMat = new THREE.MeshStandardMaterial({ map: TX.pcbTexture(seed), roughness: 0.5, metalness: 0.1 });
  box(b, 0.24, 0.012, 0.16, pcbMat, 0, 0.006, 0);
  box(b, 0.05, 0.008, 0.05, M.black, 0.02, 0.016, 0.0);
  box(b, 0.03, 0.006, 0.02, M.black, -0.06, 0.015, 0.04);
  box(b, 0.035, 0.018, 0.025, M.metal, -0.11, 0.02, 0.0);
  for (let i = 0; i < 2; i++) box(b, 0.006, 0.01, 0.12, M.black, 0.09 + i * 0.015, 0.017, 0);
  const colors = [0x22ff66, 0xff3344, 0x33aaff];
  for (let i = 0; i < 3; i++) {
    const led = box(
      b,
      0.01,
      0.008,
      0.01,
      new THREE.MeshStandardMaterial({ color: colors[i], emissive: colors[i], emissiveIntensity: 3 }),
      -0.02 + i * 0.02,
      0.017,
      -0.06,
      { cast: false },
    );
    blinkers.push({ mesh: led, speed: 2 + ((seed * (i + 1)) % 7), phase: seed + i, duty: i === 0 ? -0.5 : 0.2, max: 4 });
  }
  return b;
}

function buildDesk(g, seed, nextCode, blinkers) {
  // Desk top + legs.
  box(g, 1.7, 0.04, 0.8, M.deskTop, 0, 0.73, 0, { solid: true, rounded: 0.015 });
  for (const sx of [-0.8, 0.8]) {
    box(g, 0.05, 0.71, 0.7, M.darkMetal, sx, 0.355, 0);
  }
  box(g, 1.55, 0.3, 0.02, M.darkMetal, 0, 0.5, -0.36);
  // Privacy partition.
  box(g, 1.9, 1.25, 0.05, M.fabric, 0, 0.625, -0.44, { solid: true, rounded: 0.02 });
  box(g, 1.92, 0.03, 0.07, M.metal, 0, 1.26, -0.44);
  // Dual monitors.
  buildMonitor(g, -0.34, -0.22, 0.18, nextCode());
  buildMonitor(g, 0.34, -0.22, -0.18, nextCode());
  // Keyboard & mouse.
  box(g, 0.44, 0.02, 0.14, M.plastic, -0.05, 0.76, 0.12, { rounded: 0.006 });
  const keys = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.12), new THREE.MeshStandardMaterial({ color: 0x3b4048, roughness: 0.8 }));
  keys.rotation.x = -Math.PI / 2;
  keys.position.set(-0.05, 0.771, 0.12);
  g.add(keys);
  box(g, 0.06, 0.025, 0.1, M.plastic, 0.3, 0.76, 0.14, { rounded: 0.012 });
  // Mug.
  cyl(g, 0.04, 0.036, 0.1, M.mug, 0.65, 0.8, 0.05);
  // Dev board + logic analyzer on the desk.
  buildDevBoard(g, -0.62, 0.75, 0.0, seed, blinkers, 0.9);
  box(g, 0.1, 0.03, 0.07, M.red, 0.58, 0.765, -0.2, { rounded: 0.01 });
  // Desk lamp.
  const lamp = new THREE.Group();
  lamp.position.set(0.72, 0.75, -0.25);
  g.add(lamp);
  cyl(lamp, 0.06, 0.07, 0.02, M.black, 0, 0.01, 0);
  const arm = box(lamp, 0.015, 0.4, 0.015, M.black, 0, 0.2, 0);
  arm.rotation.x = 0.2;
  const head = cyl(lamp, 0.03, 0.06, 0.08, M.black, 0, 0.39, 0.08);
  head.rotation.x = 0.9;
  // Chair.
  buildChair(g, 0, 0.55, Math.PI + (seed % 5) * 0.08 - 0.15);
  // Under-desk PC tower.
  box(g, 0.2, 0.42, 0.45, M.black, 0.6, 0.21, -0.05, { rounded: 0.01 });
  const pw = box(g, 0.012, 0.012, 0.002, new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x38bdf8, emissiveIntensity: 3 }), 0.6, 0.38, 0.176, { cast: false });
  blinkers.push({ mesh: pw, speed: 0.6, phase: seed, duty: -2, max: 3 });
}

function buildBench(g, kind, seed, screens, blinkers, nextCode, island) {
  // Lab bench with ESD mat.
  box(g, 1.9, 0.05, 0.8, M.lightPlastic, 0, 0.88, 0, { solid: true });
  box(g, 1.86, 0.006, 0.74, M.esd, 0, 0.908, 0.01, { cast: false });
  for (const sx of [-0.88, 0.88])
    for (const sz of [-0.34, 0.34]) box(g, 0.05, 0.88, 0.05, M.darkMetal, sx, 0.44, sz);
  box(g, 1.8, 0.03, 0.7, M.darkMetal, 0, 0.18, 0);
  // Storage drawers.
  box(g, 0.5, 0.5, 0.62, M.lightPlastic, 0.6, 0.6, -0.02);
  for (let i = 0; i < 3; i++) box(g, 0.2, 0.02, 0.01, M.metal, 0.6, 0.45 + i * 0.15, 0.3);
  // Upper shelf.
  if (!island) {
    box(g, 1.9, 0.04, 0.35, M.lightPlastic, 0, 1.45, -0.22);
    for (const sx of [-0.92, 0.92]) box(g, 0.04, 0.6, 0.04, M.darkMetal, sx, 1.17, -0.36);
    // Bench light under the shelf.
    box(g, 1.6, 0.02, 0.06, M.panelLight, 0, 1.42, -0.15, { cast: false });
  }
  // ESD wrist strap reel.
  cyl(g, 0.04, 0.04, 0.03, M.yellow, 0.88, 0.94, 0.3).rotation.z = Math.PI / 2;
  // Multimeter.
  box(g, 0.09, 0.03, 0.17, M.yellow, 0.75, 0.925, 0.15, { rounded: 0.01 });
  // Common: dev board in the middle.
  buildDevBoard(g, 0.0, 0.91, 0.05, seed, blinkers, 1.4);
  // Probe wires.
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.4, 1.0, -0.2),
    new THREE.Vector3(-0.3, 0.93, 0.1),
    new THREE.Vector3(-0.05, 0.93, 0.08),
  ]);
  for (const [col, off] of [
    [0xf5c518, 0],
    [0x22d3ee, 0.03],
  ]) {
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 20, 0.004, 6),
      new THREE.MeshStandardMaterial({ color: col, roughness: 0.6 }),
    );
    tube.position.x = off;
    g.add(tube);
  }

  const yTop = 0.91;
  if (kind === 'scope') {
    // Oscilloscope.
    const scope = new THREE.Group();
    scope.position.set(-0.45, yTop, -0.18);
    scope.rotation.y = 0.15;
    g.add(scope);
    box(scope, 0.42, 0.24, 0.16, M.lightPlastic, 0, 0.12, 0, { rounded: 0.015 });
    const sc = new TX.ScopeScreen(seed);
    screens.push(sc);
    plane(scope, 0.24, 0.17, emissiveMat(sc.texture, 1.4), -0.06, 0.13, 0.081);
    for (let i = 0; i < 6; i++) {
      const k = cyl(scope, 0.012, 0.012, 0.02, M.black, 0.12 + (i % 2) * 0.05, 0.19 - Math.floor(i / 2) * 0.05, 0.085, 12);
      k.rotation.x = Math.PI / 2;
    }
    for (let i = 0; i < 4; i++) {
      const col = [0xfacc15, 0x22d3ee, 0xf472b6, 0x60a5fa][i];
      box(scope, 0.02, 0.012, 0.004, new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.5 }), -0.15 + i * 0.05, 0.025, 0.081, { cast: false });
    }
    // Power supply with 7-seg display.
    const psu = new THREE.Group();
    psu.position.set(0.45, 1.49, -0.2);
    g.add(psu);
    box(psu, 0.28, 0.14, 0.2, M.plastic, 0, 0.07, 0, { rounded: 0.01 });
    const segTex = TX.signTexture([{ text: '3.300V  0.12A', size: 70, color: '#ff4040', font: `700 74px "JetBrains Mono", monospace` }], { bg: '#160404', fg: '#ff4040', w: 512, h: 128, border: false });
    plane(psu, 0.2, 0.05, emissiveMat(segTex, 1.6), 0, 0.095, 0.101);
  } else if (kind === 'serial') {
    // Laptop running a serial terminal.
    const lap = new THREE.Group();
    lap.position.set(-0.45, yTop, 0.0);
    lap.rotation.y = 0.25;
    g.add(lap);
    box(lap, 0.36, 0.018, 0.25, M.metal, 0, 0.009, 0, { rounded: 0.006 });
    const lid = new THREE.Group();
    lid.position.set(0, 0.018, -0.12);
    lid.rotation.x = -0.3;
    lap.add(lid);
    box(lid, 0.36, 0.24, 0.012, M.metal, 0, 0.12, 0, { rounded: 0.006 });
    const term = new TX.TerminalScreen(seed);
    screens.push(term);
    plane(lid, 0.32, 0.2, emissiveMat(term.texture, 1.3), 0, 0.12, 0.007);
    // USB-UART dongle with blinking TX/RX.
    box(g, 0.05, 0.012, 0.025, M.red, -0.15, yTop + 0.006, 0.12);
    for (let i = 0; i < 2; i++) {
      const led = box(g, 0.006, 0.004, 0.006, new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0xffaa00, emissiveIntensity: 3 }), -0.16 + i * 0.015, yTop + 0.014, 0.12, { cast: false });
      blinkers.push({ mesh: led, speed: 13 + i * 5, phase: i, duty: 0.3, max: 5 });
    }
    // Logic analyzer.
    box(g, 0.08, 0.025, 0.08, M.black, 0.35, yTop + 0.012, -0.2, { rounded: 0.008 });
    if (!island) {
      const mon = new THREE.Group();
      mon.position.set(0, 0.7, -0.05);
      g.add(mon);
      buildMonitor(mon, 0, -0.18, 0, nextCode(), 0.5, 0.3);
    }
  } else if (kind === 'jtag') {
    // Programmer pod + target board + monitor.
    box(g, 0.1, 0.03, 0.06, M.lightPlastic, -0.32, yTop + 0.015, 0.05, { rounded: 0.01 });
    const led = box(g, 0.008, 0.004, 0.008, new THREE.MeshStandardMaterial({ color: 0x22ff66, emissive: 0x22ff66, emissiveIntensity: 3 }), -0.32, yTop + 0.032, 0.05, { cast: false });
    blinkers.push({ mesh: led, speed: 7, phase: seed, duty: 0, max: 5 });
    const ribbon = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.26), new THREE.MeshStandardMaterial({ color: 0x9ca3af, side: THREE.DoubleSide }));
    ribbon.rotation.x = -Math.PI / 2;
    ribbon.rotation.z = Math.PI / 2;
    ribbon.position.set(-0.17, yTop + 0.004, 0.05);
    g.add(ribbon);
    // Production test fixture (bed of nails).
    box(g, 0.32, 0.12, 0.24, M.black, 0.42, yTop + 0.06, -0.12, { rounded: 0.01 });
    box(g, 0.3, 0.02, 0.22, M.yellow, 0.42, yTop + 0.13, -0.12);
    buildMonitor(g, -0.55, -0.22, 0.25, nextCode(), 0.5, 0.3).parent.position.y = yTop;
  }
}

/* ------------------------------------------------------------------ */
/* Rooms & props                                                       */
/* ------------------------------------------------------------------ */

function buildServerRacks(scene, blinkers) {
  const ledGeo = new THREE.BoxGeometry(0.012, 0.008, 0.004);
  for (let r = 0; r < 3; r++) {
    const g = new THREE.Group();
    g.position.set(10 + r * 0.7, 0, -D + 0.5);
    scene.add(g);
    box(g, 0.62, 2.1, 0.9, M.black, 0, 1.05, 0, { solid: true, rounded: 0.01 });
    // Glass door.
    box(g, 0.56, 2.0, 0.01, M.glass, 0, 1.05, 0.455, { cast: false });
    for (let u = 0; u < 14; u++) {
      box(g, 0.54, 0.09, 0.02, M.darkMetal, 0, 0.2 + u * 0.13, 0.43, { cast: false });
      for (let k = 0; k < 4; k++) {
        const col = [0x22ff66, 0x38bdf8, 0xffaa00, 0x22ff66][(u + k + r) % 4];
        const m = new THREE.Mesh(ledGeo, new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 3 }));
        m.position.set(-0.22 + k * 0.025, 0.2 + u * 0.13, 0.442);
        g.add(m);
        blinkers.push({ mesh: m, speed: 3 + ((u * 7 + k * 13 + r) % 11), phase: u + k, duty: 0.1, max: 4 });
      }
    }
  }
  // Sign.
  const sign = plane(scene, 1.8, 0.45, new THREE.MeshStandardMaterial({ map: TX.signTexture([{ text: 'CI / BUILD FARM', size: 60, color: '#e2e8f0' }], { bg: '#111827', fg: '#e2e8f0', border: false }), roughness: 0.6 }), 10.7, 2.75, -D + 0.02);
  sign.castShadow = false;
}

function buildCoffee(scene) {
  const g = new THREE.Group();
  g.position.set(COFFEE.x, 0, COFFEE.z);
  g.rotation.y = COFFEE.ry;
  scene.add(g);
  // Counter (local -z is toward the wall after rotation, so flip).
  box(g, 3.2, 0.9, 0.65, M.wood, 0, 0.45, -0.0, { solid: true });
  box(g, 3.3, 0.05, 0.7, M.deskTop, 0, 0.92, 0);
  // Espresso machine.
  const mach = new THREE.Group();
  mach.position.set(-0.3, 0.945, 0.05);
  g.add(mach);
  box(mach, 0.5, 0.48, 0.4, M.metal, 0, 0.24, 0, { rounded: 0.03 });
  box(mach, 0.5, 0.06, 0.4, M.black, 0, 0.5, 0, { rounded: 0.02 });
  box(mach, 0.3, 0.12, 0.01, new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff7a1a, emissiveIntensity: 1.5 }), 0, 0.36, 0.205, { cast: false });
  cyl(mach, 0.03, 0.03, 0.08, M.black, -0.08, 0.15, 0.22);
  cyl(mach, 0.03, 0.03, 0.08, M.black, 0.08, 0.15, 0.22);
  box(mach, 0.3, 0.02, 0.12, M.darkMetal, 0, 0.01, 0.26);
  // Mugs.
  for (let i = 0; i < 4; i++) cyl(g, 0.04, 0.036, 0.1, i % 2 ? M.mug : M.red, 0.4 + i * 0.13, 1.0, 0.1);
  // Water dispenser.
  box(g, 0.35, 1.0, 0.35, M.lightPlastic, 1.25, 1.45, 0.05, { rounded: 0.03 });
  const jug = cyl(g, 0.15, 0.15, 0.4, new THREE.MeshPhysicalMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.45, roughness: 0.05 }), 1.25, 2.15, 0.05);
  jug.castShadow = false;
  // Sign.
  const sign = plane(
    scene,
    1.4,
    0.5,
    new THREE.MeshStandardMaterial({ map: TX.signTexture([{ text: '☕ 咖啡補給站', size: 64, color: '#3b2414' }], { bg: '#fde7c7', fg: '#3b2414' }), roughness: 0.7 }),
    COFFEE.x - 0.3,
    2.3,
    D - 0.02,
    Math.PI,
  );
  sign.castShadow = false;
  // Fridge.
  box(scene, 0.75, 1.9, 0.7, M.lightPlastic, COFFEE.x + 2.45, 0.95, COFFEE.z + 0.05, { solid: true, rounded: 0.03 });
  box(scene, 0.03, 0.5, 0.04, M.metal, COFFEE.x + 2.15, 1.2, COFFEE.z - 0.31);
}

function buildLounge(scene, screens) {
  const cx = -16.5;
  const cz = 9.5;
  // Rug.
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(5, 3.6), new THREE.MeshStandardMaterial({ color: 0x2b3a55, roughness: 1 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(cx, 0.005, cz);
  rug.receiveShadow = true;
  scene.add(rug);
  // Sofa facing south wall TV? Facing north-east toward the room.
  const sofa = new THREE.Group();
  sofa.position.set(cx + 2.0, 0, cz);
  sofa.rotation.y = Math.PI / 2;
  scene.add(sofa);
  box(sofa, 2.6, 0.42, 0.9, M.fabricWarm, 0, 0.21, 0, { solid: true, rounded: 0.06 });
  box(sofa, 2.6, 0.5, 0.22, M.fabricWarm, 0, 0.6, 0.36, { rounded: 0.08 });
  box(sofa, 0.22, 0.32, 0.9, M.fabricWarm, -1.2, 0.55, 0, { rounded: 0.08 });
  box(sofa, 0.22, 0.32, 0.9, M.fabricWarm, 1.2, 0.55, 0, { rounded: 0.08 });
  for (const sx of [-0.62, 0.62]) box(sofa, 1.15, 0.12, 0.7, M.fabricWarm, sx, 0.47, -0.05, { rounded: 0.05 });
  // Coffee table.
  box(scene, 0.6, 0.05, 1.2, M.wood, cx, 0.42, cz, { solid: true, rounded: 0.02 });
  for (const [sx, sz] of [
    [-0.55, -0.25],
    [0.55, -0.25],
    [-0.55, 0.25],
    [0.55, 0.25],
  ])
    cyl(scene, 0.02, 0.02, 0.4, M.darkMetal, cx + sz, 0.2, cz + sx);
  // Board games / snacks.
  box(scene, 0.3, 0.05, 0.3, M.red, cx, 0.47, cz - 0.3);
  cyl(scene, 0.05, 0.05, 0.12, M.yellow, cx + 0.05, 0.5, cz + 0.3);
}

function buildDecor(scene) {
  // Plants.
  const plantSpots = [
    [-19.2, -13.2],
    [-19.2, 12.8],
    [-2, 12.8],
    [3.5, -13.1],
    [8.8, 12.8],
    [-17.2, 6.8],
    [14, -13.1],
  ];
  plantSpots.forEach(([x, z], i) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    scene.add(g);
    const pot = cyl(g, 0.26, 0.2, 0.5, M.pot, 0, 0.25, 0, 20);
    pot.userData.solid = true;
    cyl(g, 0.24, 0.24, 0.02, M.soil, 0, 0.49, 0);
    const r = TX.rng(i + 3);
    for (let k = 0; k < 9; k++) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), k % 2 ? M.leaf2 : M.leaf);
      leaf.scale.set(0.5, 1.6, 0.18);
      const a = (k / 9) * Math.PI * 2 + r();
      leaf.position.set(Math.sin(a) * 0.14, 0.85 + r() * 0.4, Math.cos(a) * 0.14);
      leaf.rotation.set(Math.cos(a) * 0.5, a, Math.sin(a) * 0.5);
      leaf.castShadow = true;
      g.add(leaf);
    }
  });

  // Posters.
  const posters = [
    ['ship', 6.5, 2.2, -D + 0.02, 0],
    ['wdt', -W + 0.02, 2.2, 12.0, Math.PI / 2],
    ['works', 3.5, 2.2, D - 0.02, Math.PI],
  ];
  for (const [k, x, y, z, ry] of posters) {
    const m = plane(scene, 0.9, 1.26, new THREE.MeshStandardMaterial({ map: TX.posterTexture(k), roughness: 0.6 }), x, y, z, ry);
    m.receiveShadow = true;
  }
  // ESD sign on the east wall.
  plane(
    scene,
    1.6,
    0.6,
    new THREE.MeshStandardMaterial({ map: TX.signTexture([{ text: '⚡ ESD 防護區', size: 62 }, { text: 'ESD PROTECTED AREA', size: 34 }]), roughness: 0.6 }),
    W - 0.02,
    3.15,
    -1.2,
    -Math.PI / 2,
  );

  // Whiteboard on the south wall with a block diagram.
  const [c, x] = TX.canvas(1024, 512);
  x.fillStyle = '#fbfbfb';
  x.fillRect(0, 0, 1024, 512);
  x.lineWidth = 5;
  x.strokeStyle = '#1d4ed8';
  x.font = '600 34px "JetBrains Mono", monospace';
  x.fillStyle = '#1d4ed8';
  const blocks = [
    ['MCU', 420, 190],
    ['IMU', 120, 80],
    ['BLE', 760, 80],
    ['PMIC', 120, 330],
    ['FLASH', 760, 330],
  ];
  for (const [t, bx, by] of blocks) {
    x.strokeRect(bx, by, 170, 90);
    x.fillText(t, bx + 30, by + 58);
  }
  x.strokeStyle = '#dc2626';
  x.fillStyle = '#dc2626';
  x.beginPath();
  x.moveTo(290, 125);
  x.lineTo(420, 220);
  x.moveTo(590, 220);
  x.lineTo(760, 125);
  x.moveTo(290, 375);
  x.lineTo(420, 260);
  x.moveTo(590, 260);
  x.lineTo(760, 375);
  x.stroke();
  x.font = '28px "JetBrains Mono", monospace';
  x.fillText('I2C @400k', 250, 180);
  x.fillText('UART 115200', 640, 180);
  x.fillText('SPI 20MHz', 640, 320);
  x.fillStyle = '#16a34a';
  x.fillText('TODO: low-power mode < 5uA !!', 260, 480);
  const wbTex = new THREE.CanvasTexture(c);
  wbTex.colorSpace = THREE.SRGBColorSpace;
  box(scene, 3.1, 1.6, 0.04, M.frame, -6, 1.9, D - 0.03, { cast: false });
  plane(scene, 3.0, 1.5, new THREE.MeshStandardMaterial({ map: wbTex, roughness: 0.25 }), -6, 1.9, D - 0.055, Math.PI);

  // Door + exit sign on the south wall.
  box(scene, 2.2, 2.4, 0.06, M.frame, 0, 1.2, D - 0.03, { cast: false });
  box(scene, 1.0, 2.25, 0.04, M.lightPlastic, -0.52, 1.13, D - 0.065, { cast: false });
  box(scene, 1.0, 2.25, 0.04, M.lightPlastic, 0.52, 1.13, D - 0.065, { cast: false });
  box(scene, 0.03, 0.3, 0.04, M.metal, -0.08, 1.1, D - 0.1);
  box(scene, 0.03, 0.3, 0.04, M.metal, 0.08, 1.1, D - 0.1);
  plane(
    scene,
    0.6,
    0.22,
    emissiveMat(TX.signTexture([{ text: '🏃 EXIT 出口', size: 64, color: '#eafff0' }], { bg: '#0b8a3a', fg: '#eafff0', border: false, w: 512, h: 180 }), 1.5),
    0,
    2.65,
    D - 0.04,
    Math.PI,
  );

  // Cable trays above the benches.
  box(scene, 0.4, 0.06, 18, M.metal, W - 1.2, H - 0.5, -1, { cast: false });
  for (let i = 0; i < 6; i++) box(scene, 0.02, 0.5, 0.02, M.metal, W - 1.2, H - 0.25, -9 + i * 3.4, { cast: false });
  for (let i = 0; i < 3; i++) {
    const c2 = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 18, 8),
      new THREE.MeshStandardMaterial({ color: [0x2563eb, 0xf59e0b, 0x111111][i], roughness: 0.6 }),
    );
    c2.rotation.x = Math.PI / 2;
    c2.position.set(W - 1.32 + i * 0.1, H - 0.45, -1);
    scene.add(c2);
  }

  // Rolling tool cart in the middle.
  const cart = new THREE.Group();
  cart.position.set(10.5, 0, 3);
  scene.add(cart);
  box(cart, 0.8, 0.9, 0.5, M.red, 0, 0.5, 0, { solid: true, rounded: 0.02 });
  for (let i = 0; i < 4; i++) box(cart, 0.7, 0.01, 0.01, M.metal, 0, 0.3 + i * 0.18, 0.255);
  for (const [sx, sz] of [
    [-0.35, -0.2],
    [0.35, -0.2],
    [-0.35, 0.2],
    [0.35, 0.2],
  ])
    cyl(cart, 0.04, 0.04, 0.03, M.rubber, sx, 0.04, sz, 10).rotation.z = Math.PI / 2;
  // Soldering station on the cart.
  box(cart, 0.2, 0.1, 0.16, M.plastic, -0.15, 1.0, 0, { rounded: 0.01 });
  plane(cart, 0.1, 0.04, emissiveMat(TX.signTexture([{ text: '350°C', size: 90, color: '#7dd3fc', font: '800 96px "JetBrains Mono", monospace' }], { bg: '#020617', border: false, w: 256, h: 128 }), 1.6), -0.15, 1.02, 0.081);
  cyl(cart, 0.04, 0.05, 0.08, M.metal, 0.15, 1.0, 0);

  // A few boxes of parts near the benches.
  for (let i = 0; i < 3; i++) box(scene, 0.5, 0.35, 0.4, new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.9 }), 15.4, 0.175 + i * 0.35, -11.5 + (i % 2) * 0.05, { solid: i === 0 });
}

/* ------------------------------------------------------------------ */
/* Dynamic boards                                                      */
/* ------------------------------------------------------------------ */

const SEV_COL = { P0: '#ff3b5c', P1: '#ff8a3d', P2: '#ffd23f', P3: '#5ad1ff' };

function fmtTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

function buildKanban(scene) {
  const [c, x] = TX.canvas(1600, 800);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const cx = -4;
  box(scene, 8.2, 3.2, 0.06, M.frame, cx, 2.2, -D + 0.04, { cast: false });
  plane(scene, 8, 4, emissiveMat(texture, 0.62), cx, 2.2, -D + 0.075).scale.set(1, 0.75, 1);
  // Small spot lights shining on the board feel.
  const draw = ({ tasks = [], sprint, players = new Map(), now = Date.now() }) => {
    x.fillStyle = '#0d1420';
    x.fillRect(0, 0, 1600, 800);
    x.fillStyle = '#e2e8f0';
    x.font = '800 52px "JetBrains Mono", monospace';
    x.fillText(sprint ? `SPRINT ${sprint.n} · ${sprint.version}` : 'SPRINT —', 50, 82);
    if (sprint) {
      const left = (sprint.endsAt - now) / 1000;
      x.textAlign = 'right';
      x.fillStyle = sprint.phase === 'sprint' && left < 60 ? '#ff4d6d' : '#38bdf8';
      x.fillText(sprint.phase === 'sprint' ? fmtTime(left) : 'REVIEW', 1550, 82);
      x.textAlign = 'left';
      const pct = Math.min(1, sprint.progress / sprint.goal);
      x.fillStyle = '#1e293b';
      x.fillRect(50, 110, 1500, 26);
      const g = x.createLinearGradient(50, 0, 1550, 0);
      g.addColorStop(0, '#10b981');
      g.addColorStop(1, '#38bdf8');
      x.fillStyle = g;
      x.fillRect(50, 110, 1500 * pct, 26);
      x.fillStyle = '#94a3b8';
      x.font = '600 24px "JetBrains Mono", monospace';
      x.fillText(`RELEASE ${sprint.progress}/${sprint.goal}   ✔ ${sprint.fixed}   ✖ escaped ${sprint.escaped}`, 50, 170);
    }
    const cols = [
      ['TODO', tasks.filter((t) => !t.assignee)],
      ['IN PROGRESS', tasks.filter((t) => t.assignee)],
    ];
    cols.forEach(([name, list], ci) => {
      const left = 50 + ci * 760;
      x.fillStyle = '#111c2e';
      x.fillRect(left, 200, 740, 570);
      x.fillStyle = '#64748b';
      x.font = '700 28px "JetBrains Mono", monospace';
      x.fillText(`${name}  (${list.length})`, left + 20, 245);
      list.slice(0, 6).forEach((t, i) => {
        const y = 270 + i * 82;
        x.fillStyle = '#dfe6ee';
        x.fillRect(left + 20, y, 700, 70);
        x.fillStyle = SEV_COL[t.severity];
        x.fillRect(left + 20, y, 14, 70);
        x.fillStyle = '#0f172a';
        x.font = '700 26px "Noto Sans TC", sans-serif';
        const title = t.title.length > 22 ? t.title.slice(0, 21) + '…' : t.title;
        x.fillText(`#${t.id} ${title}`, left + 50, y + 32);
        x.fillStyle = '#64748b';
        x.font = '500 20px "JetBrains Mono", monospace';
        const who = t.assignee ? players.get(t.assignee)?.name || '?' : '未指派';
        x.fillText(`${t.severity} · ${t.stationId} · ${t.points}pts · ${who}`, left + 50, y + 58);
      });
    });
    texture.needsUpdate = true;
  };
  draw({});
  return { draw };
}

function buildTV(scene) {
  const [c, x] = TX.canvas(800, 450);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  const tx = -19.7;
  const tz = 9.5;
  box(scene, 0.08, 1.15, 2.0, M.black, tx + 0.04, 1.75, tz, { cast: false, rounded: 0.02 });
  plane(scene, 1.9, 1.07, emissiveMat(texture, 1.1), tx + 0.085, 1.75, tz, Math.PI / 2);
  const draw = ({ sprint, players = new Map() }) => {
    const g = x.createLinearGradient(0, 0, 800, 450);
    g.addColorStop(0, '#0b1324');
    g.addColorStop(1, '#1b1035');
    x.fillStyle = g;
    x.fillRect(0, 0, 800, 450);
    x.fillStyle = '#94a3b8';
    x.font = '600 26px "JetBrains Mono", monospace';
    x.fillText('RELEASE DASHBOARD', 36, 52);
    if (sprint) {
      const pct = Math.min(1, sprint.progress / sprint.goal);
      x.lineWidth = 26;
      x.strokeStyle = '#1e293b';
      x.beginPath();
      x.arc(190, 250, 120, 0, Math.PI * 2);
      x.stroke();
      x.strokeStyle = pct >= 1 ? '#a3e635' : '#34d399';
      x.beginPath();
      x.arc(190, 250, 120, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
      x.stroke();
      x.fillStyle = '#fff';
      x.textAlign = 'center';
      x.font = '800 58px "JetBrains Mono", monospace';
      x.fillText(`${Math.round(pct * 100)}%`, 190, 270);
      x.textAlign = 'left';
      x.font = '700 34px "JetBrains Mono", monospace';
      x.fillStyle = '#e2e8f0';
      x.fillText(sprint.version, 380, 140);
      const top = [...players.values()].sort((a, b) => b.score - a.score).slice(0, 5);
      x.font = '500 26px "Noto Sans TC", sans-serif';
      top.forEach((p, i) => {
        x.fillStyle = p.color;
        x.fillRect(380, 182 + i * 46, 14, 14);
        x.fillStyle = '#cbd5e1';
        x.fillText(`${p.name}`, 406, 196 + i * 46);
        x.textAlign = 'right';
        x.fillText(`${p.score}`, 760, 196 + i * 46);
        x.textAlign = 'left';
      });
    }
    texture.needsUpdate = true;
  };
  draw({});
  return { draw };
}

function buildAlarms(scene) {
  const beacons = [];
  for (const [x, z, ry] of [
    [-4, -D + 0.12, 0],
    [W - 0.12, -1.2, -Math.PI / 2],
    [-W + 0.12, -12.5, Math.PI / 2],
  ]) {
    const g = new THREE.Group();
    g.position.set(x, 3.75, z);
    g.rotation.y = ry;
    scene.add(g);
    cyl(g, 0.1, 0.12, 0.06, M.darkMetal, 0, -0.1, 0.1);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x661111, emissive: 0xff2030, emissiveIntensity: 0, transparent: true, opacity: 0.9 }),
    );
    dome.position.set(0, -0.07, 0.1);
    g.add(dome);
    const light = new THREE.SpotLight(0xff2030, 0, 14, 0.5, 0.6, 1.2);
    light.position.set(0, -0.05, 0.1);
    g.add(light);
    g.add(light.target);
    beacons.push({ dome, light, g });
  }
  return {
    update(dt, t, on) {
      for (const b of beacons) {
        b.dome.material.emissiveIntensity = on ? 3 + Math.sin(t * 10) * 2 : 0;
        b.light.intensity = on ? 60 : 0;
        b.light.target.position.set(Math.sin(t * 5) * 3, -2, 0.1 + Math.cos(t * 5) * 3);
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* Interior architecture details                                        */
/* ------------------------------------------------------------------ */

function hangingSign(scene, text, sub, x, z, ry, color = '#0f766e') {
  const g = new THREE.Group();
  g.position.set(x, H - 0.85, z);
  g.rotation.y = ry;
  scene.add(g);
  const t = TX.signTexture(
    [
      { text, size: 64, color: '#ffffff', font: '800 66px "JetBrains Mono", "Noto Sans TC", monospace' },
      { text: sub, size: 40, color: 'rgba(255,255,255,0.8)', font: '700 42px "Noto Sans TC", sans-serif' },
    ],
    { bg: color, border: false, w: 1024, h: 256 },
  );
  const mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.25 });
  box(g, 2.44, 0.64, 0.05, M.frame, 0, 0, 0, { cast: false });
  plane(g, 2.4, 0.6, mat, 0, 0, 0.03);
  plane(g, 2.4, 0.6, mat, 0, 0, -0.03, Math.PI);
  for (const sx of [-1, 1]) box(g, 0.01, 0.55, 0.01, M.metal, sx, 0.58, 0, { cast: false });
}

function buildInterior(scene) {
  // Dark wainscot band along the walls.
  box(scene, W * 2, 1.0, 0.02, M.wainscot, 0, 0.5, -D + 0.012, { cast: false });
  box(scene, W * 2, 1.0, 0.02, M.wainscot, 0, 0.5, D - 0.012, { cast: false });
  box(scene, 0.02, 1.0, D * 2, M.wainscot, W - 0.012, 0.5, 0, { cast: false });
  box(scene, 0.02, 0.88, D * 2, M.wainscot, -W + 0.012, 0.44, 0, { cast: false });
  // Teal accent stripe (company colour).
  box(scene, W * 2, 0.05, 0.02, M.teal, 0, 1.02, -D + 0.02, { cast: false });
  box(scene, W * 2, 0.05, 0.02, M.teal, 0, 1.02, D - 0.02, { cast: false });
  box(scene, 0.02, 0.05, D * 2, M.teal, W - 0.02, 1.02, 0, { cast: false });

  // Structural columns.
  for (const [x, z] of [
    [1.5, -1],
    [1.5, 6.5],
    [12, -1],
    [12, 6.5],
  ]) {
    box(scene, 0.7, H, 0.7, M.wall, x, H / 2, z, { solid: true });
    box(scene, 0.72, 1.0, 0.72, M.wainscot, x, 0.5, z, { cast: false });
    box(scene, 0.73, 0.05, 0.73, M.teal, x, 1.02, z, { cast: false });
    // Fire extinguisher on one face.
    if (x === 12 && z === 6.5) {
      cyl(scene, 0.08, 0.08, 0.45, M.red, x - 0.45, 0.4, z);
      cyl(scene, 0.02, 0.03, 0.08, M.black, x - 0.45, 0.67, z);
    }
  }

  // Carpet under the engineering desks.
  const carpet = new THREE.Mesh(new THREE.PlaneGeometry(14, 9.6), M.carpet);
  carpet.rotation.x = -Math.PI / 2;
  carpet.position.set(-10, 0.004, -2);
  carpet.receiveShadow = true;
  scene.add(carpet);

  // Yellow/black ESD floor tape around the hardware zones.
  const tapeTex = TX.stripeTexture();
  const tape = (x, z, w, d) => {
    const t = tapeTex.clone();
    t.needsUpdate = true;
    t.repeat.set(Math.max(w, d) / 0.6, 1);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }));
    m.rotation.x = -Math.PI / 2;
    if (d > w) m.rotation.z = Math.PI / 2;
    m.scale.set(Math.max(w, d), Math.min(w, d), 1);
    m.position.set(x, 0.006, z);
    m.receiveShadow = true;
    scene.add(m);
  };
  tape(16.4, -1.25, 0.1, 17.5);
  tape(18.2, -10, 3.6, 0.1);
  tape(18.2, 7.5, 3.6, 0.1);
  tape(6, -6.8, 3.6, 0.1);
  tape(6, -1.6, 3.6, 0.1);
  tape(4.2, -4.2, 0.1, 5.3);
  tape(7.8, -4.2, 0.1, 5.3);

  // Hanging zone signs.
  hangingSign(scene, 'FIRMWARE', '韌體開發部', -10, -2, 0);
  hangingSign(scene, 'HW LAB', '硬體實驗室', 16.6, -1.2, -Math.PI / 2, '#1d4ed8');
  hangingSign(scene, 'BREAK', '休息區', -15.5, 9.5, Math.PI / 2, '#b45309');

  // Coffee corner: tiled backsplash and upper cabinets.
  const tiles = new THREE.MeshStandardMaterial({ map: TX.tileTexture(), roughness: 0.3 });
  plane(scene, 3.3, 0.9, tiles, COFFEE.x, 1.4, D - 0.015, Math.PI);
  box(scene, 3.3, 0.7, 0.38, M.wood, COFFEE.x, 2.35, D - 0.2, { rounded: 0.01 });
  for (let i = 0; i < 4; i++) box(scene, 0.01, 0.6, 0.01, M.darkMetal, COFFEE.x - 1.24 + i * 0.83, 2.35, D - 0.39, { cast: false });
  box(scene, 3.0, 0.02, 0.06, M.panelLight, COFFEE.x, 1.98, D - 0.3, { cast: false });
  // Counter cabinet doors.
  for (let i = 0; i < 4; i++) box(scene, 0.78, 0.7, 0.01, M.lightPlastic, COFFEE.x - 1.2 + i * 0.8, 0.43, D - 0.79, { cast: false });
}
