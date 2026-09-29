import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router';
import { Toaster } from '@/components/ui/sonner';
import App from './App';
import { queryClient } from '@/lib/queryClient';
import '@/stores/appearance'; // 侧效应：启动时把字体偏好写到 <html data-font>
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* 影音客户端惯例：深色优先；主题写到 <html class="dark">，sonner 也读同一处 */}
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem storageKey="tma.theme">
      <QueryClientProvider client={queryClient}>
        <HashRouter>
          <App />
        </HashRouter>
        <Toaster position="top-right" richColors />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
