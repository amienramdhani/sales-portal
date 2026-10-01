/* AccountStatus.gs — Update status akun massal (AKTIF / NONAKTIF) dari file Export daftar user.
   Hanya kolom NIK & STATUS AKUN yang dibaca. Baris salah dilewati + file DITOLAK. */
function statusBulkPlan_(parsed, db, u) {
  var heads = parsed.heads.map(function (h) { return PortalCore.text(h).toUpperCase().replace(/\s+/g, ' '); });
  var hn = parsed.heads[heads.indexOf('NIK')] , hs = parsed.heads[heads.indexOf('STATUS AKUN')] || parsed.heads[heads.indexOf('STATUS')];
  if (!hn || !hs) throw Error('Kolom wajib NIK dan STATUS AKUN. Pakai file dari tombol Export daftar user.');
  if (parsed.rows.length > 1000) throw Error('Maksimal 1.000 baris per file.');
  var auth = {}; (table_('_Auth') || []).forEach(function (a) { var k = PortalCore.text(a.NIK); if (k && !auth[k]) auth[k] = a; });
  var supers = db.meta.people.filter(function (p) { return p.role === 'SUPER ADMIN' && auth[p.nik] && PortalCore.active(auth[p.nik].AKTIF); }).map(function (p) { return p.nik; });
  var seen = {}, changes = [], rejected = [], same = 0;
  parsed.rows.forEach(function (r) {
    var nik = PortalCore.text(r[hn]), st = PortalCore.text(r[hs]).toUpperCase(), rej = function (a, s) { rejected.push({ row: r, alasan: a, solusi: s }); };
    if (!nik && !st) return;
    if (!nik) return rej('NIK kosong.', 'Isi NIK.');
    if (seen[nik]) return rej('NIK ' + nik + ' dobel di file.', 'Sisakan satu baris.'); seen[nik] = 1;
    if (['AKTIF', 'NONAKTIF'].indexOf(st) < 0) return rej('STATUS AKUN "' + r[hs] + '" tidak dikenal.', 'Isi AKTIF atau NONAKTIF.');
    var p = db.meta.people.find(function (x) { return x.nik === nik; });
    if (!p) return rej('NIK ' + nik + ' tidak terdaftar.', 'Daftarkan dulu lewat Tambah user massal.');
    if (!canManageUser_(u, p)) return rej('NIK ' + nik + ' di luar wilayah tugas Anda.', 'Minta Super Admin mengubahnya.');
    var a = auth[nik], now = !!(a && PortalCore.active(a.AKTIF)), want = st === 'AKTIF';
    if (now === want && (!want || (a && a.PIN_HASH))) { same++; return; }
    if (nik === u.nik && !want) return rej('Tidak bisa menonaktifkan akun sendiri.', 'Hapus baris ini.');
    if (!want && p.role === 'SUPER ADMIN' && supers.filter(function (x) { return x !== nik; }).length === 0) return rej('Super Admin aktif terakhir harus dipertahankan.', 'Hapus baris ini.');
    if (!want) supers = supers.filter(function (x) { return x !== nik; });
    if (/^VAC/i.test(nik) && want) return rej('NIK VACANT tidak boleh diaktifkan (tidak untuk login).', 'Biarkan NONAKTIF / tanpa PIN.');
    changes.push({ nik: nik, nama: p.nama, role: p.role, from: now ? 'AKTIF' : 'NONAKTIF', to: st, newPin: want && !(a && a.PIN_HASH) });
  });
  return { changes: changes, rejected: rejected, same: same, heads: parsed.heads };
}
function apiStatusBulkStage(form) {
  var db = snapshot_(), u = adminGuard_(form.token, db), parsed = bulkReadRows_(form.file, ''), plan = statusBulkPlan_(parsed, db, u), id = Utilities.getUuid();
  props_().setProperty('STATUS_STAGE_' + id, writeJson_('status-stage-' + id, { actor: u.nik, created: Date.now(), plan: plan, name: form.file.getName ? form.file.getName() : 'status.xlsx' }));
  return { id: id, same: plan.same, changes: plan.changes, rejected: plan.rejected.length, rejectedSample: plan.rejected.slice(0, 50).map(function (x) { return { nik: PortalCore.text(x.row.NIK), alasan: x.alasan, solusi: x.solusi }; }) };
}
function statusStageLoad_(token, id) {
  var db = snapshot_(), u = adminGuard_(token, db), ptr = props_().getProperty('STATUS_STAGE_' + id);
  if (!ptr) throw Error('Pratinjau tidak tersedia. Periksa file lagi.');
  var s = readJson_(ptr); if (s.actor !== u.nik || Date.now() - s.created > 3600000) throw Error('Pratinjau kedaluwarsa. Periksa file lagi.');
  return { s: s, u: u, db: db };
}
function apiStatusBulkRejected(token, id) { var L = statusStageLoad_(token, id); if (!L.s.plan.rejected.length) throw Error('Tidak ada baris ditolak.'); return rejectBase64_(L.s.name, L.s.plan.heads, L.s.plan.rejected); }
function apiStatusBulkCommit(token, id, reason) {
  reason = PortalCore.text(reason); if (reason.length < 5) throw Error('Isi alasan minimal 5 karakter.');
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var L = statusStageLoad_(token, id), ch = L.s.plan.changes; if (!ch.length) throw Error('Tidak ada perubahan.');
    checkpoint_(L.u.nik, 'Update status akun massal ' + ch.length + ' · ' + reason);
    var sh = book_().getSheetByName('_Auth'), pins = [];
    ch.forEach(function (c) { if (c.newPin) { var pin = randomPin_(); setPin_(c.nik, pin, true); pins.push({ nik: c.nik, nama: c.nama, role: c.role, pin: pin }); } });
    if (ch.some(function (c) { return !c.newPin; })) { var fresh = sh.getDataRange().getValues(); fresh.forEach(function (r, n) { if (n > 0) r[0] = PortalCore.text(r[0]); }); ch.forEach(function (c) { if (c.newPin) return; var i = fresh.findIndex(function (r, n) { return n > 0 && PortalCore.text(r[0]) === c.nik; }); if (i > 0) { fresh[i][3] = c.to === 'AKTIF'; fresh[i][4] = Number(fresh[i][4] || 0) + 1; } }); sh.getRange(1, 1, fresh.length, fresh[0].length).setNumberFormat('@').setValues(fresh.map(function (r) { return r.map(function (x) { return x === true ? 'TRUE' : x === false ? 'FALSE' : x; }); })); }
    try { authCacheClear_(); } catch (e) {}
    audit_(L.u.nik, 'ACCOUNT_STATUS_BULK', ch.length + ' akun (' + ch.filter(function (c) { return c.to === 'AKTIF'; }).length + ' aktif / ' + ch.filter(function (c) { return c.to === 'NONAKTIF'; }).length + ' nonaktif) · ' + reason);
    props_().deleteProperty('STATUS_STAGE_' + id);
    return { updated: ch.length, pins: L.u.role === 'SUPER ADMIN' ? pins : pins.map(function (p) { return { nik: p.nik, nama: p.nama, role: p.role, pin: '(hanya Super Admin)' }; }) };
  } finally { lock.releaseLock(); }
}
