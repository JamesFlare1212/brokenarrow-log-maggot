import type { UpgradeId } from './engine';

const messages = {
  title: ['防空小游戏', 'Air defense', '防空ミニゲーム', 'Мини-игра ПВО'],
  hint: [
    'Z 开关雷达 · 右键移动阵地 · 移动后重新开机 · 累计击杀获得升级',
    'Z toggles radar · Right-click to move · Re-enable after moving · Kills earn upgrades',
    'Z：レーダー切替 · 右クリック：移動 · 移動後に再起動 · 撃破数で強化',
    'Z — радар · ПКМ — перемещение · После движения включите радар · Улучшения за сбитые цели',
  ],
  canvas: [
    '防空战场；按 Z 切换雷达，左右方向键移动',
    'Air-defense field; Z toggles radar, arrow keys move',
    '防空戦場：Z でレーダー切替、左右キーで移動',
    'Поле ПВО: Z — радар, стрелки — перемещение',
  ],
  radar: ['雷达', 'Radar', 'レーダー', 'Радар'],
  radarToggle: ['切换雷达 (Z)', 'Toggle radar (Z)', 'レーダー切替 (Z)', 'Переключить радар (Z)'],
  on: ['已开启', 'On', '稼働中', 'Включён'],
  off: ['已关闭', 'Off', '停止中', 'Выключен'],
  spinup: ['开机中', 'Starting', '起動中', 'Запуск'],
  score: ['得分', 'Score', 'スコア', 'Очки'],
  time: ['存活时间', 'Survival time', '生存時間', 'Время'],
  kills: ['击杀 / 下次升级', 'Kills / next upgrade', '撃破 / 次の強化', 'Сбито / улучшение'],
  best: ['历史最高', 'Best score', '最高スコア', 'Рекорд'],
  ciws: ['密集阵防护：{n}', 'CIWS charges: {n}', 'CIWS 防護：{n}', 'Защита CIWS: {n}'],
  jammed: [
    '受到干扰：射速降低',
    'Jammed: slower fire rate',
    '妨害中：射速低下',
    'Помехи: снижена скорострельность',
  ],
  moving: [
    '移动中，到位后按 Z 开机',
    'Moving; press Z after arrival',
    '移動中：到着後 Z で起動',
    'Движение; на месте нажмите Z',
  ],
  moveLeft: ['向左移动', 'Move left', '左に移動', 'Влево'],
  moveRight: ['向右移动', 'Move right', '右に移動', 'Вправо'],
  cooldown: ['发射间隔 {s}s', 'Fire interval {s}s', '発射間隔 {s}s', 'Интервал огня {s}с'],
  volley: ['齐射 {n} 枚', 'Volley: {n}', '斉射：{n} 発', 'Залп: {n}'],
  guide: ['制导等级 {n}', 'Guidance level {n}', '誘導レベル {n}', 'Наведение: {n}'],
  splash: ['近炸引信', 'Proximity fuse', '近接信管', 'Взрыватель'],
  shelling: ['炮击 {s}s', 'Shelling in {s}s', '砲撃まで {s}s', 'Обстрел через {s}с'],
  upgradeTitle: [
    '击杀奖励：选择一项升级',
    'Kill reward: choose an upgrade',
    '撃破報酬：強化を選択',
    'Награда: выберите улучшение',
  ],
  upgradeHint: [
    '战斗暂停，选择后继续。',
    'Combat pauses until you choose.',
    '選択するまで戦闘は一時停止します。',
    'Бой приостановлен до выбора.',
  ],
  over: [
    '防空阵地被摧毁',
    'Air-defense site destroyed',
    '防空陣地が破壊されました',
    'Позиция ПВО уничтожена',
  ],
  killSummary: [
    '总击杀 {total} · 普通 {normal} · SEAD {sead} · 干扰 {jam} · B2 {b2}',
    'Kills {total} · Normal {normal} · SEAD {sead} · Jammer {jam} · B2 {b2}',
    '総撃破 {total} · 通常 {normal} · SEAD {sead} · 妨害 {jam} · B2 {b2}',
    'Сбито {total} · Обычных {normal} · SEAD {sead} · РЭБ {jam} · B2 {b2}',
  ],
  restart: ['再来一局', 'Play again', 'もう一度', 'Ещё раз'],
  close: ['关闭', 'Close', '閉じる', 'Закрыть'],
  fireTitle: ['射速强化', 'Faster fire', '射速強化', 'Скорострельность'],
  fireDescription: [
    '缩短导弹发射间隔',
    'Reduce missile cooldown',
    'ミサイル発射間隔を短縮',
    'Уменьшает перезарядку ракет',
  ],
  volleyTitle: ['齐射 +1', 'Volley +1', '斉射 +1', 'Залп +1'],
  volleyDescription: [
    '每轮多发一枚，分散目标',
    'One extra missile with separate targets',
    '各斉射に一発追加し、目標を分散',
    'Дополнительная ракета по другой цели',
  ],
  guideTitle: ['制导强化', 'Better guidance', '誘導強化', 'Усиление наведения'],
  guideDescription: [
    '导弹更快，命中范围更大',
    'Faster missiles and a larger hit radius',
    'ミサイル速度と命中範囲を強化',
    'Быстрее ракеты, больше радиус попадания',
  ],
  splashTitle: ['近炸引信', 'Proximity fuse', '近接信管', 'Взрыватель'],
  splashDescription: [
    '命中时伤害附近敌机',
    'Hits also damage nearby planes',
    '命中時に近くの敵機にもダメージ',
    'Попадание повреждает соседние самолёты',
  ],
  rangeTitle: ['射程 +70', 'Range +70', '射程 +70', 'Дальность +70'],
  rangeDescription: [
    '扩大索敌距离',
    'Increase detection range',
    '索敵距離を拡大',
    'Увеличивает дальность захвата',
  ],
  moveTitle: ['机动强化', 'Better mobility', '機動強化', 'Мобильность'],
  moveDescription: [
    '阵地移动速度 ×1.5',
    'Move the site 1.5 times faster',
    '陣地移動速度 ×1.5',
    'Скорость движения ×1,5',
  ],
  ciwsTitle: ['密集阵防护', 'CIWS defense', 'CIWS 防護', 'Защита CIWS'],
  ciwsDescription: [
    '抵挡一次致命命中',
    'Block one fatal hit',
    '致命的な命中を一回防御',
    'Блокирует одно смертельное попадание',
  ],
  quickTitle: ['雷达快启', 'Quick startup', '高速起動', 'Быстрый запуск'],
  quickDescription: [
    '雷达开机延迟减半',
    'Halve the radar startup delay',
    'レーダー起動時間を半減',
    'Вдвое меньше задержка радара',
  ],
} satisfies Record<string, readonly [string, string, string, string]>;

export type GameMessageKey = keyof typeof messages;
export type GameTranslate = (key: GameMessageKey, vars?: Record<string, string | number>) => string;

export function gameText(
  locale: string,
  key: GameMessageKey,
  vars?: Record<string, string | number>,
): string {
  const index = locale === 'en' ? 1 : locale === 'ja' ? 2 : locale === 'ru' ? 3 : 0;
  let text = messages[key][index];
  for (const [name, value] of Object.entries(vars ?? {}))
    text = text.split(`{${name}}`).join(String(value));
  return text;
}

export const upgradeMessages: Record<
  UpgradeId,
  { title: GameMessageKey; description: GameMessageKey }
> = {
  fire: { title: 'fireTitle', description: 'fireDescription' },
  volley: { title: 'volleyTitle', description: 'volleyDescription' },
  guide: { title: 'guideTitle', description: 'guideDescription' },
  splash: { title: 'splashTitle', description: 'splashDescription' },
  range: { title: 'rangeTitle', description: 'rangeDescription' },
  move: { title: 'moveTitle', description: 'moveDescription' },
  ciws: { title: 'ciwsTitle', description: 'ciwsDescription' },
  quick: { title: 'quickTitle', description: 'quickDescription' },
};
