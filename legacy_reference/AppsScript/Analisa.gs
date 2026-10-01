/* Analisa v6 — Early Warning (menu Tim) + menu Analisa (Cross-sell, Reaktivasi, Dealer Baru).
   File BARU. Hanya MEMBACA data publikasi; tidak mengubah spreadsheet, target, atau transaksi. */

function anaPrev_(p, n) { var d = new Date(Date.UTC(+p.slice(0, 4), +p.slice(5, 7) - 1 - (n || 1), 1)); return d.toISOString().slice(0, 7); }
function anaCtx_(token, period, selection) {
  var source = snapshot_(), u = guard_(token, false, false, source), ids = allowed_(source, u, selection);
  var db = coverageView_(source, period, ids, 'ST', u);
  var cov = db.coverage[period]; if (!cov) throw Error('Periode belum tersedia.');
  var people = {}; db.meta.people.forEach(function (p) { people[p.nik] = p; });
  return { source: source, u: u, ids: ids, db: db, cutoff: cov.cutoff, closed: !!cov.closed, people: people };
}
function anaDeviceBrands_(meta) {
  var s = {}; Object.keys(meta.products).forEach(function (k) { var p = meta.products[k]; if (p.device) s[p.brand] = true; });
  return Object.keys(s).sort();
}
function anaMonths_(db, period, count) {
  var out = []; for (var i = count - 1; i >= 0; i--) { var p = i ? anaPrev_(period, i) : period; if (db.cubes[p] || p === period) out.push(p); }
  return out;
}

/* ---------- EARLY WARNING (menu Tim, ikut filter Tim) ---------- */
function apiEarlyWarning(token, period, level, brand, metric, selection, filters) {
  var c = anaCtx_(token, period, selection), db = c.db, u = c.u, meta = db.meta;
  level = String(level || 'SALES'); brand = String(brand || 'ALL'); metric = String(metric || 'QTY'); filters = filters || {};
  var area = level === 'BIG REGION' || level === 'REGION';
  if (['SALES', 'ASM', 'RGM', 'BIG REGION', 'REGION'].indexOf(level) < 0 || ['QTY', 'DA', 'NOO'].indexOf(metric) < 0) throw Error('Pilihan tidak valid.');
  if (u.role === 'SALES' && level !== 'SALES') throw Error('Tingkat tidak diizinkan.');
  if (!area && u.role !== 'SALES' && PortalCore.LEVEL[level] >= PortalCore.LEVEL[u.role]) throw Error('Tingkat tidak diizinkan.');
  var big = String(filters.big || 'ALL'), region = String(filters.region || 'ALL'), sub = String(filters.sub || 'ALL');
  var salesP = meta.people.filter(function (p) { return c.ids.indexOf(p.nik) >= 0 && p.sales; }).filter(function (p) {
    var r = p.portfolio || p.region; return (big === 'ALL' || p.wilayah === big) && (region === 'ALL' || r === region) && (sub === 'ALL' || r === sub); });
  var salesIds = salesP.map(function (p) { return p.nik; });
  var groups = [];
  if (area) {
    var buckets = {};
    salesP.forEach(function (p) { var name = level === 'BIG REGION' ? (p.wilayah || 'LAINNYA') : (p.portfolio || p.region || 'LAINNYA'); (buckets[name] = buckets[name] || []).push(p); });
    Object.keys(buckets).sort().forEach(function (name) {
      var f = buckets[name][0];
      groups.push({ nik: 'AREA:' + name, nama: name, role: level, region: level === 'BIG REGION' ? 'Nasional' : (f.wilayah || ''), big: '', boss: level === 'BIG REGION' ? 'Nasional' : (f.wilayah || '—'), bossRole: level === 'BIG REGION' ? 'Cakupan' : 'Big Region', team: buckets[name].map(function (p) { return p.nik; }) });
    });
  } else meta.people.forEach(function (p) {
    if (level === 'SALES' ? salesIds.indexOf(p.nik) < 0 : p.role !== level) return;
    var team = level === 'SALES' ? [p.nik] : PortalCore.scope(meta.people, p.nik).filter(function (id) { return salesIds.indexOf(id) >= 0; });
    if (!team.length) return;
    var boss = c.people[p.atasan];
    groups.push({ nik: p.nik, nama: p.nama, role: p.role, region: p.portfolio || p.region || '', big: p.wilayah || '', boss: boss ? boss.nama : '—', bossRole: boss ? boss.role : '', team: team });
  });
  var brands = anaDeviceBrands_(meta), wk = anaWork_(period, c.cutoff, c.closed), days = wk.days, run = wk.run;
  var last7 = wk.runDates.slice(-7);
  var rows = groups.map(function (g) {
    var slice = PortalCore.slice(db, period, g.team), m = PortalCore.metrics(slice, db, period, brand);
    var actual = metric === 'QTY' ? m.qty : metric === 'DA' ? m.da : m.noo;
    var t = PortalCore.target(meta, period, g.team, brand, metric);
    if (brand === 'ALL' && !t.exists) {
      var parts = brands.map(function (b) { return PortalCore.target(meta, period, g.team, b, metric); });
      t = { value: parts.reduce(function (n, x) { return n + x.value; }, 0), exists: parts.some(function (x) { return x.exists; }), missing: [] };
      parts.forEach(function (x) { (x.missing || []).forEach(function (id) { if (t.missing.indexOf(id) < 0) t.missing.push(id); }); });
    }
    var daily = last7.map(function (dt) { return slice.filter(function (r) { return r.date === dt && (brand === 'ALL' || r.brand === brand); }).reduce(function (n, r) { return n + r.q; }, 0); });
    return { nik: g.nik, nama: g.nama, role: g.role, region: g.region, big: g.big, boss: g.boss, bossRole: g.bossRole, teamSize: g.team.length,
      actual: actual, target: t.value || 0, targetComplete: !!t.exists && !(t.missing || []).length, daily7: daily, qtyMTD: m.qty };
  });
  return { period: period, cutoff: c.cutoff, closed: c.closed, days: days, run: run, level: level, brand: brand, metric: metric, brands: brands, last7: last7, rows: rows };
}

