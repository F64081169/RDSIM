// Puzzle generators. Each returns { title, pub, solution } where `pub` is sent
// to the client and `solution` stays on the server for verification.

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/* ------------------------------------------------------------------ */
/* Code review: find the buggy line                                    */
/* ------------------------------------------------------------------ */

const SNIPPETS = [
  {
    title: '按鈕中斷偶爾沒反應',
    file: 'button.c',
    code: [
      '#include "stm32f4xx.h"',
      '',
      'static uint8_t btn_pressed = 0;',
      '',
      'void EXTI0_IRQHandler(void) {',
      '    EXTI->PR = EXTI_PR_PR0;',
      '    btn_pressed = 1;',
      '}',
      '',
      'int main(void) {',
      '    board_init();',
      '    while (1) {',
      '        if (btn_pressed) {',
      '            btn_pressed = 0;',
      '            led_toggle();',
      '        }',
      '    }',
      '}',
    ],
    bug: 2,
    why: 'ISR 與主迴圈共用的旗標沒有宣告 volatile，編譯器最佳化後主迴圈可能永遠讀不到更新。',
  },
  {
    title: 'UART 接收緩衝區踩到記憶體',
    file: 'uart_rx.c',
    code: [
      '#define RX_SIZE 64',
      'static uint8_t rx_buf[RX_SIZE];',
      'static volatile uint16_t rx_head = 0;',
      '',
      'void USART2_IRQHandler(void) {',
      '    if (USART2->SR & USART_SR_RXNE) {',
      '        uint8_t c = USART2->DR;',
      '        rx_buf[rx_head] = c;',
      '        rx_head++;',
      '        if (rx_head > RX_SIZE) {',
      '            rx_head = 0;',
      '        }',
      '    }',
      '}',
    ],
    bug: 9,
    why: '應為 rx_head >= RX_SIZE；用 > 會讓 rx_buf[64] 被寫入，越界一個 byte。',
  },
  {
    title: '關掉 LED 時其他腳位也被關了',
    file: 'gpio.c',
    code: [
      '#define LED_PIN   5',
      '#define RELAY_PIN 6',
      '',
      'void led_on(void) {',
      '    GPIOA->ODR |= (1U << LED_PIN);',
      '}',
      '',
      'void led_off(void) {',
      '    GPIOA->ODR &= (1U << LED_PIN);',
      '}',
      '',
      'void relay_on(void) {',
      '    GPIOA->ODR |= (1U << RELAY_PIN);',
      '}',
    ],
    bug: 8,
    why: '清除位元要用 &= ~(1U << LED_PIN)；少了 ~ 會把其他所有腳位清成 0。',
  },
  {
    title: 'ISR 裡呼叫阻塞函式導致看門狗重開',
    file: 'adc_isr.c',
    code: [
      'volatile uint16_t adc_value;',
      '',
      'void ADC_IRQHandler(void) {',
      '    if (ADC1->SR & ADC_SR_EOC) {',
      '        adc_value = ADC1->DR;',
      '        printf("ADC=%u\\r\\n", adc_value);',
      '    }',
      '}',
      '',
      'void main_loop(void) {',
      '    IWDG->KR = 0xAAAA;',
      '    process(adc_value);',
      '}',
    ],
    bug: 5,
    why: 'printf 透過 UART 阻塞輸出，在 ISR 內呼叫會長時間佔住中斷，導致看門狗逾時。',
  },
  {
    title: '感測器資料長度算錯',
    file: 'sensor.c',
    code: [
      'typedef struct {',
      '    int16_t ax, ay, az;',
      '    int16_t gx, gy, gz;',
      '} imu_sample_t;',
      '',
      'void imu_read(imu_sample_t *s) {',
      '    uint8_t raw[12];',
      '    i2c_read(IMU_ADDR, REG_ACCEL, raw, sizeof(s));',
      '    s->ax = (raw[0] << 8) | raw[1];',
      '    s->ay = (raw[2] << 8) | raw[3];',
      '    s->az = (raw[4] << 8) | raw[5];',
      '}',
    ],
    bug: 7,
    why: 'sizeof(s) 是指標大小 (4 bytes)，不是結構大小；應該用 sizeof(raw) 或 sizeof(*s)。',
  },
  {
    title: '倒數迴圈變成無窮迴圈',
    file: 'flash_erase.c',
    code: [
      'void erase_sectors(uint8_t first, uint8_t count) {',
      '    for (uint8_t i = count - 1; i >= 0; i--) {',
      '        flash_unlock();',
      '        flash_erase_sector(first + i);',
      '        flash_lock();',
      '    }',
      '}',
      '',
      'void fw_update_begin(void) {',
      '    erase_sectors(5, 3);',
      '}',
    ],
    bug: 1,
    why: 'uint8_t 永遠 >= 0，i-- 到 0 之後會繞回 255，變成無窮迴圈並亂擦 sector。',
  },
  {
    title: '狀態機跑到下一個狀態',
    file: 'fsm.c',
    code: [
      'switch (state) {',
      'case ST_IDLE:',
      '    if (start_req) state = ST_RUN;',
      '    break;',
      'case ST_RUN:',
      '    motor_pwm(duty);',
      '    if (fault) state = ST_FAULT;',
      'case ST_FAULT:',
      '    motor_stop();',
      '    alarm_on();',
      '    break;',
      'default:',
      '    state = ST_IDLE;',
      '}',
    ],
    bug: 6,
    why: 'ST_RUN 結尾缺少 break，會直接 fall-through 到 ST_FAULT，馬達每次都被停掉。',
  },
  {
    title: '共用計數器偶爾少算',
    file: 'counter.c',
    code: [
      'static volatile uint32_t pulse_count;',
      '',
      'void TIM3_IRQHandler(void) {',
      '    TIM3->SR = 0;',
      '    pulse_count++;',
      '}',
      '',
      'uint32_t take_count(void) {',
      '    uint32_t n = pulse_count;',
      '    pulse_count = 0;',
      '    return n;',
      '}',
    ],
    bug: [8, 9],
    why: '讀取與清零之間可能被中斷插入（race condition），需要先 __disable_irq() 保護臨界區。',
  },
  {
    title: 'Timer 延遲時間溢位',
    file: 'delay.c',
    code: [
      'extern volatile uint32_t g_ms;',
      '',
      'void delay_ms(uint32_t ms) {',
      '    uint32_t start = g_ms;',
      '    while (g_ms < start + ms) {',
      '        __WFI();',
      '    }',
      '}',
      '',
      'void SysTick_Handler(void) {',
      '    g_ms++;',
      '}',
    ],
    bug: 4,
    why: 'g_ms 溢位時 start + ms 會繞回，比較失效；應寫成 (g_ms - start) < ms。',
  },
  {
    title: 'SPI 讀取前沒拉低 CS',
    file: 'spi_flash.c',
    code: [
      'uint8_t flash_read_status(void) {',
      '    uint8_t cmd = 0x05, st;',
      '    spi_transfer(&cmd, NULL, 1);',
      '    cs_low();',
      '    spi_transfer(NULL, &st, 1);',
      '    cs_high();',
      '    return st;',
      '}',
    ],
    bug: 2,
    why: 'cs_low() 必須在送出指令之前；目前 0x05 指令在 CS 為高時送出，Flash 不會理會。',
  },
  {
    title: 'DMA 緩衝區被提早釋放',
    file: 'dma_tx.c',
    code: [
      'void send_report(void) {',
      '    uint8_t frame[32];',
      '    build_report(frame, sizeof(frame));',
      '    dma_start_tx(USART1, frame, sizeof(frame));',
      '}',
      '',
      'void DMA2_Stream7_IRQHandler(void) {',
      '    DMA2->HIFCR = DMA_HIFCR_CTCIF7;',
      '    tx_busy = 0;',
      '}',
    ],
    bug: 1,
    why: 'frame 是區域陣列，函式返回後堆疊被覆寫，DMA 卻還在讀它；應改為 static 或全域緩衝區。',
  },
  {
    title: '位移錯誤設到錯的腳位',
    file: 'exti_cfg.c',
    code: [
      '// enable interrupt on PB7',
      'void exti_pb7_init(void) {',
      '    RCC->APB2ENR |= RCC_APB2ENR_SYSCFGEN;',
      '    SYSCFG->EXTICR[1] |= (1U << 12);',
      '    EXTI->IMR  |= (1U << 8);',
      '    EXTI->FTSR |= (1U << 7);',
      '    NVIC_EnableIRQ(EXTI9_5_IRQn);',
      '}',
    ],
    bug: 4,
    why: 'PB7 的中斷遮罩是 bit 7；(1U << 8) 開到 EXTI8，PB7 的中斷永遠不會進來。',
  },
];

