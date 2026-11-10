import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Moon, Sun } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { concepts, samples, type Scenario } from './MaggotCardConcepts';
import '@/styles/index.css';

function Preview() {
  const [scenario, setScenario] = useState<Scenario>('screenshot');
  const [mode, setMode] = useState<'dark' | 'light'>('dark');
  const sample = samples[scenario];
  useEffect(() => {
    document.documentElement.dataset.mode = mode;
    document.documentElement.classList.toggle('dark', mode === 'dark');
  }, [mode]);
  return (
    <main className="flex min-w-0 flex-col gap-7 text-sm text-foreground">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={scenario}
            onValueChange={(value) => {
              if (value) setScenario(value as Scenario);
            }}
            aria-label="预览场景"
          >
            <ToggleGroupItem value="screenshot">截图数值</ToggleGroupItem>
            <ToggleGroupItem value="low">较低指数</ToggleGroupItem>
            <ToggleGroupItem value="partial">样本不足</ToggleGroupItem>
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
        <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
          截图场景使用原图数值；其余场景为演示数据。
        </p>
      </div>
      <div className="flex flex-col gap-7">
        {concepts.map(({ id, name, component: Component, description, detail }) => (
          <section
            key={id}
            className="grid min-w-0 items-center gap-4 min-[620px]:grid-cols-[minmax(0,1fr)_minmax(0,21.5rem)] min-[620px]:gap-8"
            aria-label={`方案 ${id}`}
          >
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2.5">
                <span className="text-xs font-medium text-muted-foreground">{id}</span>
                <h2 className="text-base font-medium tracking-tight">{name}</h2>
                {id === 'A' && <Badge variant="secondary">推荐</Badge>}
              </div>
              <p className="max-w-64 text-xs leading-6 text-muted-foreground">{description}</p>
              <p className="max-w-64 text-xs leading-6 text-muted-foreground">{detail}</p>
            </div>
            <Component sample={sample} />
          </section>
        ))}
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Preview />);
