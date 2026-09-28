import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router';
import { Toaster } from '@/components/ui/sonner';
import App from './App';
import { queryClient } from '@/lib/queryClient';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <App />
      </HashRouter>
      <Toaster position="top-right" richColors />
    </QueryClientProvider>
  </StrictMode>,
);
