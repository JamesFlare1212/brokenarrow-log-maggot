import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { stat, lstat, readdir, readFile, unlink } from 'node:fs/promises';
import type { DeckFile, DeckList, DeckSwitchAlert, Session } from '@ba/contracts';
import { filename, object, text, array } from '@ba/shared';
import type { Database } from '../storage/database';
import { childPath, atomicWrite } from '../files/paths';
import { zipCreate, zipExtract, ZIP_LIMITS } from './zip';
const PREVIOUS = '上一局卡组包.zip';
interface DeckState {
  pkgKey: string;
  pkgName: string;
  pkgFid: string | null;
  pkgUpdatedAt: number;
  alertedPairs: string[];
}
export class DeckService {
  private queue: Promise<unknown> = Promise.resolve();
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
  backup(names: string[], packageName: string): Promise<{ name: string }> {
    return this.createBackup(names, packageName, false);
  }
  private createBackup(
    names: string[],
    packageName: string,
    replaceExisting: boolean,
  ): Promise<{ name: string }> {
    return this.exclusive(async () => {
      const p = await this.paths();
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
      try {
        await atomicWrite(p.backups, name, await zipCreate(files), replaceExisting);
      } catch (error) {
        if (object(error).code === 'EEXIST')
          throw new Error('Deck backup already exists; choose a different name');
        throw error;
      }
      return { name };
    });
  }
  deploy(name: string): Promise<{ deployed: number }> {
    return this.exclusive(async () => {
      const p = await this.paths();
      if (!p.found) throw new Error('Deck directory not found');
      const path = childPath(p.backups, name, '.zip'),
        info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > ZIP_LIMITS.total)
        throw new Error('Unsafe deck backup');
      const entries = await zipExtract(await readFile(path));
      for (const e of entries) await atomicWrite(p.decks, e.name, e.data);
      return { deployed: entries.length };
    });
  }
  remove(kind: 'decks' | 'backups', names: string[]): Promise<{ removed: number }> {
    return this.exclusive(async () => {
      const p = await this.paths(),
        root = kind === 'decks' ? p.decks : p.backups;
      if (!p.found) throw new Error('Deck directory not found');
      let removed = 0;
      for (const name of names) {
        await unlink(childPath(root, name, kind === 'decks' ? '.dek' : '.zip'));
        removed++;
      }
      return { removed };
    });
  }
  async onMatchStart(session: Session): Promise<void> {
    const list = await this.list();
    if (!list.found || !list.decks.length) return;
    await this.createBackup(
      list.decks.map((f) => f.name),
      PREVIOUS,
      true,
    );
    const state: DeckState = {
      pkgKey: session.accountKey,
      pkgName: session.localName,
      pkgFid: session.current?.fid ?? null,
      pkgUpdatedAt: Date.now(),
      alertedPairs: [],
    };
    this.db.setState('deckSync', state);
  }
  async switchAlert(session: Session): Promise<DeckSwitchAlert | null> {
    const raw = object(this.db.state('deckSync', {})),
      key = text(raw.pkgKey);
    if (!session.loginSeen || !session.accountKey || !key || key === session.accountKey)
      return null;
    const pair = key + '>' + session.accountKey,
      alerted = array(raw.alertedPairs).map((v) => text(v));
    if (alerted.includes(pair)) return null;
    const p = await this.paths();
    if (!p.found) return null;
    let entries;
    try {
      entries = await zipExtract(await readFile(childPath(p.backups, PREVIOUS, '.zip')));
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
    };
  }
  async switchAction(action: 'restore' | 'ignore' | 'dismiss'): Promise<void> {
    if (action === 'restore') await this.deploy(PREVIOUS);
  }
}
