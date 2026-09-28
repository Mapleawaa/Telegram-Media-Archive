import { Navigate, Route, Routes } from 'react-router';
import { AppShell } from '@/components/layout/AppShell';
import { useEventStream } from '@/hooks/useEventStream';
import { AiActivityPage } from '@/pages/ai/AiActivityPage';
import { DashboardPage } from '@/pages/dashboard/DashboardPage';
import { InboxPage } from '@/pages/inbox/InboxPage';
import { LibraryPage } from '@/pages/library/LibraryPage';
import { MediaDetailPage } from '@/pages/media/MediaDetailPage';
import { SourcesPage } from '@/pages/placeholders';
import { SearchPage } from '@/pages/search/SearchPage';
import { SettingsPage } from '@/pages/settings/SettingsPage';

export default function App() {
  useEventStream();

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="library" element={<LibraryPage />} />
        <Route path="media/:id" element={<MediaDetailPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="ai" element={<AiActivityPage />} />
        <Route path="sources" element={<SourcesPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
