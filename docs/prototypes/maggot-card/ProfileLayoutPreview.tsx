import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowUpRight,
  Copy,
  ExternalLink,
  Moon,
  RefreshCw,
  Sun,
  TableProperties,
} from 'lucide-react';
import type { PlayerReport } from '@ba/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ProfileOverview } from '@/features/players/ProfileOverview';
import { glassOverlaySurfaceClasses } from '@/lib/surfaces';
import { cn } from '@/lib/utils';
import { ConceptContext, concepts, type ConceptId } from './MaggotCardConcepts';
import '@/styles/index.css';

// Surrounding report data is illustrative; the index card keeps the supplied screenshot values.
const report: PlayerReport = {
  id: 'preview-player',
  name: '玩家资料预览',
  level: 35,
  fallback: false,
  matchCount: 322,
  sampleCount: 12,
  elo: 1728.3,
  kd: 1.42,
  dmr: 1.63,
  winRate: 58.3,
  wins: 7,
  losses: 5,
  updatedAt: 1794268800000,
  stale: false,
  ratingTrend: [1688, 1696, 1702, 1693, 1708, 1715, 1704, 1712, 1721, 1713, 1724, 1728.3].map(
    (value, index, values) => ({
      matchId: `preview-${index}`,
      endTime: 1794268800000 + index * 3600000,
      ratingBefore: values[Math.max(0, index - 1)]!,
      ratingAfter: value,
    }),
  ),
  recentMatches: [],
  favUnits: [
    { name: 'M1A2 SEP', value: 81240, spawn: 42, roi: 1.84 },
    { name: 'AH-64D 阿帕奇', value: 65780, spawn: 31, roi: 2.16 },
    { name: 'M2A3 布雷德利', value: 48950, spawn: 67, roi: 1.52 },
    { name: 'M109A6 帕拉丁', value: 36420, spawn: 28, roi: 1.71 },
    { name: '海军陆战队', value: 29180, spawn: 86, roi: 1.36 },
    { name: 'M1128 MGS', value: 24650, spawn: 36, roi: 1.62 },
    { name: 'M270 MLRS', value: 22900, spawn: 18, roi: 1.93 },
    { name: 'F-15E 打击鹰', value: 21840, spawn: 14, roi: 1.58 },
    { name: 'M777 榴弹炮', value: 19460, spawn: 22, roi: 1.74 },
    { name: 'M113A3', value: 17320, spawn: 48, roi: 1.21 },
    { name: '侦察步兵', value: 14850, spawn: 37, roi: 1.46 },
    { name: '后勤补给车', value: 12300, spawn: 53, roi: 1.19 },
    { name: 'F-35B', value: 11820, spawn: 9, roi: 1.38 },
    { name: 'M60A3', value: 10540, spawn: 24, roi: 1.31 },
    { name: 'UH-60 黑鹰', value: 8260, spawn: 32, roi: 1.14 },
  ],
  categories: [
    { key: 'infantry', pct: 38.4, totalCost: 82600 },
    { key: 'vehicles', pct: 34.7, totalCost: 74600 },
    { key: 'support', pct: 17.2, totalCost: 37000 },
    { key: 'helicopters', pct: 9.7, totalCost: 20800 },
  ],
  mapStats: [],
  style: 'balanced_combat',
};