/* ---------- MENU ANALISA (filter bertingkat dilakukan di tampilan; tiap baris membawa NIK pemilik) ---------- */
function apiAnalisa(token, period, selection) {
  var c = anaCtx_(token, period, selection), db = c.db, meta = db.meta, ids = c.ids, key = PortalCore.key;
  var brands = anaDeviceBrands_(meta), months6 = anaMonths_(db, period, 6), months3 = months6.slice(-3), prevP = anaPrev_(period, 1), p2 = anaPrev_(period, 2);
  var perMonth = {}, lastDate = {}, curRows = [];
  months6.forEach(function (p) {
    (p === period ? PortalCore.slice(db, p, ids, c.cutoff) : PortalCore.sliceCmp(db, p, ids, null, period)).forEach(function (r) {
      if (p === period) curRows.push(r);
      if (!r.q) return;
      var a = perMonth[r.customer] || (perMonth[r.customer] = {}), b = a[p] || (a[p] = {});
      b[r.brand] = (b[r.brand] || 0) + r.q;
      if (r.q > 0 && (!lastDate[r.customer] || r.date > lastDate[r.customer])) lastDate[r.customer] = r.date;
    });
  });
  var cust = function (id) { return meta.customers[id] || { nama: id, kota: '', hp: '', nik: '' }; };
  var ownerNik = function (id) { var n = cust(id).nik; if (n) return n; var o = db.stock && db.stock.owners ? db.stock.owners[id] : ''; return o || ''; };
  var ownerName = function (id) { var p = c.people[ownerNik(id)]; return p ? p.nama : '—'; };
  var qtyIn = function (id, p, b) { var m = (perMonth[id] || {})[p] || {}; if (b) return m[b] || 0; return Object.keys(m).reduce(function (n, k) { return n + Math.max(0, m[k]); }, 0); };
  var brandsIn = function (id, p) { var m = (perMonth[id] || {})[p] || {}; return Object.keys(m).filter(function (b) { return m[b] > 0; }).length; };
  var cutDate = new Date(c.cutoff + 'T00:00:00Z');
  var ageDays = function (d) { return d ? Math.round((cutDate - new Date(d + 'T00:00:00Z')) / 86400000) : null; };

  /* 1) Cross-sell */
  var tutup = dtClosed_(), isClosed = function (id) { return !!tutup[id] && tutup[id] <= c.cutoff; };
  var active = Object.keys(perMonth).filter(function (id) { return !isClosed(id) && (qtyIn(id, period) > 0 || qtyIn(id, prevP) > 0); });
  var div = months3.length || 1;
  var avgBrand = function (id, b) { return months3.reduce(function (n, p) { return n + Math.max(0, qtyIn(id, p, b)); }, 0) / div; };
  var area = anaAreaOf_(meta, c.people);
  var peers = anaPeers_(active, brands, avgBrand, area), median = anaMedian_;
  var dealers = active.map(function (id) {
    var total = months3.reduce(function (n, p) { return n + qtyIn(id, p); }, 0) / div, cells = {}, taken = 0;
    brands.forEach(function (b) {
      var v = avgBrand(id, b);
      if (v > 0) { cells[b] = { has: 1, avg: Math.round(v * 10) / 10 }; taken++; }
      else {
        var pk = anaPeerPick_(peers, area(id), b);
        cells[b] = { has: 0, est: pk ? Math.max(1, Math.round(Math.min(median(pk.list), Math.max(1, total * 0.5)))) : 0, n: pk ? pk.list.length : 0, basis: pk ? pk.label : '' };
      }
    });
    var cu = cust(id);
    return { id: id, nama: cu.nama, kota: cu.kota || '', hp: cu.hp || '', nik: ownerNik(id), sales: ownerName(id), avg: Math.round(total * 10) / 10, taken: taken, cells: cells };
  }).sort(function (a, b) { return b.avg - a.avg; });
  var crossSell = { months: months3, brands: brands, dealers: dealers.slice(0, 3000) };

  /* 2) Reaktivasi */
  var inScope = {};
  Object.keys(meta.customers).forEach(function (id) { if (ids.indexOf(meta.customers[id].nik) >= 0) inScope[id] = true; });
  Object.keys(perMonth).forEach(function (id) { inScope[id] = true; });
  var weights = { 'DA BULAN LALU': 1, 'IDLE': 0.7, 'PASIF': 0.4 }, re = [], back = [];
  Object.keys(inScope).forEach(function (id) {
    var series = months6.map(function (p) { return qtyIn(id, p); }), cur = qtyIn(id, period), prev = qtyIn(id, prevP), prev2 = qtyIn(id, p2);
    var earlier = months6.some(function (p) { return p !== period && qtyIn(id, p) > 0; });
    if (cur > 0 && prev === 0 && earlier) back.push(ownerNik(id));
    if (cur > 0 || isClosed(id)) return;
    var status = prev > 0 ? 'DA BULAN LALU' : prev2 > 0 ? 'IDLE' : (earlier || lastDate[id]) ? 'PASIF' : null;
    if (!status) return;
    var hist = series.slice(0, -1).filter(function (v) { return v > 0; }), avg = hist.length ? hist.reduce(function (a, b) { return a + b; }, 0) / hist.length : 0;
    var cu = cust(id);
    re.push({ id: id, nama: cu.nama, kota: cu.kota || '', hp: cu.hp || '', nik: ownerNik(id), sales: ownerName(id), status: status, avg: Math.round(avg * 10) / 10, series: series, last: lastDate[id] || null, jeda: ageDays(lastDate[id]), score: Math.round(avg * weights[status] * 10) / 10 });
  });
  re.sort(function (a, b) { return b.score - a.score || b.avg - a.avg; });
  var reactivation = { months: months6, reactivated: back, rows: re.slice(0, 4000) };

  /* 3) Dealer baru (NOO) — per pasangan dealer × brand, bulan lalu & bulan berjalan */
  var laterCur = {};
  curRows.forEach(function (r) { if (r.q > 0) { var k = key([r.customer, r.brand]); (laterCur[k] || (laterCur[k] = [])).push(r.date); } });
  var pairs = [];
  Object.keys(db.first || {}).forEach(function (k) {
    var f = db.first[k]; if (!f || ids.indexOf(f.nik) < 0) return;
    var m = f.date.slice(0, 7), idx = months6.indexOf(m); if (idx < 0) return;
    if (m === period && f.date > c.cutoff) return;
    var pk = JSON.parse(k), pres = [];
    for (var j = idx; j < months6.length; j++) pres.push(qtyIn(pk[0], months6[j], pk[1]) > 0 ? 1 : 0);
    var cu = cust(pk[0]);
    pairs.push({ c: pk[0], n: cu.nama, k: cu.kota || '', hp: cu.hp || '', b: pk[1], nik: f.nik, m: m, d: f.date, pres: pres, qM: qtyIn(pk[0], m, pk[1]), qCur: qtyIn(pk[0], period, pk[1]), multi: brandsIn(pk[0], period), bl: (function () { var mm = (perMonth[pk[0]] || {})[period] || {}; return Object.keys(mm).filter(function (x) { return mm[x] > 0; }).sort(); })(), last: lastDate[pk[0]] || null,
      again: m === period ? (laterCur[k] || []).some(function (dt) { return dt > f.date; }) : null });
  });
  var noo = { prev: prevP, current: period, months: months6, pairs: pairs };

  return { period: period, cutoff: c.cutoff, closed: c.closed, crossSell: crossSell, reactivation: reactivation, noo: noo };
}


