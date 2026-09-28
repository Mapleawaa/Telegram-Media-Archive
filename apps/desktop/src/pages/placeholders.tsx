import { Construction } from 'lucide-react';

function Placeholder({ title, milestone, description }: { title: string; milestone: string; description: string }) {
  return (
    <div className="space-y-4 p-6">
      <h1 className="text-lg font-semibold">{title}</h1>
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-16 text-center">
        <Construction className="size-8 text-muted-foreground" />
        <p className="text-sm font-medium">{milestone} 提供</p>
        <p className="max-w-md text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

export function InboxPage() {
  return (
    <Placeholder
      title="Inbox"
      milestone="M3（AI 富化）"
      description="待分析 / 解析失败 / 需要确认的媒体会集中在这里，支持一键重试与批量确认。"
    />
  );
}

export function AiActivityPage() {
  return (
    <Placeholder
      title="AI 活动"
      milestone="M3 + M6"
      description="AI Run 实时时间线、每步的工具调用与耗时、可交互的执行路径图都会显示在这里。"
    />
  );
}

export function SourcesPage() {
  return (
    <Placeholder
      title="来源"
      milestone="M2（MTProto 通道）"
      description="频道历史扫描、断点续扫、从源频道 copy 原始消息（无转发头）等能力将在此管理。"
    />
  );
}
