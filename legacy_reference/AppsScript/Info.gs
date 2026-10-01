/* Files are delivered only after per-request session and regional authorization. */
const INFO_HEADS=['ID','JUDUL','ISI','WILAYAH','FILE_ID','FILE_NAME','MIME','BYTES','PENULIS_NIK','PENULIS_NAMA','DIBUAT','AKTIF','WILAYAH_LIST','ROLE_LIST'];
const INFO_TYPES={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
function ensureInfo_(){
  ensureTable_('Informasi',INFO_HEADS,[]);
  if(!props_().getProperty('INFO_FOLDER_ID')){const f=DriveApp.createFolder('Sales Portal - Informasi Privat');f.setSharing(DriveApp.Access.PRIVATE,DriveApp.Permission.NONE);props_().setProperty('INFO_FOLDER_ID',f.getId());}
}
function infoRows_(){if(!book_().getSheetByName('Informasi'))return [];return table_('Informasi');}
function infoList_(value,fallback){if(!value)return fallback;let a;try{a=JSON.parse(String(value));}catch(e){return [];}return Array.isArray(a)?a:[];}
function infoRowRegions_(row){return infoList_(row.WILAYAH_LIST,[row.WILAYAH]);}
function infoRowManage_(u,row){return u.role==='SUPER ADMIN'||u.role==='RGM'&&infoRowRegions_(row).length>0&&infoRowRegions_(row).every(r=>infoManage_(u,r));}
function infoVisible_(user,row){if(user.role==='SUPER ADMIN'||infoRowManage_(user,row)&&String(row.PENULIS_NIK)===user.nik)return true;const roles=infoList_(row.ROLE_LIST,['ALL']),regions=infoRowRegions_(row),mine=user.role==='ADMIN'?user.adminRegions||[]:[user.wilayah];return (roles.includes('ALL')||roles.includes(user.role))&&(regions.includes('NASIONAL')||PortalCore.LEVEL[user.role]>=4||regions.some(r=>mine.includes(r)));}
function infoAudience_(form,user){const regions=infoList_(form.regions,[PortalCore.text(form.region)]),roles=infoList_(form.roles,['ALL']),known=infoRegions_(snapshot_());if(!regions.length||regions.some(r=>!['NASIONAL'].concat(known).includes(r)||!infoManage_(user,r)))throw Error('Unggah hanya untuk wilayah penerima dalam kewenangan.');if(!roles.length||roles.some(r=>r!=='ALL'&&!PortalCore.LEVEL[r]))throw Error('Pilih role penerima yang sah.');return {regions:[...new Set(regions)],roles:roles.includes('ALL')?['ALL']:[...new Set(roles)]};}
function infoManage_(user,region){return user.role==='SUPER ADMIN'||user.role==='RGM'&&!!user.wilayah&&region===user.wilayah;}
function infoRegions_(db){return Array.from(new Set(db.meta.people.map(p=>p.wilayah).filter(Boolean))).sort();}
function infoFind_(user,id,includeInactive){const row=infoRows_().find(r=>String(r.ID)===String(id));if(!row||!infoVisible_(user,row)||!PortalCore.active(row.AKTIF)&&!(includeInactive&&infoRowManage_(user,row)))throw Error('Informasi tidak tersedia untuk akun ini.');return row;}
function apiInfo(token,page,query,region){
  const db=snapshot_(),user=guard_(token,false,false,db),requested=Math.max(0,Math.floor(Number(page)||0)),q=String(query||'').slice(0,100).toLowerCase();
  const all=infoRows_().filter(r=>infoVisible_(user,r)&&(PortalCore.active(r.AKTIF)||infoRowManage_(user,r))&&(!region||region==='ALL'||infoRowRegions_(r).includes(region))&&(r.JUDUL+' '+r.ISI).toLowerCase().includes(q)).sort((a,b)=>String(b.DIBUAT).localeCompare(String(a.DIBUAT))||String(a.ID).localeCompare(String(b.ID)));
  const n=Math.min(requested,Math.max(0,Math.ceil(all.length/20)-1)),regions=infoRegions_(db),visibleRegions=PortalCore.LEVEL[user.role]>=4?['NASIONAL'].concat(regions):['NASIONAL',user.wilayah].filter(Boolean);
  return {canUpload:!user.demo&&(user.role==='SUPER ADMIN'||user.role==='RGM'),uploadRegions:user.demo?[]:user.role==='SUPER ADMIN'?['NASIONAL'].concat(regions):user.role==='RGM'?[user.wilayah]:[],regions:visibleRegions,total:all.length,page:n,rows:all.slice(n*20,n*20+20).map(r=>({id:r.ID,title:r.JUDUL,body:r.ISI,region:infoRowRegions_(r).join(', '),roles:infoList_(r.ROLE_LIST,['ALL']),author:r.PENULIS_NAMA,created:r.DIBUAT,active:PortalCore.active(r.AKTIF),fileName:r.FILE_NAME,size:Number(r.BYTES)||0,hasFile:!!r.FILE_ID,canManage:!user.demo&&infoRowManage_(user,r)}))};
}
function apiUploadInfo(form){
  demoAssertWritable_(form.token);const user=guard_(form.token),audience=infoAudience_(form,user),region=audience.regions[0],title=PortalCore.text(form.title),body=PortalCore.text(form.body);
  if(!infoManage_(user,region))throw Error('Unggah hanya untuk wilayah yang Anda kelola.');
  if(!['NASIONAL'].concat(infoRegions_(snapshot_())).includes(region))throw Error('Wilayah tidak dikenal.');
  if(!title||title.length>140||body.length>4000)throw Error('Judul wajib, maksimal 140 karakter; isi maksimal 4.000 karakter.');
  let blob=form.file,bytes=null,name='',mime='',fileId='';
  if(blob&&blob.getBytes&&blob.getName()){
    bytes=blob.getBytes();name=blob.getName().replace(/[\\/\r\n\x00-\x1f]/g,'_').slice(0,150);const ext=name.split('.').pop().toLowerCase();mime=INFO_TYPES[ext];
    if(!mime)throw Error('File yang didukung: PDF, JPG, PNG, DOCX, XLSX.');
    if(!bytes.length||bytes.length>5*1024*1024)throw Error('Lampiran harus berisi data, maksimal 5 MB.');
    const b=bytes.map(v=>v&255),valid=ext==='pdf'?b.slice(0,5).join(',')==='37,80,68,70,45':ext==='png'?b.slice(0,8).join(',')==='137,80,78,71,13,10,26,10':['jpg','jpeg'].includes(ext)?b[0]===255&&b[1]===216:b[0]===80&&b[1]===75;
    if(!valid)throw Error('Isi file tidak sesuai jenis file. Ekspor ulang lampiran.');
  }
  const lock=LockService.getScriptLock();lock.waitLock(10000);
  try{
    demoAssertWritable_(form.token);const current=guard_(form.token);infoAudience_(form,current);checkpoint_(current.nik,'Publikasi informasi');
    if(!props_().getProperty('INFO_FOLDER_ID'))throw Error('Admin perlu menjalankan Upgrade aplikasi ke v2.');
    if(bytes){const folder=DriveApp.getFolderById(props_().getProperty('INFO_FOLDER_ID'));if(folder.getSharingAccess()!==DriveApp.Access.PRIVATE)throw Error('Folder Informasi harus Dibatasi/privat. Hubungi admin.');const file=folder.createFile(Utilities.newBlob(bytes,mime,name));fileId=file.getId();file.setSharing(DriveApp.Access.PRIVATE,DriveApp.Permission.NONE);}
    const id=Utilities.getUuid(),row=[id,title,body,region,fileId,name,mime,bytes?bytes.length:0,current.nik,current.nama,new Date().toISOString(),true,JSON.stringify(audience.regions),JSON.stringify(audience.roles)];
    const sheet=book_().getSheetByName('Informasi'),start=sheet.getLastRow()+1;
    if(start>sheet.getMaxRows())sheet.insertRowsAfter(sheet.getMaxRows(),100);
    sheet.getRange(start,1,1,INFO_HEADS.length).setNumberFormat('@').setValues([row.map(v=>typeof v==='string'&&/^[=+@]/.test(v)?"'"+v:v)]);
    audit_(current.nik,'INFO_PUBLISH',id+' '+region);return {id};
  }catch(e){if(fileId)try{DriveApp.getFileById(fileId).setTrashed(true);}catch(ignore){}throw e;}finally{lock.releaseLock();}
}
function apiSetInfoActive(token,id,value){
  demoAssertWritable_(token);if(typeof value!=='boolean')throw Error('Status tidak valid.');
  const lock=LockService.getScriptLock();lock.waitLock(10000);
  try{demoAssertWritable_(token);const user=guard_(token),row=infoFind_(user,id,true);if(!infoRowManage_(user,row))throw Error('Tidak boleh mengelola informasi ini.');const sheet=book_().getSheetByName('Informasi'),values=sheet.getDataRange().getValues(),i=values.findIndex((r,n)=>n>0&&String(r[0])===String(id));if(i<1)throw Error('Informasi tidak ditemukan.');sheet.getRange(i+1,12).setValue(value);audit_(user.nik,'INFO_ACTIVE',id+' '+value);return true;}finally{lock.releaseLock();}
}
function apiDownloadInfo(token,id){
  const user=guard_(token),row=infoFind_(user,id,false);if(!row.FILE_ID)throw Error('Informasi ini tidak memiliki lampiran.');
  const folder=DriveApp.getFolderById(props_().getProperty('INFO_FOLDER_ID'));if(folder.getSharingAccess()!==DriveApp.Access.PRIVATE)throw Error('Folder Informasi harus Dibatasi/privat. Hubungi admin.');
  const file=DriveApp.getFileById(String(row.FILE_ID)),parents=file.getParents();let belongs=false;while(parents.hasNext())if(parents.next().getId()===folder.getId())belongs=true;
  if(!belongs||file.isTrashed()||file.getSharingAccess()!==DriveApp.Access.PRIVATE)throw Error('Lampiran tidak tersedia secara privat. Hubungi admin.');
  if(file.getSize()>5*1024*1024)throw Error('Lampiran melewati batas 5 MB.');
  const bytes=file.getBlob().getBytes();if(bytes.length>5*1024*1024)throw Error('Lampiran terlalu besar.');
  // Recheck live authorization and publication state immediately before delivery.
  const latest=infoFind_(guard_(token),id,false);if(String(latest.FILE_ID)!==String(row.FILE_ID))throw Error('Lampiran berubah. Muat ulang.');
  audit_(user.nik,'INFO_DOWNLOAD',id);return {name:String(row.FILE_NAME),mime:String(row.MIME),base64:Utilities.base64Encode(bytes)};
}
