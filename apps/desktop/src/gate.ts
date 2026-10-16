import { BrowserWindow, net } from 'electron';
import { BATRACE_ORIGIN } from '@ba/contracts';
import { isChallenge } from '@ba/server';
export class VerificationGate {
  private pending: Promise<void> | null = null;
  private window: BrowserWindow | null = null;
  private lastAttempt = 0;
  constructor(private changed: (state: 'open' | 'done' | 'cancelled') => void) {}
  open(): Promise<void> {
    if (this.pending) return this.pending;
    if (Date.now() - this.lastAttempt < 60000)
      return Promise.reject(new Error('Verification cooldown; try again in a minute'));
    this.lastAttempt = Date.now();
    this.pending = new Promise<void>((resolve, reject) => {
      const win = new BrowserWindow({
        width: 900,
        height: 700,
        title: 'BATrace verification',
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
      this.window = win;
      this.changed('open');
      let complete = false,
        busy = false;
      const finish = (error?: Error) => {
        if (complete) return;
        complete = true;
        clearInterval(timer);
        clearTimeout(deadline);
        this.window = null;
        if (!win.isDestroyed()) win.destroy();
        this.changed(error ? 'cancelled' : 'done');
        error ? reject(error) : resolve();
      };
      const probe = async () => {
        if (busy || complete) return;
        busy = true;
        try {
          const res = await net.fetch(`${BATRACE_ORIGIN}/api/players/search?q=test&limit=1`, {
              signal: AbortSignal.timeout(8000),
            }),
            raw = await res.text();
          if (res.ok && !isChallenge(raw)) {
            JSON.parse(raw);
            finish();
          }
        } catch {
          /* Waiting for the verification page to establish its cookie. */
        } finally {
          busy = false;
        }
      };
      const timer = setInterval(() => void probe(), 2000),
        deadline = setTimeout(() => finish(new Error('Verification timed out')), 300000);
      win.on('closed', () => finish(new Error('Verification cancelled')));
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', (event, url) => {
        if (
          !url.startsWith(BATRACE_ORIGIN + '/') &&
          !url.startsWith('https://turing.captcha.qcloud.com/')
        )
          event.preventDefault();
      });
      void win.loadURL(BATRACE_ORIGIN + '/').catch((error) => finish(error));
    }).finally(() => (this.pending = null));
    return this.pending;
  }
  close(): void {
    this.window?.close();
    this.window = null;
  }
}
