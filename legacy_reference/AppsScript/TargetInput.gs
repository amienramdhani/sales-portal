/* TargetInput.gs — target per Sales format melebar: 1 baris = 1 sales × 1 periode.
   Header: PERIODE TARGET | NIK SALES | NAMA SALES | ST <BRAND> | DA <BRAND> | NOO <BRAND> | OMZET <BRAND> ...
   Kosong = target belum diisi, 0 = tidak diwajibkan. Target khusus KPI (INDIKATOR_ID) tetap di Target_Periode. */
var TARGET_INPUT = 'Target_Input', TARGET_INPUT_FIXED = ['PERIODE TARGET', 'NIK SALES', 'NAMA SALES'];
var TARGET_INPUT_METRIC = { ST: 'QTY', DA: 'DA', NOO: 'NOO', OMZET: 'OMZET' };
function targetInputCols_(heads) {
  var seen = {}, cols = [];
  heads.forEach(function (h, i) {
    h = PortalCore.text(h).toUpperCase().replace(/\s+/g, ' ');
    if (!h) return;
    if (seen[h]) throw Error('Target_Input: kolom "' + h + '" dobel (kolom ' + (seen[h]) + ' dan ' + (i + 1) + ').');
    seen[h] = i + 1;
    if (TARGET_INPUT_FIXED.indexOf(h) >= 0) return;
    var m = h.match(/^(ST|DA|NOO|OMZET) (.+)$/);
    if (!m) throw Error('Target_Input: header "' + h + '" tidak dikenali. Pakai format ST <BRAND>, DA <BRAND>, NOO <BRAND>, atau OMZET <BRAND>.');
    cols.push({ i: i, metric: TARGET_INPUT_METRIC[m[1]], brand: m[2].trim() });
  });
  ['PERIODE TARGET', 'NIK SALES'].forEach(function (k) { if (!seen[k]) throw Error('Target_Input: kolom wajib ' + k + ' tidak ada.'); });
  return { cols: cols, pIdx: seen['PERIODE TARGET'] - 1, nIdx: seen['NIK SALES'] - 1 };
}
function targetWide_() {
  var sh = book_().getSheetByName(TARGET_INPUT); if (!sh) return [];
  var v = sh.getDataRange().getValues(); if (v.length < 2) return [];
  var c = targetInputCols_(v[0]), out = [];
  v.slice(1).forEach(function (r, ri) {
    if (!r.some(function (x) { return x !== '' && x !== null; })) return;
    var p = r[c.pIdx] instanceof Date ? Utilities.formatDate(r[c.pIdx], 'Asia/Jakarta', 'yyyy-MM-dd') : PortalCore.text(r[c.pIdx]), nik = PortalCore.text(r[c.nIdx]);
    if (!p || !nik) throw Error('Target_Input baris ' + (ri + 2) + ': PERIODE TARGET dan NIK SALES wajib diisi.');
    c.cols.forEach(function (col) {
      var x = r[col.i]; if (x === '' || x === null) return;
      var n = Number(String(x).replace(/[^0-9.\-]/g, ''));
      if (!isFinite(n) || n < 0) throw Error('Target_Input baris ' + (ri + 2) + ': nilai "' + x + '" di kolom ' + (col.i + 1) + ' tidak valid.');
      out.push({ PERIODE: p, NIK: nik, BRAND: col.brand, METRIK: col.metric, INDIKATOR_ID: '', TARGET: n });
    });
  });
  return out;
}
function targetInputHeads_(db) {
  var sh = book_().getSheetByName(TARGET_INPUT);
  if (sh && sh.getLastColumn()) return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(PortalCore.text).filter(Boolean);
  var brands = anaDeviceBrands_(db.meta), heads = TARGET_INPUT_FIXED.slice();
  brands.forEach(function (b) { heads.push('ST ' + b); }); brands.forEach(function (b) { heads.push('DA ' + b); });
  putTable_(TARGET_INPUT, heads, []);
  return heads;
}
function targetInputTemplate_(db) {
  var heads = targetInputHeads_(db), period = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM');
  var rows = db.meta.people.filter(function (p) { return p.sales; }).sort(function (a, b) { return String(a.nama).localeCompare(String(b.nama)); })
    .map(function (p) { return heads.map(function (h, i) { return i === 0 ? period : i === 1 ? p.nik : i === 2 ? p.nama : ''; }); });
  return templateXlsx_('Template-Target.xlsx', TARGET_INPUT, heads, rows, [
    '1 baris = 1 sales untuk 1 periode. PERIODE TARGET format YYYY-MM.',
    'Kolom target: ST <BRAND> = SELL THRU (unit), DA <BRAND> = Dealer Aktif, NOO <BRAND>, OMZET <BRAND>.',
    'Brand baru: tambah kolom di sheet Target_Input (misal "ST BRANDBARU") lalu download template lagi.',
    'KOSONG = target belum diisi (KPI jadi "belum lengkap"). 0 = memang tidak diwajibkan.',
    'Key upsert: PERIODE TARGET + NIK SALES. Baris yang sama akan menimpa isi lama.',
    'Target khusus KPI (INDIKATOR_ID) tetap lewat "Target Khusus KPI".']);
}

