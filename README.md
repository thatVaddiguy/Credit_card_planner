# Debt Payoff Planner

A static web app for planning how to pay off credit card debt. Nothing to install and no server; all data stays in your browser.

## Features

- **Card inputs**: bank (with suggestions for common banks), nickname, balance, APR, optional minimum payment. Add as many cards as you like.
- **Payoff plans**
  - **Easy**: the lowest fixed payment that clears the debt in about 5 years
  - **Medium**: about 3 years
  - **Aggressive**: about 18 months
  - **Custom**: your own monthly budget
  - Each plan shows the monthly payment, debt-free date, total interest, total paid, and the savings compared with paying only the minimums.
- **Strategy**: Avalanche (highest APR first, cheapest) or Snowball (smallest balance first, quickest wins). Money freed up by a paid-off card rolls into the next card.
- **Charts** (Chart.js): total balance over time for every plan, balance by card, principal vs. interest, total interest by plan, and each month's payment split into interest and principal.
- **Payoff order timeline**: when each card hits $0.
- **Personalized tips**: which card to target first, avalanche vs. snowball difference, the effect of adding $50 a month, savings from asking for a lower APR, a balance transfer estimate, and other habits.
- **Month-by-month schedule** with CSV download and a print view.
- Light and dark themes, works on phones, and saves your inputs in `localStorage`.

## Run it

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000   # then visit http://localhost:8000
```

## How the math works

Each month every card accrues `balance × APR / 12` in interest. Every card gets its minimum payment: the greater of $25 (or the minimum you entered) and 1% of the balance plus that month's interest. The rest of the plan's fixed budget goes to the priority card. The Easy, Medium, and Aggressive budgets come from a binary search for the smallest payment, rounded up to $5, that clears all cards within the target number of months. Figures are estimates: the planner assumes APRs don't change and no new charges are made.

## Files

- `index.html`: page structure
- `css/styles.css`: styles, including the dark theme
- `js/planner.js`: payoff engine (pure functions; also loads in Node for testing)
- `js/app.js`: UI, charts, tips, schedule
- `vendor/chart.umd.js`: Chart.js 4.4.1 (MIT), bundled so the app works offline
