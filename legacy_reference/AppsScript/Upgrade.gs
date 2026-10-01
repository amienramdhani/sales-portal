/* Run once from the bound spreadsheet after installing all v2 source files. */
function upgradeRoles_(){
  if(props_().getProperty('ROLE_SCHEMA')==='2')return;
  const book=book_(),source=book.getSheetByName('Master_Sales');
  let backupId=props_().getProperty('ROLE_BACKUP_ID'),backup;
  if(backupId){backup=book.getSheets().find(s=>String(s.getSheetId())===backupId);if(!backup)throw Error('Backup posisi tidak ditemukan. Pulihkan tab backup sebelum mengulang upgrade.');}
  else {backup=source.copyTo(book);backup.setName('Backup_Posisi_'+Date.now());props_().setProperty('ROLE_BACKUP_ID',String(backup.getSheetId()));}
  const original=backup.getDataRange().getValues(),current=source.getDataRange().getValues();
  const heads=original[0].map(PortalCore.text),pos=heads.indexOf('POSISI'),nik=heads.indexOf('NIK KARYAWAN');
  if(pos<0||nik<0||original.length!==current.length||JSON.stringify(current[0])!==JSON.stringify(original[0]))throw Error('Master berubah sejak backup posisi. Hentikan pengeditan master selama upgrade.');
  for(let i=1;i<original.length;i++)if(String(original[i][nik])!==String(current[i][nik]))throw Error('Urutan NIK master berubah sejak backup posisi.');
  // Compute from immutable backup, so retries never map an ASM twice.
  const values=original.slice(1).map(r=>[r[pos]?PortalCore.position(r[pos],1):'']);
  if(values.length)source.getRange(2,pos+1,values.length,1).setValues(values);
  props_().setProperty('ROLE_SCHEMA','2');
}
function upgradeV2_(){
  const ui=SpreadsheetApp.getUi(),lock=LockService.getScriptLock();lock.waitLock(10000);
  try{
    if(!props_().getProperty('ACTIVE'))throw Error('Untuk pemasangan baru, gunakan Setup awal.');
    const old=snapshot_();upgradeRoles_();ensureInfo_();
    const result=publish_(meta_(),old.raw,old.coverage,'EDITOR','Upgrade v2: posisi, tampilan, dan informasi');
    props_().setProperty('APP_SCHEMA','2');
    ui.alert('Upgrade v2 selesai. NIK, PIN, transaksi, dan target tetap tersimpan. Backup posisi lama dibuat. Selanjutnya Deploy > Manage deployments > Edit > New version > Deploy.');
    return result;
  }finally{lock.releaseLock();}
}
