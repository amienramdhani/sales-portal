/* DealerEdit.gs — Cari & edit dealer, ganti kode induk, hapus dealer, nama induk seragam.
   KODE_UNIQ_CUSTOMER (kolom sheet: ID_DEALER) = identitas toko, tidak pernah berubah; dipakai di file ST/SO.
   KODE CUSTOMER = kode induk: dipakai untuk tabel, analisa & hitung DA. Beberapa toko boleh 1 induk (NIK wajib sama).
   Transaksi disimpan apa adanya (kode uniq); saat publish aplikasi membaca induknya dari Master_Customer. */
var UNIQ_COL = 'ID_DEALER', UNIQ_LABEL = 'KODE_UNIQ_CUSTOMER', INDUK_LOG = 'Customer_Induk_Log';
var INDUK_KEYED = [{ sheet: 'Master_Promotor', col: 'ID DEALER' }, { sheet: 'Master_Grade', col: 'ID DEALER' }, { sheet: 'Dealer_Tutup', col: 'KODE CUSTOMER' }, { sheet: 'Dealer_Assignment_History', col: 'KODE CUSTOMER' }];

/* ===== Resolver kode uniq → kode induk ===== */
var CUST_MAP_MEMO_ = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
function custMap_(meta) {
  if (CUST_MAP_MEMO_ && CUST_MAP_MEMO_.has(meta)) return CUST_MAP_MEMO_.get(meta);
  var m = {}, cu = meta.customers || {};
  (meta.indukLog || []).forEach(function (x) { if (x.lama && x.baru) m[x.lama] = x.baru; });
  Object.keys(cu).forEach(function (id) { (cu[id].aliases || []).forEach(function (a) { if (a) m[a] = id; }); });
  Object.keys(cu).forEach(function (id) { m[id] = id; });
  var out = function (code) { var c = code, seen = {}; while (m[c] && m[c] !== c && !seen[c]) { seen[c] = 1; c = m[c]; } return c; };
  if (CUST_MAP_MEMO_) CUST_MAP_MEMO_.set(meta, out);
  return out;
}
function custInduk_(meta, code) { code = PortalCore.text(code); return code ? custMap_(meta)(code) : code; }
function custResolveRows_(meta, rows) {
  var f = custMap_(meta);
  return (rows || []).map(function (t) { var c = f(t.customer); if (c === t.customer) return t; var o = Object.assign({}, t); o.uniq = t.customer; o.customer = c; return o; });
}
function indukLogRead_() {
  var g = readGrid_(INDUK_LOG); if (!g || g.length < 2) return [];
  var h = g[0].map(PortalCore.text), li = h.indexOf('KODE INDUK LAMA'), bi = h.indexOf('KODE INDUK BARU');
  return g.slice(1).map(function (r) { return { lama: PortalCore.text(r[li]), baru: PortalCore.text(r[bi]) }; }).filter(function (x) { return x.lama && x.baru && x.lama !== x.baru; });
}
function indukLogAppend_(pairs, actor, reason) {
  var g = readGrid_(INDUK_LOG), heads = ['WAKTU', 'KODE INDUK LAMA', 'KODE INDUK BARU', 'JUMLAH TOKO', 'OLEH', 'ALASAN'];
  var rows = g && g.length ? g.slice(1) : [], now = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm');
  pairs.forEach(function (p) { rows.push([now, p.lama, p.baru, p.toko || '', actor, reason]); });
  putTable_(INDUK_LOG, heads, rows);
}
/* Header file upload: KODE_UNIQ_CUSTOMER = ID_DEALER (dua-duanya diterima). */
function uniqHeads_(heads) { return heads.map(function (h) { var t = PortalCore.text(h).toUpperCase().replace(/\s+/g, '_'); return t === UNIQ_LABEL || t === 'KODE_UNIQ' || t === 'ID_DEALER' ? UNIQ_COL : PortalCore.text(h); }); }
function uniqObjects_(heads, objects) {
  var ren = {}; heads.forEach(function (h) { var t = PortalCore.text(h).toUpperCase().replace(/\s+/g, '_'); if ((t === UNIQ_LABEL || t === 'KODE_UNIQ') && h !== UNIQ_COL) ren[h] = UNIQ_COL; });
  if (!Object.keys(ren).length) return objects;
  return objects.map(function (o) { var x = {}; Object.keys(o).forEach(function (k) { x[ren[k] || k] = o[k]; }); return x; });
}
function uniqOutHeads_(heads) { return heads.map(function (h) { return h === UNIQ_COL ? UNIQ_LABEL : h; }); }

