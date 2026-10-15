import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Bridge } from '@ba/contracts';
import { App } from './app/App';
import { AppProvider } from './app/state';
import './styles/index.css';
declare global {
  interface Window {
    assistant?: Bridge;
  }
}
const native = window.assistant,
  demo = new URLSearchParams(location.search).has('demo');
const root = createRoot(document.getElementById('root')!);
if (!native && !demo)
  root.render(
    <div className="startup-error">
      请通过桌面应用启动 / Open the desktop application to access local game data.
    </div>,
  );
else {
  const render = (api: Bridge) =>
    root.render(
      <StrictMode>
        <AppProvider api={api}>
          <App />
        </AppProvider>
      </StrictMode>,
    );
  if (native) render(native);
  else void import('./demo/bridge').then((module) => render(module.createDemoBridge()));
}
