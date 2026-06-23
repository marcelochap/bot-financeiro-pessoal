# Detalhamento do Saldo Acumulado Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a clickable interaction for the household balance cards in the dashboard web, opening a glassmorphic modal showing the month-by-month breakdown of the cumulative balance.

**Architecture:** Calculate historical month-by-month rateio details on the backend (webhook code) and add them to the `rateio.historico` payload, then render them inside a React Modal overlay in the frontend.

**Tech Stack:** React (Vite + TailwindCSS), Node.js (n8n code modules), Jest/Assert (TDD).

---

### Task 1: Backend rateio.js calculations
**Files:**
- Modify: [rateio.js](file:///c:/Projetos%20Claude/Bot%20de%20controle%20financeiro/workflows/src/rateio.js)
- Test: [rateio.test.js](file:///c:/Projetos%20Claude/Bot%20de%20controle%20financeiro/workflows/src/rateio.test.js)

- [ ] **Step 1: Add historical breakdown assertions to the test file**
  Add a new test inside `workflows/src/rateio.test.js`:
  ```javascript
  teste("rateioAcumulado: calcula histórico com evolução de saldos e exclusivos", () => {
    const r = rateioAcumulado(LANC_MULTI, SAL, "05/2026");
    assert.ok(r.historico);
    assert.strictEqual(r.historico.length, 2);
    assert.strictEqual(r.historico[0].mes, "04/2026");
    assert.strictEqual(r.historico[1].mes, "05/2026");
    
    // Marcelo cota em 04/2026: 1000 * (20/24) = 833.33. Pago: 400. Saldo: 400 - 833.33 = -433.33
    assert.strictEqual(r.historico[0].saldoAcumulado.Marcelo, -433.33);
    assert.strictEqual(r.historico[0].exclusivo.Marcelo, 0);

    // Harumi cota em 05/2026: 2000 * (4/24) = 333.33. Pago: 100. Saldo: 100 - 333.33 = -233.33
    // Saldo acumulado Harumi em 05/2026: -166.67 + -233.33 = -400.00
    assert.strictEqual(r.historico[1].saldoAcumulado.Harumi, -400);
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `node workflows/src/rateio.test.js`
  Expected: FAIL (cannot read property length of undefined)

- [ ] **Step 3: Implement historical calculations in `rateioAcumulado`**
  Modify `rateioAcumulado` in `workflows/src/rateio.js`:
  ```javascript
  function rateioAcumulado(lancamentos, salarios, mesAte) {
    const prop = proporcoes(salarios);
    const ate = mesParaNum(mesAte);
    const ateOuAntes = lancamentos.filter((l) => {
      const m = mesParaNum(mesDe(l.data_competencia));
      return m !== null && (ate === null || m <= ate);
    });
    
    const acumuladoGeral = calcularRateio(ateOuAntes, prop);
    
    const mesesSet = new Set();
    for (const l of ateOuAntes) {
      const m = mesDe(l.data_competencia);
      if (m) mesesSet.add(m);
    }
    const mesesOrdenados = [...mesesSet].sort((a, b) => {
      return mesParaNum(a) - mesParaNum(b);
    });
    
    const historico = [];
    const saldoAcumulado = {};
    const pessoas = Object.keys(prop);
    for (const p of pessoas) {
      saldoAcumulado[p] = 0;
    }
    
    for (const m of mesesOrdenados) {
      const doMes = lancamentos.filter((l) => mesDe(l.data_competencia) === m);
      const rMes = calcularRateio(doMes, prop);
      
      for (const p of pessoas) {
        saldoAcumulado[p] = arred(saldoAcumulado[p] + rMes.saldo[p]);
      }
      
      const exclusivoMes = {};
      for (const p of pessoas) {
        exclusivoMes[p] = 0;
        for (const l of doMes) {
          if (l.tipo === "saída" && l.status === "confirmado") {
            if (categoriaExclusivaDe(l.categoria, pessoas) === p) {
              exclusivoMes[p] = arred(exclusivoMes[p] + valorNum(l.valor));
            }
          }
        }
      }
      
      historico.push({
        mes: m,
        totalDespesas: rMes.totalDespesas,
        cota: rMes.cota,
        exclusivo: exclusivoMes,
        pago: rMes.pago,
        saldo: rMes.saldo,
        saldoAcumulado: { ...saldoAcumulado }
      });
    }
    
    return { 
      mesAte, 
      acumulado: true, 
      proporcoes: prop, 
      ...acumuladoGeral,
      historico 
    };
  }
  ```

- [ ] **Step 4: Run tests to verify all tests pass**
  Run: `node workflows/src/rateio.test.js`
  Expected: PASS (all tests including new test pass)

- [ ] **Step 5: Run full suite to ensure zero regressions**
  Run: `Get-ChildItem workflows/src/*.test.js | ForEach-Object { node $_.FullName }`
  Expected: PASS (all files pass)

---

### Task 2: Regenerate and Import n8n Workflows
**Files:**
- Modify: [dashboard.json](file:///c:/Projetos%20Claude/Bot%20de%20controle%20financeiro/workflows/dashboard.json)

- [ ] **Step 1: Regenerate dashboard workflow JSON**
  Run: `node scripts/gerar-workflow-dashboard.js`
  Expected: Success output showing dashboard.json was generated.

- [ ] **Step 2: Import workflow into local running n8n instance**
  Run: `powershell .\scripts\import-workflows.ps1`
  Expected: Success output.

- [ ] **Step 3: Commit changes**
  Run:
  ```bash
  git add workflows/src/rateio.js workflows/src/rateio.test.js workflows/dashboard.json
  git commit -m "feat(backend): add historical breakdown calculation to rateioAcumulado"
  ```

---

### Task 3: Implement Dashboard Clickable Cards & Modal UI
**Files:**
- Modify: [Dashboard.jsx](file:///c:/Projetos%20Claude/Bot%20de%20controle%20financeiro/dashboard-web/src/components/Dashboard.jsx)

- [ ] **Step 1: Import X icon from lucide-react**
  Modify imports in `Dashboard.jsx` to include `X`:
  ```javascript
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
  ```

- [ ] **Step 2: Add local state in Dashboard component**
  Add the local state at the beginning of `Dashboard`:
  ```javascript
  const [selectedPerson, setSelectedPerson] = React.useState(null);
  ```

- [ ] **Step 3: Make cards clickable**
  Modify Marcelo's and Harumi's KPI card wrappers in `Dashboard.jsx` to respond to click events and show hover effects:
  ```javascript
  // Marcelo Card
  <div 
    onClick={() => rateio.historico && setSelectedPerson('Marcelo')}
    className={`glass-card p-6 border ${getBalanceCardStyle(rateio.saldo?.Marcelo)} flex flex-col justify-between cursor-pointer hover:border-purple-500/40 hover:bg-purple-500/5 transition-all`}
  >
  
  // Harumi Card
  <div 
    onClick={() => rateio.historico && setSelectedPerson('Harumi')}
    className={`glass-card p-6 border ${getBalanceCardStyle(rateio.saldo?.Harumi)} flex flex-col justify-between cursor-pointer hover:border-purple-500/40 hover:bg-purple-500/5 transition-all`}
  >
  ```

- [ ] **Step 4: Implement modal rendering at the bottom of the component**
  Add modal HTML structure at the end of the Dashboard component (just before the final outer `</div>`):
  ```javascript
  {selectedPerson && (
    <div 
      className="fixed inset-0 bg-slate-950/60 backdrop-blur-md flex items-center justify-center p-4 z-50"
      onClick={() => setSelectedPerson(null)}
    >
      <div 
        className="glass-panel w-full max-w-3xl p-6 rounded-2xl border border-white/10 shadow-2xl relative max-h-[85vh] flex flex-col"
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
  ```

- [ ] **Step 5: Run EsLint checks**
  Run: `npm run lint` inside `dashboard-web` directory to make sure there are no syntax or React errors.

- [ ] **Step 6: Commit changes**
  Run:
  ```bash
  git add dashboard-web/src/components/Dashboard.jsx
  git commit -m "feat(frontend): implement modal pop-up breakdown for balance cards"
  ```
