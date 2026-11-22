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

  const initializeApp = useCallback(async () => {
    const [status, restored] = await Promise.all([
      api.getAuthStatus(),
      api.restoreSession(),
    ]);
    if (restored) {
      setToken(restored.token);
      setUser(restored.user);
      setView('chat');
    }
    setAuthStatus(status);
  }, []);

  useEffect(() => {
    void initializeApp();
  }, [initializeApp]);

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
    void api.getAuthStatus().then(setAuthStatus);
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

  const isPrimaryAdmin = user.role === 'admin';

  if (view === 'admin' && isPrimaryAdmin) {
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
      onOpenAdmin={isPrimaryAdmin ? () => setView('admin') : undefined}
      onLogout={handleLogout}
      knowledgeRefreshKey={knowledgeRefreshKey}
    />
  );
}