/* ---------- v6.19: hari kerja, Hari_Libur, pembanding Sub Region, potensi dealer ---------- */
function anaHol_() {
  var cache = CacheService.getScriptCache(), hit = cache.get('V6_HARI_LIBUR'); if (hit) return JSON.parse(hit);
  var out = [];
  try { optionalTable_('Hari_Libur').forEach(function (r) { var d = PortalCore.iso(r.TANGGAL); if (d && String(r.AKTIF).toUpperCase() !== 'FALSE') out.push(d); }); } catch (e) {}
  out = out.filter(function (d, i) { return out.indexOf(d) === i; }).sort();
  cache.put('V6_HARI_LIBUR', JSON.stringify(out), 600); return out;
}
function anaOff_(d, hol) { return new Date(d + 'T00:00:00Z').getUTCDay() === 0 || hol.indexOf(d) >= 0; }
function anaWork_(period, cutoff, closed) {
  var hol = anaHol_(), last = +PortalCore.end(period).slice(8), all = [], run = [];
  for (var i = 1; i <= last; i++) { var d = period + '-' + ('0' + i).slice(-2); if (anaOff_(d, hol)) continue; all.push(d); if (closed || d <= cutoff) run.push(d); }
  return { days: all.length, run: run.length, runDates: run };
}
function apiHariLibur(token) { guard_(token, false, false, snapshot_()); return anaHol_(); }
function anaMedian_(a) { if (!a || !a.length) return 0; var s = a.slice().sort(function (x, y) { return x - y; }), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function anaAreaOf_(meta, people) {
  var subBig = {}; meta.people.forEach(function (p) { var s = p.portfolio || p.region; if (s && p.wilayah && !subBig[s]) subBig[s] = p.wilayah; });
  return function (id) {
    var cu = meta.customers[id] || {}, o = people[cu.nik] || {}, sub = cu.region || o.portfolio || o.region || '', big = subBig[sub] || o.wilayah || '';
    return { sub: sub, big: big };
  };
}
function anaPeers_(ids, brands, avgFn, area) {
  var peers = {};
  ids.forEach(function (id) { var a = area(id); brands.forEach(function (b) { var v = avgFn(id, b); if (v > 0) ['S|' + a.sub, 'B|' + a.big, 'N|'].forEach(function (k) { (peers[k + '|' + b] || (peers[k + '|' + b] = [])).push(v); }); }); });
  return peers;
}
function anaPeerPick_(peers, a, b) {
  var tries = [['S|' + a.sub, 'Sub Region ' + a.sub], ['B|' + a.big, 'Region ' + a.big], ['N|', 'Nasional']];
  for (var i = 0; i < tries.length; i++) { var l = peers[tries[i][0] + '|' + b]; if (l && (l.length >= 5 || i === 2)) return { list: l, label: tries[i][1] }; }
  return null;
}
/* Potensi per dealer-brand: rata-rata 3 bulan penuh sebelum periode; brand belum diambil = median dealer sejenis. */
function apiPotensi(token, period, selection) {
  var c = anaCtx_(token, period, selection), db = c.db, meta = db.meta, brands = anaDeviceBrands_(meta);
  var months = [anaPrev_(period, 3), anaPrev_(period, 2), anaPrev_(period, 1)].filter(function (p) { return db.cubes[p]; });
  var allIds = meta.people.map(function (p) { return p.nik; }), per = {};
  months.forEach(function (p, mi) { PortalCore.slice(db, p, allIds, null).forEach(function (r) { if (!r.q) return; var a = per[r.customer] || (per[r.customer] = {}), b = a[r.brand] || (a[r.brand] = [0, 0, 0]); b[mi] += r.q; }); });
  var div = months.length || 1, avg = function (id, b) { var x = (per[id] || {})[b]; return x ? Math.max(0, x[0] + x[1] + x[2]) / div : 0; };
  var area = anaAreaOf_(meta, c.people), peers = anaPeers_(Object.keys(per).filter(function (id) { var t = dtClosed_()[id]; return !(t && t <= c.cutoff); }), brands, avg, area);
  var tutup = dtClosed_();
  var mine = {}; PortalCore.slice(db, period, c.ids, c.cutoff).forEach(function (r) { mine[r.customer] = 1; });
  months.forEach(function (p) { PortalCore.sliceCmp(db, p, c.ids, null, period).forEach(function (r) { mine[r.customer] = 1; }); });
  var map = {}, r1 = function (v) { return Math.round(v * 10) / 10; };
  Object.keys(mine).forEach(function (id) {
    if (tutup[id] && tutup[id] <= c.cutoff) return;
    var total = brands.reduce(function (n, b) { return n + avg(id, b); }, 0); if (!(total > 0)) return;
    var cell = {};
    brands.forEach(function (b) {
      var v = avg(id, b);
      if (v > 0) { var x = per[id][b]; cell[b] = { v: r1(v), k: 'h', m: x.slice(0, months.length).map(function (q) { return Math.max(0, q); }) }; }
      else { var pk = anaPeerPick_(peers, area(id), b); if (pk) cell[b] = { v: Math.max(1, Math.round(Math.min(anaMedian_(pk.list), Math.max(1, total * 0.5)))), k: 'p', n: pk.list.length, l: pk.label }; }
    });
    map[id] = cell;
  });
  var wk = anaWork_(period, c.cutoff, c.closed);
  return { period: period, months: months, days: wk.days, run: wk.run, map: map };
}

/* ---------- v6.21: kelola Hari_Libur dari menu Admin (Super Admin) ---------- */
function hlSheet_() { var sh = book_().getSheetByName('Hari_Libur'); if (!sh) { sh = book_().insertSheet('Hari_Libur'); sh.getRange(1, 1, 1, 3).setValues([['TANGGAL', 'KETERANGAN', 'AKTIF']]); try { sh.setFrozenRows(1); } catch (e) {} } return sh; }
function hlGuard_(token) { var u = guard_(token, false, false, snapshot_()); if (u.role !== 'SUPER ADMIN') throw Error('Hanya Super Admin yang bisa mengubah hari libur.'); return u; }
function hlRows_() {
  var sh = book_().getSheetByName('Hari_Libur'); if (!sh) return [];
  var v = sh.getDataRange().getValues(); v.shift();
  return v.map(function (r, i) { var d = r[0] instanceof Date ? Utilities.formatDate(r[0], 'Asia/Jakarta', 'yyyy-MM-dd') : PortalCore.iso(r[0]); return { row: i + 2, date: d, ket: String(r[1] || ''), aktif: String(r[2]).toUpperCase() !== 'FALSE' }; }).filter(function (x) { return x.date; }).sort(function (a, b) { return a.date.localeCompare(b.date); });
}
function apiHariLiburAdmin(token) { hlGuard_(token); return { rows: hlRows_() }; }
function apiHariLiburSave(token, tanggal, ket, aktif) {
  var u = hlGuard_(token), lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var d = PortalCore.iso(tanggal); if (!d) throw Error('Tanggal tidak valid.');
    if (new Date(d + 'T00:00:00Z').getUTCDay() === 0) throw Error('Minggu sudah otomatis libur, tidak perlu ditambahkan.');
    ket = String(ket || '').trim().slice(0, 100); if (ket.length < 2) throw Error('Keterangan wajib diisi.');
    var sh = hlSheet_(), cur = hlRows_().find(function (x) { return x.date === d; }), vals = [[d, ket, aktif === false ? 'FALSE' : 'TRUE']];
    if (cur) sh.getRange(cur.row, 1, 1, 3).setValues(vals); else sh.appendRow(vals[0]);
    CacheService.getScriptCache().remove('V6_HARI_LIBUR'); audit_(u.nik, 'HARI_LIBUR_SIMPAN', d + ' ' + ket);
    return { rows: hlRows_(), active: anaHol_() };
  } finally { lock.releaseLock(); }
}
function apiHariLiburHapus(token, tanggal) {
  var u = hlGuard_(token), lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var d = PortalCore.iso(tanggal), cur = hlRows_().find(function (x) { return x.date === d; }); if (!cur) throw Error('Tanggal tidak ditemukan.');
    hlSheet_().deleteRow(cur.row); CacheService.getScriptCache().remove('V6_HARI_LIBUR'); audit_(u.nik, 'HARI_LIBUR_HAPUS', d);
    return { rows: hlRows_(), active: anaHol_() };
  } finally { lock.releaseLock(); }
}

