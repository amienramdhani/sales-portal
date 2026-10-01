/* KpiAdmin.gs — Atur KPI & Edit target langsung di aplikasi.
   - KPI_Config: KPI per Big Region; sub region boleh punya KPI sendiri (WILAYAH_KPI = nama sub region) → menggantikan KPI Big Region untuk tim di sub region itu.
   - KPI_RGM   : KPI per orang RGM. Tiap indikator memilih Big Region mana yang dihitung (BIG_REGIONS, dipisah |) dan targetnya diisi langsung (TARGET).
   - Target    : target Sales per bulan. Indikator biasa → Target_Input (format melebar); indikator khusus (INDIKATOR_ID) → Target_Periode.
                 ASM = jumlah target Sales di bawahnya (tidak diisi). */
var KPI_CFG_HEADS = ['PERIODE', 'WILAYAH_KPI', 'KELOMPOK_KPI', 'METRIK', 'BRAND', 'BOBOT', 'BATAS_SKOR', 'INDIKATOR_ID', 'LABEL', 'TYPE_FILTER', 'MIN_QTY_DA', 'AKTIF'];
var KPI_RGM_HEADS = ['PERIODE', 'NIK', 'NAMA', 'KELOMPOK_KPI', 'INDIKATOR_ID', 'LABEL', 'METRIK', 'BRAND', 'TYPE_FILTER', 'BIG_REGIONS', 'BOBOT', 'BATAS_SKOR', 'TARGET', 'MIN_QTY_DA'];
var KPI_METRIC_COL = { QTY: 'ST', DA: 'DA', NOO: 'NOO', OMZET: 'OMZET' };

