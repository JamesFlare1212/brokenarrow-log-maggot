import { contextBridge, ipcRenderer } from 'electron';
import type { RecorderBridge, RecorderConfig } from '@ba/contracts';
const bridge: RecorderBridge = {
  config: () => ipcRenderer.invoke('ba:recording:config') as Promise<RecorderConfig>,
  started: (id, hasAudio) => ipcRenderer.invoke('ba:recording:started', id, hasAudio),
  chunk: (id, sequence, data) => ipcRenderer.invoke('ba:recording:chunk', id, sequence, data),
  finish: (id, duration, hasAudio) =>
    ipcRenderer.invoke('ba:recording:finish', id, duration, hasAudio),
  failure: (id, error) => ipcRenderer.invoke('ba:recording:failure', id, error),
  preview: (id, dataUrl, hasAudio) =>
    ipcRenderer.send('ba:recording:preview', id, dataUrl, hasAudio),
  stop: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, discard: boolean) => callback(discard);
    ipcRenderer.on('ba:recording:stop', listener);
    return () => ipcRenderer.removeListener('ba:recording:stop', listener);
  },
};
contextBridge.exposeInMainWorld('recorder', bridge);
