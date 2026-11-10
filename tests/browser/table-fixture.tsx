import { Fragment, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '../../apps/web/src/components/ui/button';
import { Card, CardContent } from '../../apps/web/src/components/ui/card';
import { Item, ItemContent, ItemGroup, ItemSeparator } from '../../apps/web/src/components/ui/item';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../apps/web/src/components/ui/table';

function TableFixture() {
  const [pending, setPending] = useState(false);
  const [opened, setOpened] = useState(0);
  return (
    <main className="flex w-104 max-w-full flex-col gap-4 p-4">
      <Button onClick={() => setPending((value) => !value)}>Toggle loading</Button>
      <Card>
        <CardContent>
          <div
            role="region"
            aria-label="Transparent records"
            tabIndex={0}
            className="h-48 overflow-auto [&>[data-slot=table-container]]:overflow-visible"
          >
            <Table stickyHeader stickyFirstColumn className="w-192 table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead>Match ID</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 12 }, (_, index) => (
                  <TableRow key={index}>
                    <TableCell className="h-12">
                      <Button variant="link" onClick={() => setOpened((value) => value + 1)}>
                        {pending ? 'Loading' : `#${9565049 + index}`}
                      </Button>
                    </TableCell>
                    <TableCell>Covered result {index}</TableCell>
                    <TableCell>2026/11/4 01:56</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <ItemGroup className="gap-0 has-data-[size=xs]:gap-0" aria-label="Name history">
            {['Previous name', 'First alias', 'Second alias', 'Third alias'].map((name, index) => (
              <Fragment key={name}>
                {index > 0 && <ItemSeparator className="my-0" />}
                <Item size="xs">
                  <ItemContent>{name}</ItemContent>
                </Item>
              </Fragment>
            ))}
          </ItemGroup>
        </CardContent>
      </Card>
      <output>Opened: {opened}</output>
    </main>
  );
}

export function mountTableFixture() {
  document.getElementById('root')!.style.display = 'none';
  document
    .querySelector<HTMLElement>('[data-development-layer]')
    ?.style.setProperty('display', 'none', 'important');
  const host = document.createElement('div');
  document.body.append(host);
  createRoot(host).render(<TableFixture />);
}
