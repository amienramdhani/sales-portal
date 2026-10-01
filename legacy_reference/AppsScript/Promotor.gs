/* Promotor.gs — atribut dealer per brand dari sheet sederhana (format wide), cache 10 menit.
   PROMOTOR → sheet Master_Promotor: ID DEALER | NAMA DEALER | PROMOTOR <BRAND> (jumlah orang, boleh kosong)
   GRADE    → sheet Master_Grade:    ID DEALER | NAMA DEALER | GRADE <BRAND>    (teks bebas: A, B, GOLD, …)
   Dealer yang tidak ada di sheet = tanpa promotor / tanpa grade. Upload mengganti seluruh isi sheet. */
var DEALER_ATTR = {
  PROMOTOR: { sheet: 'Master_Promotor', prefix: 'PROMOTOR', cache: 'V6_PROMOTOR', num: true, label: 'Master Promotor' },
  GRADE: { sheet: 'Master_Grade', prefix: 'GRADE', cache: 'V6_GRADE', num: false, label: 'Master Grade' }
};
var ATTR_KEY = 'ID DEALER';

function attrBrandHead_(cfg, h) { var m = new RegExp('^' + cfg.prefix + '\\s+(.+)$').exec(PortalCore.text(h).toUpperCase().replace(/\s+/g, ' ')); return m ? m[1].trim() : ''; }
function attrVal_(cfg, v) { if (cfg.num) { var n = Number(v); return n > 0 ? n : null; } v = PortalCore.text(v).toUpperCase().replace(/\s+/g, ' '); return v || null; }

/* { idDealer: { total, brands: [[BRAND, nilai], ...] } } */
function attrMap_(type) {
  var cfg = DEALER_ATTR[type], cache = CacheService.getScriptCache(), hit = cache.get(cfg.cache);
  if (hit) return JSON.parse(hit);
  var out = {};
  try {
    var grid = readGrid_(cfg.sheet);
    if (grid && grid.length) {
      var heads = grid[0].map(PortalCore.text), ki = heads.map(function (h) { return h.toUpperCase(); }).indexOf(ATTR_KEY);
      if (ki >= 0) grid.slice(1).forEach(function (r) {
        var id = PortalCore.text(r[ki]); if (!id) return;
        var brands = [];
        heads.forEach(function (h, i) { var b = attrBrandHead_(cfg, h), v = b ? attrVal_(cfg, r[i]) : null; if (v != null) brands.push([b, v]); });
        if (!cfg.num && !brands.length) return;
        out[id] = { total: cfg.num ? brands.reduce(function (s, x) { return s + x[1]; }, 0) : brands.length, brands: brands };
      });
    }
  } catch (e) {}
  try { cache.put(cfg.cache, JSON.stringify(out), 600); } catch (e) {}
  return out;
}
function promotorMap_() { return attrMap_('PROMOTOR'); }
function gradeMap_() { return attrMap_('GRADE'); }
function promotorAttach_(customers) {
  var p = promotorMap_(), g = gradeMap_();
  (customers || []).forEach(function (c) { c.promotor = p[c.id] || null; c.grade = g[c.id] ? g[c.id].brands : null; });
  return customers;
}

function attrHeads_(cfg) {
  var brands = [], add = function (b) { b = PortalCore.text(b).toUpperCase(); if (b && brands.indexOf(b) < 0) brands.push(b); };
  try { var g = readGrid_(cfg.sheet); if (g && g.length) g[0].forEach(function (h) { add(attrBrandHead_(cfg, h)); }); } catch (e) {}
  try { table_('Product_Rules').forEach(function (r) { add(r.BRAND); }); } catch (e) {}
  return [ATTR_KEY, 'NAMA DEALER'].concat(brands.map(function (b) { return cfg.prefix + ' ' + b; }));
}

