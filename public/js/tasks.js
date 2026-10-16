// Task mini-game UIs. Each renderer receives the claimed task and an API:
//   api.submit(answer) -> Promise<{ok, msg, points}>
//   api.feedback(text, kind)
//   api.button(label, cls, onClick) -> HTMLButtonElement (in the footer)
import { sfx } from './audio.js';

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
};

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

/* ------------------------------------------------------------------ */
/* Code review                                                          */
/* ------------------------------------------------------------------ */

const KW = new Set(['void', 'int', 'if', 'else', 'while', 'for', 'return', 'static', 'volatile', 'const', 'switch', 'case', 'break', 'default', 'typedef', 'struct', 'extern', 'sizeof', 'unsigned']);
const TY = new Set(['uint8_t', 'uint16_t', 'uint32_t', 'int16_t', 'int32_t', 'imu_sample_t', 'bool', 'char']);

function highlight(line) {
  const out = [];
  const re = /(\/\/.*$|\/\*.*?\*\/)|("(?:[^"\\]|\\.)*")|(#\s*\w+)|\b(0x[0-9a-fA-F]+U?|\d+U?)\b|([A-Za-z_]\w*)(\s*\()?|([^\w\s])|(\s+)/g;
  let m;
  while ((m = re.exec(line))) {
    if (m[1]) out.push(`<span class="tok-c">${esc(m[1])}</span>`);
    else if (m[2]) out.push(`<span class="tok-s">${esc(m[2])}</span>`);
    else if (m[3]) out.push(`<span class="tok-k">${esc(m[3])}</span>`);
    else if (m[4]) out.push(`<span class="tok-n">${esc(m[4])}</span>`);
    else if (m[5]) {
      const w = m[5];
      const cls = KW.has(w) ? 'tok-k' : TY.has(w) ? 'tok-t' : m[6] ? 'tok-f' : /^[A-Z][A-Z0-9_]+$/.test(w) ? 'tok-p' : '';
      out.push(cls ? `<span class="${cls}">${esc(w)}</span>` : esc(w));
      if (m[6]) out.push(esc(m[6]));
    } else out.push(esc(m[0]));
  }
  return out.join('');
}

function codefix(body, task, api) {
  const { pub } = task;
  let sel = -1;
  body.append(h('p', { class: 'hint' }, `QA 回報：「${task.title}」。${pub.hint}，然後提交。`));
  const code = h('div', { class: 'code' }, h('div', { class: 'file' }, `📄 src/${pub.file}`));
  const rows = pub.code.map((line, i) => {
    const row = h('div', { class: 'ln', onclick: () => choose(i) }, h('span', { class: 'no' }, String(i + 1)), h('span', { html: highlight(line) || ' ' }));
    code.append(row);
    return row;
  });
  body.append(code);
  const btn = api.button('提交修正 ⏎', 'primary', submit);
  btn.disabled = true;
  function choose(i) {
    if (!pub.code[i].trim()) return;
    sfx.click();
    sel = i;
    rows.forEach((r, j) => r.classList.toggle('sel', j === i));
    btn.disabled = false;
  }
  async function submit() {
    if (sel < 0) return;
    btn.disabled = true;
    const res = await api.submit({ line: sel });
    if (res.ok) {
      rows[sel].classList.add('right');
    } else {
      rows[sel].classList.add('wrong');
      btn.disabled = false;
    }
  }
  return { onEnter: submit };
}

/* ------------------------------------------------------------------ */
/* Register configuration                                              */
/* ------------------------------------------------------------------ */

