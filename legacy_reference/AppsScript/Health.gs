/* Health.gs — Cek Kesehatan Master: cek semua master sekaligus (membaca sheet langsung, bukan snapshot,
   supaya tetap jalan walau publish sedang gagal). Tiap masalah punya langkah, tingkat, cara benerin. */
var HEALTH_STEPS = [
  { id: 1, name: 'Region Map' }, { id: 2, name: 'User & struktur' }, { id: 3, name: 'Product' },
  { id: 4, name: 'Master Customer' }, { id: 5, name: 'Pemegang dealer' }, { id: 6, name: 'ST → SO' }
];
function healthLev_(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 9;
  var d = [], i, j; for (i = 0; i <= a.length; i++) { d[i] = [i]; }
  for (j = 0; j <= b.length; j++) d[0][j] = j;
  for (i = 1; i <= a.length; i++) for (j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function apiHealthCheck(token) {
  var u = guard_(token, true);
  var T = PortalCore.text, up = function (x) { return T(x).toUpperCase(); }, issues = [], started = Date.now();
  var add = function (step, level, problem, fix, action, detail) { issues.push({ step: step, level: level, problem: problem, fix: fix, action: action || '', detail: detail || '' }); };
  var safe = function (n) { try { return table_(n); } catch (e) { return null; } };
  // 1 · Region Map
  var rm = safe('Region_Map') || [], rmap = {}, rkeys = [];
  if (!rm.length) add(1, 'r', 'Sheet Region_Map kosong / tidak ada.', 'Isi Region Map di Admin › Master › Region Map.', 'regionmap');
  rm.forEach(function (r) {
    var k = T(r.REGION); if (!k) return;
    if (rmap[up(k)]) add(1, 'r', 'REGION dobel di Region Map: ' + k, 'Hapus salah satu di Admin › Master › Region Map.', 'regionmap');
    rmap[up(k)] = T(r.WILAYAH_KPI); rkeys.push(k);
    if (!T(r.WILAYAH_KPI)) add(1, 'r', 'REGION ' + k + ' belum punya Big Region (WILAYAH_KPI).', 'Isi Big Region-nya di Region Map.', 'regionmap');
  });
  for (var i = 0; i < rkeys.length; i++) for (var j = i + 1; j < rkeys.length; j++) {
    var a = up(rkeys[i]), b = up(rkeys[j]);
    if (a !== b && a.length >= 6 && healthLev_(a, b) === 1) add(1, 'o', 'Region mirip (kemungkinan typo): ' + rkeys[i] + ' vs ' + rkeys[j], 'Kalau salah satunya typo, hapus/ganti di Region Map (region yang dipakai user tidak bisa dihapus — pindahkan user dulu).', 'regionmap');
  }
  // 2 · User & struktur
  var ms = safe('Master_Sales') || [], auth = {}, people = {}, byName = {};
  (safe('_Auth') || []).forEach(function (a) { auth[T(a.NIK)] = a; });
  var active = function (nik) { var a = auth[nik]; return !a || PortalCore.active(a.AKTIF); };
  try { var ag = readGrid_('_Auth') || [], seenA = {}; ag.slice(1).forEach(function (r) { var raw = String(r[0] == null ? '' : r[0]), k = raw.trim(); if (!k) return; if (raw !== k) add(2, 'o', 'Akun ' + k + ' di sheet _Auth tersimpan dengan spasi di NIK.', 'Aman setelah update ini (sudah otomatis dirapikan saat Update status massal). Kalau user itu tetap tidak bisa login, Reset PIN-nya.', 'users'); if (seenA[k]) add(2, 'o', 'NIK ' + k + ' dobel di sheet _Auth (' + (seenA[k] + 1) + ' baris).', 'Yang dipakai baris paling atas. Hapus baris bawah di sheet _Auth, lalu Reset PIN kalau user tidak bisa login.', 'users'); seenA[k] = (seenA[k] || 0) + 1; }); } catch (e) {}
  try { var rcMeta; try { rcMeta = meta_(); } catch (e2) { rcMeta = snapshot_().meta; } var rc = rgmConflicts_(rcMeta); Object.keys(rc).forEach(function (big) { var l = rc[big]; add(2, 'o', big + ' punya ' + l.length + ' RGM: ' + l.map(function (x) { return x.nama + ' (' + x.count + ' orang)'; }).join(', ') + '. Yang nyasar lewat: ' + l.slice(1).map(function (x) { return x.via.join(', '); }).join('; ') + '.', '1 Big Region hanya boleh 1 RGM. Perbaiki NIK ATASAN orang yang disebut (arahkan ke ASM/RGM ' + l[0].nama + '), atau perbaiki REGION-nya kalau dia sebenarnya bukan orang ' + big + '.', 'users'); }); } catch (e) {}
  ms.forEach(function (r, i) {
    var nik = T(r['NIK KARYAWAN']), role = (PortalCore.position ? PortalCore.position(r.POSISI, 2) : up(r.POSISI)), nama = T(r.SALES), reg = T(r.REGION), line = 'Master_Sales baris ' + (i + 2);
    if (!nik) { add(2, 'r', line + ': NIK kosong.', 'Isi NIK atau hapus barisnya lewat Struktur Organisasi.', 'users'); return; }
    if (!PortalCore.LEVEL[role]) add(2, 'r', nama + ' (' + nik + '): POSISI "' + r.POSISI + '" tidak dikenal.', 'Pakai salah satu: ' + Object.keys(PortalCore.LEVEL).join(', ') + '.', 'users');
    var p = people[nik];
    if (p) { if (p.nama !== nama) add(2, 'r', 'NIK ' + nik + ' punya dua nama: ' + p.nama + ' / ' + nama, 'Samakan nama, atau kalau beda orang ganti NIK salah satunya.', 'users');
      else if (p.roles.indexOf(role) >= 0) add(2, 'r', 'NIK ' + nik + ' (' + nama + ') jabatan ' + role + ' ditulis dua kali.', 'Hapus salah satu baris di Struktur Organisasi.', 'users');
      p.roles.push(role); if (role === 'SALES') { p.sales = true; p.portfolio = reg; } if ((PortalCore.LEVEL[role] || 0) > (PortalCore.LEVEL[p.role] || 0)) { p.role = role; p.region = reg; p.atasan = T(r['NIK ATASAN']); } }
    else people[nik] = { nik: nik, nama: nama, role: role, roles: [role], region: reg, atasan: T(r['NIK ATASAN']), sales: role === 'SALES', portfolio: role === 'SALES' ? reg : '' };
  });
  Object.keys(people).forEach(function (nik) {
    var p = people[nik], lv = PortalCore.LEVEL[p.role] || 0;
    (byName[up(p.nama)] = byName[up(p.nama)] || []).push(p);
    if (lv && lv < 4 && p.role !== 'ADMIN' && !rmap[up(p.region)] && !rmap[up(p.portfolio)]) add(2, 'r', p.nama + ' (' + nik + ', ' + p.role + '): REGION "' + (p.region || '(kosong)') + '" tidak ada di Region Map.', p.region ? 'Tambahkan "' + p.region + '" di Region Map, atau ganti REGION user ke region yang ada (isi region/sub region, bukan Big Region).' : 'Isi REGION user di Akun pengguna › Edit.', p.region ? 'regionmap' : 'users');
    else if (lv && lv < 4 && rmap[up(p.region)] === undefined && rkeys.some(function (k) { return up(k) === up(p.region) && k !== p.region; })) add(2, 'o', p.nama + ': REGION "' + p.region + '" beda huruf besar/kecil dengan Region Map.', 'Samakan penulisannya.', 'users');
    if (p.atasan === nik) add(2, 'r', p.nama + ' (' + nik + '): atasan menunjuk diri sendiri.', 'Ganti NIK ATASAN di Akun pengguna › Edit.', 'users');
    else if (p.atasan && !people[p.atasan]) add(2, 'r', p.nama + ' (' + nik + '): NIK ATASAN ' + p.atasan + ' tidak terdaftar.', 'Kalau itu akun dobel orang yang sama, pakai Gabung akun. Kalau salah ketik, ganti NIK ATASAN di Akun pengguna › Edit.', 'users');
    var seen = {}, n = nik; while (n && people[n] && !seen[n]) { seen[n] = 1; n = people[n].atasan; }
    if (n && seen[n]) add(2, 'r', p.nama + ' (' + nik + '): struktur atasan berputar (siklus).', 'Periksa NIK ATASAN berantai mulai dari ' + p.nama + '.', 'users');
    if (p.sales && !active(nik)) {}
  });
  Object.keys(byName).forEach(function (k) { var l = byName[k]; if (l.length > 1 && k) add(2, 'o', 'Nama sama, NIK beda (kemungkinan akun dobel): ' + l.map(function (p) { return p.nama + ' · ' + p.nik; }).join(' | '), 'Kalau orangnya sama, pakai Gabung akun (pertahankan NIK yang dipakai atasan/bawahan).', 'merge'); });
  var kids = {}; Object.keys(people).forEach(function (n) { var a = people[n].atasan; if (a) (kids[a] = kids[a] || []).push(n); });
  Object.keys(people).forEach(function (n) { var p = people[n]; if (p.role === 'ASM' && !(kids[n] || []).length && !p.sales) add(2, 'i', 'ASM ' + p.nama + ' belum punya sales di bawahnya.', 'Isi NIK ATASAN sales-nya ke ' + n + ', atau jadikan ASM rangkap sales / buat VACANT.', 'users'); });
  // 3 · Product
  var rules = {}; (safe('Product_Rules') || []).forEach(function (r) { rules[T(r.BRAND)] = 1; });
  var badB = {}; (safe('Master_Product') || []).forEach(function (r) { var b = T(r.BRAND); if (T(r['KODE BARANG']) && !rules[b]) badB[b] = (badB[b] || 0) + 1; });
  Object.keys(badB).forEach(function (b) { add(3, 'r', 'BRAND "' + (b || '(kosong)') + '" di Master Product belum ada di Product Rules (' + badB[b] + ' produk).', 'Tambah brand di Admin › Master › Product Rules (atau perbaiki BRAND produknya).', 'productrules'); });
  // 4 · Master Customer
  var mc = safe('Master_Customer') || [], kodeNik = {}, unk = {}, kodes = [], dealersOf = {};
  mc.forEach(function (r, i) {
    var kode = T(r['KODE CUSTOMER']), nik = T(r['NIK SALES']);
    if (!kode) { add(4, 'r', 'Master_Customer baris ' + (i + 2) + ': KODE CUSTOMER kosong.', 'Isi kodenya atau hapus barisnya.', 'dealer'); return; }
    kodes.push(kode);
    if (kodeNik[kode] !== undefined && kodeNik[kode] !== nik) add(4, 'r', 'Dealer ' + kode + ' punya dua pemegang (' + kodeNik[kode] + ' & ' + nik + ').', 'Satu dealer = satu NIK SALES. Samakan di Upload dealer.', 'dealer');
    kodeNik[kode] = nik;
    if (!people[nik]) unk[nik] = (unk[nik] || 0) + 1; else (dealersOf[nik] = dealersOf[nik] || {})[kode] = 1;
  });
  Object.keys(unk).sort(function (a, b) { return unk[b] - unk[a]; }).forEach(function (nik) { add(4, 'r', 'NIK SALES ' + (nik || '(kosong)') + ' memegang ' + unk[nik] + ' baris dealer tapi tidak terdaftar sebagai user.', 'Daftarkan NIK di Admin › User › Tambah user massal (POSISI SALES), atau pindahkan dealernya lewat Transfer dealer.', 'users'); });
  try { var nc = indukNameConflicts_(); nc.slice(0, 200).forEach(function (x) { add(4, 'o', 'Kode induk ' + x.induk + ' punya ' + x.names.length + ' nama induk berbeda: ' + x.names.join(' / ') + '.', 'Buka Admin › Dealer › Cari & edit dealer, cari ' + x.induk + ', isi Nama induk sekali (otomatis berlaku untuk semua toko di induk itu).', 'cari & edit'); }); if (nc.length > 200) add(4, 'o', '… dan ' + (nc.length - 200) + ' kode induk lain dengan nama tidak seragam.', 'Upload dealer dengan nama induk yang benar juga otomatis menyeragamkan.', 'cari & edit'); } catch (e) {}
  var mg = excelMangledMap_(kodes), km = {}; kodes.forEach(function (k) { km[k] = 1; });
  Object.keys(mg).forEach(function (n) { if (km[n]) add(4, 'o', 'Kode ' + n + ' dan ' + mg[n] + ' dua-duanya ada — kemungkinan ' + n + ' adalah ' + mg[n] + ' yang rusak oleh Excel.', 'Cek dealernya. Kalau sama, hapus/benerin kode ' + n + ' (format kolom kode = Teks di Excel).', 'dealer'); });
  // 5 · Pemegang dealer nonaktif
  Object.keys(dealersOf).forEach(function (nik) { var p = people[nik]; if (p && !active(nik) && !/^VAC/i.test(nik)) add(5, 'o', Object.keys(dealersOf[nik]).length + ' dealer dipegang ' + p.nama + ' (' + nik + ') yang akunnya NONAKTIF.', 'Transfer dealernya ke sales lain atau ke NIK VACANT area itu.', 'transfer'); });
  // 6 · info
  var snap = null; try { snap = snapshot_(); } catch (e) { add(6, 'r', 'Data aplikasi gagal dimuat: ' + (e && e.message || e), 'Bereskan dulu semua masalah merah di langkah 1–4, lalu publish ulang.', ''); }
  var info = { users: Object.keys(people).length, dealers: Object.keys(kodeNik).length, products: (safe('Master_Product') || []).length, regions: rkeys.length, ms: 0 };
  if (snap) { try { var last = Object.keys(snap.coverage || {}).sort().pop(); info.lastPeriod = last || ''; info.cutoff = last ? (snap.coverage[last] || {}).cutoff || '' : ''; } catch (e) {} }
  var vl = safe('Version_Log') || []; if (vl.length) { var lv2 = vl[vl.length - 1]; info.lastPublish = T(lv2.WAKTU || lv2.TIME || lv2.TANGGAL || ''); }
  info.ms = Date.now() - started;
  var steps = HEALTH_STEPS.map(function (s) { var l = issues.filter(function (x) { return x.step === s.id; }); return { id: s.id, name: s.name, red: l.filter(function (x) { return x.level === 'r'; }).length, orange: l.filter(function (x) { return x.level === 'o'; }).length, info: l.filter(function (x) { return x.level === 'i'; }).length }; });
  var order = { r: 0, o: 1, i: 2 }; issues.sort(function (a, b) { return a.step - b.step || order[a.level] - order[b.level]; });
  var firstRed = steps.filter(function (s) { return s.red; })[0];
  try { CacheService.getScriptCache().put('V6_HEALTH_SUM', JSON.stringify({ red: issues.filter(function (x) { return x.level === 'r'; }).length, orange: issues.filter(function (x) { return x.level === 'o'; }).length, at: Date.now() }), 21600); } catch (e) {}
  return { at: Utilities.formatDate(new Date(), 'Asia/Jakarta', 'dd/MM/yyyy HH:mm'), steps: steps, issues: issues.slice(0, 800), total: issues.length, next: firstRed ? 'Mulai dari langkah ' + firstRed.id + ' (' + firstRed.name + ') — masih ada ' + firstRed.red + ' masalah merah.' : (issues.some(function (x) { return x.level === 'o'; }) ? 'Tidak ada masalah merah. Cek yang oranye kalau sempat.' : 'Semua master sehat ✓'), info: info };
}
