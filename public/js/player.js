// First-person controller: pointer-lock mouse look, WASD movement with
// acceleration, sprinting, jumping, head bob and AABB collision.
import * as THREE from 'three';
import { ROOM } from '/shared/layout.js';

const EYE = 1.65;
const RADIUS = 0.32;

export class Player {
  constructor(camera, dom, colliders) {
    this.camera = camera;
    this.dom = dom;
    this.colliders = colliders;
    this.pos = new THREE.Vector3(0, 0, 10);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.vy = 0;
    this.onGround = true;
    this.keys = new Set();
    this.enabled = false;
    this.locked = false;
    this.sensitivity = 1;
    this.bob = 0;
    this.moving = false;
    this.energy = 100;
    this.speedMul = 1;

    camera.rotation.order = 'YXZ';

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === dom;
      this.onLockChange?.(this.locked);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      const s = 0.0022 * this.sensitivity;
      this.yaw -= e.movementX * s;
      this.pitch -= e.movementY * s;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    });
    window.addEventListener('keydown', (e) => {
      if (!this.enabled || e.target.tagName === 'INPUT') return;
      this.keys.add(e.code);
      if (e.code === 'Space' && this.onGround && this.locked) {
        this.vy = 4.2;
        this.onGround = false;
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    // Touch support: left half drags to move, right half drags to look.
    this.touch = { move: null, look: null, mx: 0, my: 0 };
    dom.addEventListener('touchstart', (e) => this.onTouch(e, 'start'), { passive: false });
    dom.addEventListener('touchmove', (e) => this.onTouch(e, 'move'), { passive: false });
    dom.addEventListener('touchend', (e) => this.onTouch(e, 'end'), { passive: false });
  }

  onTouch(e, phase) {
    if (!this.enabled) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      const left = t.clientX < window.innerWidth / 2;
      if (phase === 'start') {
        if (left && !this.touch.move) this.touch.move = { id: t.identifier, x: t.clientX, y: t.clientY };
        else if (!left && !this.touch.look) this.touch.look = { id: t.identifier, x: t.clientX, y: t.clientY };
      } else if (phase === 'move') {
        if (this.touch.move?.id === t.identifier) {
          this.touch.mx = Math.max(-1, Math.min(1, (t.clientX - this.touch.move.x) / 60));
          this.touch.my = Math.max(-1, Math.min(1, (t.clientY - this.touch.move.y) / 60));
        } else if (this.touch.look?.id === t.identifier) {
          this.yaw -= (t.clientX - this.touch.look.x) * 0.005;
          this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - (t.clientY - this.touch.look.y) * 0.005));
          this.touch.look.x = t.clientX;
          this.touch.look.y = t.clientY;
        }
      } else {
        if (this.touch.move?.id === t.identifier) {
          this.touch.move = null;
          this.touch.mx = this.touch.my = 0;
        } else if (this.touch.look?.id === t.identifier) {
          this.touch.look = null;
        }
      }
    }
  }

  lock() {
    if (!this.locked) this.dom.requestPointerLock?.()?.catch?.(() => {});
  }
  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  setPosition(x, z, yaw = this.yaw) {
    this.pos.set(x, 0, z);
    this.yaw = yaw;
  }

  collide() {
    const p = this.pos;
    const lim = { x: ROOM.w - RADIUS, z: ROOM.d - RADIUS };
    for (const c of this.colliders) {
      if (c.top < p.y + 0.25) continue; // can stand on low things after a jump
      const cx = Math.max(c.minX, Math.min(p.x, c.maxX));
      const cz = Math.max(c.minZ, Math.min(p.z, c.maxZ));
      const dx = p.x - cx;
      const dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < RADIUS * RADIUS) {
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          p.x = cx + (dx / d) * RADIUS;
          p.z = cz + (dz / d) * RADIUS;
        } else {
          // Inside the box: push out along the shallowest axis.
          const pushes = [
            [c.minX - RADIUS - p.x, 0],
            [c.maxX + RADIUS - p.x, 0],
            [0, c.minZ - RADIUS - p.z],
            [0, c.maxZ + RADIUS - p.z],
          ].sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]));
          p.x += pushes[0][0];
          p.z += pushes[0][1];
        }
      }
    }
    p.x = Math.max(-lim.x, Math.min(lim.x, p.x));
    p.z = Math.max(-lim.z, Math.min(lim.z, p.z));
  }

  update(dt) {
    const k = this.keys;
    let f = 0;
    let s = 0;
    if (this.enabled) {
      if (k.has('KeyW') || k.has('ArrowUp')) f += 1;
      if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) s += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) s -= 1;
      f -= this.touch.my;
      s += this.touch.mx;
    }
    const sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    const tired = this.energy < 15 ? 0.65 : 1;
    const maxSpeed = (sprint ? 6.2 : 3.6) * tired * this.speedMul;
    const len = Math.hypot(f, s);
    const want = new THREE.Vector3();
    if (len > 0) {
      f /= Math.max(1, len);
      s /= Math.max(1, len);
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      want.set(-sin * f + cos * s, 0, -cos * f - sin * s).multiplyScalar(maxSpeed);
    }
    const accel = this.onGround ? 14 : 3;
    this.vel.x += (want.x - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (want.z - this.vel.z) * Math.min(1, accel * dt);

    // Sub-step to avoid tunnelling through thin colliders when sprinting.
    const steps = 3;
    for (let i = 0; i < steps; i++) {
      this.pos.x += (this.vel.x * dt) / steps;
      this.pos.z += (this.vel.z * dt) / steps;
      this.collide();
    }

    this.vy -= 12 * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= 0) {
      this.pos.y = 0;
      this.vy = 0;
      this.onGround = true;
    }

    const speed = Math.hypot(this.vel.x, this.vel.z);
    this.moving = speed > 0.4;
    if (this.onGround && speed > 0.2) this.bob += dt * speed * 2.4;
    const bobY = Math.sin(this.bob * 2) * 0.035 * Math.min(1, speed / 3.6);
    const bobX = Math.cos(this.bob) * 0.025 * Math.min(1, speed / 3.6);

    this.camera.position.set(this.pos.x, this.pos.y + EYE + bobY, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, -bobX * 0.4);
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    this.camera.position.x += cos * bobX;
    this.camera.position.z -= sin * bobX;
    return speed;
  }
}