function attrTemplate_(type) {
  var cfg = DEALER_ATTR[type], db = snapshot_(), heads = attrHeads_(cfg), rows = [];
  try {
    var g = readGrid_(cfg.sheet);
    if (g && g.length) {
      var gh = g[0].map(function (h) { var b = attrBrandHead_(cfg, h); return b ? cfg.prefix + ' ' + b : PortalCore.text(h).toUpperCase(); });
      g.slice(1).forEach(function (r) { var o = {}; gh.forEach(function (h, i) { o[h] = r[i]; }); var id = PortalCore.text(o[ATTR_KEY]); if (!id) return;
        rows.push(heads.map(function (h) { return h === 'NAMA DEALER' ? (db.meta.customers[id] && db.meta.customers[id].nama || PortalCore.text(o[h])) : (o[h] == null ? '' : String(o[h])); })); });
    }
  } catch (e) {}
  var notes = cfg.num
    ? ['Isi HANYA dealer yang punya promotor. Dealer yang tidak ada di file = tanpa promotor.',
       'Upload MENGGANTI seluruh isi sheet — hapus baris kalau promotor dealer itu sudah tidak ada.',
       'Kolom brand bebas: tambah kolom "PROMOTOR <BRAND>" untuk brand baru / kompetitor.',
       'Jumlah promotor boleh kosong — dealer tetap BER-PROMOTOR dengan keterangan "brand belum diisi".']
    : ['Isi dealer yang punya grade di minimal satu brand. Grade boleh beda format per brand (A/B/C, GOLD, dst).',
       'Upload MENGGANTI seluruh isi sheet — hapus baris / kosongkan sel kalau grade sudah tidak berlaku.',
       'Kolom brand bebas: tambah kolom "GRADE <BRAND>" untuk brand baru.'];
  return templateXlsx_('Template-' + cfg.sheet + '.xlsx', cfg.sheet, heads, rows, notes);
}

function attrValidate_(cfg, parsed, db) {
  var heads = parsed.heads.map(function (h) { return PortalCore.text(h).toUpperCase().replace(/\s+/g, ' '); }), kIdx = heads.indexOf(ATTR_KEY);
  if (kIdx < 0) throw Error('Kolom wajib ' + ATTR_KEY + '.');
  var bh = [], seenB = {};
  parsed.heads.forEach(function (h) { var b = attrBrandHead_(cfg, h); if (!b) return; if (seenB[b]) throw Error('Kolom ' + cfg.prefix + ' ' + b + ' dobel.'); seenB[b] = 1; bh.push([h, b]); });
  if (!bh.length) throw Error('Minimal satu kolom "' + cfg.prefix + ' <BRAND>".');
  if (parsed.rows.length > 10000) throw Error('Maksimal 10.000 baris.');
  var seen = {}, rows = [], rejected = [];
  parsed.rows.forEach(function (r, i) {
    var line = i + 2, id = PortalCore.text(r[parsed.heads[kIdx]]), errs = [], sol = [];
    var rj = function () { rejected.push({ row: r, id: id, alasan: 'Baris ' + line + ': ' + errs.join(' '), solusi: sol.join(' ') }); };
    if (!id) { if (bh.some(function (x) { return PortalCore.text(r[x[0]]); })) { errs.push('ID DEALER kosong.'); sol.push('Isi ID DEALER (lihat Download data dealer).'); rj(); } return; }
    if (seen[id]) { errs.push('ID DEALER ' + id + ' dobel.'); sol.push('Satu dealer cukup 1 baris — gabungkan isinya.'); rj(); return; } seen[id] = 1;
    if (!db.meta.customers[id]) { errs.push('ID DEALER ' + id + ' tidak ada di Master_Customer.'); sol.push('Cek kodenya (0 di depan hilang karena Excel?) atau daftarkan dealernya dulu.'); }
    var vals = {};
    bh.forEach(function (x) { var v = PortalCore.text(r[x[0]]); if (v === '') return;
      if (cfg.num) { var n = Number(v); if (!(n >= 0) || Math.floor(n) !== n) { errs.push(cfg.prefix + ' ' + x[1] + ' harus angka bulat ≥ 0 (isi: ' + v + ').'); sol.push('Isi jumlah orang, mis. 1 atau 2; kosongkan kalau tidak ada.'); } else vals[x[1]] = n; }
      else { if (v.length > 20) { errs.push(cfg.prefix + ' ' + x[1] + ' maksimal 20 karakter.'); sol.push('Singkat grade-nya, mis. A / B / GOLD.'); } else vals[x[1]] = v.toUpperCase().replace(/\s+/g, ' '); } });
    if (errs.length) { rj(); return; }
    rows.push({ id: id, nama: db.meta.customers[id] ? db.meta.customers[id].nama : '', vals: vals });
  });
  if (!rows.length && rejected.length) throw Error('Semua baris ditolak. Contoh: ' + rejected[0].alasan);
  return { brands: bh.map(function (x) { return x[1]; }), rows: rows, rejected: rejected, heads: parsed.heads };
}

