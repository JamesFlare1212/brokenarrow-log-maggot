import type { DesktopCapturerSource, Display as ElectronDisplay } from 'electron';
import type { DisplayChoice, RecordingDisplayTarget } from '@ba/contracts';

export function displayChoices(
  sources: DesktopCapturerSource[],
  displays: ElectronDisplay[],
): DisplayChoice[] {
  return sources.map((source) => {
    const display = displays.find((display) => String(display.id) === source.display_id);
    return {
      id: source.id,
      displayId: source.display_id,
      label: display
        ? `${display.label || 'Display'} · ${Math.round(display.bounds.width * display.scaleFactor)}×${Math.round(display.bounds.height * display.scaleFactor)}`
        : source.name,
    };
  });
}

export function selectDisplay(
  sources: DesktopCapturerSource[],
  choices: DisplayChoice[],
  requestedId: string,
  cursorDisplayId: number,
): { source: DesktopCapturerSource | undefined; target: RecordingDisplayTarget } {
  const selected = requestedId
    ? sources.find((source) => source.id === requestedId || source.display_id === requestedId)
    : undefined;
  const source =
    selected ||
    sources.find((source) => source.display_id === String(cursorDisplayId)) ||
    sources[0];
  return {
    source,
    target: {
      requestedId,
      sourceId: source?.id ?? null,
      label: choices.find((choice) => choice.id === source?.id)?.label ?? null,
      selection: !source
        ? 'unavailable'
        : selected
          ? 'selected'
          : requestedId
            ? 'fallback'
            : 'automatic',
    },
  };
}
