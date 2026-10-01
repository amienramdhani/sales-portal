/* DealerTutup.gs — Dealer tutup: pengajuan sales, persetujuan admin, upload/download.
   File BARU. Menulis HANYA ke sheet Dealer_Tutup (dibuat otomatis). Transaksi & master tidak diubah.
   STATUS: PENGAJUAN (menunggu admin) · TUTUP (berlaku) · DITOLAK · DIBUKA (dibuka lagi). */
var DT_HEAD_ = ['KODE CUSTOMER', 'TANGGAL TUTUP', 'ALASAN', 'STATUS', 'DIAJUKAN_OLEH', 'DIAJUKAN_AT', 'DIPROSES_OLEH', 'DIPROSES_AT', 'CATATAN'];

function dtSheet_() {
  var sh = book_().getSheetByName('Dealer_Tutup');
  if (!sh) { sh = book_().insertSheet('Dealer_Tutup'); sh.getRange(1, 1, 1, DT_HEAD_.length).setValues([DT_HEAD_]); try { sh.setFrozenRows(1); } catch (e) {} }
  return sh;
}
function dtRows_() {
  var sh = book_().getSheetByName('Dealer_Tutup'); if (!sh) return [];
  var v = sh.getDataRange().getValues(); if (v.length < 2) return [];
  var h = v.shift().map(PortalCore.text), ix = function (k) { return h.indexOf(k); };
  return v.map(function (r, i) {
    var g = function (k) { var j = ix(k); return j < 0 ? '' : r[j]; }, d = g('TANGGAL TUTUP');
    return { row: i + 2, id: PortalCore.text(g('KODE CUSTOMER')), date: d instanceof Date ? Utilities.formatDate(d, 'Asia/Jakarta', 'yyyy-MM-dd') : PortalCore.iso(d),
      alasan: String(g('ALASAN') || ''), status: PortalCore.text(g('STATUS')) || 'TUTUP', by: PortalCore.text(g('DIAJUKAN_OLEH')), at: String(g('DIAJUKAN_AT') || ''),
      procBy: PortalCore.text(g('DIPROSES_OLEH')), procAt: String(g('DIPROSES_AT') || ''), note: String(g('CATATAN') || '') };
  }).filter(function (x) { return x.id; });
}
/* Peta dealer yang BERLAKU tutup: {id: tanggal}. Dipakai Analisa/Potensi/AI. */
function dtClosed_() {
  var cache = CacheService.getScriptCache(), hit = cache.get('V6_DEALER_TUTUP'); if (hit) return JSON.parse(hit);
  var out = {}; try { dtRows_().forEach(function (x) { if (x.status === 'TUTUP' && x.date) out[x.id] = x.date; }); } catch (e) {}
  cache.put('V6_DEALER_TUTUP', JSON.stringify(out), 600); return out;
}
function dtClear_() { try { CacheService.getScriptCache().remove('V6_DEALER_TUTUP'); } catch (e) {} }
function dtNow_() { return Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm'); }
function dtCtx_(token) {
  var source = snapshot_(), u = guard_(token, false, false, source), meta = source.meta, ids = allowed_(source, u, 'ALL'), set = {};
  ids.forEach(function (n) { set[n] = 1; });
  var admin = u.role === 'ADMIN' || u.role === 'SUPER ADMIN';
  var inScope = function (id) { var c = meta.customers[id]; if (!c) return false; return u.role === 'SUPER ADMIN' || !!set[c.nik]; };
  return { source: source, u: u, meta: meta, ids: ids, admin: admin, inScope: inScope };
}
function dtFind_(meta, code) { code = PortalCore.text(code); if (meta.customers[code]) return code; var hit = Object.keys(meta.customers).find(function (k) { return (meta.customers[k].aliases || []).indexOf(code) >= 0; }); return hit || ''; }
function dtName_(meta, nik) { var p = meta.people.find(function (x) { return x.nik === nik; }); return p ? p.nama + ' · ' + p.role : nik; }
function dtWrite_(rowNo, obj) {
  var sh = dtSheet_(), vals = DT_HEAD_.map(function (k) { return obj[k] == null ? '' : obj[k]; });
  if (rowNo) sh.getRange(rowNo, 1, 1, vals.length).setValues([vals]); else sh.appendRow(vals);
  dtClear_();
}
function dtObj_(x) { return { 'KODE CUSTOMER': x.id, 'TANGGAL TUTUP': x.date, 'ALASAN': x.alasan, 'STATUS': x.status, 'DIAJUKAN_OLEH': x.by, 'DIAJUKAN_AT': x.at, 'DIPROSES_OLEH': x.procBy, 'DIPROSES_AT': x.procAt, 'CATATAN': x.note }; }
function dtActive_(id) { return dtRows_().filter(function (x) { return x.id === id && (x.status === 'TUTUP' || x.status === 'PENGAJUAN'); }).pop() || null; }

/* Daftar untuk tampilan: semua baris dalam cakupan user + ST 3 bulan terakhir (untuk admin menilai). */
function apiDealerTutupList(token) {
  var c = dtCtx_(token), meta = c.meta, rows = dtRows_().filter(function (x) { return c.inScope(x.id); });
  var latest = {}; rows.forEach(function (x) { latest[x.id] = x; }); // baris terakhir per dealer = status saat ini
  var list = rows.map(function (x) {
    var cu = meta.customers[x.id] || {};
    return { row: x.row, id: x.id, nama: cu.nama || x.id, sub: cu.region || '', kota: cu.kota || '', date: x.date, alasan: x.alasan, status: x.status, current: latest[x.id] === x,
      by: x.by, byName: dtName_(meta, x.by), at: x.at, procBy: x.procBy, procName: x.procBy ? dtName_(meta, x.procBy) : '', procAt: x.procAt, note: x.note };
  });
  // ST 3 bulan terakhir untuk pengajuan yang menunggu
  var pend = list.filter(function (x) { return x.status === 'PENGAJUAN' && x.current; });
  if (pend.length) {
    try {
      var db = c.source, now = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM'), months = [anaPrev_(now, 2), anaPrev_(now, 1), now], allIds = meta.people.map(function (p) { return p.nik; }), want = {}, st = {};
      pend.forEach(function (x) { want[x.id] = 1; st[x.id] = [0, 0, 0]; });
      months.forEach(function (p, i) { var v; try { v = coverageView_(db, p, allIds, 'ST', c.u); } catch (e) { return; } if (!v.cubes || !v.cubes[p]) return; PortalCore.slice(v, p, allIds, null).forEach(function (r) { if (want[r.customer] && r.q > 0) st[r.customer][i] += r.q; }); });
      pend.forEach(function (x) { x.st3 = st[x.id]; x.st3Months = months; });
    } catch (e) {}
  }
  return { admin: c.admin, role: c.u.role, rows: list };
}
/* Sales: ajukan. Admin/Super Admin: langsung berlaku. */
function apiDealerTutupAjukan(token, id, tanggal, alasan) {
  var c = dtCtx_(token), meta = c.meta, lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    id = dtFind_(meta, id); if (!id || !c.inScope(id)) throw Error('Dealer tidak ditemukan dalam cakupan Anda.');
    var d = PortalCore.iso(tanggal), today = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd');
    if (!d) throw Error('Tanggal tutup tidak valid.'); if (d > today) throw Error('Tanggal tutup tidak boleh di masa depan.');
    alasan = String(alasan || '').trim().slice(0, 300); if (alasan.length < 3) throw Error('Alasan wajib diisi.');
    var cur = dtActive_(id); if (cur) throw Error(cur.status === 'TUTUP' ? 'Dealer ini sudah tercatat tutup.' : 'Dealer ini sudah punya pengajuan yang menunggu admin.');
    var x = { id: id, date: d, alasan: alasan, status: c.admin ? 'TUTUP' : 'PENGAJUAN', by: c.u.nik, at: dtNow_(), procBy: c.admin ? c.u.nik : '', procAt: c.admin ? dtNow_() : '', note: '' };
    dtWrite_(null, dtObj_(x)); audit_(c.u.nik, 'DEALER_TUTUP_' + x.status, id + ' ' + d + ' ' + alasan);
    return { ok: true, status: x.status };
  } finally { lock.releaseLock(); }
}
/* Admin: setujui / tolak pengajuan, atau buka lagi dealer yang tutup. */
function apiDealerTutupProses(token, row, aksi, catatan) {
  var c = dtCtx_(token), lock = LockService.getScriptLock(); if (!c.admin) throw Error('Akses admin diperlukan.'); lock.waitLock(10000);
  try {
    var x = dtRows_().find(function (r) { return r.row === Number(row); }); if (!x || !c.inScope(x.id)) throw Error('Data tidak ditemukan.');
    aksi = String(aksi || '').toUpperCase(); catatan = String(catatan || '').trim().slice(0, 300);
    if (aksi === 'SETUJU') { if (x.status !== 'PENGAJUAN') throw Error('Pengajuan sudah diproses.'); x.status = 'TUTUP'; }
    else if (aksi === 'TOLAK') { if (x.status !== 'PENGAJUAN') throw Error('Pengajuan sudah diproses.'); if (catatan.length < 3) throw Error('Alasan penolakan wajib diisi.'); x.status = 'DITOLAK'; }
    else if (aksi === 'BUKA') { if (x.status !== 'TUTUP') throw Error('Dealer ini tidak berstatus tutup.'); x.status = 'DIBUKA'; }
    else throw Error('Aksi tidak dikenal.');
    x.procBy = c.u.nik; x.procAt = dtNow_(); if (catatan) x.note = catatan;
    dtWrite_(x.row, dtObj_(x)); audit_(c.u.nik, 'DEALER_TUTUP_' + aksi, x.id + (catatan ? ' | ' + catatan : ''));
    return { ok: true, status: x.status };
  } finally { lock.releaseLock(); }
}
/* Upload massal (baris sudah dibaca di browser): commit=false → pratinjau saja. Hanya admin; langsung berlaku. */
function apiDealerTutupUpload(token, rows, commit) {
  var c = dtCtx_(token), meta = c.meta; if (!c.admin) throw Error('Akses admin diperlukan.');
  if (!Array.isArray(rows) || !rows.length) throw Error('File kosong.'); if (rows.length > 2000) throw Error('Maksimal 2.000 baris per upload.');
  var today = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd'), seen = {}, closedNow = {};
  dtRows_().forEach(function (x) { if (x.status === 'TUTUP' || x.status === 'PENGAJUAN') closedNow[x.id] = x.status; });
  var out = rows.map(function (r, i) {
    var code = PortalCore.text(r[0]), id = dtFind_(meta, code), d = PortalCore.iso(r[1]), alasan = String(r[2] || '').trim().slice(0, 300), err = '';
    if (!id) err = 'Kode tidak ada di Master_Customer'; else if (!c.inScope(id)) err = 'Di luar cakupan Anda';
    else if (!d) err = 'Tanggal tidak valid'; else if (d > today) err = 'Tanggal di masa depan';
    else if (alasan.length < 3) err = 'Alasan kosong'; else if (seen[id]) err = 'Kode dobel di file';
    else if (closedNow[id] === 'TUTUP') err = 'Sudah tercatat tutup';
    if (id) seen[id] = 1;
    return { line: i + 2, code: code, id: id, nama: id ? meta.customers[id].nama : '', date: d, alasan: alasan, error: err, replacesPending: closedNow[id] === 'PENGAJUAN' };
  });
  var ok = out.filter(function (x) { return !x.error; });
  if (!commit) return { rows: out, ok: ok.length, bad: out.length - ok.length };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var existing = dtRows_();
    ok.forEach(function (x) {
      var pend = existing.find(function (r) { return r.id === x.id && r.status === 'PENGAJUAN'; });
      var obj = { id: x.id, date: x.date, alasan: x.alasan, status: 'TUTUP', by: pend ? pend.by : c.u.nik, at: pend ? pend.at : dtNow_(), procBy: c.u.nik, procAt: dtNow_(), note: 'Upload massal' };
      if (pend) { obj.row = pend.row; dtWrite_(pend.row, dtObj_(obj)); } else dtWrite_(null, dtObj_(obj));
    });
    audit_(c.u.nik, 'DEALER_TUTUP_UPLOAD', ok.length + ' dealer');
  } finally { lock.releaseLock(); }
  return { saved: ok.length, skipped: out.length - ok.length, rows: out };
}