function attrStage_(type, form) {
  var cfg = DEALER_ATTR[type], db = snapshot_(), u = guard_(form.token, true), parsed = bulkReadRows_(form.file, cfg.sheet), v = attrValidate_(cfg, parsed, db), old = attrMap_(type), id = Utilities.getUuid();
  var keepOld = v.rejected.filter(function (x) { return x.id && old[x.id] && !v.rows.some(function (r) { return r.id === x.id; }); }).map(function (x) { var o = old[x.id], vals = {}; o.brands.forEach(function (b) { vals[b[0]] = b[1]; }); return { id: x.id, nama: db.meta.customers[x.id] ? db.meta.customers[x.id].nama : '', vals: vals }; });
  keepOld.forEach(function (k) { Object.keys(k.vals).forEach(function (b) { if (v.brands.indexOf(b) < 0) v.brands.push(b); }); });
  v.keepOld = keepOld;
  props_().setProperty('MASTER_BULK_' + id, writeJson_('master-bulk-' + id, { actor: u.nik, base: db.id, created: Date.now(), type: type, data: v, rejected: v.rejected, heads: v.heads }));
  var prev = v.rows.map(function (r) {
    var o = old[r.id], nb = Object.keys(r.vals).filter(function (b) { return cfg.num ? r.vals[b] > 0 : !!r.vals[b]; }).map(function (b) { return [b, r.vals[b]]; }), vals = { 'ID DEALER': r.id, 'NAMA DEALER': r.nama };
    vals[cfg.prefix] = nb.length ? nb.map(function (x) { return x[0] + ' ' + x[1]; }).join(' · ') : (cfg.num ? 'brand belum diisi' : '(kosong — diabaikan)');
    return { key: r.id, status: !o ? 'BARU' : (JSON.stringify(o.brands) === JSON.stringify(nb) ? 'SAMA' : 'UPDATE'), values: vals };
  });
  var removed = Object.keys(old).filter(function (k) { return !v.rows.some(function (r) { return r.id === k; }); }).length;
  return { id: id, label: cfg.label + ' (ganti semua isi' + (removed ? ' · ' + removed + ' dealer dihapus' : '') + ')', total: prev.length,
    newCount: prev.filter(function (r) { return r.status === 'BARU'; }).length, updateCount: prev.filter(function (r) { return r.status === 'UPDATE'; }).length,
    sameCount: prev.filter(function (r) { return r.status === 'SAMA'; }).length, rows: prev.slice(0, 100),
    rejected: v.rejected.length, keptOld: keepOld.length, rejSample: v.rejected.slice(0, 30).map(function (x) { return { alasan: x.alasan, solusi: x.solusi }; }) };
}

function attrCommit_(token, id, reason, s) {
  var cfg = DEALER_ATTR[s.type], u = guard_(token, true), v = s.data, heads = [ATTR_KEY, 'NAMA DEALER'].concat(v.brands.map(function (b) { return cfg.prefix + ' ' + b; }));
  var before = readGrid_(cfg.sheet);
  checkpoint_(u.nik, 'Bulk ' + cfg.label + ' · ' + reason);
  try {
    putTable_(cfg.sheet, heads, v.rows.concat(v.keepOld || []).map(function (r) { return [r.id, r.nama].concat(v.brands.map(function (b) { return r.vals[b] == null ? '' : r.vals[b]; })); }));
  } catch (e) { if (before) restoreGrid_(cfg.sheet, before); throw e; }
  CacheService.getScriptCache().remove(cfg.cache);
  audit_(u.nik, 'MASTER_BULK', cfg.sheet + ' ' + v.rows.length + ' ' + reason);
  props_().deleteProperty('MASTER_BULK_' + id);
  return { updated: v.rows.length };
}

