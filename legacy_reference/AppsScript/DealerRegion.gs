/* DealerRegion.gs — Big Region per dealer (Dealer_Region).
   Baris = mulai tanggal BERLAKU_MULAI, transaksi dealer itu masuk ke WILAYAH (Big Region) tsb.
   Transaksi yang sudah diimpor tidak berubah (region disimpan saat impor). */
var DEALER_REGION_HEADS = ['KODE CUSTOMER', 'WILAYAH', 'BERLAKU_MULAI', 'CATATAN', 'UPDATED_BY', 'UPDATED_AT'];
function dealerRegionGrid_() {
  var g = readGrid_('Dealer_Region');
  if (!g || !g.length) return { heads: DEALER_REGION_HEADS.slice(), rows: [] };
  var h = g[0].map(PortalCore.text);
  DEALER_REGION_HEADS.forEach(function (x) { if (h.indexOf(x) < 0) h.push(x); });
  var rows = g.slice(1).filter(function (r) { return r.some(function (v) { return v !== '' && v != null; }); }).map(function (r) {
    var o = {}; h.forEach(function (k, i) { o[k] = r[i] == null ? '' : r[i]; });
    o.BERLAKU_MULAI = PortalCore.iso(o.BERLAKU_MULAI) || PortalCore.text(o.BERLAKU_MULAI); return o;
  });
  return { heads: h, rows: rows };
}
function dealerRegionWrite_(g) { putTable_('Dealer_Region', g.heads, g.rows.map(function (r) { return g.heads.map(function (h) { return r[h] == null ? '' : r[h]; }); })); }
/* dipanggil Transfer dealer; list=[{dealer,big,date,note}] */
function dealerRegionAppend_(list, actor) {
  if (!list || !list.length) return 0;
  var g = dealerRegionGrid_(), now = new Date().toISOString();
  list.forEach(function (x) {
    g.rows = g.rows.filter(function (r) { return !(PortalCore.text(r['KODE CUSTOMER']) === x.dealer && r.BERLAKU_MULAI === x.date); });
    g.rows.push({ 'KODE CUSTOMER': x.dealer, WILAYAH: x.big, BERLAKU_MULAI: x.date, CATATAN: x.note || '', UPDATED_BY: actor, UPDATED_AT: now });
  });
  dealerRegionWrite_(g); return list.length;
}
function dealerRegionMin_(db) {
  var last = Object.keys(db.coverage || {}).map(function (k) { return db.coverage[k].cutoff; }).filter(Boolean).sort().pop();
  if (!last) return '';
  var d = new Date(last + 'T00:00:00+07:00'); d.setDate(d.getDate() + 1); return Utilities.formatDate(d, 'Asia/Jakarta', 'yyyy-MM-dd');
}
function drSuper_(token) { var db = snapshot_(), u = guard_(token, true, false, db); if (u.role !== 'SUPER ADMIN') throw Error('Khusus Super Admin.'); return { db: db, u: u }; }
function apiDealerRegionGet(token, q) {
  var c = drSuper_(token), db = c.db, g = dealerRegionGrid_(), bigs = (db.meta.regionList || []).slice().sort();
  q = PortalCore.text(q).toUpperCase();
  var today = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd');
  var rows = g.rows.map(function (r, i) {
    var id = PortalCore.text(r['KODE CUSTOMER']), cu = db.meta.customers[id];
    return { i: i, dealer: id, nama: cu ? (cu.nama || '') : '', ada: !!cu, big: PortalCore.text(r.WILAYAH), from: r.BERLAKU_MULAI, note: PortalCore.text(r.CATATAN), by: PortalCore.text(r.UPDATED_BY),
      now: cu ? PortalCore.text(RegionCore.route(db, { customer: id, date: today, nik: cu.nik }, 'ST')) : '' };
  }).filter(function (r) { return !q || (r.dealer + ' ' + r.nama + ' ' + r.big).toUpperCase().indexOf(q) >= 0; });
  rows.sort(function (a, b) { return a.dealer.localeCompare(b.dealer) || String(b.from).localeCompare(String(a.from)); });
  return { rows: rows.slice(0, 500), total: rows.length, bigs: bigs, minDate: dealerRegionMin_(db) };
}
function apiDealerRegionLookup(token, dealer) {
  var c = drSuper_(token), db = c.db, id = PortalCore.text(dealer), cu = db.meta.customers[id];
  if (!cu) throw Error('Dealer ' + id + ' tidak ditemukan di Master_Customer.');
  var today = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd'), p = db.meta.people.find(function (x) { return x.nik === cu.nik; });
  return { dealer: id, nama: cu.nama || '', nik: cu.nik, sales: p ? p.nama : '', salesBig: p ? PortalCore.text(p.wilayah) : '', now: PortalCore.text(RegionCore.route(db, { customer: id, date: today, nik: cu.nik }, 'ST')) };
}
/* op: {add:{dealer,big,date,note}} — riwayat tidak bisa dihapus (dikunci validateConfigChange_), koreksi = tambah baris baru. */
function apiDealerRegionSave(token, op, reason) {
  reason = PortalCore.text(reason); if (reason.length < 5) throw Error('Isi alasan minimal 5 karakter.');
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var c = drSuper_(token), db = c.db, g = dealerRegionGrid_(), before = readGrid_('Dealer_Region'), msg;
    var today = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd');
    if (op && op.add) {
      var a = op.add, id = PortalCore.text(a.dealer), big = PortalCore.text(a.big), date = PortalCore.iso(a.date);
      if (!db.meta.customers[id]) throw Error('Dealer ' + id + ' tidak ditemukan.');
      var bigs = (db.meta.regionList || []).map(function (b) { return b.toUpperCase(); });
      if (bigs.indexOf(big.toUpperCase()) < 0) throw Error('Big Region ' + big + ' tidak ada di Region Map.');
      if (!date) throw Error('Tanggal berlaku wajib (YYYY-MM-DD).');
      var min = dealerRegionMin_(db);
      if (min && date < min) throw Error('Tanggal berlaku minimal ' + min + ' (data sebelum tanggal itu sudah dipublikasi dan tetap di Big Region lama).');
      var cur = PortalCore.text(RegionCore.route(db, { customer: id, date: date, nik: db.meta.customers[id].nik }, 'ST'));
      if (cur.toUpperCase() === big.toUpperCase()) throw Error('Dealer ' + id + ' per ' + date + ' sudah di ' + big + '.');
      g.rows = g.rows.filter(function (r) { return !(PortalCore.text(r['KODE CUSTOMER']) === id && r.BERLAKU_MULAI === date); });
      g.rows.push({ 'KODE CUSTOMER': id, WILAYAH: big, BERLAKU_MULAI: date, CATATAN: PortalCore.text(a.note) || reason, UPDATED_BY: c.u.nik, UPDATED_AT: new Date().toISOString() });
      msg = id + ' → ' + big + ' mulai ' + date + ' (sebelumnya ' + (cur || '-') + ')';
    } else throw Error('Aksi tidak valid.');
    checkpoint_(c.u.nik, 'Dealer_Region ' + msg + ' · ' + reason);
    try {
      dealerRegionWrite_(g);
      var meta = meta_(); validateConfigChange_(db, meta);
      publish_(meta, db.raw, db.coverage, c.u.nik, 'DEALER_REGION ' + msg + ' · ' + reason);
    } catch (e) { if (before) restoreGrid_('Dealer_Region', before); throw e; }
    audit_(c.u.nik, 'DEALER_REGION', msg + ' · ' + reason);
    return { ok: true, msg: msg };
  } finally { lock.releaseLock(); }
}