function genCodefix() {
  const s = pick(SNIPPETS);
  return {
    title: s.title,
    pub: { file: s.file, code: s.code, hint: '點選有 bug 的那一行' },
    solution: { line: s.bug, why: s.why },
  };
}

/* ------------------------------------------------------------------ */
/* Register configuration                                              */
/* ------------------------------------------------------------------ */

const REGISTERS = [
  {
    name: 'USART2_CR1',
    periph: 'USART2',
    fields: [
      { name: 'SBK', bit: 0, w: 1, desc: 'Send break' },
      { name: 'RWU', bit: 1, w: 1, desc: 'Receiver wakeup' },
      { name: 'RE', bit: 2, w: 1, desc: 'Receiver enable' },
      { name: 'TE', bit: 3, w: 1, desc: 'Transmitter enable' },
      { name: 'IDLEIE', bit: 4, w: 1, desc: 'IDLE interrupt enable' },
      { name: 'RXNEIE', bit: 5, w: 1, desc: 'RXNE interrupt enable' },
      { name: 'TCIE', bit: 6, w: 1, desc: 'TC interrupt enable' },
      { name: 'TXEIE', bit: 7, w: 1, desc: 'TXE interrupt enable' },
      { name: 'PEIE', bit: 8, w: 1, desc: 'PE interrupt enable' },
      { name: 'PS', bit: 9, w: 1, desc: 'Parity selection (1=odd)' },
      { name: 'PCE', bit: 10, w: 1, desc: 'Parity control enable' },
      { name: 'WAKE', bit: 11, w: 1, desc: 'Wakeup method' },
      { name: 'M', bit: 12, w: 1, desc: 'Word length (1=9 bits)' },
      { name: 'UE', bit: 13, w: 1, desc: 'USART enable' },
      { name: 'OVER8', bit: 15, w: 1, desc: 'Oversampling by 8' },
    ],
    always: { UE: 1, TE: 1, RE: 1 },
  },
  {
    name: 'SPI1_CR1',
    periph: 'SPI1',
    fields: [
      { name: 'CPHA', bit: 0, w: 1, desc: 'Clock phase' },
      { name: 'CPOL', bit: 1, w: 1, desc: 'Clock polarity' },
      { name: 'MSTR', bit: 2, w: 1, desc: 'Master selection' },
      { name: 'BR', bit: 3, w: 3, desc: 'Baud rate: fPCLK/2^(BR+1)' },
      { name: 'SPE', bit: 6, w: 1, desc: 'SPI enable' },
      { name: 'LSBFIRST', bit: 7, w: 1, desc: 'Frame format' },
      { name: 'SSI', bit: 8, w: 1, desc: 'Internal slave select' },
      { name: 'SSM', bit: 9, w: 1, desc: 'Software slave mgmt' },
      { name: 'RXONLY', bit: 10, w: 1, desc: 'Receive only' },
      { name: 'DFF', bit: 11, w: 1, desc: 'Data frame (1=16-bit)' },
    ],
    always: { MSTR: 1, SPE: 1 },
  },
  {
    name: 'TIM2_CR1',
    periph: 'TIM2',
    fields: [
      { name: 'CEN', bit: 0, w: 1, desc: 'Counter enable' },
      { name: 'UDIS', bit: 1, w: 1, desc: 'Update disable' },
      { name: 'URS', bit: 2, w: 1, desc: 'Update request source' },
      { name: 'OPM', bit: 3, w: 1, desc: 'One-pulse mode' },
      { name: 'DIR', bit: 4, w: 1, desc: 'Direction (1=down)' },
      { name: 'CMS', bit: 5, w: 2, desc: 'Center-aligned mode' },
      { name: 'ARPE', bit: 7, w: 1, desc: 'Auto-reload preload' },
      { name: 'CKD', bit: 8, w: 2, desc: 'Clock division' },
    ],
    always: { CEN: 1 },
  },
  {
    name: 'GPIOA_MODER',
    periph: 'GPIOA',
    fields: [0, 1, 2, 3, 4, 5, 6, 7].map((p) => ({
      name: `MODER${p}`,
      bit: p * 2,
      w: 2,
      desc: `PA${p}: 00=In 01=Out 10=AF 11=Analog`,
    })),
    always: {},
  },
];

