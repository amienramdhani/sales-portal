/* DOSCache.gs — cache hasil hitung DOS per (snapshot, periode, cakupan, filter).
   Otomatis kadaluarsa saat ada publish baru (id snapshot berubah) atau setelah 6 jam. */
function dosCacheKey_(source, period, ids, f, top) {
  var g = {}; Object.keys(f || {}).forEach(function (k) { if (['page', 'pageSize', 'sort'].indexOf(k) < 0) g[k] = f[k]; });
  return 'DOS:' + hash_(String(source.id) + '|' + period + '|' + (top ? 1 : 0) + '|' + ids.slice().sort().join(',') + '|' + JSON.stringify(g)).slice(0, 40);
}
function dosCacheGet_(key) {
  try {
    var c = CacheService.getScriptCache(), n = Number(c.get(key + ':n')); if (!n) return null;
    var keys = []; for (var i = 0; i < n; i++) keys.push(key + ':' + i);
    var got = c.getAll(keys), s = ''; for (var j = 0; j < n; j++) { if (got[keys[j]] == null) return null; s += got[keys[j]]; }
    return JSON.parse(s);
  } catch (e) { return null; }
}
function dosCachePut_(key, obj) {
  try {
    var s = JSON.stringify(obj), size = 90000, n = Math.ceil(s.length / size); if (n > 60) return; // > ~5MB tidak dicache
    var m = {}; for (var i = 0; i < n; i++) m[key + ':' + i] = s.slice(i * size, (i + 1) * size);
    var c = CacheService.getScriptCache(); c.putAll(m, 21600); c.put(key + ':n', String(n), 21600);
  } catch (e) {}
}
