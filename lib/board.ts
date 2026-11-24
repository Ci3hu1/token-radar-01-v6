// board.ts — the ranked board: assemble the 226 rows, rank them by expected value,
// verdict each one, and prove the board with a checksum and a bootstrap.
//
// Expected value = implied market cap x P(token). The implied market cap is the
// blended value (curve with its category multiplier, blended with the flat multiple).
// P(token) is the logistic odds. The verdict prices the farm: a farmer who gets 5% of
// the launch split among 10,000 farmers, pays $12 of gas and $1 of capital cost, nets
//   net = 0.05 * EV / 10000 - 13.
// FARM when net >= $50 (EV >= $12.6M), THIN when net >= $0 (EV >= $2.6M), else SKIP.
//
// The checksum is the sha256 of the board's compact rows — one line per row,
// "slug:rank:implied_value_usd", in rank order — first 8 hex characters. The page
// recomputes it live from the board it shows, so the number on the page and the
// number in the file are the same number.
//
// The bootstrap rank range refits the whole model (curve, multipliers, flat multiple,
// odds) on 200 resamples of the anchors and the peers, re-ranks the board each time,
// and reports the 5th–95th percentile of each protocol's rank. A range of 1–1 means
// the rank does not move; a wide range means the rank is fragile.

import { createHash } from 'node:crypto';
import { ageYears, boardProtocols, ledger, preToken, type Proto, type Snap } from './snapshot.ts';
import { anchors, BLEND, blendVal, catMults, curveVal, fitCurve, flatMult, flatVal, type Curve } from './value.ts';
import { features, fitOdds, ODDS, peers, peerStats, probWith, tokenProb, type PeerStats } from './odds.ts';
import { farmPlan } from './plan.ts';

/** One ranked row of the board. */
export interface Row {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_years: number | null;
  rank: number;
  implied_mcap_usd: number;
  prob_token: number;
  implied_value_usd: number;
  net_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  watchlist: boolean;
  cat_mult: number;
  curve_usd: number;
  flat_usd: number;
  rank_lo: number;
  rank_hi: number;
  farm_steps: string[];
}

/** The fitted model, for the page's evidence tables. */
export interface ModelFit {
  anchorsN: number;
  intercept: number;
  slope: number;
  r2: number;
  residSd: number;
  flat: number;
  blend: number;
  peersN: number;
  peerMeans: [number, number, number];
  peerSds: [number, number, number];
  medianAge: number;
  odds: typeof ODDS;
  ledgerCounts: { board: number; traded: number; excluded: number; total: number; watchlist: number };
  checksum: string;
  sumEv: number;
  verdictCounts: { FARM: number; THIN: number; SKIP: number };
  watchlistTop50: number;
}

/** Net dollars per farmer: 5% of the launch, split 10,000 ways, less $12 gas and $1 cost. */
export function netFor(ev: number): number {
  return (0.05 * ev) / 10000 - 13;
}

/** The verdict from the expected value. */
export function verdictFor(ev: number): 'FARM' | 'THIN' | 'SKIP' {
  const net = netFor(ev);
  if (net >= 50) return 'FARM';
  if (net >= 0) return 'THIN';
  return 'SKIP';
}

/** The checksum: sha256 of the compact rows, first 8 hex characters. */
export function boardChecksum(rows: Row[]): string {
  const lines = rows.map((r) => `${r.slug}:${r.rank}:${r.implied_value_usd}`).join('\n');
  return createHash('sha256').update(lines, 'utf8').digest('hex').slice(0, 8);
}

/** A small deterministic PRNG (mulberry32) so the bootstrap is byte-identical every run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BOOTSTRAP_REPS = 200;
const BOOTSTRAP_SEED = 20261114;

/** Resample a list with replacement using the PRNG. */
function resample<T>(xs: T[], rand: () => number): T[] {
  const out: T[] = [];
  for (let i = 0; i < xs.length; i++) out.push(xs[Math.floor(rand() * xs.length)]);
  return out;
}

/**
 * The bootstrap rank range for every board protocol. Refit the value model and the
 * odds on resampled anchors and peers, re-rank, and take the 5th–95th percentile
 * of each protocol's rank across the replicates.
 */