function register(body, task, api) {
  const { pub } = task;
  let value = 0;
  const owner = new Array(16).fill(null);
  for (const f of pub.fields) for (let b = f.bit; b < f.bit + f.w; b++) owner[b] = f;

  const bits = h('div', { class: 'reg-bits' });
  const idx = h('div', { class: 'reg-idx' });
  const fields = h('div', { class: 'reg-fields' });
  const cells = [];
  for (let b = 15; b >= 0; b--) {
    const reserved = !owner[b];
    const cell = h('div', { class: `bit${reserved ? ' rsv' : ''}`, title: reserved ? 'Reserved' : `${owner[b].name} — ${owner[b].desc}`, onclick: () => !reserved && toggle(b) }, '0');
    cells[b] = cell;
    bits.append(cell);
    idx.append(h('div', {}, String(b)));
  }
  // Field label row, spanning bits.
  for (let b = 15; b >= 0; ) {
    const f = owner[b];
    if (!f) {
      fields.append(h('div', { style: 'opacity:.3' }, '—'));
      b--;
      continue;
    }
    fields.append(h('div', { style: `grid-column: span ${f.w}`, title: f.desc }, f.name));
    b -= f.w;
  }
  const hex = h('div', { class: 'reg-hex' });
  const decoded = h('div', { class: 'hint', style: 'margin-top:8px;font-family:var(--mono)' });

  const left = h('div', {}, h('p', { class: 'hint' }, `${pub.hint}。點擊位元切換 0/1。`), h('div', { class: 'sec-title' }, pub.reg), bits, idx, fields, hex, decoded);
  const spec = h(
    'div',
    { class: 'spec' },
    h('h4', {}, `📘 Datasheet · ${pub.reg} 需求`),
    h('ul', {}, pub.req.map((r) => h('li', {}, `${r.name} = ${r.w > 1 ? '0b' + r.value.toString(2).padStart(r.w, '0') : r.value}`))),
    h(
      'table',
      {},
      pub.fields.map((f) => h('tr', {}, h('td', {}, f.w > 1 ? `[${f.bit + f.w - 1}:${f.bit}]` : `[${f.bit}]`), h('td', {}, f.name), h('td', {}, f.desc))),
    ),
  );
  body.append(h('div', { class: 'reg-wrap' }, left, spec));

  function render() {
    for (let b = 0; b < 16; b++) {
      if (!cells[b]) continue;
      const on = (value >> b) & 1;
      cells[b].classList.toggle('on', !!on);
      cells[b].textContent = on;
    }
    hex.innerHTML = `<small>${pub.reg} =</small>0x${value.toString(16).toUpperCase().padStart(4, '0')}`;
    decoded.textContent = pub.fields
      .map((f) => [f, (value >> f.bit) & ((1 << f.w) - 1)])
      .filter(([, v]) => v)
      .map(([f, v]) => `${f.name}=${v}`)
      .join('  ') || '(all zero)';
  }
  function toggle(b) {
    sfx.click();
    value ^= 1 << b;
    render();
  }
  render();
  api.button('清除', 'ghost', () => {
    value = 0;
    render();
  });
  const btn = api.button('寫入暫存器 ⏎', 'primary', submit);
  async function submit() {
    btn.disabled = true;
    const res = await api.submit({ value });
    if (!res.ok) btn.disabled = false;
  }
  return { onEnter: submit };
}

/* ------------------------------------------------------------------ */
/* PWM timer tuning                                                     */
/* ------------------------------------------------------------------ */

