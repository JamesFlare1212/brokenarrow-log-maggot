// @vitest-environment jsdom
import type { ReactElement } from 'react';
import type { Bridge } from '@ba/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { render, createFixtureBridge } = vi.hoisted(() => ({
  render: vi.fn(),
  createFixtureBridge: vi.fn(),
}));

vi.mock('react-dom/client', () => ({ createRoot: () => ({ render }) }));
vi.mock('../apps/web/src/app/App', () => ({ App: () => null }));
vi.mock('../apps/web/src/app/state', () => ({ AppProvider: () => null }));
vi.mock('../apps/web/src/dev/bridge', () => ({ createFixtureBridge }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="root"></div>';
  window.history.replaceState(null, '', '/?demo');
});

afterEach(() => {
  delete window.assistant;
  vi.unstubAllEnvs();
  window.history.replaceState(null, '', '/');
});

function renderedBridge() {
  const tree = render.mock.calls[0]![0] as ReactElement<{
    children: ReactElement<{ api: Bridge }>;
  }>;
  return tree.props.children.props.api;
}

describe('application startup with the removed demo query', () => {
  it.each(['development', 'production'])('requires the desktop bridge in %s', async (mode) => {
    vi.stubEnv('MODE', mode);
    vi.stubEnv('DEV', mode === 'development');

    await import('../apps/web/src/main');
    const { StartupBridgeError } = await import('../apps/web/src/components/StartupBridgeError');

    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({
        type: StartupBridgeError,
        props: expect.objectContaining({ locale: 'en' }),
      }),
    );
    expect(createFixtureBridge).not.toHaveBeenCalled();
  });

  it('uses real fixtures in browser fixture mode even with ?demo', async () => {
    vi.stubEnv('MODE', 'fixtures');
    vi.stubEnv('DEV', true);
    const api = { invoke: vi.fn(), subscribe: vi.fn() } as Bridge;
    createFixtureBridge.mockReturnValue(api);

    await import('../apps/web/src/main');
    await vi.dynamicImportSettled();

    expect(createFixtureBridge).toHaveBeenCalledOnce();
    expect(renderedBridge()).toBe(api);
  });

  it('uses the native bridge when available', async () => {
    vi.stubEnv('MODE', 'development');
    vi.stubEnv('DEV', true);
    const api = { invoke: vi.fn(), subscribe: vi.fn() } as Bridge;
    window.assistant = api;

    await import('../apps/web/src/main');

    expect(renderedBridge()).toBe(api);
    expect(createFixtureBridge).not.toHaveBeenCalled();
  });
});
