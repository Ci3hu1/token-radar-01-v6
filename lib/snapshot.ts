// snapshot.ts — the sealed DefiLlama snapshot: types, loading, and the board's ledger.
// Everything here is read from the snapshot's own figures. Nothing is hardcoded about
// any protocol by name; the board rule is the watchlist rule the snapshot's README states.

import { readFileSync } from 'node:fs';

export interface Proto {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snap {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Proto[];
  watchlist: string[];
}

/** Read and parse the snapshot. The file is sealed; this only reads it. */
export function readSnap(path: string): Snap {
  const raw = readFileSync(path, 'utf8');
  const data = JSON.parse(raw) as Snap;
  return data;
}

/** A protocol records no token when DefiLlama carries neither a symbol nor a gecko id. */
export function preToken(p: Proto): boolean {
  return p.symbol === null && p.gecko_id === null;
}

/** A protocol whose token already trades (a symbol is recorded). */
export function traded(p: Proto): boolean {
  return p.symbol !== null;
}

/**
 * The version marker the watchlist rule excludes: a space followed by V2, v2, 2.0 or the like,
 * at the end of the name. The snapshot's README gives the pattern.
 */
const VERSION_MARK = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export function versioned(p: Proto): boolean {
  return VERSION_MARK.test(p.name ?? '');
}

/** A wrapped / staked / bridged product of a token that already trades. */
export function wrappedProduct(p: Proto): boolean {
  return p.category === 'CEX' || versioned(p);
}

/**
 * Whether a pre-token protocol belongs on the ranked board. The watchlist is the floor, never
 * the ceiling: a protocol on it is in, and so is an eligible protocol below the floor.
 * Ineligible: a CEX, or a name ending in a version marker.
 */
export function boardEligible(p: Proto, watch: Set<string>, floor: number): boolean {
  if (!preToken(p)) return false;
  if (wrappedProduct(p)) return false;
  return watch.has(p.slug) || p.tvl_usd < floor;
}

/** The ledger: how the 758 protocols split into board / traded / excluded. */
export interface Ledger {
  board: number;
  traded: number;
  excluded: number;
  total: number;
  watchlist: number;
}

export function ledger(snap: Snap): Ledger {
  const watch = new Set(snap.watchlist);
  let board = 0;
  let tradedN = 0;
  let excluded = 0;
  for (const p of snap.protocols) {
    if (traded(p)) {
      tradedN++;
    } else if (boardEligible(p, watch, snap.floor_usd)) {
      board++;
    } else {
      excluded++;
    }
  }
  return { board, traded: tradedN, excluded, total: snap.protocols.length, watchlist: snap.watchlist.length };
}

/** The board's protocols, in the snapshot's own slug order. */
export function boardProtocols(snap: Snap): Proto[] {
  const watch = new Set(snap.watchlist);
  return snap.protocols.filter((p) => boardEligible(p, watch, snap.floor_usd));
}

/** Age in years from the snapshot's as-of date to the day DefiLlama began tracking a protocol. */
export function ageYears(p: Proto, asOf: string): number | null {
  if (!p.listed_at) return null;
  const [ay, am, ad] = asOf.split('-').map(Number);
  const [ly, lm, ld] = p.listed_at.split('-').map(Number);
  const a = Date.UTC(ay, am - 1, ad);
  const b = Date.UTC(ly, lm - 1, ld);
  return (a - b) / (365.25 * 86400000);
}
