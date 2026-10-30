import { contextBridge, ipcRenderer } from 'electron';
import type { RecorderBridge, RecorderConfig } from '@ba/contracts';
const bridge: RecorderBridge = {
  config: () => ipcRenderer.invoke('ba:recording:config') as Promise<RecorderConfig>,
  started: (id, hasAudio, audio) => ipcRenderer.invoke('ba:recording:started', id, hasAudio, audio),
  audio: (id, audio, retryId) => ipcRenderer.invoke('ba:recording:audio', id, audio, retryId),
  retryAudio: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, id: string) => callback(id);
    ipcRenderer.on('ba:recording:retry-audio', listener);
    return () => ipcRenderer.removeListener('ba:recording:retry-audio', listener);
  },
  chunk: (id, sequence, data) => ipcRenderer.invoke('ba:recording:chunk', id, sequence, data),
  finish: (id, duration, hasAudio, audio) =>
    ipcRenderer.invoke('ba:recording:finish', id, duration, hasAudio, audio),
  failure: (id, error) => ipcRenderer.invoke('ba:recording:failure', id, error),
  preview: (id, dataUrl, hasAudio, audio) =>
    ipcRenderer.send('ba:recording:preview', id, dataUrl, hasAudio, audio),
  stop: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, discard: boolean) => callback(discard);
    ipcRenderer.on('ba:recording:stop', listener);
    return () => ipcRenderer.removeListener('ba:recording:stop', listener);
  },
};
contextBridge.exposeInMainWorld('recorder', bridge);
