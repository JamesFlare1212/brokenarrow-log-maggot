import { randomUUID } from 'node:crypto';
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
  private lastEnded: Match | null = null;
  private listing = false;
  constructor(
    private emit: (event: LogEvent) => void,
    private now: () => number = Date.now,
  ) {}
  snapshot(): Session {
    return structuredClone(this.session);
  }
  reset(): void {
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
    this.lastEnded = null;
    this.listing = false;
    this.emit({ type: 'reset', generation });
    this.emit({ type: 'session', session: this.snapshot() });
  }
  feed(lines: string[], recovering = false): void {
    this.session.recovering = recovering;
    for (const raw of lines) this.line(raw.replace(/\r$/, ''), recovering);
    this.resolveLocal();
    this.emit({ type: 'session', session: this.snapshot() });
  }
  recovered(): void {
    this.session.recovering = false;
    this.emit({ type: 'session', session: this.snapshot() });
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
    const id = randomUUID(),
      match = emptyMatch('local:' + id, recovering ? null : this.now());
    match.sessionId = id;
    match.map = map;
    match.mapId = mapId(map);
    match.scenario = scenario;
    match.localDeck = this.session.localDeck;
    match.localPersona = this.session.localName;
    this.session.current = match;
    this.session.phase = 'match';
    this.listing = false;
    this.emit({ type: 'started', match: structuredClone(match), recovering });
  }
  private end(recovering: boolean): void {
    const match = this.session.current;
    if (!match) return;
    match.endedAt = recovering ? null : this.now();
    match.updatedAt = this.now();
    if (match.durationSec === null && !recovering && match.startedAt !== null) {
      match.durationSec = Math.max(0, Math.round((this.now() - match.startedAt) / 1000));
      match.durationSource = 'estimated';
    }
    this.resolveLocal();
    this.lastEnded = structuredClone(match);
    this.session.current = null;
    this.session.phase = 'lobby';
    this.listing = false;
    this.emit({ type: 'ended', match: structuredClone(match), recovering });
  }
  private line(line: string, recovering: boolean): void {
    line = line.replace(/^\uFEFF/, '');
    let m: RegExpExecArray | null;
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
    if ((m = /^Log: Enter to lobby \(id: (\d+)\)/.exec(line)) || /^Log: Exit lobby/.test(line)) {
      if (this.session.current) this.end(recovering);
      this.session.lobbyId = m?.[1] || '';
      this.session.lobbyPlayers = [];
      this.session.phase = m ? 'lobby' : 'idle';
      this.lastEnded = null;
      this.listing = false;
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
      this.start(m[1]?.trim() || '', m[2]?.trim() || '', recovering);
      return;
    }
    if (/^Log: \[NET_ROOM\] GameRoom entered/.test(line)) {
      if (!this.session.current) this.start('', '', recovering);
      return;
    }
    if (/^Log: Player list:\s*$/.test(line)) {
      this.listing = true;
      return;
    }
    if (this.listing && (m = /^ID: (\d+), Name: (.*?), Team: (\w+)$/.exec(line))) {
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
      const match = this.session.current ?? this.lastEnded;
      if (match) {
        match.durationSec = Number(m[1]);
        match.durationSource = 'log';
        match.updatedAt = this.now();
        this.emit({ type: 'metadata', match: structuredClone(match), recovering });
      }
      return;
    }
    if (/^Log: GameController dispose called|^Log: \[NET_ROOM\] GameRoom exited/.test(line))
      this.end(recovering);
  }
}