/* ===== Helper Master_Customer ===== */
function mcGrid_() {
  var g = readGrid_('Master_Customer'); if (!g || !g.length) throw Error('Master_Customer tidak ditemukan.');
  var h = g[0].map(PortalCore.text); if (h.indexOf(UNIQ_COL) < 0) h.push(UNIQ_COL);
  var rows = g.slice(1).filter(function (r) { return r.some(function (v) { return v !== '' && v != null; }); }).map(function (r) { var o = {}; h.forEach(function (k, i) { var v = r[i]; o[k] = v instanceof Date ? Utilities.formatDate(v, 'Asia/Jakarta', 'yyyy-MM-dd') : (v == null ? '' : v); }); return o; });
  return { heads: h, rows: rows, raw: g };
}
function mcPut_(g) { putTable_('Master_Customer', g.heads, g.rows.map(function (r) { return g.heads.map(function (h) { return r[h] == null ? '' : r[h]; }); })); }
function mcUniq_(r) { return PortalCore.text(r[UNIQ_COL]) || PortalCore.text(r['KODE CUSTOMER']); }
function mcCanEdit_(u, db, nik) { if (u.role === 'SUPER ADMIN') return true; var p = db.meta.people.find(function (x) { return x.nik === nik; }); return !!(p && canManageUser_(u, p)); }
function dealerClosed_() { var s = {}; try { dtRows_().forEach(function (x) { if (x.status === 'TUTUP') s[x.id] = x.date; }); } catch (e) {} return s; }

/* Ganti kode induk di semua sheet terkait (dipanggil dari edit, massal, dan upload/Sync). pairs=[{lama,baru}] */
function indukRewrite_(g, pairs, db) {
  var map = {}; pairs.forEach(function (p) { map[p.lama] = p.baru; });
  var name = {}; g.rows.forEach(function (r) { var k = PortalCore.text(r['KODE CUSTOMER']); if (!map[k] && PortalCore.text(r['NAMA INDUK CUSTOMER'])) name[k] = name[k] || PortalCore.text(r['NAMA INDUK CUSTOMER']); });
  pairs.forEach(function (p) { p.toko = 0; });
  g.rows.forEach(function (r) {
    var k = PortalCore.text(r['KODE CUSTOMER']), to = map[k]; if (!to) return;
    if (!PortalCore.text(r[UNIQ_COL])) r[UNIQ_COL] = k;   // simpan identitas toko sebelum induk berubah
    r['KODE CUSTOMER'] = to; if (name[to]) r['NAMA INDUK CUSTOMER'] = name[to];
    pairs.forEach(function (p) { if (p.lama === k) p.toko++; });
  });
  indukRewriteOthers_(map);
}
function indukRewriteOthers_(map) {
  INDUK_KEYED.forEach(function (c) {
    var s = readGrid_(c.sheet); if (!s || s.length < 2) return;
    var h = s[0].map(PortalCore.text), i = h.indexOf(c.col); if (i < 0) return;
    var have = {}, changed = false;
    s.slice(1).forEach(function (r) { have[PortalCore.text(r[i])] = 1; });
    var out = s.slice(1).filter(function (r) {
      var k = PortalCore.text(r[i]), to = map[k]; if (!to) return true;
      changed = true;
      if ((c.sheet === 'Master_Promotor' || c.sheet === 'Master_Grade') && have[to]) return false; // induk baru sudah punya data → pakai punya induk baru
      r[i] = to; return true;
    });
    if (changed) putTable_(c.sheet, s[0], out);
  });
}
function indukCheck_(g, db, lama, baru) {
  lama = PortalCore.text(lama); baru = PortalCore.text(baru);
  if (!lama || !baru) return 'Kode induk lama & baru wajib diisi.';
  if (lama === baru) return 'Kode induk baru sama dengan yang lama.';
  if (!/^[A-Za-z0-9._\-\/]{1,60}$/.test(baru)) return 'Kode induk baru hanya boleh huruf, angka, titik, strip, garis miring (maks 60).';
  var from = g.rows.filter(function (r) { return PortalCore.text(r['KODE CUSTOMER']) === lama; });
  if (!from.length) return 'Kode induk ' + lama + ' tidak ada di Master_Customer.';
  var to = g.rows.filter(function (r) { return PortalCore.text(r['KODE CUSTOMER']) === baru; });
  var n1 = PortalCore.text(from[0]['NIK SALES']);
  if (to.length && PortalCore.text(to[0]['NIK SALES']) !== n1) return 'Induk ' + baru + ' dipegang NIK ' + PortalCore.text(to[0]['NIK SALES']) + ', induk ' + lama + ' dipegang ' + n1 + '. Samakan dulu lewat Transfer dealer.';
  var uq = {}; g.rows.forEach(function (r) { uq[PortalCore.text(r[UNIQ_COL])] = 1; });
  if (!to.length && uq[baru] && !from.some(function (r) { return PortalCore.text(r[UNIQ_COL]) === baru; })) return 'Kode ' + baru + ' sudah dipakai sebagai kode uniq toko lain.';
  return '';
}

