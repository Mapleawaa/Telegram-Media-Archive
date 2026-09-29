import { Eye, EyeOff } from 'lucide-react';
import { usePrivacyStore } from '@/stores/privacy';
import { Button } from '@/components/ui/button';

/**
 * 隐私模式提示条：开启且确有内容被隐藏时出现，提供「临时显示 / 重新隐藏」。
 * 只在本次会话生效（临时放行不落盘）。
 */
export function PrivacyNotice({ hiddenCount }: { hiddenCount: number }) {
  const enabled = usePrivacyStore((s) => s.enabled);
  const revealed = usePrivacyStore((s) => s.revealed);
  const reveal = usePrivacyStore((s) => s.revealTemporarily);
  const hideAgain = usePrivacyStore((s) => s.hideAgain);

  if (!enabled) return null;
  if (!revealed && hiddenCount === 0) return null;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card/60 px-3 py-1.5 text-[12px] text-muted-foreground">
      {revealed ? <Eye className="size-3.5 shrink-0" /> : <EyeOff className="size-3.5 shrink-0" />}
      <span>
        {revealed
          ? '隐私模式已临时放行：敏感内容当前可见'
          : `隐私模式：已隐藏 ${hiddenCount} 条敏感内容`}
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="ml-auto h-6 px-2 text-[11px]"
        onClick={revealed ? hideAgain : reveal}
      >
        {revealed ? '重新隐藏' : '临时显示'}
      </Button>
    </div>
  );
}
