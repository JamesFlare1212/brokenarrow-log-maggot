import { contextBridge, ipcRenderer } from 'electron';
import type { AppEvent, Bridge, RpcMethod, RpcInputs, RpcOutputs } from '@ba/contracts';
const bridge: Bridge = {
  invoke: <K extends RpcMethod>(method: K, input: RpcInputs[K]) =>
    ipcRenderer.invoke('ba:rpc', method, input) as Promise<RpcOutputs[K]>,
  subscribe: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, event: AppEvent) => callback(event);
    ipcRenderer.on('ba:event', listener);
    return () => ipcRenderer.removeListener('ba:event', listener);
  },
};
contextBridge.exposeInMainWorld('assistant', bridge);
