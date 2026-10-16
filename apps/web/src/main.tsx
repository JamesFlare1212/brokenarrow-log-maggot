import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { config as fontAwesomeConfig } from '@fortawesome/fontawesome-svg-core';
import '@fortawesome/fontawesome-svg-core/styles.css';
import type { Bridge } from '@ba/contracts';
import { App } from './app/App';
import { AppProvider } from './app/state';
import './styles/index.css';

fontAwesomeConfig.autoAddCss = false;
declare global {
  interface Window {
    assistant?: Bridge;
  }
}
const native = window.assistant,
  fixtures = import.meta.env.DEV && import.meta.env.MODE === 'fixtures';
const root = createRoot(document.getElementById('root')!);
if (!native && !fixtures)
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
  else void import('./dev/bridge').then((module) => render(module.createFixtureBridge()));
}
