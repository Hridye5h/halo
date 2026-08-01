import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from './stores/useAuth.js';
import { AppShell } from './app/AppShell.jsx';
import { AuthPage } from './features/auth/AuthPage.jsx';
import { HomePage } from './features/home/HomePage.jsx';
import { ChatPage } from './features/chat/ChatPage.jsx';
import { ProfilePage } from './features/profile/ProfilePage.jsx';
import { SettingsPage } from './features/settings/SettingsPage.jsx';
import { TimelinePage } from './features/timeline/TimelinePage.jsx';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Realtime pushes keep things fresh; refetching on focus would just
      // duplicate work the socket already did.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: 1,
    },
  },
});

export default function App() {
  const status = useAuth((s) => s.status);
  const bootstrap = useAuth((s) => s.bootstrap);

  useEffect(() => { bootstrap(); }, [bootstrap]);

  if (status === 'loading') {
    return (
      <div className="grid h-screen place-items-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          {status === 'authed' ? (
            <Route element={<AppShell />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/friends" element={<HomePage />} />
              <Route path="/chat/:conversationId" element={<ChatPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/profile/:userId" element={<ProfilePage />} />
              <Route path="/timeline/:friendshipId" element={<TimelinePage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          ) : (
            <>
              <Route path="/" element={<AuthPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </>
          )}
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
