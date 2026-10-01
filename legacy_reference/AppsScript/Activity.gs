/* Activity.gs — Riwayat aktivitas (Audit_Log) & daftar checkpoint + Kembalikan (Super Admin). */
var ACT_LABEL = {
  CHECKPOINT: 'Checkpoint', ACCOUNT_MERGE: 'Gabung akun', ACCOUNT_DELETE: 'Hapus akun', DEALER_TRANSFER: 'Transfer dealer', DEALER_REGION: 'Big Region dealer',
  CUSTOMER_BULK: 'Bulk edit dealer', REGION_MAP_EDIT: 'Edit Region Map', KPI_ADMIN: 'KPI / target', CHECKPOINT_RESTORE: 'Kembalikan checkpoint', LOGIN: 'Login', PUBLISH: 'Publish data', HARI_LIBUR_SIMPAN: 'Simpan hari libur', HARI_LIBUR_HAPUS: 'Hapus hari libur', DETAIL_KPI: 'Buka detail KPI'
};
function actRows_() {
  var sh = book_().getSheetByName('Audit_Log'); if (!sh || sh.getLastRow() < 2) return [];
  var n = Math.min(sh.getLastRow() - 1, 3000), v = sh.getRange(sh.getLastRow() - n + 1, 1, n, 4).getValues();
  return v.map(function (r, i) { return { at: r[0] instanceof Date ? r[0].toISOString() : PortalCore.text(r[0]), nik: PortalCore.text(r[1]), action: PortalCore.text(r[2]), detail: PortalCore.text(r[3]), row: sh.getLastRow() - n + 1 + i }; }).reverse();
}
function actWhen_(iso) { try { return Utilities.formatDate(new Date(iso), 'Asia/Jakarta', 'dd/MM/yyyy HH:mm'); } catch (e) { return iso; } }
function apiActivity(token, q, action) {
  var db = snapshot_(), u = guard_(token, true, false, db);
  if (u.role !== 'SUPER ADMIN' && u.role !== 'ADMIN') throw Error('Khusus admin.');
  var names = {}; db.meta.people.forEach(function (p) { names[p.nik] = p.nama; });
  q = PortalCore.text(q).toUpperCase(); action = PortalCore.text(action);
  var rows = actRows_().filter(function (r) { return r.action !== 'CHECKPOINT'; });
  if (u.role !== 'SUPER ADMIN') rows = rows.filter(function (r) { return r.nik === u.nik; });
  var acts = {}; rows.forEach(function (r) { acts[r.action] = 1; });
  var noisy = { LOGIN: 1, PUBLISH: 1, DETAIL_KPI: 1, DEMO_START: 1 };
  rows = rows.filter(function (r) { return (action ? r.action === action : !noisy[r.action]) && (!q || (r.nik + ' ' + (names[r.nik] || '') + ' ' + r.action + ' ' + r.detail).toUpperCase().indexOf(q) >= 0); });
  return { rows: rows.slice(0, 300).map(function (r) { return { when: actWhen_(r.at), nik: r.nik, nama: names[r.nik] || '', action: r.action, label: ACT_LABEL[r.action] || r.action, detail: r.detail }; }), total: rows.length, actions: Object.keys(acts).sort().map(function (a) { return { id: a, label: ACT_LABEL[a] || a }; }) };
}
function apiCheckpoints(token) {
  var db = snapshot_(), u = guard_(token, true, false, db); if (u.role !== 'SUPER ADMIN') throw Error('Khusus Super Admin.');
  var names = {}; db.meta.people.forEach(function (p) { names[p.nik] = p.nama; });
  return { rows: actRows_().filter(function (r) { return r.action === 'CHECKPOINT'; }).slice(0, 60).map(function (r) {
    var m = r.detail.match(/\s(\S+)$/), file = m ? m[1] : '', reason = m ? r.detail.slice(0, r.detail.length - m[0].length) : r.detail;
    return { when: actWhen_(r.at), nik: r.nik, nama: names[r.nik] || r.nik, reason: reason, file: file };
  }).filter(function (x) { return x.file; }) };
}
/* Kembalikan semua sheet master ke kondisi SEBELUM perubahan di checkpoint itu.
   Data transaksi (ST/SO) tidak ikut. PIN (_Auth) tidak ditimpa — hanya akun yang hilang yang dikembalikan. */
