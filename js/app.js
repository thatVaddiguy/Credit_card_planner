/* UI layer: reads inputs, runs the Planner engine, renders the plan. */
(function () {
  "use strict";

  const STORE_KEY = "ccplanner.v1";
  const PLAN_DEFS = [
    { id: "easy", name: "Easy", months: 60, color: "--plan-easy" },
    { id: "medium", name: "Medium", months: 36, color: "--plan-medium" },
    { id: "aggressive", name: "Fast", months: 18, color: "--plan-aggressive" },
    { id: "custom", name: "Yours", months: null, color: "--plan-custom" },
  ];
  const EXAMPLE = [
    { bank: "Chase", name: "", balance: 5200, apr: 24.99, minPayment: "" },
    { bank: "Capital One", name: "", balance: 2800, apr: 19.49, minPayment: "" },
    { bank: "Synchrony", name: "", balance: 1300, apr: 29.99, minPayment: "" },
  ];
  const EXAMPLE_BUDGET = {
    salary: "3800", freq: "monthly", cushion: "10",
    expenses: [
      { name: "Rent / mortgage", amount: "1450" },
      { name: "Car payment", amount: "360" },
      { name: "Groceries", amount: "450" },
      { name: "Utilities & phone", amount: "370" },
    ],
  };
  const EMPTY_BUDGET = () => ({
    salary: "", freq: "monthly", cushion: "10",
    expenses: [{ name: "Rent / mortgage", amount: "" }, { name: "Electricity", amount: "" }, { name: "Car payment", amount: "" }],
  });
  const FREQ = { monthly: 1, semimonthly: 2, biweekly: 26 / 12, weekly: 52 / 12, yearly: 1 / 12 };
  const DEFAULT_LOAN = { apr: "12", term: "36", fee: "3" };

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const monthFmt = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });

  let state = load() || { cards: EXAMPLE.map((c) => ({ ...c })), strategy: "avalanche", customBudget: "", selected: "medium", isExample: true };
  if (!state.budget) state.budget = state.isExample ? cloneBudget(EXAMPLE_BUDGET) : EMPTY_BUDGET();
  if (!state.loan) state.loan = { ...DEFAULT_LOAN };
  let pickedByUser = false;
  let charts = {};
  let lastResult = null;

  function cloneBudget(b) { return { ...b, expenses: b.expenses.map((e) => ({ ...e })) }; }
  function load() { try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { return null; } }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ } }

  /* ---------- helpers ---------- */
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const seriesColor = (i) => css(`--s${(i % 8) + 1}`);
  function monthDate(m) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + m); return d; }
  const dateLabel = (m) => monthFmt.format(monthDate(m));
  function duration(m) {
    if (!isFinite(m)) return "never";
    const y = Math.floor(m / 12), r = m % 12;
    const parts = [];
    if (y) parts.push(`${y} yr${y > 1 ? "s" : ""}`);
    if (r || !y) parts.push(`${r} mo`);
    return parts.join(" ");
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  function cardLabels(cards) {
    const base = cards.map((c, i) => [c.bank, c.name].filter(Boolean).join(" · ") || `Card ${i + 1}`);
    const seen = {};
    return base.map((b) => (base.filter((x) => x === b).length > 1 ? `${b} ${(seen[b] = (seen[b] || 0) + 1)}` : b));
  }
  function edited() { pickedByUser = false; if (state.isExample) { state.isExample = false; $("#example-note").hidden = true; } }

  /* ---------- step 1: cards ---------- */
  function renderCardInputs() {
    const list = $("#card-list");
    list.innerHTML = "";
    state.cards.forEach((c, i) => {
      const row = document.createElement("div");
      row.className = "card-row";
      row.style.setProperty("--swatch", seriesColor(i));
      row.innerHTML = `
        <input type="text" data-k="bank" value="${esc(c.bank)}" placeholder="Bank name" aria-label="Bank for card ${i + 1}" autocomplete="off" />
        <div class="money-input"><span>$</span><input type="number" data-k="balance" min="0" step="0.01" inputmode="decimal" value="${esc(c.balance)}" placeholder="0" aria-label="Balance for card ${i + 1}" /></div>
        <div class="pct-input"><input type="number" data-k="apr" min="0" max="100" step="0.01" inputmode="decimal" value="${esc(c.apr)}" placeholder="24.99" aria-label="APR for card ${i + 1}" /><span>%</span></div>
        <button type="button" class="remove" aria-label="Remove card ${i + 1}" title="Remove">×</button>`;
      row.querySelectorAll("input").forEach((inp) => inp.addEventListener("input", () => {
        state.cards[i][inp.dataset.k] = inp.value;
        edited();
        schedule();
      }));
      row.querySelector(".remove").addEventListener("click", () => {
        state.cards.splice(i, 1);
        if (!state.cards.length) state.cards.push({ bank: "", name: "", balance: "", apr: "", minPayment: "" });
        edited();
        renderCardInputs();
        schedule(0);
      });
      list.appendChild(row);
    });
    $("#example-note").hidden = !state.isExample;
  }

  function readCards() {
    const valid = [];
    const errors = [];
    const labels = cardLabels(state.cards);
    const rows = $$("#card-list .card-row");
    state.cards.forEach((c, i) => {
      const balance = parseFloat(c.balance);
      const apr = parseFloat(c.apr);
      const balBad = c.balance !== "" && (!isFinite(balance) || balance < 0);
      const aprBad = c.apr !== "" && (!isFinite(apr) || apr < 0 || apr > 100);
      if (rows[i]) {
        rows[i].querySelector('[data-k="balance"]').setAttribute("aria-invalid", balBad);
        rows[i].querySelector('[data-k="apr"]').setAttribute("aria-invalid", aprBad);
      }
      if (balBad) errors.push(`${labels[i]}: check the balance.`);
      if (aprBad) errors.push(`${labels[i]}: APR should be between 0 and 100.`);
      if (balance > 0 && apr >= 0 && apr <= 100) {
        const minP = parseFloat(c.minPayment);
        valid.push({ label: labels[i], bank: c.bank, balance, apr, minPayment: isFinite(minP) ? minP : 0, colorIndex: i });
      }
    });
    return { valid, errors };
  }

  /* ---------- step 2: budget ---------- */
  function renderBudgetInputs() {
    const b = state.budget;
    $("#salary").value = b.salary;
    $("#salary-freq").value = b.freq;
    $("#cushion").value = b.cushion;
    const list = $("#expense-list");
    list.innerHTML = "";
    b.expenses.forEach((e, i) => {
      const row = document.createElement("div");
      row.className = "expense-row";
      row.innerHTML = `
        <input type="text" list="expense-names" data-k="name" value="${esc(e.name)}" placeholder="e.g. Rent" aria-label="Bill ${i + 1} name" />
        <div class="money-input"><span>$</span><input type="number" data-k="amount" min="0" step="1" inputmode="decimal" value="${esc(e.amount)}" placeholder="0" aria-label="Bill ${i + 1} per month" /></div>
        <button type="button" class="remove" aria-label="Remove bill ${i + 1}" title="Remove">×</button>`;
      row.querySelectorAll("input").forEach((inp) => inp.addEventListener("input", () => {
        b.expenses[i][inp.dataset.k] = inp.value;
        edited();
        updateBudgetSummary();
        schedule();
      }));
      row.querySelector(".remove").addEventListener("click", () => {
        b.expenses.splice(i, 1);
        edited();
        renderBudgetInputs();
        schedule(0);
      });
      list.appendChild(row);
    });
    updateBudgetSummary();
  }

  function updateBudgetSummary() {
    const info = readBudget();
    const el = $("#salary-monthly");
    if (!info) { el.innerHTML = ""; return; }
    const perMonth = state.budget.freq !== "monthly" ? `${usd.format(info.monthly)}/month pay − ` : "";
    el.innerHTML = info.free > 0
      ? `${perMonth}${usd.format(info.essentials)} in bills = <strong>${usd.format(info.free)} left each month</strong>`
      : `Your bills (${usd.format(info.essentials)}) use all of your ${usd.format(info.monthly)} monthly pay.`;
  }

  /** Returns null when no pay has been entered. */
  function readBudget() {
    const b = state.budget;
    const pay = parseFloat(b.salary);
    if (!isFinite(pay) || pay <= 0) return null;
    const monthly = pay * (FREQ[b.freq] || 1);
    const expenses = b.expenses
      .map((e) => ({ name: e.name.trim() || "Other", amount: parseFloat(e.amount) }))
      .filter((e) => isFinite(e.amount) && e.amount > 0);
    const essentials = expenses.reduce((s, e) => s + e.amount, 0);
    let cushionPct = parseFloat(b.cushion);
    if (!isFinite(cushionPct) || cushionPct < 0) cushionPct = 10;
    cushionPct = Math.min(cushionPct, 50);
    const cushion = (monthly * cushionPct) / 100;
    const free = monthly - essentials;
    return { monthly, expenses, essentials, free, cushionPct, cushion, comfortable: free - cushion };
  }

  /** How realistic a monthly payment is for the user's budget. */
  function feasibility(pay, b) {
    if (!b) return null;
    const share = b.free > 0 ? pay / b.free : Infinity;
    if (b.free <= 0 || pay > b.free + 0.5) return { key: "no", label: "Too much", share };
    if (pay <= 0.6 * b.comfortable) return { key: "high", label: "Very likely", share };
    if (pay <= b.comfortable + 0.5) return { key: "likely", label: "Likely", share };
    return { key: "stretch", label: "Tight", share };
  }
  const fits = (f) => f && (f.key === "high" || f.key === "likely");
  const badge = (f) => (f ? `<span class="badge ${f.key}">${f.label}</span>` : "");

  /* ---------- compute ---------- */
  let timer = null;
  function schedule(delay = 250) { clearTimeout(timer); timer = setTimeout(run, delay); }

  function run() {
    save();
    const { valid: cards, errors } = readCards();
    const err = $("#error");
    if (errors.length || !cards.length) {
      err.hidden = false;
      err.textContent = errors.length ? errors.join(" ") : "Add a card with a balance and APR to see your plan.";
      if (!cards.length) { $("#results").hidden = true; return; }
    } else {
      err.hidden = true;
    }

    const strategy = state.strategy;
    const minOnly = Planner.simulate(cards, { budget: null, strategy });
    const sumMin = Planner.sumFirstMins(cards);
    const customBudget = parseFloat(state.customBudget);
    const budgetInfo = readBudget();

    const plans = PLAN_DEFS.map((def) => {
      let budget;
      if (def.id === "custom") {
        if (!isFinite(customBudget) || customBudget <= 0) return null;
        budget = customBudget;
      } else {
        budget = Planner.requiredBudget(cards, def.months, strategy);
      }
      const effectiveBudget = Math.max(budget, sumMin);
      const result = Planner.simulate(cards, { budget, strategy });
      return { ...def, budget, effectiveBudget, result, feas: feasibility(effectiveBudget, budgetInfo) };
    }).filter(Boolean);

    const recommended = budgetInfo
      ? plans.filter((p) => p.result.paidOff && fits(p.feas)).sort((a, b) => a.result.totalInterest - b.result.totalInterest)[0] || null
      : null;

    if (!pickedByUser) {
      // Show the best fit; if nothing fits, show the most affordable plan
      if (recommended) state.selected = recommended.id;
      else if (budgetInfo) state.selected = [...plans].sort((a, b) => a.effectiveBudget - b.effectiveBudget)[0].id;
    }
    if (!plans.find((p) => p.id === state.selected)) state.selected = plans.find((p) => p.id === "medium").id;

    lastResult = { cards, plans, minOnly, sumMin, strategy, budget: budgetInfo, recommended };
    $("#results").hidden = false;
    renderAll();
  }

  const selectedPlan = () => lastResult.plans.find((p) => p.id === state.selected);

  function renderAll() {
    renderHero();
    renderPaycheck();
    renderMainChart();
    renderTips();
    renderLoan();
    renderTimeline();
    renderSchedule();
    if ($("#more-charts").open) renderMoreCharts();
  }

  /* ---------- the answer ---------- */
  function renderHero() {
    const { plans, minOnly, sumMin, budget: b, recommended } = lastResult;
    const p = selectedPlan();
    const r = p.result;
    const hero = $(".hero");
    hero.style.setProperty("--plan-color", css(p.color));

    $("#hero-h").innerHTML = r.paidOff
      ? `Debt-free by <em>${dateLabel(r.monthsToPayoff)}</em>`
      : "This payment won't pay off your debt";
    const sub = $("#hero-sub");
    if (b && b.free < sumMin) {
      sub.className = "hero-sub warn";
      sub.innerHTML = `Your bills leave ${usd.format(Math.max(0, b.free))}/month, but your minimum payments are ${usd.format(sumMin)}. See the loan section below.`;
    } else {
      sub.className = "hero-sub";
      sub.innerHTML = `<span>Pay <strong>${usd.format(p.effectiveBudget)}/month</strong> on the ${p.name} plan</span>${badge(p.feas)}`;
    }

    const box = $("#plans");
    box.innerHTML = "";
    plans.forEach((pl) => {
      const t = document.createElement("button");
      t.type = "button";
      t.className = "tab";
      t.setAttribute("role", "radio");
      t.setAttribute("aria-checked", pl.id === p.id);
      t.style.setProperty("--plan-color", css(pl.color));
      const star = recommended && recommended.id === pl.id ? `<span class="star">★ Best fit</span>` : "";
      t.innerHTML = `<span class="t-name"><i></i>${pl.name}</span>
        <span class="t-pay">${usd.format(pl.effectiveBudget)}<small>/mo</small></span>
        <span class="t-meta">${pl.result.paidOff ? `Done ${dateLabel(pl.result.monthsToPayoff)}` : "Never"}</span>${star}`;
      t.addEventListener("click", () => { state.selected = pl.id; pickedByUser = true; save(); renderAll(); });
      box.appendChild(t);
    });

    const saved = minOnly.paidOff ? minOnly.totalInterest - r.totalInterest : null;
    const facts = [
      ["Time", duration(r.monthsToPayoff), ""],
      ["Total interest", usd.format(r.totalInterest), ""],
      saved != null ? ["Saved vs. minimums", usd.format(saved), "good"] : ["Minimums alone", "Never pay off", ""],
    ];
    $("#plan-facts").innerHTML = facts.map(([k, v, c]) => `<div class="fact"><div class="k">${k}</div><div class="v ${c}">${v}</div></div>`).join("");
  }

  function renderPaycheck() {
    const b = lastResult.budget;
    const box = $("#paycheck");
    if (!b) { box.hidden = true; return; }
    box.hidden = false;
    const p = selectedPlan();
    const pay = p.effectiveBudget;
    const left = b.monthly - b.essentials - pay;
    const segs = [
      { label: "Bills", v: b.essentials, color: css("--plan-min") },
      { label: "Cards", v: pay, color: css(p.color) },
    ];
    if (left >= 0) segs.push({ label: "Left over", v: left, color: css("--good") });
    const scale = Math.max(b.monthly, b.essentials + pay);
    $("#paybar").innerHTML = segs.map((s) => `<span style="width:${(s.v / scale) * 100}%;background:${s.color}"></span>`).join("");
    $("#paybar").setAttribute("aria-label", segs.map((s) => `${s.label} ${usd.format(s.v)}`).join(", ") + ` out of ${usd.format(b.monthly)} monthly pay`);
    const legend = segs.map((s) => `<li><i style="background:${s.color}"></i>${s.label} <b>${usd.format(s.v)}</b></li>`);
    if (left < 0) legend.push(`<li style="color:var(--bad)"><strong>Short ${usd.format(-left)}/month</strong></li>`);
    $("#paybar-legend").innerHTML = `<li>Monthly pay <b>${usd.format(b.monthly)}</b></li>` + legend.join("");
  }

  /* ---------- charts ---------- */
  function chartDefaults() {
    Chart.defaults.color = css("--muted");
    Chart.defaults.borderColor = css("--border");
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.boxWidth = 8;
    Chart.defaults.plugins.legend.labels.boxHeight = 8;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.animation.duration = 300;
  }
  function makeChart(id, config) {
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(document.getElementById(id), config);
  }
  const moneyTick = (v) => (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : `$${v}`);
  const monthTitle = (items) => `${dateLabel(Number(items[0].label))} (month ${items[0].label})`;

  function renderMainChart() {
    const { cards, plans, minOnly, sumMin } = lastResult;
    const total = cards.reduce((s, c) => s + c.balance, 0);
    const wApr = cards.reduce((s, c) => s + c.balance * c.apr, 0) / total;
    const monthlyInterest = cards.reduce((s, c) => s + (c.balance * c.apr) / 1200, 0);
    $("#today-line").innerHTML = `You owe <strong>${usd.format(total)}</strong> at ${wApr.toFixed(1)}% average APR, which costs about ${usd.format(monthlyInterest)} in interest this month. `
      + (minOnly.paidOff
        ? `Paying only the minimums (${usd.format(sumMin)} now) would take <strong>${duration(minOnly.monthsToPayoff)}</strong> and cost ${usd.format(minOnly.totalInterest)} in interest.`
        : "Paying only the minimums would never pay it off.");

    if (typeof Chart === "undefined") return;
    chartDefaults();
    const sel = selectedPlan();
    const longest = Math.max(...plans.map((p) => p.result.monthsToPayoff).filter(isFinite), 1);
    const step = longest > 54 ? 12 : 6;
    const horizon = Math.min(Math.ceil((longest + 3) / step) * step, Planner.MAX_MONTHS);
    const series = (r) => [{ x: 0, y: total }, ...r.months.filter((m) => m.month <= horizon).map((m) => ({ x: m.month, y: m.totalBalance }))];
    const datasets = plans.map((p) => ({
      label: p.name, data: series(p.result),
      borderColor: css(p.color), backgroundColor: css(p.color),
      borderWidth: p.id === sel.id ? 3.5 : 1.5, pointRadius: 0, tension: 0.15,
    }));
    datasets.push({ label: "Minimums only", data: series(minOnly), borderColor: css("--plan-min"), backgroundColor: css("--plan-min"), borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0 });
    makeChart("chart-compare", {
      type: "line",
      data: { datasets },
      options: {
        interaction: { mode: "nearest", axis: "x", intersect: false },
        scales: {
          x: { type: "linear", min: 0, max: horizon, ticks: { stepSize: step, callback: (v) => (v === 0 ? "Now" : `${v} mo`) }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { callback: moneyTick, maxTicksLimit: 6 } },
        },
        plugins: {
          legend: { position: "bottom" },
          tooltip: { callbacks: { title: (it) => dateLabel(it[0].parsed.x), label: (c) => ` ${c.dataset.label}: ${usd.format(c.parsed.y)}` } },
        },
      },
    });
  }

  function renderMoreCharts() {
    if (typeof Chart === "undefined" || !lastResult) return;
    chartDefaults();
    const { cards, plans, minOnly } = lastResult;
    const r = selectedPlan().result;
    const total = cards.reduce((s, c) => s + c.balance, 0);

    makeChart("chart-cards", {
      type: "line",
      data: {
        labels: [0, ...r.months.map((m) => m.month)],
        datasets: cards.map((c, i) => ({
          label: c.label, data: [c.balance, ...r.months.map((m) => m.balances[i])],
          borderColor: seriesColor(c.colorIndex), backgroundColor: seriesColor(c.colorIndex) + "55",
          fill: true, pointRadius: 0, borderWidth: 1.5, tension: 0.15,
        })),
      },
      options: {
        interaction: { mode: "index", intersect: false },
        scales: { x: { ticks: { maxTicksLimit: 10 }, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { callback: moneyTick } } },
        plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { title: monthTitle, label: (c) => ` ${c.dataset.label}: ${usd.format(c.parsed.y)}` } } },
      },
    });

    makeChart("chart-split", {
      type: "doughnut",
      data: {
        labels: ["What you owe", "Interest"],
        datasets: [{ data: [total, r.totalInterest], backgroundColor: [css("--principal"), css("--interest")], borderColor: css("--surface"), borderWidth: 2 }],
      },
      options: { cutout: "65%", plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: (c) => ` ${usd.format(c.parsed)}` } } } },
      plugins: [centerText(usd.format(total + r.totalInterest), "total")],
    });

    const bars = plans.map((p) => ({ name: p.name, v: p.result.totalInterest, color: css(p.color) }));
    if (minOnly.paidOff) bars.push({ name: "Minimums", v: minOnly.totalInterest, color: css("--plan-min") });
    makeChart("chart-interest", {
      type: "bar",
      data: { labels: bars.map((b) => b.name), datasets: [{ data: bars.map((b) => b.v), backgroundColor: bars.map((b) => b.color), borderRadius: 4 }] },
      options: {
        indexAxis: "y",
        scales: { x: { beginAtZero: true, ticks: { callback: moneyTick, maxTicksLimit: 5 } }, y: { grid: { display: false } } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${usd.format(c.parsed.x)} interest` } } },
      },
    });

    makeChart("chart-monthly", {
      type: "bar",
      data: {
        labels: r.months.map((m) => m.month),
        datasets: [
          { label: "Pays down debt", data: r.months.map((m) => m.totalPayment - m.totalInterest), backgroundColor: css("--principal") },
          { label: "Interest", data: r.months.map((m) => m.totalInterest), backgroundColor: css("--interest") },
        ],
      },
      options: {
        interaction: { mode: "index", intersect: false },
        scales: { x: { stacked: true, ticks: { maxTicksLimit: 10 }, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { callback: moneyTick } } },
        plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { title: monthTitle, label: (c) => ` ${c.dataset.label}: ${usd2.format(c.parsed.y)}` } } },
      },
    });
  }

  function centerText(main, sub) {
    return {
      id: "center",
      afterDraw(chart) {
        const { ctx, chartArea: a } = chart;
        if (!a) return;
        const x = (a.left + a.right) / 2, y = (a.top + a.bottom) / 2;
        ctx.save();
        ctx.textAlign = "center";
        ctx.fillStyle = css("--text");
        ctx.font = `700 17px ${Chart.defaults.font.family}`;
        ctx.fillText(main, x, y + 2);
        ctx.fillStyle = css("--muted");
        ctx.font = `500 12px ${Chart.defaults.font.family}`;
        ctx.fillText(sub, x, y + 19);
        ctx.restore();
      },
    };
  }

  /* ---------- tips ---------- */
  function renderTips() {
    const { cards, strategy, minOnly, budget: bud, recommended: rec } = lastResult;
    const p = selectedPlan();
    const r = p.result;
    const budget = p.effectiveBudget;
    const tips = [];
    const top = strategy === "snowball" ? [...cards].sort((a, b) => a.balance - b.balance)[0] : [...cards].sort((a, b) => b.apr - a.apr)[0];

    if (bud && p.feas && !fits(p.feas) && rec) {
      tips.push([`Try the ${rec.name} plan instead`, `${usd.format(rec.effectiveBudget)}/month fits your budget better and still gets you debt-free by ${dateLabel(rec.result.monthsToPayoff)}.`]);
    }
    tips.push([`Pay off ${top.label} first`, strategy === "snowball"
      ? `It's your smallest balance (${usd.format(top.balance)}). Pay the minimum on the other cards and put everything extra here.`
      : `At ${top.apr}% it's your most expensive card. Pay the minimum on the other cards and put everything extra here.`]);
    tips.push(["Set up autopay and stop using the cards", `Schedule ${usd.format(budget)} right after payday. Use debit for everyday spending so the balances stop growing.`]);

    const bump = budget >= 1000 ? 100 : 50;
    const more = Planner.simulate(cards, { budget: budget + bump, strategy });
    if (r.paidOff && more.paidOff && r.monthsToPayoff > more.monthsToPayoff) {
      const d = r.monthsToPayoff - more.monthsToPayoff;
      tips.push([`Add ${usd.format(bump)} a month to finish ${d} month${d > 1 ? "s" : ""} sooner`, `You'd also save ${usd.format(r.totalInterest - more.totalInterest)} in interest.`]);
    }
    const lowR = Planner.simulate(cards.map((c) => ({ ...c, apr: Math.max(0, c.apr - 5) })), { budget, strategy });
    if (r.totalInterest - lowR.totalInterest > 20) {
      tips.push(["Call your bank and ask for a lower rate", `If your APRs dropped by 5 points, you'd save about ${usd.format(r.totalInterest - lowR.totalInterest)}. Banks often say yes to customers who pay on time.`]);
    }
    const total = cards.reduce((s, c) => s + c.balance, 0);
    const wApr = cards.reduce((s, c) => s + c.balance * c.apr, 0) / total;
    if (total >= 1000 && wApr >= 15) {
      const bt = balanceTransfer(total, budget, 0.03, 18, Math.max(wApr, 20));
      if (r.totalInterest - bt.cost > 100) {
        tips.push(["Look at a 0% balance transfer card", `A typical offer (3% fee, 0% for 18 months) could save about ${usd.format(r.totalInterest - bt.cost)} at the same payment, if you're approved.`]);
      }
    }
    if (bud) {
      const flexible = bud.expenses.filter((e) => !/rent|mortgage|car payment|loan|insurance|childcare/i.test(e.name)).sort((a, b) => b.amount - a.amount)[0];
      if (flexible && flexible.amount >= 50) {
        const cut = Math.round(flexible.amount * 0.1);
        const trimmed = Planner.simulate(cards, { budget: budget + cut, strategy });
        if (r.paidOff && trimmed.paidOff && r.monthsToPayoff > trimmed.monthsToPayoff) {
          tips.push([`Trim ${flexible.name.toLowerCase()} by 10%`, `Putting that ${usd.format(cut)}/month toward your cards gets you out ${r.monthsToPayoff - trimmed.monthsToPayoff} month(s) sooner.`]);
        }
      }
      const housing = bud.expenses.filter((e) => /rent|mortgage/i.test(e.name)).reduce((s, e) => s + e.amount, 0);
      if (housing > bud.monthly * 0.4) {
        tips.push(["Housing is a big part of your pay", `Rent takes ${Math.round((housing / bud.monthly) * 100)}% of your pay. About 30% is a common target.`]);
      }
    }
    if (cards.length > 1) {
      const other = strategy === "snowball" ? "avalanche" : "snowball";
      const alt = Planner.simulate(cards, { budget, strategy: other });
      if (alt.totalInterest < r.totalInterest - 1) {
        tips.push(["Paying the highest APR first would save more", `Same payment, ${usd.format(r.totalInterest - alt.totalInterest)} less interest. You can switch this under Advanced options.`]);
      }
    }
    tips.push(["Put windfalls toward your cards", "Send tax refunds and bonuses straight to the card you're paying off."]);
    tips.push(["Keep a small emergency fund", "Keep $500 to $1,000 saved so a surprise bill doesn't go back on a card."]);
    if (minOnly.paidOff) tips.push(["Don't drop back to minimums", `That would cost ${usd.format(minOnly.totalInterest - r.totalInterest)} more.`]);

    const li = ([h, b]) => `<li><strong>${esc(h)}</strong><span>${esc(b)}</span></li>`;
    $("#tips").innerHTML = tips.slice(0, 3).map(li).join("");
    $("#tips-more").innerHTML = tips.slice(3).map(li).join("");
    $("#more-tips-box").hidden = tips.length <= 3;
  }

  function balanceTransfer(total, payment, feePct, promoMonths, postApr) {
    let bal = total * (1 + feePct), interest = 0, m = 0;
    while (bal > 0.005 && m < Planner.MAX_MONTHS) {
      m++;
      const i = m > promoMonths ? (bal * postApr) / 1200 : 0;
      interest += i;
      bal = bal + i - payment;
    }
    return { cost: total * feePct + interest };
  }

  /* ---------- personal loan ---------- */
  function renderLoan() {
    const { cards, minOnly, budget: b, recommended, sumMin } = lastResult;
    const sel = selectedPlan();
    const total = cards.reduce((s, c) => s + c.balance, 0);
    const wApr = cards.reduce((s, c) => s + c.balance * c.apr, 0) / total;
    const apr = isFinite(parseFloat(state.loan.apr)) ? parseFloat(state.loan.apr) : 12;
    const term = parseInt(state.loan.term, 10) || 36;
    const fee = isFinite(parseFloat(state.loan.fee)) ? parseFloat(state.loan.fee) : 3;
    const loan = Planner.loanQuote(total, apr, term, fee);
    const loanFeas = feasibility(loan.payment, b);
    const same = Planner.simulate(cards, { budget: loan.payment, strategy: lastResult.strategy });
    const savings = same.paidOff ? same.totalInterest - loan.cost : Infinity;
    const q60 = term < 60 ? Planner.loanQuote(total, apr, 60, fee) : null;
    const loanLine = `A ${term / 12}-year loan at ${apr}% would be ${usd.format(loan.payment)}/month.`;

    let cls, title, body;
    if (!b) {
      cls = savings > 200 ? "maybe" : "no";
      title = savings > 200 ? `Maybe. It could save about ${usd.format(Math.min(savings, 1e9))}` : "Probably not. It wouldn't save much";
      body = `${loanLine} Add your take-home pay above to see if it fits your budget.`;
    } else if (b.free < sumMin) {
      if (loan.payment <= b.free) { cls = "yes"; title = "Yes, a loan could make this manageable"; body = `${loanLine} That's less than your current minimums and fits your budget.`; }
      else if (q60 && q60.payment <= b.free) { cls = "maybe"; title = "A longer loan might work"; body = `A 5-year loan would be ${usd.format(q60.payment)}/month, which fits what's left after your bills.`; }
      else { cls = "warn"; title = "Your budget can't cover this yet"; body = "Even a loan payment would be too much right now. Try cutting a bill, ask your card issuers about hardship programs, or talk to a nonprofit credit counselor."; }
    } else if (!recommended) {
      if (fits(loanFeas)) { cls = "yes"; title = "Yes, consider a personal loan"; body = `None of the card plans fit your budget comfortably. ${loanLine} That does fit.`; }
      else if (q60 && fits(feasibility(q60.payment, b))) { cls = "yes"; title = "Yes, a 5-year loan could fit"; body = `A 5-year loan would be ${usd.format(q60.payment)}/month, which fits your budget comfortably.`; }
      else if (loanFeas.key === "stretch") { cls = "maybe"; title = "Maybe, but it's tight"; body = `${loanLine} That would dip into your safety cushion.`; }
      else { cls = "warn"; title = "Neither option fits your budget yet"; body = "Try cutting a bill, or talk to a nonprofit credit counselor about a debt management plan."; }
    } else if (savings >= Math.max(300, 0.15 * same.totalInterest) && loanFeas.key !== "no" && apr < wApr) {
      cls = "maybe"; title = `Optional. A loan could save about ${usd.format(savings)}`;
      body = `You don't need one, because the ${recommended.name} plan fits your budget. But a ${apr}% loan is much cheaper than your ${wApr.toFixed(0)}% cards.`;
    } else {
      cls = "no"; title = "No, you don't need one";
      body = `The ${recommended.name} plan fits your budget, and a loan wouldn't save much.`;
    }
    $("#loan-verdict").className = "verdict " + cls;
    $("#loan-verdict").innerHTML = `<h3>${esc(title)}</h3><p>${esc(body)}</p>`;

    const rows = [];
    const add = (name, pay, months, cost, f) => rows.push(`<tr><td class="l">${esc(name)}</td><td>${pay}</td><td>${months}</td><td>${cost}</td>${b ? `<td class="l">${badge(f) || "–"}</td>` : ""}</tr>`);
    add("Personal loan", usd.format(loan.payment), duration(term), usd.format(loan.cost), loanFeas);
    add(`${sel.name} plan`, usd.format(sel.effectiveBudget), duration(sel.result.monthsToPayoff), usd.format(sel.result.totalInterest), sel.feas);
    add("Minimums only", usd.format(sumMin), duration(minOnly.monthsToPayoff), minOnly.paidOff ? usd.format(minOnly.totalInterest) : "–", feasibility(sumMin, b));
    $("#loan-table").innerHTML = `<thead><tr><th class="l">Option</th><th>Monthly</th><th>Time</th><th>Interest + fees</th>${b ? `<th class="l">Fits?</th>` : ""}</tr></thead><tbody>${rows.join("")}</tbody>`;
    $("#loan-detail").textContent = (same.paidOff
      ? `For comparison, paying the same ${usd.format(loan.payment)}/month to your cards would cost ${usd.format(same.totalInterest)} in interest. `
      : "") + "A loan only helps if you stop using the cards. Your actual rate depends on your credit score, and many lenders let you check it without hurting your score.";
  }

  /* ---------- details ---------- */
  function renderTimeline() {
    const { cards } = lastResult;
    const r = selectedPlan().result;
    const order = cards.map((c, i) => ({ c, i, m: r.payoffMonth[i] })).sort((a, b) => (a.m ?? 1e9) - (b.m ?? 1e9));
    $("#timeline").innerHTML = order.map(({ c, m }, k) => `
      <li><span class="dot" style="background:${seriesColor(c.colorIndex)}">${k + 1}</span>
        <div><strong>${esc(c.label)}</strong><div class="meta">${usd.format(c.balance)} at ${c.apr}%</div></div>
        <div class="when">${m ? dateLabel(m) : "–"}</div></li>`).join("");
  }

  function renderSchedule() {
    const { cards } = lastResult;
    const r = selectedPlan().result;
    const head = `<thead><tr><th>Month</th><th>Payment</th><th>Interest</th>${cards.map((c) => `<th>${esc(c.label)}</th>`).join("")}<th>Total left</th></tr></thead>`;
    const rows = r.months.map((m) => {
      const paid = r.payoffMonth.some((pm) => pm === m.month);
      return `<tr class="${paid ? "paid" : ""}"><td>${dateLabel(m.month)}</td><td>${usd2.format(m.totalPayment)}</td><td>${usd2.format(m.totalInterest)}</td>${m.balances.map((b) => `<td>${b === 0 ? "Paid off" : usd2.format(b)}</td>`).join("")}<td>${usd2.format(m.totalBalance)}</td></tr>`;
    }).join("");
    $("#schedule").innerHTML = head + `<tbody>${rows}</tbody>`;
  }

  function downloadCSV() {
    if (!lastResult) return;
    const { cards } = lastResult;
    const p = selectedPlan();
    const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const lines = [["Month", "Date", "Total payment", "Interest", "Principal", ...cards.flatMap((c) => [`${c.label} payment`, `${c.label} balance`]), "Total balance"].map(q).join(",")];
    p.result.months.forEach((m) => {
      lines.push([m.month, q(dateLabel(m.month)), m.totalPayment.toFixed(2), m.totalInterest.toFixed(2), (m.totalPayment - m.totalInterest).toFixed(2),
        ...cards.flatMap((c, i) => [m.payments[i].toFixed(2), m.balances[i].toFixed(2)]), m.totalBalance.toFixed(2)].join(","));
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = `debt-payoff-${p.id}-plan.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  /* ---------- wire up ---------- */
  function init() {
    renderCardInputs();
    renderBudgetInputs();
    $(`input[name="strategy"][value="${state.strategy}"]`).checked = true;
    $("#custom-budget").value = state.customBudget || "";
    $("#loan-apr").value = state.loan.apr;
    $("#loan-term").value = state.loan.term;
    $("#loan-fee").value = state.loan.fee;

    $("#add-card").addEventListener("click", () => {
      state.cards.push({ bank: "", name: "", balance: "", apr: "", minPayment: "" });
      edited();
      renderCardInputs();
      const rows = $$("#card-list .card-row");
      rows[rows.length - 1].querySelector("input").focus();
    });
    $("#add-expense").addEventListener("click", () => {
      state.budget.expenses.push({ name: "", amount: "" });
      renderBudgetInputs();
      const rows = $$("#expense-list .expense-row");
      rows[rows.length - 1].querySelector("input").focus();
    });
    $("#load-example").addEventListener("click", () => {
      state.cards = EXAMPLE.map((c) => ({ ...c }));
      state.budget = cloneBudget(EXAMPLE_BUDGET);
      state.isExample = true;
      pickedByUser = false;
      renderCardInputs();
      renderBudgetInputs();
      schedule(0);
    });
    $("#clear-all").addEventListener("click", () => {
      state.cards = [{ bank: "", name: "", balance: "", apr: "", minPayment: "" }];
      state.budget = EMPTY_BUDGET();
      state.customBudget = "";
      $("#custom-budget").value = "";
      state.isExample = false;
      pickedByUser = false;
      renderCardInputs();
      renderBudgetInputs();
      schedule(0);
      $("#card-list input").focus();
    });

    const onBudget = (id, key, evt = "input") => $(id).addEventListener(evt, (e) => {
      state.budget[key] = e.target.value;
      edited();
      updateBudgetSummary();
      schedule();
    });
    onBudget("#salary", "salary");
    onBudget("#salary-freq", "freq", "change");
    onBudget("#cushion", "cushion");
    $$('input[name="strategy"]').forEach((r) => r.addEventListener("change", () => { state.strategy = r.value; schedule(0); }));
    $("#custom-budget").addEventListener("input", (e) => {
      state.customBudget = e.target.value;
      if (parseFloat(e.target.value) > 0) { state.selected = "custom"; pickedByUser = true; }
      schedule();
    });
    [["#loan-apr", "apr", "input"], ["#loan-term", "term", "change"], ["#loan-fee", "fee", "input"]].forEach(([id, key, evt]) =>
      $(id).addEventListener(evt, (e) => { state.loan[key] = e.target.value; save(); if (lastResult) renderLoan(); }));
    $("#more-charts").addEventListener("toggle", (e) => { if (e.target.open) renderMoreCharts(); });
    $("#download-csv").addEventListener("click", downloadCSV);
    $("#print-plan").addEventListener("click", () => window.print());

    if (window.matchMedia) {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        if (lastResult) { renderCardInputs(); renderAll(); }
      });
    }
    run();
  }

  init();
})();
