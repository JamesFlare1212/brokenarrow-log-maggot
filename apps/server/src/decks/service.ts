import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { stat, lstat, readdir, readFile, unlink } from 'node:fs/promises';
import type {
  DeckFile,
  DeckList,
  DeckOperationResult,
  DeckRestorePlan,
  DeckRestoreResult,
  DeckSwitchAlert,
  Session,
} from '@ba/contracts';
import { filename, object, text, array, errorMessage } from '@ba/shared';
import type { Database } from '../storage/database';
import { childPath, atomicWrite } from '../files/paths';
import { zipCreate, zipExtract, ZIP_LIMITS, type ZipEntry } from './zip';
const PREVIOUS = '上一局卡组包.zip';
interface DeckState {
  pkgKey: string;
  pkgName: string;
  pkgFid: string | null;
  pkgUpdatedAt: number;
  alertedPairs: string[];
  directory: string;
  version: string;
}
interface RestoreSnapshot {
  plan: DeckRestorePlan;
  version: string;
  targets: Map<string, string | null>;
  directoryIdentity: string;
  expiresAt: number;
}
const digest = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const directoryKey = (directory: string) =>
  process.platform === 'win32' ? resolve(directory).toLowerCase() : resolve(directory);
export class DeckService {
  private queue: Promise<unknown> = Promise.resolve();
  private restores = new Map<string, RestoreSnapshot>();
  constructor(private db: Database) {}
  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }
  async paths(): Promise<{ decks: string; backups: string; found: boolean }> {
    const configured = this.db.config().decksDir,
      local = join(homedir(), 'AppData', 'LocalLow');
    const candidates = configured
      ? [configured]
      : [
          join(local, 'SteelBalalaikaStudio', 'BrokenArrow', 'Decks'),
          join(local, 'BrokenArrow', 'Decks'),
          join(local, 'SteelBalalaikaStudio', 'BrokenArrowBeta', 'Decks'),
          join(local, 'SteelBalalaikaStudio', 'BrokenArrow 2', 'Decks'),
        ];
    for (const decks of candidates)
      if (
        await stat(decks)
          .then((s) => s.isDirectory())
          .catch(() => false)
      )
        return { decks, backups: join(dirname(decks), 'DeckBackups'), found: true };
    return { decks: candidates[0] || '', backups: '', found: false };
  }
  private async files(dir: string, extension: string): Promise<DeckFile[]> {
    if (!dir) return [];
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const out = await Promise.all(
        entries
          .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(extension))
          .map(async (e) => {
            const s = await stat(childPath(dir, e.name, extension));
            return { name: e.name, size: s.size, modifiedAt: s.mtimeMs };
          }),
      );
      return out.sort((a, b) => b.modifiedAt - a.modifiedAt);
    } catch (error) {
      if (object(error).code === 'ENOENT') return [];
      throw error;
    }
  }
  async list(): Promise<DeckList> {
    const p = await this.paths();
    return {
      found: p.found,
      decksDir: p.decks,
      backupsDir: p.backups,
      decks: await this.files(p.decks, '.dek'),
      backups: await this.files(p.backups, '.zip'),
    };
  }
  private checkDirectory(actual: string, expected?: string): void {
    if (expected !== undefined && directoryKey(actual) !== directoryKey(expected))
      throw new Error('DECK_DIRECTORY_CHANGED');
  }
  private async directoryIdentity(directory: string): Promise<string> {
    const info = await stat(directory);
    return `${info.dev}:${info.ino}`;
  }
  private async createBackup(
    p: Awaited<ReturnType<DeckService['paths']>>,
    names: string[],
    packageName: string,
    replaceExisting = false,
  ): Promise<{ name: string; version: string }> {
    if (!p.found) throw new Error('Deck directory not found');
    if (!names.length) throw new Error('Select at least one deck');
    names = [...new Set(names)];
    let total = 0;
    for (const deck of names) {
      const info = await lstat(childPath(p.decks, deck, '.dek'));
      total += info.size;
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.size > ZIP_LIMITS.entry ||
        total > ZIP_LIMITS.total
      )
        throw new Error('Deck backup exceeds size limits or contains a symbolic link');
    }
    const name = filename(
        packageName.toLowerCase().endsWith('.zip') ? packageName : packageName + '.zip',
        '.zip',
      ),
      files = await Promise.all(
        names.map(async (n) => ({
          name: filename(n, '.dek'),
          data: await readFile(childPath(p.decks, n, '.dek')),
        })),
      );
    const archive = await zipCreate(files);
    try {
      await atomicWrite(p.backups, name, archive, replaceExisting);
    } catch (error) {
      if (object(error).code === 'EEXIST') throw new Error('DECK_BACKUP_EXISTS');
      throw error;
    }
    return { name, version: digest(archive) };
  }
  backup(names: string[], packageName: string, directory?: string): Promise<{ name: string }> {
    return this.exclusive(async () => {
      const p = await this.paths();
      this.checkDirectory(p.decks, directory);
      return this.createBackup(p, names, packageName);
    });
  }
  private async archive(directory: string, name: string): Promise<Buffer> {
    const path = childPath(directory, name, '.zip');
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > ZIP_LIMITS.total)
      throw new Error('Unsafe deck backup');
    return readFile(path);
  }
  private async currentDeck(directory: string, name: string): Promise<Buffer | null> {
    const path = childPath(directory, name, '.dek');
    let info;
    try {
      info = await lstat(path);
    } catch (error) {
      if (object(error).code === 'ENOENT') return null;
      throw error;
    }
    if (!info.isFile() || info.isSymbolicLink() || info.size > ZIP_LIMITS.entry)
      throw new Error('DECK_UNSAFE_TARGET: ' + name);
    return readFile(path);
  }
  planRestore(name: string, directory: string, version?: string): Promise<DeckRestorePlan> {
    return this.exclusive(async () => {
      const p = await this.paths();
      this.checkDirectory(p.decks, directory);
      if (!p.found) throw new Error('Deck directory not found');
      const archive = await this.archive(p.backups, name);
      if (version && digest(archive) !== version) throw new Error('DECK_RESTORE_CHANGED');
      const entries = await zipExtract(archive);
      const targets = new Map<string, string | null>();
      for (const entry of entries) {
        const data = await this.currentDeck(p.decks, entry.name);
        targets.set(entry.name, data === null ? null : digest(data));
      }
      const plan: DeckRestorePlan = {
        token: randomUUID(),
        directory: p.decks,
        name,
        files: entries.map((entry) => entry.name),
        replacements: entries
          .filter((entry) => targets.get(entry.name) !== null)
          .map((entry) => entry.name),
      };
      for (const [token, snapshot] of this.restores)
        if (snapshot.expiresAt <= Date.now()) this.restores.delete(token);
      while (this.restores.size >= 8) this.restores.delete(this.restores.keys().next().value!);
      this.restores.set(plan.token, {
        plan,
        version: digest(archive),
        targets,
        directoryIdentity: await this.directoryIdentity(p.decks),
        expiresAt: Date.now() + 10 * 60000,
      });
      return structuredClone(plan);
    });
  }
  deploy(token: string, alert?: DeckSwitchAlert): Promise<DeckRestoreResult> {
    return this.exclusive(async () => {
      const snapshot = this.restores.get(token);
      this.restores.delete(token);
      if (!snapshot || snapshot.expiresAt <= Date.now()) throw new Error('DECK_RESTORE_EXPIRED');
      const { plan } = snapshot;
      const p = await this.paths();
      this.checkDirectory(p.decks, plan.directory);
      if (!p.found || (await this.directoryIdentity(p.decks)) !== snapshot.directoryIdentity)
        throw new Error('DECK_DIRECTORY_CHANGED');
      if (
        alert &&
        (alert.version !== snapshot.version ||
          directoryKey(alert.directory) !== directoryKey(p.decks))
      )
        throw new Error('DECK_RESTORE_CHANGED');
      const archive = await this.archive(p.backups, plan.name);
      if (digest(archive) !== snapshot.version) throw new Error('DECK_RESTORE_CHANGED');
      const entries = await zipExtract(archive);
      const originals: ZipEntry[] = [];
      let originalBytes = 0;
      for (const entry of entries) {
        const data = await this.currentDeck(p.decks, entry.name);
        if ((data === null ? null : digest(data)) !== snapshot.targets.get(entry.name))
          throw new Error('DECK_RESTORE_CHANGED');
        if (data !== null) {
          originalBytes += data.length;
          if (originalBytes > ZIP_LIMITS.total)
            throw new Error('Deck recovery backup exceeds size limit');
          originals.push({ name: entry.name, data });
        }
      }
      let recoveryBackup: string | null = null;
      if (originals.length) {
        recoveryBackup = `before-restore-${Date.now()}-${randomUUID().slice(0, 8)}.zip`;
        await atomicWrite(p.backups, recoveryBackup, await zipCreate(originals), false);
      }
      const result: DeckRestoreResult = {
        deployed: 0,
        completed: [],
        failed: [],
        skipped: [],
        recoveryBackup,
      };
      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index]!;
        try {
          const current = await this.currentDeck(p.decks, entry.name);
          if ((current === null ? null : digest(current)) !== snapshot.targets.get(entry.name))
            throw new Error('DECK_RESTORE_CHANGED');
          await atomicWrite(p.decks, entry.name, entry.data, current !== null);
          result.completed.push(entry.name);
          result.deployed++;
        } catch (error) {
          result.failed.push({ name: entry.name, message: errorMessage(error) });
          result.skipped = entries.slice(index + 1).map((remaining) => remaining.name);
          break;
        }
      }
      return result;
    });
  }
  remove(
    kind: 'decks' | 'backups',
    names: string[],
    directory?: string,
  ): Promise<DeckOperationResult & { removed: number }> {
    return this.exclusive(async () => {
      const p = await this.paths(),
        root = kind === 'decks' ? p.decks : p.backups;
      this.checkDirectory(p.decks, directory);
      if (!p.found) throw new Error('Deck directory not found');
      const targets = [...new Set(names)].map((name) => ({
        name,
        path: childPath(root, name, kind === 'decks' ? '.dek' : '.zip'),
      }));
      const result: DeckOperationResult & { removed: number } = {
        removed: 0,
        completed: [],
        failed: [],
        skipped: [],
      };
      for (const target of targets) {
        try {
          const info = await lstat(target.path);
          if (!info.isFile() || info.isSymbolicLink()) throw new Error('DECK_UNSAFE_TARGET');
          await unlink(target.path);
          result.completed.push(target.name);
          result.removed++;
        } catch (error) {
          result.failed.push({ name: target.name, message: errorMessage(error) });
        }
      }
      return result;
    });
  }
  async onMatchStart(session: Session): Promise<void> {
    const owner = structuredClone(session);
    await this.exclusive(async () => {
      const p = await this.paths();
      if (!p.found) return;
      const files = await this.files(p.decks, '.dek');
      if (!files.length) return;
      const backup = await this.createBackup(
        p,
        files.map((file) => file.name),
        PREVIOUS,
        true,
      );
      const state: DeckState = {
        pkgKey: owner.accountKey,
        pkgName: owner.localName,
        pkgFid: owner.current?.fid ?? null,
        pkgUpdatedAt: Date.now(),
        alertedPairs: [],
        directory: p.decks,
        version: backup.version,
      };
      this.db.setState('deckSync', state);
    });
  }
  switchAlert(session: Session): Promise<DeckSwitchAlert | null> {
    const target = structuredClone(session);
    return this.exclusive(() => this.readSwitchAlert(target));
  }
  private async readSwitchAlert(session: Session): Promise<DeckSwitchAlert | null> {
    const raw = object(this.db.state('deckSync', {})),
      key = text(raw.pkgKey);
    if (!session.loginSeen || !session.accountKey || !key || key === session.accountKey)
      return null;
    const pair = key + '>' + session.accountKey,
      alerted = array(raw.alertedPairs).map((v) => text(v));
    if (alerted.includes(pair)) return null;
    const p = await this.paths();
    if (!p.found || !raw.directory || directoryKey(p.decks) !== directoryKey(text(raw.directory)))
      return null;
    let entries;
    try {
      const archive = await this.archive(p.backups, PREVIOUS);
      if (digest(archive) !== text(raw.version)) return null;
      entries = await zipExtract(archive);
    } catch (error) {
      if (object(error).code === 'ENOENT') return null;
      throw error;
    }
    this.db.setState('deckSync', { ...raw, alertedPairs: [...alerted, pair] });
    return {
      pair,
      from: text(raw.pkgName, key),
      to: session.localName,
      count: entries.length,
      names: entries.map((e) => e.name),
      fid: text(raw.pkgFid) || null,
      directory: p.decks,
      version: text(raw.version),
      toKey: session.accountKey,
    };
  }
  isCurrentAlert(alert: DeckSwitchAlert): boolean {
    const state = object(this.db.state('deckSync', {}));
    const configured = this.db.config().decksDir;
    return (
      text(state.version) === alert.version &&
      text(state.directory) === alert.directory &&
      alert.pair === text(state.pkgKey) + '>' + alert.toKey &&
      text(state.pkgKey) !== alert.toKey &&
      (!configured || directoryKey(configured) === directoryKey(alert.directory))
    );
  }
  async switchAction(
    action: 'restore' | 'ignore' | 'dismiss',
    token?: string,
    alert?: DeckSwitchAlert,
  ): Promise<DeckRestoreResult | null> {
    if (action !== 'restore') return null;
    if (!token || !alert) throw new Error('DECK_RESTORE_CHANGED');
    return this.deploy(token, alert);
  }
}
