// Thin WebSocket client with a typed message dispatcher.
export class Net {
  constructor() {
    this.handlers = {};
    this.ws = null;
    this.open = false;
  }
  on(type, fn) {
    (this.handlers[type] ||= []).push(fn);
    return this;
  }
  emit(type, msg) {
    for (const fn of this.handlers[type] || []) fn(msg);
  }
  connect() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      this.ws = ws;
      ws.onopen = () => {
        this.open = true;
        resolve();
      };
      ws.onerror = () => reject(new Error('無法連線到伺服器'));
      ws.onclose = () => {
        const was = this.open;
        this.open = false;
        if (was) this.emit('disconnect', {});
      };
      ws.onmessage = (ev) => {
        let m;
        try {
          m = JSON.parse(ev.data);
        } catch {
          return;
        }
        this.emit(m.t, m);
      };
    });
  }
  send(msg) {
    if (this.open && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }
}