/* ===== Cari & detail ===== */
function apiDealerSearch(token, q) {
  var db = snapshot_(), u = adminGuard_(token, db), g = mcGrid_(), closed = dealerClosed_(), people = {};
  db.meta.people.forEach(function (p) { people[p.nik] = p; });
  q = PortalCore.text(q).toUpperCase(); if (q.length < 2) throw Error('Ketik minimal 2 huruf.');
  var hit = g.rows.filter(function (r) {
    return (mcUniq_(r) + ' ' + PortalCore.text(r['KODE CUSTOMER']) + ' ' + PortalCore.text(r['NAMA CUSTOMER']) + ' ' + PortalCore.text(r['NAMA INDUK CUSTOMER'])).toUpperCase().indexOf(q) >= 0 && mcCanEdit_(u, db, PortalCore.text(r['NIK SALES']));
  });
  return { total: hit.length, rows: hit.slice(0, 60).map(function (r) {
    var k = PortalCore.text(r['KODE CUSTOMER']), p = people[PortalCore.text(r['NIK SALES'])];
    return { uniq: mcUniq_(r), induk: k, nama: PortalCore.text(r['NAMA CUSTOMER']) || PortalCore.text(r['NAMA INDUK CUSTOMER']), namaInduk: PortalCore.text(r['NAMA INDUK CUSTOMER']), sales: p ? p.nama : PortalCore.text(r['NIK SALES']), big: p ? p.wilayah : '', closed: !!closed[k] };
  }) };
}
function dealerTxCount_(db, induk, uniq) {
  var n = 0, own = 0;
  Object.keys(db.raw || {}).forEach(function (p) { try { readJson_(db.raw[p]).forEach(function (t) { var c = PortalCore.text(t.customer); if (c === uniq) own++; if (c === uniq || custInduk_(db.meta, c) === induk) n++; }); } catch (e) {} });
  var so = 0; Object.keys((db.so && db.so.raw) || {}).forEach(function (p) { try { readJson_(db.so.raw[p]).forEach(function (t) { if (PortalCore.text(t.customer) === uniq) so++; }); } catch (e) {} });
  return { induk: n, uniq: own, so: so };
}
function apiDealerEditDetail(token, uniq) {
  var db = snapshot_(), u = adminGuard_(token, db), g = mcGrid_(); uniq = PortalCore.text(uniq);
  var r = g.rows.find(function (x) { return mcUniq_(x) === uniq; }); if (!r) throw Error('Dealer ' + uniq + ' tidak ditemukan.');
  if (!mcCanEdit_(u, db, PortalCore.text(r['NIK SALES']))) throw Error('Dealer di luar wilayah admin Anda.');
  var k = PortalCore.text(r['KODE CUSTOMER']), p = db.meta.people.find(function (x) { return x.nik === PortalCore.text(r['NIK SALES']); }), closed = dealerClosed_();
  var sib = g.rows.filter(function (x) { return PortalCore.text(x['KODE CUSTOMER']) === k; }).map(function (x) { return { uniq: mcUniq_(x), nama: PortalCore.text(x['NAMA CUSTOMER']) || PortalCore.text(x['NAMA INDUK CUSTOMER']), namaInduk: PortalCore.text(x['NAMA INDUK CUSTOMER']) }; });
  var names = sib.map(function (x) { return x.namaInduk; }).filter(function (v, i, a) { return v && a.indexOf(v) === i; });
  var hist = [];
  try { actRows_().filter(function (a) { return /^(DEALER_|INDUK_|CUSTOMER_BULK)/.test(a.action) && (a.detail.indexOf(uniq) >= 0 || a.detail.indexOf(k) >= 0); }).slice(0, 15).forEach(function (a) { hist.push({ when: actWhen_(a.at), by: a.nik, text: a.detail }); }); } catch (e) {}
  var fields = g.heads.filter(function (h) { return [UNIQ_COL, 'KODE CUSTOMER', 'NIK SALES', 'NAMA INDUK CUSTOMER'].indexOf(h) < 0; }).map(function (h) { return { key: h, value: PortalCore.text(r[h]) }; });
  return { uniq: uniq, induk: k, namaInduk: PortalCore.text(r['NAMA INDUK CUSTOMER']), namaIndukList: names, nik: PortalCore.text(r['NIK SALES']), sales: p ? p.nama : '', big: p ? p.wilayah : '', fields: fields, siblings: sib, closed: closed[k] || '', tx: dealerTxCount_(db, k, uniq), history: hist, superuser: u.role === 'SUPER ADMIN' };
}
function apiDealerIndukPeek(token, uniq, baru) {
  var db = snapshot_(), u = adminGuard_(token, db), g = mcGrid_(), r = g.rows.find(function (x) { return mcUniq_(x) === PortalCore.text(uniq); });
  if (!r) throw Error('Dealer tidak ditemukan.');
  var lama = PortalCore.text(r['KODE CUSTOMER']); baru = PortalCore.text(baru);
  var err = indukCheck_(g, db, lama, baru), to = g.rows.filter(function (x) { return PortalCore.text(x['KODE CUSTOMER']) === baru; }), from = g.rows.filter(function (x) { return PortalCore.text(x['KODE CUSTOMER']) === lama; });
  return { err: err, lama: lama, baru: baru, toko: from.map(mcUniq_), exists: to.length, existsToko: to.map(mcUniq_), namaBaru: to.length ? PortalCore.text(to[0]['NAMA INDUK CUSTOMER']) : '' };
}

