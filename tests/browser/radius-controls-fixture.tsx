import { createRoot } from 'react-dom/client';
import { Card } from '../../apps/web/src/components/ui/card';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '../../apps/web/src/components/ui/input-group';
import { Tabs, TabsList, TabsTrigger } from '../../apps/web/src/components/ui/tabs';

export function mountRadiusControls() {
  document.getElementById('root')!.style.display = 'none';
  document
    .querySelector<HTMLElement>('[data-development-layer]')
    ?.style.setProperty('display', 'none');
  const host = document.createElement('main');
  document.body.append(host);
  createRoot(host).render(
    <div className="grid gap-4 p-4" style={{ maxWidth: 420 }}>
      {(['horizontal', 'vertical'] as const).map((orientation) => (
        <Tabs
          key={orientation}
          id={`tabs-${orientation}`}
          orientation={orientation}
          defaultValue="first"
        >
          <TabsList>
            <TabsTrigger value="first">Overview</TabsTrigger>
            <TabsTrigger value="last">History</TabsTrigger>
          </TabsList>
        </Tabs>
      ))}
      {(['default', 'lg'] as const).map((frame) => (
        <div key={frame}>
          {(['xs', 'sm', 'icon-xs', 'icon-sm'] as const).map((size) => (
            <InputGroup id={`${frame}-${size}`} key={size} size={frame}>
              <InputGroupAddon>
                <InputGroupButton size={size} variant="secondary">
                  −
                </InputGroupButton>
              </InputGroupAddon>
              <InputGroupInput aria-label="Value" defaultValue="Input" />
              <InputGroupAddon align="inline-end">
                <InputGroupButton size={size} variant="secondary">
                  +
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          ))}
        </div>
      ))}
      <Card id="edge-media">
        <img alt="" className="h-10 w-full bg-muted object-contain" src="/logo.png" />
      </Card>
      <InputGroup id="keycap">
        <InputGroupInput aria-label="Shortcut" defaultValue="Search" />
        <InputGroupAddon align="inline-end">
          <kbd>⌘K</kbd>
        </InputGroupAddon>
      </InputGroup>
      <InputGroup id="block-buttons">
        <InputGroupAddon align="block-start">
          <InputGroupButton variant="secondary">Select folder</InputGroupButton>
        </InputGroupAddon>
        <InputGroupInput aria-label="Path" defaultValue="Documents" />
        <InputGroupAddon align="block-end">
          <InputGroupButton size="sm" variant="secondary">
            Detect
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <InputGroup id="mixed-block">
        <InputGroupAddon align="block-start" className="justify-between">
          <InputGroupButton variant="secondary">Select folder</InputGroupButton>
          <InputGroupButton variant="secondary" size="sm">
            Browse
          </InputGroupButton>
        </InputGroupAddon>
        <InputGroupInput aria-label="Path" defaultValue="Documents" />
        <InputGroupAddon align="block-end" className="justify-between">
          <InputGroupButton size="sm" variant="secondary">
            Detect
          </InputGroupButton>
          <InputGroupButton variant="secondary">Choose</InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>,
  );
}
