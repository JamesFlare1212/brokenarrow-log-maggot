import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as fileSystem from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Database } from '../apps/server/src/storage/database';
import { LogParser, type LogEvent } from '../apps/server/src/logs/parser';
import { LogWatcher } from '../apps/server/src/logs/watcher';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readdir: vi.fn(actual.readdir) };
});

describe('log format and session regressions', () => {
  it('recognizes tagged lobby events, clears old members, and coalesces duplicate exits', () => {
    const events: LogEvent[] = [];
    const parser = new LogParser((event) => events.push(event));
    parser.feed([
      'Log: [LOBBY] Enter to lobby (id: 1776). Status Pending',
      'Log: Incoming client Friend:2 to lobby (id: 1776)',
    ]);
    expect(parser.snapshot()).toMatchObject({
      lobbyId: '1776',
      phase: 'lobby',
      lobbyPlayers: [{ id: '2' }],
    });
    parser.feed([
      'Log: [LOBBY] Exit lobby (id: 1776)',
      'Log: Exit lobby (id: 1776) and clear state.',
      'Log: [LOBBY] Exit lobby (id: 1776)',
    ]);
    expect(parser.snapshot()).toMatchObject({ lobbyId: '', phase: 'idle', lobbyPlayers: [] });
    expect(events.filter((e) => e.type === 'reset')).toHaveLength(2);
    parser.feed(['Log: [LOBBY] Enter to lobby (id: 42). Status Pending']);
    expect(parser.snapshot()).toMatchObject({ lobbyId: '42', lobbyPlayers: [] });
  });
  it('reads both roster formats, Unicode names, empty names, and updated teams', () => {
    const parser = new LogParser(() => {});
    parser.feed([
      'Log: GetPersonaName Player',
      'Log: Start loading battle... map: Dam, scenario: Test',
      'Log: Player list:',
      'ID: 1 Name: PlayerTeam: Alpha',
      'ID: 2 Name: 中文, Name: otherTeam: Bravo',
      'ID: 3, Name: , Team: Spectators',
    ]);
    expect(parser.snapshot().current?.players).toEqual([
      expect.objectContaining({ id: '1', name: 'Player', teamId: 0 }),
      expect.objectContaining({ id: '2', name: '中文, Name: other', teamId: 1 }),
      expect.objectContaining({ id: '3', name: '', teamId: 100 }),
    ]);
    expect(parser.snapshot().localPlayerId).toBe('1');
    parser.feed(['Log: Player list:', 'ID: 1, Name: Player, Team: Bravo']);
    expect(parser.snapshot().current?.players[0]?.teamId).toBe(1);
  });
  it('uses real timestamps during recovery while keeping historical effects suppressed', () => {
    const events: LogEvent[] = [];
    const parser = new LogParser((event) => events.push(event));
    parser.feed(
      ['[2026-10-13 23:05:30.118]', 'Log: Start loading battle... map: Dam, scenario: Test'],
      true,
    );
    expect(parser.isRecoveredMatch()).toBe(true);
    parser.feed(['[2026-10-13 23:22:01.248]', 'Log: GameController dispose called'], true);
    expect(events.find((e) => e.type === 'ended')).toMatchObject({
      recovering: true,
      match: {
        startedAt: new Date(2026, 9, 13, 23, 5, 30, 118).getTime(),
        endedAt: new Date(2026, 9, 13, 23, 22, 1, 248).getTime(),
        durationSec: 991,
        durationSource: 'estimated',
      },
    });
  });
  it('gives no-FID sessions stable identities across resets, restarts, and batch sizes', () => {
    const lines = [
      '[2026-07-21 01:48:00.000]',
      'Log: GetPersonaName Player',
      'Log: Start loading battle... map: Dam, scenario: Test',
      'Log: Player list:',
      'ID: 1, Name: Player, Team: Alpha',
      '[2026-07-21 02:00:00.000]',
      'Log: GameController dispose called',
    ];
    const db = new Database(':memory:');
    try {
      const parser = new LogParser((event) => {
        if (event.type === 'ended') db.saveMatch(event.match, false);
      });
      parser.reset('game.log');
      parser.feed(lines, true);
      const id = db.matches()[0]?.id;
      parser.reset('game.log');
      for (const line of lines) parser.feed([line], true);
      expect(db.matches()).toHaveLength(1);
      expect(db.matches()[0]?.id).toBe(id);
      const second = new LogParser(() => {});
      second.reset('game.log');
      second.feed(lines.slice(0, 3), true);
      expect(second.snapshot().current?.id).toBe(id);
      second.reset('different.log');
      second.feed(lines.slice(0, 3), true);
      expect(second.snapshot().current?.id).not.toBe(id);
    } finally {
      db.close();
    }
  });
  it('merges a fallback room entry with later map metadata and preserves its fight ID', () => {
    const events: LogEvent[] = [];
    const parser = new LogParser((event) => events.push(event));
    parser.feed(['Log: [NET_ROOM] GameRoom entered, fight id: 123']);
    const sessionId = parser.snapshot().current?.sessionId;
    parser.feed(['Log: Start loading battle... map: Dam, scenario: Test']);
    expect(parser.snapshot().current).toMatchObject({ fid: '123', map: 'Dam', sessionId });
    expect(events.filter((e) => e.type === 'started')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'ended')).toHaveLength(0);
  });
  it('ends old-format matches on a return to the hangar and on game exit', () => {
    const events: LogEvent[] = [];
    const parser = new LogParser((event) => events.push(event));
    parser.feed(['Log: Room entered - GameRoom', 'Log: LoadSceneAsync: Hangar_Scene ']);
    expect(parser.snapshot().current).toBeNull();
    parser.feed(['Log: Room entered - GameRoom', 'Log: Exit button pressed, exiting the game...']);
    expect(events.filter((e) => e.type === 'ended')).toHaveLength(2);
  });
  it('assigns unlabelled late duration to the pending ended match instead of the new match', () => {
    const events: LogEvent[] = [];
    const parser = new LogParser((event) => events.push(event));
    parser.feed(
      [
        'Log: Start loading battle... map: Dam, scenario: First',
        'Log: FID:1',
        'Log: GameController dispose called',
        'Log: Start loading battle... map: Coast, scenario: Second',
        'Log: FID:2',
        'Log: [NET_ROOM] Connection closed. Info LiveTime: 900 sec',
      ],
      true,
    );
    expect(parser.snapshot().current).toMatchObject({ fid: '2', durationSec: null });
    expect(events.find((e) => e.type === 'metadata')).toMatchObject({
      match: { fid: '1', durationSec: 900 },
    });
  });
  it('uses connection identity when two matches have pending network durations', () => {
    const events: LogEvent[] = [];
    const parser = new LogParser((event) => events.push(event));
    parser.feed(
      [
        'Log: [NET_ROOM] Network lifecycle | Stage=Game | Action=Entered | ServerIp=127.0.0.1 | ServerPort=1 | FightId=1',
        'Log: Start loading battle... map: Dam, scenario: First',
        'Log: FID:1',
        'Log: GameController dispose called',
        'Log: [NET_ROOM] Network lifecycle | Stage=Game | Action=Entered | ServerIp=127.0.0.2 | ServerPort=2 | FightId=2',
        'Log: Start loading battle... map: Coast, scenario: Second',
        'Log: FID:2',
        'Log: GameController dispose called',
        'Log: [NET_ROOM] Connection closed. Server 127.0.0.1:1, LiveTime: 900 sec',
      ],
      true,
    );
    expect(events.find((e) => e.type === 'metadata')).toMatchObject({
      match: { fid: '1', durationSec: 900 },
    });
  });
  it('matches proxy connection addresses rather than the logical game server', () => {
    const events: LogEvent[] = [];
    const parser = new LogParser((event) => events.push(event));
    parser.feed(
      [
        'Log: [NET_ROOM] Network lifecycle | Stage=Game | Action=Entered | ServerIp=127.0.0.1 | ServerPort=1 | ConnectionIp=127.0.0.2 | ConnectionPort=2 | FightId=1',
        'Log: Start loading battle... map: Dam, scenario: Test',
        'Log: FID:1',
        'Log: GameController dispose called',
        'Log: [NET_ROOM] Connection closed. Server 127.0.0.2:2, LiveTime: 900 sec',
      ],
      true,
    );
    expect(events.find((e) => e.type === 'metadata')).toMatchObject({
      match: { fid: '1', durationSec: 900 },
    });
  });
});

