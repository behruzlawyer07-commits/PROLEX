import { useCallback, useEffect, useState } from 'react';
import { AdminPanel } from './components/AdminPanel';
import { ChatWorkspace } from './components/ChatWorkspace';
import { EmblemImage } from './components/EmblemImage';
import { LoginScreen } from './components/LoginScreen';
import { api } from './lib/api';
import type { AuthStatusResponse, UserPublic } from './types/sherlex';

export default function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatusResponse | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserPublic | null>(null);
  const [view, setView] = useState<'chat' | 'admin'>('chat');
  const [knowledgeRefreshKey, setKnowledgeRefreshKey] = useState(0);
  const [initError, setInitError] = useState('');

  const fetchAuthStatus = useCallback(async () => {
    try {
      const status = await api.getAuthStatus();
      setAuthStatus(status);
      setInitError('');
    } catch {
      setInitError('Server bilan aloqa o‘rnatib bo‘lmadi. Sahifani yangilab ko‘ring.');
    }
  }, []);

  useEffect(() => {
    void fetchAuthStatus();
  }, [fetchAuthStatus]);

  function handleAuthenticated(newToken: string, loggedUser: UserPublic) {
    setToken(newToken);
    setUser(loggedUser);
    setView('chat');
  }

  function handleLogout() {
    setToken(null);
    setUser(null);
    setView('chat');
    void fetchAuthStatus();
  }

  if (initError) {
    return (
      <div className="min-h-screen bg-[#081120] text-[#F4F1EA] flex flex-col items-center justify-center p-6 text-center gap-4">
        <EmblemImage size="md" />
        <p className="text-sm text-red-300 max-w-md">{initError}</p>
        <button
          type="button"
          onClick={() => void fetchAuthStatus()}
          className="px-4 py-2 rounded-lg bg-[#D4AF37] text-[#081120] text-xs font-semibold cursor-pointer"
        >
          Qayta urinish
        </button>
      </div>
    );
  }

  if (!authStatus) {
    return (
      <div className="min-h-screen bg-[#081120] text-[#F4F1EA] flex flex-col items-center justify-center p-6 gap-3">
        <EmblemImage size="md" />
        <p className="text-xs text-[#9FB0C7]">PROLEX tizimi yuklanmoqda...</p>
      </div>
    );
  }

  if (!token || !user) {
    return (
      <LoginScreen
        authStatus={authStatus}
        onAuthenticated={handleAuthenticated}
        onRefreshStatus={fetchAuthStatus}
      />
    );
  }

  if (view === 'admin' && user.role === 'admin') {
    return (
      <AdminPanel
        token={token}
        currentUser={user}
        onBackToChat={() => setView('chat')}
        onLogout={handleLogout}
        onDocumentsChanged={() => setKnowledgeRefreshKey((k) => k + 1)}
      />
    );
  }

  return (
    <ChatWorkspace
      token={token}
      user={user}
      onOpenAdmin={() => user.role === 'admin' && setView('admin')}
      onLogout={handleLogout}
      knowledgeRefreshKey={knowledgeRefreshKey}
    />
  );
}
