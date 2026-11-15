import { createRoot } from 'react-dom/client';
import { Card, CardContent, CardHeader, CardTitle } from '../../apps/web/src/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '../../apps/web/src/components/ui/field';
import { Switch } from '../../apps/web/src/components/ui/switch';

function SwitchFixture({ Control }: { Control: typeof Switch }) {
  return (
    <main id="switch-fixture" className="flex w-80 max-w-full flex-col gap-4 p-4">
      {(['default', 'sm'] as const).map((size) => (
        <Card key={size}>
          <CardHeader>
            <CardTitle>{size === 'default' ? 'Default' : 'Small'}</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup className="gap-4">
              {['unchecked', 'checked', 'disabled-off', 'disabled-on', 'invalid'].map((state) => {
                const id = `switch-${size}-${state}`;
                return (
                  <Field key={state} orientation="horizontal">
                    <FieldLabel htmlFor={id}>{state}</FieldLabel>
                    <Control
                      id={id}
                      size={size}
                      defaultChecked={state === 'checked' || state === 'disabled-on'}
                      disabled={state.startsWith('disabled')}
                      aria-invalid={state === 'invalid' || undefined}
                    />
                  </Field>
                );
              })}
            </FieldGroup>
          </CardContent>
        </Card>
      ))}
    </main>
  );
}

export function mountSwitchFixture(Control: typeof Switch = Switch) {
  document.getElementById('root')!.style.display = 'none';
  document
    .querySelector<HTMLElement>('[data-development-layer]')
    ?.style.setProperty('display', 'none', 'important');
  const host = document.createElement('div');
  document.body.append(host);
  createRoot(host).render(<SwitchFixture Control={Control} />);
}
