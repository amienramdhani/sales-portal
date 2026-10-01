/* AccountMerge.gs — Gabung akun (akun dobel orang yang sama) & Hapus akun (salah input, belum dipakai). Khusus Super Admin. */
var ACCT_SHEETS = [
  { sheet: 'Master_Sales', col: 'NIK ATASAN', what: 'bawahan' },
  { sheet: 'Master_Customer', col: 'NIK SALES', what: 'baris dealer' },
  { sheet: 'Target_Input', col: 'NIK SALES', what: 'baris target' },
  { sheet: 'Target_Periode', col: 'NIK', what: 'target khusus KPI' },
  { sheet: 'Admin_Access', col: 'NIK', what: 'akses admin' },
  { sheet: 'Export_Access', col: 'NIK', what: 'hak export' }
];
function acctSuper_(token) { var db = snapshot_(), u = guard_(token, true, false, db); if (u.role !== 'SUPER ADMIN') throw Error('Khusus Super Admin.'); return { db: db, u: u }; }
function acctTxCount_(db, nik) {
  var n = 0; try { Object.keys(db.cubes || {}).forEach(function (p) { n += PortalCore.slice(db, p, [nik]).filter(function (t) { return t.nik === nik; }).length; }); } catch (e) {}
  return n;
}
function acctUsage_(db, nik) {
  var out = { refs: [], total: 0, tx: acctTxCount_(db, nik), roles: [] };
  ACCT_SHEETS.forEach(function (c) {
    var g = readGrid_(c.sheet); if (!g || !g.length) return;
    var h = g[0].map(PortalCore.text), i = h.indexOf(c.col); if (i < 0) return;
    var n = g.slice(1).filter(function (r) { return PortalCore.text(r[i]) === nik; }).length;
    if (n) { out.refs.push({ sheet: c.sheet, col: c.col, what: c.what, count: n }); out.total += n; }
  });
  var ms = readGrid_('Master_Sales'), h = ms[0].map(PortalCore.text), ni = h.indexOf('NIK KARYAWAN'), pi = h.indexOf('POSISI');
  ms.slice(1).forEach(function (r) { if (PortalCore.text(r[ni]) === nik) out.roles.push(PortalCore.position(r[pi], 2)); });
  return out;
}
function apiAccountMergePreview(token, keep, drop) {
  var c = acctSuper_(token), db = c.db; keep = PortalCore.text(keep); drop = PortalCore.text(drop);
  if (!keep || !drop || keep === drop) throw Error('Pilih dua akun yang berbeda.');
  var pk = db.meta.people.find(function (p) { return p.nik === keep; }), pd = db.meta.people.find(function (p) { return p.nik === drop; });
  var ms = readGrid_('Master_Sales'), h = ms[0].map(PortalCore.text), ni = h.indexOf('NIK KARYAWAN'), nm = h.indexOf('SALES'), inSheet = function (n) { return ms.slice(1).some(function (r) { return PortalCore.text(r[ni]) === n; }); };
  if (!pk && !inSheet(keep)) throw Error('Akun yang dipertahankan (' + keep + ') tidak ditemukan.');
  var u = acctUsage_(db, drop), block = [];
  if (drop === c.u.nik) block.push('Tidak bisa menggabungkan akun yang sedang dipakai login.');
  var dealerRef = u.refs.find(function (r) { return r.sheet === 'Master_Customer'; });
  if (dealerRef && !(pk && pk.sales)) block.push('Akun ' + drop + ' memegang ' + dealerRef.count + ' dealer, tapi ' + keep + ' bukan Sales. Transfer dealernya dulu atau pilih akun Sales.');
  var tg = readGrid_('Target_Input');
  if (tg && tg.length) { var th = tg[0].map(PortalCore.text), tp = th.indexOf('PERIODE TARGET'), tn = th.indexOf('NIK SALES'), pk2 = {}; tg.slice(1).forEach(function (r) { if (PortalCore.text(r[tn]) === keep) pk2[PortalCore.text(r[tp])] = 1; }); var clash = tg.slice(1).filter(function (r) { return PortalCore.text(r[tn]) === drop && pk2[PortalCore.text(r[tp])]; }).map(function (r) { return PortalCore.text(r[tp]); }); if (clash.length) block.push('Target bulan ' + clash.join(', ') + ' ada di dua akun. Hapus salah satu di Target dulu.'); }
  var dropName = pd ? pd.nama : (ms.slice(1).find(function (r) { return PortalCore.text(r[ni]) === drop; }) || [])[nm] || '';
  return { keep: keep, keepName: pk ? pk.nama : '', drop: drop, dropName: PortalCore.text(dropName), refs: u.refs, roles: u.roles, tx: u.tx, block: block };
}
function acctRewrite_(sheet, fn) {
  var g = readGrid_(sheet); if (!g || !g.length) return null;
  var h = g[0].map(PortalCore.text), rows = g.slice(1).map(function (r) { return r.slice(); }), out = [];
  rows.forEach(function (r) { var x = fn(h, r); if (x !== false) out.push(r); });
  putTable_(sheet, g[0], out); return g;
}
function apiAccountMergeCommit(token, keep, drop, reason) {
  reason = PortalCore.text(reason); if (reason.length < 5) throw Error('Isi alasan minimal 5 karakter.');
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var pv = apiAccountMergePreview(token, keep, drop); if (pv.block.length) throw Error(pv.block.join(' '));
    var c = acctSuper_(token), db = c.db, before = {};
    checkpoint_(c.u.nik, 'Gabung akun ' + drop + ' → ' + keep + ' · ' + reason);
    try {
      ['Master_Sales', 'Master_Customer', 'Target_Input', 'Target_Periode', 'Admin_Access', 'Export_Access', '_Auth', NIK_MERGE_LOG].forEach(function (s) { before[s] = readGrid_(s); });
      acctRewrite_('Master_Sales', function (h, r) { var ni = h.indexOf('NIK KARYAWAN'), ai = h.indexOf('NIK ATASAN'); if (PortalCore.text(r[ni]) === pv.drop) return false; if (PortalCore.text(r[ai]) === pv.drop) r[ai] = pv.keep; });
      acctRewrite_('Master_Customer', function (h, r) { var i = h.indexOf('NIK SALES'); if (PortalCore.text(r[i]) === pv.drop) r[i] = pv.keep; });
      acctRewrite_('Target_Input', function (h, r) { var i = h.indexOf('NIK SALES'); if (PortalCore.text(r[i]) === pv.drop) { r[i] = pv.keep; var n = h.indexOf('NAMA SALES'); if (n >= 0) r[n] = pv.keepName; } });
      acctRewrite_('Target_Periode', function (h, r) { var i = h.indexOf('NIK'); if (PortalCore.text(r[i]) === pv.drop) r[i] = pv.keep; });
      var seenAcc = {}; acctRewrite_('Admin_Access', function (h, r) { var i = h.indexOf('NIK'), w = h.indexOf('WILAYAH'); if (PortalCore.text(r[i]) === pv.drop) r[i] = pv.keep; var k = PortalCore.text(r[i]) + '|' + PortalCore.text(r[w]); if (seenAcc[k]) return false; seenAcc[k] = 1; });
      acctRewrite_('Export_Access', function (h, r) { var i = h.indexOf('NIK'); if (i >= 0 && PortalCore.text(r[i]) === pv.drop) return false; });
      acctRewrite_('_Auth', function (h, r) { var i = h.indexOf('NIK'); if (PortalCore.text(r[i]) === pv.drop) return false; });
      nikMergeAppend_(pv.drop, pv.keep, c.u.nik, reason);
      var meta = meta_(); validateConfigChange_(db, meta);
      publish_(meta, db.raw, db.coverage, c.u.nik, 'GABUNG AKUN ' + pv.drop + ' → ' + pv.keep + ' · ' + reason);
    } catch (e) { Object.keys(before).forEach(function (s) { if (before[s]) restoreGrid_(s, before[s]); else if (s === NIK_MERGE_LOG) { var sh = book_().getSheetByName(s); if (sh) book_().deleteSheet(sh); } }); throw e; }
    try { authCacheClear_(); } catch (e) {}
    audit_(c.u.nik, 'ACCOUNT_MERGE', pv.drop + ' → ' + pv.keep + ' · ' + pv.refs.map(function (r) { return r.count + ' ' + r.what; }).join(', ') + ' · ' + reason);
    return { ok: true, moved: pv.refs };
  } finally { lock.releaseLock(); }
}
function apiAccountDeleteCheck(token, nik) {
  var c = acctSuper_(token), db = c.db; nik = PortalCore.text(nik);
  var u = acctUsage_(db, nik), block = [];
  if (nik === c.u.nik) block.push('Tidak bisa menghapus akun sendiri.');
  var p = db.meta.people.find(function (x) { return x.nik === nik; });
  if (p && p.role === 'SUPER ADMIN' && db.meta.people.filter(function (x) { return x.role === 'SUPER ADMIN'; }).length < 2) block.push('Super Admin terakhir tidak bisa dihapus.');
  u.refs.filter(function (r) { return r.sheet !== 'Admin_Access' && r.sheet !== 'Export_Access'; }).forEach(function (r) { block.push('Masih punya ' + r.count + ' ' + r.what + ' (' + r.sheet + ').'); });
  if (u.tx) block.push('Punya ' + u.tx + ' transaksi historis — nonaktifkan saja, jangan dihapus.');
  return { nik: nik, nama: p ? p.nama : '', refs: u.refs, tx: u.tx, block: block };
}
function apiAccountDelete(token, nik, reason) {
  reason = PortalCore.text(reason); if (reason.length < 5) throw Error('Isi alasan minimal 5 karakter.');
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var ck = apiAccountDeleteCheck(token, nik); if (ck.block.length) throw Error(ck.block.join(' '));
    var c = acctSuper_(token), db = c.db, before = {};
    checkpoint_(c.u.nik, 'Hapus akun ' + ck.nik + ' · ' + reason);
    try {
      ['Master_Sales', 'Admin_Access', 'Export_Access', '_Auth'].forEach(function (s) { before[s] = readGrid_(s); });
      acctRewrite_('Master_Sales', function (h, r) { if (PortalCore.text(r[h.indexOf('NIK KARYAWAN')]) === ck.nik) return false; });
      ['Admin_Access', 'Export_Access', '_Auth'].forEach(function (s) { acctRewrite_(s, function (h, r) { var i = h.indexOf('NIK'); if (i >= 0 && PortalCore.text(r[i]) === ck.nik) return false; }); });
      var meta = meta_(); validateConfigChange_(db, meta);
      publish_(meta, db.raw, db.coverage, c.u.nik, 'HAPUS AKUN ' + ck.nik + ' · ' + reason);
    } catch (e) { Object.keys(before).forEach(function (s) { if (before[s]) restoreGrid_(s, before[s]); }); throw e; }
    try { authCacheClear_(); } catch (e) {}
    audit_(c.u.nik, 'ACCOUNT_DELETE', ck.nik + ' ' + ck.nama + ' · ' + reason);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

/* Transaksi historis akun yang digabung: tidak diubah di file, tapi saat publish NIK lama dibaca sebagai NIK baru. */
var NIK_MERGE_LOG = 'NIK_Merge_Log';
function nikMergeRead_() { var g = readGrid_(NIK_MERGE_LOG); if (!g || g.length < 2) return []; var h = g[0].map(PortalCore.text), l = h.indexOf('NIK LAMA'), b = h.indexOf('NIK BARU'); return g.slice(1).map(function (r) { return { lama: PortalCore.text(r[l]), baru: PortalCore.text(r[b]) }; }).filter(function (x) { return x.lama && x.baru && x.lama !== x.baru; }); }
function nikMergeAppend_(lama, baru, actor, reason) { var g = readGrid_(NIK_MERGE_LOG), rows = g && g.length ? g.slice(1) : []; rows.push([Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm'), lama, baru, actor, reason]); putTable_(NIK_MERGE_LOG, ['WAKTU', 'NIK LAMA', 'NIK BARU', 'OLEH', 'ALASAN'], rows); }
function nikResolveRows_(meta, rows) {
  var m = {}; (meta.nikMerge || []).forEach(function (x) { m[x.lama] = x.baru; }); if (!Object.keys(m).length) return rows;
  var f = function (n) { var seen = {}; while (m[n] && !seen[n]) { seen[n] = 1; n = m[n]; } return n; };
  return rows.map(function (t) { var n = f(t.nik); if (n === t.nik) return t; var o = Object.assign({}, t); o.nik = n; return o; });
}
