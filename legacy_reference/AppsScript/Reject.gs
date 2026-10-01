/* Reject.gs — file DITOLAK: baris asli persis + kolom ALASAN & SOLUSI, supaya bisa langsung diperbaiki lalu diupload ulang. */
function rejectXlsxBlob_(fileName, heads, rejected) {
  var base = String(fileName || 'upload').replace(/\.(xlsx|csv)$/i, ''), stamp = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyyMMdd-HHmm');
  var name = 'DITOLAK-' + base + '-' + stamp + '.xlsx', H = heads.filter(function (h) { return h; }).concat(['ALASAN', 'SOLUSI']);
  var ss = SpreadsheetApp.create('TMP_REJ_' + Date.now()), id = ss.getId();
  try {
    ss.setSpreadsheetTimeZone('Asia/Jakarta');
    var sh = ss.getSheets()[0]; sh.setName('DITOLAK');
    var data = [H].concat(rejected.map(function (x) { return H.slice(0, -2).map(function (h) { var v = x.row[h]; return v == null ? '' : String(v); }).concat([x.alasan || '', x.solusi || '']); }));
    sh.getRange(1, 1, data.length, H.length).setNumberFormat('@').setValues(data).setFontFamily('Calibri').setFontSize(11);
    sh.getRange(1, 1, 1, H.length).setBackground('#10394E').setFontColor('#ffffff').setFontWeight('bold');
    if (data.length > 1) {
      sh.getRange(2, H.length - 1, data.length - 1, 1).setBackground('#FEE2E2').setFontColor('#991B1B').setFontWeight('bold');
      sh.getRange(2, H.length, data.length - 1, 1).setBackground('#E0F2FE').setFontColor('#075985');
    }
    sh.setFrozenRows(1); sh.autoResizeColumns(1, H.length); sh.setColumnWidth(H.length - 1, 320); sh.setColumnWidth(H.length, 380);
    var info = ss.insertSheet('PETUNJUK');
    info.getRange(1, 1, 4, 1).setValues([['Baris di sheet DITOLAK ditolak saat upload/sync. Baris lain di file asli SUDAH diproses.'], ['Perbaiki sesuai kolom SOLUSI, lalu hapus kolom ALASAN & SOLUSI (boleh juga dibiarkan — diabaikan saat upload).'], ['Upload / taruh ulang file ini ke folder Sync "1. MASUK" atau menu upload yang sama.'], ['Jumlah baris ditolak: ' + rejected.length]]);
    SpreadsheetApp.flush();
    var blob = exportGoogleSheetXlsx_(id).setName(name);
    return blob;
  } finally { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {} }
}
function rejectBase64_(fileName, heads, rejected) {
  var b = rejectXlsxBlob_(fileName, heads, rejected);
  return { name: b.getName(), mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: Utilities.base64Encode(b.getBytes()) };
}
/* Kode yang kemungkinan dirusak Excel: 008.070 → 8.07, 001.365 → 1.365 */
function excelCodeNorm_(k) {
  var m = /^0*(\d+)\.(\d+?)0*$/.exec(String(k || '').trim());
  return m ? m[1] + '.' + m[2] : null;
}
function excelMangledMap_(codes) {
  var out = {};
  (codes || []).forEach(function (c) { c = String(c || '').trim(); var n = excelCodeNorm_(c); if (n && n !== c && !out[n]) out[n] = c; });
  return out;
}

