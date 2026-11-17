# Debt Payoff Planner

A simple web app that turns your credit card debt into a clear payoff plan. Nothing to install and no server; your data stays in your browser.

## How it works

1. **Your cards**: bank, balance, and APR for each card.
2. **Your monthly money** (optional): take-home pay and the bills you can't skip, like rent, electricity, or a car payment.

You then get:

- **One clear answer**: "Debt-free by *May 2028*, paying $615/month", with a rating of how realistic that is for your budget (*Very likely*, *Likely*, *Tight*, or *Too much*).
- **Plan tabs**: Easy (about 5 years), Medium (about 3 years), or Fast (about 18 months). The plan that fits your budget best is picked for you.
- **A chart** of your balance over time for each plan compared with paying only the minimums.
- **What to do next**: the three most useful tips for your situation, with more in a collapsible section.
- **Personal loan check**: a plain yes, no, or maybe on whether a consolidation loan makes sense, with adjustable loan details.
- **Collapsible extras**: more charts, when each card gets paid off, and a month-by-month schedule with CSV download and print.

**Advanced options** (collapsed by default): which card to pay first (highest APR or smallest balance), the size of your safety cushion, and your own monthly payment amount.

## Run it

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000   # then visit http://localhost:8000
```

## The math

Each month every card accrues `balance × APR / 12` in interest and gets its minimum payment: the larger of $25 and 1% of the balance plus that month's interest. The rest of the plan's fixed payment goes to the priority card. When a card is paid off, its payment moves to the next card. The preset plan payments come from a binary search for the smallest payment, rounded up to $5, that clears everything within the target time. Budget ratings compare the payment with the money left after your bills and a safety cushion (10% of pay by default). These are estimates, not financial advice.

## Files

- `index.html`: page structure
- `css/styles.css`: styles, including the dark theme
- `js/planner.js`: payoff and loan math (pure functions; also loads in Node)
- `js/app.js`: UI, charts, tips, schedule
- `vendor/chart.umd.js`: Chart.js 4.4.1 (MIT), bundled so the app works offline
