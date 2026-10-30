import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Bridge } from '@ba/contracts';
import { App } from './app/App';
import { AppProvider } from './app/state';
import { attachRendererDiagnostics, reportRendererError } from './app/diagnostics';
import { StartupBridgeError } from './components/StartupBridgeError';
import './styles/index.css';

declare global {
  interface Window {
    assistant?: Bridge;
  }
}
const native = window.assistant,
  fixtures = import.meta.env.DEV && import.meta.env.MODE === 'fixtures';
if (native) attachRendererDiagnostics(native);
const root = createRoot(
  document.getElementById('root')!,
  native
    ? {
        onUncaughtError: (error) => {
          reportRendererError(native, error, 'react');
          console.error(error);
        },
        onRecoverableError: (error) => {
          reportRendererError(native, error, 'react');
          console.error(error);
        },
      }
    : undefined,
);
if (!native && !fixtures) {
  const locale = navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  root.render(<StartupBridgeError locale={locale} />);
} else {
  const render = (api: Bridge) =>
    root.render(
      <StrictMode>
        <AppProvider api={api}>
          <App />
        </AppProvider>
      </StrictMode>,
    );
  if (native) render(native);
  else if (fixtures)
    void Promise.all([import('./dev/bridge'), import('./dev/DevelopmentApp')]).then(
      ([bridge, module]) =>
        root.render(
          <StrictMode>
            <module.DevelopmentApp api={bridge.createFixtureBridge()} />
          </StrictMode>,
        ),
    );
}
