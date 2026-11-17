/*
 * Debt payoff engine.
 * Pure functions, no DOM access — works in the browser (window.Planner)
 * and in Node (module.exports) so it can be tested from the command line.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Planner = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_MONTHS = 600; // 50 years: anything longer is treated as "never"
  const EPS = 0.005;

  // Typical issuer formula: 1% of balance + this month's interest, with a $25 floor
  // (or the user's stated minimum, if higher). Never more than what is owed.
  function minimumPayment(card, balanceBeforeInterest, interest) {
    const owed = balanceBeforeInterest + interest;
    if (owed <= EPS) return 0;
    const floor = Math.max(25, Number(card.minPayment) || 0);
    const formula = balanceBeforeInterest * 0.01 + interest;
    return Math.min(owed, Math.max(floor, formula));
  }

  function priorityOrder(cards, balances, strategy) {
    const idx = cards.map((_, i) => i).filter((i) => balances[i] > EPS);
    if (strategy === "snowball") {
      idx.sort((a, b) => balances[a] - balances[b] || cards[b].apr - cards[a].apr || a - b);
    } else {
      // avalanche (default): highest APR first, smaller balance breaks ties
      idx.sort((a, b) => cards[b].apr - cards[a].apr || balances[a] - balances[b] || a - b);
    }
    return idx;
  }

  /**
   * Simulate month by month.
   * @param cards   [{balance, apr, minPayment?}]
   * @param opts    {budget: number|null, strategy: "avalanche"|"snowball"}
   *                budget=null means "pay only the minimum on every card".
   */
  function simulate(cards, opts) {
    const strategy = (opts && opts.strategy) || "avalanche";
    const budget = opts && opts.budget != null ? Number(opts.budget) : null;
    const n = cards.length;
    const bal = cards.map((c) => Math.max(0, Number(c.balance) || 0));
    const payoffMonth = cards.map((c, i) => (bal[i] <= EPS ? 0 : null));
    const interestByCard = new Array(n).fill(0);
    const months = [];
    let totalInterest = 0;
    let totalPaid = 0;

    for (let m = 1; m <= MAX_MONTHS; m++) {
      if (bal.every((b) => b <= EPS)) break;

      const interest = bal.map((b, i) => (b > EPS ? (b * cards[i].apr) / 1200 : 0));
      const mins = bal.map((b, i) => (b > EPS ? minimumPayment(cards[i], b, interest[i]) : 0));
      const owed = bal.map((b, i) => b + interest[i]);
      const sumMin = mins.reduce((a, b) => a + b, 0);

      const pay = mins.slice();
      let extra = budget == null ? 0 : Math.max(0, budget - sumMin);
      for (const i of priorityOrder(cards, bal, strategy)) {
        if (extra <= EPS) break;
        const add = Math.min(extra, owed[i] - pay[i]);
        pay[i] += add;
        extra -= add;
      }
      // Leftover extra (a card was paid off this month) rolls into any card still owing
      if (extra > EPS) {
        for (let i = 0; i < n && extra > EPS; i++) {
          const add = Math.min(extra, owed[i] - pay[i]);
          if (add > 0) { pay[i] += add; extra -= add; }
        }
      }

      const principal = [];
      for (let i = 0; i < n; i++) {
        principal.push(pay[i] - interest[i]);
        bal[i] = owed[i] - pay[i];
        if (bal[i] <= EPS) bal[i] = 0;
        if (bal[i] === 0 && payoffMonth[i] == null) payoffMonth[i] = m;
        interestByCard[i] += interest[i];
      }
      const monthInterest = interest.reduce((a, b) => a + b, 0);
      const monthPaid = pay.reduce((a, b) => a + b, 0);
      totalInterest += monthInterest;
      totalPaid += monthPaid;

      months.push({
        month: m,
        payments: pay,
        interest,
        principal,
        balances: bal.slice(),
        totalPayment: monthPaid,
        totalInterest: monthInterest,
        totalBalance: bal.reduce((a, b) => a + b, 0),
      });
    }

    const paidOff = bal.every((b) => b <= EPS);
    return {
      strategy,
      budget,
      months,
      monthsToPayoff: paidOff ? months.length : Infinity,
      paidOff,
      totalInterest,
      totalPaid,
      payoffMonth,
      interestByCard,
      firstMonthMinimum: months.length ? sumFirstMins(cards) : 0,
    };
  }

  function sumFirstMins(cards) {
    return cards.reduce((s, c) => {
      const b = Math.max(0, Number(c.balance) || 0);
      const i = (b * c.apr) / 1200;
      return s + (b > EPS ? minimumPayment(c, b, i) : 0);
    }, 0);
  }

  /** Smallest fixed monthly budget (rounded up to $5) that clears all debt within `targetMonths`. */
  function requiredBudget(cards, targetMonths, strategy) {
    const total = cards.reduce((s, c) => s + (Number(c.balance) || 0), 0);
    if (total <= EPS) return 0;
    let lo = sumFirstMins(cards);
    const maxApr = Math.max(...cards.map((c) => c.apr));
    let hi = total * (1 + maxApr / 1200) + 1;
    if (simulate(cards, { budget: lo, strategy }).monthsToPayoff <= targetMonths) {
      return Math.ceil(lo / 5) * 5;
    }
    for (let k = 0; k < 50 && hi - lo > 0.5; k++) {
      const mid = (lo + hi) / 2;
      if (simulate(cards, { budget: mid, strategy }).monthsToPayoff <= targetMonths) hi = mid;
      else lo = mid;
    }
    return Math.ceil(hi / 5) * 5;
  }

  /**
   * Personal (consolidation) loan quote. The origination fee is assumed to be taken out of the
   * proceeds, so you borrow slightly more than you owe in order to clear every card.
   */
  function loanQuote(amountNeeded, apr, termMonths, feePct) {
    const fee = Math.min(Math.max(Number(feePct) || 0, 0), 50) / 100;
    const principal = amountNeeded / (1 - fee);
    const r = (Number(apr) || 0) / 1200;
    const n = Math.max(1, Math.round(termMonths));
    const payment = r > 0 ? (principal * r) / (1 - Math.pow(1 + r, -n)) : principal / n;
    const totalPaid = payment * n;
    return {
      principal,
      payment,
      months: n,
      totalPaid,
      feeAmount: principal - amountNeeded,
      interest: totalPaid - principal,
      cost: totalPaid - amountNeeded, // interest + fee
    };
  }

  return { simulate, requiredBudget, minimumPayment, sumFirstMins, loanQuote, MAX_MONTHS };
});
