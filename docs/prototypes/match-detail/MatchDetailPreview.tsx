import { Fragment, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  ExternalLink,
  Medal,
  Moon,
  Play,
  Shield,
  Sun,
  Swords,
  Trophy,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import '@/styles/index.css';
import './preview.css';

type Player = {
  id: string;
  name: string;
  destruction: number;
  losses: number;
  objectives: number | null;
  kills: number;
  damage: number;
  received: number;
  supply: number;
  experience: number;
  medals: number;
  rating: number;
  delta: number;
  awards: string[];
  self?: boolean;
};

// Alpha is illustrative. Bravo's visible statistics come from the supplied screenshot.
const alpha: Player[] = [
  {
    id: 'demo-local',
    name: 'JamesFlare',
    destruction: 5800,
    losses: 4050,
    objectives: 4,
    kills: 41,
    damage: 1096,
    received: 887,
    supply: 24620,
    experience: 4280,
    medals: 2,
    rating: 2017.74,
    delta: -12.26,
    awards: ['攻防专家', '精打细算'],
    self: true,
  },
  {
    id: 'demo-2',
    name: 'Northstar',
    destruction: 4520,
    losses: 4870,
    objectives: 3,
    kills: 32,
    damage: 842,
    received: 1015,
    supply: 20380,
    experience: 3560,
    medals: 1,
    rating: 2104.18,
    delta: -21.45,
    awards: ['补给先锋'],
  },
  {
    id: 'demo-3',
    name: 'Kestrel',
    destruction: 3675,
    losses: 5240,
    objectives: 2,
    kills: 27,
    damage: 713,
    received: 1094,
    supply: 18940,
    experience: 2985,
    medals: 0,
    rating: 1982.61,
    delta: -28.62,
    awards: [],
  },
  {
    id: 'demo-4',
    name: 'Vanguard',
    destruction: 3010,
    losses: 5650,
    objectives: 1,
    kills: 23,
    damage: 658,
    received: 1248,
    supply: 16730,
    experience: 2670,
    medals: 0,
    rating: 2063.29,
    delta: -31.07,
    awards: [],
  },
  {
    id: 'demo-5',
    name: 'Coldfront',
    destruction: 2415,
    losses: 5415,
    objectives: null,
    kills: 19,
    damage: 584,
    received: 842,
    supply: 14520,
    experience: 2210,
    medals: 0,
    rating: 1944.85,
    delta: -35.22,
    awards: [],
  },
];
const bravo: Player[] = [
  {
    id: '127071',
    name: 'Zybek',
    destruction: 4425,
    losses: 1920,
    objectives: null,
    kills: 28,
    damage: 568,
    received: 533,
    supply: 19172,
    experience: 4655,
    medals: 2,
    rating: 2073.91,
    delta: 37.33,
    awards: ['大腿', '爱兵如子'],
  },
  {
    id: '225437',
    name: 'DeathWotch17',
    destruction: 5955,
    losses: 3605,
    objectives: null,
    kills: 39,
    damage: 1054,
    received: 1192,
    supply: 33453,
    experience: 3051,
    medals: 0,
    rating: 2158.43,
    delta: 28.83,
    awards: ['吃白食', '大胃袋'],
  },
  {
    id: '136133',
    name: 'Fupped',
    destruction: 5465,
    losses: 5540,
    objectives: 2,
    kills: 43,
    damage: 904,
    received: 924,
    supply: 11370,
    experience: 3048,
    medals: 0,
    rating: 2156.14,
    delta: 29.06,
    awards: [],
  },
  {
    id: '127918',
    name: 'Challenger',
    destruction: 3195,
    losses: 4270,
    objectives: 6,
    kills: 27,
    damage: 909,
    received: 949,
    supply: 28578,
    experience: 3616,
    medals: 1,
    rating: 2131.46,
    delta: 31.55,
    awards: ['地产大亨', '攻防专家'],
  },
  {
    id: '9822',
    name: 'ItsRocii',
    destruction: 6185,
    losses: 3750,
    objectives: null,
    kills: 50,
    damage: 1151,
    received: 1488,
    supply: 31472,
    experience: 4774,
    medals: 1,
    rating: 2196.9,
    delta: 25.04,
    awards: ['奶妈', '击杀王', '精打细算'],
  },
];
const records = [
  {
    id: '9419776',
    map: 'Central Village',
    time: '2026/10/26 22:05',
    duration: '41:31',
    delta: -12.26,
  },
  {
    id: 'demo-9419602',
    map: 'Central Village',
    time: '2026/10/26 21:15',
    duration: '20:41',
    delta: -47.29,
  },
  {
    id: 'demo-9408631',
    map: 'Airbase',
    time: '2026/10/23 02:28',
    duration: '20:08',
    delta: -26.19,
  },
  {
    id: 'demo-9408412',
    map: 'Frontiers',
    time: '2026/10/23 02:00',
    duration: '8:51',
    delta: -32.12,
  },
  {
    id: 'demo-9408204',
    map: 'Baltiisk',
    time: '2026/10/23 01:45',
    duration: '16:34',
    delta: 35.52,
  },
  {
    id: 'demo-9407910',
    map: 'Oil refinery',
    time: '2026/10/23 00:46',
    duration: '45:00',
    delta: 14.02,
  },
];
type RecordItem = (typeof records)[number];
type MetricGroup = 'core' | 'combat' | 'support';
const groups: { id: MetricGroup; label: string; columns: string[] }[] = [
  { id: 'core', label: '核心战绩', columns: ['击杀价值', '损失价值', 'D/L', '占点', 'ELO 变化'] },
  {
    id: 'combat',
    label: '战斗数据',
    columns: ['击杀数', '伤害输出', '承受伤害', 'D/L', 'ELO 变化'],
  },
  { id: 'support', label: '支援数据', columns: ['补给', '经验', '勋章', '占点', 'ELO 变化'] },
];
const metric = (value: number | null) => (value === null ? '—' : value.toLocaleString('en-US'));
const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
const ratio = (player: Player) => (player.destruction / player.losses).toFixed(2);

function HintButton({
  label,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={label} size="icon-sm" variant="ghost" {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function PlayerDetails({ player }: { player: Player }) {
  const details = [
    ['赛后 ELO', metric(player.rating)],
    ['ELO 变化', signed(player.delta)],
    ['击杀价值', metric(player.destruction)],
    ['损失价值', metric(player.losses)],
    ['D/L', ratio(player)],
    ['占点', metric(player.objectives)],
    ['击杀数', metric(player.kills)],
    ['伤害输出', metric(player.damage)],
    ['承受伤害', metric(player.received)],
    ['补给', metric(player.supply)],
    ['经验', metric(player.experience)],
    ['勋章', metric(player.medals)],
  ];
  return (
    <div className="player-expanded" id={`player-${player.id}`}>
      <div className="expanded-heading">
        <span>
          {player.name}
          <span className="subtle">
            {' '}
            · {player.id.startsWith('demo') ? '演示玩家' : `#${player.id}`}
          </span>
        </span>
        <span className="subtle">完整数据</span>
      </div>
      <dl className="expanded-metrics">
        {details.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="award-list">
        <Medal aria-hidden="true" />
        <span className="subtle">本局称号</span>
        {player.awards.length ? (
          player.awards.map((award) => (
            <Badge variant="outline" key={award}>
              {award}
            </Badge>
          ))
        ) : (
          <span className="subtle">暂无称号</span>
        )}
      </div>
    </div>
  );
}

function Scoreboard({
  group,
  won,
  localDelta,
}: {
  group: MetricGroup;
  won: boolean;
  localDelta: number;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const configuration = groups.find((item) => item.id === group)!;
  const localPlayers = alpha.map((player) =>
    player.self
      ? { ...player, delta: localDelta, rating: 2030 + localDelta }
      : { ...player, delta: Math.abs(player.delta) * (won ? 1 : -1) },
  );
  const opposingPlayers = bravo.map((player) => ({
    ...player,
    delta: Math.abs(player.delta) * (won ? -1 : 1),
  }));
  const teams = [
    { name: 'Alpha', label: '我方', players: localPlayers, winner: won },
    { name: 'Bravo', label: '对方', players: opposingPlayers, winner: !won },
  ];
  return (
    <div className="scoreboard-grid">
      {teams.map((team) => (
        <div className="scoreboard-frame" key={team.name}>
          <Table
            className="scoreboard"
            aria-label={`${team.label} ${team.name}，${configuration.label}`}
          >
            <colgroup>
              <col style={{ width: '34%' }} />
              <col />
              <col />
              <col />
              <col />
              <col style={{ width: '16%' }} />
            </colgroup>
            <TableHeader>
              <TableRow className="team-heading">
                <TableHead colSpan={6} scope="colgroup">
                  <div className="team-heading-content">
                    <div className="team-label">
                      {team.winner ? <Trophy aria-hidden="true" /> : <Shield aria-hidden="true" />}
                      <strong>
                        {team.label} <span className="team-code">{team.name}</span>
                      </strong>
                      <Badge variant={team.winner ? 'success' : 'destructive'}>
                        {team.winner ? '胜利' : '失败'}
                      </Badge>
                      <span className="subtle player-count">5 位玩家</span>
                    </div>
                    <span className="team-total">
                      击杀价值{' '}
                      <strong>
                        {metric(team.players.reduce((sum, player) => sum + player.destruction, 0))}
                      </strong>
                    </span>
                  </div>
                </TableHead>
              </TableRow>
              <TableRow>
                <TableHead scope="col" className="player-column">
                  玩家
                </TableHead>
                {configuration.columns.map((label) => (
                  <TableHead scope="col" key={label}>
                    {label === 'D/L' ? <abbr title="击杀价值 ÷ 损失价值">D/L</abbr> : label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {team.players.map((player) => {
                const values =
                  group === 'core'
                    ? [
                        metric(player.destruction),
                        metric(player.losses),
                        ratio(player),
                        metric(player.objectives),
                      ]
                    : group === 'combat'
                      ? [
                          metric(player.kills),
                          metric(player.damage),
                          metric(player.received),
                          ratio(player),
                        ]
                      : [
                          metric(player.supply),
                          metric(player.experience),
                          metric(player.medals),
                          metric(player.objectives),
                        ];
                return (
                  <Fragment key={player.id}>
                    <TableRow data-self={player.self || undefined} data-player-row={player.name}>
                      <TableCell>
                        <div className="player-label">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="player-trigger"
                            aria-expanded={expanded === player.id}
                            aria-controls={
                              expanded === player.id ? `player-${player.id}` : undefined
                            }
                            onClick={() => setExpanded(expanded === player.id ? null : player.id)}
                          >
                            <ChevronRight
                              data-icon="inline-start"
                              className={cn(expanded === player.id && 'rotate-90')}
                              aria-hidden="true"
                            />
                            <span className="truncate">{player.name}</span>
                          </Button>
                          {player.self && <Badge variant="outline">你</Badge>}
                          {player.awards.length > 0 && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  className="award-trigger"
                                  aria-label={`${player.name} 的 ${player.awards.length} 个称号`}
                                  aria-expanded={expanded === player.id}
                                  onClick={() =>
                                    setExpanded(expanded === player.id ? null : player.id)
                                  }
                                >
                                  <Medal aria-hidden="true" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{player.awards.join(' · ')}</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </TableCell>
                      {values.map((value, index) => (
                        <TableCell className={cn(index === 0 && 'primary-value')} key={index}>
                          {value}
                        </TableCell>
                      ))}
                      <TableCell>
                        <span className={cn('elo-value', player.delta > 0 ? 'elo-up' : 'elo-down')}>
                          {signed(player.delta)}
                        </span>
                      </TableCell>
                    </TableRow>
                    {expanded === player.id && (
                      <TableRow className="expanded-row">
                        <TableCell colSpan={6}>
                          <PlayerDetails player={player} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ))}
    </div>
  );
}

function MatchDetail({
  record,
  index,
  count,
  onBack,
  onNavigate,
  announce,
}: {
  record: RecordItem;
  index: number;
  count: number;
  onBack: () => void;
  onNavigate: (index: number) => void;
  announce: (message: string) => void;
}) {
  const won = record.delta > 0;
  const [group, setGroup] = useState<MetricGroup>('core');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [record.id]);
  return (
    <main className="detail-view">
      <nav className="detail-navigation" aria-label="对局导航">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft data-icon="inline-start" aria-hidden="true" />
          对局档案
        </Button>
        <div className="detail-navigation-right">
          <span className="subtle">
            {index + 1} / {count}
          </span>
          <HintButton label="上一局" disabled={index === 0} onClick={() => onNavigate(index - 1)}>
            <ChevronLeft aria-hidden="true" />
          </HintButton>
          <HintButton
            label="下一局"
            disabled={index === count - 1}
            onClick={() => onNavigate(index + 1)}
          >
            <ChevronRight aria-hidden="true" />
          </HintButton>
        </div>
      </nav>
      <Separator />
      <header className="match-header">
        <div className="match-identity">
          <div className="eyebrow">
            对局详情 <span>#{record.id.replace('demo-', '')}</span>
            <HintButton
              label="复制对局编号"
              onClick={() => {
                if (navigator.clipboard)
                  void navigator.clipboard
                    .writeText(record.id.replace('demo-', ''))
                    .then(() => announce('已复制对局编号'))
                    .catch(() => announce('当前预览不支持复制，请手动选择编号'));
                else announce('当前预览不支持复制，请手动选择编号');
              }}
            >
              <Copy aria-hidden="true" />
            </HintButton>
          </div>
          <h1 ref={heading} tabIndex={-1}>
            {record.map}
          </h1>
          <div className="match-metadata">
            <Badge variant="secondary">排位 · 5v5</Badge>
            <span>
              <Clock3 aria-hidden="true" />
              {record.duration}
            </span>
            <span>{record.time}</span>
          </div>
        </div>
        <div className="match-outcome">
          <Badge variant={won ? 'success' : 'destructive'}>
            {won ? <Trophy aria-hidden="true" /> : <Shield aria-hidden="true" />}
            {won ? '胜利' : '失败'}
          </Badge>
          <strong className={cn(won ? 'elo-up' : 'elo-down')}>
            {signed(record.delta)}
            <span>ELO</span>
          </strong>
          <span className="subtle">JamesFlare · Alpha</span>
        </div>
      </header>
      <div className="match-actions">
        <Button onClick={() => announce('录像入口预览：正式版将打开 JamesFlare 的本局录像。')}>
          <Play data-icon="inline-start" aria-hidden="true" />
          观看录像
        </Button>
        <Button
          variant="outline"
          onClick={() => announce('外部链接预览：正式版将在 BATrace 打开当前对局。')}
        >
          在 BATrace 打开
          <ExternalLink data-icon="inline-end" aria-hidden="true" />
        </Button>
        <span className="action-caption">已关联 1 段录像</span>
      </div>
      <Card size="sm" className="personal-card">
        <CardHeader>
          <CardTitle>
            <span className="personal-title">
              <Swords aria-hidden="true" />
              你的本局表现<span className="subtle">JamesFlare</span>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="personal-metrics">
            <div>
              <dt>击杀价值</dt>
              <dd>5,800</dd>
            </div>
            <div>
              <dt>损失价值</dt>
              <dd>4,050</dd>
            </div>
            <div>
              <dt>
                战损比 <span className="subtle">D/L</span>
              </dt>
              <dd>1.43</dd>
            </div>
            <div>
              <dt>占领据点</dt>
              <dd>
                4<span className="metric-unit">个</span>
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
      <section className="players-section" aria-labelledby="players-title">
        <div className="section-heading">
          <h2 id="players-title">
            双方战绩 <span className="subtle">10 位玩家</span>
          </h2>
          <span className="section-hint">
            <ChevronDown aria-hidden="true" />
            点击玩家展开详情
          </span>
        </div>
        <Tabs
          value={group}
          onValueChange={(value) => setGroup(value as MetricGroup)}
          className="score-tabs"
        >
          <TabsList variant="line" aria-label="战绩数据分组">
            {groups.map((item) => (
              <TabsTrigger value={item.id} key={item.id}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {groups.map((item) => (
            <TabsContent value={item.id} key={item.id}>
              <Scoreboard group={item.id} won={won} localDelta={record.delta} />
            </TabsContent>
          ))}
        </Tabs>
      </section>
      <div className="detail-footnote">
        <span>D/L = 击杀价值 ÷ 损失价值</span>
        <span>— 表示数据未提供</span>
      </div>
    </main>
  );
}

function Archive({
  onOpen,
  initialFocus,
  filter,
  onFilter,
}: {
  onOpen: (index: number) => void;
  initialFocus: number;
  filter: string;
  onFilter: (value: string) => void;
}) {
  const selectedButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selectedButton.current?.focus({ preventScroll: true });
  }, []);
  const visible = records.filter(
    (record) => filter === 'all' || (filter === 'win' ? record.delta > 0 : record.delta < 0),
  );
  return (
    <main className="archive-view">
      <header className="archive-heading">
        <div>
          <div className="eyebrow">BARadar / 断箭蛐工具</div>
          <h1>对局档案</h1>
          <p className="subtle">回看每一场战斗，找到下一次突破。</p>
        </div>
        <Badge variant="outline">6 场示例对局</Badge>
      </header>
      <div className="archive-toolbar">
        <ToggleGroup
          type="single"
          variant="outline"
          spacing={0}
          value={filter}
          onValueChange={(value) => value && onFilter(value)}
          aria-label="按对局结果筛选"
        >
          <ToggleGroupItem value="all">全部</ToggleGroupItem>
          <ToggleGroupItem value="win">胜利</ToggleGroupItem>
          <ToggleGroupItem value="loss">失败</ToggleGroupItem>
        </ToggleGroup>
        <span className="subtle archive-account">账号 · JamesFlare</span>
      </div>
      <div className="archive-frame">
        <Table aria-label="对局档案">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">结果</TableHead>
              <TableHead scope="col">对局</TableHead>
              <TableHead scope="col" className="archive-time">
                时间
              </TableHead>
              <TableHead scope="col" className="numeric">
                ELO 变化
              </TableHead>
              <TableHead scope="col">
                <span className="sr-only">操作</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((record) => {
              const index = records.indexOf(record);
              return (
                <TableRow
                  key={record.id}
                  data-record={record.id}
                  className="archive-row"
                  onClick={(event) => {
                    if (
                      !(event.target as HTMLElement).closest('button, a') &&
                      !window.getSelection()?.toString()
                    )
                      onOpen(index);
                  }}
                >
                  <TableCell>
                    <Badge variant={record.delta > 0 ? 'success' : 'destructive'}>
                      {record.delta > 0 ? (
                        <Check aria-hidden="true" />
                      ) : (
                        <Shield aria-hidden="true" />
                      )}
                      {record.delta > 0 ? '胜利' : '失败'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="archive-match-name">{record.map}</div>
                    <div className="subtle archive-match-meta">
                      排位 · 5v5 <span>· {record.duration}</span>
                    </div>
                  </TableCell>
                  <TableCell className="archive-time">
                    <div>{record.time.slice(5, 10)}</div>
                    <div className="subtle">{record.time.slice(11)}</div>
                  </TableCell>
                  <TableCell className="numeric">
                    <span className={record.delta > 0 ? 'elo-up' : 'elo-down'}>
                      {signed(record.delta)}
                    </span>
                  </TableCell>
                  <TableCell className="archive-action">
                    <Button
                      ref={index === initialFocus ? selectedButton : undefined}
                      variant="outline"
                      size="sm"
                      aria-label={`查看 ${record.map} ${record.time} 的对局详情`}
                      onClick={() => onOpen(index)}
                    >
                      查看详情
                      <ChevronRight data-icon="inline-end" aria-hidden="true" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <div className="archive-footnote">
        <span className="subtle">共 {visible.length} 场对局</span>
        <span>
          <ArrowUpRight aria-hidden="true" />
          点击整行或「查看详情」打开对局
        </span>
      </div>
    </main>
  );
}

function Preview() {
  const [screen, setScreen] = useState<'detail' | 'archive'>(
    document.documentElement.dataset.previewScreen === 'archive' ? 'archive' : 'detail',
  );
  const [index, setIndex] = useState(0);
  const [filter, setFilter] = useState('all');
  const [dark, setDark] = useState(document.documentElement.dataset.mode !== 'light');
  const [message, setMessage] = useState('');
  const messageTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const announce = (value: string) => {
    setMessage(value);
    clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => setMessage(''), 4500);
  };
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.dataset.mode = dark ? 'dark' : 'light';
  }, [dark]);
  useEffect(() => () => clearTimeout(messageTimer.current), []);
  const navigate = (next: number) => {
    setIndex(next);
    setScreen('detail');
  };
  const visibleIndices = records.flatMap((record, recordIndex) =>
    filter === 'all' || (filter === 'win' ? record.delta > 0 : record.delta < 0)
      ? [recordIndex]
      : [],
  );
  return (
    <TooltipProvider delayDuration={300}>
      <div className="preview-content">
        {screen === 'detail' ? (
          <MatchDetail
            key={records[index]!.id}
            record={records[index]!}
            index={visibleIndices.indexOf(index)}
            count={visibleIndices.length}
            onBack={() => setScreen('archive')}
            onNavigate={(position) => navigate(visibleIndices[position]!)}
            announce={announce}
          />
        ) : (
          <Archive onOpen={navigate} initialFocus={index} filter={filter} onFilter={setFilter} />
        )}
        <footer className="preview-footer">
          <span>
            交互预览 · 示例数据<span className="preview-data-note">，非完整真实战报</span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => setDark(!dark)}>
            {dark ? (
              <Sun data-icon="inline-start" aria-hidden="true" />
            ) : (
              <Moon data-icon="inline-start" aria-hidden="true" />
            )}
            {dark ? '浅色预览' : '深色预览'}
          </Button>
        </footer>
        <div
          className={cn('preview-status', message && 'has-message')}
          role="status"
          aria-live="polite"
        >
          {message}
        </div>
      </div>
    </TooltipProvider>
  );
}

createRoot(document.getElementById('root')!).render(<Preview />);