function kpiMonth_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Jakarta', 'yyyy-MM');
  var t = PortalCore.text(v); var m = t.match(/^(\d{4})-(\d{1,2})/); if (!m) return t;
  return m[1] + '-' + ('0' + m[2]).slice(-2);
}
function kpiNum_(v) { if (v === '' || v == null) return null; var n = Number(String(v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : NaN; }
function kpiGrid_(sheet, heads) {
  var g = readGrid_(sheet); if (!g || !g.length) return { heads: heads.slice(), rows: [], raw: null };
  var h = g[0].map(PortalCore.text); heads.forEach(function (x) { if (h.indexOf(x) < 0) h.push(x); });
  var rows = g.slice(1).filter(function (r) { return r.some(function (v) { return v !== '' && v != null; }); }).map(function (r) { var o = {}; h.forEach(function (k, i) { o[k] = r[i] == null ? '' : r[i]; }); return o; });
  return { heads: h, rows: rows, raw: g };
}
function kpiPut_(sheet, g) { putTable_(sheet, g.heads, g.rows.map(function (r) { return g.heads.map(function (h) { return r[h] == null ? '' : r[h]; }); })); }

/* Dipanggil meta_(): baca KPI_RGM → meta.rgmPolicies */
function rgmPolicies_(meta) {
  var g = readGrid_('KPI_RGM'); if (!g || g.length < 2) return [];
  var h = g[0].map(PortalCore.text), col = function (r, k) { var i = h.indexOf(k); return i < 0 ? '' : r[i]; }, out = [], sum = {}, seen = {};
  var bigs = (meta.regionList || []).map(function (b) { return b.toUpperCase(); });
  g.slice(1).forEach(function (r, ri) {
    if (!r.some(function (v) { return v !== '' && v != null; })) return;
    var line = 'KPI_RGM baris ' + (ri + 2) + ': ';
    var c = { period: kpiMonth_(col(r, 'PERIODE')), nik: PortalCore.text(col(r, 'NIK')), group: PortalCore.text(col(r, 'KELOMPOK_KPI')), indicator: PortalCore.text(col(r, 'INDIKATOR_ID')), label: PortalCore.text(col(r, 'LABEL')),
      metric: PortalCore.text(col(r, 'METRIK')).toUpperCase(), brand: PortalCore.text(col(r, 'BRAND')) || 'ALL',
      types: PortalCore.text(col(r, 'TYPE_FILTER')).split('|').map(PortalCore.text).filter(Boolean),
      bigs: PortalCore.text(col(r, 'BIG_REGIONS')).split('|').map(PortalCore.text).filter(Boolean),
      weight: kpiNum_(col(r, 'BOBOT')), cap: kpiNum_(col(r, 'BATAS_SKOR')), target: kpiNum_(col(r, 'TARGET')), minDA: kpiNum_(col(r, 'MIN_QTY_DA')) || 2, minNOO: kpiNum_(col(r, 'MIN_QTY_DA')) || 1 };
    if (!/^\d{4}-\d{2}$/.test(c.period)) throw Error(line + 'PERIODE harus YYYY-MM.');
    var p = meta.people.find(function (x) { return x.nik === c.nik; });
    if (!p || p.role !== 'RGM') throw Error(line + 'NIK ' + c.nik + ' bukan RGM.');
    if (!c.group) throw Error(line + 'KELOMPOK_KPI kosong.');
    if (['QTY', 'DA', 'NOO', 'OMZET'].indexOf(c.metric) < 0) throw Error(line + 'METRIK harus QTY/DA/NOO/OMZET.');
    if (!(c.weight > 0) || !(c.cap > 0)) throw Error(line + 'BOBOT dan BATAS_SKOR harus > 0.');
    if (c.target !== null && (isNaN(c.target) || c.target < 0)) throw Error(line + 'TARGET tidak valid.');
    if (c.types.length && ['QTY', 'DA'].indexOf(c.metric) < 0) throw Error(line + 'TYPE_FILTER hanya untuk QTY atau DA.');
    c.bigs.forEach(function (b) { if (bigs.indexOf(b.toUpperCase()) < 0) throw Error(line + 'Big Region ' + b + ' tidak ada di Region Map.'); });
    var k = [c.period, c.nik, c.group, c.metric, c.brand, c.indicator, c.bigs.join('|'), c.types.join('|')].join('¦');
    if (seen[k]) throw Error(line + 'indikator dobel.'); seen[k] = 1;
    var gk = c.period + ' · ' + p.nama + ' · ' + c.group; sum[gk] = (sum[gk] || 0) + c.weight;
    out.push(c);
  });
  Object.keys(sum).forEach(function (k) { if (Math.abs(sum[k] - 100) > 0.0001) throw Error('KPI RGM ' + k + ': total bobot harus 100 (sekarang ' + sum[k] + ').'); });
  return out;
}

function kpiTree_(db) {
  var g = readGrid_('Region_Map') || [[]], h = g[0].map(PortalCore.text), ri = h.indexOf('REGION'), wi = h.indexOf('WILAYAH_KPI'), tree = {};
  g.slice(1).forEach(function (r) { var reg = PortalCore.text(r[ri]), big = PortalCore.text(r[wi]); if (!reg || !big) return; (tree[big] = tree[big] || []); if (reg.toUpperCase() !== big.toUpperCase() && tree[big].indexOf(reg) < 0) tree[big].push(reg); });
  (db.meta.regionList || []).forEach(function (b) { tree[b] = tree[b] || []; });
  return Object.keys(tree).sort().map(function (b) { return { big: b, subs: tree[b].sort() }; });
}
function kpiProducts_(db) {
  var brands = {}, types = {};
  Object.keys(db.meta.products || {}).forEach(function (k) { var x = db.meta.products[k]; if (!x.device) return; brands[x.brand] = 1; (types[x.brand] = types[x.brand] || {})[x.type] = 1; });
  var t = {}; Object.keys(types).forEach(function (b) { t[b] = Object.keys(types[b]).sort(); });
  return { brands: ['ALL'].concat(Object.keys(brands).sort()), types: t };
}
function kpiPeriods_(db) {
  var s = {}, now = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM'), d = new Date(); d.setMonth(d.getMonth() + 1);
  s[now] = 1; s[Utilities.formatDate(d, 'Asia/Jakarta', 'yyyy-MM')] = 1;
  (db.meta.policies || []).forEach(function (p) { s[p.period] = 1; });
  Object.keys(db.coverage || {}).forEach(function (p) { s[p] = 1; });
  return Object.keys(s).sort().reverse().slice(0, 18);
}
function kpiRgmBigs_(db, nik) {
  var b = {}; PortalCore.scope(db.meta.people, nik).forEach(function (id) { var p = db.meta.people.find(function (x) { return x.nik === id; }); if (p && p.sales && p.wilayah) b[p.wilayah] = 1; });
  return Object.keys(b).sort();
}
function kpiSuper_(token) { var db = snapshot_(), u = guard_(token, true, false, db); if (u.role !== 'SUPER ADMIN') throw Error('Khusus Super Admin.'); return { db: db, u: u }; }

function apiKpiGet(token, period) {
  var c = kpiSuper_(token), db = c.db, periods = kpiPeriods_(db); period = kpiMonth_(period) || periods.filter(function (p) { return (db.meta.policies || []).some(function (x) { return x.period === p; }); })[0] || periods[0];
  var cfg = {};
  (db.meta.policies || []).filter(function (p) { return p.period === period; }).forEach(function (p) {
    (cfg[p.region] = cfg[p.region] || []).push({ group: p.group, metric: p.metric, brand: p.brand, weight: p.weight, cap: p.cap, indicator: p.indicator, label: p.label, types: p.types || [], minDA: p.metric === 'NOO' ? (p.minNOO || 1) : (p.minDA || 2) });
  });
  var rgms = db.meta.people.filter(function (p) { return p.role === 'RGM'; }).map(function (p) {
    return { nik: p.nik, nama: p.nama, wilayah: p.wilayah, bigs: kpiRgmBigs_(db, p.nik), rows: (db.meta.rgmPolicies || []).filter(function (x) { return x.period === period && x.nik === p.nik; }) };
  }).sort(function (a, b) { return a.nama.localeCompare(b.nama); });
  var pr = kpiProducts_(db);
  return { period: period, periods: periods, tree: kpiTree_(db), cfg: cfg, rgms: rgms, brands: pr.brands, types: pr.types };
}
function kpiCleanRows_(rows) {
  if (!Array.isArray(rows)) throw Error('Data KPI tidak valid.');
  if (rows.length > 60) throw Error('Maksimal 60 indikator.');
  var used = {};
  return rows.map(function (x, i) {
    var r = { group: PortalCore.text(x.group).toUpperCase(), metric: PortalCore.text(x.metric).toUpperCase(), brand: PortalCore.text(x.brand).toUpperCase() || 'ALL', weight: kpiNum_(x.weight), cap: kpiNum_(x.cap), indicator: PortalCore.text(x.indicator).toUpperCase().replace(/[^A-Z0-9_]/g, '_'), label: PortalCore.text(x.label), types: (x.types || []).map(PortalCore.text).filter(Boolean), minDA: kpiNum_(x.minDA) || (PortalCore.text(x.metric).toUpperCase() === 'NOO' ? 1 : 2), bigs: (x.bigs || []).map(PortalCore.text).filter(Boolean), target: kpiNum_(x.target) };
    var line = 'Indikator ' + (i + 1) + ': ';
    if (!r.group) throw Error(line + 'kelompok kosong.');
    if (['QTY', 'DA', 'NOO', 'OMZET'].indexOf(r.metric) < 0) throw Error(line + 'pilih metrik.');
    if (!(r.weight > 0)) throw Error(line + 'bobot harus > 0.');
    if (!(r.cap > 0)) r.cap = 120;
    if (r.minDA < 1 || Math.floor(r.minDA) !== r.minDA) throw Error(line + 'minimal unit harus bilangan bulat ≥ 1.');
    var special = r.types.length || (r.metric === 'DA' && r.minDA !== 2) || (r.metric === 'NOO' && r.minDA !== 1);
    if (special && !r.indicator) { var base = (r.metric + '_' + r.brand + (r.types.length ? '_TYPE' : '') + (special && !r.types.length ? '_MIN' + r.minDA : '')).replace(/[^A-Z0-9_]/g, '_'), k = base, n = 2; while (used[k]) k = base + n++; r.indicator = k; }
    if (r.indicator) used[r.indicator] = 1;
    return r;
  });
}
function kpiCommit_(u, db, sheets, label, reason, fn) {
  var before = {}; sheets.forEach(function (s) { before[s] = readGrid_(s); });
  checkpoint_(u.nik, label + ' · ' + reason);
  try {
    fn();
    var meta = meta_(); validateConfigChange_(db, meta);
    publish_(meta, db.raw, db.coverage, u.nik, label + ' · ' + reason);
  } catch (e) {
    sheets.forEach(function (s) { if (before[s]) restoreGrid_(s, before[s]); else { var sh = book_().getSheetByName(s); if (sh) book_().deleteSheet(sh); } });
    throw e;
  }
  audit_(u.nik, 'KPI_ADMIN', label + ' · ' + reason);
}
function apiKpiSaveRegion(token, period, region, rows, reason) {
  reason = PortalCore.text(reason); if (reason.length < 5) throw Error('Isi alasan minimal 5 karakter.');
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var c = kpiSuper_(token), db = c.db; period = kpiMonth_(period); region = PortalCore.text(region);
    if (!/^\d{4}-\d{2}$/.test(period)) throw Error('Periode harus YYYY-MM.');
    var tree = kpiTree_(db), node = tree.find(function (t) { return t.big.toUpperCase() === region.toUpperCase(); }), isSub = !node && tree.some(function (t) { return t.subs.some(function (s) { return s.toUpperCase() === region.toUpperCase(); }); });
    if (!node && !isSub) throw Error('Region ' + region + ' tidak ada di Region Map.');
    var clean = kpiCleanRows_(rows);
    if (!clean.length && node) throw Error('KPI Big Region tidak boleh kosong. Kalau mau hapus KPI sub region, buka sub region-nya.');
    kpiCommit_(c.u, db, ['KPI_Config'], 'KPI ' + region + ' ' + period + (clean.length ? ' (' + clean.length + ' indikator)' : ' dihapus'), reason, function () {
      var g = kpiGrid_('KPI_Config', KPI_CFG_HEADS);
      g.rows = g.rows.filter(function (r) { return !(kpiMonth_(r.PERIODE) === period && PortalCore.text(r.WILAYAH_KPI).toUpperCase() === region.toUpperCase()); });
      clean.forEach(function (r) { g.rows.push({ PERIODE: period, WILAYAH_KPI: node ? node.big : region, KELOMPOK_KPI: r.group, METRIK: r.metric, BRAND: r.brand, BOBOT: r.weight, BATAS_SKOR: r.cap, INDIKATOR_ID: r.indicator, LABEL: r.label, TYPE_FILTER: r.types.join('|'), MIN_QTY_DA: (r.metric === 'DA' && r.minDA !== 2) || (r.metric === 'NOO' && r.minDA !== 1) ? r.minDA : '', AKTIF: 'TRUE' }); });
      kpiPut_('KPI_Config', g);
    });
    return { ok: true, count: clean.length };
  } finally { lock.releaseLock(); }
}
function apiKpiSaveRgm(token, period, nik, rows, reason) {
  reason = PortalCore.text(reason); if (reason.length < 5) throw Error('Isi alasan minimal 5 karakter.');
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var c = kpiSuper_(token), db = c.db; period = kpiMonth_(period); nik = PortalCore.text(nik);
    var p = db.meta.people.find(function (x) { return x.nik === nik; }); if (!p || p.role !== 'RGM') throw Error('NIK ' + nik + ' bukan RGM.');
    var clean = kpiCleanRows_(rows);
    clean.forEach(function (r, i) { if (r.target !== null && (isNaN(r.target) || r.target < 0)) throw Error('Indikator ' + (i + 1) + ': target tidak valid.'); });
    kpiCommit_(c.u, db, ['KPI_RGM'], 'KPI RGM ' + p.nama + ' ' + period + (clean.length ? ' (' + clean.length + ' indikator)' : ' dihapus → ikut KPI Big Region'), reason, function () {
      var g = kpiGrid_('KPI_RGM', KPI_RGM_HEADS);
      g.rows = g.rows.filter(function (r) { return !(kpiMonth_(r.PERIODE) === period && PortalCore.text(r.NIK) === nik); });
      clean.forEach(function (r) { g.rows.push({ PERIODE: period, NIK: nik, NAMA: p.nama, KELOMPOK_KPI: r.group, INDIKATOR_ID: r.indicator, LABEL: r.label, METRIK: r.metric, BRAND: r.brand, TYPE_FILTER: r.types.join('|'), BIG_REGIONS: r.bigs.join('|'), BOBOT: r.weight, BATAS_SKOR: r.cap, TARGET: r.target == null ? '' : r.target, MIN_QTY_DA: (r.metric === 'DA' && r.minDA !== 2) || (r.metric === 'NOO' && r.minDA !== 1) ? r.minDA : '' }); });
      kpiPut_('KPI_RGM', g);
    });
    return { ok: true, count: clean.length };
  } finally { lock.releaseLock(); }
}
/* Salin semua KPI (Big Region, sub region, RGM) dari satu bulan ke bulan lain yang masih kosong. */
function apiKpiCopy(token, from, to, reason) {
  reason = PortalCore.text(reason) || 'salin KPI';
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var c = kpiSuper_(token), db = c.db; from = kpiMonth_(from); to = kpiMonth_(to);
    if (!/^\d{4}-\d{2}$/.test(to) || from === to) throw Error('Pilih bulan tujuan yang berbeda.');
    if ((db.meta.policies || []).some(function (p) { return p.period === to; })) throw Error('KPI ' + to + ' sudah ada. Edit langsung saja.');
    var n = 0;
    kpiCommit_(c.u, db, ['KPI_Config', 'KPI_RGM'], 'Salin KPI ' + from + ' → ' + to, reason, function () {
      var g = kpiGrid_('KPI_Config', KPI_CFG_HEADS);
      g.rows.filter(function (r) { return kpiMonth_(r.PERIODE) === from; }).forEach(function (r) { var o = Object.assign({}, r); o.PERIODE = to; g.rows.push(o); n++; });
      kpiPut_('KPI_Config', g);
      var h = kpiGrid_('KPI_RGM', KPI_RGM_HEADS);
      if (h.raw) { h.rows.filter(function (r) { return kpiMonth_(r.PERIODE) === from; }).forEach(function (r) { var o = Object.assign({}, r); o.PERIODE = to; o.TARGET = ''; h.rows.push(o); }); kpiPut_('KPI_RGM', h); }
    });
    return { ok: true, count: n };
  } finally { lock.releaseLock(); }
}

