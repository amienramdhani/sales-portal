/* Eksekutif.gs — data Mode Eksekutif (HP): nasional, Big Region, Region × brand × indikator.
   File BARU, hanya MEMBACA data publikasi. Satu panggilan = seluruh isi halaman. */
/* Kanal ONLINE: region di Region_Map dengan KANAL = ONLINE. Dihitung di total nasional (RGM ke atas),
   tidak dihitung di DEALER AKTIF / NOO / SELL OUT / ranking / KPI, dan tidak terlihat oleh ASM & Sales. */
function onlineSet_() {
  var cache = CacheService.getScriptCache(), hit = cache.get('V6_ONLINE');
  if (hit) return JSON.parse(hit);
  var out = { regions: {}, bigs: {} };
  try { table_('Region_Map').forEach(function (r) { if (PortalCore.text(r.KANAL).toUpperCase() === 'ONLINE') { var rg = PortalCore.text(r.REGION), bg = PortalCore.text(r.WILAYAH_KPI); if (rg) out.regions[rg] = 1; if (bg) out.bigs[bg] = 1; } }); } catch (e) {}
  try { cache.put('V6_ONLINE', JSON.stringify(out), 600); } catch (e) {}
  return out;
}
function isOnlinePerson_(p, on) { on = on || onlineSet_(); return !!(p && (on.regions[p.portfolio || p.region || ''] || on.regions[p.region || ''] || on.bigs[p.wilayah || ''])); }
function allNiks_(db) { return db.meta.people.map(function (p) { return p.nik; }); }
function apiExec(token, period, selection) {
  var c = anaCtx_(token, period, selection);
  // RGM: summary nasional & antar Big Region terlihat, sub region hanya milik sendiri
  var own = {}; c.ids.forEach(function (n) { own[n] = 1; });
  var role = c.u.role, isRgm = role === 'RGM', isAsm = role === 'ASM', isSales = role === 'SALES', low = isAsm || isSales, ownBig = {}, ownSub = {}, me = null, team = {};
  var level = isSales ? 'SALES' : isAsm ? 'ASM' : isRgm ? 'RGM' : 'TOP';
  if (isRgm || low) {
    c.db.meta.people.forEach(function (p) { if (own[p.nik] && p.wilayah) ownBig[p.wilayah] = 1; if (own[p.nik] && p.sales) ownSub[p.portfolio || p.region || '(tanpa Region)'] = 1; if (p.nik === c.u.nik) me = p; });
    if (isSales && me) { if (me.wilayah) ownBig[me.wilayah] = 1; c.db.meta.people.forEach(function (p) { if (p.sales && p.atasan && p.atasan === me.atasan) team[p.nik] = 1; }); team[me.nik] = 1; }
    var all = c.db.meta.people.map(function (p) { return p.nik; });
    try { c.db = coverageView_(c.source, period, all, 'ST', c.u); c.ids = all; c.db.meta.people.forEach(function (p) { c.people[p.nik] = p; }); } catch (e) {}
  }
  // Pemimpin kartu: RGM/ASM dihitung dari bawahan (RGM bisa pegang beberapa Big Region, ASM beberapa sub region).
  var LEADB = {}, LEADS = {}, PBY = {}; c.db.meta.people.forEach(function (p) { PBY[p.nik] = p; });
  c.db.meta.people.forEach(function (p) {
    var sub = (p.sales || p.role === 'ASM') ? (p.portfolio || p.region || '') : '', big = p.wilayah || '', seen = {}, n = p.nik;
    while (n && PBY[n] && !seen[n]) { seen[n] = 1; var q = PBY[n];
      if (q.role === 'RGM' && big) (LEADB[q.nik] = LEADB[q.nik] || {})[big] = 1;
      if (q.role === 'ASM' && sub) (LEADS[q.nik] = LEADS[q.nik] || {})[sub] = 1;
      n = q.atasan; }
  });
  var ON = onlineSet_(), onl = {};
  c.db.meta.people.forEach(function (p) { if (isOnlinePerson_(p, ON)) onl[p.nik] = 1; });
  if (low) c.ids = c.ids.filter(function (n) { return !onl[n]; });   // ASM & Sales tidak melihat online
  var idSet0 = {}; c.ids.forEach(function (n) { idSet0[n] = 1; });
  // boleh dirinci (brand, harian, history): per level
  var detailOK = function (k) {
    if (level === 'TOP') return true;
    var pr = k.split('|');
    if (level === 'RGM') return pr[0] === 'N' || pr[0] === 'B' || (pr[0] === 'S' && ownBig[pr[1]]);
    if (level === 'ASM') return k === 'O' || (pr[0] === 'P' && own[pr[1]]) || (pr[0] === 'S' && ownBig[pr[1]]);
    return k === 'O' || k === 'P|' + c.u.nik;
  };
  // boleh harian & history (lebih ketat dari detailOK untuk ASM)
  var fullOK = function (k) { var pr = k.split('|'); if (level === 'ASM' && pr[0] === 'S') return !!ownSub[pr[2]]; return detailOK(k); };
  var db = c.db, meta = db.meta, key = PortalCore.key;
  var prev = anaPrev_(period, 1), prevEnd = PortalCore.end(prev), cut = c.cutoff;
  var prevCut = c.closed ? prevEnd : (prev + '-' + cut.slice(8) <= prevEnd ? prev + '-' + cut.slice(8) : prevEnd);
  var wk = anaWork_(period, cut, c.closed), brands = anaDeviceBrands_(meta), devSet = {};
  brands.forEach(function (b) { devSet[b] = 1; });
  var P = c.people, bigOf = function (nik) { return (P[nik] || {}).wilayah || '(tanpa Big Region)'; }, subOf = function (nik) { var p = P[nik] || {}; return p.portfolio || p.region || '(tanpa Region)'; };
  var keysOf = function (nik) { var b = bigOf(nik), s = subOf(nik), k = ['N', 'B|' + b, 'S|' + b + '|' + s];
    if (low && own[nik]) k.push('O');
    if (isAsm && own[nik]) k.push('P|' + nik);
    if (isSales && team[nik]) { k.push('T'); k.push('P|' + nik); }
    return k; };
  // Pembanding apple-to-apple: transaksi BULAN LALU dihitung ke pemegang dealer SEKARANG (Master_Customer).
  // Bulan berjalan tetap per NIK di transaksi (target & KPI tidak berubah).
  var latestP = Object.keys(db.coverage || {}).sort().pop(), cmpOn = period === latestP;
  var ownerNow = function (r) { if (!cmpOn) return r.nik; var cu = meta.customers[r.customer], n = cu && cu.nik; return n && P[n] ? n : r.nik; };
  var remap = function (rows) { return rows.map(function (r) { var n = ownerNow(r); if (n === r.nik) return r; var x = {}; for (var k in r) x[k] = r[k]; x.nik = n; return x; }); };
  var N = {}, daily = {};
  var slot = function (k, brand) { var n = N[k] || (N[k] = {}); return n[brand] || (n[brand] = { st: [0, 0, 0], om: [0, 0, 0], noo: [0, 0, 0], so: [0, 0, 0], da: [0, 0, 0], p: [{}, {}, {}] }); };
  var each = function (nik, brand, fn) { keysOf(nik).forEach(function (k) { fn(slot(k, brand)); fn(slot(k, 'ALL')); }); };
  var addRows = function (rows, side) {
    rows.forEach(function (r) {
      var dev = !!devSet[r.brand], sides = side === 0 && r.date === cut ? [0, 2] : [side];
      sides.forEach(function (sd) {
        each(r.nik, r.brand, function (x) { if (dev) x.st[sd] += r.q; x.om[sd] += r.a || 0; if (dev && r.q > 0 && !onl[r.nik]) { var pk = r.customer + '|' + r.brand; x.p[sd][pk] = (x.p[sd][pk] || 0) + r.q; } });
      });
      if (side === 0 && dev && r.q) keysOf(r.nik).filter(fullOK).forEach(function (k) { var d = daily[k] || (daily[k] = {}), dd = d[r.date] || (d[r.date] = {}); dd[r.brand] = (dd[r.brand] || 0) + r.q; });
    });
  };
  addRows(PortalCore.slice(db, period, c.ids, cut), 0);
  if (db.cubes[prev]) addRows(remap(PortalCore.slice(db, prev, allNiks_(db), prevCut)).filter(function (r) { return idSet0[r.nik]; }), 1);
  Object.keys(N).forEach(function (k) { Object.keys(N[k]).forEach(function (b) { var x = N[k][b]; [0, 1, 2].forEach(function (sd) { x.da[sd] = Object.keys(x.p[sd]).filter(function (pk) { return x.p[sd][pk] >= 2; }).length; }); delete x.p; }); });
  var idSet = {}; c.ids.forEach(function (n) { idSet[n] = 1; });
  Object.keys(db.first || {}).forEach(function (k) {
    var f = db.first[k]; if (!idSet[f.nik] || onl[f.nik]) return; var br = JSON.parse(k)[1]; if (!devSet[br]) return;
    var sd = f.date >= period + '-01' && f.date <= cut ? 0 : f.date >= prev + '-01' && f.date <= prevCut ? 1 : -1; if (sd < 0) return;
    each(f.nik, br, function (x) { x.noo[sd]++; if (sd === 0 && f.date === cut) x.noo[2]++; });
  });
  var soReady = false;
  try {
    var pv = coverageView_(c.source, period, c.ids, 'PAIR', c.u);
    if (pv.stock && !pv.missingSO) {
      soReady = true;
      (pv.stock.moves || []).forEach(function (t) {
        if (!t.outQty) return; var sd = t.date >= period + '-01' && t.date <= cut ? 0 : t.date >= prev + '-01' && t.date <= prevCut ? 1 : -1; if (sd < 0) return;
        var p = meta.products[t.sku]; if (!p || !p.device) return; var own = pv.stock.owners ? pv.stock.owners[t.customer] : ''; if (!own || !idSet[own] || onl[own]) return;
        each(own, p.brand, function (x) { x.so[sd] += t.outQty; if (sd === 0 && t.date === cut) x.so[2] += t.outQty; });
      });
    }
  } catch (e) {}
  // target per node
  var sales = meta.people.filter(function (p) { return idSet[p.nik] && p.sales; }), teams = {};
  sales.forEach(function (p) { keysOf(p.nik).forEach(function (k) { (teams[k] = teams[k] || []).push(p.nik); }); });
  var tgt = function (team, b, m) { var t = PortalCore.target(meta, period, team, b, m); return t.value || 0; };
  Object.keys(teams).forEach(function (k) {
    var team = teams[k];
    brands.concat(['ALL']).forEach(function (b) {
      var x = slot(k, b);
      if (b === 'ALL') { var tOff = team.filter(function (n) { return !onl[n]; }); x.t = { st: 0, da: 0, noo: 0 }; brands.forEach(function (bb) { ['st', 'da', 'noo'].forEach(function (m, i) { x.t[m] += tgt(m === 'st' ? team : tOff, bb, ['QTY', 'DA', 'NOO'][i]); }); }); }
      else x.t = { st: tgt(team, b, 'QTY'), da: tgt(team.filter(function (n) { return !onl[n]; }), b, 'DA'), noo: tgt(team.filter(function (n) { return !onl[n]; }), b, 'NOO') };
    });
  });
  // nama & penanggung jawab
  var nodes = {};
  Object.keys(N).forEach(function (k) {
    var parts = k.split('|'), lead = '';
    if (isRgm && parts[0] === 'S' && !ownBig[parts[1]]) return;
    if (low && parts[0] === 'B' && !ownBig[parts[1]]) return;
    if (low && parts[0] === 'S' && !(isAsm ? ownBig[parts[1]] : ownSub[parts[2]])) return;
    if (!detailOK(k)) { var slim = {}; if (N[k].ALL) slim.ALL = N[k].ALL; N[k] = slim; }
    if (parts[0] === 'B') { var rgmL = (rgmMap_(meta)[parts[1]] || {}), rgmA = Object.keys(rgmL).map(function (k) { return rgmL[k]; }).sort(function (a, b) { return b.count - a.count; }).filter(function (x) { return idSet[x.nik] || c.u.role !== 'RGM'; }); lead = rgmA.length ? rgmA[0].nama + (rgmA.length > 1 ? ' ⚠ +' + (rgmA.length - 1) + ' RGM lain (cek Kesehatan Master)' : '') : ''; } if (parts[0] === 'B' && !lead) { var rgmHere = meta.people.filter(function (p) { return p.role === 'RGM' && p.wilayah === parts[1]; }); lead = rgmHere.length ? rgmHere.map(function (p) { return p.nama; }).join(', ') + ' (belum jadi atasan tim)' : ''; }
    if (parts[0] === 'S') lead = meta.people.filter(function (p) { return p.role === 'ASM' && (LEADS[p.nik] || {})[parts[2]]; }).map(function (p) { return p.nama; }).join(', ');
    var nm = parts[0] === 'N' ? 'Nasional' : parts[parts.length - 1];
    if (parts[0] === 'P') nm = (P[parts[1]] || {}).nama || parts[1];
    if (k === 'O') nm = isSales ? ((me || {}).nama || 'Saya') : Object.keys(ownSub).join(', ');
    if (k === 'T') nm = 'Tim ' + (((meta.people.filter(function (p) { return me && p.nik === me.atasan; })[0]) || {}).nama || '');
    nodes[k] = { online: (parts[0] === 'B' && !!ON.bigs[parts[1]]) || (parts[0] === 'S' && (!!ON.bigs[parts[1]] || !!ON.regions[parts[2]])), name: nm, big: parts[0] === 'P' ? bigOf(parts[1]) : (parts[1] || ''), sub: parts[0] === 'P' ? subOf(parts[1]) : (parts[2] || ''), lead: lead, m: N[k] };
  });
  // ASM: proyeksi SELL THRU
  var asm = meta.people.filter(function (p) { return p.role === 'ASM' && !onl[p.nik] && !ON.bigs[p.wilayah || ''] && (isRgm || low ? own[p.nik] : (idSet[p.nik] || c.u.role === 'SUPER ADMIN')); }).map(function (p) {
    var team = PortalCore.scope(meta.people, p.nik).filter(function (n) { return ((isRgm || low) ? own[n] : idSet[n]) && P[n] && P[n].sales; }); if (!team.length) return null;
    var a = 0, ts = {}; team.forEach(function (n) { ts[n] = 1; });
    PortalCore.slice(db, period, team, cut).forEach(function (r) { if (devSet[r.brand]) a += r.q; });
    var t = 0; brands.forEach(function (b) { t += tgt(team, b, 'QTY'); });
    var proj = wk.run ? a / wk.run * wk.days : a;
    return { nama: p.nama, region: p.portfolio || p.region || '', big: p.wilayah || '', actual: a, target: t, proj: t ? Math.round(proj / t * 1000) / 10 : null };
  }).filter(function (x) { return x && x.proj != null; });
  // KPI per Big Region
  var kpi = {};
  Object.keys(teams).filter(function (k) { return k.indexOf('B|') === 0 && !ON.bigs[k.slice(2)]; }).forEach(function (k) {
    try { var r = PortalCore.kpi(db, period, teams[k], k.slice(2)); kpi[k.slice(2)] = r && r.score != null ? Math.round(r.score * 10) / 10 : null; } catch (e) { kpi[k.slice(2)] = null; }
  });
  // history bulanan (Januari s.d. bulan berjalan) SELL THRU per node × brand + target
  var hist = { months: anaMonths_(db, period, +period.slice(5)).filter(function (m) { return m.slice(0, 4) === period.slice(0, 4); }), v: {}, t: {} };
  hist.months.forEach(function (mo) {
    var endC = mo === period ? cut : null;
    (mo === period ? PortalCore.slice(db, mo, c.ids, endC) : remap(PortalCore.slice(db, mo, allNiks_(db), endC)).filter(function (r) { return idSet0[r.nik]; })).forEach(function (r) {
      if (!devSet[r.brand] || !r.q) return;
      keysOf(r.nik).filter(fullOK).forEach(function (k) {
        var a = hist.v[k] || (hist.v[k] = {}), b = a[mo] || (a[mo] = {}); b[r.brand] = (b[r.brand] || 0) + r.q;
      });
    });
    Object.keys(teams).forEach(function (k) {
      if (!fullOK(k)) return;
      var a = hist.t[k] || (hist.t[k] = {}), b = a[mo] = {}, all = 0;
      brands.forEach(function (bb) { var v = 0; try { v = PortalCore.target(meta, mo, teams[k], bb, 'QTY').value || 0; } catch (e) {} if (v) b[bb] = v; all += v; });
      b.ALL = all;
    });
  });
  // kesehatan dealer
  var lastM = {}, curM = {};
  if (db.cubes[prev]) PortalCore.slice(db, prev, c.ids, null).forEach(function (r) { if (r.q > 0 && !onl[r.nik] && (!(isRgm || low) || own[r.nik])) lastM[r.customer] = 1; });
  PortalCore.slice(db, period, c.ids, cut).forEach(function (r) { if (r.q > 0 && !onl[r.nik] && (!(isRgm || low) || own[r.nik])) curM[r.customer] = 1; });
  var tut = {}, pend = 0, tutNow = 0;
  try { tut = dtClosed_(); dtRows_().forEach(function (x) { var cu = meta.customers[x.id]; if (!cu || !((isRgm || low) ? own : idSet)[cu.nik]) return; if (x.status === 'PENGAJUAN') pend++; }); Object.keys(tut).forEach(function (id) { var cu = meta.customers[id]; if (cu && ((isRgm || low) ? own : idSet)[cu.nik] && tut[id].slice(0, 7) === period) tutNow++; }); } catch (e) {}
  var daLalu = Object.keys(lastM).filter(function (id) { return !curM[id] && !(tut[id] && tut[id] <= cut); }).length;
  // ===== ASM & SALES: KPI, dealer prioritas =====
  var kpiMe = null, dealers = [];
  if (low) {
    var ownIds = Object.keys(own).filter(function (n) { return P[n] && P[n].sales; }), bigName = Object.keys(ownBig)[0] || '';
    try { var kk = PortalCore.kpi(db, period, ownIds, bigName); kpiMe = { score: kk.score, status: kk.status, groups: (kk.groups || []).map(function (g) { return { name: g.name, score: g.score, ind: g.indicators.map(function (x) { return { label: x.label || (x.metric + (x.brand && x.brand !== 'ALL' ? ' ' + x.brand : '')), metric: x.metric, brand: x.brand, weight: x.weight, target: x.target, actual: x.actual, ach: x.ach, state: x.state }; }) }; }) }; } catch (e) {}
    var stock = {};
    try { var sc = StockCore.calculate(c.source, period, ownIds, {}); if (sc && sc.ready) (sc.rows || []).forEach(function (t) { var id = t.customer || t.id; stock[id] = (stock[id] || 0) + (t.stock || 0); }); } catch (e) {}
    var D = {}, dl = function (id) { var cu = meta.customers[id] || {}; return D[id] || (D[id] = { id: id, nama: cu.nama || id, nik: cu.nik || '', hp: cu.hp || '', kota: cu.kota || '', mtd: 0, lmtd: 0, lm: 0, br: {}, lmBr: {}, n: 0, noo: null }); };
    PortalCore.slice(db, period, ownIds, cut).forEach(function (r) { if (!devSet[r.brand] || !r.q) return; var x = dl(r.customer); x.mtd += r.q; x.br[r.brand] = (x.br[r.brand] || 0) + r.q; x.n++; });
    var ownSet = {}; ownIds.forEach(function (n) { ownSet[n] = 1; }); var prevOwn = function (cut2) { return remap(PortalCore.slice(db, prev, allNiks_(db), cut2)).filter(function (r) { return ownSet[r.nik]; }); };
    if (db.cubes[prev]) { prevOwn(prevCut).forEach(function (r) { if (devSet[r.brand] && r.q) dl(r.customer).lmtd += r.q; }); prevOwn(null).forEach(function (r) { if (devSet[r.brand] && r.q) { var x = dl(r.customer); x.lm += r.q; x.lmBr[r.brand] = (x.lmBr[r.brand] || 0) + r.q; } }); }
    Object.keys(db.first || {}).forEach(function (k) { var f = db.first[k]; if (!own[f.nik] || f.date < period + '-01' || f.date > cut) return; var id = JSON.parse(k)[0]; if (D[id] && (!D[id].noo || f.date < D[id].noo)) D[id].noo = f.date; });
    var tutC = {}; try { tutC = dtClosed_(); } catch (e) {}
    dealers = Object.keys(D).filter(function (id) { return !(tutC[id] && tutC[id] <= cut); }).map(function (id) { var x = D[id]; x.br = x.br; x.stok = stock[id] != null ? Math.max(0, Math.round(stock[id])) : null; return x; });
  }
  return { onlineBigs: level === 'TOP' || level === 'RGM' ? Object.keys(ON.bigs) : [], level: level, me: c.u.nik, kpiMe: kpiMe, dealers: dealers, ownSub: Object.keys(ownSub), period: period, prev: prev, cutoff: cut, prevCutoff: prevCut, closed: c.closed, days: wk.days, run: wk.run, brands: brands, soReady: soReady,
    nodes: nodes, daily: daily, hist: hist, ownBig: (isRgm || low) ? Object.keys(ownBig) : null, asm: asm, kpi: kpi, dealer: { daLaluBelum: daLalu, tutupBulanIni: tutNow, pengajuan: pend } };
}
