import React from 'react';
import Chart from 'react-apexcharts';
import { 
  LogOut, 
  Calendar, 
  TrendingUp, 
  TrendingDown, 
  ArrowUpRight, 
  ArrowDownRight, 
  DollarSign,
  Target,
  AlertTriangle,
  CreditCard,
  CalendarClock,
  X
} from 'lucide-react';

export default function Dashboard({ data, selectedMonth, onMonthChange, onLogout }) {
  const [selectedPerson, setSelectedPerson] = React.useState(null);

  // Fecha o modal de detalhamento com a tecla Escape (além do overlay e do ✖).
  React.useEffect(() => {
    if (!selectedPerson) return;
    const onKey = (e) => { if (e.key === 'Escape') setSelectedPerson(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedPerson]);

  const {
    mesPassado,
    mesPrevisao,
    totais = { saidas: 0, entradas: 0, saldo: 0 },
    gastos = [],
    rateio = {},
    previsao = {},
    metas = [],
    mesesDisponiveis = [],
    comprometido = null,
    avisos = []
  } = data;

  const faturaAberta = comprometido?.faturaAberta || null;
  // Q1: a projeção vem completa (length === horizonte); para a UI, só os meses com cobrança.
  const parcelasFuturas = (comprometido?.parcelas || []).filter(p => p.total > 0);

  const fmoeda = (valor) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0);
  };

  const arred = (n) => Math.round(n * 100) / 100;

  const totalGastos = gastos.reduce((sum, g) => sum + (g.confirmado || 0), 0);

  // Prepare data for the Treemap Chart (só categorias com gasto confirmado)
  const treemapSeries = [
    {
      data: gastos.filter(g => (g.confirmado || 0) > 0).map(g => {
        const pct = totalGastos > 0 ? (((g.confirmado || 0) / totalGastos) * 100).toFixed(1) : '0';
        return {
          x: [g.categoria, `${fmoeda(g.confirmado)} (${pct}%)`],
          y: g.confirmado
        };
      })
    }
  ];

  const treemapOptions = {
    legend: {
      show: false
    },
    chart: {
      type: 'treemap',
      toolbar: {
        show: false
      },
      background: 'transparent'
    },
    theme: {
      mode: 'dark',
      palette: 'palette1'
    },
    colors: ['#8b5cf6', '#06b6d4', '#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#ef4444'],
    plotOptions: {
      treemap: {
        enableShades: true,
        shadeIntensity: 0.5
      }
    },
    grid: {
      show: false
    },
    stroke: {
      width: 1,
      colors: ['rgba(255, 255, 255, 0.12)']
    },
    dataLabels: {
      enabled: true,
      style: {
        fontSize: '18px',
        fontWeight: 'bold',
        fontFamily: 'Outfit, sans-serif'
      },
      offsetY: -4
    }
  };

  // Helper to determine background of "Saldo com a Casa" card
  const getBalanceCardStyle = (val) => {
    if (val >= 0) {
      return 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300';
    } else {
      return 'bg-rose-500/10 border-rose-500/20 text-rose-300';
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header Section */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 pb-6 border-b border-white/5">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-white mb-1">
            Reunião Familiar
          </h1>
          <p className="text-slate-400 text-sm">
            Dashboard financeiro doméstico de Marcelo & Harumi
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 glass-panel px-3 py-2 rounded-xl text-slate-300">
            <Calendar className="w-4 h-4 text-purple-400" />
            <select
              value={selectedMonth}
              onChange={(e) => onMonthChange(e.target.value)}
              className="bg-transparent border-none text-slate-200 outline-none pr-8 cursor-pointer font-medium"
            >
              {mesesDisponiveis.map(m => (
                <option key={m} value={m} className="bg-slate-900 text-slate-200">
                  {m}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={onLogout}
            className="glass-btn-secondary p-2.5 flex items-center justify-center gap-2 text-slate-300 hover:text-white"
            title="Sair"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline text-sm">Sair</span>
          </button>
        </div>
      </header>

      {/* Warnings & Alerts */}
      {avisos.includes('salarios_zerados') && (
        <div className="mb-6 flex items-center gap-3 p-4 bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-2xl text-sm">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>
            <strong>Atenção:</strong> Configure os salários na aba <em>Salários</em> para calcular o rateio. Usando rateio padrão 50% / 50%.
          </span>
        </div>
      )}

      {/* 1. KPIs Section */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {/* Entradas & Saídas */}
        <div className="glass-card p-6 flex flex-col justify-between">
          <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">Entradas & Saídas</span>
          <div>
            <div className="flex items-baseline gap-2 mb-1 text-emerald-400">
              <TrendingUp className="w-4 h-4" />
              <span className="text-2xl font-bold">{fmoeda(totais.entradas)}</span>
            </div>
            <div className="flex items-baseline gap-2 text-rose-400">
              <TrendingDown className="w-4 h-4" />
              <span className="text-xl font-medium">{fmoeda(totais.saidas)}</span>
            </div>
          </div>
        </div>

        {/* Saldo Marcelo com a Casa */}
        <div 
          onClick={() => setSelectedPerson('Marcelo')}
          className={`glass-card p-6 border ${getBalanceCardStyle(rateio.saldo?.Marcelo)} flex flex-col justify-between cursor-pointer hover:border-purple-500/40 hover:bg-purple-500/5 transition-all`}
        >
          <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
            Saldo Marcelo c/ Casa
            {rateio.acumulado && <span className="normal-case font-normal text-slate-500"> (acum. até {mesPassado})</span>}
          </span>
          <div>
            {rateio.saldo?.Marcelo >= 0 ? (
              <div>
                <span className="text-2xl font-bold">{fmoeda(rateio.saldo.Marcelo)}</span>
                <p className="text-emerald-400/80 text-xs mt-1">Saldo positivo com a casa</p>
              </div>
            ) : (
              <div>
                <span className="text-2xl font-bold">{fmoeda(Math.abs(rateio.saldo?.Marcelo || 0))}</span>
                <p className="text-rose-400/80 text-xs mt-1 font-semibold">Deve à casa</p>
              </div>
            )}
          </div>
        </div>

        {/* Saldo Harumi com a Casa */}
        <div 
          onClick={() => setSelectedPerson('Harumi')}
          className={`glass-card p-6 border ${getBalanceCardStyle(rateio.saldo?.Harumi)} flex flex-col justify-between cursor-pointer hover:border-purple-500/40 hover:bg-purple-500/5 transition-all`}
        >
          <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
            Saldo Harumi c/ Casa
            {rateio.acumulado && <span className="normal-case font-normal text-slate-500"> (acum. até {mesPassado})</span>}
          </span>
          <div>
            {rateio.saldo?.Harumi >= 0 ? (
              <div>
                <span className="text-2xl font-bold">{fmoeda(rateio.saldo.Harumi)}</span>
                <p className="text-emerald-400/80 text-xs mt-1">Saldo positivo com a casa</p>
              </div>
            ) : (
              <div>
                <span className="text-2xl font-bold">{fmoeda(Math.abs(rateio.saldo?.Harumi || 0))}</span>
                <p className="text-rose-400/80 text-xs mt-1 font-semibold">Deve à casa</p>
              </div>
            )}
          </div>
        </div>

        {/* Depósitos Previstos Próx. Mês */}
        <div className="glass-card p-6 flex flex-col justify-between bg-purple-500/5">
          <span className="text-purple-300 text-xs font-semibold uppercase tracking-wider mb-2">Depósito Previsto ({mesPrevisao})</span>
          <div className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Marcelo:</span>
              <span className="text-slate-200 font-bold">{fmoeda(previsao.depositosPrevistos?.Marcelo)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Harumi:</span>
              <span className="text-slate-200 font-bold">{fmoeda(previsao.depositosPrevistos?.Harumi)}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Main Grid: Left & Right Columns */}
      {gastos.length === 0 ? (
        <div className="glass-card p-12 text-center my-8 animate-fade-in">
          <AlertCircleIcon className="w-12 h-12 text-slate-500 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-white mb-2">Sem lançamentos</h3>
          <p className="text-slate-400">Não foram encontrados lançamentos para o mês em questão.</p>
        </div>
      ) : (
        <div className="space-y-8 mb-8">
          {/* Treemap Chart (Full width on top) */}
          <div className="glass-card p-6">
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-purple-400" />
              Distribuição dos Gastos
            </h2>
            <div className="min-h-[350px]">
              <Chart
                options={treemapOptions}
                series={treemapSeries}
                type="treemap"
                height={350}
              />
            </div>
          </div>

          {/* Grid for Tables below the Treemap */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Gastos Table */}
            <div className="glass-card p-6">
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <ArrowDownRight className="w-5 h-5 text-rose-400" />
                Gastos por Categoria
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-300">
                  <thead>
                    <tr className="border-b border-white/5 text-slate-400">
                      <th className="py-2.5 font-semibold">Categoria</th>
                      <th className="py-2.5 text-right font-semibold">Previsão</th>
                      <th className="py-2.5 text-right font-semibold">Confirmado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {gastos.map(g => {
                      const previsto = g.previsto || 0;
                      const confirmado = g.confirmado || 0;
                      const orcamento = g.orcamento || 0;
                      // fixa ainda não paga (tem previsão, sem confirmado) → destaca em âmbar
                      const naoPaga = previsto > 0 && confirmado === 0;
                      // Barra de acompanhamento do teto (aba Orçamentos / fallback Contas Fixas).
                      // Contrato de cor: <100% cor natural (gradiente), ==100% verde, >100% vermelho.
                      const pct = orcamento > 0 ? confirmado / orcamento : null;
                      const estourou = pct !== null && pct > 1;
                      // No alvo = chegou em 100% sem estourar (casa com o rótulo arredondado).
                      const noAlvo = pct !== null && !estourou && Math.round(pct * 100) === 100;
                      const barCor = pct === null
                        ? ''
                        : estourou
                          ? 'bg-rose-500'
                          : noAlvo
                            ? 'bg-emerald-500'
                            : 'bg-gradient-to-r from-purple-500 to-cyan-500';
                      return (
                        <tr key={g.categoria} className="hover:bg-white/2 transition-colors">
                          <td className="py-2.5 font-medium text-slate-200">
                            {g.categoria}
                            {pct !== null && (
                              <div className="mt-1.5 flex items-center gap-2">
                                <div className="flex-1 bg-white/5 rounded-full h-1.5 overflow-hidden max-w-[140px]">
                                  <div
                                    className={`h-full rounded-full transition-all duration-500 ease-out ${barCor}`}
                                    style={{ width: `${Math.min(pct, 1) * 100}%` }}
                                  ></div>
                                </div>
                                <span className={`text-[10px] font-semibold ${estourou ? 'text-rose-400' : 'text-slate-500'}`}>
                                  {Math.round(pct * 100)}%{estourou ? ` · +${fmoeda(confirmado - orcamento)}` : ''}
                                </span>
                              </div>
                            )}
                          </td>
                          {/* Previsão = teto do orçamento (cai pro valor_esperado da Contas Fixas via fallback) */}
                          <td className="py-2.5 text-right text-slate-400 align-top">{orcamento > 0 ? fmoeda(orcamento) : '—'}</td>
                          <td className={`py-2.5 text-right font-semibold align-top ${naoPaga ? 'text-amber-400' : estourou ? 'text-rose-400' : 'text-slate-100'}`}>
                            {naoPaga ? 'a pagar' : fmoeda(confirmado)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Previsão do Próximo Mês */}
            <div className="glass-card p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <ArrowUpRight className="w-5 h-5 text-cyan-400" />
                  Previsão Próximo Mês ({mesPrevisao})
                </h2>
                <div className="text-right">
                  <span className="text-xs text-slate-400 block">Total Previsto</span>
                  <span className="text-lg font-extrabold text-cyan-400">{fmoeda(previsao.gastos?.total)}</span>
                </div>
              </div>

              {/* Sub-totals info */}
              <div className="grid grid-cols-2 gap-4 mb-6 p-3 bg-white/2 rounded-xl border border-white/5">
                <div>
                  <span className="text-xs text-slate-400 block">Contas Fixas</span>
                  <span className="text-sm font-semibold text-slate-200">{fmoeda(previsao.gastos?.fixas)}</span>
                </div>
                <div>
                  <span className="text-xs text-slate-400 block">Fatura do Cartão</span>
                  <span className="text-sm font-semibold text-slate-200">{fmoeda(previsao.gastos?.parcelas)}</span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-300">
                  <thead>
                    <tr className="border-b border-white/5 text-slate-400">
                      <th className="py-2.5 font-semibold">Conta / Descrição</th>
                      <th className="py-2.5 text-right font-semibold">Valor Estimado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {(previsao.detalhes || []).map((d, index) => (
                      <tr key={index} className="hover:bg-white/2 transition-colors">
                        <td className="py-2.5 text-slate-200">{d.categoria}</td>
                        <td className="py-2.5 text-right font-semibold text-slate-100">{fmoeda(d.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Comprometido Futuro (v2 — fatura aberta + projeção de parcelas) */}
      <section className="mt-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-cyan-400" />
            Comprometido Futuro
          </h2>
          <span className="text-xs text-slate-500">prospectivo, a partir de hoje</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Fatura aberta do ciclo corrente */}
          <div className="glass-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-white">
                Fatura Aberta {faturaAberta ? <span className="text-slate-400 font-medium text-sm">(vence {faturaAberta.ciclo})</span> : null}
              </h3>
              {faturaAberta && (
                <div className="text-right">
                  <span className="text-xs text-slate-400 block">Total do ciclo</span>
                  <span className="text-lg font-extrabold text-cyan-400">{fmoeda(faturaAberta.total)}</span>
                </div>
              )}
            </div>

            {faturaAberta ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-300">
                  <thead>
                    <tr className="border-b border-white/5 text-slate-400">
                      <th className="py-2.5 font-semibold">Categoria (C6)</th>
                      <th className="py-2.5 text-right font-semibold">Valor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {(faturaAberta.porCategoria || []).map(c => (
                      <tr key={c.categoria} className="hover:bg-white/2 transition-colors">
                        <td className="py-2.5 font-medium text-slate-200">{c.categoria}</td>
                        <td className="py-2.5 text-right font-semibold text-slate-100">{fmoeda(c.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-slate-500 text-sm py-4">
                Nenhuma fatura aberta capturada. Use <span className="text-slate-300 font-mono">/faturaaberta</span> no Telegram para colar a fatura do ciclo atual.
              </p>
            )}
          </div>

          {/* Projeção das parcelas futuras */}
          <div className="glass-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-purple-400" />
                Parcelas Futuras
              </h3>
              {parcelasFuturas.length > 0 && (
                <div className="text-right">
                  <span className="text-xs text-slate-400 block">Total projetado</span>
                  <span className="text-lg font-extrabold text-purple-300">
                    {fmoeda(parcelasFuturas.reduce((s, p) => s + p.total, 0))}
                  </span>
                </div>
              )}
            </div>

            {parcelasFuturas.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-300">
                  <thead>
                    <tr className="border-b border-white/5 text-slate-400">
                      <th className="py-2.5 font-semibold">Vencimento</th>
                      <th className="py-2.5 text-right font-semibold">Valor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {parcelasFuturas.map(p => (
                      <tr key={p.vencimento} className="hover:bg-white/2 transition-colors">
                        <td className="py-2.5 text-slate-200">{p.vencimento}</td>
                        <td className="py-2.5 text-right font-semibold text-slate-100">{fmoeda(p.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-slate-500 text-sm py-4">
                Nenhuma parcela futura projetada. Semeie as parcelas em andamento com <span className="text-slate-300 font-mono">/seedparcelas</span>.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* 2. Metas Temporárias Section */}
      <section className="mt-8">
        <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
          <Target className="w-5 h-5 text-purple-400" />
          Metas Temporárias Ativas
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {metas.length > 0 ? (
            metas.map((m, index) => {
              const acum = Number(m.valor_acumulado) || 0;
              const total = Number(m.orcamento_total) || 1;
              const pct = Math.min(Math.round((acum / total) * 100), 100);
              
              return (
                <div key={index} className="glass-card p-6 glass-card-hover flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-start gap-2 mb-3">
                      <span className="font-bold text-white text-lg">{m.nome}</span>
                      <span className="px-2 py-0.5 bg-white/5 border border-white/10 rounded-md text-[11px] text-slate-400 font-medium">
                        Prazo: {m.prazo || 's/d'}
                      </span>
                    </div>

                    <div className="w-full bg-white/5 rounded-full h-2.5 mb-3 overflow-hidden">
                      <div 
                        className="bg-gradient-to-r from-purple-500 to-cyan-500 h-full rounded-full transition-all duration-500 ease-out"
                        style={{ width: `${pct}%` }}
                      ></div>
                    </div>
                  </div>

                  <div className="flex justify-between items-center text-xs mt-2">
                    <span className="text-purple-300 font-semibold">{fmoeda(acum)} ({pct}%)</span>
                    <span className="text-slate-400">Alvo: {fmoeda(total)}</span>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-slate-500 text-sm col-span-full">
              Nenhuma meta temporária ativa cadastrada no momento.
            </p>
          )}
        </div>
      </section>

      {selectedPerson && (
        <div 
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in"
          onClick={() => setSelectedPerson(null)}
        >
          <div 
            className="glass-panel w-full max-w-3xl p-6 rounded-2xl border border-white/10 shadow-2xl relative max-h-[85vh] flex flex-col animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <button 
              onClick={() => setSelectedPerson(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors"
              title="Fechar"
            >
              <X className="w-5 h-5" />
            </button>
            
            <h3 className="text-2xl font-bold text-white mb-1">
              Detalhamento do Saldo — {selectedPerson}
            </h3>
            <p className="text-slate-400 text-sm mb-6">
              Evolução mensal do saldo acumulado até {selectedMonth}
            </p>

            <div className="overflow-y-auto flex-1 pr-1">
              <table className="w-full text-left text-sm text-slate-300">
                <thead>
                  <tr className="border-b border-white/10 text-slate-400">
                    <th className="py-3 font-semibold">Mês</th>
                    <th className="py-3 text-right font-semibold">Cota da Casa</th>
                    <th className="py-3 text-right font-semibold">Gastos Excl.</th>
                    <th className="py-3 text-right font-semibold">Depósitos</th>
                    <th className="py-3 text-right font-semibold">Saldo Mês</th>
                    <th className="py-3 text-right font-semibold">Acumulado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {(() => {
                    const hist = rateio.historico || [];
                    if (hist.length === 0) {
                      return (
                        <tr>
                          <td colSpan="6" className="py-8 text-center text-slate-500">
                            Sem histórico de lançamentos para este período.
                          </td>
                        </tr>
                      );
                    }
                    return hist.map((h) => {
                      const excl = h.exclusivo?.[selectedPerson] || 0;
                      const cotaTotal = h.cota?.[selectedPerson] || 0;
                      const cotaBase = arred(cotaTotal - excl);
                      const pago = h.pago?.[selectedPerson] || 0;
                      const saldoMes = h.saldo?.[selectedPerson] || 0;
                      const acum = h.saldoAcumulado?.[selectedPerson] || 0;

                      return (
                        <tr key={h.mes} className="hover:bg-white/2 transition-colors">
                          <td className="py-3 font-medium text-slate-200">{h.mes}</td>
                          <td className="py-3 text-right text-slate-300">{fmoeda(cotaBase)}</td>
                          <td className="py-3 text-right text-slate-300">{fmoeda(excl)}</td>
                          <td className="py-3 text-right text-emerald-400">{fmoeda(pago)}</td>
                          <td className={`py-3 text-right font-semibold ${saldoMes >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {saldoMes >= 0 ? '+' : ''}{fmoeda(saldoMes)}
                          </td>
                          <td className={`py-3 text-right font-extrabold ${acum >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {fmoeda(acum)}
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Inline helper icon since Lucide AlertCircle might not be imported or conflict
function AlertCircleIcon(props) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}