describe('incremental log boundaries', () => {
  it('starts the latest directory immediately after a superseded read finishes', async () => {
    const first = await mkdtemp(join(tmpdir(), 'ba-logs-first-'));
    const second = await mkdtemp(join(tmpdir(), 'ba-logs-second-'));
    const parser = new LogParser(() => {});
    const watcher = new LogWatcher(parser, () => {});
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const readDirectory = fileSystem.readdir;
    vi.spyOn(fileSystem, 'readdir').mockImplementationOnce(async (...args) => {
      entered();
      await gate;
      return Reflect.apply(readDirectory, undefined, args);
    });
    try {
      await writeFile(join(first, 'Gamelog__first.log'), 'Log: GetPersonaName First\n');
      await writeFile(join(second, 'Gamelog__second.log'), 'Log: GetPersonaName Second\n');
      watcher.start(first);
      await started;
      watcher.start(second);
      release();
      await vi.waitFor(() => expect(parser.snapshot().localName).toBe('Second'), {
        timeout: 800,
        interval: 20,
      });
      expect(watcher.status().dir).toBe(second);
    } finally {
      release();
      watcher.stop();
      await rm(first, { recursive: true, force: true });
      await rm(second, { recursive: true, force: true });
    }
  });
  it('keeps a partial historical start historical and reads the following start as live', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ba-logs-'));
    const path = join(directory, 'Gamelog__test.log');
    const events: LogEvent[] = [];
    let recovered = false;
    const parser = new LogParser((event) => {
      events.push(event);
      if (event.type === 'session' && !event.session.recovering && event.session.localName)
        recovered = true;
    });
    const watcher = new LogWatcher(parser, () => {});
    try {
      await writeFile(
        path,
        'Log: GetPersonaName Player\nLog: Start loading battle... map: Dam, scenario: Old',
      );
      watcher.start(directory);
      await vi.waitFor(() => expect(recovered).toBe(true));
      await appendFile(
        path,
        '\nLog: GameController dispose called\nLog: Start loading battle... map: Coast, scenario: New\n',
      );
      await watcher.poll();
      expect(events.flatMap((e) => (e.type === 'started' ? [e.recovering] : []))).toEqual([
        true,
        false,
      ]);
    } finally {
      watcher.stop();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('preserves Unicode split across the 64 KiB read boundary and keeps identities on restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ba-logs-'));
    const path = join(directory, 'Gamelog__test.log');
    const parser = new LogParser(() => {});
    const watcher = new LogWatcher(parser, () => {});
    try {
      const prefix =
        'Log: GetPersonaName 测试\nLog: Start loading battle... map: Dam, scenario: Test\nLog: Player list:\n';
      const row = 'ID: 1, Name: 测试, Team: Alpha\n';
      const padding =
        'x'.repeat(65535 - Buffer.byteLength(prefix) - Buffer.byteLength('ID: 1, Name: ') - 1) +
        '\n';
      await writeFile(path, prefix + padding + row);
      watcher.start(directory);
      await vi.waitFor(() => expect(parser.snapshot().current?.players[0]?.name).toBe('测试'));
      const id = parser.snapshot().current?.id;
      watcher.start(directory);
      await vi.waitFor(() => expect(parser.snapshot().current?.players[0]?.name).toBe('测试'));
      expect(parser.snapshot().current?.id).toBe(id);
    } finally {
      watcher.stop();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
