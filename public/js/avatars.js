// Remote player avatars: stylised engineers with name tags, walk cycle,
// head pitch and status / emote bubbles.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { nameTagTexture, canvas } from './textures.js';

const SKINS = [0xf1c7a5, 0xe0ac86, 0xc68b62, 0x8d5a3b, 0xf6d5bd];
const HAIR = [0x1b1410, 0x3b2a1e, 0x6b4a2b, 0x111111, 0x8a8a8a, 0x2a1b3d];

const geo = {
  torso: new RoundedBoxGeometry(0.46, 0.6, 0.26, 3, 0.08),
  limb: new RoundedBoxGeometry(0.15, 0.8, 0.16, 2, 0.05),
  arm: new RoundedBoxGeometry(0.11, 0.56, 0.12, 2, 0.045),
  head: new THREE.SphereGeometry(0.17, 24, 18),
  hair: new THREE.SphereGeometry(0.178, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
  lens: new THREE.TorusGeometry(0.042, 0.008, 6, 20),
  shoe: new RoundedBoxGeometry(0.16, 0.08, 0.26, 2, 0.03),
  badge: new THREE.BoxGeometry(0.08, 0.11, 0.01),
  eye: new THREE.SphereGeometry(0.016, 8, 6),
};

function bubbleTexture(text, bg = 'rgba(255,255,255,0.95)', fg = '#111') {
  const [c, x] = canvas(256, 128);
  x.font = '700 64px "Noto Sans TC", "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
  const w = Math.min(240, x.measureText(text).width + 50);
  x.fillStyle = bg;
  x.beginPath();
  x.roundRect((256 - w) / 2, 10, w, 86, 30);
  x.fill();
  x.beginPath();
  x.moveTo(118, 94);
  x.lineTo(128, 118);
  x.lineTo(138, 94);
  x.fill();
  x.fillStyle = fg;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(text, 128, 56);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Avatar {
  constructor(scene, info) {
    this.id = info.id;
    this.scene = scene;
    this.root = new THREE.Group();
    this.target = new THREE.Vector3();
    this.targetYaw = 0;
    this.targetPitch = 0;
    this.yaw = 0;
    this.walk = 0;
    this.moving = false;
    this.bubbleTimer = 0;
    this.build(info);
    scene.add(this.root);
  }

  build(info) {
    let seed = 7;
    for (const ch of String(info.id)) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0;
    seed %= 100003;
    const shirt = new THREE.MeshStandardMaterial({ color: info.color, roughness: 0.8 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x2d3748, roughness: 0.9 });
    const skin = new THREE.MeshStandardMaterial({ color: SKINS[seed % SKINS.length], roughness: 0.7 });
    const hair = new THREE.MeshStandardMaterial({ color: HAIR[(seed >> 3) % HAIR.length], roughness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x15181d, roughness: 0.6 });
    const shoe = new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.7 });
    this.shirtMat = shirt;

    const body = new THREE.Group();
    this.body = body;
    this.root.add(body);

    const mk = (g, m, x, y, z, parent = body) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // Legs pivot at the hip.
    this.legs = [-0.11, 0.11].map((x) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.86, 0);
      body.add(pivot);
      mk(geo.limb, pants, 0, -0.42, 0, pivot);
      mk(geo.shoe, shoe, 0, -0.81, -0.04, pivot);
      return pivot;
    });
    mk(geo.torso, shirt, 0, 1.17, 0);
    // Lab coat collar / ID lanyard.
    const lanyard = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.008, 6, 20, Math.PI), new THREE.MeshStandardMaterial({ color: 0x2563eb }));
    lanyard.position.set(0, 1.34, -0.13);
    lanyard.rotation.set(0, 0, Math.PI);
    body.add(lanyard);
    const badge = mk(geo.badge, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x222222 }), 0, 1.2, -0.137);
    badge.castShadow = false;

    this.arms = [-0.3, 0.3].map((x) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 1.42, 0);
      body.add(pivot);
      mk(geo.arm, shirt, 0, -0.25, 0, pivot);
      mk(new THREE.SphereGeometry(0.06, 10, 8), skin, 0, -0.55, 0, pivot);
      return pivot;
    });

    // Head pivots for pitch.
    const head = new THREE.Group();
    head.position.set(0, 1.58, 0);
    body.add(head);
    this.head = head;
    mk(geo.head, skin, 0, 0.1, 0, head);
    const h = mk(geo.hair, hair, 0, 0.12, 0.012, head);
    h.rotation.x = -0.25;
    // Glasses — every firmware engineer needs them.
    for (const x of [-0.06, 0.06]) {
      const l = mk(geo.lens, dark, x, 0.11, -0.16, head);
      l.castShadow = false;
      mk(geo.eye, dark, x, 0.11, -0.155, head).castShadow = false;
    }
    const bridge = mk(new THREE.BoxGeometry(0.04, 0.008, 0.008), dark, 0, 0.115, -0.165, head);
    bridge.castShadow = false;
    const smile = mk(new THREE.TorusGeometry(0.035, 0.007, 6, 16, Math.PI), new THREE.MeshStandardMaterial({ color: 0x7a3b2e }), 0, 0.045, -0.158, head);
    smile.rotation.z = Math.PI;
    smile.castShadow = false;
    // Headphones on some engineers.
    if (seed % 3 === 0) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.016, 6, 24, Math.PI), dark);
      band.position.set(0, 0.12, 0);
      head.add(band);
      for (const x of [-0.18, 0.18]) mk(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 14), dark, x, 0.08, 0, head).rotation.z = Math.PI / 2;
    }

    // Name tag.
    this.tagTex = nameTagTexture(info.name, info.color);
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tagTex, depthTest: true, transparent: true }));
    this.tag.scale.set(1.2, 0.3, 1);
    this.tag.position.y = 2.15;
    this.tag.renderOrder = 10;
    this.root.add(this.tag);

    this.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: true }));
    this.bubble.scale.set(0.7, 0.35, 1);
    this.bubble.position.y = 2.5;
    this.bubble.visible = false;
    this.root.add(this.bubble);

    this.name = info.name;
    this.color = info.color;
  }

  setInfo(info) {
    if (info.name !== this.name || info.color !== this.color) {
      this.tagTex.dispose();
      this.tagTex = nameTagTexture(info.name, info.color);
      this.tag.material.map = this.tagTex;
      this.tag.material.needsUpdate = true;
      this.shirtMat.color.set(info.color);
      this.name = info.name;
      this.color = info.color;
    }
    const working = !!info.taskId;
    if (working !== this.working) {
      this.working = working;
      if (this.bubbleTimer <= 0) this.showStatus();
    }
  }

  showStatus() {
    if (this.working) this.setBubble('🔧', 'rgba(56,189,248,0.95)', '#012');
    else this.bubble.visible = false;
  }

  setBubble(text, bg, fg) {
    this.bubble.material.map?.dispose();
    this.bubble.material.map = bubbleTexture(text, bg, fg);
    this.bubble.material.needsUpdate = true;
    this.bubble.visible = true;
  }

  emote(e) {
    this.setBubble(e);
    this.bubbleTimer = 3;
  }

  say(text) {
    const short = text.length > 6 ? text.slice(0, 6) + '…' : text;
    this.setBubble(short);
    this.bubbleTimer = 4;
  }

  setTarget(x, y, z, yaw, pitch, moving, snap = false) {
    this.target.set(x, y, z);
    this.targetYaw = yaw;
    this.targetPitch = pitch;
    this.moving = moving;
    if (snap) {
      this.root.position.copy(this.target);
      this.yaw = yaw;
    }
  }

  update(dt) {
    const k = 1 - Math.exp(-dt * 12);
    this.root.position.lerp(this.target, k);
    let dy = this.targetYaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * k;
    this.root.rotation.y = this.yaw;
    this.head.rotation.x = THREE.MathUtils.lerp(this.head.rotation.x, this.targetPitch * 0.8, k);

    const speed = this.moving ? 1 : 0;
    this.walk += dt * 9 * speed;
    const swing = Math.sin(this.walk) * 0.6 * speed;
    const typing = this.working && !this.moving;
    this.legs[0].rotation.x = swing;
    this.legs[1].rotation.x = -swing;
    if (typing) {
      const t = performance.now() / 1000;
      this.arms[0].rotation.x = 1.1 + Math.sin(t * 18) * 0.06;
      this.arms[1].rotation.x = 1.1 + Math.cos(t * 16) * 0.06;
    } else {
      this.arms[0].rotation.x = THREE.MathUtils.lerp(this.arms[0].rotation.x, -swing * 0.8, k);
      this.arms[1].rotation.x = THREE.MathUtils.lerp(this.arms[1].rotation.x, swing * 0.8, k);
    }
    this.body.position.y = Math.abs(Math.sin(this.walk)) * 0.04 * speed;

    if (this.bubbleTimer > 0) {
      this.bubbleTimer -= dt;
      if (this.bubbleTimer <= 0) this.showStatus();
    }
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o.material?.map) o.material.map.dispose();
    });
  }
}
