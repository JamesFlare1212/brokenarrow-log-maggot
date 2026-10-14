export type PlaneKind = 'normal' | 'sead' | 'jam' | 'b2';
export type UpgradeId =
  'fire' | 'volley' | 'guide' | 'splash' | 'range' | 'move' | 'ciws' | 'quick';
export type GamePhase = 'playing' | 'upgrade' | 'over';

export interface Plane {
  kind: PlaneKind;
  hp: number;
  x: number;
  y: number;
  vx: number;
  seadCooldown: number;
  gone: boolean;
}

export interface Missile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  target: Plane | null;
  lost: boolean;
  fade: number;
  gone: boolean;
}

export interface SeadMissile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  locked: boolean;
  fade: number;
  gone: boolean;
}

export interface Artillery {
  x: number;
  warning: number;
  impact: boolean;
  done: boolean;
  hit: boolean;
}

export interface GameState {
  phase: GamePhase;
  radarOn: boolean;
  spinup: number;
  spinupBase: number;
  score: number;
  time: number;
  x: number;
  targetX: number;
  moving: boolean;
  moveSpeed: number;
  fireCooldown: number;
  fireTimer: number;
  volley: number;
  range: number;
  guidance: number;
  splash: boolean;
  ciws: number;
  kills: Record<PlaneKind, number> & { total: number };
  nextUpgradeAt: number;
  upgradeCount: number;
  upgradeOptions: UpgradeId[];
  normalTimer: number;
  seadTimer: number;
  jamTimer: number;
  b2Timer: number;
  artilleryTimer: number;
  planes: Plane[];
  missiles: Missile[];
  seadMissiles: SeadMissile[];
  artillery: Artillery[];
}

export interface GameHud {
  phase: GamePhase;
  radar: 'on' | 'off' | 'spinup';
  score: number;
  seconds: number;
  moving: boolean;
  jammed: boolean;
  ciws: number;
  kills: GameState['kills'];
  nextUpgradeAt: number;
  fireCooldown: number;
  volley: number;
  guidance: number;
  splash: boolean;
  upgrades: readonly UpgradeId[];
}

interface EngineOptions {
  width: number;
  height: number;
  random?: () => number;
  onHud?: (hud: GameHud) => void;
  onGameOver?: (hud: GameHud) => void;
}

export function createGameState(width: number): GameState {
  return {
    phase: 'playing',
    radarOn: true,
    spinup: 0,
    spinupBase: 0.5,
    score: 0,
    time: 0,
    x: width / 2,
    targetX: width / 2,
    moving: false,
    moveSpeed: 260,
    fireCooldown: 1.6,
    fireTimer: 0,
    volley: 1,
    range: 260,
    guidance: 0,
    splash: false,
    ciws: 0,
    kills: { normal: 0, sead: 0, jam: 0, b2: 0, total: 0 },
    nextUpgradeAt: 8,
    upgradeCount: 0,
    upgradeOptions: [],
    normalTimer: 1.8,
    seadTimer: 6,
    jamTimer: 15,
    b2Timer: 26,
    artilleryTimer: 14,
    planes: [],
    missiles: [],
    seadMissiles: [],
    artillery: [],
  };
}

/** Simulation owns mutable frame data; React receives small immutable HUD snapshots. */
export class GameEngine {
  readonly state: GameState;
  readonly width: number;
  readonly height: number;
  private readonly random: () => number;
  private readonly onHud: ((hud: GameHud) => void) | undefined;
  private readonly onGameOver: ((hud: GameHud) => void) | undefined;
  private lastHudTime = -Infinity;
  private lastHudSignature = '';

  constructor(options: EngineOptions) {
    this.width = Math.max(320, options.width);
    this.height = Math.max(220, options.height);
    this.state = createGameState(this.width);
    this.random = options.random ?? Math.random;
    this.onHud = options.onHud;
    this.onGameOver = options.onGameOver;
    this.emitHud(true);
  }

  getHud(): GameHud {
    const s = this.state;
    return {
      phase: s.phase,
      radar: s.radarOn ? 'on' : s.spinup > 0 ? 'spinup' : 'off',
      score: Math.round(s.score),
      seconds: Math.floor(s.time),
      moving: s.moving,
      jammed: s.planes.some((plane) => plane.kind === 'jam' && !plane.gone),
      ciws: s.ciws,
      kills: { ...s.kills },
      nextUpgradeAt: s.nextUpgradeAt,
      fireCooldown: s.fireCooldown,
      volley: s.volley,
      guidance: s.guidance,
      splash: s.splash,
      upgrades: [...s.upgradeOptions],
    };
  }