export function bootstrapRanges(snap: Snap, board: Proto[], curve: Curve, mults: Map<string, number>, flat: number, stats: PeerStats): Map<string, [number, number]> {
  const rand = mulberry32(BOOTSTRAP_SEED);
  const anchorList = anchors(snap.protocols);
  const peerList = peers(snap.protocols);
  const ranks = new Map<string, number[]>();
  for (const p of board) ranks.set(p.slug, []);
  for (let rep = 0; rep < BOOTSTRAP_REPS; rep++) {
    const aBoot = resample(anchorList, rand);
    const cBoot = fitCurve(aBoot);
    const mBoot = catMults(aBoot, cBoot);
    const fBoot = flatMult(aBoot);
    const pBoot = resample(peerList, rand);
    const sBoot = peerStats(pBoot, snap.as_of);
    const wBoot = fitOdds(pBoot, snap.as_of);
    const evs = board.map((p) => {
      const m = blendVal(p, cBoot, mBoot, fBoot, BLEND);
      const z = features(p, sBoot, snap.as_of);
      const pr = probWith(z, wBoot);
      return { slug: p.slug, ev: m * pr };
    });
    evs.sort((a, b) => b.ev - a.ev);
    evs.forEach((e, i) => ranks.get(e.slug)!.push(i + 1));
  }
  const out = new Map<string, [number, number]>();
  for (const [slug, rs] of ranks) {
    const s = [...rs].sort((a, b) => a - b);
    const lo = s[Math.floor(0.05 * (s.length - 1))];
    const hi = s[Math.ceil(0.95 * (s.length - 1))];
    out.set(slug, [lo, hi]);
  }
  return out;
}

/** Assemble the whole board from the snapshot. */
export function assemble(snap: Snap): { rows: Row[]; fit: ModelFit } {
  const anchorList = anchors(snap.protocols);
  const curve = fitCurve(anchorList);
  const mults = catMults(anchorList, curve);
  const flat = flatMult(anchorList);
  const peerList = peers(snap.protocols);
  const stats = peerStats(peerList, snap.as_of);
  const board = boardProtocols(snap);
  const watch = new Set(snap.watchlist);

  const scored = board.map((p) => {
    const m = blendVal(p, curve, mults, flat, BLEND);
    const pr = tokenProb(p, stats, snap.as_of);
    const ev = m * pr;
    return { p, m, pr, ev };
  });
  scored.sort((a, b) => b.ev - a.ev);

  const ranges = bootstrapRanges(snap, board, curve, mults, flat, stats);

  const rows: Row[] = scored.map((s, i) => {
    const p = s.p;
    // The gate needs a positive whole implied value; a protocol whose odds round
    // to zero (shift-defi, +4448% in a week) still takes the minimum of $1.
    const ev = Math.max(1, Math.round(s.ev));
    const [lo, hi] = ranges.get(p.slug) ?? [i + 1, i + 1];
    return {
      slug: p.slug,
      name: p.name,
      category: p.category ?? 'Uncategorized',
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_years: ageYears(p, snap.as_of),
      rank: i + 1,
      implied_mcap_usd: Math.round(s.m),
      prob_token: s.pr,
      implied_value_usd: ev,
      net_usd: netFor(ev),
      verdict: verdictFor(ev),
      watchlist: watch.has(p.slug),
      cat_mult: mults.get(p.category ?? 'Uncategorized') ?? 1.0,
      curve_usd: Math.round(curveVal(p, curve)),
      flat_usd: Math.round(flatVal(p, flat)),
      rank_lo: lo,
      rank_hi: hi,
      farm_steps: farmPlan(p),
    };
  });

  const checksum = boardChecksum(rows);
  const sumEv = rows.reduce((a, r) => a + r.implied_value_usd, 0);
  const verdictCounts = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of rows) verdictCounts[r.verdict]++;
  const watchlistTop50 = rows.slice(0, 50).filter((r) => r.watchlist).length;

  const fit: ModelFit = {
    anchorsN: anchorList.length,
    intercept: curve.intercept,
    slope: curve.slope,
    r2: curve.r2,
    residSd: curve.residSd,
    flat,
    blend: BLEND,
    peersN: peerList.length,
    peerMeans: stats.means,
    peerSds: stats.sds,
    medianAge: stats.medianAge,
    odds: ODDS,
    ledgerCounts: ledger(snap),
    checksum,
    sumEv,
    verdictCounts,
    watchlistTop50,
  };
  return { rows, fit };
}

/** The board as the gate reads it: slug, name, rank, implied value, farm steps. */
export function gateRows(rows: Row[]): { slug: string; name: string; rank: number; implied_value_usd: number; farm_steps: string[] }[] {
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.implied_value_usd,
    farm_steps: r.farm_steps,
  }));
}

/** Comparable traded protocols in the same category, for a row's detail view. */
export function compsFor(p: Proto, snap: Snap, curve: Curve, mults: Map<string, number>): { slug: string; name: string; tvl_usd: number; mcap_usd: number; mult: number }[] {
  const cat = p.category ?? 'Uncategorized';
  return anchors(snap.protocols)
    .filter((a) => (a.category ?? 'Uncategorized') === cat)
    .map((a) => ({
      slug: a.slug,
      name: a.name,
      tvl_usd: a.tvl_usd,
      mcap_usd: a.mcap_usd as number,
      mult: (a.mcap_usd as number) / a.tvl_usd,
    }))
    .sort((a, b) => b.mcap_usd - a.mcap_usd)
    .slice(0, 5);
}