function RecordContext() {
  return (
    <Tabs defaultValue="matches" className="min-w-0 gap-3">
      <TabsList variant="line" aria-label="对局区域预览">
        <TabsTrigger value="matches">
          <TableProperties />
          对局数据 <span className="text-muted-foreground">12</span>
        </TabsTrigger>
        <TabsTrigger value="encounters">
          相遇记录 <span className="text-muted-foreground">322</span>
        </TabsTrigger>
        <TabsTrigger value="maps">
          地图表现 <span className="text-muted-foreground">20</span>
        </TabsTrigger>
      </TabsList>
      <Separator />
      <TabsContent value="matches" className="overflow-hidden">
        <Table className="min-w-176 [&_td]:py-3">
          <TableHeader>
            <TableRow>
              {[
                '对局 ID',
                '结果',
                'ELO 变化',
                'K/D',
                'DMR',
                '击杀价值',
                '损失价值',
                '占点',
                '时间',
              ].map((label) => (
                <TableHead key={label}>{label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>
                <Button variant="link" size="sm">
                  #9565049
                </Button>
              </TableCell>
              <TableCell>
                <Badge variant="success">胜</Badge>
              </TableCell>
              <TableCell className="text-success tabular-nums">+15.19</TableCell>
              {['1.05', '1.19', '8,505', '8,085', '7', '2026/11/4 01:56'].map((value) => (
                <TableCell key={value} className="tabular-nums">
                  {value}
                </TableCell>
              ))}
            </TableRow>
          </TableBody>
        </Table>
      </TabsContent>
      <TabsContent value="encounters" className="py-4 text-sm text-muted-foreground">
        相遇记录区域 · 布局演示
      </TabsContent>
      <TabsContent value="maps" className="py-4 text-sm text-muted-foreground">
        地图表现区域 · 布局演示
      </TabsContent>
    </Tabs>
  );
}

function Preview() {
  const [concept, setConcept] = useState<ConceptId>('A');
  const [width, setWidth] = useState(() => (window.innerWidth < 480 ? 390 : 1152));
  const [mode, setMode] = useState<'dark' | 'light'>('dark');
  const [scale, setScale] = useState(1);
  const [measurements, setMeasurements] = useState({ sidebar: 0, card: 0, analysis: 0 });
  const host = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const selected = concepts.find((entry) => entry.id === concept)!;

  useEffect(() => {
    document.documentElement.dataset.mode = mode;
    document.documentElement.classList.toggle('dark', mode === 'dark');
  }, [mode]);
  useLayoutEffect(() => {
    const update = () => setScale(Math.min(1, host.current!.clientWidth / width));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host.current!);
    return () => observer.disconnect();
  }, [width]);
  useEffect(() => {
    const root = panel.current!;
    const sidebar = root.querySelector<HTMLElement>('.profile-analysis-sidebar')!;
    const grid = root.querySelector<HTMLElement>('.profile-analysis-grid')!;
    const card = sidebar.lastElementChild as HTMLElement;
    const update = () => {
      const next = {
        sidebar: sidebar.offsetWidth,
        card: card.offsetHeight,
        analysis: grid.offsetHeight,
      };
      setMeasurements((current) =>
        JSON.stringify(current) === JSON.stringify(next) ? current : next,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    [sidebar, grid, card].forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [concept, width]);

  return (
    <main className="flex min-w-0 flex-col gap-4 text-sm text-foreground">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={concept}
            onValueChange={(value) => {
              if (value) setConcept(value as ConceptId);
            }}
            aria-label="卡片方案"
          >
            {concepts.map((entry) => (
              <ToggleGroupItem key={entry.id} value={entry.id}>
                {entry.id} · {entry.name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}
            aria-label={mode === 'dark' ? '切换至浅色' : '切换至深色'}
          >
            {mode === 'dark' ? <Sun /> : <Moon />}
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ToggleGroup
            type="single"
            size="sm"
            value={String(width)}
            onValueChange={(value) => {
              if (value) setWidth(Number(value));
            }}
            aria-label="模拟资料页宽度"
          >
            <ToggleGroupItem value="1152">宽屏 1152</ToggleGroupItem>
            <ToggleGroupItem value="848">窄窗 848</ToggleGroupItem>
            <ToggleGroupItem value="390">小屏 390</ToggleGroupItem>
          </ToggleGroup>
          <span className="text-xs text-muted-foreground tabular-nums">
            按原布局缩放至 {Math.round(scale * 100)}%
          </span>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {selected.id} · {selected.name}　侧栏 {measurements.sidebar}px · 卡片高{' '}
          {measurements.card}px · 分析区高 {measurements.analysis}px
        </p>
      </div>
      <div ref={host} className="min-w-0 overflow-hidden">
        <section
          ref={panel}
          aria-label="玩家资料页面模拟"
          className={cn(
            glassOverlaySurfaceClasses,
            'profile-dialog mx-auto min-w-0 overflow-hidden',
          )}
          style={{ width, zoom: scale } as CSSProperties}
        >
          <div className="flex items-center gap-3 px-4 py-3">
            <h1 className="min-w-0 flex-1 text-base font-semibold">玩家资料 · 位置模拟</h1>
            <Badge variant="outline">演示数据</Badge>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="重置预览"
              onClick={() => setConcept('A')}
            >
              <RefreshCw />
            </Button>
          </div>
          <Separator />
          <div className={cn('flex min-w-0 flex-col gap-4 p-5', width <= 390 && 'p-4')}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-col gap-1">
                <h2 className="text-lg font-semibold tracking-tight">玩家概览</h2>
                <p className="text-xs text-muted-foreground">对局数 322　样本 12</p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm">
                  <ExternalLink data-icon="inline-start" />在 BATRACE 查看
                </Button>
                <Button variant="outline" size="sm">
                  <Copy data-icon="inline-start" />
                  复制
                </Button>
              </div>
            </div>
            <ConceptContext.Provider value={{ concept, scenario: 'screenshot' }}>
              <div
                className={cn(width > 390 ? '[&_.stats]:grid-cols-4!' : '[&_.stats]:grid-cols-2!')}
              >
                <ProfileOverview
                  id={report.id}
                  profile={null}
                  report={report}
                  profilePending={false}
                  reportPending={false}
                />
              </div>
            </ConceptContext.Provider>
            <RecordContext />
          </div>
        </section>
      </div>
      <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
        <ArrowUpRight aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        蛐指数使用截图数值，周边内容使用演示数据。高光单位、偏好与 ELO
        趋势复用正式组件；切换方案可观察侧栏宽度与下方表格位置的变化。
      </p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Preview />);
