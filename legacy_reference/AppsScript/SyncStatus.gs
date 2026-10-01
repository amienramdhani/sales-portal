/* SyncStatus.gs — Status Sync di aplikasi: isi folder, riwayat Log_Sync, tombol Sync sekarang, download file DITOLAK/GAGAL. */
function syncAdmin_(token) { var db = snapshot_(), u = guard_(token, true, false, db); return u; }
function apiSyncStatus(token) {
  syncAdmin_(token);
  var ids = syncFolderIds_(), cnt = function (id) { if (!id) return null; var n = 0, it = DriveApp.getFolderById(id).getFiles(); while (it.hasNext()) { it.next(); n++; } return n; };
  var failed = [];
  if (ids.gagal) { var it = DriveApp.getFolderById(ids.gagal).getFiles(); while (it.hasNext()) { var f = it.next(); failed.push({ id: f.getId(), name: f.getName(), at: f.getDateCreated().getTime(), size: f.getSize() }); } }
  failed.sort(function (a, b) { return b.at - a.at; });
  var log = []; var sh = book_().getSheetByName('Log_Sync');
  if (sh && sh.getLastRow() > 1) { var n = Math.min(40, sh.getLastRow() - 1), v = sh.getRange(sh.getLastRow() - n + 1, 1, n, sh.getLastColumn()).getDisplayValues(), h = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0]; log = v.reverse().map(function (r) { var o = {}; h.forEach(function (k, i) { o[k] = r[i]; }); return o; }); }
  var on = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'syncFolder_'; });
  return { configured: !!ids.masuk, masuk: cnt(ids.masuk), selesai: cnt(ids.selesai), gagal: cnt(ids.gagal), folderUrl: ids.root ? DriveApp.getFolderById(ids.root).getUrl() : '', schedule: on, failed: failed.slice(0, 30).map(function (f) { return { id: f.id, name: f.name, at: Utilities.formatDate(new Date(f.at), 'Asia/Jakarta', 'dd/MM HH:mm') }; }), log: log };
}
function apiSyncRunNow(token) { syncAdmin_(token); var r = syncFolder_(); return r; }
function apiSyncSchedule(token, on) {
  var u = syncAdmin_(token); if (u.role !== 'SUPER ADMIN') throw Error('Khusus Super Admin.');
  ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'syncFolder_'; }).forEach(function (t) { ScriptApp.deleteTrigger(t); });
  if (on) ScriptApp.newTrigger('syncFolder_').timeBased().everyMinutes(15).create();
  audit_(u.nik, 'SYNC_SCHEDULE', on ? 'ON' : 'OFF'); return { schedule: !!on };
}
function apiSyncFileDownload(token, fileId) {
  syncAdmin_(token); var ids = syncFolderIds_(), f = DriveApp.getFileById(fileId), ok = false, p = f.getParents();
  while (p.hasNext()) if (p.next().getId() === ids.gagal) ok = true;
  if (!ok) throw Error('File bukan dari folder 3. GAGAL.');
  var b = f.getBlob(); return { name: f.getName(), mime: b.getContentType() || 'application/octet-stream', base64: Utilities.base64Encode(b.getBytes()) };
}
function apiSyncRetry(token, fileId) {
  syncAdmin_(token); var ids = syncFolderIds_(), f = DriveApp.getFileById(fileId); f.moveTo(DriveApp.getFolderById(ids.masuk)); return { ok: true };
}