/* Export Dealer: filter + kolom promotor & grade. */
function attrExportApply_(rows, f) {
  var pm = promotorMap_(), gm = gradeMap_(), pf = PortalCore.text(f.prom) || 'ALL', gf = PortalCore.text(f.grade).toUpperCase(), pb = PortalCore.text(f.brand).toUpperCase();
  if (pb === 'ALL') pb = '';
  var hasP = function (r) { var x = pm[r.id]; return !!x && (!pb || x.brands.some(function (b) { return b[0] === pb && b[1] > 0; })); };
  if (pf === 'YES') rows = rows.filter(hasP); else if (pf === 'NO') rows = rows.filter(function (r) { return !hasP(r); });
  if (pb && gf && gf !== 'ALL') rows = rows.filter(function (r) { var x = gm[r.id]; return !!x && x.brands.some(function (b) { return b[0] === pb && b[1] === gf; }); });
  var gradeBrands = [];
  rows.forEach(function (r) {
    var p = pm[r.id], g = gm[r.id];
    r.promStatus = p ? 'BER-PROMOTOR' : '-';
    r.promDetail = p ? (p.brands.length ? p.brands.map(function (x) { return x[0] + ' ' + x[1]; }).join(' · ') : 'brand belum diisi') : '';
    r.grade = {};
    if (g) g.brands.forEach(function (x) { r.grade[x[0]] = x[1]; if (gradeBrands.indexOf(x[0]) < 0) gradeBrands.push(x[0]); });
  });
  return { rows: rows, gradeBrands: gradeBrands.sort() };
}

/* History Dealer per Brand: pasang promotor/grade ke baris, filter, dan opsi grade.
   Brand fokus = kalau tepat 1 brand ditampilkan; selain itu semua brand. */
function historyAttrApply_(rows, filters, selectedBrands) {
  var pm = promotorMap_(), gm = gradeMap_(), pb = selectedBrands && selectedBrands.length === 1 ? String(selectedBrands[0]).toUpperCase() : '';
  var pf = PortalCore.text(filters.prom) || 'ALL', gf = PortalCore.text(filters.grade).toUpperCase() || 'ALL';
  rows.forEach(function (r) {
    var p = pm[r.id] || null, g = gm[r.id] ? gm[r.id].brands : null;
    r.promotor = p; r.grade = g;
    r.promFocus = !!p && (!pb || p.brands.some(function (b) { return b[0] === pb && b[1] > 0; }));
    r.gradeText = g ? (pb ? ((g.filter(function (x) { return x[0] === pb; })[0] || [])[1] || '') : g.map(function (x) { return x[0] + ' ' + x[1]; }).join(' · ')) : '';
  });
  var out = rows.filter(function (r) {
    if (pf === 'YES' && !r.promFocus) return false;
    if (pf === 'NO' && r.promFocus) return false;
    if (pb && gf !== 'ALL' && r.gradeText !== gf) return false;
    return true;
  });
  var opts = [];
  if (pb) Object.keys(gm).forEach(function (id) { gm[id].brands.forEach(function (x) { if (x[0] === pb && opts.indexOf(x[1]) < 0) opts.push(x[1]); }); });
  opts.sort(function (a, b) { return a.localeCompare(b, 'id', { numeric: true }); });
  return { rows: out, promBrand: pb, gradeOptions: opts };
}
/* Total ST (brand yang ditampilkan) per bulan: ber-promotor vs non. */
function historyPromCompare_(rows, months) {
  var grp = function (want) {
    var list = rows.filter(function (r) { return !!r.promFocus === want; });
    return { count: list.length, sum: months.map(function (m, i) { if (!m.stCut) return null; var s = 0; list.forEach(function (r) { s += Number(r.st && r.st[i]) || 0; }); return s; }) };
  };
  return { yes: grp(true), no: grp(false) };
}
function historyPromDetail_(r) { return r.promotor ? (r.promotor.brands.length ? r.promotor.brands.map(function (x) { return x[0] + ' ' + x[1]; }).join(' · ') : 'brand belum diisi') : ''; }