/* ===== Simpan edit (field toko, nama induk, ganti induk) ===== */
function apiDealerSave(token, uniq, input, reason) {
  reason = PortalCore.text(reason); if (reason.length < 5) throw Error('Isi alasan minimal 5 karakter.');
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var db = snapshot_(), u = adminGuard_(token, db), g = mcGrid_(); uniq = PortalCore.text(uniq); input = input || {};
    var r = g.rows.find(function (x) { return mcUniq_(x) === uniq; }); if (!r) throw Error('Dealer ' + uniq + ' tidak ditemukan.');
    if (!mcCanEdit_(u, db, PortalCore.text(r['NIK SALES']))) throw Error('Dealer di luar wilayah admin Anda.');
    var lama = PortalCore.text(r['KODE CUSTOMER']), log = [], fields = input.fields || {};
    Object.keys(fields).forEach(function (h) {
      if ([UNIQ_COL, 'KODE CUSTOMER', 'NIK SALES', 'NAMA INDUK CUSTOMER'].indexOf(h) >= 0 || g.heads.indexOf(h) < 0) return;
      var v = PortalCore.text(fields[h]); if (v.length > 200) throw Error(h + ' maksimal 200 karakter.');
      if (PortalCore.text(r[h]) !== v) { log.push(h + ': ' + (PortalCore.text(r[h]) || '-') + ' → ' + (v || '-')); r[h] = v; }
    });
    var ni = input.namaInduk == null ? null : PortalCore.text(input.namaInduk);
    if (ni !== null) {
      if (!ni) throw Error('Nama induk tidak boleh kosong.');
      var n = 0; g.rows.forEach(function (x) { if (PortalCore.text(x['KODE CUSTOMER']) === lama && PortalCore.text(x['NAMA INDUK CUSTOMER']) !== ni) { x['NAMA INDUK CUSTOMER'] = ni; n++; } });
      if (n) log.push('nama induk ' + lama + ' → ' + ni + ' (' + n + ' baris)');
    }
    var baru = PortalCore.text(input.indukBaru), pairs = [];
    if (baru && baru !== lama) {
      var e = indukCheck_(g, db, lama, baru); if (e) throw Error(e);
      pairs = [{ lama: lama, baru: baru }];
      var exists = g.rows.some(function (x) { return PortalCore.text(x['KODE CUSTOMER']) === baru; });
      if (!exists && PortalCore.text(input.namaIndukBaru)) g.rows.forEach(function (x) { if (PortalCore.text(x['KODE CUSTOMER']) === lama) x['NAMA INDUK CUSTOMER'] = PortalCore.text(input.namaIndukBaru); });
    }
    if (!log.length && !pairs.length) return { ok: true, nothing: true };
    var sheets = ['Master_Customer', INDUK_LOG].concat(INDUK_KEYED.map(function (c) { return c.sheet; })), before = {};
    sheets.forEach(function (s) { before[s] = readGrid_(s); });
    checkpoint_(u.nik, 'Edit dealer ' + uniq + ' · ' + reason);
    try {
      if (pairs.length) { indukRewrite_(g, pairs, db); log.push('ganti induk ' + lama + ' → ' + baru + ' (' + pairs[0].toko + ' toko)'); indukLogAppend_(pairs, u.nik, reason); }
      mcPut_(g);
      var meta = meta_(); validateConfigChange_(db, meta);
      publish_(meta, db.raw, db.coverage, u.nik, 'EDIT DEALER ' + uniq + ' · ' + reason);
    } catch (err) { sheets.forEach(function (s) { if (before[s]) restoreGrid_(s, before[s]); else if (s === INDUK_LOG) { var sh = book_().getSheetByName(s); if (sh) book_().deleteSheet(sh); } }); throw err; }
    audit_(u.nik, pairs.length ? 'INDUK_GANTI' : 'DEALER_EDIT', uniq + ' (' + (pairs.length ? baru : lama) + ') · ' + log.join('; ') + ' · ' + reason);
    return { ok: true, log: log };
  } finally { lock.releaseLock(); }
}