/* ===== Edit target ===== */
function targetAsm_(people, p) { var x = p, seen = {}; while (x && !seen[x.nik]) { seen[x.nik] = 1; if (x.role === 'ASM') return x; x = people.find(function (q) { return q.nik === x.atasan; }); } return null; }
function targetPolicyFor_(db, period, p) {
  var sub = PortalCore.text(p.portfolio || p.region).toUpperCase(), all = (db.meta.policies || []).filter(function (c) { return c.period === period; });
  var own = all.filter(function (c) { return PortalCore.text(c.region).toUpperCase() === sub; });
  return own.length ? own : all.filter(function (c) { return c.region === p.wilayah; });
}
function targetKey_(metric, brand, ind) { return metric + '|' + brand + '|' + (ind || ''); }
function targetScope_(db, u, big, sub) {
  big = PortalCore.text(big).toUpperCase(); sub = PortalCore.text(sub).toUpperCase();
  return db.meta.people.filter(function (p) {
    if (!p.sales) return false;
    if (u.role !== 'SUPER ADMIN' && !canManageUser_(u, p)) return false;
    if (big && PortalCore.text(p.wilayah).toUpperCase() !== big) return false;
    if (sub && PortalCore.text(p.portfolio || p.region).toUpperCase() !== sub) return false;
    return true;
  });
}
function apiTargetGet(token, period, big, sub) {
  var db = snapshot_(), u = adminGuard_(token, db), periods = kpiPeriods_(db); period = kpiMonth_(period) || periods[0];
  var ppl = targetScope_(db, u, big, sub), cols = {}, rows = [];
  var tv = {}; (db.meta.targets || []).filter(function (t) { return t.period === period; }).forEach(function (t) { (tv[t.nik] = tv[t.nik] || {})[targetKey_(t.metric, t.brand, t.indicator)] = t.target; });
  ppl.forEach(function (p) {
    var need = targetPolicyFor_(db, period, p).map(function (c) { var k = targetKey_(c.metric, c.brand, c.indicator); if (!cols[k]) cols[k] = { key: k, metric: c.metric, brand: c.brand, indicator: c.indicator || '', label: c.indicator ? (c.label || c.indicator) : (KPI_METRIC_COL[c.metric] + ' ' + c.brand), types: c.types || [] }; return k; });
    Object.keys(tv[p.nik] || {}).forEach(function (k) { if (!cols[k]) { var s = k.split('|'); cols[k] = { key: k, metric: s[0], brand: s[1], indicator: s[2], label: s[2] || (KPI_METRIC_COL[s[0]] + ' ' + s[1]), extra: true }; } });
    var a = targetAsm_(db.meta.people, p);
    rows.push({ nik: p.nik, nama: p.nama, vac: /^VAC/i.test(p.nik) || /^VACANT\b/i.test(p.nama), big: p.wilayah, sub: PortalCore.text(p.portfolio || p.region), asm: a ? a.nik : '', asmNama: a ? a.nama : '(tanpa ASM)', need: need, vals: tv[p.nik] || {} });
  });
  var order = { QTY: 0, DA: 1, NOO: 2, OMZET: 3 }, cl = Object.keys(cols).map(function (k) { return cols[k]; }).sort(function (a, b) { return (a.indicator ? 1 : 0) - (b.indicator ? 1 : 0) || order[a.metric] - order[b.metric] || (a.brand === 'ALL' ? -1 : b.brand === 'ALL' ? 1 : a.brand.localeCompare(b.brand)); });
  rows.sort(function (a, b) { return a.sub.localeCompare(b.sub) || a.asmNama.localeCompare(b.asmNama) || (a.vac ? 1 : 0) - (b.vac ? 1 : 0) || a.nama.localeCompare(b.nama); });
  var tree = kpiTree_(db);
  if (u.role !== 'SUPER ADMIN') tree = tree.filter(function (t) { return (u.adminRegions || []).indexOf(t.big) >= 0; });
  return { period: period, periods: periods, tree: tree, cols: cl, rows: rows, hasKpi: (db.meta.policies || []).some(function (c) { return c.period === period; }) };
}
/* changes: [{nik, metric, brand, indicator, value}] value '' / null = kosongkan (belum diisi) */
function apiTargetSave(token, period, changes, reason) {
  reason = PortalCore.text(reason); if (reason.length < 5) throw Error('Isi alasan minimal 5 karakter.');
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var db = snapshot_(), u = adminGuard_(token, db); period = kpiMonth_(period);
    if (!/^\d{4}-\d{2}$/.test(period)) throw Error('Periode harus YYYY-MM.');
    if (!Array.isArray(changes) || !changes.length) throw Error('Tidak ada perubahan.');
    if (changes.length > 20000) throw Error('Terlalu banyak perubahan sekaligus (maks 20.000 sel).');
    var list = changes.map(function (x, i) {
      var nik = PortalCore.text(x.nik), p = db.meta.people.find(function (q) { return q.nik === nik; }), v = kpiNum_(x.value), m = PortalCore.text(x.metric).toUpperCase();
      if (!p || !p.sales) throw Error('NIK ' + nik + ' bukan Sales — target ASM/RGM tidak diisi di sini.');
      if (u.role !== 'SUPER ADMIN' && !canManageUser_(u, p)) throw Error(p.nama + ' di luar wilayah admin Anda.');
      if (!KPI_METRIC_COL[m]) throw Error('Metrik tidak valid.');
      if (v !== null && (isNaN(v) || v < 0)) throw Error(p.nama + ': nilai "' + x.value + '" tidak valid.');
      return { nik: nik, nama: p.nama, metric: m, brand: PortalCore.text(x.brand).toUpperCase() || 'ALL', ind: PortalCore.text(x.indicator), value: v };
    });
    var wide = list.filter(function (x) { return !x.ind; }), special = list.filter(function (x) { return x.ind; });
    kpiCommit_(u, db, ['Target_Input', 'Target_Periode'], 'Edit target ' + period + ' (' + list.length + ' sel)', reason, function () {
      var tp = kpiGrid_('Target_Periode', ['PERIODE', 'NIK', 'BRAND', 'METRIK', 'TARGET', 'INDIKATOR_ID']), hit = {};
      list.forEach(function (x) { hit[[x.nik, x.metric, x.brand, x.ind].join('|')] = x; });
      tp.rows = tp.rows.filter(function (r) { return !(kpiMonth_(r.PERIODE) === period && hit[[PortalCore.text(r.NIK), PortalCore.text(r.METRIK).toUpperCase(), PortalCore.text(r.BRAND).toUpperCase(), PortalCore.text(r.INDIKATOR_ID)].join('|')]); });
      special.forEach(function (x) { if (x.value !== null) tp.rows.push({ PERIODE: period, NIK: x.nik, BRAND: x.brand, METRIK: x.metric, TARGET: x.value, INDIKATOR_ID: x.ind }); });
      kpiPut_('Target_Periode', tp);
      if (wide.length) {
        var g = readGrid_(TARGET_INPUT), heads = g && g.length ? g[0].map(function (h) { return PortalCore.text(h).toUpperCase().replace(/\s+/g, ' '); }) : TARGET_INPUT_FIXED.slice();
        var rows = g && g.length ? g.slice(1).filter(function (r) { return r.some(function (v) { return v !== '' && v != null; }); }).map(function (r) { return r.slice(); }) : [];
        var pI = heads.indexOf('PERIODE TARGET'), nI = heads.indexOf('NIK SALES'), mI = heads.indexOf('NAMA SALES');
        wide.forEach(function (x) {
          var h = KPI_METRIC_COL[x.metric] + ' ' + x.brand, ci = heads.indexOf(h);
          if (ci < 0) { heads.push(h); ci = heads.length - 1; rows.forEach(function (r) { r[ci] = ''; }); }
          var row = rows.find(function (r) { return kpiMonth_(r[pI]) === period && PortalCore.text(r[nI]) === x.nik; });
          if (!row) { if (x.value === null) return; row = heads.map(function () { return ''; }); row[pI] = period; row[nI] = x.nik; if (mI >= 0) row[mI] = x.nama; rows.push(row); }
          row[ci] = x.value === null ? '' : x.value;
        });
        putTable_(TARGET_INPUT, heads, rows.map(function (r) { return heads.map(function (h, i) { var v = r[i]; return v == null ? '' : (i === pI ? kpiMonth_(v) : v); }); }));
      }
    });
    return { ok: true, count: list.length };
  } finally { lock.releaseLock(); }
}
