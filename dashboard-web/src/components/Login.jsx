import React, { useState } from 'react';
import { Lock, AlertCircle, Loader2 } from 'lucide-react';

export default function Login({ onLoginSuccess }) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!password.trim()) return;

    setLoading(true);
    setError('');

    try {
      const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:5678/webhook/dashboard-data';
      const response = await fetch(baseUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${password.trim()}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Senha inválida. Tente novamente.');
        }
        throw new Error('Erro ao conectar ao servidor.');
      }

      const data = await response.json();

      // O webhook responde HTTP 200 mesmo para senha errada, sinalizando via { error }.
      if (data.error) {
        throw new Error(data.error === 'Senha inválida' ? 'Senha inválida. Tente novamente.' : data.error);
      }

      onLoginSuccess(password.trim(), data);
    } catch (err) {
      setError(err.message || 'Erro inesperado.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      {/* Decorative Blur Blobs */}
      <div className="absolute top-1/4 left-1/4 w-72 h-72 bg-purple-600/20 rounded-full filter blur-3xl -z-10 animate-pulse"></div>
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-cyan-600/20 rounded-full filter blur-3xl -z-10 animate-pulse" style={{ animationDelay: '2s' }}></div>

      <div className="w-full max-w-md glass-panel p-8 rounded-2xl animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex p-3 bg-purple-500/10 rounded-2xl border border-purple-500/25 mb-4 text-purple-400">
            <Lock className="w-8 h-8" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Reunião Familiar</h1>
          <p className="text-slate-400 text-sm">Insira a senha de acesso para visualizar o dashboard de controle financeiro.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2" htmlFor="password">
              Senha de Acesso
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              disabled={loading}
              className="w-full glass-input px-4 py-3 pl-4 focus:pl-4 transition-all duration-300"
              required
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 text-red-300 rounded-xl text-sm animate-fade-in">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full glass-btn py-3 flex items-center justify-center gap-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Autenticando...</span>
              </>
            ) : (
              <span>Entrar no Dashboard</span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
