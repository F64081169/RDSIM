// Procedural canvas textures — everything is generated at runtime so the
// game ships without image assets.
import * as THREE from 'three';

const MONO = '"JetBrains Mono", Menlo, Consolas, monospace';
const SANS = '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, { repeat, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

// Deterministic PRNG so textures look the same for every player.
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noise(ctx, w, h, amount, seed, alpha = 0.05) {
  const r = rng(seed);
  for (let i = 0; i < amount; i++) {
    const v = r() > 0.5 ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${r() * alpha})`;
    ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
}

export function floorTexture() {
  const [c, x] = canvas(1024, 1024);
  x.fillStyle = '#5b636b';
  x.fillRect(0, 0, 1024, 1024);
  const r = rng(7);
  // Large vinyl lab tiles with slight tone variation.
  const n = 4;
  const s = 1024 / n;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const v = 88 + Math.floor(r() * 14);
      x.fillStyle = `rgb(${v},${v + 6},${v + 12})`;
      x.fillRect(i * s, j * s, s, s);
    }
  // Speckles like terrazzo / ESD vinyl.
  for (let i = 0; i < 26000; i++) {
    const v = r();
    x.fillStyle = v > 0.6 ? `rgba(220,226,232,${0.15 + r() * 0.2})` : `rgba(30,34,40,${0.12 + r() * 0.2})`;
    x.fillRect(r() * 1024, r() * 1024, 1 + r() * 2.2, 1 + r() * 2.2);
  }
  x.strokeStyle = 'rgba(20,24,28,0.55)';
  x.lineWidth = 3;
  for (let i = 0; i <= n; i++) {
    x.beginPath();
    x.moveTo(i * s, 0);
    x.lineTo(i * s, 1024);
    x.moveTo(0, i * s);
    x.lineTo(1024, i * s);
    x.stroke();
  }
  return tex(c, { repeat: [10, 7] });
}

export function floorRoughness() {
  const [c, x] = canvas(512, 512);
  x.fillStyle = '#8a8a8a';
  x.fillRect(0, 0, 512, 512);
  const r = rng(99);
  for (let i = 0; i < 60; i++) {
    const g = x.createRadialGradient(r() * 512, r() * 512, 0, r() * 512, r() * 512, 40 + r() * 120);
    const v = r() > 0.5 ? 60 : 170;
    g.addColorStop(0, `rgba(${v},${v},${v},0.35)`);
    g.addColorStop(1, 'rgba(128,128,128,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 512, 512);
  }
  return tex(c, { repeat: [5, 4], srgb: false });
}

export function wallTexture() {
  const [c, x] = canvas(512, 512);
  x.fillStyle = '#d9dde2';
  x.fillRect(0, 0, 512, 512);
  noise(x, 512, 512, 30000, 3, 0.04);
  return tex(c, { repeat: [6, 2] });
}

export function ceilingTexture() {
  const [c, x] = canvas(512, 512);
  x.fillStyle = '#e8eaec';
  x.fillRect(0, 0, 512, 512);
  noise(x, 512, 512, 20000, 5, 0.06);
  x.strokeStyle = '#b8bcc2';
  x.lineWidth = 6;
  x.strokeRect(0, 0, 512, 512);
  return tex(c, { repeat: [20, 14] });
}

export function pcbTexture(seed = 1, color = '#0d5c3a') {
  const [c, x] = canvas(512, 512);
  const r = rng(seed);
  x.fillStyle = color;
  x.fillRect(0, 0, 512, 512);
  // Copper traces.
  x.strokeStyle = 'rgba(190, 220, 120, 0.35)';
  x.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    x.lineWidth = 2 + r() * 3;
    let px = r() * 512;
    let py = r() * 512;
    x.beginPath();
    x.moveTo(px, py);
    for (let k = 0; k < 4; k++) {
      if (r() > 0.5) px += (r() - 0.5) * 200;
      else py += (r() - 0.5) * 200;
      x.lineTo(px, py);
    }
    x.stroke();
  }
  // Pads & vias.
  for (let i = 0; i < 160; i++) {
    x.fillStyle = r() > 0.4 ? '#d8c27a' : '#b8b8b8';
    const s = 3 + r() * 6;
    x.fillRect(r() * 512, r() * 512, s, s);
  }
  // Silkscreen.
  x.fillStyle = 'rgba(255,255,255,0.75)';
  x.font = `bold 20px ${MONO}`;
  x.fillText('RDSIM-EVB rev C', 20, 490);
  x.font = `14px ${MONO}`;
  for (let i = 0; i < 12; i++) x.fillText(['U', 'R', 'C', 'J', 'D'][i % 5] + Math.floor(r() * 40), r() * 480, r() * 470);
  return tex(c);
}

export function signTexture(lines, { bg = '#ffd23f', fg = '#111', w = 512, h = 256, border = true, font = SANS } = {}) {
  const [c, x] = canvas(w, h);
  x.fillStyle = bg;
  x.fillRect(0, 0, w, h);
  if (border) {
    x.strokeStyle = fg;
    x.lineWidth = 10;
    x.strokeRect(14, 14, w - 28, h - 28);
  }
  x.fillStyle = fg;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  const lh = h / (lines.length + 1);
  lines.forEach((l, i) => {
    x.font = l.font || `900 ${l.size || 48}px ${font}`;
    x.fillStyle = l.color || fg;
    x.fillText(l.text, w / 2, lh * (i + 1));
  });
  return tex(c);
}

export function posterTexture(kind) {
  const [c, x] = canvas(512, 720);
  if (kind === 'ship') {
    const g = x.createLinearGradient(0, 0, 0, 720);
    g.addColorStop(0, '#0f172a');
    g.addColorStop(1, '#1e3a8a');
    x.fillStyle = g;
    x.fillRect(0, 0, 512, 720);
    x.fillStyle = '#fbbf24';
    x.beginPath();
    x.moveTo(256, 120);
    x.lineTo(316, 330);
    x.lineTo(196, 330);
    x.closePath();
    x.fill();
    x.fillStyle = '#f43f5e';
    x.fillRect(206, 330, 100, 40);
    x.fillStyle = '#fde68a';
    for (let i = 0; i < 40; i++) x.fillRect(Math.random() * 512, Math.random() * 720, 2, 2);
    x.textAlign = 'center';
    x.fillStyle = '#fff';
    x.font = `900 96px ${SANS}`;
    x.fillText('SHIP IT', 256, 500);
    x.font = `500 30px ${SANS}`;
    x.fillStyle = '#93c5fd';
    x.fillText('準時出貨，就是最好的 feature', 256, 570);
  } else if (kind === 'wdt') {
    x.fillStyle = '#111827';
    x.fillRect(0, 0, 512, 720);
    x.fillStyle = '#34d399';
    x.font = `900 64px ${MONO}`;
    x.textAlign = 'center';
    x.fillText('IWDG->KR', 256, 220);
    x.fillText('= 0xAAAA;', 256, 300);
    x.fillStyle = '#fff';
    x.font = `700 44px ${SANS}`;
    x.fillText('今天你餵狗了嗎？', 256, 450);
    x.fillStyle = '#9ca3af';
    x.font = `28px ${SANS}`;
    x.fillText('Did you kick the watchdog?', 256, 520);
  } else {
    x.fillStyle = '#fef3c7';
    x.fillRect(0, 0, 512, 720);
    x.fillStyle = '#7c2d12';
    x.textAlign = 'center';
    x.font = `900 58px ${SANS}`;
    x.fillText('它在我電腦上', 256, 230);
    x.fillText('可以跑啊', 256, 310);
    x.font = `500 30px ${SANS}`;
    x.fillText('— 每個工程師', 256, 420);
    x.strokeStyle = '#7c2d12';
    x.lineWidth = 8;
    x.strokeRect(30, 30, 452, 660);
  }
  return tex(c);
}

export function skylineTexture() {
  const [c, x] = canvas(2048, 512);
  const g = x.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#1d2b53');
  g.addColorStop(0.42, '#7e3f8f');
  g.addColorStop(0.7, '#f28b54');
  g.addColorStop(1, '#ffd29a');
  x.fillStyle = g;
  x.fillRect(0, 0, 2048, 512);
  // Sun.
  const sg = x.createRadialGradient(1400, 380, 0, 1400, 380, 260);
  sg.addColorStop(0, 'rgba(255,240,200,1)');
  sg.addColorStop(0.15, 'rgba(255,200,120,0.9)');
  sg.addColorStop(1, 'rgba(255,140,80,0)');
  x.fillStyle = sg;
  x.fillRect(0, 0, 2048, 512);
  const r = rng(42);
  // Far buildings.
  for (const [layer, col, minH, maxH] of [
    [0, 'rgba(70,50,90,0.75)', 80, 220],
    [1, '#241a33', 120, 330],
  ]) {
    let px = 0;
    while (px < 2048) {
      const bw = 40 + r() * 110;
      const bh = minH + r() * (maxH - minH);
      x.fillStyle = col;
      x.fillRect(px, 512 - bh, bw, bh);
      if (layer === 1) {
        for (let wy = 512 - bh + 12; wy < 500; wy += 14)
          for (let wx = px + 6; wx < px + bw - 6; wx += 11) {
            if (r() > 0.62) {
              x.fillStyle = r() > 0.3 ? 'rgba(255,214,140,0.9)' : 'rgba(180,220,255,0.8)';
              x.fillRect(wx, wy, 5, 7);
            }
          }
        if (r() > 0.7) {
          x.fillStyle = '#ff4060';
          x.fillRect(px + bw / 2 - 2, 512 - bh - 14, 4, 14);
        }
      }
      px += bw + r() * 12;
    }
  }
  return tex(c);
}

export function nameTagTexture(name, color) {
  const [c, x] = canvas(512, 128);
  x.font = `700 54px ${SANS}`;
  const w = Math.min(500, x.measureText(name).width + 70);
  const left = (512 - w) / 2;
  x.fillStyle = 'rgba(10,14,20,0.72)';
  roundRect(x, left, 18, w, 92, 46);
  x.fill();
  x.fillStyle = color;
  x.beginPath();
  x.arc(left + 40, 64, 13, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = '#fff';
  x.textBaseline = 'middle';
  x.fillText(name, left + 62, 66);
  return tex(c);
}

export function roundRect(x, l, t, w, h, r) {
  x.beginPath();
  x.moveTo(l + r, t);
  x.arcTo(l + w, t, l + w, t + h, r);
  x.arcTo(l + w, t + h, l, t + h, r);
  x.arcTo(l, t + h, l, t, r);
  x.arcTo(l, t, l + w, t, r);
  x.closePath();
}

/* ------------------------------------------------------------------ */
/* Animated screens                                                    */
/* ------------------------------------------------------------------ */

const CODE_SRC = `/* sensor_task.c — RDSIM firmware */
#include "board.h"
#include "imu.h"

static volatile uint32_t g_tick;
static uint8_t rx_buf[RX_SIZE];

void SysTick_Handler(void) {
    g_tick++;
}

int imu_init(void) {
    uint8_t id = 0;
    i2c_read(IMU_ADDR, REG_WHO_AM_I, &id, 1);
    if (id != IMU_ID) {
        LOG_ERR("imu: bad id 0x%02X", id);
        return -ENODEV;
    }
    i2c_write_reg(IMU_ADDR, REG_CTRL1, 0x60);
    return 0;
}

void sensor_task(void *arg) {
    imu_sample_t s;
    for (;;) {
        IWDG->KR = 0xAAAA;
        if (imu_read(&s) == 0) {
            filter_update(&s);
        }
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}

void TIM2_IRQHandler(void) {
    TIM2->SR &= ~TIM_SR_UIF;
    HAL_GPIO_TogglePin(LED_GPIO_Port, LED_Pin);
}

/* clock tree: HSE 8MHz -> PLL 168MHz */
static void clock_init(void) {
    RCC->CR |= RCC_CR_HSEON;
    while (!(RCC->CR & RCC_CR_HSERDY)) { }
    RCC->PLLCFGR = PLL_M(8) | PLL_N(336) | PLL_P(2);
    RCC->CR |= RCC_CR_PLLON;
}

int boot_check(const img_hdr_t *hdr) {
    if (crc32(hdr->data, hdr->len) != hdr->crc) {
        return BOOT_ERR_CRC;  // FIXME: retry?
    }
    return BOOT_OK;
}`.split('\n');

const KW_RE = /\b(void|int|static|volatile|const|return|if|for|while|uint8_t|uint32_t|imu_sample_t|img_hdr_t)\b/;

export class CodeScreen {
  constructor(seed = 1) {
    [this.c, this.x] = canvas(512, 320);
    this.r = rng(seed);
    this.top = Math.floor(this.r() * CODE_SRC.length);
    this.texture = tex(this.c);
    this.acc = 0;
    this.typed = 0;
    this.draw();
  }
  update(dt) {
    this.acc += dt;
    if (this.acc > 0.12) {
      this.acc = 0;
      this.typed += 3;
      const cur = CODE_SRC[(this.top + 15) % CODE_SRC.length];
      if (this.typed > cur.length + 8) {
        this.typed = 0;
        this.top = (this.top + 1) % CODE_SRC.length;
      }
      this.draw();
    }
  }
  draw() {
    const x = this.x;
    x.fillStyle = '#0b1220';
    x.fillRect(0, 0, 512, 320);
    x.fillStyle = '#111a2c';
    x.fillRect(0, 0, 512, 22);
    for (const [i, col] of ['#ff5f57', '#febc2e', '#28c840'].entries()) {
      x.fillStyle = col;
      x.beginPath();
      x.arc(12 + i * 16, 11, 5, 0, 7);
      x.fill();
    }
    x.fillStyle = '#7d8ba3';
    x.font = `12px ${MONO}`;
    x.fillText('sensor_task.c — firmware', 190, 15);
    x.fillStyle = '#0e1626';
    x.fillRect(0, 22, 34, 298);
    x.font = `12.5px ${MONO}`;
    for (let i = 0; i < 16; i++) {
      const n = (this.top + i) % CODE_SRC.length;
      let line = CODE_SRC[n];
      if (i === 15) line = line.slice(0, this.typed);
      const y = 40 + i * 17.5;
      x.fillStyle = '#3a4a62';
      x.fillText(String(n + 1).padStart(3), 3, y);
      const t = line.trim();
      x.fillStyle = t.startsWith('/*') || t.startsWith('//')
        ? '#5c7080'
        : t.startsWith('#')
          ? '#c792ea'
          : KW_RE.test(t.split(' ')[0])
            ? '#82aaff'
            : /\w+\(/.test(t)
              ? '#82d8ff'
              : '#d6deeb';
      x.fillText(line, 42, y);
      if (i === 15) {
        x.fillStyle = '#e2e8f0';
        x.fillRect(42 + x.measureText(line).width + 1, y - 11, 7, 14);
      }
    }
    this.texture.needsUpdate = true;
  }
}

export class ScopeScreen {
  constructor(seed = 1) {
    [this.c, this.x] = canvas(256, 192);
    this.texture = tex(this.c);
    this.t = 0;
    this.seed = seed;
    this.mode = seed % 3;
    this.acc = 0;
  }
  update(dt) {
    this.t += dt;
    this.acc += dt;
    if (this.acc < 1 / 15) return;
    this.acc = 0;
    const x = this.x;
    x.fillStyle = '#03100a';
    x.fillRect(0, 0, 256, 192);
    x.strokeStyle = 'rgba(80,140,110,0.25)';
    x.lineWidth = 1;
    for (let i = 0; i <= 10; i++) {
      x.beginPath();
      x.moveTo(i * 25.6, 0);
      x.lineTo(i * 25.6, 192);
      x.stroke();
    }
    for (let i = 0; i <= 8; i++) {
      x.beginPath();
      x.moveTo(0, i * 24);
      x.lineTo(256, i * 24);
      x.stroke();
    }
    const draw = (col, fn) => {
      x.strokeStyle = col;
      x.lineWidth = 2;
      x.shadowColor = col;
      x.shadowBlur = 6;
      x.beginPath();
      for (let i = 0; i <= 256; i += 2) {
        const y = fn(i / 256);
        if (i === 0) x.moveTo(i, y);
        else x.lineTo(i, y);
      }
      x.stroke();
      x.shadowBlur = 0;
    };
    const t = this.t;
    draw('#facc15', (u) => 60 + Math.sin(u * 22 + t * 4) * 26 * (1 + 0.1 * Math.sin(t)));
    if (this.mode === 0) draw('#22d3ee', (u) => (((u * 8 + t * 0.6) % 1) < 0.3 ? 120 : 160));
    else if (this.mode === 1) draw('#22d3ee', (u) => 140 + ((u * 6 + t) % 1) * 30 - 15);
    else draw('#f472b6', (u) => 140 + Math.sin(u * 60 + t * 9) * 8 + Math.sin(u * 7) * 14);
    x.fillStyle = '#7ee2b8';
    x.font = `10px ${MONO}`;
    x.fillText('CH1 1.00V  CH2 2.00V   500us/div', 6, 186);
    this.texture.needsUpdate = true;
  }
}

export class TerminalScreen {
  constructor(seed = 1) {
    [this.c, this.x] = canvas(384, 256);
    this.texture = tex(this.c);
    this.r = rng(seed);
    this.lines = [];
    this.acc = 0;
    this.n = 0;
  }
  update(dt) {
    this.acc += dt;
    if (this.acc < 0.35) return;
    this.acc = 0;
    const msgs = ['I2C ACK 0x48', 'ADC ch3 = 2048', 'tick 1000ms', 'BLE adv ok', 'temp 36.2C', 'heap free 41k', 'task sw 1203', 'rx 64 bytes', 'WARN retry', 'OTA chunk 12/40'];
    this.n += 1;
    this.lines.push(`[${(this.n * 0.35).toFixed(2).padStart(7)}] ${msgs[Math.floor(this.r() * msgs.length)]}`);
    if (this.lines.length > 13) this.lines.shift();
    const x = this.x;
    x.fillStyle = '#040806';
    x.fillRect(0, 0, 384, 256);
    x.font = `13px ${MONO}`;
    this.lines.forEach((l, i) => {
      x.fillStyle = l.includes('WARN') ? '#fbbf24' : '#5df2a0';
      x.fillText(l, 8, 20 + i * 18);
    });
    this.texture.needsUpdate = true;
  }
}

export function carpetTexture() {
  const [c, x] = canvas(512, 512);
  x.fillStyle = '#39465a';
  x.fillRect(0, 0, 512, 512);
  const r = rng(77);
  for (let i = 0; i < 60000; i++) {
    const v = r();
    x.fillStyle = v > 0.5 ? `rgba(120,140,170,${r() * 0.12})` : `rgba(10,14,22,${r() * 0.18})`;
    x.fillRect(r() * 512, r() * 512, 1, 1 + r() * 2);
  }
  // Carpet-tile seams.
  x.strokeStyle = 'rgba(0,0,0,0.18)';
  x.lineWidth = 2;
  x.strokeRect(0, 0, 512, 512);
  return tex(c, { repeat: [14, 9.6] });
}

export function stripeTexture() {
  const [c, x] = canvas(128, 32);
  x.fillStyle = '#facc15';
  x.fillRect(0, 0, 128, 32);
  x.fillStyle = '#111';
  for (let i = -2; i < 6; i++) {
    x.beginPath();
    x.moveTo(i * 32, 32);
    x.lineTo(i * 32 + 16, 32);
    x.lineTo(i * 32 + 48, 0);
    x.lineTo(i * 32 + 32, 0);
    x.closePath();
    x.fill();
  }
  const t = tex(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export function tileTexture() {
  const [c, x] = canvas(512, 256);
  x.fillStyle = '#9aa3ab';
  x.fillRect(0, 0, 512, 256);
  for (let row = 0; row < 8; row++)
    for (let col = -1; col < 9; col++) {
      const ox = (row % 2) * 32;
      x.fillStyle = `hsl(170, 30%, ${86 + ((row * 7 + col * 3) % 5)}%)`;
      x.fillRect(col * 64 + ox + 2, row * 32 + 2, 60, 28);
    }
  return tex(c, { repeat: [3, 2] });
}

export function pegboardTexture() {
  const [c, x] = canvas(1024, 556);
  x.fillStyle = '#e9e4d8';
  x.fillRect(0, 0, 1024, 556);
  x.fillStyle = 'rgba(60,50,40,0.45)';
  for (let i = 12; i < 1024; i += 24) for (let j = 12; j < 556; j += 24) {
    x.beginPath();
    x.arc(i, j, 3.2, 0, 7);
    x.fill();
  }
  const r = rng(5);
  const shadow = () => {
    x.shadowColor = 'rgba(0,0,0,0.35)';
    x.shadowBlur = 8;
    x.shadowOffsetX = 4;
    x.shadowOffsetY = 6;
  };
  shadow();
  // Screwdrivers.
  for (let i = 0; i < 6; i++) {
    const px = 60 + i * 34;
    x.fillStyle = ['#ef4444', '#f59e0b', '#3b82f6', '#22c55e', '#ef4444', '#a855f7'][i];
    x.beginPath();
    x.roundRect(px - 9, 80, 18, 70, 7);
    x.fill();
    x.fillStyle = '#9ca3af';
    x.fillRect(px - 2.5, 150, 5, 90 + (i % 3) * 20);
  }
  // Pliers / cutters.
  for (let i = 0; i < 3; i++) {
    const px = 330 + i * 70;
    x.strokeStyle = ['#dc2626', '#2563eb', '#16a34a'][i];
    x.lineWidth = 12;
    x.lineCap = 'round';
    x.beginPath();
    x.moveTo(px - 14, 250);
    x.lineTo(px - 4, 150);
    x.moveTo(px + 14, 250);
    x.lineTo(px + 4, 150);
    x.stroke();
    x.fillStyle = '#6b7280';
    x.beginPath();
    x.moveTo(px - 8, 150);
    x.lineTo(px + 8, 150);
    x.lineTo(px, 90);
    x.closePath();
    x.fill();
  }
  // Wire spools.
  for (let i = 0; i < 4; i++) {
    const px = 590 + i * 80;
    x.fillStyle = '#374151';
    x.beginPath();
    x.arc(px, 130, 34, 0, 7);
    x.fill();
    x.fillStyle = ['#ef4444', '#111827', '#facc15', '#3b82f6'][i];
    x.beginPath();
    x.arc(px, 130, 26, 0, 7);
    x.fill();
    x.fillStyle = '#d1d5db';
    x.beginPath();
    x.arc(px, 130, 7, 0, 7);
    x.fill();
  }
  // Tweezers, ruler, solder roll.
  x.fillStyle = '#9ca3af';
  for (let i = 0; i < 3; i++) x.fillRect(620 + i * 30, 230, 6, 120);
  x.fillStyle = '#fbbf24';
  x.fillRect(760, 220, 200, 26);
  x.fillStyle = '#78350f';
  for (let i = 0; i < 20; i++) x.fillRect(765 + i * 10, 220, 1.5, i % 5 ? 8 : 14);
  // Parts bins along the bottom.
  for (let i = 0; i < 9; i++) {
    x.fillStyle = ['#3b82f6', '#ef4444', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#ef4444', '#facc15', '#3b82f6'][i];
    x.beginPath();
    x.roundRect(40 + i * 108, 400, 92, 110, 8);
    x.fill();
    x.shadowColor = 'transparent';
    x.fillStyle = 'rgba(255,255,255,0.9)';
    x.fillRect(52 + i * 108, 420, 68, 22);
    x.fillStyle = '#111';
    x.font = `bold 15px ${MONO}`;
    x.fillText(['10k', '0402', 'LDO', 'MOSFET', 'XTAL', 'ESD', '100nF', 'LED', 'M2'][i], 56 + i * 108, 437);
    shadow();
  }
  x.shadowColor = 'transparent';
  return tex(c);
}
