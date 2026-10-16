// Shared lab layout — imported by both the server (task placement) and the
// client (world building, interaction). Units are metres. The lab spans
// x ∈ [-ROOM.w, ROOM.w], z ∈ [-ROOM.d, ROOM.d].

export const ROOM = { w: 20, d: 14, h: 4.2 };

export const SPAWN = { x: 0, z: 10.5, ry: 0 };

// Station kinds and which task types can spawn on them.
export const STATION_KINDS = {
  pc: { label: '工作站', tasks: ['codefix', 'register'] },
  scope: { label: '示波器量測台', tasks: ['pwm'] },
  serial: { label: '序列埠除錯台', tasks: ['uart'] },
  jtag: { label: 'JTAG 燒錄台', tasks: ['flash'] },
};

// `ry` rotates the bench group around Y. The operator always stands on the
// group's local +Z side, looking toward local -Z.
const HALF_PI = Math.PI / 2;
export const STATIONS = [
  // Two rows of engineer desks (operator faces north / -Z).
  { id: 'D1', kind: 'pc', x: -14, z: -5, ry: 0 },
  { id: 'D2', kind: 'pc', x: -10, z: -5, ry: 0 },
  { id: 'D3', kind: 'pc', x: -6, z: -5, ry: 0 },
  { id: 'D4', kind: 'pc', x: -14, z: 1, ry: 0 },
  { id: 'D5', kind: 'pc', x: -10, z: 1, ry: 0 },
  { id: 'D6', kind: 'pc', x: -6, z: 1, ry: 0 },
  // Hardware benches along the east wall (operator faces east / +X).
  { id: 'B1', kind: 'scope', x: 19.4, z: -8, ry: -HALF_PI },
  { id: 'B2', kind: 'serial', x: 19.4, z: -3.5, ry: -HALF_PI },
  { id: 'B3', kind: 'jtag', x: 19.4, z: 1, ry: -HALF_PI },
  { id: 'B4', kind: 'scope', x: 19.4, z: 5.5, ry: -HALF_PI },
  // Central lab island (back-to-back benches).
  { id: 'I1', kind: 'jtag', x: 6, z: -4.6, ry: Math.PI },
  { id: 'I2', kind: 'serial', x: 6, z: -3.8, ry: 0 },
];

export const COFFEE = { x: 16.5, z: 13.55, ry: Math.PI };

export function operatorSpot(st) {
  // World position where the operator stands (0.95 m in front of the bench).
  return {
    x: st.x + Math.sin(st.ry) * 0.95,
    z: st.z + Math.cos(st.ry) * 0.95,
  };
}

export const SEVERITY = {
  P0: { label: 'P0 · 產線停擺', color: '#ff3b5c', mult: 3 },
  P1: { label: 'P1 · 嚴重', color: '#ff8a3d', mult: 1.6 },
  P2: { label: 'P2 · 一般', color: '#ffd23f', mult: 1 },
  P3: { label: 'P3 · 輕微', color: '#5ad1ff', mult: 0.7 },
};

export const TASK_TYPES = {
  codefix: { label: 'Code Review / 修 Bug', base: 12 },
  register: { label: '暫存器設定', base: 14 },
  pwm: { label: 'PWM 波形調校', base: 16 },
  uart: { label: 'UART 開機log除錯', base: 14 },
  flash: { label: '韌體燒錄', base: 10 },
};

export const SPRINT_SECONDS = 6 * 60;
export const INTERMISSION_SECONDS = 15;
