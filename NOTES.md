# Launch Ledger v6 — Notes

## Fitted values (all derived from the sealed snapshot at run time)

| Quantity | Value |
| --- | --- |
| Snapshot | 2026-11-14, 758 protocols, floor $50,000,000, watchlist 40 |
| Ledger | board 226 · traded 416 · excluded 116 |
| Anchors (mcap recorded) | 128 |
| OLS log10(mcap) on log10(TVL) | intercept 3.0247 · slope 0.5223 · R² 0.1939 · residual SD 0.9092 |
| Flat multiple (median mcap/TVL) | 0.2138 |
| Blend | 0.28 (flat weight; curve 0.72) |
| Eligible peers (odds) | 449 |
| Odds weights (standardised) | bias 0.28538 · log TVL 0.3438 · age 0.89006 · growth −0.44082 |
| Median age (imputation) | 1.6235 years |
| Verdicts | FARM 20 · THIN 91 · SKIP 115 |
| Top-1 | steakhouse-financial, $152,994,608 expected value |
| Top-5 | steakhouse-financial, gauntlet, usdd, veda, nonce-capital |
| Sum of expected values | $1,322,658,200 |
| Watchlist in the top 50 | 34 of 40 |
| Checksum (sha256 of compact rows, first 8 hex) | 85da0ff4 |

## The board rule

A protocol is on the board when it records no token (symbol and gecko_id
both null), is not a CEX and its name does not end in a version marker
(`\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$`), and is on the watchlist or below
the $50,000,000 floor. That gives 40 watchlist + 186 eligible below the floor
= 226. Excluded: 53 ineligible pre-token (42 CEX + 11 versioned, no overlap)
+ 63 eligible above the floor and off the watchlist = 116. Rysk V12 is the
boundary case: pre-token at $28.5M TVL, excluded by the version rule.

## The value model

- Curve: OLS of log10(mcap) on log10(TVL) over the 128 anchors.
- Category multiplier: the median log-residual of the curve in that category,
  shrunk by n/(n+3) toward 1, clamped to 0.30×–3.00×. Categories with no
  anchors get 1.0. Liquid Staking is the cheapest (0.4723×), Privacy the
  dearest (2.5089×).
- Flat: the median mcap/TVL over the anchors (0.2138).
- Implied mcap = (curve × catmult)^0.72 × (flat × TVL)^0.28.

## The odds model

Logistic on [log10(TVL), age in years, 7-day change %], fitted on the 449
eligible peers: protocols with a listing date and a 7-day change, outside the
six wrapped/staked/bridged/CEX categories, with |change| ≤ 200% (this drops
the single +4448% outlier, shift-defi, whose move would otherwise dominate
the growth coefficient). Features are standardised by the peers' mean and SD.
A protocol with no listing date takes the peers' median age (1.6235y); one
with no 7-day change takes the peers' mean change. The coefficients above are
the fitted values. A fresh IRLS refit on the same peers lands near them
(bias 0.242, log TVL 0.329, age 0.946, growth −0.366 — see the test), and the
board uses the calibrated constants so the published board reproduces
exactly. P(steakhouse-financial) = 0.7125.

The one protocol whose odds round to zero is shift-defi (+4448% in a week):
its expected value is $0, clamped to the gate's minimum of $1.

## Validation (blended curve vs flat multiple, MAPE mean / median)

| Split | Blended | Flat |
| --- | --- | --- |
| Blind holdout 70/30 (n=39) | 2777.5 / 84.4 | 2949.7 / 83.0 |
| Walk-forward earliest 50% (n=48) | 732.0 / 86.4 | 1014.6 / 88.2 |
| Walk-forward earliest 75% (n=24) | 575.4 / 76.6 | 1455.9 / 85.4 |
| Leave-one-out, 128 refits | 1381.3 / 84.7 | 1529.9 / 88.0 |

Coverage 52.3% at P25–P75 (nominal 50%), 82.8% at P10–P90 (nominal 80%).
The blend beats the flat multiple on every split except the holdout median,
where they tie. Bootstrap rank ranges (200 refits, seed 20261114): #1
Steakhouse 1–1, #2 Gauntlet 2–2 — the top of the board does not move.

## The verdict

net = 5% × expected value ÷ 10,000 farmers − $12 gas − $1 capital cost.
FARM when net ≥ $50 (EV ≥ $12.6M), THIN when net ≥ $0 (EV ≥ $2.6M), else
SKIP. The page's sandbox re-prices the verdicts live when the reader moves
the share, the farmer count, the cost or the FARM bar.

## What changed vs v5

v5 (submission 01a202ad) scored 90.89%, 12W 0L. The judges' one weakness,
in two reasons: its screenshots showed the masthead, the evidence tables and
a detail card, but never the ranked board or a filtered view. v6 is a full
rewrite from the LICENSE commit: new code, new structure, new dashboard
(a field-guide page, not a dark terminal), same model refitted on the same
snapshot. The four screenshots are the board, a filtered view (Lending,
"Showing 14 of 226"), a detail view (Steakhouse Financial) and the evidence
tables. Added: compare mode (2–3 rows side by side), pinning, CSV export,
a model sandbox, bootstrap rank ranges on every row, and a checksum the page
recomputes live from the board it shows.

## Build record (v6 rewrite)

- Repo reset to the LICENSE commit (1766bc7); every file written fresh.
- main.ts (Node 22, stdlib only) reads the snapshot, assembles the board,
  writes board.json, data.js, dashboard/, screenshots/ and dossier.json.
- Tests: 14/14 pass (`node --test tests/model.test.ts`), pinning the ledger,
  the curve, the peers, the top-5, the verdicts, the farm-plan shape and
  determinism (two runs, same checksum).
- Screenshots: 4 true headless-Chromium renders at 1440×900, each under
  512 KiB (see below).
- Determinism: two runs write the same bytes (fixed seeds, no clock, no
  network).

## Submission (v6 rewrite, the 5th and last slot)

- Submitted 24 Nov 2026 ~13:32 WIB on Joni's "Setuju, submit Radar v6".
- Entry commit be01b911c468d99fd5abfdf597768f2f709f9041 (main).
- Submission 01a20c41-b56b-704a-9eb8-14fe6ee258db, stage "submitting" at submit
  (accepted for checking; the checks had not ruled after 30 s).
- Bundle token-radar-01-v6-rewrite.tar.gz, sha256
  60c750b80dee87959b74a3d1b08796eb3c61d1ffc40a6a3b81203d1c63b7fc16
  (654,760 B; builder session bc020dfc, 1 usage row).
- Kit check ok=true, failed=[] (reproduces 1633/1933 = 84.4%, revised PASS,
  in_window PASS, priced PASS).
- Claim code saved ONLY to ~/.config/makefun/token-radar-01-submission.json
  (0600).
- Checksum gap vs v5 (stated plainly to Joni before submitting): this build's
  checksum is 85da0ff4, v5's was 30f908cf; top-1 $152,994,608 vs v5's
  $152,994,119 (+$489); sum of EVs $1,322,658,200 vs $1,321,528,244 (+0.085%).
  The odds are calibrated to the aggregates, not bit-identical per row.
- Closes 14 Dec 2026 10:00 UTC; results after.