/* ===== MIGRASI SEKALI JALAN: Target_Periode (format lama) → Target_Input (format baru) =====
   Jalankan dari editor Apps Script: pilih fungsi migrasiTargetKeInput → Run.
   - Backup otomatis (checkpoint) sebelum mengubah apa pun.
   - Semua target rutin (INDIKATOR_ID kosong) dipindah ke Target_Input, lalu dihapus dari Target_Periode.
   - Target khusus KPI (INDIKATOR_ID terisi) TETAP di Target_Periode.
   - Hasil divalidasi & dipublikasikan; kalau gagal, kedua sheet dikembalikan seperti semula. */
function migrasiTargetKeInput() {
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var old = snapshot_(), meta = old.meta, nama = {};
    meta.people.forEach(function (p) { nama[p.nik] = p.nama; });
    var beforeP = readGrid_('Target_Periode'), beforeI = readGrid_(TARGET_INPUT);
    var lama = table_('Target_Periode'), keep = [], rows = {}, cols = {}, order = [], moved = 0;
    var REV = { QTY: 'ST', DA: 'DA', NOO: 'NOO', OMZET: 'OMZET' };
    var addCol = function (h) { if (!cols[h]) { cols[h] = 1; order.push(h); } };
    // mulai dari isi Target_Input yang sudah ada (kalau ada)
    if (beforeI && beforeI.length) {
      var hI = beforeI[0].map(PortalCore.text);
      hI.slice(3).forEach(function (h) { if (h) addCol(h.toUpperCase()); });
      beforeI.slice(1).forEach(function (r) {
        if (!r.some(function (x) { return x !== '' && x !== null; })) return;
        var p = PortalCore.month(r[0] instanceof Date ? Utilities.formatDate(r[0], 'Asia/Jakarta', 'yyyy-MM') : PortalCore.text(r[0])), nik = PortalCore.text(r[1]), o = rows[p + '|' + nik] = { p: p, nik: nik, v: {} };
        hI.forEach(function (h, i) { if (i >= 3 && h && r[i] !== '' && r[i] !== null) o.v[h.toUpperCase()] = r[i]; });
      });
    }
    lama.forEach(function (r) {
      if (PortalCore.text(r.INDIKATOR_ID)) { keep.push(r); return; }
      var m = REV[PortalCore.text(r.METRIK).toUpperCase()]; if (!m) { keep.push(r); return; }
      var p = PortalCore.month(r.PERIODE), nik = PortalCore.text(r.NIK), h = m + ' ' + PortalCore.text(r.BRAND).toUpperCase();
      var o = rows[p + '|' + nik] || (rows[p + '|' + nik] = { p: p, nik: nik, v: {} });
      if (o.v[h] !== undefined && o.v[h] !== '') throw Error('Target dobel: ' + p + ' ' + nik + ' ' + h + ' sudah ada di Target_Input. Hapus salah satu dulu.');
      o.v[h] = r.TARGET; addCol(h); moved++;
    });
    if (!moved) { SpreadsheetApp.getUi().alert('Tidak ada target rutin di Target_Periode yang perlu dipindah.'); return; }
    // urutkan kolom: ST dulu, lalu DA, NOO, OMZET; di dalamnya per brand
    var rank = { ST: 0, DA: 1, NOO: 2, OMZET: 3 };
    order.sort(function (a, b) { var ma = a.split(' ')[0], mb = b.split(' ')[0]; return (rank[ma] - rank[mb]) || a.localeCompare(b); });
    var heads = TARGET_INPUT_FIXED.concat(order);
    var data = Object.keys(rows).map(function (k) { return rows[k]; }).sort(function (a, b) { return a.p.localeCompare(b.p) || String(nama[a.nik] || '').localeCompare(String(nama[b.nik] || '')); })
      .map(function (o) { return [o.p, o.nik, nama[o.nik] || ''].concat(order.map(function (h) { return o.v[h] === undefined ? '' : o.v[h]; })); });
    var hP = beforeP[0].map(PortalCore.text);
    checkpoint_('EDITOR', 'Migrasi Target_Periode ke Target_Input');
    try {
      putTable_(TARGET_INPUT, heads, data);
      putTable_('Target_Periode', hP, keep.map(function (r) { return hP.map(function (h) { return r[h] === undefined ? '' : r[h]; }); }));
      var m2 = meta_();
      publish_(m2, old.raw, old.coverage, 'EDITOR', 'Migrasi target ke Target_Input (' + moved + ' baris)');
    } catch (e) { restoreGrid_('Target_Periode', beforeP); if (beforeI) restoreGrid_(TARGET_INPUT, beforeI); else { var sh = book_().getSheetByName(TARGET_INPUT); if (sh) book_().deleteSheet(sh); } throw e; }
    SpreadsheetApp.getUi().alert('Migrasi selesai.\n\n' + moved + ' baris target dipindah → ' + data.length + ' baris di Target_Input (' + order.length + ' kolom target).\n' + keep.length + ' target khusus KPI tetap di Target_Periode.\n\nAngka di portal tidak berubah. Deploy tidak perlu.');
  } finally { lock.releaseLock(); }
}