function pwm(body, task, api) {
  const { pub } = task;
  const st = { psc: 0, arr: 999, ccr: 500 };
  const cv = h('canvas', { class: 'scope-screen', width: 1040, height: 520 });
  const fmtHz = (f) => (f >= 1e6 ? (f / 1e6).toFixed(3) + ' MHz' : f >= 1000 ? (f / 1000).toFixed(3) + ' kHz' : f.toFixed(2) + ' Hz');

  const input = (key, label, max) => {
    const num = h('input', { type: 'number', min: 0, max: 65535, value: st[key] });
    const rng = h('input', { type: 'range', min: 0, max: 1000, value: 0 });
    const toR = (v) => Math.round((Math.log10(v + 1) / Math.log10(65536)) * 1000);
    const fromR = (r) => Math.round(10 ** ((r / 1000) * Math.log10(65536)) - 1);
    rng.value = toR(st[key]);
    num.addEventListener('input', () => {
      st[key] = Math.max(0, Math.min(65535, Math.floor(Number(num.value) || 0)));
      rng.value = toR(st[key]);
      update();
    });
    rng.addEventListener('input', () => {
      st[key] = fromR(Number(rng.value));
      num.value = st[key];
      update();
    });
    return h('label', {}, label, h('div', { class: 'row' }, num), rng);
  };
  const mF = h('b', {});
  const mD = h('b', {});
  const ctrl = h(
    'div',
    { class: 'pwm-ctrl' },
    input('psc', 'PSC  預除頻器 (0-65535)'),
    input('arr', 'ARR  自動重載 (0-65535)'),
    input('ccr', 'CCR  比較值 (0-65535)'),
    h('div', { class: 'meas' }, h('div', {}, '量測頻率', mF), h('div', {}, '量測 Duty', mD)),
  );
  const clkM = pub.clk / 1e6;
  body.append(
    h('p', { class: 'hint' }, `目標：${pub.purpose}（${pub.note}）需要 ${fmtHz(pub.freq)}、Duty ${pub.duty}%，誤差頻率 ≤ 1%、Duty ±1%。Timer 時脈 ${clkM} MHz。`),
    h('div', { class: 'pwm-wrap' }, h('div', {}, cv, h('div', { class: 'formula' }, `f = ${clkM}MHz / ((PSC+1) × (ARR+1))   ·   duty = CCR / (ARR+1)`, h('br'), '💡 提示：先選 PSC 讓計數頻率變成整數（例如 1 MHz），再算 ARR。')), ctrl),
  );
  const ctx = cv.getContext('2d');
  let t0 = performance.now();
  let raf = 0;
  const calc = () => {
    const f = pub.clk / ((st.psc + 1) * (st.arr + 1));
    const d = (Math.min(st.ccr, st.arr + 1) / (st.arr + 1)) * 100;
    return { f, d };
  };
  function update() {
    const { f, d } = calc();
    const fok = Math.abs(f - pub.freq) / pub.freq <= 0.01;
    const dok = Math.abs(d - pub.duty) <= 1;
    mF.textContent = fmtHz(f);
    mF.className = fok ? 'ok' : 'no';
    mD.textContent = d.toFixed(2) + '%';
    mD.className = dok ? 'ok' : 'no';
  }
  function draw() {
    const W = cv.width;
    const H = cv.height;
    ctx.fillStyle = '#020805';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(80,160,120,0.18)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i++) {
      ctx.beginPath();
      ctx.moveTo((i * W) / 10, 0);
      ctx.lineTo((i * W) / 10, H);
      ctx.stroke();
    }
    for (let i = 0; i <= 8; i++) {
      ctx.beginPath();
      ctx.moveTo(0, (i * H) / 8);
      ctx.lineTo(W, (i * H) / 8);
      ctx.stroke();
    }
    const span = 3 / pub.freq; // 3 target periods across the screen
    const { f, d } = calc();
    const scroll = ((performance.now() - t0) / 1000) * 0.15;
    const trace = (freq, duty, y0, amp, col, dash) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = dash ? 2 : 3;
      ctx.setLineDash(dash ? [10, 8] : []);
      ctx.shadowColor = col;
      ctx.shadowBlur = dash ? 0 : 10;
      ctx.beginPath();
      const N = 1400;
      for (let i = 0; i <= N; i++) {
        const t = (i / N) * span + scroll * span * 0;
        const ph = (t * freq) % 1;
        const hi = ph < duty / 100;
        const y = hi ? y0 - amp : y0;
        const x = (i / N) * W;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
    };
    trace(pub.freq, pub.duty, H * 0.42, H * 0.26, 'rgba(250,204,21,0.55)', true);
    if (f / pub.freq < 400) trace(f, d, H * 0.88, H * 0.3, '#22d3ee', false);
    else {
      ctx.fillStyle = '#22d3ee';
      ctx.fillRect(0, H * 0.58, W, H * 0.3);
    }
    ctx.font = '600 22px "JetBrains Mono", monospace';
    ctx.fillStyle = '#facc15';
    ctx.fillText(`TARGET  ${fmtHz(pub.freq)}  ${pub.duty}%`, 18, 34);
    ctx.fillStyle = '#22d3ee';
    ctx.fillText(`CH1     ${fmtHz(f)}  ${d.toFixed(1)}%`, 18, H * 0.58 - 14);
    ctx.fillStyle = '#7ee2b8';
    ctx.textAlign = 'right';
    ctx.fillText(`${((span / 10) * 1000).toPrecision(3)} ms/div`, W - 18, 34);
    ctx.textAlign = 'left';
    raf = requestAnimationFrame(draw);
  }
  update();
  draw();
  const btn = api.button('套用設定並量測 ⏎', 'primary', submit);
  async function submit() {
    btn.disabled = true;
    const res = await api.submit({ ...st });
    if (!res.ok) btn.disabled = false;
  }
  return { onEnter: submit, dispose: () => cancelAnimationFrame(raf) };
}