function genRegister() {
  const r = pick(REGISTERS);
  const req = {};
  for (const [k, v] of Object.entries(r.always)) req[k] = v;
  const others = shuffle(r.fields.filter((f) => !(f.name in req)));
  const nReq = randInt(2, 4);
  for (const f of others.slice(0, nReq)) {
    req[f.name] = randInt(1, (1 << f.w) - 1);
  }
  let value = 0;
  for (const f of r.fields) {
    if (f.name in req) value |= req[f.name] << f.bit;
  }
  const reqList = r.fields
    .filter((f) => f.name in req)
    .map((f) => ({ name: f.name, value: req[f.name], w: f.w }));
  return {
    title: `設定 ${r.name}`,
    pub: {
      reg: r.name,
      fields: r.fields,
      req: reqList,
      hint: '依規格設定位元，其餘欄位保持 0',
    },
    solution: { value },
  };
}

/* ------------------------------------------------------------------ */
/* PWM timer tuning                                                     */
/* ------------------------------------------------------------------ */

function genPwm() {
  const clk = pick([16, 48, 72, 84, 168]) * 1_000_000;
  const freq = pick([50, 100, 200, 250, 400, 500, 1000, 2000, 5000, 10000, 20000]);
  const duty = pick([10, 20, 25, 30, 40, 50, 60, 75, 80, 90]);
  const purpose = pick([
    { name: '伺服馬達', note: '舵機需要穩定的 PWM' },
    { name: 'LED 調光', note: '避免人眼看到閃爍' },
    { name: '風扇轉速', note: '4-pin 風扇 PWM 控制' },
    { name: '蜂鳴器', note: '產生提示音' },
    { name: '馬達驅動器', note: 'H-bridge 輸入' },
  ]);
  return {
    title: `${purpose.name}：${freq >= 1000 ? freq / 1000 + ' kHz' : freq + ' Hz'} / ${duty}%`,
    pub: { clk, freq, duty, purpose: purpose.name, note: purpose.note, tol: 1 },
    solution: { clk, freq, duty },
  };
}

