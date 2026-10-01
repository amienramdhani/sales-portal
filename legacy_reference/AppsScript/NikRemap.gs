/* NikRemap.gs — NIK SALES yang TIDAK ada di Master_Sales (misal sales lama yang sudah resign)
   otomatis diganti ke pemegang dealer SEKARANG (Master_Customer). Dipakai di Sync, Impor ST, dan publish Master_Transaksi.
   Baris dengan dealer yang belum terdaftar dibiarkan (nanti ditolak dengan pesan biasa). */
function stRemapNik_(objects, meta) {
  var pids = {}; (meta.people || []).forEach(function (p) { pids[p.nik] = 1; });
  var cust = meta.customers || {}, pairs = {}, n = 0;
  (objects || []).forEach(function (o) {
    var nik = PortalCore.text(o['NIK SALES']); if (pids[nik]) return;
    var code = PortalCore.text(o['KODE CUSTOMER']), c = cust[code] || cust[custInduk_(meta, code)]; if (!c || !c.nik || !pids[c.nik]) return;
    o['NIK SALES'] = c.nik; n++; var k = (nik || '(kosong)') + ' → ' + c.nik; pairs[k] = (pairs[k] || 0) + 1;
  });
  var list = Object.keys(pairs).sort(function (a, b) { return pairs[b] - pairs[a]; });
  return { count: n, pairs: pairs, note: n ? n + ' baris NIK tidak terdaftar diganti ke pemegang dealer sekarang: ' + list.slice(0, 12).map(function (k) { return k + ' (' + pairs[k] + ')'; }).join(', ') + (list.length > 12 ? ', dst.' : '') : '' };
}
