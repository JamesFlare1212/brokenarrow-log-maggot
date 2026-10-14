import { useEffect, useId, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { Button, Dialog } from '../../components/ui';
import { useI18n } from '../../hooks/useI18n';
import { drawGame } from './canvas';
import { GameEngine } from './engine';
import type { GameHud, UpgradeId } from './engine';
import { gameText, upgradeMessages } from './messages';
import type { GameMessageKey } from './messages';
import './game.css';

const WIDTH = 960;
const HEIGHT = 480;
const BEST_KEY = 'ba_game_best';

function readBestScore(): number {
  try {
    const value = Number(localStorage.getItem(BEST_KEY));
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

function duration(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function GameDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { locale } = useI18n();
  return (
    <Dialog open={open} onClose={onClose} title={gameText(locale, 'title')} className="game-dialog">
      {open && <GameRound locale={locale} onClose={onClose} />}
    </Dialog>
  );
}

function GameRound({ locale, onClose }: { locale: string; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const localeRef = useRef(locale);
  const upgradeRef = useRef<HTMLDivElement>(null);
  const restartRef = useRef<HTMLDivElement>(null);
  const [hud, setHud] = useState<GameHud | null>(null);
  const [best, setBest] = useState(readBestScore);
  const [round, setRound] = useState(0);
  const hintId = useId();
  const t = (key: GameMessageKey, vars?: Record<string, string | number>) =>
    gameText(locale, key, vars);

  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext('2d');
    const engine = new GameEngine({
      width: WIDTH,
      height: HEIGHT,
      onHud: setHud,
      onGameOver: (result) => {
        const previous = readBestScore();
        const highest = Math.max(previous, result.score);
        if (highest > previous) {
          try {
            localStorage.setItem(BEST_KEY, String(highest));
          } catch {
            /* The game also works without storage. */
          }
        }
        setBest(highest);
      },
    });
    engineRef.current = engine;
    let disposed = false;
    let frameId: number | null = null;
    let last = performance.now();
    const draw = () => {
      if (context)
        drawGame(context, engine.state, WIDTH, HEIGHT, (key, vars) =>
          gameText(localeRef.current, key, vars),
        );
    };
    const frame = (now: number) => {
      frameId = null;
      if (disposed) return;
      engine.step((now - last) / 1000);
      last = now;
      draw();
      if (engine.state.phase !== 'over') frameId = requestAnimationFrame(frame);
    };
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        engine.state.phase !== 'playing'
      )
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.matches('input, select, textarea'))
      )
        return;
      if (event.key.toLowerCase() === 'z') {
        event.preventDefault();
        engine.toggleRadar();
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        engine.moveTo(engine.state.targetX + (event.key === 'ArrowLeft' ? -100 : 100));
      }
    };
    window.addEventListener('keydown', onKey);
    draw();
    frameId = requestAnimationFrame(frame);
    canvas.focus();
    return () => {
      disposed = true;
      if (frameId !== null) cancelAnimationFrame(frameId);
      window.removeEventListener('keydown', onKey);
      engineRef.current = null;
    };
  }, [round]);

  useEffect(() => {
    if (hud?.phase === 'upgrade')
      upgradeRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    if (hud?.phase === 'over')
      restartRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [hud?.phase]);

  const move = (offset: number) => {
    const engine = engineRef.current;
    if (engine) engine.moveTo(engine.state.targetX + offset);
    canvasRef.current?.focus();
  };
  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 2 && event.pointerType !== 'touch') return;
    event.preventDefault();
    const engine = engineRef.current;
    const rect = event.currentTarget.getBoundingClientRect();
    if (engine && rect.width > 0) engine.moveTo(((event.clientX - rect.left) * WIDTH) / rect.width);
    canvasRef.current?.focus();
  };
  const chooseUpgrade = (id: UpgradeId) => {
    engineRef.current?.chooseUpgrade(id);
    canvasRef.current?.focus();
  };
  const playing = hud?.phase === 'playing';

  return (
    <div className="game-content">
      <p id={hintId} className="game-hint">
        {t('hint')}
      </p>
      <dl className="game-hud">
        <div>
          <dt>{t('radar')}</dt>
          <dd className={hud?.radar === 'on' ? 'game-radar-on' : 'game-radar-off'}>
            {t(hud?.radar ?? 'on')}
          </dd>
        </div>
        <div>
          <dt>{t('score')}</dt>
          <dd>{hud?.score ?? 0}</dd>
        </div>
        <div>
          <dt>{t('time')}</dt>
          <dd>{duration(hud?.seconds ?? 0)}</dd>
        </div>
        <div>
          <dt>{t('kills')}</dt>
          <dd>
            {hud?.kills.total ?? 0} / {hud?.nextUpgradeAt ?? 8}
          </dd>
        </div>
        <div>
          <dt>{t('best')}</dt>
          <dd>{best}</dd>
        </div>
      </dl>
      <div className="game-stage">
        <canvas
          ref={canvasRef}
          tabIndex={0}
          aria-label={t('canvas')}
          aria-describedby={hintId}
          onPointerDown={onPointerDown}
          onContextMenu={(event) => event.preventDefault()}
        >
          {t('hint')}
        </canvas>
        {hud?.phase === 'upgrade' && (
          <div className="game-overlay">
            <h3 role="status">{t('upgradeTitle')}</h3>
            <p>{t('upgradeHint')}</p>
            <div ref={upgradeRef} className="game-upgrades">
              {hud.upgrades.map((id) => (
                <Button key={id} className="game-upgrade" onClick={() => chooseUpgrade(id)}>
                  <strong>{t(upgradeMessages[id].title)}</strong>
                  <span>{t(upgradeMessages[id].description)}</span>
                </Button>
              ))}
            </div>
          </div>
        )}
        {hud?.phase === 'over' && (
          <div className="game-overlay game-over">
            <h3 role="status">{t('over')}</h3>
            <p>
              {t('score')}: <strong>{hud.score}</strong> · {t('time')}: {duration(hud.seconds)} ·{' '}
              {t('best')}: {best}
            </p>
            <p>{t('killSummary', hud.kills)}</p>
            <div ref={restartRef} className="game-over-actions">
              <Button variant="primary" onClick={() => setRound((value) => value + 1)}>
                {t('restart')}
              </Button>
              <Button onClick={onClose}>{t('close')}</Button>
            </div>
          </div>
        )}
      </div>
      <div className="game-controls">
        <Button
          disabled={!playing || hud?.moving}
          aria-pressed={hud?.radar === 'on'}
          onClick={() => {
            engineRef.current?.toggleRadar();
            canvasRef.current?.focus();
          }}
        >
          {t('radarToggle')}
        </Button>
        <Button disabled={!playing} onClick={() => move(-100)}>
          ← {t('moveLeft')}
        </Button>
        <Button disabled={!playing} onClick={() => move(100)}>
          {t('moveRight')} →
        </Button>
      </div>
      <div className="game-readout">
        <span>{t('cooldown', { s: (hud?.fireCooldown ?? 1.6).toFixed(2) })}</span>
        <span>{t('volley', { n: hud?.volley ?? 1 })}</span>
        {hud && hud.guidance > 0 && <span>{t('guide', { n: hud.guidance })}</span>}
        {hud?.splash && <span>{t('splash')}</span>}
        {hud && hud.ciws > 0 && <span>{t('ciws', { n: hud.ciws })}</span>}
        {hud?.jammed && <span className="game-warning">{t('jammed')}</span>}
        {hud?.moving && <span className="game-warning">{t('moving')}</span>}
      </div>
    </div>
  );
}
