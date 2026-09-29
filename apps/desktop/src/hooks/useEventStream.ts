import { useEffect } from 'react';
import { toast } from 'sonner';
import type { WsFrame } from '@tma/shared';
import { api } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';
import { useConnectionStore } from '@/stores/connection';

const FLUSH_DELAY_MS = 200;
const MAX_BACKOFF_MS = 30_000;

export function useEventStream(): void {
  const setOnline = useConnectionStore((s) => s.setOnline);
  const markEvent = useConnectionStore((s) => s.markEvent);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let disposed = false;
    let attempt = 0;
    let reconnectTimer: number | undefined;
    let flushTimer: number | undefined;
    const pendingMediaIds = new Set<number>();
    let pendingBroad = false;

    const flush = () => {
      const ids = [...pendingMediaIds];
      pendingMediaIds.clear();
      const broad = pendingBroad;
      pendingBroad = false;

      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      void queryClient.invalidateQueries({ queryKey: ['media'] });
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      void queryClient.invalidateQueries({ queryKey: ['inbox'] });
      void queryClient.invalidateQueries({ queryKey: ['ai-runs'] });
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
      void queryClient.invalidateQueries({ queryKey: ['tags'] });
      if (broad) void queryClient.invalidateQueries({ queryKey: ['media'] });
      for (const id of ids) {
        void queryClient.invalidateQueries({ queryKey: ['media', id] });
      }
    };

    const scheduleFlush = () => {
      if (flushTimer !== undefined) return;
      flushTimer = window.setTimeout(() => {
        flushTimer = undefined;
        flush();
      }, FLUSH_DELAY_MS);
    };

    const connect = () => {
      if (disposed) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(api.wsUrl());
      } catch {
        reconnectTimer = window.setTimeout(connect, 2_000);
        return;
      }
      socket = ws;

      ws.onopen = () => {
        attempt = 0;
        setOnline(true);
      };

      ws.onmessage = (event) => {
        let frame: WsFrame;
        try {
          frame = JSON.parse(String(event.data)) as WsFrame;
        } catch {
          return;
        }
        if (frame.type === 'hello' || frame.type === 'ping') {
          markEvent();
          return;
        }
        markEvent();
        const mediaId = frame.payload?.mediaId;
        if (typeof mediaId === 'number') pendingMediaIds.add(mediaId);
        if (frame.event === 'job.failed') {
          const message = typeof frame.payload?.error === 'string' ? frame.payload.error : '任务失败';
          toast.error(`任务失败：${message.slice(0, 120)}`);
        }
        if (frame.event === 'telegram.message.forwarded') {
          toast.success('已转发到 Telegram');
        }
        if (frame.event === 'media.manual_review') {
          toast.info('命中「跳过 AI」来源，已送入待分类队列');
        }
        pendingBroad = true;
        scheduleFlush();
      };

      ws.onclose = () => {
        setOnline(false);
        if (disposed) return;
        if (socket === ws) socket = null;
        attempt += 1;
        const delay = Math.min(1_000 * 2 ** attempt, MAX_BACKOFF_MS);
        reconnectTimer = window.setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      if (flushTimer !== undefined) window.clearTimeout(flushTimer);
      socket?.close();
    };
  }, [setOnline, markEvent]);
}
