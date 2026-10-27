import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  net,
  Notification,
  protocol,
} from 'electron';
import { existsSync } from 'node:fs';
import electronUpdater from 'electron-updater';
import { join, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { Application, type Platform } from '@ba/server';
import { rpcSchemas, windowThemeColorsSchema, type RpcMethod } from '@ba/contracts';
import { errorMessage } from '@ba/shared';
import { RecordingController } from './recordings/controller';
import { ReplayProtocol } from './recordings/protocol';
import { selectDirectory, detectLogDirectory, openPath } from './directories';
import { UpdateController } from './updates/controller';
import { readInstallRecord, writeInstallRecord } from './updates/install-record';
import { sampleAnalyticsRuntime } from './analytics-runtime';
// Temporary workaround for BATrace QUIC/HTTP/3 stalls; revisit after Chromium/network fixes.
// See docs/architecture.md#temporary-quic-workaround for removal criteria.
app.commandLine.appendSwitch('disable-quic');
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
  replays: ReplayProtocol | null = null,
  updates: UpdateController | null = null,
  quitting = false;
process.on('uncaughtExceptionMonitor', (error) => service?.reportError('main', error));
const smoke = process.env.BA_SMOKE === '1';
const offline = process.env.BA_OFFLINE === '1';
const allowedDevUrl = process.env.BA_RENDERER_URL || '';
// Fallback colors until the renderer supplies the active palette.
const windowColors = {
  light: { color: '#ffffff', symbolColor: '#262626' },
  dark: { color: '#0a0a0a', symbolColor: '#fafafa' },
};
function canInstallUpdate(): boolean {
  const match = service?.parser.snapshot().current;
  return (
    !quitting &&
    !(match && !match.endedAt) &&
    !['starting', 'recording', 'stopping'].includes(recordings?.status().phase ?? 'idle')
  );
}
async function start(): Promise<void> {
  const root = resolve(__dirname, '../../..'),
    userDir = app.getPath('userData');
  await mkdir(userDir, { recursive: true });
  const emit = (event: Parameters<Application['event']>[0]) => service?.event(event);
  const updateMode =
    !smoke &&
    !offline &&
    !allowedDevUrl &&
    app.isPackaged &&
    process.platform === 'win32' &&
    process.env.BA_DISABLE_AUTO_UPDATE !== '1' &&
    existsSync(join(process.resourcesPath, 'app-update.yml'))
      ? process.env.PORTABLE_EXECUTABLE_FILE
        ? 'portable'
        : 'installed'
      : 'disabled';
  const installRecord = join(userDir, 'update-install.json');
  updates = new UpdateController({
    version: app.getVersion(),
    mode: updateMode,
    engine: updateMode === 'disabled' ? null : electronUpdater.autoUpdater,
    notAppliedVersion: smoke ? null : await readInstallRecord(installRecord, app.getVersion()),
    emit: (state) => emit({ type: 'updates', updates: state }),
    canInstall: canInstallUpdate,
    prepareInstall: async (targetVersion) => {
      await writeInstallRecord(installRecord, app.getVersion(), targetVersion);
      if (!canInstallUpdate())
        throw new Error('A match or recording started. Install after it finishes.');
      quitting = true;
      await service?.stop();
      await recordings?.abort();
      replays?.close();
      // Keep the app alive until electron-updater starts NSIS and calls quit.
    },
    installFailed: (error) => {
      if (!quitting) return; // Preparation failed before closing the service; retry in the UI.
      dialog.showErrorBox(
        '更新安装失败 / Update failed',
        error + '\n应用将重新启动 / The app will restart.',
      );
      app.relaunch();
      app.exit(1);
    },
  });
  replays = new ReplayProtocol();
  replays.register();
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
  const nativeRecordings = recordings;
  const platform: Platform = {
    analytics: {
      enabled:
        app.isPackaged &&
        !smoke &&
        !offline &&
        !allowedDevUrl &&
        process.env.BA_DISABLE_ANALYTICS !== '1',
      distribution: process.env.PORTABLE_EXECUTABLE_FILE ? 'portable' : 'installed',
      sampleRuntime: () => sampleAnalyticsRuntime(window),
    },
    updates,
    version: app.getVersion(),
    http: {
      offline,
      fetch: offline
        ? async () => {
            throw new Error('Network disabled in offline real-data mode');
          }
        : smoke
          ? async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } })
          : (url, init) => net.fetch(url instanceof URL ? url.toString() : url, init),
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
  };
  service = new Application(
    userDir,
    platform,
    (event) => {
      if (window && !window.isDestroyed()) window.webContents.send('ba:event', event);
    },
    !smoke && !offline,
  );
  await service.start();
  if (smoke && offline) await service.invoke('matches.scan', null);
  const themeMode = service.db.config().themeMode;
  const windowMode =
    themeMode === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : themeMode;
  window = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: '断箭蛐工具',
    autoHideMenuBar: true,
    ...(process.platform === 'win32'
      ? {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: {
            color: '#00000000',
            symbolColor: windowColors[windowMode].symbolColor,
            height: 48,
          },
        }
      : {}),
    backgroundColor: windowColors[windowMode].color,
    icon: join(root, 'build/icon.png'),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.once('ready-to-show', () => {
    if (!smoke) window?.show();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('render-process-gone', (_event, details) => {
    service?.reportError('renderer_crash', new Error());
    console.error('Renderer stopped:', details.reason);
  });
  const sampleResources = () => service?.sampleResources();
  window.on('focus', sampleResources);
  window.on('restore', sampleResources);
  window.on('show', sampleResources);
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
  updates.start();
  if (smoke) {
    const result = await window.webContents.executeJavaScript(
      `new Promise((resolve,reject)=>{let attempts=0;const timer=setInterval(()=>{if(document.querySelector('[data-ready="true"]')){clearInterval(timer);resolve({title:document.title,buttons:document.querySelectorAll('button').length,hasBridge:typeof window.assistant?.invoke==='function'});}else if(++attempts>100){clearInterval(timer);reject(new Error(document.body.innerText||'Renderer did not initialize'));}},100);})`,
    );
    if (process.platform === 'win32') {
      await window.webContents.executeJavaScript(`(async () => {
        const waitFor = async (find) => {
          const deadline = Date.now() + 10000;
          while (Date.now() < deadline) {
            const element = find();
            if (element) return element;
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          throw new Error('Window chrome smoke dialog did not initialize');
        };
        document.querySelector('.app-dialog .dialog-footer button')?.click();
        await waitFor(() => !document.querySelector('.app-dialog'));
        document.querySelector('.nav-item[aria-label="对局录像"], .nav-item[aria-label="Recordings"]').click();
        const settings = await waitFor(() => Array.from(document.querySelectorAll('button'))
          .find(button => ['录像设置', 'Recording settings'].includes(button.textContent.trim())));
        settings.click();
        const dialog = await waitFor(() => document.querySelector('.recording-settings-dialog'));
        // Exercise the shared dialog layout with content as wide and tall as match details.
        dialog.style.width = 'calc(100% - 3rem)';
        dialog.style.maxWidth = 'none';
        dialog.style.height = '100svh';
      })()`);
      const inspectChrome = `(async () => {
        const toolbar = document.querySelector('.topbar');
        const workspace = document.querySelector('.workspace');
        const actions = document.querySelector('.topbar-actions');
        const overlay = navigator.windowControlsOverlay;
        const theme = document.documentElement.dataset.mode;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d');
        const toHex = (color) => {
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          return '#' + Array.from(context.getImageData(0, 0, 1, 1).data)
            .slice(0, 3).map(channel => channel.toString(16).padStart(2, '0')).join('');
        };
        const style = getComputedStyle(document.body);
        const colors = { background: toHex(style.backgroundColor), foreground: toHex(style.color) };
        await window.assistant.setWindowTheme('light');
        await window.assistant.setWindowTheme('dark');
        await window.assistant.setWindowTheme(theme, colors);
        await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        // Measure native and DOM geometry together after theme changes and layout settle.
        const area = overlay?.getTitlebarAreaRect();
        const bounds = workspace.getBoundingClientRect();
        const toolbarBounds = toolbar.getBoundingClientRect();
        const actionsBounds = actions.getBoundingClientRect();
        const toolbarStyle = getComputedStyle(toolbar);
        const separatorWidth = parseFloat(toolbarStyle.borderBottomWidth);
        const dialog = document.querySelector('.recording-settings-dialog');
        const dialogBounds = dialog.getBoundingClientRect();
        const backdrop = document.querySelector('[data-slot="dialog-overlay"]');
        const backdropBounds = backdrop.getBoundingClientRect();
        const headerTarget = document.elementFromPoint(
          toolbarBounds.left + 8, toolbarBounds.top + toolbarBounds.height / 2);
        const close = dialog.querySelector('[data-slot="dialog-close"]');
        const closeBounds = close.getBoundingClientRect();
        const closeTarget = document.elementFromPoint(
          closeBounds.x + closeBounds.width / 2, closeBounds.y + closeBounds.height / 2);
        return {
          backgroundColor: colors.background,
          geometry: {
            bounds: bounds.toJSON(), toolbar: toolbarBounds.toJSON(),
            actions: actionsBounds.toJSON(), titlebar: area?.toJSON(),
            dialog: dialogBounds.toJSON(), close: closeBounds.toJSON(),
            backdrop: backdropBounds.toJSON(),
            paddingRight: toolbarStyle.paddingRight,
            viewport: { width: innerWidth, height: innerHeight, scale: devicePixelRatio },
          },
          overlay: overlay?.visible === true,
          integrated: toolbarBounds.top === 0,
          separatorVisible: separatorWidth > 0 &&
            toolbarBounds.bottom - separatorWidth >= area?.bottom,
          draggable: toolbarStyle.webkitAppRegion === 'drag',
          interactive: getComputedStyle(actions).webkitAppRegion === 'no-drag',
          controlsReserved: area?.width > 0 &&
            actionsBounds.right < area.right,
          compact: area?.height <= 48 && toolbarBounds.height <= 50,
          dialogBelowControls: dialogBounds.top >= area?.bottom &&
            dialogBounds.bottom <= innerHeight,
          backdropCoversHeader: Math.abs(backdropBounds.top) < 1 &&
            Math.abs(backdropBounds.left) < 1 &&
            Math.abs(backdropBounds.right - innerWidth) < 1 &&
            Math.abs(backdropBounds.bottom - innerHeight) < 1 &&
            getComputedStyle(backdrop).backdropFilter !== 'none' && backdrop.contains(headerTarget),
          dialogCloseAccessible: closeBounds.top >= area?.bottom &&
            closeBounds.bottom <= dialogBounds.bottom && close.contains(closeTarget),
          // Native viewport dimensions round to integers at fractional display scales.
          flush: Math.abs(bounds?.top) < 1 && Math.abs(bounds?.right - innerWidth) < 1 &&
            Math.abs(bounds?.bottom - innerHeight) < 1,
        };
      })()`;
      const sizes = [window.getSize(), window.getMinimumSize()];
      const failures = [];
      for (const [width, height] of sizes) {
        window.setSize(width!, height!);
        const { backgroundColor, geometry, ...checks } =
          await window.webContents.executeJavaScript(inspectChrome);
        checks.paletteSynced = window.getBackgroundColor().toLowerCase() === backgroundColor;
        if (Object.values(checks).some((passed) => passed !== true))
          failures.push({ ...geometry, checks });
        result.windowChrome = Object.fromEntries(
          Object.entries(checks).map(([key, passed]) => [
            key,
            passed === true && result.windowChrome?.[key] !== false,
          ]),
        );
      }
      if (failures.length) result.windowGeometry = failures;
    }
    if (offline)
      result.matches = await window.webContents.executeJavaScript(
        "window.assistant.invoke('matches.list', {}).then(matches => matches.length)",
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
ipcMain.handle('ba:window:theme', (event, mode: unknown, input: unknown) => {
  if (!window || event.sender !== window.webContents) throw new Error('Untrusted IPC sender');
  if (mode !== 'light' && mode !== 'dark') throw new Error('Invalid window theme');
  const colors = input === undefined ? undefined : windowThemeColorsSchema.parse(input);
  const palette = colors
    ? { color: colors.background, symbolColor: colors.foreground }
    : windowColors[mode];
  if (process.platform === 'win32')
    window.setTitleBarOverlay({ color: '#00000000', symbolColor: palette.symbolColor });
  window.setBackgroundColor(palette.color);
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
    updates?.dispose();
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
    service?.reportError('startup', error);
    console.error(errorMessage(error));
    app.exit(1);
  });
