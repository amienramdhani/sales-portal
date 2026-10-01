/* DealerUpload.gs — Upload dealer (tambah + edit) di aplikasi. Mesin sama dengan Sync Master Customer:
   kunci per baris ID_DEALER, kode baru = tambah, kode lama = update, NIK beda → Transfer, baris salah dilewati + file DITOLAK. */
var DEALER_UPLOAD_MAX = 20000;
function dealerUploadRead_(form) {
  var parsed = bulkReadRows_(form.file, 'Master_Customer');
  var heads = parsed.heads.map(PortalCore.text);
  if (heads.indexOf('KODE CUSTOMER') < 0) throw Error('Kolom wajib KODE CUSTOMER tidak ada. Pakai template / hasil Download data dealer.');
  if (parsed.rows.length > DEALER_UPLOAD_MAX) throw Error('Maksimal ' + DEALER_UPLOAD_MAX.toLocaleString('id-ID') + ' baris per file. Pecah jadi beberapa file.');
  if (!parsed.rows.length) throw Error('File kosong.');
  return { kind: 'CUSTOMER', heads: heads, objects: parsed.rows };
}
function apiDealerUploadStage(form) {
  var db = snapshot_(), u = guard_(form.token, true, false, db);
  var rd = dealerUploadRead_(form), name = PortalCore.text(form.file.getName ? form.file.getName() : 'upload.xlsx');
  var r = syncMaster_(rd, name, true), id = Utilities.getUuid();
  props_().setProperty('DEALER_UP_' + id, writeJson_('dealer-up-' + id, { actor: u.nik, base: db.id, created: Date.now(), name: name, rd: rd }));
  return { id: id, name: name, total: r.total, add: r.add, upd: r.upd, same: r.same, dupSame: r.dupSame, rejected: r.rejected.length, ignored: r.ignored || [], induk: r.induk || [], namaFix: r.namaFix || 0,
    sample: r.rejected.slice(0, 50).map(function (x) { return { kode: PortalCore.text(x.row['KODE CUSTOMER']), id: PortalCore.text(x.row.ID_DEALER), alasan: x.alasan, solusi: x.solusi }; }) };
}
function dealerUploadLoad_(token, id) {
  var db = snapshot_(), u = guard_(token, true, false, db), ptr = props_().getProperty('DEALER_UP_' + id);
  if (!ptr) throw Error('Pratinjau tidak tersedia / sudah dipakai. Periksa file lagi.');
  var s = readJson_(ptr); if (s.actor !== u.nik || Date.now() - s.created > 3600000) throw Error('Pratinjau kedaluwarsa. Periksa file lagi.');
  return { s: s, u: u, db: db };
}
function apiDealerUploadRejected(token, id) {
  var L = dealerUploadLoad_(token, id), r = syncMaster_(L.s.rd, L.s.name, true);
  if (!r.rejected.length) throw Error('Tidak ada baris ditolak.');
  return rejectBase64_(L.s.name, L.s.rd.heads, r.rejected);
}
function apiDealerUploadCommit(token, id, reason) {
  reason = PortalCore.text(reason); if (reason.length < 5) throw Error('Isi alasan minimal 5 karakter.');
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var L = dealerUploadLoad_(token, id), out = syncMaster_(L.s.rd, L.s.name);
    audit_(L.u.nik, 'DEALER_UPLOAD', L.s.name + ' · ' + out[0].note + ' · ' + reason);
    props_().deleteProperty('DEALER_UP_' + id);
    return { note: out[0].note, rejected: (out.rejected || []).length };
  } finally { lock.releaseLock(); }
}
function apiDealerDownloadAll(token) {
  var db = snapshot_(), u = guard_(token, true, false, db), g = readGrid_('Master_Customer');
  if (!g) throw Error('Master_Customer tidak ditemukan.');
  var heads = g[0].map(PortalCore.text), ni = heads.indexOf('NIK SALES'), rows = g.slice(1).filter(function (r) { return r.some(function (v) { return v !== '' && v != null; }); });
  if (u.role !== 'SUPER ADMIN') { var ok = {}; db.meta.people.forEach(function (p) { if (canManageUser_(u, p)) ok[p.nik] = 1; }); rows = rows.filter(function (r) { return ok[PortalCore.text(r[ni])]; }); }
  return templateXlsx_('Data-Dealer-' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyyMMdd') + '.xlsx', 'Master_Customer', uniqOutHeads_(heads), rows.map(function (r) { return r.map(function (v) { return v instanceof Date ? Utilities.formatDate(v, 'Asia/Jakarta', 'yyyy-MM-dd') : String(v == null ? '' : v); }); }),
    ['1 baris = 1 toko (KODE_UNIQ_CUSTOMER — kode yang dipakai di file ST, tidak pernah berubah). Tambah baris untuk toko baru, ubah isi untuk update. Sel kosong tidak menimpa isi lama.', 'KODE CUSTOMER = kode induk (untuk tabel & hitung DA). Ganti kode induk di sini → SEMUA toko di induk lama ikut pindah, histori tetap nyambung.', 'NAMA INDUK CUSTOMER diseragamkan per kode induk (pakai isi file ini).', 'NIK SALES jangan diubah di sini — pindah pemegang pakai Transfer dealer.', 'Format kolom kode (KODE_UNIQ_CUSTOMER, KODE CUSTOMER, NIK) sebagai Teks supaya angka 0 di depan tidak hilang.', 'Baris yang salah dilewati; download file DITOLAK di pratinjau untuk memperbaikinya.']);
}
