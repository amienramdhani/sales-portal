/* RgmRule.gs — 1 Big Region hanya boleh 1 RGM (RGM boleh pegang beberapa Big Region).
   RGM sebuah Big Region = RGM yang ada di rantai atasan orang-orang ber-Big Region itu. */
function rgmMap_(meta) {
  var by = {}, out = {}; (meta.people || []).forEach(function (p) { by[p.nik] = p; });
  (meta.people || []).forEach(function (p) {
    var big = p.wilayah, n = p.nik, seen = {}; if (!big || p.role === 'RGM') return;
    while (n && by[n] && !seen[n]) { seen[n] = 1; var q = by[n]; if (q.role === 'RGM') { var o = out[big] || (out[big] = {}), r = o[q.nik] || (o[q.nik] = { nik: q.nik, nama: q.nama, count: 0, via: [] }); r.count++; if (r.via.length < 5) r.via.push(p.nama + ' (' + p.role + ')'); break; } n = q.atasan; }
  });
  return out;
}
function rgmConflicts_(meta) {
  var m = rgmMap_(meta), res = {};
  Object.keys(m).forEach(function (big) { var l = Object.keys(m[big]).map(function (k) { return m[big][k]; }); if (l.length > 1) res[big] = l.sort(function (a, b) { return b.count - a.count; }); });
  return res;
}
/* dipanggil saat simpan perubahan master: tolak hanya kalau perubahan ini MENAMBAH konflik baru */
function rgmRuleCheck_(oldMeta, meta) {
  var before = rgmConflicts_(oldMeta), after = rgmConflicts_(meta), errs = [];
  Object.keys(after).forEach(function (big) {
    var oldSet = (before[big] || []).map(function (x) { return x.nik; }).sort().join('|'), newSet = after[big].map(function (x) { return x.nik; }).sort().join('|');
    if (oldSet === newSet) return;
    var main = after[big][0];
    errs.push(big + ' jadi punya ' + after[big].length + ' RGM: ' + after[big].map(function (x) { return x.nama + ' (' + x.count + ' orang' + (x !== main ? ', lewat ' + x.via.join(', ') : '') + ')'; }).join(' & ') + '.');
  });
  if (errs.length) throw Error('Satu Big Region hanya boleh 1 RGM. ' + errs.join(' ') + ' Perbaiki NIK ATASAN / REGION orang tersebut.');
}
