import { createHash, randomUUID } from 'node:crypto';
import type { Match, Session, TeamId } from '@ba/contracts';
import { emptyMatch, emptyPlayer, mapId, team } from '@ba/shared';
export type LogEvent =
  | { type: 'session'; session: Session }
  | { type: 'started' | 'ended' | 'metadata'; match: Match; recovering: boolean }
  | { type: 'reset'; generation: number };
export class LogParser {
  private session: Session = {
    generation: 0,
    phase: 'idle',
    localName: '',
    localPlayerId: null,
    accountKey: '',
    loginSeen: false,
    localDeck: '',
    lobbyId: '',
    lobbyPlayers: [],
    current: null,
    recovering: false,
  };
  private ended: Match[] = [];
  private source = '';
  private lineNumber = 0;
  private loggedAt: number | null = null;
  private currentRecovered = false;
  private connection = '';
  private connections = new Map<string, string>();
  private listing = false;
  constructor(
    private emit: (event: LogEvent) => void,
    private now: () => number = Date.now,
  ) {}
  snapshot(): Session {
    return structuredClone(this.session);
  }
  reset(source = ''): void {
    const generation = this.session.generation + 1;
    this.session = {
      generation,
      phase: 'idle',
      localName: '',
      localPlayerId: null,
      accountKey: '',
      loginSeen: false,
      localDeck: '',
      lobbyId: '',
      lobbyPlayers: [],
      current: null,
      recovering: false,
    };
    this.ended = [];
    this.source = source;
    this.lineNumber = 0;
    this.loggedAt = null;
    this.currentRecovered = false;
    this.connection = '';
    this.connections.clear();
    this.listing = false;
    this.emit({ type: 'reset', generation });
    this.emit({ type: 'session', session: this.snapshot() });
  }
  feed(lines: string[], recovering = false): void {
    this.session.recovering = recovering;
    for (const raw of lines) {
      this.lineNumber++;
      this.line(raw.replace(/\r$/, ''), recovering);
    }
    this.resolveLocal();
    this.emit({ type: 'session', session: this.snapshot() });
  }
  recovered(): void {
    this.session.recovering = false;
    this.emit({ type: 'session', session: this.snapshot() });
  }
  isRecoveredMatch(): boolean {
    return this.currentRecovered;
  }
  private time(recovering: boolean): number | null {
    return this.loggedAt ?? (recovering ? null : this.now());
  }
  private resolveLocal(): void {
    const players = this.session.current?.players ?? this.session.lobbyPlayers;
    const names = players.filter((p) => p.name === this.session.localName);
    this.session.localPlayerId = names.length === 1 ? (names[0]?.id ?? null) : null;
    if (this.session.current) {
      this.session.current.localPlayerId = this.session.localPlayerId;
      this.session.current.localPersona = this.session.localName;
    }
  }
  private player(id: string, name: string, teamId: TeamId): void {
    const match = this.session.current;
    if (!match) return;
    const previous = match.players.find((p) => p.id === id);
    if (previous) {
      previous.name = name;
      if (teamId !== null) previous.teamId = teamId;
    } else match.players.push({ ...emptyPlayer(id, name), teamId });
    this.resolveLocal();
  }
  private start(map: string, scenario: string, recovering: boolean): void {
    if (this.session.current) this.end(recovering);
    const id =
        this.source || recovering
          ? createHash('sha256')
              .update(
                JSON.stringify([
                  this.source,
                  this.lineNumber,
                  this.loggedAt,
                  map,
                  scenario,
                  this.session.localName,
                ]),
              )
              .digest('hex')
              .slice(0, 32)
          : randomUUID(),
      match = emptyMatch('local:' + id, this.time(recovering));
    match.sessionId = id;
    match.map = map;
    match.mapId = mapId(map);
    match.scenario = scenario;
    match.localDeck = this.session.localDeck;
    match.localPersona = this.session.localName;
    this.session.current = match;
    this.currentRecovered = recovering;
    if (this.connection) this.connections.set(id, this.connection);
    this.session.phase = 'match';
    this.listing = false;
    this.emit({ type: 'started', match: structuredClone(match), recovering });
  }
  private end(recovering: boolean): void {
    const match = this.session.current;
    if (!match) return;
    match.endedAt = this.time(recovering);
    match.updatedAt = match.endedAt ?? (recovering ? 0 : this.now());
    if (
      match.durationSec === null &&
      match.startedAt !== null &&
      match.endedAt !== null &&
      match.endedAt >= match.startedAt
    ) {
      match.durationSec = Math.round((match.endedAt - match.startedAt) / 1000);
      match.durationSource = 'estimated';
    }
    this.resolveLocal();
    this.ended.push(structuredClone(match));
    if (this.ended.length > 20) {
      const removed = this.ended.shift();
      if (removed) this.connections.delete(removed.sessionId);
    }
    this.session.current = null;
    this.currentRecovered = false;
    this.session.phase = 'lobby';
    this.listing = false;
    this.emit({ type: 'ended', match: structuredClone(match), recovering });
  }
  private line(line: string, recovering: boolean): void {
    line = line.replace(/^\uFEFF/, '');
    let m: RegExpExecArray | null;
    if ((m = /^\[(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})\]$/.exec(line))) {
      const date = new Date(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        Number(m[4]),
        Number(m[5]),
        Number(m[6]),
        Number(m[7]),
      );
      this.loggedAt = Number.isFinite(date.getTime()) ? date.getTime() : null;
      return;
    }
    if (/^Log: \[NET_ROOM\] Network lifecycle .*Action=Entered\b/.test(line)) {
      const ip = /\bConnectionIp=([^ |]+)/.exec(line)?.[1] ?? /\bServerIp=([^ |]+)/.exec(line)?.[1],
        port = /\bConnectionPort=(\d+)/.exec(line)?.[1] ?? /\bServerPort=(\d+)/.exec(line)?.[1];
      if (ip && port) {
        this.connection = `${ip}:${port}`;
        const fid = /\bFightId=(\d+)/.exec(line)?.[1];
        const current = this.session.current;
        if (current && (!current.fid || current.fid === fid))
          this.connections.set(current.sessionId, this.connection);
      }
      return;
    }
    if ((m = /^Log: GetPersonaName\s+(.+)$/.exec(line))) {
      this.session.localName = m[1]?.trim() || '';
      this.session.accountKey = 'persona:' + this.session.localName;
      this.resolveLocal();
      return;
    }
    if (/^Log: \[AUTH\] Rest: Login success/.test(line)) {
      this.session.loginSeen = true;
      return;
    }
    if (
      (m = /^Log: (?:\[LOBBY\] )?Enter to lobby \(id: (\d+)\)/.exec(line)) ||
      /^Log: (?:\[LOBBY\] )?Exit lobby/.test(line)
    ) {
      // New games log both tagged and plain exit notifications.
      if (!m && !this.session.current && !this.session.lobbyId && this.session.phase === 'idle')
        return;
      if (this.session.current) this.end(recovering);
      this.session.lobbyId = m?.[1] || '';
      this.session.lobbyPlayers = [];
      this.session.phase = m ? 'lobby' : 'idle';
      this.listing = false;
      this.session.generation++;
      this.emit({ type: 'reset', generation: this.session.generation });
      return;
    }
    if ((m = /^Log: Incoming client (.*?):(\d+) to lobby/.exec(line))) {
      const id = m[2] || '',
        name = m[1]?.trim() || id,
        old = this.session.lobbyPlayers.find((p) => p.id === id);
      if (old) old.name = name;
      else this.session.lobbyPlayers.push({ id, name, teamId: null });
      this.session.phase = this.session.current ? 'match' : 'lobby';
      return;
    }
    if ((m = /^Log: Outgoing client (.*?):(\d+) exit/.exec(line))) {
      this.session.lobbyPlayers = this.session.lobbyPlayers.filter((p) => p.id !== m?.[2]);
      return;
    }
    if ((m = /^Log: Start loading battle\.\.\. map: ([^,]+),\s*scenario:\s*(.*)$/.exec(line))) {
      const current = this.session.current;
      if (current && !current.map && !current.scenario) {
        current.map = m[1]?.trim() || '';
        current.mapId = mapId(current.map);
        current.scenario = m[2]?.trim() || '';
        return;
      }
      this.start(m[1]?.trim() || '', m[2]?.trim() || '', recovering);
      return;
    }
    if (/^Log: (?:\[NET_ROOM\] GameRoom entered|Room entered - GameRoom)/.test(line)) {
      if (!this.session.current) this.start('', '', recovering);
      const fid = /fight id:\s*(\d+)/.exec(line)?.[1];
      if (fid && this.session.current) {
        this.session.current.fid = fid;
        this.session.current.id = fid;
      }
      return;
    }
    if (/^Log: Player list:\s*$/.test(line)) {
      this.listing = true;
      return;
    }
    if (
      this.listing &&
      (m = /^ID:\s*(\d+),?\s+Name:\s*(.*?),?\s*Team:\s*(Alpha|Bravo|Spectators)\s*$/.exec(line))
    ) {
      this.player(m[1] || '', m[2]?.trim() || '', team(m[3]));
      return;
    }
    if ((m = /^Log: Room: \(GameRoom\|\d+\), Client: \(([^|]+)\|(\d+)\)$/.exec(line))) {
      this.player(m[2] || '', m[1]?.trim() || '', null);
      return;
    }
    if ((m = /^Log: FID:(\d+)/.exec(line))) {
      const match = this.session.current;
      if (match) {
        match.fid = m[1] || null;
        match.id = match.fid || match.id;
      }
      return;
    }
    if ((m = /^Log: Deck set to: (.*)$/.exec(line))) {
      const name = m[1]?.trim() || '';
      this.session.localDeck = name.toLowerCase() === 'null' ? '' : name;
      if (this.session.current) this.session.current.localDeck = this.session.localDeck;
      return;
    }
    if ((m = /^Log: TOTAL POINTS: ([0-9.]+)$/.exec(line))) {
      if (this.session.current) this.session.current.points = Number(m[1]);
      return;
    }
    if ((m = /^Log: \[NET_ROOM\] Connection closed\. .*LiveTime: (\d+) sec/.exec(line))) {
      const fid = /\bFightId=(\d+)/.exec(line)?.[1];
      const endpoint = /\bServer ([^,\s]+)/.exec(line)?.[1];
      let candidates = [
        ...this.ended.filter((match) => match.durationSource !== 'log'),
        ...(this.session.current ? [this.session.current] : []),
      ];
      if (fid) candidates = candidates.filter((match) => match.fid === fid);
      else if (endpoint && candidates.some((match) => this.connections.has(match.sessionId)))
        candidates = candidates.filter(
          (match) => this.connections.get(match.sessionId) === endpoint,
        );
      // Without connection identity, a pending ended match takes priority over a new one.
      const pending = candidates.filter((match) => match !== this.session.current);
      const match =
        pending.length === 1 ? pending[0] : candidates.length === 1 ? candidates[0] : null;
      if (match) {
        match.durationSec = Number(m[1]);
        match.durationSource = 'log';
        match.updatedAt = this.time(recovering) ?? match.updatedAt;
        this.emit({ type: 'metadata', match: structuredClone(match), recovering });
      }
      return;
    }
    if (
      /^Log: GameController dispose called|^Log: \[NET_ROOM\] GameRoom exited|^Log: LoadSceneAsync: Hangar_Scene\b|^Log: Exit button pressed, exiting the game/.test(
        line,
      )
    )
      this.end(recovering);
  }
}
