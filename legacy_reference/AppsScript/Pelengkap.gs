/* Pelengkap v6 — fungsi yang dipanggil backend tetapi tidak ditemukan di project.
   AMAN: kalau fungsi aslinya ternyata ada di file lain, versi asli yang dipakai (file ini tidak menimpa). */

/** Rincian mingguan per TYPE: SELL THRU & SELL OUT (dipakai apiDashboard → menu Brand). */
var weeklyPair_ = (typeof weeklyPair_ === 'function') ? weeklyPair_ : function (source, period, ids, u) {
  var db = coverageView_(source, period, ids, 'PAIR', u);
  var cov = db.coverage[period];
  if (!cov || db.noData || db.missingST || db.missingSO || !db.stock) return { available: false };
  var cutoff = cov.cutoff, cutDay = +cutoff.slice(8), lastDay = +PortalCore.end(period).slice(8);
  var weeks = [1, 2, 3, 4, 5].map(function (w) {
    var from = (w - 1) * 7 + 1, to = w === 5 ? lastDay : Math.min(w * 7, lastDay);
    return { week: w, from: from, to: to, future: from > cutDay || from > lastDay };
  });
  var idx = function (date) { return Math.min(5, Math.ceil(+date.slice(8) / 7)) - 1; };
  var types = {};
  var slot = function (brand, type) {
    var k = PortalCore.key([brand, type]);
    return types[k] || (types[k] = { brand: brand, type: type, st: [0, 0, 0, 0, 0], so: [0, 0, 0, 0, 0] });
  };
  (db.cubes[period] || []).forEach(function (r) {
    if (!r.q || r.date > cutoff) return;
    slot(r.brand, r.type).st[idx(r.date)] += r.q;
  });
  var set = {};
  ids.forEach(function (id) { set[id] = true; });
  (db.stock.moves || []).forEach(function (t) {
    if (!t.outQty || t.date.slice(0, 7) !== period || t.date > cutoff) return;
    if (!StockCore.canSee(db, ids, t.customer)) return;
    var p = db.meta.products[t.sku];
    if (!p || !p.device) return;
    slot(p.brand, p.type || p.nama || t.sku).so[idx(t.date)] += t.outQty;
  });
  return { available: true, cutoff: cutoff, weeks: weeks, types: Object.keys(types).map(function (k) { return types[k]; }) };
};

/** DOS per Big Region untuk role puncak (Head of Sales ke atas). */
var aggregateBigDOS_ = (typeof aggregateBigDOS_ === 'function') ? aggregateBigDOS_ : function (r) {
  var groups = {};
  (r.rows || []).forEach(function (x) { (groups[x.big] || (groups[x.big] = [])).push(x); });
  return Object.keys(groups).sort().map(function (big) {
    var it = groups[big];
    var stock = it.reduce(function (n, x) { return n + x.stock; }, 0);
    var sellout = it.reduce(function (n, x) { return n + x.sellout; }, 0);
    var bad = it.filter(function (x) { return x.status === 'PERLU CEK DATA'; }).length;
    var avg = r.windowReady ? sellout / 30 : null;
    var dealers = {};
    it.forEach(function (x) { dealers[x.customer] = true; });
    return {
      big: big, region: big, stock: stock, sellout: sellout, avg: avg,
      dos: r.covered && !bad && avg > 0 ? stock / avg : null,
      dealerCount: Object.keys(dealers).length, typeCount: it.length,
      low: it.filter(function (x) { return x.status === 'MENIPIS' || x.status === 'HABIS'; }).length, bad: bad
    };
  });
};