  toggleRadar(): void {
    const s = this.state;
    if (s.phase !== 'playing' || s.moving) return;
    if (s.radarOn) {
      s.radarOn = false;
      s.spinup = 0;
    } else if (s.spinup > 0) s.spinup = 0;
    else s.spinup = s.spinupBase;
    this.emitHud(true);
  }

  moveTo(x: number): void {
    const s = this.state;
    if (s.phase !== 'playing' || !Number.isFinite(x)) return;
    s.targetX = Math.max(24, Math.min(this.width - 24, x));
    s.moving = Math.abs(s.targetX - s.x) > 0.5;
    s.radarOn = false;
    s.spinup = 0;
    this.emitHud(true);
  }

  chooseUpgrade(id: UpgradeId): void {
    const s = this.state;
    if (s.phase !== 'upgrade' || !s.upgradeOptions.includes(id)) return;
    switch (id) {
      case 'fire':
        s.fireCooldown = Math.max(0.55, s.fireCooldown * 0.75);
        break;
      case 'volley':
        s.volley = Math.min(3, s.volley + 1);
        break;
      case 'guide':
        s.guidance = Math.min(3, s.guidance + 1);
        break;
      case 'splash':
        s.splash = true;
        break;
      case 'range':
        s.range = Math.min(400, s.range + 70);
        break;
      case 'move':
        s.moveSpeed = Math.min(878, s.moveSpeed * 1.5);
        break;
      case 'ciws':
        s.ciws = Math.min(3, s.ciws + 1);
        break;
      case 'quick':
        s.spinupBase = Math.max(0.1, s.spinupBase / 2);
        break;
    }
    s.phase = 'playing';
    s.upgradeOptions = [];
    this.emitHud(true);
  }

