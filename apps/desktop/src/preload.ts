import { contextBridge, ipcRenderer } from 'electron';
import type { AppEvent, Bridge, RpcMethod, RpcInputs, RpcOutputs } from '@ba/contracts';
const bridge: Bridge = {
  setWindowTheme:
    process.platform === 'win32'
      ? (mode) => ipcRenderer.invoke('ba:window:theme', mode)
      : undefined,
  invoke: <K extends RpcMethod>(method: K, input: RpcInputs[K]) =>
    ipcRenderer.invoke('ba:rpc', method, input) as Promise<RpcOutputs[K]>,
  subscribe: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, event: AppEvent) => callback(event);
    ipcRenderer.on('ba:event', listener);
    return () => ipcRenderer.removeListener('ba:event', listener);
  },
};
contextBridge.exposeInMainWorld('assistant', bridge);