function checkPwm(sol, ans) {
  const psc = Math.floor(Number(ans?.psc));
  const arr = Math.floor(Number(ans?.arr));
  const ccr = Math.floor(Number(ans?.ccr));
  if (![psc, arr, ccr].every((n) => Number.isFinite(n) && n >= 0 && n <= 65535)) {
    return { ok: false, msg: 'PSC / ARR / CCR 必須是 0~65535 的整數' };
  }
  const f = sol.clk / ((psc + 1) * (arr + 1));
  const d = (Math.min(ccr, arr + 1) / (arr + 1)) * 100;
  const fe = Math.abs(f - sol.freq) / sol.freq;
  const de = Math.abs(d - sol.duty);
  if (fe > 0.01) return { ok: false, msg: `頻率 ${f.toFixed(2)} Hz 偏差 ${(fe * 100).toFixed(2)}%（需 ≤ 1%）` };
  if (de > 1) return { ok: false, msg: `Duty ${d.toFixed(2)}% 偏差太大（需 ±1%）` };
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* UART boot log: find the baud rate, then diagnose                    */
/* ------------------------------------------------------------------ */

const BAUDS = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

const UART_FAULTS = [
  () => {
    const addrs = shuffle(['0x1E', '0x29', '0x48', '0x68', '0x76', '0x50']);
    const bad = addrs[0];
    return {
      lines: [
        `[  0.120] i2c1: bus @ 400 kHz`,
        `[  0.131] i2c1: probe ${addrs[1]} ... ACK`,
        `[  0.140] i2c1: probe ${bad} ... NACK`,
        `[  0.142] sensor: init failed (err=-6)`,
        `[  0.150] i2c1: probe ${addrs[2]} ... ACK`,
      ],
      q: '哪個 I2C 位址沒有回應？',
      options: addrs.slice(0, 4),
      answer: bad,
    };
  },
  () => {
    const tasks = shuffle(['net_task', 'ui_task', 'log_task', 'ota_task', 'sensor_task']);
    const bad = tasks[0];
    return {
      lines: [
        `[  0.510] rtos: start scheduler`,
        `[  0.533] ${tasks[1]}: running (stack 512/1024)`,
        `[  0.541] ${tasks[2]}: running (stack 300/768)`,
        `[  0.902] !!! STACK OVERFLOW in task "${bad}"`,
        `[  0.903] HardFault: PC=0x08004A1C LR=0xFFFFFFF9`,
      ],
      q: '哪個 task 堆疊溢位？',
      options: tasks.slice(0, 4),
      answer: bad,
    };
  },
  () => {
    const sectors = shuffle(['3', '5', '6', '7', '9']);
    const bad = sectors[0];
    return {
      lines: [
        `[  0.050] boot: bootloader v2.3.1`,
        `[  0.061] boot: check image A ... CRC OK`,
        `[  0.070] boot: check image B @ sector ${bad} ... CRC MISMATCH`,
        `[  0.071] boot: expected 0x5A3C91E2 got 0x00000000`,
        `[  0.080] boot: fallback to image A`,
      ],
      q: '哪個 Flash sector 的映像檔 CRC 錯誤？',
      options: sectors.slice(0, 4).map((s) => `Sector ${s}`),
      answer: `Sector ${bad}`,
    };
  },
  () => {
    return {
      lines: [
        `[  0.010] pmic: VDD_CORE 1.20 V OK`,
        `[  0.012] pmic: VDD_IO   3.30 V OK`,
        `[  0.014] pmic: VDD_ANA  2.71 V LOW (min 3.00)`,
        `[  0.020] adc: reference unstable, disabling`,
        `[  0.022] warn: running in degraded mode`,
      ],
      q: '哪一路電源電壓過低？',
      options: ['VDD_CORE', 'VDD_IO', 'VDD_ANA', 'VBAT'],
      answer: 'VDD_ANA',
    };
  },
];

function genUart() {
  const baud = pick(BAUDS);
  const fault = pick(UART_FAULTS)();
  const header = [
    `RDSIM-BOOT ROM rev.${randInt(1, 9)}`,
    `[  0.000] cpu: Cortex-M4F @ ${pick([84, 100, 168, 180])} MHz`,
    `[  0.002] mem: SRAM 192 KB, Flash 1024 KB`,
  ];
  return {
    title: `裝置開機失敗，序列埠沒有 log`,
    pub: {
      bauds: BAUDS,
      lines: [...header, ...fault.lines],
      q: fault.q,
      options: shuffle(fault.options),
      seed: randInt(1, 1e9),
      trueBaud: baud, // The client needs it to render "correct" vs garbled output.
    },
    solution: { baud, answer: fault.answer },
  };
}

/* ------------------------------------------------------------------ */
/* Firmware flashing: pick the right image and follow the procedure     */
/* ------------------------------------------------------------------ */

const PRODUCTS = ['sensorhub', 'motorctl', 'gateway', 'bms', 'wearable'];
const MCUS = [
  { part: 'STM32F407VG', short: 'f407' },
  { part: 'STM32F405RG', short: 'f405' },
  { part: 'STM32L476RG', short: 'l476' },
  { part: 'STM32G431KB', short: 'g431' },
];

function genFlash() {
  const product = pick(PRODUCTS);
  const rev = pick(['B', 'C', 'D']);
  const mcu = pick(MCUS);
  const bl = pick([1, 2]);
  const ver = `${randInt(1, 3)}.${randInt(0, 9)}.${randInt(0, 20)}`;
  const correct = `${product}_rev${rev}_${mcu.short}_bl${bl}_v${ver}.hex`;
  const otherRev = pick(['A', 'B', 'C', 'D'].filter((r) => r !== rev));
  const otherMcu = pick(MCUS.filter((m) => m !== mcu));
  const decoys = [
    `${product}_rev${otherRev}_${mcu.short}_bl${bl}_v${ver}.hex`,
    `${product}_rev${rev}_${otherMcu.short}_bl${bl}_v${ver}.hex`,
    `${product}_rev${rev}_${mcu.short}_bl${3 - bl}_v${ver}.hex`,
    `${product}_rev${rev}_${mcu.short}_bl${bl}_v${ver}-debug.elf`,
  ];
  const files = shuffle([correct, ...decoys]);
  const steps = ['connect', 'erase', 'program', 'verify', 'reset'];
  return {
    title: `燒錄 ${product.toUpperCase()} Rev.${rev} 新韌體`,
    pub: {
      board: { product: product.toUpperCase(), rev, mcu: mcu.part, bl, ver },
      files,
      steps: shuffle(steps),
      hint: '選對映像檔（.hex，正確 Rev/MCU/Bootloader），並依正確流程操作',
    },
    solution: { file: correct, steps },
  };
}

/* ------------------------------------------------------------------ */

export const GENERATORS = {
  codefix: genCodefix,
  register: genRegister,
  pwm: genPwm,
  uart: genUart,
  flash: genFlash,
};

export function checkAnswer(type, sol, ans) {
  switch (type) {
    case 'codefix':
      return [].concat(sol.line).includes(Number(ans?.line))
        ? { ok: true, msg: sol.why }
        : { ok: false, msg: '這一行看起來沒問題，再找找看。' };
    case 'register':
      return (Number(ans?.value) >>> 0) === sol.value
        ? { ok: true }
        : {
            ok: false,
            msg: `寫入 0x${(Number(ans?.value) >>> 0).toString(16).toUpperCase().padStart(4, '0')} 後周邊行為不符合規格`,
          };
    case 'pwm':
      return checkPwm(sol, ans);
    case 'uart':
      if (Number(ans?.baud) !== sol.baud) return { ok: false, msg: 'Baud rate 不對，log 是亂碼' };
      if (ans?.answer !== sol.answer) return { ok: false, msg: '診斷錯誤，再仔細看 log' };
      return { ok: true };
    case 'flash': {
      if (ans?.file !== sol.file) return { ok: false, msg: '映像檔不相容！板子變磚了（還好可以重來）' };
      const s = Array.isArray(ans?.steps) ? ans.steps : [];
      if (s.join(',') !== sol.steps.join(',')) return { ok: false, msg: '燒錄流程順序錯誤' };
      return { ok: true };
    }
    default:
      return { ok: false, msg: 'unknown task' };
  }
}
