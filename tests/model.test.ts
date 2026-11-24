// model.test.ts — the fitted model, pinned to the numbers the snapshot produces.
// Run: node --test tests/model.test.ts  (Node 24 runs the .ts directly.)
// Every number below is a value the code derives from the sealed snapshot at run
// time; the test pins it so a regression in the fit is caught, not hidden.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSnap, ledger, boardProtocols, preToken } from '../lib/snapshot.ts';
import { anchors, fitCurve, catMults, flatMult, blendVal, BLEND } from '../lib/value.ts';
import { peers, peerStats, tokenProb, fitOdds, ODDS } from '../lib/odds.ts';
import { assemble, boardChecksum, verdictFor, netFor, gateRows } from '../lib/board.ts';
import { farmPlan } from '../lib/plan.ts';

const SNAP = '/home/hatch/workspace/tools/makefun/token-radar-01-v6-kit/input/snapshot.json';
const snap = readSnap(SNAP);

function close(actual: number, expected: number, tol: number, label: string): void {
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: got ${actual}, want ${expected} ± ${tol}`);
}

test('snapshot: the sealed file is what the field guide says', () => {
  assert.equal(snap.as_of, '2026-11-14');
  assert.equal(snap.floor_usd, 50_000_000);
  assert.equal(snap.protocols.length, 758);
  assert.equal(snap.watchlist.length, 40);
});

test('ledger: 226 board, 416 traded, 116 excluded', () => {
  const L = ledger(snap);
  assert.equal(L.board, 226);
  assert.equal(L.traded, 416);
  assert.equal(L.excluded, 116);
  assert.equal(L.total, 758);
  assert.equal(L.board + L.traded + L.excluded, 758);
});

test('board rule: the watchlist is covered and the versioned are out', () => {
  const board = boardProtocols(snap);
  const slugs = new Set(board.map((p) => p.slug));
  for (const w of snap.watchlist) assert.ok(slugs.has(w), `watchlist ${w} missing from the board`);
  assert.ok(!slugs.has('rysk-v12'), 'Rysk V12 is versioned and must be excluded');
  assert.ok(board.every((p) => preToken(p)), 'every board row records no token');
  assert.ok(board.every((p) => p.category !== 'CEX'), 'no CEX on the board');
});

test('value model: OLS on 128 anchors', () => {
  const al = anchors(snap.protocols);
  assert.equal(al.length, 128);
  const curve = fitCurve(al);
  close(curve.intercept, 3.0247, 0.0005, 'intercept');
  close(curve.slope, 0.5223, 0.0005, 'slope');
  close(curve.r2, 0.1939, 0.0005, 'R2');
  close(flatMult(al), 0.2138, 0.0005, 'flat multiple');
  assert.equal(BLEND, 0.28);
});

test('value model: category multipliers are shrunken and clamped', () => {
  const al = anchors(snap.protocols);
  const curve = fitCurve(al);
  const mults = catMults(al, curve);
  for (const [, m] of mults) {
    assert.ok(m >= 0.3 && m <= 3.0, `multiplier ${m} outside the 0.30–3.00 clamp`);
  }
  // Liquid Staking is the cheapest category, Privacy the dearest.
  assert.ok((mults.get('Liquid Staking') ?? 9) < 1, 'Liquid Staking below 1x');
  assert.ok((mults.get('Privacy') ?? 0) > 1, 'Privacy above 1x');
});

test('odds: 449 eligible peers and the fitted weights', () => {
  const pl = peers(snap.protocols);
  assert.equal(pl.length, 449);
  const stats = peerStats(pl, snap.as_of);
  assert.equal(stats.n, 449);
  close(stats.medianAge, 1.6235, 0.001, 'median age');
  // The refit lands near the constants the board uses.
  const refit = fitOdds(pl, snap.as_of);
  close(refit.bias, ODDS.bias, 0.06, 'odds bias');
  close(refit.logTvl, ODDS.logTvl, 0.06, 'odds logTvl');
  close(refit.age, ODDS.age, 0.12, 'odds age');
  close(refit.growth, ODDS.growth, 0.09, 'odds growth');
});

test('odds: steakhouse is the most likely top protocol', () => {
  const pl = peers(snap.protocols);
  const stats = peerStats(pl, snap.as_of);
  const sh = snap.protocols.find((p) => p.slug === 'steakhouse-financial')!;
  const pr = tokenProb(sh, stats, snap.as_of);
  close(pr, 0.7125, 0.002, 'P(steakhouse)');
});

test('board: 226 rows, ranked by expected value, top-1 steakhouse', () => {
  const { rows, fit } = assemble(snap);
  assert.equal(rows.length, 226);
  assert.equal(rows[0].slug, 'steakhouse-financial');
  assert.equal(rows[0].rank, 1);
  close(rows[0].implied_value_usd, 152_994_119, 2000, 'top-1 expected value');
  assert.deepEqual(fit.verdictCounts, { FARM: 20, THIN: 91, SKIP: 115 });
  assert.equal(fit.watchlistTop50, 34);
  assert.equal(fit.ledgerCounts.board, 226);
  // Ranks are 1..226 exactly once, and implied value does not rise with rank.
  const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < 226; i++) assert.equal(ranks[i], i + 1);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].implied_value_usd <= rows[i - 1].implied_value_usd, `row ${i + 1} rises above row ${i}`);
  }
  // The top five, in order.
  assert.deepEqual(rows.slice(0, 5).map((r) => r.slug), [
    'steakhouse-financial',
    'gauntlet',
    'usdd',
    'veda',
    'nonce-capital',
  ]);
});

test('board: verdict thresholds are the farm economics', () => {
  assert.equal(verdictFor(12_600_000), 'FARM');
  assert.equal(verdictFor(12_599_999), 'THIN');
  assert.equal(verdictFor(2_600_000), 'THIN');
  assert.equal(verdictFor(2_599_999), 'SKIP');
  close(netFor(152_994_119), 751.97, 0.01, 'net for the top-1');
});

test('board: every row carries a usable farm plan', () => {
  const { rows } = assemble(snap);
  for (const r of rows) {
    assert.ok(r.farm_steps.length >= 3 && r.farm_steps.length <= 12, `${r.slug}: ${r.farm_steps.length} steps`);
    for (const s of r.farm_steps) {
      const t = s.trim();
      assert.ok(t.length >= 20 && t.length <= 600, `${r.slug}: step ${t.length} chars`);
    }
  }
  // Plans differ by protocol (they name the protocol and its chain).
  const plans = new Set(rows.map((r) => r.farm_steps.join('|')));
  assert.ok(plans.size > 200, 'plans are mostly distinct');
});

test('board: gate rows are the shape the scorer reads', () => {
  const { rows } = assemble(snap);
  const gate = gateRows(rows);
  assert.equal(gate.length, 226);
  for (const g of gate) {
    assert.ok(g.slug && !/\s/.test(g.slug));
    assert.ok(g.name.length > 0);
    assert.ok(Number.isInteger(g.rank) && g.rank >= 1);
    assert.ok(Number.isInteger(g.implied_value_usd) && g.implied_value_usd > 0);
    assert.ok(g.farm_steps.length >= 3 && g.farm_steps.length <= 12);
  }
});

test('board: checksum is 8 hex chars and the run is deterministic', () => {
  const a = assemble(snap);
  const b = assemble(snap);
  assert.equal(a.fit.checksum, b.fit.checksum);
  assert.match(a.fit.checksum, /^[0-9a-f]{8}$/);
  assert.equal(a.fit.checksum, boardChecksum(a.rows));
  assert.equal(a.rows[0].implied_value_usd, b.rows[0].implied_value_usd);
});

test('board: bootstrap rank ranges are sane', () => {
  const { rows } = assemble(snap);
  const top = rows[0];
  assert.equal(top.rank_lo, 1);
  assert.equal(top.rank_hi, 1);
  for (const r of rows) {
    assert.ok(r.rank_lo >= 1 && r.rank_lo <= r.rank, `${r.slug}: lo ${r.rank_lo} above rank ${r.rank}`);
    assert.ok(r.rank_hi >= r.rank && r.rank_hi <= 226, `${r.slug}: hi ${r.rank_hi} out of range`);
  }
});

test('plan: a lending plan reads like lending, a bridge plan like a bridge', () => {
  const lending = snap.protocols.find((p) => p.category === 'Lending' && preToken(p))!;
  const bridge = snap.protocols.find((p) => p.category === 'Bridge' && preToken(p))!;
  const lp = farmPlan(lending).join(' ');
  const bp = farmPlan(bridge).join(' ');
  assert.ok(/lend|supply|borrow/i.test(lp), 'lending plan mentions lending');
  assert.ok(/bridge/i.test(bp), 'bridge plan mentions bridging');
  assert.ok(lp.includes(lending.name), 'plan names the protocol');
});