/* ---------- v6.21: Pertumbuhan per TYPE per Sales (MTD vs LMTD) — menu Brand ---------- */
function gtModelMap_() {
  var cache = CacheService.getScriptCache(), hit = cache.get('V6_TYPE_MODEL'); if (hit) return JSON.parse(hit);
  var out = {};
  try { optionalTable_('Master_Product').forEach(function (r) { var t = PortalCore.text(r.TYPE), m = PortalCore.text(r.MODEL); if (t && m && !out[t]) out[t] = m; }); } catch (e) {}
  try { cache.put('V6_TYPE_MODEL', JSON.stringify(out), 600); } catch (e) {}
  return out;
}
function gtModel_(type, brand, map) {
  if (map[type]) return map[type];
  var t = String(type || '').toUpperCase().replace(/\s+-\s+.*$/, '').trim(), b = String(brand || '').toUpperCase();
  if (b && t.indexOf(b + ' ') === 0) t = t.slice(b.length + 1);
  var out = [];
  t.split(/\s+/).some(function (w) { if (/^\d+(GB|TB|G)$/.test(w) || /^\d+\/\d+$/.test(w) || /^\d+\+\d+/.test(w)) return true; out.push(w); return false; });
  return (out.join(' ') || t).trim();
}
/* ---------- v6.22: mesin Perbandingan (dipakai menu Brand: kolom TYPE, dan menu Tim: kolom brand) ---------- */
function cmpRanges_(period, cutoff, closed, cmp, weekA, weekB) {
  var sh = StockCore.shift, prev = anaPrev_(period, 1), prevEnd = PortalCore.end(prev), end = PortalCore.end(period), mon = function (p) { var n = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des']; return n[+p.slice(5, 7) - 1] + ' ' + p.slice(2, 4); };
  if (cmp === 'WTD') {
    var dow = (new Date(cutoff + 'T00:00:00Z').getUTCDay() + 6) % 7, m0 = sh(cutoff, -dow);
    return { A: { from: m0, to: cutoff, label: 'Minggu ini' }, B: { from: sh(m0, -7), to: sh(cutoff, -7), label: 'Minggu lalu' } };
  }
  if (cmp === 'WK') {
    var wk = function (w) { w = Math.max(1, Math.min(5, +w || 1)); var f = period + '-' + ('0' + ((w - 1) * 7 + 1)).slice(-2), t = w === 5 ? end : period + '-' + ('0' + Math.min(w * 7, +end.slice(8))).slice(-2); if (f > end) f = end; var run = !closed && t > cutoff; return { from: f, to: run ? cutoff : t, label: 'W' + w, running: run }; };
    return { A: wk(weekA || 2), B: wk(weekB || 1) };
  }
  if (cmp === 'MOM') {
    var pA = closed ? period : prev, pB = anaPrev_(pA, 1);
    return { A: { from: pA + '-01', to: PortalCore.end(pA), label: mon(pA) }, B: { from: pB + '-01', to: PortalCore.end(pB), label: mon(pB) } };
  }
  var bTo = closed ? prevEnd : (prev + '-' + cutoff.slice(8) <= prevEnd ? prev + '-' + cutoff.slice(8) : prevEnd);
  return { A: { from: period + '-01', to: cutoff, label: 'MTD' }, B: { from: prev + '-01', to: bTo, label: 'LMTD' } };
}
function apiCompare(token, period, selection, opts) {
  opts = opts || {};
  var view = opts.view === 'TYPE' ? 'TYPE' : 'BRAND', cmp = ['MTD', 'WTD', 'WK', 'MOM'].indexOf(opts.cmp) >= 0 ? opts.cmp : 'MTD';
  var metric = ['ST', 'SO', 'OMZET', 'DA', 'NOO'].indexOf(opts.metric) >= 0 ? opts.metric : 'ST', level = ['SALES', 'ASM', 'RGM'].indexOf(opts.level) >= 0 ? opts.level : 'SALES';
  var brand = PortalCore.text(opts.brand || 'ALL'), c = anaCtx_(token, period, selection), meta = c.db.meta;
  if (c.u.role === 'SALES') level = 'SALES';
  var R = cmpRanges_(period, c.cutoff, c.closed, cmp, opts.weekA, opts.weekB);
  var side = function (d) { return d >= R.A.from && d <= R.A.to ? 0 : d >= R.B.from && d <= R.B.to ? 1 : -1; };
  var anc = function (nik, role) { var p = c.people[nik], g = 0; while (p && g++ < 10) { if (p.role === role) return p; p = c.people[p.atasan]; } return null; };
  var rowKey = function (nik) { if (level === 'SALES') return nik; var a = anc(nik, level); return a ? a.nik : '~' + level; };
  var colKey = function (b, t) { if (view === 'TYPE') return b === brand ? (t || '(tanpa TYPE)') : null; return brand === 'ALL' || b === brand ? b : null; };
  var acc = {}, pairs = {}, cols = {}, bigCnt = {};
  var noteBig = function (rk, b) { if (!b) return; var m = bigCnt[rk] || (bigCnt[rk] = {}); m[b] = (m[b] || 0) + 1; };
  var put = function (rk, ck, sd, v) { var a = acc[rk] || (acc[rk] = {}), x = a[ck] || (a[ck] = [0, 0]); x[sd] += v; cols[ck] = 1; };
  if (metric === 'SO') {
    var pv = coverageView_(c.source, period, c.ids, 'PAIR', c.u);
    if (!pv.stock || pv.missingSO) throw Error('Data SELL OUT belum lengkap untuk cakupan ini.');
    (pv.stock.moves || []).forEach(function (t) {
      if (!t.outQty) return; var sd = side(t.date); if (sd < 0) return;
      var p = meta.products[t.sku]; if (!p || !p.device) return; var ck = colKey(p.brand, p.type || p.nama); if (!ck) return;
      var own = pv.stock.owners ? pv.stock.owners[t.customer] : ''; if (!own || c.ids.indexOf(own) < 0) return;
      put(rowKey(own), ck, sd, t.outQty);
    });
  } else if (metric === 'NOO') {
    Object.keys(c.db.first || {}).forEach(function (k) {
      var f = c.db.first[k], sd = side(f.date); if (sd < 0 || c.ids.indexOf(f.nik) < 0) return; var pr = JSON.parse(k), ck = colKey(pr[1], ''); if (!ck) return;
      put(rowKey(f.nik), ck, sd, 1);
    });
  } else {
    var months = {}; [R.A.from, R.A.to, R.B.from, R.B.to].forEach(function (d) { months[d.slice(0, 7)] = 1; });
    Object.keys(months).forEach(function (p) {
      if (!c.db.cubes[p]) return;
      (p === period ? PortalCore.slice(c.db, p, c.ids, null) : PortalCore.sliceCmp(c.db, p, c.ids, null, period)).forEach(function (r) {
        var sd = side(r.date); if (sd < 0) return; var ck = colKey(r.brand, r.type); if (!ck) return;
        var rk = rowKey(r.nik); noteBig(rk, r.region);
        if (metric === 'ST') { if (r.q) put(rk, ck, sd, r.q); }
        else if (metric === 'OMZET') { if (r.a) put(rk, ck, sd, r.a); }
        else if (metric === 'DA' && r.q > 0) { var pk = rk + '|' + ck + '|' + sd, m = pairs[pk] || (pairs[pk] = {}); m[r.customer + '|' + r.brand] = (m[r.customer + '|' + r.brand] || 0) + r.q; cols[ck] = 1; }
      });
    });
    if (metric === 'DA') Object.keys(pairs).forEach(function (pk) { var a = pk.split('|'), m = pairs[pk], n = Object.keys(m).filter(function (x) { return m[x] >= 2; }).length; if (n) put(a[0], a[1], +a[2], n); else { var o = acc[a[0]] || (acc[a[0]] = {}); o[a[1]] = o[a[1]] || [0, 0]; } });
  }
  var map = view === 'TYPE' ? gtModelMap_() : {};
  var colList = Object.keys(cols).map(function (k) { var t = [0, 0]; Object.keys(acc).forEach(function (rk) { var x = acc[rk][k]; if (x) { t[0] += x[0]; t[1] += x[1]; } }); return { key: k, model: view === 'TYPE' ? gtModel_(k, brand, map) : k, a: t[0], l: t[1] }; }).sort(function (x, y) { return (y.a + y.l) - (x.a + x.l); });
  var rows = Object.keys(acc).map(function (rk) {
    var p = c.people[rk] || { nik: rk, nama: rk.charAt(0) === '~' ? '(tanpa ' + level + ')' : rk, role: level }, asm = anc(rk, 'ASM'), rgm = anc(rk, 'RGM');
    var group = level === 'SALES' ? (asm ? asm.nama : '(tanpa ASM)') : level === 'ASM' ? (rgm ? rgm.nama : '(tanpa RGM)') : (p.wilayah || '—');
    var bc = bigCnt[rk], bigTx = bc ? Object.keys(bc).sort(function (x, y) { return bc[y] - bc[x]; })[0] : '';
    return { nik: rk, nama: p.nama, role: p.role || level, region: level === 'RGM' ? (p.wilayah || bigTx || '') : (p.portfolio || p.region || ''), big: p.wilayah || bigTx || '(tanpa Big Region)', rgm: rgm ? rgm.nama : '', asm: asm ? asm.nama : '', group: group, self: level === 'SALES' && !!asm && asm.nik === rk, cells: acc[rk] };
  });
  return { view: view, cmp: cmp, metric: metric, level: level, brand: brand, period: period, cutoff: c.cutoff, A: R.A, B: R.B, cols: colList, rows: rows, maxWeek: Math.min(5, Math.ceil(+c.cutoff.slice(8) / 7)) };
}
function apiGrowthType(token, period, selection, brand, opts) { opts = opts || {}; opts.view = 'TYPE'; opts.brand = brand; opts.level = 'SALES'; return apiCompare(token, period, selection, opts); }

/* v6.23: data tambahan saat login digabung jadi 1 panggilan (hari libur + dealer tutup). */
function apiV6Boot(token) { var t = null; try { t = apiDealerTutupList(token); } catch (e) {} return { hol: anaHol_(), tutup: t }; }
