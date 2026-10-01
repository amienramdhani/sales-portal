/* TemplateGuide.gs — sheet PETUNJUK di semua template: catatan, tabel "Arti kolom" (Kolom | Isi | Contoh), dan contoh isian.
   Dipakai otomatis oleh templateXlsx_ berdasarkan nama sheet data. */
var TEMPLATE_GUIDE = {
  Master_Grade: { title: 'Master Grade dealer per brand', cols: [
    ['ID DEALER', 'Kode dealer, harus ada di Master_Customer. Satu dealer satu baris', 'C0001'],
    ['NAMA DEALER', 'Bantu baca saja, tidak dibaca sistem', 'Mitra Cell Sumber'],
    ['GRADE <BRAND>', 'Grade dealer di brand itu (teks bebas, maks 20 karakter). Kosong = tidak ada grade', 'A']],
    exHeads: ['ID DEALER', 'NAMA DEALER', 'GRADE ITEL', 'GRADE MOTOROLA', 'GRADE VILLAON'],
    ex: [['C0001', 'Mitra Cell Sumber', 'A', 'B', 'GOLD'], ['C0045', 'Maju Jaya', 'C', '', '']] },
  Master_Promotor: { title: 'Master Promotor (dealer ber-promotor)', cols: [
    ['ID DEALER', 'Kode dealer, harus ada di Master_Customer. Satu dealer satu baris', 'C0001'],
    ['NAMA DEALER', 'Bantu baca saja, tidak dibaca sistem', 'Mitra Cell Sumber'],
    ['PROMOTOR <BRAND>', 'Jumlah promotor brand itu di dealer (angka bulat). Kosong = 0. Boleh tambah kolom brand baru / kompetitor', '1']],
    exHeads: ['ID DEALER', 'NAMA DEALER', 'PROMOTOR ITEL', 'PROMOTOR MOTOROLA', 'PROMOTOR VIVO'],
    ex: [['C0001', 'Mitra Cell Sumber', '1', '1', ''], ['C0045', 'Maju Jaya', '2', '', '1'], ['C0090', 'Sinar Phone', '', '', '']],
    notes: ['Baris dengan semua kolom brand kosong tetap BER-PROMOTOR (brand belum diisi).'] },
  Master_Transaksi: { title: 'Upload SELL THRU (ST)', cols: [
    ['TANGGAL TRANSAKSI', 'Tanggal transaksi, format YYYY-MM-DD', '2026-10-01'],
    ['BADAN USAHA', 'Nama badan usaha penjual', 'PT MSI'],
    ['NO TRANSAKSI', 'Nomor faktur / transaksi', 'INV/2610/0001'],
    ['NOMOR SJ', 'Nomor surat jalan (boleh kosong)', 'SJ/2610/0001'],
    ['KODE GUDANG', 'Kode gudang asal barang', 'GD-CRB'],
    ['KODE PRODUK', 'Kode barang, harus ada di Master_Product', 'SKU1'],
    ['KODE CUSTOMER', 'Kode dealer, harus ada di Master_Customer', 'C0001'],
    ['NIK SALES', 'NIK sales pemegang dealer', '2002'],
    ['QTY', 'Jumlah unit. Retur pakai angka minus. Tidak boleh 0', '2'],
    ['AMOUNT', 'Nilai rupiah transaksi, tanpa titik/Rp', '5400000']],
    ex: [['2026-10-01', 'PT MSI', 'INV/2610/0001', 'SJ/2610/0001', 'GD-CRB', 'SKU1', 'C0001', '2002', '2', '5400000'],
         ['2026-10-02', 'PT MSI', 'RTR/2610/0003', '', 'GD-CRB', 'SKU1', 'C0001', '2002', '-1', '-2700000']] },
  Master_SO: { title: 'Upload SELL OUT (SO)', cols: [
    ['KODE CUSTOMER', 'Kode dealer, harus ada di Master_Customer', 'C0001'],
    ['TANGGAL SO', 'Tanggal barang terjual di dealer, YYYY-MM-DD', '2026-10-03'],
    ['KODE PRODUK', 'Kode barang, harus ada di Master_Product', 'SKU1'],
    ['QTY', 'Jumlah unit terjual ke konsumen', '1']],
    ex: [['C0001', '2026-10-03', 'SKU1', '1'], ['C0001', '2026-10-03', 'SKU7', '2']] },
  Master_Customer: { title: 'Edit massal dealer', cols: [
    ['KODE CUSTOMER', 'Kunci dealer. JANGAN diubah', 'C0001'],
    ['NAMA CUSTOMER', 'Nama toko/outlet', 'Mitra Cell Sumber'],
    ['NAMA INDUK CUSTOMER', 'Nama induk kalau satu pemilik punya beberapa outlet', 'Mitra Group'],
    ['NIK SALES', 'Pemegang dealer. JANGAN diubah di sini — pakai Transfer Dealer', '2002'],
    ['REGION', 'Region dealer', 'CIREBON'],
    ['KOTA', 'Kota / kecamatan', 'Sumber'],
    ['NAMA PIC', 'Nama pemilik / kontak', 'Budi Ramadhan'],
    ['ALAMAT', 'Alamat lengkap', 'Jl. Sudirman No. 52'],
    ['No. HP', 'Nomor WhatsApp, awali 08 atau 62', '081234567890'],
    ['ID_DEALER', 'Kode lama/alias, pisahkan | kalau lebih dari satu', 'C0001|MCS-01']],
    notes: ['Hanya ubah kolom yang perlu. Baris yang tidak berubah otomatis dilewati.'] },
  Transfer_Dealer: { title: 'Transfer dealer ke sales lain', cols: [
    ['KODE CUSTOMER', 'Kode dealer yang dipindah', 'C0001'],
    ['NEW_SALES_NIK', 'NIK sales tujuan', '2003'],
    ['EFFECTIVE_DATE', 'Mulai berlaku, YYYY-MM-DD', '2026-10-01'],
    ['NOTE', 'Alasan (boleh kosong)', 'Rotasi area']],
    ex: [['C0001', '2003', '2026-10-01', 'Rotasi area'], ['C0015', '2003', '2026-10-01', '']],
    notes: ['Transaksi lama tetap milik sales lama; mulai EFFECTIVE_DATE tercatat ke sales baru.'] },
  Master_Product: { title: 'Master Product', cols: [
    ['KODE BARANG', 'Kunci produk, sama dengan KODE PRODUK di transaksi', 'SKU1'],
    ['NAMA BARANG', 'Nama lengkap barang', 'ITEL A70 4/128'],
    ['BRAND', 'Brand, harus ada di Product_Rules', 'ITEL'],
    ['TYPE', 'Type/seri — dipakai TYPE_FILTER di KPI, tulis konsisten', 'A70 4/128']],
    ex: [['SKU101', 'ITEL A70 4/128', 'ITEL', 'A70 4/128'], ['SKU102', 'ITEL SPARK 20 8/256', 'ITEL', 'SPARK 20']] },
  Target_Input: { title: 'Target bulanan per Sales', cols: [
    ['PERIODE TARGET', 'Bulan target, format YYYY-MM', '2026-10'],
    ['NIK SALES', 'NIK sales', '2002'],
    ['NAMA SALES', 'Info saja, tidak dibaca sistem', 'Rina Wulandari'],
    ['ST <BRAND>', 'Target SELL THRU (unit) brand itu', 'ST ITEL = 120'],
    ['DA <BRAND>', 'Target dealer aktif brand itu', 'DA ITEL = 30'],
    ['NOO <BRAND>', 'Target dealer baru (kolom opsional, tambah kalau brand punya target NOO)', 'NOO ITEL = 3'],
    ['OMZET <BRAND>', 'Target omzet rupiah (kolom opsional)', 'OMZET ITEL = 250000000']],
    notes: ['KOSONG = target belum diisi (KPI jadi "belum lengkap"). 0 = memang tidak diwajibkan.',
            'Brand baru: tambah kolom ke samping, misal "ST BRANDBARU" dan "DA BRANDBARU".',
            'Nama kolom tidak boleh dobel. Brand ALL = total semua brand.'],
    exHeads: ['PERIODE TARGET', 'NIK SALES', 'NAMA SALES', 'ST ITEL', 'ST VILLAON', 'DA ITEL', 'DA VILLAON', 'NOO ITEL'],
    ex: [['2026-10', '2002', 'Rina Wulandari', '120', '40', '30', '12', '3'], ['2026-10', '2003', 'Dedi Kurnia', '100', '0', '25', '', '']] },
  Target_Periode: { title: 'Target khusus KPI (pakai INDIKATOR_ID)', cols: [
    ['PERIODE', 'Bulan, format YYYY-MM', '2026-10'],
    ['NIK', 'NIK sales', '2002'],
    ['BRAND', 'Harus sama dengan BRAND di KPI_Config', 'ITEL'],
    ['METRIK', 'Harus sama dengan METRIK di KPI_Config: QTY / DA', 'QTY'],
    ['INDIKATOR_ID', 'Harus sama persis dengan INDIKATOR_ID di KPI_Config', 'ITEL_SPARK'],
    ['TARGET', 'Angka target', '25']],
    notes: ['Target rutin (tanpa INDIKATOR_ID) diisi di Target Bulanan per Sales, bukan di sini.'],
    ex: [['2026-10', '2002', 'ITEL', 'QTY', 'ITEL_SPARK', '25'], ['2026-10', '2002', 'VILLAON', 'DA', 'DA_VILLAON_3', '8']] },
  KPI_Config: { title: 'Konfigurasi KPI', cols: [
    ['PERIODE', 'Bulan berlaku, format YYYY-MM', '2026-10'],
    ['WILAYAH_KPI', 'Nama Big Region, persis sama seperti di master', 'JABAR TIMUR'],
    ['KELOMPOK_KPI', 'Nama kelompok, bebas', 'SELL THRU, COVERAGE, EKSPANSI'],
    ['METRIK', 'QTY (SELL THRU unit), DA, NOO, atau OMZET', 'QTY'],
    ['BRAND', 'Nama brand, atau ALL untuk semua brand', 'ITEL'],
    ['BOBOT', 'Bobot di dalam kelompoknya (buat total per kelompok = 100)', '50'],
    ['BATAS_SKOR', 'Skor maksimal per indikator, dalam %', '120'],
    ['AKTIF', 'TRUE dipakai, FALSE dimatikan', 'TRUE'],
    ['INDIKATOR_ID', 'Kosong untuk indikator biasa. WAJIB diisi kalau pakai TYPE_FILTER atau DA minimal ≠ 2', 'ITEL_SPARK'],
    ['LABEL', 'Nama yang tampil di portal', 'QTY Itel Spark 20'],
    ['TYPE_FILTER', 'Type tertentu, lebih dari satu dipisah |. Cuma untuk QTY atau DA. Harus persis sama dengan TYPE di Master_Product', 'SPARK 20|SPARK 20 PRO'],
    ['MIN_QTY_DA', 'Minimal unit supaya dealer dihitung aktif. Kosong = 2', '3']],
    notes: ['Skor indikator = capai % (dibatasi BATAS_SKOR). Skor kelompok = rata-rata tertimbang BOBOT. Skor akhir = rata-rata semua kelompok.',
            'Indikator dengan INDIKATOR_ID butuh target sendiri di "Target Khusus KPI" (lihat tabel paling bawah).'],
    ex: [['2026-10', 'JABAR TIMUR', 'SELL THRU', 'QTY', 'ALL', '50', '120', 'TRUE', '', 'QTY All Brand', '', ''],
         ['2026-10', 'JABAR TIMUR', 'SELL THRU', 'QTY', 'ITEL', '30', '120', 'TRUE', '', 'QTY Itel', '', ''],
         ['2026-10', 'JABAR TIMUR', 'SELL THRU', 'QTY', 'ITEL', '20', '120', 'TRUE', 'ITEL_SPARK', 'QTY Itel Spark 20', 'SPARK 20|SPARK 20 PRO', ''],
         ['2026-10', 'JABAR TIMUR', 'COVERAGE', 'DA', 'ALL', '60', '110', 'TRUE', '', 'Dealer Aktif', '', ''],
         ['2026-10', 'JABAR TIMUR', 'COVERAGE', 'DA', 'VILLAON', '40', '110', 'TRUE', 'DA_VILLAON_3', 'DA Villaon min 3 unit', '', '3'],
         ['2026-10', 'JABAR TIMUR', 'EKSPANSI', 'NOO', 'ALL', '100', '100', 'TRUE', '', 'NOO All Brand', '', '']],
    extra: [{ title: 'Contoh target untuk indikator khusus (diisi di Target Khusus KPI)', heads: ['PERIODE', 'NIK', 'BRAND', 'METRIK', 'INDIKATOR_ID', 'TARGET'],
      rows: [['2026-10', '2002', 'ITEL', 'QTY', 'ITEL_SPARK', '25'], ['2026-10', '2002', 'VILLAON', 'DA', 'DA_VILLAON_3', '8'], ['2026-10', '2003', 'ITEL', 'QTY', 'ITEL_SPARK', '20']] }] },
  Product_Rules: { title: 'Product Rules (daftar brand)', cols: [
    ['BRAND', 'Nama brand seperti di Master_Product', 'ITEL'],
    ['BRAND_UTAMA', 'Brand induk untuk pengelompokan (biasanya sama)', 'ITEL'],
    ['MASUK_QTY', 'TRUE = dihitung sebagai unit perangkat (SELL THRU). FALSE = aksesori, tidak dihitung unit', 'TRUE']],
    ex: [['ITEL', 'ITEL', 'TRUE'], ['ITEL ACC', 'ITEL', 'FALSE']] },
  Region_Map: { title: 'Region Map', cols: [
    ['REGION', 'Nama region / sub region operasional', 'CIREBON'],
    ['WILAYAH_KPI', 'Big Region tempat region itu bernaung', 'JABAR TIMUR'],
    ['KANAL', 'Kosong = penjualan sales. ONLINE = penjualan online (ikut total nasional untuk RGM ke atas, tidak dihitung DEALER AKTIF / NOO / SELL OUT / ranking / KPI)', 'ONLINE']],
    ex: [['CIREBON', 'JABAR TIMUR', ''], ['KUNINGAN', 'JABAR TIMUR', ''], ['ONLINE TECNO', 'ONLINE TECNO', 'ONLINE']] },
  DOS_Config: { title: 'Batas DOS', cols: [
    ['WILAYAH', 'Big Region, atau ALL untuk default semua wilayah', 'ALL'],
    ['DOS_MIN', 'Di bawah angka ini stok dianggap kurang (hari)', '7'],
    ['DOS_MAX', 'Di atas angka ini stok dianggap berlebih (hari)', '45']],
    ex: [['ALL', '7', '45'], ['JABAR TIMUR', '10', '40']] },
  Master_Sales: { title: 'Struktur organisasi', cols: [
    ['NIK KARYAWAN', 'NIK user yang sudah ada', '2002'],
    ['POSISI', 'SALES, ASM, RGM, HEAD OF SALES, CHIEF OPERATING OFFICER, CHIEF COMMERCIAL OFFICER, ADMIN, SUPER ADMIN', 'SALES'],
    ['REGION', 'Region operasional (lihat Region_Map)', 'CIREBON'],
    ['NIK ATASAN', 'NIK atasan langsung', '2001']],
    notes: ['Hanya untuk mengubah user yang sudah ada. User baru pakai Tambah user massal.'],
    ex: [['2002', 'SALES', 'CIREBON', '2001'], ['2001', 'ASM', 'CIREBON', '2000']] },
  Template_Dealer: { title: 'Tambah dealer baru', cols: [
    ['KODE CUSTOMER', 'WAJIB. Kode unik dealer; kode yang sudah ada ditolak', 'C0501'],
    ['NAMA INDUK CUSTOMER', 'WAJIB. Nama toko / induk', 'Berkah Cell'],
    ['NIK SALES', 'WAJIB. NIK sales pemegang', '2002'],
    ['ID_DEALER', 'Opsional. Kode lama/alias', 'BC-01'],
    ['KOTA', 'Opsional', 'Sumber'],
    ['ALAMAT', 'Opsional', 'Jl. Merdeka 10'],
    ['No. HP', 'Opsional. Nomor WhatsApp, awali 08/62', '081234567890'],
    ['SUB REGION', 'Opsional. Info tambahan', 'CIREBON']],
    notes: ['Maksimal 500 dealer per file. Satu baris tidak valid membatalkan seluruh upload.', 'Menambah dealer tidak otomatis jadi NOO; NOO dihitung dari transaksi pertama per brand.'],
    ex: [['C0501', 'Berkah Cell', '2002', 'BC-01', 'Sumber', 'Jl. Merdeka 10', '081234567890', 'CIREBON']] },
  Template_User: { title: 'Tambah user massal', cols: [
    ['NIK', 'NIK karyawan baru (teks)', '2010'],
    ['NAMA', 'Nama lengkap', 'Siti Aminah'],
    ['POSISI', 'SALES, ASM, RGM, HEAD OF SALES, ADMIN, dst', 'SALES'],
    ['REGION', 'Region operasional di Region_Map', 'CIREBON'],
    ['NIK_ATASAN', 'NIK atasan langsung (boleh atasan yang ada di file yang sama)', '2001'],
    ['WILAYAH_ADMIN', 'Khusus ADMIN: wilayah yang dikelola, pisahkan |', 'JABAR TIMUR|JABAR BARAT']],
    notes: ['Maksimal 100 user per file. NIK yang sudah ada dilewati.', 'Role rangkap: buat user dulu, lalu edit lewat aplikasi.'],
    ex: [['2010', 'Siti Aminah', 'SALES', 'CIREBON', '2001', ''], ['9001', 'Admin Jabar', 'ADMIN', '', '1002', 'JABAR TIMUR|JABAR BARAT']] }
};
function templateGuideWrite_(ss, sheet, heads, notes) {
  var g = TEMPLATE_GUIDE[sheet]; if (!g && !(notes && notes.length)) return;
  var ns = ss.insertSheet('PETUNJUK'), r = 1, W = 4;
  var put = function (vals, style) {
    var w = Math.max(W, vals.length); if (ns.getMaxColumns() < w) ns.insertColumnsAfter(ns.getMaxColumns(), w - ns.getMaxColumns());
    var rg = ns.getRange(r, 1, 1, vals.length).setNumberFormat('@').setValues([vals.map(function (x) { return x == null ? '' : String(x); })]).setFontFamily('Calibri').setFontSize(11).setVerticalAlignment('top').setWrap(true);
    if (style === 'title') rg.setFontSize(14).setFontWeight('bold').setFontColor('#10394E');
    if (style === 'sec') rg.setFontWeight('bold').setFontColor('#10394E');
    if (style === 'head') rg.setBackground('#10394E').setFontColor('#ffffff').setFontWeight('bold');
    if (style === 'row') rg.setBorder(true, true, true, true, true, true, '#D5DEE8', SpreadsheetApp.BorderStyle.SOLID);
    if (style === 'ex') rg.setBackground('#F4F8FD').setBorder(true, true, true, true, true, true, '#D5DEE8', SpreadsheetApp.BorderStyle.SOLID);
    r++;
  };
  put(['PETUNJUK · ' + (g ? g.title : sheet)], 'title'); r++;
  (notes || []).concat(g && g.notes ? g.notes : []).forEach(function (n) { put(['• ' + n]); });
  put(['• Isi data di sheet "' + sheet + '" mulai baris 2. Jangan ubah nama kolom. Sheet PETUNJUK ini tidak dibaca sistem.']);
  if (g) {
    r++; put(['Arti kolom'], 'sec'); put(['Kolom', 'Isi', 'Contoh'], 'head');
    g.cols.forEach(function (c) { put(c, 'row'); });
    if (g.ex && g.ex.length) { r++; put(['Contoh isian'], 'sec'); var ord = g.exHeads || g.cols.map(function (c) { return c[0]; }), eh = g.exHeads || (heads && heads.length > 1 ? heads : ord);
      put(eh, 'head'); g.ex.forEach(function (x) { put(eh.map(function (h) { var i = ord.indexOf(h); return i < 0 ? '' : x[i]; }), 'ex'); }); }
    (g.extra || []).forEach(function (t) { r++; put([t.title], 'sec'); put(t.heads, 'head'); t.rows.forEach(function (x) { put(x, 'ex'); }); });
  }
  ns.setColumnWidth(1, 190); ns.setColumnWidth(2, 420); ns.setColumnWidth(3, 230);
  for (var c = 4; c <= ns.getMaxColumns(); c++) ns.setColumnWidth(c, 130);
  ns.setHiddenGridlines(true);
}
