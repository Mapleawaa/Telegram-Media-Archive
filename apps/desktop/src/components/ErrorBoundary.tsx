import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * 全局错误边界（P5-6 / D8）：单个组件渲染抛异常时不再整页白屏。
 * 恢复手段两档：重试渲染 / 强制刷新。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 组件栈留在控制台，方便定位是哪个组件挂了
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-[60vh] items-center justify-center p-8">
        <div className="max-w-lg space-y-4 rounded-2xl border border-destructive/30 bg-destructive/5 p-8 text-center">
          <AlertTriangle className="mx-auto size-8 text-destructive" />
          <h1 className="text-lg font-semibold">这个页面渲染出错了</h1>
          <p className="break-all text-xs text-muted-foreground">{error.message}</p>
          <div className="flex justify-center gap-2 pt-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => this.setState({ error: null })}
              className="gap-1.5"
            >
              重试
            </Button>
            <Button size="sm" onClick={() => window.location.reload()} className="gap-1.5">
              <RefreshCw className="size-3.5" /> 刷新应用
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