/* ===== Hapus dealer (hanya yang belum punya transaksi) ===== */
function dealerDeleteBlock_(db, g, uniq) {
  var r = g.rows.find(function (x) { return mcUniq_(x) === uniq; }); if (!r) return ['Dealer ' + uniq + ' tidak ditemukan.'];
  var k = PortalCore.text(r['KODE CUSTOMER']), tx = dealerTxCount_(db, k, uniq), b = [];
  if (tx.uniq) b.push('Punya ' + tx.uniq + ' baris transaksi ST — pakai Tutup dealer, jangan dihapus.');
  if (tx.so) b.push('Punya ' + tx.so + ' baris data SO — pakai Tutup dealer.');
  var last = g.rows.filter(function (x) { return PortalCore.text(x['KODE CUSTOMER']) === k; }).length === 1;
  if (last && k !== uniq && tx.induk > tx.uniq) b.push('Induk ' + k + ' masih punya transaksi lewat kode lama.');
  return b;
}
function apiDealerDelete(token, uniqs, reason) {
  reason = PortalCore.text(reason); if (reason.length < 5) throw Error('Isi alasan minimal 5 karakter.');
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var db = snapshot_(), u = adminGuard_(token, db), g = mcGrid_(), list = (Array.isArray(uniqs) ? uniqs : [uniqs]).map(PortalCore.text).filter(Boolean), ok = [], rejected = [];
    if (!list.length) throw Error('Isi kode uniq.'); if (list.length > 2000) throw Error('Maksimal 2.000 dealer sekali hapus.');
    list.forEach(function (x, i) {
      var r = g.rows.find(function (y) { return mcUniq_(y) === x; });
      var b = r && !mcCanEdit_(u, db, PortalCore.text(r['NIK SALES'])) ? ['Dealer di luar wilayah admin Anda.'] : dealerDeleteBlock_(db, g, x);
      if (b.length) rejected.push({ row: { KODE_UNIQ_CUSTOMER: x }, alasan: 'Baris ' + (i + 2) + ': ' + b.join(' '), solusi: /transaksi|SO/.test(b.join(' ')) ? 'Pakai Tutup dealer (data & histori tetap ada).' : /tidak ditemukan/.test(b.join(' ')) ? 'Cek kodenya (0 di depan hilang karena Excel?).' : 'Minta admin wilayah dealer itu.' });
      else ok.push(x);
    });
    if (!ok.length) return { deleted: 0, rejected: rejected.length, rejSample: rejected.slice(0, 20).map(function (x) { return { alasan: x.alasan, solusi: x.solusi }; }), rejFile: rejected.length ? (function () { try { return rejectBase64_('Hapus-Dealer.xlsx', ['KODE_UNIQ_CUSTOMER'], rejected); } catch (e) { return null; } })() : null };
    var before = readGrid_('Master_Customer'), set = {}; ok.forEach(function (x) { set[x] = 1; });
    checkpoint_(u.nik, 'Hapus dealer ' + ok.length + ' · ' + reason);
    try {
      g.rows = g.rows.filter(function (r) { return !set[mcUniq_(r)]; }); mcPut_(g);
      var meta = meta_(); validateConfigChange_(db, meta);
      publish_(meta, db.raw, db.coverage, u.nik, 'HAPUS DEALER ' + ok.length + ' · ' + reason);
    } catch (e) { restoreGrid_('Master_Customer', before); throw e; }
    audit_(u.nik, 'DEALER_HAPUS', ok.slice(0, 50).join(', ') + (ok.length > 50 ? ' …' : '') + ' (' + ok.length + ') · ' + reason);
    return { deleted: ok.length, rejected: rejected.length, rejSample: rejected.slice(0, 20).map(function (x) { return { alasan: x.alasan, solusi: x.solusi }; }), rejFile: rejected.length ? (function () { try { return rejectBase64_('Hapus-Dealer.xlsx', ['KODE_UNIQ_CUSTOMER'], rejected); } catch (e) { return null; } })() : null };
  } finally { lock.releaseLock(); }
}
function apiDealerDeleteCheck(token, uniq) { var db = snapshot_(); adminGuard_(token, db); return { block: dealerDeleteBlock_(db, mcGrid_(), PortalCore.text(uniq)) }; }

