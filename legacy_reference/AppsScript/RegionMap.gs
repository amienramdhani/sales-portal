/* RegionMap.gs — edit Region_Map langsung di aplikasi (Super Admin).
   Kolom: REGION (kunci, unik), WILAYAH_KPI (Big Region), KANAL (kosong / ONLINE). */
function regionMapUsage_(db) {
  var use = {};
  (db.meta.people || []).forEach(function (p) {
    [p.region, p.portfolio].forEach(function (r) { r = PortalCore.text(r).toUpperCase(); if (r) use[r] = (use[r] || 0) + 1; });
  });
  return use;
}

function apiRegionMapGet(token) {
  var db = snapshot_(), u = guard_(token, true);
  if (u.role !== 'SUPER ADMIN') throw Error('Khusus Super Admin.');
  var grid = readGrid_('Region_Map');
  if (!grid) throw Error('Sheet Region_Map tidak ditemukan.');
  var heads = grid[0].map(PortalCore.text), ri = heads.indexOf('REGION'), wi = heads.indexOf('WILAYAH_KPI'), ki = heads.indexOf('KANAL'), use = regionMapUsage_(db);
  var rows = grid.slice(1).filter(function (r) { return PortalCore.text(r[ri]); }).map(function (r) {
    var reg = PortalCore.text(r[ri]);
    return { region: reg, big: PortalCore.text(r[wi]), kanal: ki >= 0 ? PortalCore.text(r[ki]).toUpperCase() : '', used: use[reg.toUpperCase()] || 0 };
  });
  var bigs = rows.map(function (x) { return x.big; }).filter(function (b, i, a) { return b && a.indexOf(b) === i; }).sort();
  return { rows: rows, bigs: bigs };
}

function apiRegionMapSave(token, input, reason) {
  reason = PortalCore.text(reason);
  if (reason.length < 5) throw Error('Isi alasan minimal 5 karakter.');
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var db = snapshot_(), u = guard_(token, true);
    if (u.role !== 'SUPER ADMIN') throw Error('Khusus Super Admin.');
    if (!Array.isArray(input) || !input.length) throw Error('Region Map tidak boleh kosong.');
    if (input.length > 500) throw Error('Maksimal 500 region.');
    var errs = [], seen = {}, rows = [];
    input.forEach(function (x, i) {
      var reg = PortalCore.text(x.region).replace(/\s+/g, ' '), big = PortalCore.text(x.big).replace(/\s+/g, ' '), kanal = PortalCore.text(x.kanal).toUpperCase();
      if (!reg && !big) return;
      var line = 'Baris ' + (i + 1) + ': ';
      if (!reg) { errs.push(line + 'REGION kosong.'); return; }
      if (!big) { errs.push(line + reg + ' belum diisi Big Region.'); return; }
      if (reg.length > 60 || big.length > 60) { errs.push(line + 'maksimal 60 karakter.'); return; }
      if (kanal && kanal !== 'ONLINE') { errs.push(line + 'KANAL hanya boleh kosong atau ONLINE.'); return; }
      if (seen[reg.toUpperCase()]) { errs.push(line + 'REGION ' + reg + ' dobel.'); return; }
      seen[reg.toUpperCase()] = 1; rows.push([reg, big, kanal]);
    });
    var cur = readGrid_('Region_Map') || [[]], ch = cur[0].map(PortalCore.text), cri = ch.indexOf('REGION'), inMap = {};
    cur.slice(1).forEach(function (r) { var k = PortalCore.text(r[cri]).toUpperCase(); if (k) inMap[k] = 1; });
    // hanya region yang memang ada di Region_Map & sekarang dihapus/diganti nama (NASIONAL dsb. yang tidak ada di map diabaikan)
    var use = regionMapUsage_(db), gone = Object.keys(use).filter(function (r) { return inMap[r] && !seen[r]; });
    if (gone.length) errs.push('Region masih dipakai user, tidak boleh dihapus/diganti nama: ' + gone.map(function (r) { return r + ' (' + use[r] + ' user)'; }).join(', ') + '. Pindahkan user-nya dulu.');
    if (errs.length) throw Error(errs.slice(0, 12).join('\n') + (errs.length > 12 ? '\n… dan ' + (errs.length - 12) + ' lainnya.' : ''));
    var before = readGrid_('Region_Map'), heads = before[0].map(PortalCore.text);
    ['REGION', 'WILAYAH_KPI', 'KANAL'].forEach(function (h) { if (heads.indexOf(h) < 0) heads.push(h); });
    var old = {}; before.slice(1).forEach(function (r) { old[PortalCore.text(r[heads.indexOf('REGION')]).toUpperCase()] = r; });
    var out = rows.map(function (r) {
      var base = (old[r[0].toUpperCase()] || []).slice(), o = heads.map(function (h, i) { return base[i] == null ? '' : base[i]; });
      o[heads.indexOf('REGION')] = r[0]; o[heads.indexOf('WILAYAH_KPI')] = r[1]; o[heads.indexOf('KANAL')] = r[2];
      return o;
    });
    var added = rows.filter(function (r) { return !old[r[0].toUpperCase()]; }).length, removed = Object.keys(old).filter(function (k) { return k && !seen[k]; }).length;
    checkpoint_(u.nik, 'Edit Region Map · ' + reason);
    try {
      putTable_('Region_Map', heads, out);
      var meta = meta_(); validateConfigChange_(db, meta);
      publish_(meta, db.raw, db.coverage, u.nik, 'REGION_MAP edit ' + reason);
    } catch (e) { restoreGrid_('Region_Map', before); throw e; }
    try { CacheService.getScriptCache().remove('V6_ONLINE'); } catch (e) {}
    audit_(u.nik, 'REGION_MAP_EDIT', rows.length + ' region · +' + added + ' / -' + removed + ' · ' + reason);
    return { total: rows.length, added: added, removed: removed };
  } finally { lock.releaseLock(); }
}