/* ------------------------------------------------------------------ */
/* UART boot log                                                        */
/* ------------------------------------------------------------------ */

function garble(text, seed) {
  let s = seed;
  const r = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const junk = '�ÿþ¿×ØÐ¤§¶µ±«»~^`|}{][%$#@!¬¦ΣΩ░▒▓';
  return text
    .split('')
    .map((c) => (c === '\n' ? '\n' : r() < 0.08 ? ' ' : junk[Math.floor(r() * junk.length)]))
    .join('');
}

function uart(body, task, api) {
  const { pub } = task;
  let baud = null;
  let answer = null;
  const term = h('div', { class: 'term garbled' });
  const status = h('div', { class: 'bar' });
  const termWrap = h('div', {}, status, term);
  let typing = 0;

  const baudChips = h(
    'div',
    { class: 'chips' },
    pub.bauds.map((b) =>
      h(
        'button',
        {
          onclick: (e) => {
            sfx.click();
            baud = b;
            [...baudChips.children].forEach((c) => c.classList.toggle('on', c === e.currentTarget));
            show();
          },
        },
        String(b),
      ),
    ),
  );
  const ansChips = h(
    'div',
    { class: 'chips' },
    pub.options.map((o) =>
      h(
        'button',
        {
          onclick: (e) => {
            sfx.click();
            answer = o;
            [...ansChips.children].forEach((c) => c.classList.toggle('on', c === e.currentTarget));
            btn.disabled = !baud;
          },
        },
        o,
      ),
    ),
  );
  body.append(
    h('p', { class: 'hint' }, '裝置開機卡住了。先選對 baud rate 讓 log 可讀，再根據 log 找出故障原因。'),
    h('div', { class: 'sec-title' }, '序列埠設定 · 8N1 · /dev/ttyUSB0'),
    baudChips,
    termWrap,
    h('div', { class: 'q' }, `🩺 ${pub.q}`),
    ansChips,
  );
  const full = pub.lines.join('\n');
  function show() {
    clearInterval(typing);
    status.textContent = baud ? `● ${baud} baud · 8N1` : '○ 尚未連線';
    if (!baud) {
      term.textContent = '';
      return;
    }
    const ok = baud === pub.trueBaud;
    term.classList.toggle('garbled', !ok);
    const text = ok ? full : garble(full, pub.seed + baud);
    let n = 0;
    typing = setInterval(() => {
      n = Math.min(text.length, n + 9);
      const part = text.slice(0, n);
      term.innerHTML = ok
        ? esc(part).replace(/^(.*(?:NACK|failed|OVERFLOW|HardFault|MISMATCH|LOW|expected|unstable|degraded).*)$/gm, '<span class="err">$1</span>')
        : esc(part);
      if (n >= text.length) clearInterval(typing);
      if (n % 27 === 0) sfx.key();
    }, 16);
  }
  show();
  const btn = api.button('提交診斷 ⏎', 'primary', submit);
  btn.disabled = true;
  async function submit() {
    if (!baud || !answer) return;
    btn.disabled = true;
    const res = await api.submit({ baud, answer });
    if (!res.ok) btn.disabled = false;
  }
  return { onEnter: submit, dispose: () => clearInterval(typing) };
}

/* ------------------------------------------------------------------ */
/* Firmware flashing                                                    */
/* ------------------------------------------------------------------ */

