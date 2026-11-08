import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function SubmenuFixture() {
  const [selections, setSelections] = useState(0);
  return (
    <main className="fixed inset-0 flex flex-col items-start gap-4 bg-background p-12 text-foreground">
      <Button variant="outline">Before menu</Button>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">Open actions</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-40 w-52 overflow-y-auto">
          <DropdownMenuGroup>
            <DropdownMenuItem>Copy ID</DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>More actions</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => setSelections((value) => value + 1)}>
                  Open report
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <output role="status">Selections: {selections}</output>
    </main>
  );
}

export function mountSubmenuFixture() {
  document.getElementById('root')!.style.display = 'none';
  document
    .querySelector<HTMLElement>('[data-development-layer]')
    ?.style.setProperty('display', 'none', 'important');
  const host = document.createElement('div');
  document.body.append(host);
  createRoot(host).render(<SubmenuFixture />);
}
