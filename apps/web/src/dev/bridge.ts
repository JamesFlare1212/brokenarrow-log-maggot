import {
  assertBrowserFixtureRequest,
  BATRACE_ORIGIN,
  rpcSchemas,
  type AppEvent,
  type Bridge,
} from '@ba/contracts';

export function createFixtureBridge(): Bridge {
  return {
    async invoke(method, input) {
      if (method === 'external.open') {
        const { url } = rpcSchemas['external.open'].parse(input);
        if (
          new URL(url).origin === BATRACE_ORIGIN ||
          url === 'https://github.com/JamesFlare1212/brokenarrow-log-maggot'
        ) {
          window.open(url, '_blank', 'noopener,noreferrer');
          return null;
        }
      }
      assertBrowserFixtureRequest(method, input);
      const response = await fetch('/__fixtures/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, input }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Fixture request failed');
      return result.value;
    },
    subscribe(callback) {
      const handle = (event: AppEvent) => callback(event);
      import.meta.hot!.on('ba:fixture-event', handle);
      return () => import.meta.hot!.off('ba:fixture-event', handle);
    },
  };
}
