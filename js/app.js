/* UI layer: reads inputs, runs the Planner engine, renders plans, charts, tips and schedule. */
(function () {
  "use strict";

  const STORE_KEY = "ccplanner.v1";
  const PLAN_DEFS = [
    { id: "easy", name: "Easy", months: 60, color: "--plan-easy", tag: "Lowest payment", blurb: "Debt-free in about 5 years" },
    { id: "medium", name: "Medium", months: 36, color: "--plan-medium", tag: "Balanced", blurb: "Debt-free in about 3 years" },
    { id: "aggressive", name: "Aggressive", months: 18, color: "--plan-aggressive", tag: "Least interest", blurb: "Debt-free in about 18 months" },
    { id: "custom", name: "Custom", months: null, color: "--plan-custom", tag: "Your budget", blurb: "Based on the amount you entered" },
  ];
  const EXAMPLE = [
    { bank: "Chase", name: "Freedom", balance: 5200, apr: 24.99, minPayment: "" },
    { bank: "Capital One", name: "Quicksilver", balance: 2800, apr: 19.49, minPayment: "" },
    { bank: "Synchrony", name: "Store card", balance: 1300, apr: 29.99, minPayment: "" },
  ];

  const EXAMPLE_BUDGET = {
    salary: "3800", freq: "monthly", cushion: "10",
    expenses: [
      { name: "Rent / mortgage", amount: "1450" },
      { name: "Electricity", amount: "110" },
      { name: "Car payment", amount: "360" },
      { name: "Car insurance", amount: "140" },
      { name: "Groceries", amount: "450" },
      { name: "Phone & internet", amount: "120" },
    ],
  };
  const EMPTY_BUDGET = () => ({
    salary: "", freq: "monthly", cushion: "10",
    expenses: [{ name: "Rent / mortgage", amount: "" }, { name: "Electricity", amount: "" }, { name: "Car payment", amount: "" }],
  });
  const EXPENSE_PRESETS = ["Rent / mortgage", "Electricity", "Water & gas", "Car payment", "Car insurance", "Health insurance",
    "Groceries", "Phone & internet", "Fuel / transit", "Childcare", "Student loan", "Other loan payment", "Medical"];
  const FREQ = { monthly: 1, semimonthly: 2, biweekly: 26 / 12, weekly: 52 / 12, yearly: 1 / 12 };
  const DEFAULT_LOAN = { apr: "12", term: "36", fee: "3" };

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const monthFmt = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });

  let state = load() || { cards: EXAMPLE.map((c) => ({ ...c })), strategy: "avalanche", customBudget: "", selected: "medium", isExample: true };
  // Fill in fields added in later versions so older saved data keeps working
  if (!state.budget) state.budget = state.isExample ? cloneBudget(EXAMPLE_BUDGET) : EMPTY_BUDGET();
  if (!state.loan) state.loan = { ...DEFAULT_LOAN };

  function cloneBudget(b) {
    return { ...b, expenses: b.expenses.map((e) => ({ ...e })) };
  }
  let charts = {};
  let lastResult = null;

  /* ---------- persistence ---------- */
  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { return null; }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable: fine */ }
  }

  /* ---------- helpers ---------- */
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const seriesColor = (i) => css(`--s${(i % 8) + 1}`);
  function monthDate(m) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + m);
    return d;
  }
  const dateLabel = (m) => monthFmt.format(monthDate(m));
  function duration(m) {
    if (!isFinite(m)) return "Never";
    const y = Math.floor(m / 12), r = m % 12;
    const parts = [];
    if (y) parts.push(`${y} yr${y > 1 ? "s" : ""}`);
    if (r || !y) parts.push(`${r} mo`);
    return parts.join(" ");
  }
  const cardLabel = (c, i) => [c.bank, c.name].filter(Boolean).join(" · ") || `Card ${i + 1}`;
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

  /* ---------- card inputs ---------- */
  function renderCardInputs() {
    const list = $("#card-list");
    list.innerHTML = "";
    state.cards.forEach((c, i) => {
      const row = document.createElement("div");
      row.className = "card-row";
      row.style.setProperty("--swatch", seriesColor(i));
      row.innerHTML = `
        <label class="field"><span>Bank</span>
          <input type="text" list="banks" data-k="bank" value="${esc(c.bank)}" placeholder="e.g. Chase" autocomplete="off" /></label>
        <label class="field"><span>Card nickname (optional)</span>
          <input type="text" data-k="name" value="${esc(c.name)}" placeholder="e.g. Sapphire" /></label>
        <label class="field"><span>Current balance</span>
          <div class="money-input"><span>$</span><input type="number" data-k="balance" min="0" step="0.01" inputmode="decimal" value="${esc(c.balance)}" placeholder="0" /></div></label>
        <label class="field"><span>APR</span>
          <div class="pct-input"><input type="number" data-k="apr" min="0" max="100" step="0.01" inputmode="decimal" value="${esc(c.apr)}" placeholder="24.99" /><span>%</span></div></label>
        <label class="field"><span>Min. payment (optional)</span>
          <div class="money-input"><span>$</span><input type="number" data-k="minPayment" min="0" step="1" inputmode="decimal" value="${esc(c.minPayment)}" placeholder="auto" /></div></label>
        <button type="button" class="remove" aria-label="Remove ${esc(cardLabel(c, i))}" title="Remove card">×</button>`;
      row.querySelectorAll("input").forEach((inp) => {
        inp.addEventListener("input", () => {
          state.cards[i][inp.dataset.k] = inp.value;
          markEdited();
          schedule();
        });
      });
      row.querySelector(".remove").addEventListener("click", () => {
        state.cards.splice(i, 1);
        markEdited();
        renderCardInputs();
        schedule(0);
      });
      list.appendChild(row);
    });
    $("#example-note").hidden = !state.isExample;
  }
  /* ---------- budget inputs ---------- */
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
        <input type="text" data-k="name" value="${esc(e.name)}" placeholder="What is it?" aria-label="Expense name" />
        <div class="money-input"><span>$</span><input type="number" data-k="amount" min="0" step="1" inputmode="decimal" value="${esc(e.amount)}" placeholder="0" aria-label="${esc(e.name || "Expense")} per month" /></div>
        <button type="button" class="remove" aria-label="Remove ${esc(e.name || "expense")}" title="Remove">×</button>`;
      row.querySelectorAll("input").forEach((inp) => inp.addEventListener("input", () => {
        b.expenses[i][inp.dataset.k] = inp.value;
        if (inp.dataset.k === "name") renderChips();
        updateBudgetSummary();
        schedule();
      }));
      row.querySelector(".remove").addEventListener("click", () => {
        b.expenses.splice(i, 1);
        renderBudgetInputs();
        schedule(0);
      });
      list.appendChild(row);
    });
    const total = document.createElement("div");
    total.className = "expense-total";
    total.id = "expense-total";
    list.after(total);
    $$(".expense-total").forEach((el) => { if (el !== total) el.remove(); });
    renderChips();
    updateBudgetSummary();
  }

  function renderChips() {
    const have = new Set(state.budget.expenses.map((e) => e.name.trim().toLowerCase()));
    const box = $("#expense-chips");
    box.innerHTML = "";
    EXPENSE_PRESETS.filter((n) => !have.has(n.toLowerCase())).forEach((n) => {
      const c = document.createElement("button");
      c.type = "button";
      c.className = "chip";
      c.textContent = "+ " + n;
      c.addEventListener("click", () => {
        state.budget.expenses.push({ name: n, amount: "" });
        renderBudgetInputs();
        const rows = $$("#expense-list .expense-row");
        rows[rows.length - 1].querySelector('[data-k="amount"]').focus();
      });
      box.appendChild(c);
    });
  }

  function updateBudgetSummary() {
    const info = readBudget();
    const totalEl = $("#expense-total");
    const essentials = state.budget.expenses.reduce((s, e) => s + (parseFloat(e.amount) > 0 ? parseFloat(e.amount) : 0), 0);
    if (totalEl) totalEl.innerHTML = `<span>Total essentials</span><span>${usd.format(essentials)} /month</span>`;
    const note = $("#salary-monthly");
    if (!info) { note.textContent = ""; return; }
    note.innerHTML = `${state.budget.freq !== "monthly" ? `That's about <strong>${usd.format(info.monthly)}</strong> a month. ` : ""}After essentials you have <strong>${usd.format(info.free)}</strong> a month left${info.free > 0 ? `, and <strong>${usd.format(Math.max(0, info.comfortable))}</strong> after your ${info.cushionPct}% cushion` : ""}.`;
  }

  /** Returns null when no salary has been entered. */
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

  /** Rates how realistic a monthly payment is against the user's budget. */
  function feasibility(pay, b) {
    if (!b) return null;
    const share = b.free > 0 ? pay / b.free : Infinity;
    if (b.free <= 0 || pay > b.free + 0.5) {
      return { key: "no", label: "Not affordable", share,
        why: b.free <= 0 ? "Your essentials already use all of your take-home pay." : `Needs ${usd.format(pay)}, but only ${usd.format(b.free)} is left after essentials.` };
    }
    if (pay <= 0.6 * b.comfortable) return { key: "high", label: "Very likely", share, why: "Leaves plenty of room after essentials and your cushion." };
    if (pay <= b.comfortable + 0.5) return { key: "likely", label: "Likely", share, why: "Fits after essentials and still keeps your cushion." };
    return { key: "stretch", label: "A stretch", share, why: "Uses part of your cushion, so one surprise bill could knock you off track." };
  }
  const fits = (f) => f && (f.key === "high" || f.key === "likely");

  function markEdited() {
    if (state.isExample) { state.isExample = false; $("#example-note").hidden = true; }
  }

  function readCards() {
    const valid = [];
    const errors = [];
    state.cards.forEach((c, i) => {
      const row = $$("#card-list .card-row")[i];
      const balance = parseFloat(c.balance);
      const apr = parseFloat(c.apr);
      const minP = c.minPayment === "" || c.minPayment == null ? 0 : parseFloat(c.minPayment);
      const balBad = c.balance !== "" && (!isFinite(balance) || balance < 0);
      const aprBad = c.apr !== "" && (!isFinite(apr) || apr < 0 || apr > 100);
      if (row) {
        row.querySelector('[data-k="balance"]').setAttribute("aria-invalid", balBad);
        row.querySelector('[data-k="apr"]').setAttribute("aria-invalid", aprBad);
      }
      if (balBad) errors.push(`${cardLabel(c, i)}: balance must be a positive number.`);
      if (aprBad) errors.push(`${cardLabel(c, i)}: APR must be between 0 and 100.`);
      if (isFinite(balance) && balance > 0 && isFinite(apr) && apr >= 0 && apr <= 100) {
        valid.push({ bank: c.bank, name: c.name, label: cardLabel(c, i), balance, apr, minPayment: isFinite(minP) ? minP : 0, colorIndex: i });
      }
    });
    return { valid, errors };
  }

  /* ---------- main compute ---------- */
  let timer = null;
  function schedule(delay = 250) {
    clearTimeout(timer);
    timer = setTimeout(run, delay);
  }

  function run() {
    save();
    const { valid: cards, errors } = readCards();
    const err = $("#error");
    if (errors.length || !cards.length) {
      err.hidden = false;
      err.textContent = errors.length ? errors.join(" ") : "Add at least one card with a balance and APR to build your plan.";
      $("#results").hidden = errors.length ? $("#results").hidden : true;
      if (!cards.length) return;
    } else {
      err.hidden = true;
    }

    const strategy = state.strategy;
    const minOnly = Planner.simulate(cards, { budget: null, strategy });
    const sumMin = Planner.sumFirstMins(cards);
    const customBudget = parseFloat(state.customBudget);

    const plans = PLAN_DEFS.map((def) => {
      let budget;
      if (def.id === "custom") {
        if (!isFinite(customBudget) || customBudget <= 0) return { ...def, budget: null, result: null };
        budget = customBudget;
      } else {
        budget = Planner.requiredBudget(cards, def.months, strategy);
      }
      const result = Planner.simulate(cards, { budget, strategy });
      return { ...def, budget, effectiveBudget: Math.max(budget, sumMin), result };
    });

    const budgetInfo = readBudget();
    plans.forEach((p) => { if (p.result) p.feas = feasibility(p.effectiveBudget, budgetInfo); });
    // Recommended: the cheapest plan that fits comfortably in the budget
    const recommended = budgetInfo
      ? plans.filter((p) => p.result && p.result.paidOff && fits(p.feas)).sort((a, b) => a.result.totalInterest - b.result.totalInterest)[0] || null
      : null;

    if (!plans.find((p) => p.id === state.selected && p.result)) state.selected = "medium";
    lastResult = { cards, plans, minOnly, sumMin, strategy, budget: budgetInfo, recommended };

    $("#results").hidden = false;
    renderStats();
    renderAffordCallout();
    renderPlans();
    renderSelected();
  }

  function renderAffordCallout() {
    const { budget: b, sumMin, recommended } = lastResult;
    const el = $("#afford-callout");
    if (!b) { el.hidden = true; return; }
    el.hidden = false;
    const comfy = Math.max(0, Math.floor(b.comfortable / 5) * 5);
    if (b.free < sumMin) {
      el.className = "callout warn";
      el.innerHTML = `<strong>Your budget doesn't cover your minimum payments yet.</strong> After essentials you have ${usd.format(b.free)} a month, but the minimums total ${usd2.format(sumMin)}. See section 7 for options.`;
      return;
    }
    el.className = "callout good";
    el.innerHTML = `After essentials and a ${b.cushionPct}% cushion, you can comfortably put about <strong>${usd.format(comfy)}/month</strong> toward your cards.
      ${recommended ? `The <strong>${recommended.name}</strong> plan is the fastest one that fits.`
        : comfy >= sumMin ? "None of the preset plans fit comfortably, so a Custom plan at that amount is your best start."
        : `That's less than your minimum payments (${usd2.format(sumMin)}), so any plan will use part of your cushion. See section 7 for whether a personal loan would help.`}
      ${comfy >= sumMin ? ` <button type="button" class="btn ghost" id="use-comfy" style="margin-left:4px;padding:4px 10px">Use ${usd.format(comfy)} as my Custom plan</button>` : ""}`;
    const btn = $("#use-comfy");
    if (btn) btn.addEventListener("click", () => {
      state.customBudget = String(comfy);
      $("#custom-budget").value = comfy;
      state.selected = "custom";
      schedule(0);
    });
  }

  function renderPaycheck() {
    const { budget: b } = lastResult;
    const box = $("#paycheck");
    if (!b) { box.hidden = true; return; }
    box.hidden = false;
    const p = selectedPlan();
    const pay = p.effectiveBudget;
    const left = b.monthly - b.essentials - pay;
    const segs = [
      { label: "Essentials", v: b.essentials, color: css("--plan-min") },
      { label: `Card payments (${p.name})`, v: pay, color: css(p.color) },
    ];
    if (left >= 0) segs.push({ label: "Left over", v: left, color: css("--good") });
    const scale = Math.max(b.monthly, b.essentials + pay);
    $("#paybar").innerHTML = segs.map((s) => `<span style="width:${(s.v / scale) * 100}%;background:${s.color}" title="${esc(s.label)}: ${usd.format(s.v)}"></span>`).join("");
    $("#paybar").setAttribute("aria-label", segs.map((s) => `${s.label} ${usd.format(s.v)}`).join(", ") + ` of ${usd.format(b.monthly)} take-home pay`);
    const legend = segs.map((s) => `<li><i style="background:${s.color}"></i>${esc(s.label)} <b>${usd.format(s.v)}</b> <span class="hint" style="margin:0">(${Math.round((s.v / b.monthly) * 100)}%)</span></li>`);
    if (left < 0) legend.push(`<li style="color:var(--bad)"><strong>Short by ${usd.format(-left)} a month</strong></li>`);
    $("#paybar-legend").innerHTML = legend.join("");
  }

  function selectedPlan() {
    return lastResult.plans.find((p) => p.id === state.selected);
  }

  /* ---------- snapshot ---------- */
  function renderStats() {
    const { cards, minOnly, sumMin } = lastResult;
    const total = cards.reduce((s, c) => s + c.balance, 0);
    const wApr = cards.reduce((s, c) => s + c.balance * c.apr, 0) / total;
    const monthlyInterest = cards.reduce((s, c) => s + (c.balance * c.apr) / 1200, 0);
    const tiles = [
      ["Total credit card debt", usd.format(total), `${cards.length} card${cards.length > 1 ? "s" : ""}`],
      ["Average APR (weighted)", `${wApr.toFixed(2)}%`, "weighted by balance"],
      ["Interest you're charged now", usd2.format(monthlyInterest), `per month, about ${usd.format(monthlyInterest / 30)} a day`],
      ["Minimum payments due", usd2.format(sumMin), "this month, all cards"],
    ];
    const b = lastResult.budget;
    if (b) {
      tiles.push(["Free cash after essentials", usd.format(b.free), `of ${usd.format(b.monthly)} take-home a month`]);
      tiles.push(["Debt vs. take-home pay", `${((total / (b.monthly * 12)) * 100).toFixed(0)}%`, `your debt is ${(total / b.monthly).toFixed(1)} months of pay`]);
    }
    $("#stats").innerHTML = tiles.map(([k, v, s]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join("");

    const c = $("#min-callout");
    if (minOnly.paidOff) {
      c.innerHTML = `<strong>If you only pay the minimum</strong>, you'll be paying for <strong>${duration(minOnly.monthsToPayoff)}</strong> (until ${dateLabel(minOnly.monthsToPayoff)}) and pay <strong>${usd.format(minOnly.totalInterest)}</strong> in interest on top of the ${usd.format(total)} you owe.`;
    } else {
      c.innerHTML = `<strong>If you only pay the minimum, this debt never gets paid off.</strong> The minimums barely cover the interest. You need one of the plans below.`;
    }
  }

  /* ---------- plan cards ---------- */
  function renderPlans() {
    const { plans, minOnly, sumMin } = lastResult;
    const box = $("#plans");
    box.innerHTML = "";
    plans.forEach((p) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "plan" + (p.result ? "" : " disabled");
      el.setAttribute("role", "radio");
      el.setAttribute("aria-checked", p.id === state.selected);
      el.style.setProperty("--plan-color", css(p.color));
      if (!p.result) {
        el.innerHTML = `<div class="name">${p.name}<span class="tag">${p.tag}</span></div>
          <div class="note">Enter a monthly budget above to see your own plan. Your minimums add up to ${usd2.format(sumMin)}.</div>`;
        el.addEventListener("click", () => $("#custom-budget").focus());
      } else {
        const r = p.result;
        const saved = minOnly.paidOff ? minOnly.totalInterest - r.totalInterest : null;
        const lowNote = p.id === "custom" && p.budget < sumMin
          ? `<div class="note">Your budget is below this month's minimums, so the plan uses ${usd2.format(sumMin)} instead.</div>` : "";
        const f = p.feas;
        const meterColor = f ? { high: "--good", likely: "--accent", stretch: "--warn", no: "--bad" }[f.key] : null;
        const feasHtml = f ? `
          <span class="badge ${f.key}" title="${esc(f.why)}">${f.label}</span>
          <div class="meter" aria-hidden="true"><span style="width:${Math.min(100, isFinite(f.share) ? f.share * 100 : 100)}%;background:${css(meterColor)}"></span></div>
          <div class="note">${isFinite(f.share) ? `Uses ${Math.round(f.share * 100)}% of your free cash. ` : ""}${esc(f.why)}</div>` : "";
        const isRec = lastResult.recommended && lastResult.recommended.id === p.id;
        el.innerHTML = `<div class="name">${p.name}<span class="tag">${p.tag}</span></div>
          ${isRec ? `<div class="rec">★ Best fit for your budget</div>` : ""}
          <div class="pay">${usd.format(p.effectiveBudget)}<small> /month</small></div>
          ${feasHtml}
          <dl>
            <dt>Debt-free</dt><dd>${r.paidOff ? dateLabel(r.monthsToPayoff) : "Never"}</dd>
            <dt>Time</dt><dd>${duration(r.monthsToPayoff)}</dd>
            <dt>Total interest</dt><dd>${usd.format(r.totalInterest)}</dd>
            <dt>Total paid</dt><dd>${usd.format(r.totalPaid)}</dd>
            ${saved != null ? `<dt>Saved vs. minimums</dt><dd class="save">${usd.format(saved)}</dd>` : ""}
          </dl>${lowNote}`;
        el.addEventListener("click", () => {
          state.selected = p.id;
          save();
          $$("#plans .plan").forEach((b) => b.setAttribute("aria-checked", "false"));
          el.setAttribute("aria-checked", "true");
          renderSelected();
        });
      }
      box.appendChild(el);
    });
  }

  /* ---------- selected plan views ---------- */
  function renderSelected() {
    const p = selectedPlan();
    $$(".sel-plan-name").forEach((n) => (n.textContent = `${p.name} plan`));
    renderPaycheck();
    renderCharts();
    renderTimeline();
    renderLoan();
    renderTips();
    renderSchedule();
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
    // Apples-to-apples: what if the same monthly amount went to the cards instead?
    const same = Planner.simulate(cards, { budget: loan.payment, strategy: lastResult.strategy });
    const savings = same.paidOff ? same.totalInterest - loan.cost : Infinity;

    const caveat = `<p class="hint" style="margin-top:8px">A loan only helps if you stop using the cards once they're paid off. Your actual rate depends on your credit score. Many lenders let you check your rate with a soft credit pull, which doesn't affect your score.</p>`;
    const sameTxt = same.paidOff
      ? `Paying the same ${usd.format(loan.payment)}/month to your cards would cost ${usd.format(same.totalInterest)} in interest over ${duration(same.monthsToPayoff)}. The loan costs ${usd.format(loan.cost)} in interest and fees over ${duration(term)}.`
      : `At ${usd.format(loan.payment)}/month your cards would never be paid off. The loan would clear the debt in ${duration(term)} for ${usd.format(loan.cost)} in interest and fees.`;

    // Suggest a longer term when the chosen one is too expensive for the budget
    let longer = "";
    if (b && term < 60 && !fits(loanFeas)) {
      const q60 = Planner.loanQuote(total, apr, 60, fee);
      const f60 = feasibility(q60.payment, b);
      longer = ` A 5-year loan would be ${usd.format(q60.payment)}/month (${f60.label.toLowerCase()} for your budget) and cost ${usd.format(q60.cost)} in interest and fees.`;
    }

    let cls, title, body;
    if (!b) {
      if (savings > 200) { cls = "maybe"; title = `A loan could save you about ${usd.format(Math.min(savings, 1e9))}`; }
      else { cls = "no"; title = "A loan doesn't save much at these rates"; }
      body = `${sameTxt} Add your take-home pay in section 2 to see whether the payment fits your budget.`;
    } else if (b.free < sumMin) {
      if (loan.payment <= b.free) {
        cls = "yes"; title = "A personal loan could make this manageable";
        body = `Your minimums (${usd2.format(sumMin)}) are more than the ${usd.format(b.free)} you have after essentials. A ${term}-month loan at ${apr}% would be ${usd.format(loan.payment)}/month, which fits. ${sameTxt}`;
      } else {
        cls = "warn"; title = "Your budget can't cover this debt right now";
        body = `Even a ${term}-month loan (${usd.format(loan.payment)}/month) is more than the ${usd.format(Math.max(0, b.free))} left after essentials. Try a longer loan term above. Also consider cutting a fixed cost, asking your card issuers about a hardship program, or talking to a nonprofit credit counselor about a debt management plan. Those plans often cut card APRs to around 6–10%.`;
      }
    } else if (!recommended) {
      if (fits(loanFeas)) {
        cls = "yes"; title = "Consider a personal loan";
        body = `None of the card plans fit comfortably in your budget, but a ${term}-month loan at ${apr}% would be ${usd.format(loan.payment)}/month (${loanFeas.label.toLowerCase()} to work). ${sameTxt}`;
      } else if (loanFeas.key === "stretch") {
        cls = "maybe"; title = "A loan might help, but it's tight";
        body = `The loan payment (${usd.format(loan.payment)}/month) would eat into your cushion. Try a longer term, or trim an expense first. ${sameTxt}`;
      } else {
        cls = "warn"; title = "Neither the plans nor a loan fit your budget yet";
        body = `Try a longer loan term above, trim a fixed cost, or talk to a nonprofit credit counselor about a debt management plan. ${sameTxt}`;
      }
    } else if (savings >= Math.max(300, 0.15 * same.totalInterest) && loanFeas.key !== "no" && apr < wApr) {
      cls = "maybe"; title = `Worth considering: a loan could save you about ${usd.format(savings)}`;
      body = `You don't need a loan, because the ${recommended.name} plan fits your budget. But your cards average ${wApr.toFixed(1)}% APR versus ${apr}% on the loan. ${sameTxt}`;
    } else {
      cls = "no"; title = "You probably don't need a personal loan";
      body = `The ${recommended.name} plan fits your budget${savings > 0 && isFinite(savings) ? `, and a loan would only save about ${usd.format(savings)}` : `, and at ${apr}% a loan would cost you more`}. ${sameTxt}`;
    }
    body += longer;
    $("#loan-verdict").className = "verdict " + cls;
    $("#loan-verdict").innerHTML = `<h3>${esc(title)}</h3><p>${esc(body)}</p>${caveat}`;

    const rows = [];
    const add = (name, pay, months, cost, f) => rows.push(`<tr><td class="l">${esc(name)}</td><td>${pay}</td><td>${months}</td><td>${cost}</td>${b ? `<td class="l">${f ? `<span class="badge ${f.key}">${f.label}</span>` : "–"}</td>` : ""}</tr>`);
    add(`Personal loan (${apr}%, ${term} mo, ${fee}% fee)`, usd.format(loan.payment), duration(term), usd.format(loan.cost), loanFeas);
    add(`Cards: ${sel.name} plan`, usd.format(sel.effectiveBudget), duration(sel.result.monthsToPayoff), usd.format(sel.result.totalInterest), sel.feas);
    if (recommended && recommended.id !== sel.id) add(`Cards: ${recommended.name} plan`, usd.format(recommended.effectiveBudget), duration(recommended.result.monthsToPayoff), usd.format(recommended.result.totalInterest), recommended.feas);
    add("Cards: minimum payments only", `${usd.format(sumMin)} and falling`, duration(minOnly.monthsToPayoff), minOnly.paidOff ? usd.format(minOnly.totalInterest) : "Never paid off", feasibility(sumMin, b));
    $("#loan-table").innerHTML = `<thead><tr><th class="l">Option</th><th>Monthly</th><th>Debt-free in</th><th>Interest + fees</th>${b ? `<th class="l">Fits your budget?</th>` : ""}</tr></thead><tbody>${rows.join("")}</tbody>`;
  }

  function chartDefaults() {
    Chart.defaults.color = css("--muted");
    Chart.defaults.borderColor = css("--border");
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.boxWidth = 8;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.animation.duration = 300;
  }
  function makeChart(id, config) {
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(document.getElementById(id), config);
  }
  const moneyTick = (v) => (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : `$${v}`);
  const monthTitle = (items) => `Month ${items[0].label} · ${dateLabel(Number(items[0].label))}`;

  function renderCharts() {
    if (typeof Chart === "undefined") return;
    chartDefaults();
    const { cards, plans, minOnly } = lastResult;
    const sel = selectedPlan();
    const active = plans.filter((p) => p.result);
    const total = cards.reduce((s, c) => s + c.balance, 0);

    // 1. Comparison of total balance over time
    const longestPlan = Math.max(...active.map((p) => p.result.monthsToPayoff).filter(isFinite), 1);
    const horizon = Math.min(Math.ceil((longestPlan + 6) / 6) * 6, Planner.MAX_MONTHS);
    const series = (r) => {
      const pts = [{ x: 0, y: total }];
      r.months.forEach((m) => { if (m.month <= horizon) pts.push({ x: m.month, y: m.totalBalance }); });
      return pts;
    };
    const datasets = active.map((p) => ({
      label: `${p.name} (${usd.format(p.effectiveBudget)}/mo)`,
      data: series(p.result),
      borderColor: css(p.color),
      backgroundColor: css(p.color),
      borderWidth: p.id === sel.id ? 3.5 : 2,
      pointRadius: 0, tension: 0.15,
    }));
    datasets.push({
      label: minOnly.paidOff ? `Minimum only (${duration(minOnly.monthsToPayoff)})` : "Minimum only (never)",
      data: series(minOnly), borderColor: css("--plan-min"), backgroundColor: css("--plan-min"),
      borderDash: [6, 4], borderWidth: 2, pointRadius: 0,
    });
    makeChart("chart-compare", {
      type: "line",
      data: { datasets },
      options: {
        interaction: { mode: "nearest", axis: "x", intersect: false },
        scales: {
          x: { type: "linear", min: 0, max: horizon, title: { display: true, text: "Months from now" }, ticks: { stepSize: horizon > 60 ? 12 : 6 } },
          y: { beginAtZero: true, ticks: { callback: moneyTick } },
        },
        plugins: {
          tooltip: { callbacks: { title: (it) => `Month ${it[0].parsed.x} · ${dateLabel(it[0].parsed.x)}`, label: (c) => ` ${c.dataset.label.split(" (")[0]}: ${usd.format(c.parsed.y)}` } },
        },
      },
    });

    // 2. Selected plan: stacked balance per card
    const r = sel.result;
    const labels = [0, ...r.months.map((m) => m.month)];
    makeChart("chart-cards", {
      type: "line",
      data: {
        labels,
        datasets: cards.map((c, i) => ({
          label: c.label,
          data: [c.balance, ...r.months.map((m) => m.balances[i])],
          borderColor: seriesColor(c.colorIndex),
          backgroundColor: seriesColor(c.colorIndex) + "55",
          fill: true, pointRadius: 0, borderWidth: 1.5, tension: 0.15,
        })),
      },
      options: {
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { title: { display: true, text: "Months from now" }, ticks: { maxTicksLimit: 12 } },
          y: { stacked: true, beginAtZero: true, ticks: { callback: moneyTick } },
        },
        plugins: { tooltip: { callbacks: { title: monthTitle, label: (c) => ` ${c.dataset.label}: ${usd.format(c.parsed.y)}` } } },
      },
    });

    // 3. Principal vs interest doughnut
    makeChart("chart-split", {
      type: "doughnut",
      data: {
        labels: ["Principal (what you owe)", "Interest (cost of borrowing)"],
        datasets: [{ data: [total, r.totalInterest], backgroundColor: [css("--principal"), css("--interest")], borderColor: css("--surface"), borderWidth: 2 }],
      },
      options: {
        cutout: "62%",
        plugins: {
          legend: { position: "bottom" },
          tooltip: { callbacks: { label: (c) => ` ${usd.format(c.parsed)} (${((c.parsed / (total + r.totalInterest)) * 100).toFixed(1)}%)` } },
        },
      },
      plugins: [centerText(`${usd.format(total + r.totalInterest)}`, "total paid")],
    });

    // 4. Interest by plan bar
    const bars = [...active.map((p) => ({ name: p.name, v: p.result.totalInterest, color: css(p.color) }))];
    if (minOnly.paidOff) bars.push({ name: "Minimum only", v: minOnly.totalInterest, color: css("--plan-min") });
    makeChart("chart-interest", {
      type: "bar",
      data: { labels: bars.map((b) => b.name), datasets: [{ data: bars.map((b) => b.v), backgroundColor: bars.map((b) => b.color), borderRadius: 4 }] },
      options: {
        indexAxis: "y",
        scales: { x: { beginAtZero: true, ticks: { callback: moneyTick } }, y: { grid: { display: false } } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${usd.format(c.parsed.x)} interest` } } },
      },
    });

    // 5. Monthly payment split
    makeChart("chart-monthly", {
      type: "bar",
      data: {
        labels: r.months.map((m) => m.month),
        datasets: [
          { label: "Principal", data: r.months.map((m) => m.totalPayment - m.totalInterest), backgroundColor: css("--principal") },
          { label: "Interest", data: r.months.map((m) => m.totalInterest), backgroundColor: css("--interest") },
        ],
      },
      options: {
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { stacked: true, title: { display: true, text: "Month" }, ticks: { maxTicksLimit: 12 }, grid: { display: false } },
          y: { stacked: true, beginAtZero: true, ticks: { callback: moneyTick } },
        },
        plugins: { tooltip: { callbacks: { title: monthTitle, label: (c) => ` ${c.dataset.label}: ${usd2.format(c.parsed.y)}` } } },
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
        ctx.font = `700 18px ${Chart.defaults.font.family}`;
        ctx.fillText(main, x, y + 2);
        ctx.fillStyle = css("--muted");
        ctx.font = `500 12px ${Chart.defaults.font.family}`;
        ctx.fillText(sub, x, y + 20);
        ctx.restore();
      },
    };
  }

  /* ---------- timeline ---------- */
  function renderTimeline() {
    const { cards } = lastResult;
    const r = selectedPlan().result;
    const order = cards.map((c, i) => ({ c, i, m: r.payoffMonth[i] })).sort((a, b) => (a.m ?? 1e9) - (b.m ?? 1e9));
    $("#timeline").innerHTML = order.map(({ c, i, m }, k) => `
      <li>
        <span class="dot" style="background:${seriesColor(c.colorIndex)}">${k + 1}</span>
        <div><strong>${esc(c.label)}</strong>
          <div class="meta">${usd.format(c.balance)} at ${c.apr}% APR · ${usd.format(r.interestByCard[i])} interest over the plan</div></div>
        <div class="when">${m ? dateLabel(m) : "Not paid off"}<small>${m ? `month ${m}` : ""}</small></div>
      </li>`).join("");
  }

  /* ---------- tips ---------- */
  function renderTips() {
    const { cards, strategy, minOnly } = lastResult;
    const p = selectedPlan();
    const r = p.result;
    const budget = p.effectiveBudget;
    const tips = [];

    // Priority card
    const top = strategy === "snowball"
      ? [...cards].sort((a, b) => a.balance - b.balance)[0]
      : [...cards].sort((a, b) => b.apr - a.apr)[0];
    tips.push(["Start with " + top.label,
      strategy === "snowball"
        ? `It has the smallest balance (${usd.format(top.balance)}), so you'll clear it first and get a quick win. Pay only the minimum on everything else until it's gone.`
        : `At ${top.apr}% APR it's your most expensive card. It costs you ${usd2.format((top.balance * top.apr) / 1200)} in interest every month. Every extra dollar should go here first.`]);

    // Budget-aware advice
    const bud = lastResult.budget;
    if (bud) {
      const rec = lastResult.recommended;
      if (p.feas && !fits(p.feas) && rec) {
        tips.push([`The ${rec.name} plan fits your budget better`,
          `The ${p.name} plan needs ${usd.format(budget)}/month, which is ${p.feas.label.toLowerCase()} on your income. ${rec.name} (${usd.format(rec.effectiveBudget)}/month) leaves your cushion intact and still gets you debt-free by ${dateLabel(rec.result.monthsToPayoff)}.`]);
      }
      const biggest = [...bud.expenses].sort((a, b) => b.amount - a.amount)[0];
      const flexible = bud.expenses.filter((e) => !/rent|mortgage|car payment|loan|insurance|childcare/i.test(e.name)).sort((a, b) => b.amount - a.amount)[0];
      const target = flexible || biggest;
      if (target && target.amount >= 50) {
        const cut = Math.round(target.amount * 0.1);
        const trimmed = Planner.simulate(cards, { budget: budget + cut, strategy });
        if (r.paidOff && trimmed.paidOff && r.monthsToPayoff > trimmed.monthsToPayoff) {
          tips.push([`Trim ${target.name.toLowerCase()} by 10%`,
            `Cutting ${usd.format(cut)} from ${target.name.toLowerCase()} (${usd.format(target.amount)}/month) and adding it to your payment gets you out ${r.monthsToPayoff - trimmed.monthsToPayoff} month${r.monthsToPayoff - trimmed.monthsToPayoff > 1 ? "s" : ""} sooner and saves ${usd.format(r.totalInterest - trimmed.totalInterest)}.`]);
        }
      }
      const housing = bud.expenses.filter((e) => /rent|mortgage/i.test(e.name)).reduce((s, e) => s + e.amount, 0);
      if (housing > bud.monthly * 0.4) {
        tips.push(["Housing is a big share of your pay",
          `Rent or mortgage takes ${Math.round((housing / bud.monthly) * 100)}% of your take-home pay. Many budgets aim for about 30%. A roommate, or moving when your lease ends, could free up a lot of money for your cards.`]);
      }
      if (bud.free > budget * 1.5 && p.feas && p.feas.key === "high") {
        tips.push(["You have room to go faster",
          `This plan uses only ${Math.round(p.feas.share * 100)}% of your free cash. Raising your payment toward ${usd.format(Math.max(budget, Math.floor(bud.comfortable / 5) * 5))} would still leave your cushion untouched.`]);
      }
    }

    // Strategy comparison
    if (cards.length > 1) {
      const other = strategy === "snowball" ? "avalanche" : "snowball";
      const alt = Planner.simulate(cards, { budget, strategy: other });
      const diff = alt.totalInterest - r.totalInterest;
      if (Math.abs(diff) >= 1) {
        tips.push([diff > 0 ? `Your ${strategy} order is the cheaper choice here` : `Switching to ${other} would save ${usd.format(-diff)}`,
          diff > 0
            ? `Paying your cards in ${other} order with the same ${usd.format(budget)}/month would cost ${usd.format(diff)} more in interest.`
            : `Same ${usd.format(budget)}/month, paid in ${other} order, costs ${usd.format(alt.totalInterest)} in interest instead of ${usd.format(r.totalInterest)}.`]);
      }
    }

    // A little extra
    const bump = budget >= 1000 ? 100 : 50;
    const more = Planner.simulate(cards, { budget: budget + bump, strategy });
    if (r.paidOff && more.paidOff && r.monthsToPayoff - more.monthsToPayoff > 0) {
      tips.push([`Add ${usd.format(bump)} a month: debt-free ${r.monthsToPayoff - more.monthsToPayoff} month${r.monthsToPayoff - more.monthsToPayoff > 1 ? "s" : ""} sooner`,
        `Raising your payment to ${usd.format(budget + bump)} saves another ${usd.format(r.totalInterest - more.totalInterest)} in interest. Look for one subscription or bill you can cut.`]);
    }

    // Ask for a lower APR
    const lower = cards.map((c) => ({ ...c, apr: Math.max(0, c.apr - 5) }));
    const lowR = Planner.simulate(lower, { budget, strategy });
    if (r.totalInterest - lowR.totalInterest > 20) {
      const banks = [...new Set(cards.map((c) => c.bank).filter(Boolean))];
      tips.push(["Call and ask for a lower rate",
        `If ${banks.length ? banks.join(", ") : "your banks"} cut your APRs by 5 points, you'd save about ${usd.format(r.totalInterest - lowR.totalInterest)} on this plan. Issuers often agree for customers who pay on time, and it costs nothing to ask.`]);
    }

    // Balance transfer
    const total = cards.reduce((s, c) => s + c.balance, 0);
    const wApr = cards.reduce((s, c) => s + c.balance * c.apr, 0) / total;
    if (total >= 1000 && wApr >= 15) {
      const bt = balanceTransfer(total, budget, 0.03, 18, Math.max(wApr, 20));
      const savings = r.totalInterest - bt.cost;
      if (savings > 100) {
        tips.push(["Consider a 0% balance transfer card",
          `With a typical offer (3% fee, 0% for 18 months), the same ${usd.format(budget)}/month would cost about ${usd.format(bt.cost)} in fees and interest instead of ${usd.format(r.totalInterest)}, saving about ${usd.format(savings)}. ${bt.clearedInPromo ? "You'd finish before the 0% period ends." : `Try to clear it within the 18 months, because the rate jumps after that.`} Approval depends on your credit.`]);
      }
    }

    // Min-only warning recap
    if (minOnly.paidOff) {
      tips.push(["Never drop back to minimums",
        `Paying only the minimum would cost ${usd.format(minOnly.totalInterest - r.totalInterest)} more and take ${duration(minOnly.monthsToPayoff - r.monthsToPayoff)} longer than this plan.`]);
    }

    tips.push(["Set it on autopay and freeze new charges",
      `Schedule ${usd.format(budget)} on autopay right after payday so it happens without thinking. The plan only works if the balances stop growing, so put the cards away and use debit for daily spending.`]);
    tips.push(["Put windfalls straight toward the balance",
      `Tax refunds, bonuses, and gifts go to ${esc(top.label)} first. A one-time ${usd.format(Math.min(1000, Math.round(total / 10 / 50) * 50 || 100))} payment can take months off the plan.`]);
    tips.push(["Keep a small emergency fund",
      "Keep $500 to $1,000 in savings so a surprise expense doesn't go back on a card."]);

    $("#tips").innerHTML = tips.map(([h, b]) => `<li><strong>${esc(h)}</strong>${esc(b)}</li>`).join("");
  }

  function balanceTransfer(total, payment, feePct, promoMonths, postApr) {
    let bal = total * (1 + feePct);
    let interest = 0;
    let m = 0;
    while (bal > 0.005 && m < Planner.MAX_MONTHS) {
      m++;
      const i = m > promoMonths ? (bal * postApr) / 1200 : 0;
      interest += i;
      bal = bal + i - payment;
    }
    return { cost: total * feePct + interest, clearedInPromo: m <= promoMonths };
  }

  /* ---------- schedule ---------- */
  function renderSchedule() {
    const { cards } = lastResult;
    const r = selectedPlan().result;
    const head = `<thead><tr><th>Month</th><th>Payment</th><th>Interest</th><th>Principal</th>${cards.map((c) => `<th>${esc(c.label)}</th>`).join("")}<th>Total balance</th></tr></thead>`;
    const rows = r.months.map((m) => {
      const paid = r.payoffMonth.some((pm) => pm === m.month);
      return `<tr class="${paid ? "paid" : ""}"><td>${m.month} · ${dateLabel(m.month)}</td><td>${usd2.format(m.totalPayment)}</td><td>${usd2.format(m.totalInterest)}</td><td>${usd2.format(m.totalPayment - m.totalInterest)}</td>${m.balances.map((b) => `<td>${b === 0 ? "Paid off" : usd2.format(b)}</td>`).join("")}<td>${usd2.format(m.totalBalance)}</td></tr>`;
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
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `debt-payoff-${p.id}-plan.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  /* ---------- wire up ---------- */
  function init() {
    renderCardInputs();
    renderBudgetInputs();
    $("#loan-apr").value = state.loan.apr;
    $("#loan-term").value = state.loan.term;
    $("#loan-fee").value = state.loan.fee;

    const bindBudget = (id, key, evt = "input") => $(id).addEventListener(evt, (e) => {
      state.budget[key] = e.target.value;
      updateBudgetSummary();
      schedule();
    });
    bindBudget("#salary", "salary");
    bindBudget("#salary-freq", "freq", "change");
    bindBudget("#cushion", "cushion");
    $("#add-expense").addEventListener("click", () => {
      state.budget.expenses.push({ name: "", amount: "" });
      renderBudgetInputs();
      const rows = $$("#expense-list .expense-row");
      rows[rows.length - 1].querySelector("input").focus();
    });
    [["#loan-apr", "apr", "input"], ["#loan-term", "term", "change"], ["#loan-fee", "fee", "input"]].forEach(([id, key, evt]) =>
      $(id).addEventListener(evt, (e) => { state.loan[key] = e.target.value; save(); if (lastResult) renderLoan(); }));
    $(`input[name="strategy"][value="${state.strategy}"]`).checked = true;
    $("#custom-budget").value = state.customBudget || "";

    $("#add-card").addEventListener("click", () => {
      state.cards.push({ bank: "", name: "", balance: "", apr: "", minPayment: "" });
      markEdited();
      renderCardInputs();
      const rows = $$("#card-list .card-row");
      rows[rows.length - 1].querySelector("input").focus();
    });
    $("#load-example").addEventListener("click", () => {
      state.cards = EXAMPLE.map((c) => ({ ...c }));
      state.isExample = true;
      state.budget = cloneBudget(EXAMPLE_BUDGET);
      renderCardInputs();
      renderBudgetInputs();
      schedule(0);
    });
    $("#clear-all").addEventListener("click", () => {
      state.cards = [{ bank: "", name: "", balance: "", apr: "", minPayment: "" }];
      state.customBudget = "";
      $("#custom-budget").value = "";
      state.isExample = false;
      state.budget = EMPTY_BUDGET();
      renderCardInputs();
      renderBudgetInputs();
      schedule(0);
      $("#card-list input").focus();
    });
    $$('input[name="strategy"]').forEach((r) => r.addEventListener("change", () => { state.strategy = r.value; schedule(0); }));
    $("#custom-budget").addEventListener("input", (e) => {
      state.customBudget = e.target.value;
      if (parseFloat(e.target.value) > 0) state.selected = "custom";
      schedule();
    });
    $("#download-csv").addEventListener("click", downloadCSV);
    $("#print-plan").addEventListener("click", () => window.print());

    // Re-theme charts when the OS colour scheme changes
    if (window.matchMedia) {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        if (lastResult) { renderCardInputs(); renderPlans(); renderPaycheck(); renderCharts(); renderTimeline(); }
      });
    }
    run();
  }

  init();
})();