function apiCheckpointRestore(token, file, reason) {
  reason = PortalCore.text(reason); if (reason.length < 5) throw Error('Isi alasan minimal 5 karakter.');
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var db = snapshot_(), u = guard_(token, true, false, db); if (u.role !== 'SUPER ADMIN') throw Error('Khusus Super Admin.');
    var cp = readJson_(file); if (!cp || !cp.sheets) throw Error('File checkpoint tidak terbaca.');
    var names = Object.keys(cp.sheets), before = {};
    names.concat(['_Auth']).forEach(function (s) { before[s] = readGrid_(s); });
    checkpoint_(u.nik, 'Sebelum kembalikan checkpoint ' + (cp.at || '') + ' · ' + reason);
    try {
      names.forEach(function (s) {
        var g = cp.sheets[s]; if (!g || !g.length) return;
        if (s === '_Auth') {
          var cur = readGrid_('_Auth'); if (!cur || !cur.length) { restoreGrid_(s, g); return; }
          var h = cur[0].map(PortalCore.text), ni = h.indexOf('NIK'), have = {}; cur.slice(1).forEach(function (r) { have[PortalCore.text(r[ni])] = 1; });
          var oh = g[0].map(PortalCore.text), oni = oh.indexOf('NIK'), add = g.slice(1).filter(function (r) { return !have[PortalCore.text(r[oni])]; }).map(function (r) { return h.map(function (k) { var j = oh.indexOf(k); return j < 0 ? '' : r[j]; }); });
          if (add.length) putTable_('_Auth', cur[0], cur.slice(1).concat(add));
          return;
        }
        restoreGrid_(s, g);
      });
      var meta = meta_();
      publish_(meta, db.raw, db.coverage, u.nik, 'KEMBALIKAN CHECKPOINT ' + (cp.reason || '') + ' · ' + reason);
    } catch (e) { Object.keys(before).forEach(function (s) { if (before[s]) restoreGrid_(s, before[s]); }); throw e; }
    try { authCacheClear_(); } catch (e) {}
    audit_(u.nik, 'CHECKPOINT_RESTORE', (cp.reason || '') + ' (' + (cp.at || '') + ') · ' + reason);
    return { ok: true, sheets: names.length };
  } finally { lock.releaseLock(); }
}

/* Banner admin: ringkasan cepat tanpa menjalankan cek penuh. */
function apiAdminBanner(token) {
  var db = snapshot_(), u = guard_(token, true, false, db), out = { items: [] };
  var sup = u.role === 'SUPER ADMIN', now = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM'), add = function (lv, text, go) { out.items.push({ lv: lv, text: text, go: go || '' }); };
  try { var h = JSON.parse(CacheService.getScriptCache().get('V6_HEALTH_SUM') || 'null'); if (h && (h.red || h.orange)) add(h.red ? 'r' : 'o', 'Cek Kesehatan Master terakhir: ' + (h.red ? h.red + ' merah' : '') + (h.red && h.orange ? ' · ' : '') + (h.orange ? h.orange + ' oranye' : ''), 'kesehatan'); } catch (e) {}
  try {
    var sh = book_().getSheetByName('Log_Sync');
    if (sh && sh.getLastRow() > 1) {
      var n = Math.min(sh.getLastRow() - 1, 60), v = sh.getRange(sh.getLastRow() - n + 1, 1, n, 4).getValues(), since = Date.now() - 3 * 86400000;
      var bad = v.filter(function (r) { var t = r[0] instanceof Date ? r[0].getTime() : Date.parse(r[0]); return (!t || t >= since) && /GAGAL|DITOLAK|SEBAGIAN/i.test(String(r[3])); });
      if (bad.length) add('o', bad.length + ' file Sync gagal/sebagian dalam 3 hari terakhir', 'status sync');
    }
  } catch (e) {}
  var last = Object.keys(db.coverage || {}).map(function (k) { return db.coverage[k].cutoff; }).filter(Boolean).sort().pop();
  if (last) { var days = Math.floor((Date.now() - new Date(last + 'T00:00:00+07:00').getTime()) / 86400000); if (days >= 3) add(days >= 7 ? 'r' : 'o', 'Data ST terakhir s.d. ' + last + ' (' + days + ' hari lalu)', 'status sync'); }
  if (!(db.meta.policies || []).some(function (p) { return p.period === now; })) add('r', 'KPI bulan ' + now + ' belum diatur', sup ? 'atur kpi' : '');
  else {
    var miss = 0, ppl = db.meta.people.filter(function (p) { return p.sales && (sup || canManageUser_(u, p)); });
    ppl.forEach(function (p) { targetPolicyFor_(db, now, p).forEach(function (c) { if (!db.meta.targets.some(function (t) { return t.period === now && t.nik === p.nik && t.brand === c.brand && t.metric === c.metric && (t.indicator || '') === (c.indicator || ''); })) miss++; }); });
    if (miss) add('o', miss + ' target bulan ' + now + ' belum diisi', 'edit target');
  }
  return out;
}
