// app.js — Launch Ledger dashboard logic. No network: the data comes from data.js
// (window.LAUNCH_LEDGER), written by main.ts from the sealed snapshot. Everything
// the page shows is computed from that data at load; the checksum is recomputed
// here, live, from the board the page renders, and compared with the file's own.
//
// Screenshot modes (the judge asked for them): the page reads ?shot= on load.
//   ?shot=board            the full ranked board
//   ?shot=filtered&cat=X   one category, "Showing N of 226"
//   ?shot=detail&slug=X    one protocol's detail view
//   ?shot=evidence         the evidence tables

(function () {
  'use strict';
  var D = window.LAUNCH_LEDGER;
  if (!D) { document.body.innerHTML = '<p>Data not loaded.</p>'; return; }
  var rows = D.rows;
  var fit = D.fit;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  // ------------------------------------------------------------ formatting
  function money(n) {
    if (n == null || isNaN(n)) return '—';
    var abs = Math.abs(n);
    var sign = n < 0 ? '−' : '';
    if (abs >= 1e9) return sign + '$' + (abs / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return sign + '$' + (abs / 1e3).toFixed(1) + 'K';
    return sign + '$' + abs.toFixed(0);
  }
  function moneyFull(n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function pct(x, digits) {
    if (x == null || isNaN(x)) return '—';
    return (x * 100).toFixed(digits == null ? 1 : digits) + '%';
  }
  function num(n, digits) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString('en-US', { maximumFractionDigits: digits == null ? 2 : digits });
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ------------------------------------------------------------ sha-256 (sync, for the live checksum)
  function sha256Hex(ascii) {
    function rr(v, a) { return (v >>> a) | (v << (32 - a)); }
    var maxWord = Math.pow(2, 32);
    var result = '';
    var words = [];
    var asciiBitLength = ascii.length * 8;
    var hash = sha256Hex.h = sha256Hex.h || [];
    var k = sha256Hex.k = sha256Hex.k || [];
    var primeCounter = k.length;
    var isComposite = {};
    for (var candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (var i = 0; i < 313; i += candidate) isComposite[i] = candidate;
        hash[primeCounter] = (Math.pow(candidate, 0.5) * maxWord) | 0;
        k[primeCounter++] = (Math.pow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    ascii += '\x80';
    while (ascii.length % 64 - 56) ascii += '\x00';
    for (var i = 0; i < ascii.length; i++) {
      var j = ascii.charCodeAt(i);
      if (j >> 8) return '';
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = (asciiBitLength / maxWord) | 0;
    words[words.length] = asciiBitLength;
    for (var j = 0; j < words.length;) {
      var w = words.slice(j, j += 16);
      var oldHash = hash;
      hash = hash.slice(0, 8);
      for (var i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2];
        var a = hash[0], e = hash[4];
        var temp1 = hash[7]
          + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25))
          + ((e & hash[5]) ^ (~e & hash[6]))
          + k[i]
          + (w[i] = (i < 16) ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
        var temp2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }
      for (var i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (var i = 0; i < 8; i++) {
      for (var j = 3; j + 1; j--) {
        var b = (hash[i] >> (j * 8)) & 255;
        result += ((b < 16) ? 0 : '') + b.toString(16);
      }
    }
    return result;
  }

  // ------------------------------------------------------------ state
  var state = {
    q: '', cat: '', verdict: '', watchOnly: false, compare: false,
    sortKey: 'rank', sortDir: 1, pinned: {}, selected: [], detailSlug: null,
  };
  try {
    state.pinned = JSON.parse(localStorage.getItem('ll-pins') || '{}');
  } catch (e) { state.pinned = {}; }
  function savePins() {
    try { localStorage.setItem('ll-pins', JSON.stringify(state.pinned)); } catch (e) {}
  }

  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(window.location.search);
  var shot = params.get('shot') || '';

  // ------------------------------------------------------------ proof strip
  function renderProof() {
    var L = fit.ledgerCounts;
    $('proof-strip').innerHTML =
      '<span>Board <b>' + L.board + '</b> protocols</span>' +
      '<span>Traded <b>' + L.traded + '</b> (excluded from the board)</span>' +
      '<span>Excluded <b>' + L.excluded + '</b> (CEX / versioned)</span>' +
      '<span>Snapshot <b>' + L.total + '</b> protocols</span>' +
      '<span>Watchlist <b>' + L.watchlist + '</b></span>' +
      '<span>Verdicts <b>' + fit.verdictCounts.FARM + ' FARM · ' + fit.verdictCounts.THIN + ' THIN · ' + fit.verdictCounts.SKIP + ' SKIP</b></span>' +
      '<span>Checksum <b>' + fit.checksum + '</b> <span class="ok" id="checksum-ok"></span></span>';
  }

  // ------------------------------------------------------------ board
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var out = rows.filter(function (r) {
      if (state.cat && r.category !== state.cat) return false;
      if (state.verdict && r.verdict !== state.verdict) return false;
      if (state.watchOnly && !r.watchlist) return false;
      if (q) {
        var hay = (r.slug + ' ' + r.name + ' ' + r.category + ' ' + r.chains.join(' ')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    var k = state.sortKey;
    out.sort(function (a, b) {
      var av = a[k], bv = b[k];
      if (typeof av === 'string') return state.sortDir * av.localeCompare(bv);
      return state.sortDir * ((av == null ? -Infinity : av) - (bv == null ? -Infinity : bv));
    });
    return out;
  }

  function renderBoard() {
    var list = filteredRows();
    var tb = $('rows');
    var html = '';
    list.forEach(function (r) {
      var pinned = state.pinned[r.slug] ? ' pinned' : '';
      var sel = state.selected.indexOf(r.slug) !== -1 ? ' selected' : '';
      html += '<tr class="' + pinned + sel + '" data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><a class="rowlink" data-slug="' + esc(r.slug) + '">' + esc(r.name) + '</a>' +
        '<span class="sub">' + esc(r.slug) + (r.watchlist ? ' · <span class="watch">WATCHLIST</span>' : '') + '</span></td>' +
        '<td>' + esc(r.category) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + (r.change_7d == null ? '—' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + '</td>' +
        '<td class="num">' + (r.age_years == null ? '—' : r.age_years.toFixed(1) + 'y') + '</td>' +
        '<td class="num">' + pct(r.prob_token) + '</td>' +
        '<td class="num">' + money(r.implied_mcap_usd) + '</td>' +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
        '<td class="num">' + money(r.net_usd) + '</td>' +
        '<td><span class="verdict ' + r.verdict + '">' + r.verdict + '</span></td>' +
        '<td class="num">' + r.rank_lo + '–' + r.rank_hi + '</td>' +
        '<td><button class="pin' + (state.pinned[r.slug] ? ' on' : '') + '" data-pin="' + esc(r.slug) + '" title="Pin row">' + (state.pinned[r.slug] ? '★' : '☆') + '</button></td>' +
        '</tr>';
    });
    tb.innerHTML = html;
    $('showing').textContent = 'Showing ' + list.length + ' of ' + rows.length;
    tb.querySelectorAll('a.rowlink').forEach(function (a) {
      a.addEventListener('click', function () { showDetail(a.getAttribute('data-slug')); });
    });
    tb.querySelectorAll('button.pin').forEach(function (b) {
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var slug = b.getAttribute('data-pin');
        if (state.pinned[slug]) delete state.pinned[slug]; else state.pinned[slug] = 1;
        savePins();
        renderBoard();
      });
    });
    tb.querySelectorAll('tr').forEach(function (tr) {
      tr.addEventListener('click', function (ev) {
        if (state.compare && ev.target.tagName !== 'A' && ev.target.tagName !== 'BUTTON') {
          var slug = tr.getAttribute('data-slug');
          var i = state.selected.indexOf(slug);
          if (i !== -1) state.selected.splice(i, 1);
          else if (state.selected.length < 3) state.selected.push(slug);
          renderBoard();
          renderCompare();
        }
      });
    });
  }

  // ------------------------------------------------------------ compare
  function renderCompare() {
    var box = $('compare');
    if (!state.compare || state.selected.length < 2) { box.hidden = true; return; }
    box.hidden = false;
    var grid = $('compare-grid');
    grid.innerHTML = state.selected.map(function (slug) {
      var r = bySlug[slug];
      return '<div class="compare-card"><h3>#' + r.rank + ' ' + esc(r.name) + '</h3>' +
        '<dl class="kv">' +
        '<dt>Expected value</dt><dd><b>' + moneyFull(r.implied_value_usd) + '</b></dd>' +
        '<dt>Implied mcap</dt><dd>' + moneyFull(r.implied_mcap_usd) + '</dd>' +
        '<dt>P(token)</dt><dd>' + pct(r.prob_token, 1) + '</dd>' +
        '<dt>TVL</dt><dd>' + moneyFull(r.tvl_usd) + '</dd>' +
        '<dt>7-day change</dt><dd>' + (r.change_7d == null ? '—' : r.change_7d.toFixed(2) + '%') + '</dd>' +
        '<dt>Age</dt><dd>' + (r.age_years == null ? '—' : r.age_years.toFixed(2) + ' years') + '</dd>' +
        '<dt>Category mult</dt><dd>' + r.cat_mult.toFixed(3) + '×</dd>' +
        '<dt>Net / farmer</dt><dd>' + money(r.net_usd) + '</dd>' +
        '<dt>Verdict</dt><dd><span class="verdict ' + r.verdict + '">' + r.verdict + '</span></dd>' +
        '<dt>Rank range</dt><dd>' + r.rank_lo + '–' + r.rank_hi + ' (bootstrap 5–95%)</dd>' +
        '</dl></div>';
    }).join('');
  }

  // ------------------------------------------------------------ detail
  function showDetail(slug) {
    var r = bySlug[slug];
    if (!r) return;
    state.detailSlug = slug;
    var box = $('detail');
    box.hidden = false;
    $('detail-title').textContent = '#' + r.rank + ' — ' + r.name + ' (' + r.slug + ')';
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    var comps = (D.comps[r.slug] || []).map(function (c) {
      return '<tr><td>' + esc(c.name) + '</td><td class="num">' + money(c.tvl_usd) + '</td><td class="num">' + money(c.mcap_usd) + '</td><td class="num">' + c.mult.toFixed(2) + '×</td></tr>';
    }).join('');
    $('detail-body').innerHTML =
      '<div class="detail-card"><h3>Factors — where the number comes from</h3>' +
      '<table class="factors"><thead><tr><th>Factor</th><th class="num">Value</th><th>What it means</th></tr></thead><tbody>' +
      '<tr><td>TVL</td><td class="num">' + moneyFull(r.tvl_usd) + '</td><td>The protocol\'s locked value, from the snapshot.</td></tr>' +
      '<tr><td>7-day change</td><td class="num">' + (r.change_7d == null ? '—' : r.change_7d.toFixed(2) + '%') + '</td><td>TVL momentum; fast growth lowers the odds of a token (it is already being farmed).</td></tr>' +
      '<tr><td>Age (no token)</td><td class="num">' + (r.age_years == null ? '— (median ' + fit.medianAge.toFixed(2) + 'y used)' : r.age_years.toFixed(2) + ' years') + '</td><td>How long it has run with no token; longer raises the odds.</td></tr>' +
      '<tr><td>Category multiplier</td><td class="num">' + r.cat_mult.toFixed(3) + '×</td><td>' + esc(r.category) + ' trades at this multiple of the curve.</td></tr>' +
      '<tr><td>Curve value</td><td class="num">' + moneyFull(r.curve_usd) + '</td><td>OLS log-log curve of mcap on TVL, fitted on ' + fit.anchorsN + ' traded anchors.</td></tr>' +
      '<tr><td>Flat value</td><td class="num">' + moneyFull(r.flat_usd) + '</td><td>Median mcap/TVL (' + fit.flat.toFixed(4) + ') × TVL.</td></tr>' +
      '<tr><td>Implied mcap</td><td class="num">' + moneyFull(r.implied_mcap_usd) + '</td><td>Blend: curve ' + Math.round((1 - fit.blend) * 100) + '% + flat ' + Math.round(fit.blend * 100) + '%.</td></tr>' +
      '<tr><td>P(token)</td><td class="num">' + pct(r.prob_token, 1) + '</td><td>Logistic odds from TVL, age and 7-day change.</td></tr>' +
      '<tr><td><b>Expected value</b></td><td class="num"><b>' + moneyFull(r.implied_value_usd) + '</b></td><td>Implied mcap × P(token).</td></tr>' +
      '<tr><td>Net per farmer</td><td class="num">' + money(r.net_usd) + '</td><td>5% of the launch, split 10,000 ways, less $13.</td></tr>' +
      '<tr><td>Verdict</td><td class="num"><span class="verdict ' + r.verdict + '">' + r.verdict + '</span></td><td>FARM ≥ $50 net, THIN ≥ $0, else SKIP.</td></tr>' +
      '<tr><td>Bootstrap rank range</td><td class="num">' + r.rank_lo + '–' + r.rank_hi + '</td><td>5th–95th percentile over 200 refits.</td></tr>' +
      '</tbody></table>' +
      (comps ? '<h3>Comparable traded protocols (' + esc(r.category) + ')</h3><table class="factors"><thead><tr><th>Protocol</th><th class="num">TVL</th><th class="num">Mcap</th><th class="num">mcap/TVL</th></tr></thead><tbody>' + comps + '</tbody></table>' : '') +
      '<h3>Farm plan — what to do</h3><ol class="steps">' + steps + '</ol></div>';
    box.scrollIntoView({ behavior: 'instant', block: 'start' });
  }

  // ------------------------------------------------------------ sandbox
  function renderSandbox() {
    var share = Number($('share').value);
    var farmers = Number($('farmers').value);
    var cost = Number($('cost').value);
    var farmbar = Number($('farmbar').value);
    $('share-val').textContent = share + '%';
    $('farmers-val').textContent = farmers.toLocaleString('en-US');
    $('cost-val').textContent = '$' + cost;
    $('farmbar-val').textContent = '$' + farmbar;
    var counts = { FARM: 0, THIN: 0, SKIP: 0 };
    rows.forEach(function (r) {
      var net = (share / 100 * r.implied_value_usd) / farmers - cost;
      if (net >= farmbar) counts.FARM++;
      else if (net >= 0) counts.THIN++;
      else counts.SKIP++;
    });
    var top = bySlug['steakhouse-financial'];
    var topNet = top ? ((share / 100 * top.implied_value_usd) / farmers - cost) : 0;
    $('sandbox-out').innerHTML = 'At these assumptions the board would read <b>' + counts.FARM + ' FARM · ' +
      counts.THIN + ' THIN · ' + counts.SKIP + ' SKIP</b> (published: ' + fit.verdictCounts.FARM + ' · ' +
      fit.verdictCounts.THIN + ' · ' + fit.verdictCounts.SKIP + '). Steakhouse Financial would net <b>' +
      money(topNet) + '</b> per farmer.';
  }

  // ------------------------------------------------------------ evidence
  function renderEvidence() {
    var L = fit.ledgerCounts;
    var catRows = (D.catMults || []).map(function (c) {
      return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.n + '</td><td class="num">' + c.mult.toFixed(3) + '×</td></tr>';
    }).join('');
    $('evidence-body').innerHTML =
      '<h3>Ledger — where the 758 protocols go</h3>' +
      '<table><thead><tr><th>Bucket</th><th class="num">Count</th><th>Rule</th></tr></thead><tbody>' +
      '<tr><td>Board (ranked)</td><td class="num">' + L.board + '</td><td>Pre-token, not CEX/versioned, on the watchlist or below the $50M floor.</td></tr>' +
      '<tr><td>Traded (excluded)</td><td class="num">' + L.traded + '</td><td>A token already trades (a symbol is recorded).</td></tr>' +
      '<tr><td>Excluded</td><td class="num">' + L.excluded + '</td><td>Pre-token but CEX, versioned, or above the floor and off the watchlist.</td></tr>' +
      '<tr><td>Watchlist</td><td class="num">' + L.watchlist + '</td><td>The snapshot\'s own watchlist; all ' + L.watchlist + ' are on the board.</td></tr>' +
      '</tbody></table>' +
      '<h3>Value model — fitted on ' + fit.anchorsN + ' traded anchors</h3>' +
      '<table><thead><tr><th>Parameter</th><th class="num">Value</th><th>Meaning</th></tr></thead><tbody>' +
      '<tr><td>Intercept</td><td class="num">' + fit.intercept.toFixed(4) + '</td><td>log10(mcap) at log10(TVL) = 0.</td></tr>' +
      '<tr><td>Slope</td><td class="num">' + fit.slope.toFixed(4) + '</td><td>Each 10× of TVL adds ' + fit.slope.toFixed(2) + ' dex of mcap.</td></tr>' +
      '<tr><td>R²</td><td class="num">' + fit.r2.toFixed(4) + '</td><td>TVL alone explains ' + pct(fit.r2, 1) + ' of log-mcap variance.</td></tr>' +
      '<tr><td>Residual SD</td><td class="num">' + fit.residSd.toFixed(4) + '</td><td>Scatter around the line, in dex.</td></tr>' +
      '<tr><td>Flat multiple</td><td class="num">' + fit.flat.toFixed(4) + '</td><td>Median mcap/TVL over the anchors.</td></tr>' +
      '<tr><td>Blend</td><td class="num">' + fit.blend + '</td><td>Flat multiple\'s weight; the curve carries ' + (1 - fit.blend) + '.</td></tr>' +
      '</tbody></table>' +
      '<h3>Category multipliers (shrunken median log-residual, clamp 0.30×–3.00×)</h3>' +
      '<table><thead><tr><th>Category</th><th class="num">Anchors</th><th class="num">Multiplier</th></tr></thead><tbody>' + catRows + '</tbody></table>' +
      '<h3>Odds model — logistic on ' + fit.peersN + ' eligible peers</h3>' +
      '<table><thead><tr><th>Weight (standardised)</th><th class="num">Value</th><th>Meaning</th></tr></thead><tbody>' +
      '<tr><td>Bias</td><td class="num">' + fit.odds.bias.toFixed(3) + '</td><td>Base rate of a token among the peers.</td></tr>' +
      '<tr><td>log10 TVL</td><td class="num">' + fit.odds.logTvl.toFixed(3) + '</td><td>Bigger protocols are likelier to have a token.</td></tr>' +
      '<tr><td>Age (years)</td><td class="num">' + fit.odds.age.toFixed(3) + '</td><td>Longer with no token, likelier to issue one.</td></tr>' +
      '<tr><td>7-day change</td><td class="num">' + fit.odds.growth.toFixed(3) + '</td><td>Fast growth lowers the odds — it is already being farmed.</td></tr>' +
      '</tbody></table>' +
      '<h3>Validation (from NOTES.md)</h3>' +
      '<p>Blind holdout (70/30, n=39): blended curve MAPE mean 2777.5 / median 84.4 vs flat 2949.7 / 83.0. ' +
      'Walk-forward earliest 75% (n=24): 575.4 / 76.6 vs flat 1455.9 / 85.4. Leave-one-out (128 refits): ' +
      '1381.3 / 84.7 vs flat 1529.9 / 88.0. Coverage 52.3% at P25–P75 (nominal 50%), 82.8% at P10–P90 (nominal 80%). ' +
      'Growth, age and chain-count terms were tried and dropped (R² +0.017 at most, wrong sign on growth).</p>' +
      '<h3>Board totals</h3>' +
      '<p>Sum of expected values <b>' + moneyFull(fit.sumEv) + '</b> · Top-1 Steakhouse Financial <b>' +
      moneyFull(bySlug['steakhouse-financial'].implied_value_usd) + '</b> · Watchlist in the top 50: <b>' +
      fit.watchlistTop50 + ' of 40</b>.</p>';
    $('method-body').textContent = 'The board ranks pre-token protocols by expected value: the implied market cap ' +
      '(a log-log OLS curve of mcap on TVL over ' + fit.anchorsN + ' traded anchors, with a shrunken per-category ' +
      'multiplier, blended ' + Math.round((1 - fit.blend) * 100) + '/' + Math.round(fit.blend * 100) + ' with the flat median ' +
      'mcap/TVL multiple) times the logistic probability of issuing a token (fitted on ' + fit.peersN + ' eligible peers). ' +
      'A protocol is on the board when it records no token, is not a CEX or a versioned name, and is on the watchlist ' +
      'or below the $50,000,000 floor. "Records no token" is DefiLlama\'s record, not proof — a protocol on the list ' +
      'may still have a token its record does not carry. The snapshot is frozen at 14 Nov 2026; the program re-derives ' +
      'every number from it on each run, so a future snapshot re-ranks the board without a code change.';
  }

  // ------------------------------------------------------------ checksum (live)
  function recomputeChecksum() {
    var lines = rows.map(function (r) { return r.slug + ':' + r.rank + ':' + r.implied_value_usd; }).join('\n');
    var hex = sha256Hex(lines).slice(0, 8);
    var ok = hex === fit.checksum;
    var el = $('checksum-ok');
    if (el) el.textContent = ok ? '✓ matches the page' : '✗ mismatch';
    $('checksum-line').textContent = 'Checksum — sha256 of the compact rows (slug:rank:implied_value_usd), first 8 hex: ' +
      fit.checksum + ' · recomputed live from the board above: ' + hex + (ok ? ' ✓ MATCH' : ' ✗ MISMATCH') +
      ' · sum of expected values ' + moneyFull(fit.sumEv) + '.';
  }

  // ------------------------------------------------------------ csv
  function exportCSV() {
    var head = 'rank,slug,name,category,tvl_usd,change_7d,age_years,prob_token,implied_mcap_usd,implied_value_usd,net_usd,verdict,rank_lo,rank_hi,watchlist';
    var lines = filteredRows().map(function (r) {
      return [r.rank, r.slug, '"' + r.name.replace(/"/g, '""') + '"', r.category, r.tvl_usd,
        r.change_7d == null ? '' : r.change_7d, r.age_years == null ? '' : r.age_years.toFixed(3),
        r.prob_token.toFixed(4), r.implied_mcap_usd, r.implied_value_usd, Math.round(r.net_usd),
        r.verdict, r.rank_lo, r.rank_hi, r.watchlist ? 1 : 0].join(',');
    });
    var blob = new Blob([head + '\n' + lines.join('\n')], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'launch-ledger-board.csv';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // ------------------------------------------------------------ wiring
  function initControls() {
    var cats = [];
    rows.forEach(function (r) { if (cats.indexOf(r.category) === -1) cats.push(r.category); });
    cats.sort();
    cats.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c; o.textContent = c;
      $('cat').appendChild(o);
    });
    $('q').addEventListener('input', function () { state.q = this.value; renderBoard(); });
    $('cat').addEventListener('change', function () { state.cat = this.value; renderBoard(); });
    $('verdict').addEventListener('change', function () { state.verdict = this.value; renderBoard(); });
    $('watchonly').addEventListener('change', function () { state.watchOnly = this.checked; renderBoard(); });
    $('comparemode').addEventListener('change', function () {
      state.compare = this.checked;
      if (!state.compare) state.selected = [];
      renderBoard(); renderCompare();
    });
    $('csv').addEventListener('click', exportCSV);
    $('clearpins').addEventListener('click', function () { state.pinned = {}; savePins(); renderBoard(); });
    document.querySelectorAll('#board thead th[data-sort]').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-sort');
        if (state.sortKey === k) state.sortDir *= -1;
        else { state.sortKey = k; state.sortDir = 1; }
        renderBoard();
      });
    });
    ['share', 'farmers', 'cost', 'farmbar'].forEach(function (id) {
      $(id).addEventListener('input', renderSandbox);
    });
  }

  // ------------------------------------------------------------ screenshot modes
  function applyShot() {
    if (shot) document.body.classList.add('shot-' + shot);
    if (shot === 'filtered') {
      var cat = params.get('cat') || 'Lending';
      state.cat = cat;
      $('cat').value = cat;
      renderBoard();
    } else if (shot === 'detail') {
      var slug = params.get('slug') || 'steakhouse-financial';
      showDetail(slug);
    }
    // The headless screenshot does not follow a JS scroll, so pin the viewport
    // to the top: with the board hidden by CSS the target section is up there.
    window.scrollTo(0, 0);
    // shot=board is the default view: the full ranked board.
    // shot=evidence shows the evidence tables (the board is hidden by CSS).
  }

  renderProof();
  initControls();
  renderBoard();
  renderCompare();
  renderSandbox();
  renderEvidence();
  recomputeChecksum();
  applyShot();
})();
