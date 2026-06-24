import React, { useState, useEffect } from 'react';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';

function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem('dashboard_token') || '');
  const [data, setData] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogout = () => {
    sessionStorage.removeItem('dashboard_token');
    setToken('');
    setData(null);
    setSelectedMonth('');
    setError('');
  };

  const fetchDashboardData = async (month, authToken) => {
    setLoading(true);
    setError('');
    try {
      const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:5678/webhook/dashboard-data';
      const url = month ? `${baseUrl}?mes=${month}` : baseUrl;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          handleLogout();
          throw new Error('Sessão expirada. Faça login novamente.');
        }
        throw new Error('Erro ao obter os dados do servidor.');
      }

      const resData = await response.json();

      // O webhook devolve HTTP 200 + { error } para senha inválida / sessão expirada.
      if (resData.error) {
        handleLogout();
        throw new Error('Sessão expirada. Faça login novamente.');
      }

      setData(resData);

      // If no month was selected yet, default to the one returned as mesPassado
      if (!month && resData.mesPassado) {
        setSelectedMonth(resData.mesPassado);
      }
    } catch (err) {
      setError(err.message || 'Erro de conexão.');
    } finally {
      setLoading(false);
    }
  };

  const handleLoginSuccess = (password, initialData) => {
    sessionStorage.setItem('dashboard_token', password);
    setToken(password);
    setData(initialData);
    if (initialData.mesPassado) {
      setSelectedMonth(initialData.mesPassado);
    }
  };

  const handleMonthChange = (month) => {
    setSelectedMonth(month);
    fetchDashboardData(month, token);
  };

  // Fetch initial data if we already have a token in sessionStorage
  useEffect(() => {
    if (token) {
      fetchDashboardData('', token);
    }
  }, [token]);

  if (!token) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  if (loading && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-purple-500 mx-auto mb-4" />
          <p className="text-slate-400 font-medium">Carregando dados do dashboard...</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md glass-panel p-6 rounded-2xl text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Erro de Conexão</h2>
          <p className="text-slate-400 mb-6">{error}</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => fetchDashboardData(selectedMonth, token)}
              className="glass-btn px-4 py-2 text-sm flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Tentar Novamente</span>
            </button>
            <button
              onClick={handleLogout}
              className="glass-btn-secondary px-4 py-2 text-sm"
            >
              <span>Voltar</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // If we have data, render the dashboard
  return data ? (
    <div className="min-h-screen relative">
      {/* Background Glow Blobs */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-purple-900/10 rounded-full filter blur-3xl -z-10"></div>
      <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-cyan-900/10 rounded-full filter blur-3xl -z-10"></div>
      
      {/* Loading Overlay for subsequent selections */}
      {loading && (
        <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs flex items-center justify-center z-50">
          <div className="glass-panel px-6 py-4 rounded-xl flex items-center gap-3 border border-white/10">
            <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
            <span className="text-slate-200 text-sm font-medium">Atualizando dados...</span>
          </div>
        </div>
      )}

      <Dashboard
        data={data}
        selectedMonth={selectedMonth}
        onMonthChange={handleMonthChange}
        onLogout={handleLogout}
      />
    </div>
  ) : null;
}

export default App;
