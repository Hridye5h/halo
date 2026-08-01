import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar.jsx';
import { Toasts } from '../components/ui/Toasts.jsx';
import { ConnectionBanner } from '../components/ui/ConnectionBanner.jsx';
import { IdentityTokenModal } from '../features/auth/IdentityTokenModal.jsx';
import { useSocketBridge } from './useSocketBridge.js';

export function AppShell() {
  useSocketBridge();

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="relative min-w-0 flex-1">
        <ConnectionBanner />
        <Outlet />
      </main>
      <Toasts />
      <IdentityTokenModal />
    </div>
  );
}
