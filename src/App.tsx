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

  const fetchAuthStatus = useCallback(async () => {
    const status = await api.getAuthStatus();
    setAuthStatus(status);
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
    api.logout(token);
    setToken(null);
    setUser(null);
    setView('chat');
    void fetchAuthStatus();
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
    return <LoginScreen onAuthenticated={handleAuthenticated} />;
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