const STEP_LABEL = { connect: '🔌 Connect', erase: '🧹 Erase', program: '⬇ Program', verify: '🔍 Verify', reset: '↻ Reset' };

function flash(body, task, api) {
  const { pub } = task;
  let file = null;
  let seq = [];
  const b = pub.board;
  const label = h(
    'div',
    { class: 'board-label' },
    h('h4', {}, '🏷 板子標籤'),
    h('div', { html: `PRODUCT : ${b.product}<br>HW REV  : Rev.${b.rev}<br>MCU     : ${b.mcu}<br>BOOTLDR : BL${b.bl}<br>TARGET  : v${b.ver}` }),
  );
  const files = h(
    'div',
    { class: 'files' },
    pub.files.map((f) =>
      h(
        'button',
        {
          onclick: (e) => {
            sfx.click();
            file = f;
            [...files.children].forEach((c) => c.classList.toggle('on', c === e.currentTarget));
            ready();
          },
        },
        f,
      ),
    ),
  );
  const seqView = h('div', { class: 'hint', style: 'font-family:var(--mono);margin:10px 0 0' });
  const steps = h(
    'div',
    { class: 'steps' },
    pub.steps.map((s) =>
      h(
        'button',
        {
          'data-s': s,
          onclick: (e) => {
            if (seq.includes(s) || running) return;
            sfx.click();
            seq.push(s);
            e.currentTarget.classList.add('done');
            e.currentTarget.textContent = `${seq.length}. ${STEP_LABEL[s]}`;
            renderSeq();
            ready();
          },
        },
        STEP_LABEL[s],
      ),
    ),
  );
  const log = h('div', { class: 'flash-log' }, '$ st-flash --ready');
  const prog = h('div', {});
  body.append(
    h('p', { class: 'hint' }, pub.hint + '。'),
    h(
      'div',
      { class: 'flash-wrap' },
      h('div', {}, label),
      h('div', {}, h('div', { class: 'sec-title' }, '① 選擇映像檔 /release/'), files, h('div', { class: 'sec-title', style: 'margin-top:14px' }, '② 依序點選燒錄流程'), steps, seqView, log, h('div', { class: 'flash-prog' }, prog)),
    ),
  );
  let running = false;
  const renderSeq = () => (seqView.textContent = seq.length ? '流程：' + seq.join(' → ') : '流程：（尚未選擇）');
  renderSeq();
  api.button('重設流程', 'ghost', () => {
    if (running) return;
    seq = [];
    [...steps.children].forEach((c) => {
      c.classList.remove('done');
      c.textContent = STEP_LABEL[c.dataset.s];
    });
    renderSeq();
    ready();
  });
  const btn = api.button('開始燒錄 ⏎', 'primary', run);
  const ready = () => (btn.disabled = !(file && seq.length === 5) || running);
  ready();

  async function run() {
    if (btn.disabled) return;
    running = true;
    ready();
    const lines = [
      `$ st-flash --chip ${b.mcu} write ${file} 0x08000000`,
      seq[0] === 'connect' ? 'ST-LINK V3 · SWD @ 4 MHz · target voltage 3.29V' : '!! no target connected',
      'Erasing flash ...',
      `Writing ${(40 + Math.random() * 300).toFixed(0)} KiB ...`,
      'Verifying ...',
    ];
    log.textContent = '';
    for (let i = 0; i < lines.length; i++) {
      log.textContent += (i ? '\n' : '') + lines[i];
      for (let p = 0; p < 10; p++) {
        prog.style.width = `${((i * 10 + p + 1) / (lines.length * 10)) * 100}%`;
        await new Promise((r) => setTimeout(r, 45));
      }
    }
    const res = await api.submit({ file, steps: seq });
    log.textContent += res.ok ? '\n✔ Flash OK. Target reset. Booting…' : `\n✖ ${res.msg}`;
    running = false;
    if (!res.ok) {
      prog.style.width = '0';
      ready();
    }
  }
  return { onEnter: run };
}

export const TASK_UI = { codefix, register, pwm, uart, flash };