/* ST/SO tetap ketat (1 baris salah = file tidak diproses), tapi SEMUA baris bermasalah dikumpulkan jadi file DITOLAK. */
function strictSolusi_(msg) {
  msg = String(msg || '');
  if (/luar bulan/i.test(msg)) return 'Tanggal di luar bulan yang diproses. Periksa kolom tanggal / pisahkan file per bulan.';
  if (/cutoff/i.test(msg)) return 'Tanggal melewati batas impor. Periksa tanggal transaksi.';
  if (/KODE PRODUK .* tidak ada/i.test(msg)) return 'Daftarkan kode produk ini di Master Product (Sync-Master-Product) lalu upload ulang. Cek juga 0 di depan yang hilang karena Excel.';
  if (/NIK SALES .* tidak dikenal/i.test(msg)) return 'Dealer ini belum terdaftar di Master Customer, jadi NIK tidak bisa diganti otomatis ke pemegang dealer. Daftarkan dealernya (Upload dealer / Sync Master Customer) lalu upload ulang.';
  if (/Referensi transaksi tidak valid/i.test(msg)) return 'Kode dealer / kode barang / NIK tidak dikenal. Daftarkan dulu (Upload dealer / Master Product) atau perbaiki kodenya. Cek juga kode yang rusak diolah Excel (0 di depan hilang).';
  if (/Qty\/amount|Angka tidak valid/i.test(msg)) return 'Isi QTY dan AMOUNT dengan angka yang valid.';
  if (/Tanda qty/i.test(msg)) return 'QTY dan AMOUNT harus sama-sama positif (jual) atau sama-sama negatif (retur).';
  if (/duplikat/i.test(msg)) return 'Hapus baris kembar, atau isi kolom ID_BARIS unik kalau memang transaksi terpisah.';
  if (/terpetakan/i.test(msg)) return 'Dealer belum punya Big Region. Pastikan dealer ada di Master_Customer dengan NIK Sales yang benar, atau atur di Admin › Big Region per dealer.';
  return 'Periksa isi baris ini sesuai template.';
}
function strictScan_(kind, objects, meta, parse, maxRej) {
  maxRej = maxRej || 300;
  var idx = objects.map(function (_, i) { return i; }), rejected = [], guard = 0;
  while (guard++ < maxRej + 5) {
    try { parse(idx.map(function (i) { return objects[i]; })); return { rejected: rejected, stopped: false }; }
    catch (e) {
      var msg = String(e && e.message || e), m = msg.match(/[Bb]aris(?: transaksi duplikat)? (\d+)|pada baris (\d+)/);
      var n = m ? +(m[1] || m[2]) : 0;
      if (!n || n - 2 >= idx.length) {
        // pesan tanpa nomor baris → cek satu per satu
        var keep = [], found = 0;
        idx.forEach(function (i) { if (rejected.length >= maxRej) { keep.push(i); return; } try { parse([objects[i]]); keep.push(i); } catch (x) { var mm = String(x && x.message || x); found++; rejected.push({ row: objects[i], line: i + 2, alasan: 'Baris ' + (i + 2) + ': ' + mm.replace(/\s*\(baris \d+\)/i, '').replace(/\s*(pada )?baris \d+/i, '').replace(/^Baris \d+:?\s*/i, ''), solusi: strictSolusi_(mm) }); } });
        if (!found) return { rejected: rejected, stopped: true, error: msg };
        idx = keep; if (rejected.length >= maxRej) return { rejected: rejected, stopped: true, error: 'Lebih dari ' + maxRej + ' baris bermasalah — perbaiki dulu yang ini.' };
        continue;
      }
      var orig = idx[n - 2]; rejected.push({ row: objects[orig], line: orig + 2, alasan: 'Baris ' + (orig + 2) + ': ' + (/duplikat/i.test(msg) ? 'transaksi kembar dengan baris lain di file ini' : msg).replace(/\s*\(baris \d+\)/i, '').replace(/\s*(pada )?baris \d+/i, '').replace(/^Baris \d+:?\s*/i, ''), solusi: strictSolusi_(msg) });
      idx.splice(n - 2, 1);
      if (rejected.length >= maxRej) return { rejected: rejected, stopped: true, error: 'Lebih dari ' + maxRej + ' baris bermasalah — perbaiki dulu yang ini.' };
    }
  }
  return { rejected: rejected, stopped: true };
}