/* ===== Ganti kode induk massal ===== */
function indukBulkPlan_(db, g, rows) {
  var ok = [], rejected = [], seen = {};
  rows.forEach(function (o, i) {
    var lama = PortalCore.text(o['KODE INDUK LAMA']), baru = PortalCore.text(o['KODE INDUK BARU']), line = i + 2;
    if (!lama && !baru) return;
    var e = seen[lama] ? 'Kode induk lama ' + lama + ' dobel di file.' : indukCheck_(g, db, lama, baru);
    if (!e && ok.some(function (x) { return x.baru === lama || x.lama === baru; })) e = 'Berantai dengan baris lain (' + lama + ' / ' + baru + '). Pisah jadi 2 upload.';
    if (e) { rejected.push({ row: o, alasan: 'Baris ' + line + ': ' + e, solusi: /Transfer/.test(e) ? 'Transfer dealernya dulu supaya NIK sama.' : /tidak ada/.test(e) ? 'Cek kodenya (0 di depan hilang karena Excel?).' : 'Perbaiki baris ini.' }); return; }
    seen[lama] = 1; ok.push({ lama: lama, baru: baru, toko: g.rows.filter(function (r) { return PortalCore.text(r['KODE CUSTOMER']) === lama; }).length });
  });
  return { ok: ok, rejected: rejected };
}
function apiIndukBulkTemplate(token) { adminGuard_(token); return templateXlsx_('Template-Ganti-Kode-Induk.xlsx', 'Ganti_Induk', ['KODE INDUK LAMA', 'KODE INDUK BARU'], [['', '']], ['1 baris = 1 kode induk. Semua toko (kode uniq) di induk lama ikut pindah ke induk baru.', 'Induk baru boleh sudah ada (digabung) asal NIK Sales sama.', 'Transaksi lama tidak diubah; histori, DA & NOO otomatis dihitung ke induk baru.', 'Format kolom sebagai Teks supaya angka 0 di depan tidak hilang.']); }
function apiIndukBulkStage(form) {
  var db = snapshot_(), u = adminGuard_(form.token, db), parsed = bulkReadRows_(form.file, 'Ganti_Induk');
  ['KODE INDUK LAMA', 'KODE INDUK BARU'].forEach(function (h) { if (parsed.heads.indexOf(h) < 0) throw Error('Kolom wajib ' + h + '. Pakai template.'); });
  if (parsed.rows.length > 5000) throw Error('Maksimal 5.000 baris.');
  var g = mcGrid_(), plan = indukBulkPlan_(db, g, parsed.rows);
  if (u.role !== 'SUPER ADMIN') plan.ok = plan.ok.filter(function (p) { var r = g.rows.find(function (x) { return PortalCore.text(x['KODE CUSTOMER']) === p.lama; }); if (mcCanEdit_(u, db, PortalCore.text(r['NIK SALES']))) return true; plan.rejected.push({ row: { 'KODE INDUK LAMA': p.lama, 'KODE INDUK BARU': p.baru }, alasan: p.lama + ': di luar wilayah admin Anda.', solusi: 'Minta admin wilayahnya.' }); return false; });
  var id = Utilities.getUuid();
  props_().setProperty('INDUK_BULK_' + id, writeJson_('induk-bulk-' + id, { actor: u.nik, created: Date.now(), rows: parsed.rows, rejected: plan.rejected, heads: parsed.heads }));
  return { id: id, total: plan.ok.length, toko: plan.ok.reduce(function (s, p) { return s + p.toko; }, 0), sample: plan.ok.slice(0, 50), rejected: plan.rejected.length, rejSample: plan.rejected.slice(0, 20).map(function (x) { return { alasan: x.alasan, solusi: x.solusi }; }) };
}
function apiIndukBulkRejected(token, id) { var u = adminGuard_(token), ptr = props_().getProperty('INDUK_BULK_' + id); if (!ptr) throw Error('Pratinjau tidak tersedia.'); var s = readJson_(ptr); if (s.actor !== u.nik) throw Error('Bukan pratinjau Anda.'); return rejectBase64_('Ganti-Kode-Induk.xlsx', s.heads, s.rejected); }
function apiIndukBulkCommit(token, id, reason) {
  reason = PortalCore.text(reason); if (reason.length < 5) throw Error('Isi alasan minimal 5 karakter.');
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var db = snapshot_(), u = adminGuard_(token, db), ptr = props_().getProperty('INDUK_BULK_' + id); if (!ptr) throw Error('Pratinjau tidak tersedia.');
    var s = readJson_(ptr); if (s.actor !== u.nik || Date.now() - s.created > 3600000) throw Error('Pratinjau kedaluwarsa. Upload ulang.');
    var g = mcGrid_(), plan = indukBulkPlan_(db, g, s.rows);
    plan.ok = plan.ok.filter(function (p) { var r = g.rows.find(function (x) { return PortalCore.text(x['KODE CUSTOMER']) === p.lama; }); return mcCanEdit_(u, db, PortalCore.text(r['NIK SALES'])); });
    if (!plan.ok.length) throw Error('Tidak ada baris yang bisa diproses.');
    var sheets = ['Master_Customer', INDUK_LOG].concat(INDUK_KEYED.map(function (c) { return c.sheet; })), before = {};
    sheets.forEach(function (x) { before[x] = readGrid_(x); });
    checkpoint_(u.nik, 'Ganti kode induk massal ' + plan.ok.length + ' · ' + reason);
    try {
      indukRewrite_(g, plan.ok, db); indukLogAppend_(plan.ok, u.nik, reason); mcPut_(g);
      var meta = meta_(); validateConfigChange_(db, meta);
      publish_(meta, db.raw, db.coverage, u.nik, 'GANTI INDUK ' + plan.ok.length + ' · ' + reason);
    } catch (e) { sheets.forEach(function (x) { if (before[x]) restoreGrid_(x, before[x]); else if (x === INDUK_LOG) { var sh = book_().getSheetByName(x); if (sh) book_().deleteSheet(sh); } }); throw e; }
    audit_(u.nik, 'INDUK_GANTI', plan.ok.slice(0, 30).map(function (p) { return p.lama + '→' + p.baru; }).join(', ') + ' (' + plan.ok.length + ') · ' + reason);
    props_().deleteProperty('INDUK_BULK_' + id);
    return { ok: true, count: plan.ok.length };
  } finally { lock.releaseLock(); }
}

