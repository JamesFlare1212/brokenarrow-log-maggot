import type { GameState } from './engine';
import type { GameTranslate } from './messages';

const planeColors = { normal: '#b7c1cf', sead: '#f5b942', jam: '#ff9dd2', b2: '#8b9bb8' };

export function drawGame(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  width: number,
  height: number,
  t: GameTranslate,
): void {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#07130d';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(255,255,255,.05)';
  ctx.fillRect(0, height - 4, width, 4);
  if (state.radarOn) {
    ctx.strokeStyle = 'rgba(76,217,138,.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(state.x, height - 28, state.range, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const shell of state.artillery) {
    if (shell.warning > 0) {
      ctx.strokeStyle = 'rgba(245,185,66,.85)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.arc(shell.x, height - 28, 44, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(245,185,66,.15)';
      ctx.beginPath();
      ctx.arc(shell.x, height - 28, 44, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f5b942';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(t('shelling', { s: Math.ceil(shell.warning) }), shell.x, height - 66);
    } else if (shell.impact) {
      ctx.fillStyle = shell.hit ? 'rgba(255,107,107,.5)' : 'rgba(245,185,66,.25)';
      ctx.beginPath();
      ctx.arc(shell.x, height - 28, 40, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ff6b6b';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(shell.x, height - 28, 26, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  for (const plane of state.planes) {
    if (plane.gone) continue;
    const color = planeColors[plane.kind];
    ctx.fillStyle = color;
    if (plane.kind === 'b2') ctx.globalAlpha = 0.55;
    ctx.fillRect(plane.x - 14, plane.y - 5, 28, 9);
    ctx.fillRect(plane.x - 8, plane.y - 10, 5, 5);
    ctx.globalAlpha = 1;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    if (plane.kind === 'sead') ctx.fillText('SEAD', plane.x, plane.y - 14);
    if (plane.kind === 'jam') ctx.fillText('JAM', plane.x, plane.y - 14);
    if (plane.kind === 'b2') ctx.fillText('B2', plane.x, plane.y - 14);
  }
  ctx.fillStyle = '#ff6b6b';
  for (const missile of state.seadMissiles) {
    if (missile.gone) continue;
    ctx.globalAlpha = missile.locked ? 1 : Math.max(0, Math.min(1, missile.fade));
    ctx.beginPath();
    ctx.moveTo(missile.x, missile.y);
    ctx.lineTo(missile.x - 4, missile.y + 9);
    ctx.lineTo(missile.x + 4, missile.y + 9);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#f5b942';
  for (const missile of state.missiles) {
    if (missile.gone) continue;
    ctx.globalAlpha = missile.lost ? Math.max(0, Math.min(1, missile.fade)) : 1;
    ctx.fillRect(missile.x - 1.5, missile.y - 5, 3, 10);
  }
  ctx.globalAlpha = 1;
  ctx.save();
  if (!state.radarOn) ctx.globalAlpha = 0.45;
  ctx.fillStyle = '#4cd98a';
  ctx.beginPath();
  ctx.moveTo(state.x, height - 42);
  ctx.lineTo(state.x - 18, height - 16);
  ctx.lineTo(state.x + 18, height - 16);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(state.x - 12, height - 14, 24, 7);
  ctx.restore();
  if (state.moving || state.spinup > 0) {
    ctx.fillStyle = '#f5b942';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(t(state.moving ? 'moving' : 'spinup'), state.x, height - 50);
  }
}
