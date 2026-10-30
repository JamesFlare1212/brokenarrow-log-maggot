import { useLayoutEffect, useRef, useState } from 'react';
import type { Player } from '@ba/contracts';

type Slot = { key: string; player: Player };
type Snapshot = { scope: string; revision: number; slots: Slot[] };
const slotKey = (player: Player) => `${player.teamId}:${player.id}`;

export function useRosterSlots(scope: string, players: Player[]) {
  const [revision, setRevision] = useState(0);
  const committed = useRef<Snapshot | null>(null);
  const current = new Map(players.map((player) => [slotKey(player), player]));
  const previous = committed.current;
  const slots =
    previous?.scope === scope && previous.revision === revision
      ? previous.slots.map((slot) => ({ ...slot, player: current.get(slot.key) ?? slot.player }))
      : [];
  const known = new Set(slots.map((slot) => slot.key));
  for (const [key, player] of current) if (!known.has(key)) slots.push({ key, player });
  useLayoutEffect(() => {
    committed.current = { scope, revision, slots };
  });
  return {
    slots: slots.map((slot) => ({ ...slot, active: current.has(slot.key) })),
    compact: () => setRevision((value) => value + 1),
    vacancies: slots.filter((slot) => !current.has(slot.key)).length,
  };
}