  step(deltaSeconds: number): void {
    const s = this.state;
    if (s.phase !== 'playing' || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    const dt = Math.min(0.05, deltaSeconds);
    s.time += dt;
    if (s.spinup > 0) {
      s.spinup = Math.max(0, s.spinup - dt);
      if (s.spinup < 0.000001) {
        s.spinup = 0;
        s.radarOn = true;
      }
    }
    if (s.moving) {
      const distance = s.targetX - s.x;
      const movement = s.moveSpeed * dt;
      if (Math.abs(distance) <= movement) {
        s.x = s.targetX;
        s.moving = false;
      } else s.x += Math.sign(distance) * movement;
    }
    this.spawn(dt);
    const jammed = s.planes.some((plane) => plane.kind === 'jam' && !plane.gone);
    for (const plane of s.planes) {
      if (
        !plane.gone &&
        plane.kind === 'sead' &&
        s.radarOn &&
        !s.moving &&
        Math.abs(plane.x - s.x) <= s.range * 1.25 &&
        plane.y > 0
      ) {
        plane.seadCooldown -= dt;
        if (plane.seadCooldown <= 0) {
          plane.seadCooldown = Math.max(2.8, 3.6 - s.time * 0.003);
          this.fireSead(plane);
        }
      }
    }
    s.fireTimer -= dt;
    if (s.radarOn && !s.moving && s.fireTimer <= 0) {
      if (this.nearestTarget(s.x)) {
        this.fireVolley();
        s.fireTimer = s.fireCooldown * (jammed ? 1.35 : 1);
      } else s.fireTimer = 0.15;
    }
    this.guideMissiles(dt);
    // An upgrade pauses combat immediately, including artillery and hostile missiles.
    if (this.state.phase === 'upgrade') {
      this.removeExpired();
      this.emitHud(true);
      return;
    }
    for (const missile of s.seadMissiles) {
      if (missile.gone) continue;
      if (missile.locked) {
        if (!s.radarOn) {
          missile.locked = false;
          missile.fade = 1.4;
          missile.vx = (this.random() - 0.5) * 150;
          missile.vy = -50 - this.random() * 80;
        } else {
          const dx = s.x - missile.x,
            dy = this.height - 28 - missile.y;
          const distance = Math.hypot(dx, dy) || 1;
          missile.vx = (dx / distance) * missile.speed;
          missile.vy = (dy / distance) * missile.speed;
        }
      }
      missile.x += missile.vx * dt;
      missile.y += missile.vy * dt;
      if (!missile.locked) {
        missile.fade -= dt;
        if (missile.fade <= 0) missile.gone = true;
      } else if (Math.hypot(missile.x - s.x, missile.y - (this.height - 28)) < 16) {
        missile.gone = true;
        if (!this.surviveImpact()) return;
      }
      if (missile.y > this.height + 40 || missile.x < -40 || missile.x > this.width + 40)
        missile.gone = true;
    }
    s.artilleryTimer -= dt;
    if (s.artilleryTimer <= 0) {
      s.artilleryTimer = Math.max(6, 14 - s.time * 0.025);
      s.artillery.push({ x: s.x, warning: 4, impact: false, done: false, hit: false });
    }
    for (const shell of s.artillery) {
      shell.warning -= dt;
      if (shell.warning <= 0 && !shell.impact) {
        shell.impact = true;
        if (Math.abs(s.x - shell.x) < 44) {
          shell.hit = true;
          if (!this.surviveImpact()) return;
        }
      }
      if (shell.impact && shell.warning <= -0.4) shell.done = true;
    }
    for (const plane of s.planes) {
      plane.x += plane.vx * dt;
      if (plane.x < -70 || plane.x > this.width + 70) plane.gone = true;
    }
    this.removeExpired();
    s.score += dt;
    this.emitHud();
  }

  private emitHud(force = false): void {
    if (!force && this.state.time - this.lastHudTime < 0.1) return;
    this.lastHudTime = this.state.time;
    const hud = this.getHud();
    const signature = JSON.stringify(hud);
    if (signature === this.lastHudSignature) return;
    this.lastHudSignature = signature;
    this.onHud?.(hud);
  }

  private surviveImpact(): boolean {
    if (this.state.ciws > 0) {
      this.state.ciws--;
      return true;
    }
    this.state.phase = 'over';
    this.state.upgradeOptions = [];
    this.emitHud(true);
    this.onGameOver?.(this.getHud());
    return false;
  }

  private removeExpired(): void {
    const s = this.state;
    s.planes = s.planes.filter((plane) => !plane.gone);
    s.missiles = s.missiles.filter((missile) => !missile.gone);
    s.seadMissiles = s.seadMissiles.filter((missile) => !missile.gone);
    s.artillery = s.artillery.filter((shell) => !shell.done);
  }

  private spawn(dt: number): void {
    const s = this.state;
    s.normalTimer -= dt;
    s.seadTimer -= dt;
    s.jamTimer -= dt;
    s.b2Timer -= dt;
    if (s.normalTimer <= 0) {
      s.normalTimer = Math.max(1, 2.6 - s.time * 0.005) * (0.7 + this.random() * 0.6);
      this.spawnPlane('normal');
    }
    if (s.seadTimer <= 0) {
      s.seadTimer = Math.max(4, 8 - s.time * 0.01);
      this.spawnPlane('sead');
    }
    if (s.jamTimer <= 0) {
      s.jamTimer = Math.max(10, 15 - s.time * 0.01);
      this.spawnPlane('jam');
    }
    if (s.b2Timer <= 0) {
      s.b2Timer = Math.max(18, 26 - s.time * 0.01);
      this.spawnPlane('b2');
    }
    if (s.planes.filter((plane) => !plane.gone).length < 2)
      s.normalTimer = Math.min(s.normalTimer, 0.5);
  }

  private spawnPlane(kind: PlaneKind): void {
    const s = this.state;
    if (s.planes.length >= Math.min(20, 14 + Math.floor(s.time / 90))) return;
    const fromLeft = this.random() < 0.5;
    const y = 40 + this.random() * this.height * 0.42;
    const baseSpeed =
      kind === 'normal'
        ? 42 + this.random() * 22
        : kind === 'sead'
          ? 32 + this.random() * 18
          : kind === 'jam'
            ? 46 + this.random() * 18
            : 28 + this.random() * 14;
    const hp =
      kind === 'b2' || (kind === 'normal' && s.time > 120) || (kind === 'jam' && s.time > 150)
        ? 3
        : 2;
    s.planes.push({
      kind,
      hp,
      x: fromLeft ? -30 : this.width + 30,
      y,
      vx: (fromLeft ? 1 : -1) * baseSpeed * (1 + Math.min(0.35, s.time * 0.002)),
      seadCooldown: 3.6,
      gone: false,
    });
  }

  private nearestTarget(x: number, excluded?: ReadonlySet<Plane>): Plane | null {
    let target: Plane | null = null;
    let closest = Infinity;
    for (const plane of this.state.planes) {
      if (plane.gone || plane.y >= this.height - 50 || excluded?.has(plane)) continue;
      const distance = Math.abs(plane.x - x);
      if (distance <= this.state.range && distance < closest) {
        target = plane;
        closest = distance;
      }
    }
    return target;
  }

  private fireVolley(): void {
    const s = this.state;
    const speed = 360 + s.guidance * 40;
    for (let i = 0; i < s.volley; i++) {
      s.missiles.push({
        x: s.x + (i - (s.volley - 1) / 2) * 10,
        y: this.height - 36,
        vx: 0,
        vy: -speed,
        speed,
        target: null,
        lost: false,
        fade: 0,
        gone: false,
      });
    }
  }

  private fireSead(plane: Plane): void {
    const dx = this.state.x - plane.x,
      dy = this.height - 28 - plane.y;
    const distance = Math.hypot(dx, dy) || 1;
    this.state.seadMissiles.push({
      x: plane.x,
      y: plane.y + 10,
      vx: (dx / distance) * 240,
      vy: (dy / distance) * 240,
      speed: 240,
      locked: true,
      fade: 0,
      gone: false,
    });
  }

  private guideMissiles(dt: number): void {
    const s = this.state;
    const chasing = new Set<Plane>();
    for (const missile of s.missiles) {
      if (missile.gone) continue;
      const target = s.radarOn
        ? (this.nearestTarget(missile.x, chasing) ?? this.nearestTarget(missile.x))
        : null;
      missile.target = target;
      missile.lost = target === null;
      if (target) {
        chasing.add(target);
        missile.fade = 0;
      }
    }
    for (const missile of s.missiles) {
      if (missile.gone) continue;
      if (missile.lost) {
        if (missile.fade <= 0) missile.fade = 1.2;
        missile.fade -= dt;
        if (missile.fade <= 0) {
          missile.gone = true;
          continue;
        }
      } else {
        const target = missile.target;
        if (!target || target.gone) {
          missile.lost = true;
          continue;
        }
        const dx = target.x - missile.x,
          dy = target.y - missile.y;
        const distance = Math.hypot(dx, dy) || 1;
        missile.vx = (dx / distance) * missile.speed;
        missile.vy = (dy / distance) * missile.speed;
        if (distance <= missile.speed * dt + 12 + s.guidance * 5) {
          this.hit(target);
          if (s.splash) {
            for (const plane of s.planes) {
              if (
                !plane.gone &&
                plane !== target &&
                Math.hypot(plane.x - target.x, plane.y - target.y) < 26
              )
                this.hit(plane);
            }
          }
          missile.gone = true;
          continue;
        }
      }
      missile.x += missile.vx * dt;
      missile.y += missile.vy * dt;
      if (missile.y < -40 || missile.x < -40 || missile.x > this.width + 40) missile.gone = true;
    }
  }

  private hit(plane: Plane): void {
    plane.hp--;
    if (plane.hp > 0 || plane.gone) return;
    const s = this.state;
    plane.gone = true;
    s.score += { normal: 10, sead: 15, jam: 20, b2: 80 }[plane.kind];
    s.kills[plane.kind]++;
    s.kills.total++;
    if (s.phase === 'playing' && s.kills.total >= s.nextUpgradeAt) {
      s.nextUpgradeAt += 8 + s.upgradeCount * 2;
      s.upgradeCount++;
      const options = this.pickUpgrades();
      if (options.length) {
        s.phase = 'upgrade';
        s.upgradeOptions = options;
      } else s.score += 100;
      this.emitHud(true);
    }
  }

  private pickUpgrades(): UpgradeId[] {
    const s = this.state;
    const pool: UpgradeId[] = [];
    if (s.fireCooldown > 0.55) pool.push('fire');
    if (s.volley < 3) pool.push('volley');
    if (s.guidance < 3) pool.push('guide');
    if (!s.splash) pool.push('splash');
    if (s.range < 400) pool.push('range');
    if (s.moveSpeed < 878) pool.push('move');
    if (s.ciws < 3) pool.push('ciws');
    if (s.spinupBase > 0.1) pool.push('quick');
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      const a = pool[i],
        b = pool[j];
      if (a !== undefined && b !== undefined) {
        pool[i] = b;
        pool[j] = a;
      }
    }
    return pool.slice(0, 3);
  }
}
