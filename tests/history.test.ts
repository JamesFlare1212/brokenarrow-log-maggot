import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyMatch, emptyPlayer } from '@ba/shared';
import type { MatchPlayer } from '@ba/contracts';
import { Database } from '../apps/server/src/storage/database';
import { HistoryService } from '../apps/server/src/history/service';
import { TrackerService } from '../apps/server/src/players/tracker';
import { BatraceClient } from '../apps/server/src/network/client';
import { Analyzer } from '../apps/server/src/players/analyzer';
import { LogArchive } from '../apps/server/src/logs/archive';

const root = resolve('.test-data/history-tests');
const directories: string[] = [],
  databases: Database[] = [];
async function fixture() {
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'run-'));
  directories.push(directory);
  const db = new Database(join(directory, 'assistant.sqlite'));
  databases.push(db);
  const history = new HistoryService(db, directory);
  const alpha = {
    ...emptyPlayer('1'),
    name: 'Alpha',
    teamId: 0 as const,
    oldRating: 100,
    newRating: 110,
  };
  const bravo = {
    ...emptyPlayer('2'),
    name: 'Bravo',
    teamId: 1 as const,
    oldRating: 110,
    newRating: 100,
  };
  const match = (id: string, players: MatchPlayer[] = [alpha], owner = '1') => ({
    ...emptyMatch(id, 1700000000000),
    map: 'Dam ' + id,
    source: 'log' as const,
    endedAt: 1700000060000,
    durationSec: 60,
    players,
    localPlayerId: owner,
    localPersona: owner === '1' ? 'Alpha' : 'Bravo',
    outcome: 'win' as const,
  });
  db.saveMatch(match('101'));
  db.saveMatch(match('102', [alpha, bravo], '2'));
  db.saveMatch(match('102', [alpha, bravo]));
  db.saveMatch(match('103', [bravo], '2'));
  db.setState('activeAccountId', '1');
  return { directory, db, history, match, alpha, bravo };
}
afterEach(async () => {
  for (const db of databases.splice(0)) db.close();
  for (const directory of directories.splice(0)) {
    const target = await realpath(directory);
    if (!target.startsWith(root + sep)) throw new Error('Unsafe history-fixture cleanup');
    await rm(target, { recursive: true, force: true });
  }
});

