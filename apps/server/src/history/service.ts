import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import type { HistoryBackup, HistoryDeletePlan, HistoryDeleteResult, Match } from '@ba/contracts';
import { atomicWrite, childPath } from '../files/paths';
import type { Database } from '../storage/database';

type Row = Record<string, string | number | null>;
const values = (row: Row, keys: string[]) => keys.map((key) => row[key] ?? null);
interface MatchSnapshot {
  record: Row;
  players: Row[];
  views: Row[];
  version: string;
}
interface Snapshot {
  accounts: Row[];
  accountVersion: string | null;
  matches: MatchSnapshot[];
  markers: string[];
}
interface Recovery {
  format: 1;
  plan: HistoryDeletePlan;
  before: Snapshot;
  deletionVersion: string;
  createdAt: number;
}
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const fingerprint = (value: unknown) => digest(JSON.stringify(value));
const matchValue = (snapshot: MatchSnapshot) =>
  JSON.parse(String(snapshot.record.payload)) as Match;
const matchKeys = (match: Match) => [
  ...new Set([match.id, match.fid, 'local:' + match.sessionId].filter((id): id is string => !!id)),
];

export class HistoryService {
  private plans = new Map<
    string,
    { plan: HistoryDeletePlan; before: Snapshot; expiresAt: number }
  >();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private db: Database,
    private userDir: string,
  ) {}
  directory(): string {
    return join(this.userDir, 'HistoryBackups');
  }
  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }
  private capture(kind: 'account' | 'match', id: string): Snapshot {
    const accounts = this.db.sql.prepare('SELECT * FROM accounts ORDER BY id').all() as Row[];
    if (kind === 'account' && !accounts.some((account) => account.id === id))
      throw new Error('HISTORY_TARGET_CHANGED');
    const target = kind === 'match' ? this.db.match(id) : null;
    if (kind === 'match' && !target) throw new Error('HISTORY_TARGET_CHANGED');
    const records =
      kind === 'match'
        ? this.db.sql.prepare('SELECT * FROM matches WHERE id=?').all(target!.id)
        : this.db.sql
            .prepare(
              'SELECT m.* FROM matches m JOIN match_views v ON v.match_id=m.id WHERE v.account_id=? ORDER BY m.id',
            )
            .all(id);
    const matches = records.map((record) => ({
      record: record as Row,
      players: this.db.sql
        .prepare('SELECT * FROM match_players WHERE match_id=? ORDER BY player_id')
        .all(String(record.id)) as Row[],
      views: this.db.sql
        .prepare('SELECT * FROM match_views WHERE match_id=? ORDER BY account_id')
        .all(String(record.id)) as Row[],
      version: this.db.historyVersion(String(record.id)),
    }));
    const keys = matches.flatMap((snapshot) => matchKeys(matchValue(snapshot)));
    const related = new Set([
      ...(kind === 'account' ? [id] : []),
      ...matches.flatMap((match) => [
        ...match.views.map((view) => String(view.account_id)),
        ...match.players.map((player) => String(player.player_id)),
      ]),
    ]);
    return {
      accounts: accounts.filter((account) => related.has(String(account.id))),
      accountVersion: kind === 'account' ? this.db.historyVersion('account:' + id) : null,
      matches,
      markers: keys.filter(
        (key) => !!this.db.sql.prepare('SELECT 1 FROM deleted_log_matches WHERE id=?').get(key),
      ),
    };
  }
  plan(kind: 'account' | 'match', id: string): HistoryDeletePlan {
    const before = this.capture(kind, id);
    const account = before.accounts.find((account) => account.id === id);
    const summaries = before.matches.map((snapshot) => {
      const match = matchValue(snapshot);
      const owners = before.accounts.filter((account) =>
        snapshot.views.some((view) => view.account_id === account.id),
      );
      const remaining =
        kind === 'account'
          ? before.accounts.filter(
              (account) =>
                account.id !== id &&
                (owners.includes(account) ||
                  match.players.some((player) => player.id === account.id)),
            )
          : [];
      return {
        summary: {
          id: match.id,
          fid: match.fid,
          map: match.map,
          at: match.endedAt ?? match.startedAt,
          accounts: (kind === 'account' ? remaining : owners).map((account) => ({
            id: String(account.id),
            name: String(account.name),
          })),
        },
        retained: remaining.length > 0,
      };
    });
    const token = randomUUID(),
      createdAt = Date.now();
    const target =
      kind === 'account'
        ? { id, name: String(account!.name) }
        : { id: summaries[0]!.summary.id, name: summaries[0]!.summary.map };
    const plan: HistoryDeletePlan = {
      token,
      kind,
      target,
      removed: summaries.filter((item) => !item.retained).map((item) => item.summary),
      retained: summaries.filter((item) => item.retained).map((item) => item.summary),
      affectedAccounts: before.accounts
        .filter((account) =>
          kind === 'account'
            ? account.id === id
            : before.matches.some((match) =>
                match.views.some((view) => view.account_id === account.id),
              ),
        )
        .map((account) => ({ id: String(account.id), name: String(account.name) })),
      backupDirectory: this.directory(),
      backupName: `${kind}-${createdAt}-${token}.json`,
    };
    for (const [key, value] of this.plans) if (value.expiresAt <= createdAt) this.plans.delete(key);
    while (this.plans.size >= 8) this.plans.delete(this.plans.keys().next().value!);
    this.plans.set(token, { plan, before, expiresAt: createdAt + 10 * 60000 });
    return structuredClone(plan);
  }
  private entries(): HistoryBackup[] {
    return this.db.state('history:backups', []);
  }
  async backups(): Promise<{ directory: string; backups: HistoryBackup[] }> {
    return { directory: this.directory(), backups: this.entries() };
  }
  execute(token: string, kind: 'account' | 'match'): Promise<HistoryDeleteResult> {
    return this.exclusive(async () => {
      const saved = this.plans.get(token);
      this.plans.delete(token);
      if (!saved || saved.plan.kind !== kind || saved.expiresAt <= Date.now())
        throw new Error('HISTORY_PLAN_EXPIRED');
      const { plan, before } = saved;
      const verify = () => {
        if (fingerprint(this.capture(kind, plan.target.id)) !== fingerprint(before))
          throw new Error('HISTORY_TARGET_CHANGED');
      };
      verify();
      const recovery: Recovery = {
        format: 1,
        plan,
        before,
        deletionVersion: randomUUID(),
        createdAt: Date.now(),
      };
      const contents = JSON.stringify(recovery);
      const backup: HistoryBackup = {
        name: plan.backupName,
        version: digest(contents),
        createdAt: recovery.createdAt,
        kind,
        target: plan.target,
        matchCount: before.matches.length,
        restoredAt: null,
      };
      await mkdir(this.directory(), { recursive: true });
      const target = childPath(this.directory(), backup.name, '.json');
      await atomicWrite(this.directory(), backup.name, Buffer.from(contents), false);
      try {
        return this.db.transaction(() => {
          verify();
          const result =
            kind === 'account'
              ? this.db.deleteAccount(plan.target.id)
              : { removedMatches: Number(this.db.deleteMatch(plan.target.id)) };
          if (result.removedMatches !== plan.removed.length)
            throw new Error('HISTORY_TARGET_CHANGED');
          this.db.advanceHistory(before.matches.map(matchValue), recovery.deletionVersion);
          if (kind === 'account')
            this.db.setState('history:version:account:' + plan.target.id, recovery.deletionVersion);
          this.db.setState('history:backups', [backup, ...this.entries()]);
          return {
            removed: true,
            removedMatches: result.removedMatches,
            retainedMatches: plan.retained.length,
            backup,
          };
        });
      } catch (error) {
        await unlink(target).catch(() => {});
        throw error;
      }
    });
  }
  restore(
    name: string,
    version: string,
  ): Promise<{ restoredMatches: number; restoredAccounts: number }> {
    return this.exclusive(async () => {
      const entry = this.entries().find(
        (entry) => entry.name === name && entry.version === version && entry.restoredAt === null,
      );
      if (!entry) throw new Error('HISTORY_RESTORE_CONFLICT');
      const contents = await readFile(childPath(this.directory(), name, '.json'));
      if (digest(contents) !== version) throw new Error('HISTORY_BACKUP_CHANGED');
      const recovery = JSON.parse(contents.toString('utf8')) as Recovery;
      if (recovery.format !== 1 || recovery.plan.backupName !== name)
        throw new Error('HISTORY_BACKUP_CHANGED');
      const { plan, before } = recovery;
      return this.db.transaction(() => {
        const fail = () => {
          throw new Error('HISTORY_RESTORE_CONFLICT');
        };
        const removed = new Set(plan.removed.map((match) => match.id));
        const restoredAccount =
          plan.kind === 'account'
            ? before.accounts.find((account) => account.id === plan.target.id)!
            : null;
        if (
          restoredAccount &&
          (this.db.sql.prepare('SELECT 1 FROM accounts WHERE id=?').get(restoredAccount.id!) ||
            this.db.historyVersion('account:' + plan.target.id) !== recovery.deletionVersion)
        )
          fail();
        for (const snapshot of before.matches) {
          const match = matchValue(snapshot),
            current = this.db.match(match.id);
          if (
            this.db.historyVersion(match.id) !== recovery.deletionVersion ||
            (removed.has(match.id)
              ? !!current || !!(match.fid && this.db.match(match.fid))
              : !current)
          )
            fail();
          for (const view of snapshot.views)
            if (
              view.account_id !== restoredAccount?.id &&
              !this.db.sql.prepare('SELECT 1 FROM accounts WHERE id=?').get(view.account_id!)
            )
              fail();
        }
        if (restoredAccount)
          this.db.sql
            .prepare('INSERT INTO accounts VALUES(?,?,?,?,?)')
            .run(...values(restoredAccount, ['id', 'name', 'persona', 'first_seen', 'last_seen']));
        for (const snapshot of before.matches) {
          const match = matchValue(snapshot);
          if (removed.has(match.id)) {
            const record = snapshot.record;
            this.db.sql
              .prepare('INSERT INTO matches VALUES(?,?,?,?)')
              .run(...values(record, ['id', 'fid', 'end_time', 'payload']));
            for (const player of snapshot.players)
              this.db.sql
                .prepare('INSERT INTO match_players VALUES(?,?,?,?)')
                .run(...values(player, ['match_id', 'player_id', 'team_id', 'payload']));
            for (const key of matchKeys(match))
              if (!before.markers.includes(key))
                this.db.sql.prepare('DELETE FROM deleted_log_matches WHERE id=?').run(key);
          }
          for (const view of snapshot.views)
            if (removed.has(match.id) || view.account_id === restoredAccount?.id)
              this.db.sql
                .prepare('INSERT INTO match_views VALUES(?,?,?)')
                .run(...values(view, ['match_id', 'account_id', 'payload']));
        }
        this.db.rebuildGameObservations();
        this.db.advanceHistory(before.matches.map(matchValue));
        if (restoredAccount)
          this.db.setState('history:version:account:' + plan.target.id, randomUUID());
        this.db.setState(
          'history:backups',
          this.entries().map((item) =>
            item.name === name ? { ...item, restoredAt: Date.now() } : item,
          ),
        );
        return {
          restoredMatches: before.matches.length,
          restoredAccounts: Number(!!restoredAccount),
        };
      });
    });
  }
}