/* ===== Nama induk tidak seragam (untuk Cek Kesehatan) ===== */
function indukNameConflicts_() {
  var g = mcGrid_(), by = {};
  g.rows.forEach(function (r) { var k = PortalCore.text(r['KODE CUSTOMER']), n = PortalCore.text(r['NAMA INDUK CUSTOMER']); if (!k || !n) return; (by[k] = by[k] || {})[n] = (by[k][n] || 0) + 1; });
  return Object.keys(by).filter(function (k) { return Object.keys(by[k]).length > 1; }).map(function (k) { return { induk: k, names: Object.keys(by[k]), uniq: mcUniq_(g.rows.find(function (r) { return PortalCore.text(r['KODE CUSTOMER']) === k; })) }; });
}

/* ===== Export user + PIN sementara ===== */
function apiUserPinExport(token, gen) {
  var db = snapshot_(), u = adminGuard_(token, db), lock = null;
  if (gen) { lock = LockService.getScriptLock(); lock.waitLock(15000); }
  try {
    var g = readGrid_('_Auth') || [['NIK', 'SALT', 'PIN_HASH', 'AKTIF', 'VERSI', 'WAJIB_GANTI', 'GAGAL', 'LOCK_UNTIL']], h = g[0].map(PortalCore.text), ix = function (k) { return h.indexOf(k); };
    var rows = g.slice(1), byNik = {}; rows.forEach(function (r, i) { var k = PortalCore.text(r[ix('NIK')]); if (k && byNik[k] == null) byNik[k] = i; });
    var truthy = function (v) { return v === true || /^(TRUE|YA|1)$/i.test(String(v)); }, out = {}, made = 0;
    db.meta.people.filter(function (p) { return u.role === 'SUPER ADMIN' || canManageUser_(u, p); }).forEach(function (p) {
      var i = byNik[p.nik], r = i == null ? null : rows[i], st;
      if (r && !PortalCore.active(r[ix('AKTIF')]) && PortalCore.text(r[ix('PIN_HASH')])) st = 'NONAKTIF';
      else if (!r || !PortalCore.text(r[ix('PIN_HASH')])) st = 'BELUM ADA PIN';
      else if (truthy(r[ix('WAJIB_GANTI')])) st = 'SEMENTARA (BELUM LOGIN)';
      else st = 'SUDAH DIGANTI';
      var pin = '';
      if (gen && (st === 'BELUM ADA PIN' || st === 'SEMENTARA (BELUM LOGIN)')) {
        pin = randomPin_(); var salt = Utilities.getUuid();
        if (!r) { r = h.map(function () { return ''; }); r[ix('NIK')] = p.nik; r[ix('VERSI')] = 0; r[ix('GAGAL')] = 0; r[ix('LOCK_UNTIL')] = 0; rows.push(r); byNik[p.nik] = rows.length - 1; }
        r[ix('SALT')] = salt; r[ix('PIN_HASH')] = hash_(p.nik + '|' + salt + '|' + pin); r[ix('AKTIF')] = true; r[ix('VERSI')] = Number(r[ix('VERSI')] || 0) + 1; r[ix('WAJIB_GANTI')] = true; r[ix('GAGAL')] = 0; r[ix('LOCK_UNTIL')] = 0;
        st = 'SEMENTARA (BELUM LOGIN)'; made++;
      }
      out[p.nik] = { status: st, pin: pin };
    });
    if (made) {
      var before = readGrid_('_Auth'); checkpoint_(u.nik, 'Export user + ' + made + ' PIN sementara');
      try { putTable_('_Auth', g[0], rows); } catch (e) { if (before) restoreGrid_('_Auth', before); throw e; }
      try { authCacheClear_(); } catch (e) {}
      audit_(u.nik, 'EXPORT_PIN', made + ' PIN sementara dibuat untuk user yang belum pernah login');
    }
    return { users: out, made: made };
  } finally { if (lock) lock.releaseLock(); }
}
