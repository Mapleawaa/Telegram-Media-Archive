import { useEffect, useState } from 'react';
import type { HealthResponse } from '@tma/shared';
import { Button } from '@/components/ui/button';

const CORE_URL = 'http://127.0.0.1:8787';

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const check = () => {
    setChecking(true);
    setError(null);
    fetch(`${CORE_URL}/api/health`)
      .then((r) => r.json() as Promise<HealthResponse>)
      .then(setHealth)
      .catch(() => {
        setHealth(null);
        setError('Core 未连接');
      })
      .finally(() => setChecking(false));
  };

  useEffect(check, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-8 text-foreground">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Telegram Media Archive</h1>
        <p className="mt-1 text-sm text-muted-foreground">M0 脚手架 · Archive Core + 桌面端</p>
      </div>

      <div className="w-80 rounded-lg border p-4 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Core 状态</span>
          <span className={health ? 'text-emerald-600' : 'text-destructive'}>
            {checking ? '检查中…' : health ? `已连接 v${health.version}` : (error ?? '未知')}
          </span>
        </div>
        {health && (
          <div className="mt-2 flex items-center justify-between text-muted-foreground">
            <span>运行时长</span>
            <span>{health.uptimeSec}s</span>
          </div>
        )}
      </div>

      <Button onClick={check} disabled={checking}>
        重新检查
      </Button>
    </main>
  );
}
