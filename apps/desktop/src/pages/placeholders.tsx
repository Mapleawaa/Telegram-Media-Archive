import { Construction } from 'lucide-react';

export function SourcesPage() {
  return (
    <div className="space-y-4 p-6">
      <h1 className="text-lg font-semibold">来源</h1>
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-16 text-center">
        <Construction className="size-8 text-muted-foreground" />
        <p className="text-sm font-medium">M2（MTProto 通道）提供</p>
        <p className="max-w-md text-xs text-muted-foreground">
          频道历史扫描、断点续扫、从源频道 copy 原始消息（无转发头）等能力将在此管理。
        </p>
      </div>
    </div>
  );
}