describe('reviewed history deletion and recovery', () => {
  it('reviews exact exclusive and retained account history and restores every view after reopening', async () => {
    const { directory, db, history } = await fixture();
    const plan = history.plan('account', '1');
    expect(plan.removed.map((match) => match.id)).toEqual(['101']);
    expect(plan.retained).toMatchObject([{ id: '102', accounts: [{ id: '2', name: 'Bravo' }] }]);
    expect(plan.affectedAccounts).toEqual([{ id: '1', name: 'Alpha' }]);
    const result = await history.execute(plan.token, 'account');
    expect(result).toMatchObject({ removed: true, removedMatches: 1, retainedMatches: 1 });
    expect(db.accounts().map((account) => account.id)).toEqual(['2']);
    expect(
      db
        .matches('2')
        .map((match) => match.id)
        .sort(),
    ).toEqual(['102', '103']);
    const backup = JSON.parse(
      await readFile(join(history.directory(), result.backup.name), 'utf8'),
    );
    expect(
      backup.before.matches.map((match: { record: { id: string } }) => match.record.id),
    ).toEqual(['101', '102']);
    db.close();
    databases.splice(databases.indexOf(db), 1);
    const reopened = new Database(join(directory, 'assistant.sqlite'));
    databases.push(reopened);
    const restored = new HistoryService(reopened, directory);
    expect((await restored.backups()).backups).toHaveLength(1);
    expect(await restored.restore(result.backup.name, result.backup.version)).toEqual({
      restoredMatches: 2,
      restoredAccounts: 1,
    });
    expect(
      reopened
        .matches('1')
        .map((match) => match.id)
        .sort(),
    ).toEqual(['101', '102']);
    expect(
      reopened
        .matches('2')
        .map((match) => match.id)
        .sort(),
    ).toEqual(['102', '103']);
    expect((await restored.backups()).backups[0]?.restoredAt).toBeTypeOf('number');
    await expect(restored.restore(result.backup.name, result.backup.version)).rejects.toThrow(
      'HISTORY_RESTORE_CONFLICT',
    );
  });
  it('identifies all shared match owners and restores their exact perspectives', async () => {
    const { db, history } = await fixture();
    const original = [db.match('102', '1'), db.match('102', '2')];
    const plan = history.plan('match', '102');
    expect(plan.affectedAccounts).toEqual([
      { id: '1', name: 'Alpha' },
      { id: '2', name: 'Bravo' },
    ]);
    const result = await history.execute(plan.token, 'match');
    expect(db.match('102')).toBeNull();
    for (const source of ['log', 'api'] as const) {
      db.saveMatch({ ...original[0]!, source });
      expect(db.match('102')).toBeNull();
    }
    await history.restore(result.backup.name, result.backup.version);
    expect([db.match('102', '1'), db.match('102', '2')]).toEqual(original);
    expect(db.match('103')).not.toBeNull();
  });
  it('keeps shared deletion across real log rescans and restores both account views', async () => {
    const { directory, db, history } = await fixture();
    const logs = join(directory, 'Logs');
    await mkdir(logs);
    for (const name of ['Alpha', 'Bravo'])
      await writeFile(
        join(logs, name + '.log'),
        [
          '[2026-10-28 10:00:00.000]',
          `Log: GetPersonaName ${name}`,
          'Log: Start loading battle... map: Dam, scenario: Test',
          'Log: FID:102',
          'Log: Player list:',
          'ID: 1, Name: Alpha, Team: Alpha',
          'ID: 2, Name: Bravo, Team: Bravo',
          '[2026-10-28 10:15:00.000]',
          'Log: GameController dispose called',
          '',
        ].join('\n'),
      );
    const archive = new LogArchive(db, () => {});
    await archive.scan(logs);
    for (const account of ['1', '2'])
      expect(db.matches(account).some((match) => match.id === '102')).toBe(true);
    const result = await history.execute(history.plan('match', '102').token, 'match');
    for (const name of ['Alpha', 'Bravo']) await appendFile(join(logs, name + '.log'), '\n');
    await archive.scan(logs);
    expect(db.match('102')).toBeNull();
    await history.restore(result.backup.name, result.backup.version);
    for (const name of ['Alpha', 'Bravo']) await appendFile(join(logs, name + '.log'), '\n');
    await archive.scan(logs);
    for (const account of ['1', '2'])
      expect(db.matches(account).some((match) => match.id === '102')).toBe(true);
  });
  it('rejects a new match added after account review and consumes that confirmation', async () => {
    const { db, history, match } = await fixture();
    const plan = history.plan('account', '1');
    db.saveMatch(match('104'));
    await expect(history.execute(plan.token, 'account')).rejects.toThrow('HISTORY_TARGET_CHANGED');
    await expect(history.execute(plan.token, 'account')).rejects.toThrow('HISTORY_PLAN_EXPIRED');
    expect(db.matches('1')).toHaveLength(3);
    expect((await history.backups()).backups).toEqual([]);
  });
  it('rejects a changed view or recreated same-ID account before deletion', async () => {
    const { db, history, match } = await fixture();
    const plan = history.plan('account', '1');
    db.deleteAccount('1');
    db.saveMatch(match('104'));
    await expect(history.execute(plan.token, 'account')).rejects.toThrow('HISTORY_TARGET_CHANGED');
    expect(db.match('104')).not.toBeNull();
  });
  it('expires reviewed scopes without changing records', async () => {
    const { db, history } = await fixture();
    const plan = history.plan('match', '102');
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10 * 60000);
    await expect(history.execute(plan.token, 'match')).rejects.toThrow('HISTORY_PLAN_EXPIRED');
    expect(db.match('102')).not.toBeNull();
  });
  it('serializes competing destructive plans and preserves the later changed scope', async () => {
    const { db, history } = await fixture();
    const alpha = history.plan('account', '1'),
      bravo = history.plan('account', '2');
    const results = await Promise.allSettled([
      history.execute(alpha.token, 'account'),
      history.execute(bravo.token, 'account'),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(db.accounts().map((account) => account.id)).toEqual(['2']);
    expect(db.match('103')).not.toBeNull();
  });
  it('preserves records when a recovery file cannot be created', async () => {
    const { db, history } = await fixture();
    await writeFile(history.directory(), 'blocks backup directory');
    const plan = history.plan('account', '1');
    await expect(history.execute(plan.token, 'account')).rejects.toThrow();
    expect(db.matches('1')).toHaveLength(2);
    expect(db.accounts()).toHaveLength(2);
    expect((await history.backups()).backups).toEqual([]);
  });
  it('rolls back database failures and removes the unused recovery file', async () => {
    const { db, history } = await fixture();
    const plan = history.plan('account', '1');
    db.sql.exec(
      "CREATE TRIGGER reject_history_delete BEFORE DELETE ON matches WHEN OLD.id='101' BEGIN SELECT RAISE(ABORT,'controlled failure'); END;",
    );
    await expect(history.execute(plan.token, 'account')).rejects.toThrow('controlled failure');
    expect(db.matches('1')).toHaveLength(2);
    expect(db.accounts()).toHaveLength(2);
    expect(db.historyVersion()).toBe('');
    expect(await readdir(history.directory())).toEqual([]);
    expect((await history.backups()).backups).toEqual([]);
  });
  it('rechecks the reviewed scope after writing its backup', async () => {
    const { db, history } = await fixture();
    const plan = history.plan('match', '102');
    const transaction = db.transaction.bind(db);
    vi.spyOn(db, 'transaction').mockImplementationOnce((run) => {
      db.sql
        .prepare(
          "UPDATE matches SET payload=json_set(payload,'$.map','Changed during backup') WHERE id='102'",
        )
        .run();
      return transaction(run);
    });
    await expect(history.execute(plan.token, 'match')).rejects.toThrow('HISTORY_TARGET_CHANGED');
    expect(db.match('102')?.map).toBe('Changed during backup');
    expect(await readdir(history.directory())).toEqual([]);
  });
  it('refuses modified recovery bytes and retains current records', async () => {
    const { db, history } = await fixture();
    const result = await history.execute(history.plan('match', '102').token, 'match');
    await writeFile(join(history.directory(), result.backup.name), '{}');
    await expect(history.restore(result.backup.name, result.backup.version)).rejects.toThrow(
      'HISTORY_BACKUP_CHANGED',
    );
    expect(db.match('102')).toBeNull();
    expect(db.match('103')).not.toBeNull();
  });
  it('refuses recreated account identities without restoring anything', async () => {
    const { db, history, match } = await fixture();
    const result = await history.execute(history.plan('account', '1').token, 'account');
    db.saveMatch(match('104'));
    await expect(history.restore(result.backup.name, result.backup.version)).rejects.toThrow(
      'HISTORY_RESTORE_CONFLICT',
    );
    expect(db.match('101')).toBeNull();
    expect(db.match('104')).not.toBeNull();
    expect(db.matches('1').map((match) => match.id)).toEqual(['104']);
  });
  it('restores a deleted account view while preserving newer retained match facts', async () => {
    const { db, history } = await fixture();
    const result = await history.execute(history.plan('account', '1').token, 'account');
    db.saveMatch({ ...db.match('102')!, map: 'Enriched shared match', updatedAt: 1800000000000 });
    await history.restore(result.backup.name, result.backup.version);
    expect(db.match('102', '1')?.map).toBe('Enriched shared match');
    expect(db.match('102', '2')?.map).toBe('Enriched shared match');
  });
  it('refuses restoration after a second deletion of a retained record', async () => {
    const { db, history } = await fixture();
    const first = await history.execute(history.plan('account', '1').token, 'account');
    await history.execute(history.plan('match', '102').token, 'match');
    await expect(history.restore(first.backup.name, first.backup.version)).rejects.toThrow(
      'HISTORY_RESTORE_CONFLICT',
    );
    expect(db.accounts().map((account) => account.id)).toEqual(['2']);
    expect(db.match('101')).toBeNull();
  });
  it('rejects an older recovery after an empty account is recreated and deleted again', async () => {
    const { db, history } = await fixture();
    db.observeAccount('9', 'Empty account');
    const first = await history.execute(history.plan('account', '9').token, 'account');
    db.observeAccount('9', 'New empty account');
    const second = await history.execute(history.plan('account', '9').token, 'account');
    await expect(history.restore(first.backup.name, first.backup.version)).rejects.toThrow(
      'HISTORY_RESTORE_CONFLICT',
    );
    await history.restore(second.backup.name, second.backup.version);
    expect(db.accounts().find((account) => account.id === '9')?.name).toBe('New empty account');
  });
  it('prevents held analysis from saving a match deleted after the main response', async () => {
    const { db, history } = await fixture();
    const client = new BatraceClient(
      db,
      {
        offline: true,
        fetch: async () => {
          throw new Error('Offline fixture');
        },
      },
      'test',
    );
    vi.spyOn(client, 'match').mockResolvedValue({
      value: {
        matchInfo: {
          MapId: 7,
          EndTime: 1700000060,
          TotalPlayTimeInSec: 60,
          Data: { '1': { Name: 'Alpha' } },
        },
      },
      source: 'network',
      at: 1700000060000,
      attempts: 1,
    });
    let release!: (value: Awaited<ReturnType<BatraceClient['analysisMatch']>>) => void;
    const analysis = vi.spyOn(client, 'analysisMatch').mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const tracker = new TrackerService(db, client, new Analyzer(client, db));
    const request = tracker.detail('102', true);
    const rejected = expect(request).rejects.toThrow('HISTORY_TARGET_CHANGED');
    await vi.waitFor(() => expect(analysis).toHaveBeenCalled());
    await history.execute(history.plan('match', '102').token, 'match');
    release({ value: {}, source: 'network', at: 1700000060000, attempts: 1 });
    await rejected;
    expect(db.match('102')).toBeNull();
  });
  it('discards pending automatic synchronization after account deletion', async () => {
    const { db, history } = await fixture();
    const client = new BatraceClient(
      db,
      {
        offline: true,
        fetch: async () => {
          throw new Error('Offline fixture');
        },
      },
      'test',
    );
    const tracker = new TrackerService(db, client, new Analyzer(client, db));
    const snapshot = db.matches('1');
    let release!: (value: Awaited<ReturnType<TrackerService['recent']>>) => void;
    vi.spyOn(tracker, 'recent').mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const request = tracker.sync();
    await history.execute(history.plan('account', '1').token, 'account');
    release({ matches: snapshot.map((match) => ({ ...match, source: 'api' })), stale: false });
    await request;
    expect(db.accounts().map((account) => account.id)).toEqual(['2']);
    expect(db.matches('1')).toEqual([]);
    expect(db.match('102')?.localPlayerId).toBe('2');
  });
  it.each(['account', 'match'] as const)(
    'keeps %s deletion after an older network refresh completes, with deliberate add recovery',
    async (kind) => {
      const { db, history } = await fixture();
      const client = new BatraceClient(
        db,
        {
          offline: true,
          fetch: async () => {
            throw new Error('Offline fixture');
          },
        },
        'test',
      );
      let release!: (value: Awaited<ReturnType<BatraceClient['match']>>) => void;
      const held = new Promise<Awaited<ReturnType<BatraceClient['match']>>>((resolve) => {
        release = resolve;
      });
      const response = {
        value: {
          matchInfo: {
            MapId: 7,
            EndTime: 1700000060,
            TotalPlayTimeInSec: 60,
            Data: { '1': { Name: 'Alpha', TeamId: 0 }, '2': { Name: 'Bravo', TeamId: 1 } },
          },
        },
        source: 'network' as const,
        at: 1700000060000,
        attempts: 1,
      };
      vi.spyOn(client, 'match').mockReturnValueOnce(held).mockResolvedValue(response);
      vi.spyOn(client, 'analysisMatch').mockRejectedValue(new Error('No analysis fixture'));
      const tracker = new TrackerService(db, client, new Analyzer(client, db));
      const request = tracker.detail('102', true);
      const rejected = expect(request).rejects.toThrow('HISTORY_TARGET_CHANGED');
      await history.execute(history.plan(kind, kind === 'account' ? '1' : '102').token, kind);
      release(response);
      await rejected;
      expect(db.matches('1').map((match) => match.id)).toEqual(kind === 'account' ? [] : ['101']);
      if (kind === 'match') expect(db.match('102')).toBeNull();
      else expect(db.match('102')?.localPlayerId).toBe('2');
      await tracker.detail('102', true, true);
      expect(db.match('102')).not.toBeNull();
    },
  );
});
