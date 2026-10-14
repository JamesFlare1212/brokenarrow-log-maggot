import { app, BrowserWindow, ipcMain, net, Notification, protocol } from 'electron';
import { join, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { Application, type Platform } from '@ba/server';
import { rpcSchemas, type RpcMethod } from '@ba/contracts';
import { errorMessage } from '@ba/shared';
import { RecordingController } from './recordings/controller';
import { ReplayProtocol } from './recordings/protocol';
import { ApmController } from './apm';
import { VerificationGate } from './gate';
import { selectDirectory, detectLogDirectory, openPath } from './directories';
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ba-replay',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);
if (process.env.BA_USER_DATA) app.setPath('userData', resolve(process.env.BA_USER_DATA));
let window: BrowserWindow | null = null,
  service: Application | null = null,
  recordings: RecordingController | null = null,
  gate: VerificationGate | null = null,
  replays: ReplayProtocol | null = null,
  quitting = false;
const smoke = process.env.BA_SMOKE === '1';
const allowedDevUrl = process.env.BA_RENDERER_URL || '';
async function start(): Promise<void> {
  const root = resolve(__dirname, '../../..'),
    userDir = app.getPath('userData');
  await mkdir(userDir, { recursive: true });
  const emit = (event: Parameters<Application['event']>[0]) => service?.event(event);
  replays = new ReplayProtocol();
  replays.register();
  gate = new VerificationGate((state) => emit({ type: 'gate', state }));
  recordings = new RecordingController(
    join(__dirname, 'recorder-preload.cjs'),
    join(root, 'apps/web/dist/recorder.html'),
    () => service?.files.dir() || join(userDir, 'replays'),
    (recording) => emit({ type: 'recording', recording }),
    (name, duration, match) => {
      service?.db.setState('replay:' + name, { duration, map: match.map, fid: match.fid });
      emit({ type: 'replays' });
    },
    (sessionId, dataUrl, hasAudio) => emit({ type: 'preview', sessionId, dataUrl, hasAudio }),
  );
  const nativeRecordings = recordings,
    apm = new ApmController();
  const platform: Platform = {
    version: app.getVersion(),
    http: {
      fetch: smoke
        ? async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } })
        : (url, init) => net.fetch(url instanceof URL ? url.toString() : url, init),
      challenge: () => gate?.open() || Promise.reject(new Error('Verification unavailable')),
    },
    selectDirectory,
    detectLogDirectory,
    openPath: async (path) => {
      await mkdir(path, { recursive: true });
      await openPath(path);
    },
    openExternal: async (url) => {
      await import('electron').then((e) => e.shell.openExternal(url));
    },
    notify: (title, body) => {
      if (!smoke && Notification.isSupported()) new Notification({ title, body }).show();
    },
    recordings: {
      status: () => nativeRecordings.status(),
      start: (match, config, test) => nativeRecordings.start(match, config, test),
      stop: (match) => nativeRecordings.stop(match),
      abort: () => nativeRecordings.abort(),
      displays: () => nativeRecordings.displays(),
      thumbnail: (id) => nativeRecordings.thumbnail(id),
      playback: async (path) => replays?.url(path) || '',
    },
    apm,
  };
  service = new Application(
    userDir,
    platform,
    (event) => {
      if (window && !window.isDestroyed()) window.webContents.send('ba:event', event);
    },
    !smoke,
  );
  await service.start();
  window = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 900,
    minHeight: 600,
    show: !smoke,
    title: '断箭蛆工具 byZola',
    autoHideMenuBar: true,
    backgroundColor: '#111827',
    icon: join(root, 'build/icon.png'),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('Renderer stopped:', details.reason);
  });
  window.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      void shutdown();
    }
  });
  const loaded = allowedDevUrl
    ? window.loadURL(allowedDevUrl)
    : window.loadFile(join(root, 'apps/web/dist/index.html'));
  await loaded;
  if (smoke) {
    const result = await window.webContents.executeJavaScript(
      `new Promise((resolve,reject)=>{let attempts=0;const timer=setInterval(()=>{if(document.querySelector('[data-ready="true"]')){clearInterval(timer);resolve({title:document.title,buttons:document.querySelectorAll('button').length,hasBridge:typeof window.assistant?.invoke==='function'});}else if(++attempts>100){clearInterval(timer);reject(new Error(document.body.innerText||'Renderer did not initialize'));}},100);})`,
    );
    console.log('SMOKE_RESULT', JSON.stringify(result));
    await shutdown();
  }
}
ipcMain.handle('ba:rpc', async (event, method: unknown, input: unknown) => {
  if (!window || event.sender !== window.webContents) throw new Error('Untrusted IPC sender');
  if (typeof method !== 'string' || !Object.prototype.hasOwnProperty.call(rpcSchemas, method))
    throw new Error('Unknown RPC method');
  if (!service) throw new Error('Application not ready');
  return service.invoke(method as RpcMethod, input);
});
ipcMain.handle('ba:recording:config', (event) => recordings?.config(event.sender.id));
ipcMain.handle('ba:recording:started', (event, id: string, audio: boolean) =>
  recordings?.ready(event.sender.id, id, audio),
);
ipcMain.handle('ba:recording:chunk', (event, id: string, sequence: number, data: ArrayBuffer) =>
  recordings?.chunk(event.sender.id, id, sequence, data),
);
ipcMain.handle('ba:recording:finish', (event, id: string, duration: number, audio: boolean) =>
  recordings?.finish(event.sender.id, id, duration, audio),
);
ipcMain.handle('ba:recording:failure', (event, id: string, error: string) =>
  recordings?.failure(event.sender.id, id, error),
);
ipcMain.on('ba:recording:preview', (event, id: string, dataUrl: string, audio: boolean) => {
  try {
    recordings?.preview(event.sender.id, id, dataUrl, audio);
  } catch {
    /* Discard previews from a destroyed recording session. */
  }
});
async function shutdown(): Promise<void> {
  if (quitting) return;
  quitting = true;
  try {
    gate?.close();
    await service?.stop();
    await recordings?.abort();
    replays?.close();
    if (window && !window.isDestroyed()) window.destroy();
    app.exit(0);
  } catch (error) {
    console.error(errorMessage(error));
    app.exit(1);
  }
}
app.on('before-quit', (event) => {
  if (!quitting) {
    event.preventDefault();
    void shutdown();
  }
});
app.on('window-all-closed', () => {
  if (!quitting) void shutdown();
});
void app
  .whenReady()
  .then(start)
  .catch((error) => {
    console.error(errorMessage(error));
    app.exit(1);
  });
