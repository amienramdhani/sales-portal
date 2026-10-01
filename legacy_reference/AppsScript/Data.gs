/* Spreadsheet and immutable snapshot storage. All non-API functions are private. */
const SP_VERSION = '4.0.0';
function props_(){return PropertiesService.getScriptProperties();}
function book_(){const id=props_().getProperty('BOOK_ID');if(!id)throw Error('Jalankan setupPortal_ dari editor terlebih dahulu.');return SpreadsheetApp.openById(id);}
function table_(name){const s=book_().getSheetByName(name);if(!s)throw Error('Sheet tidak ditemukan: '+name);const v=s.getDataRange().getValues();const h=v.shift().map(PortalCore.text);return v.filter(r=>r.some(x=>x!==''&&x!==null)).map(r=>{const o={};h.forEach((k,i)=>{o[k]=r[i] instanceof Date?Utilities.formatDate(r[i],'Asia/Jakarta','yyyy-MM-dd'):r[i];});return o;});}
function putTable_(name,heads,rows){let s=book_().getSheetByName(name)||book_().insertSheet(name);s.clearContents();if(s.getMaxRows()<rows.length+1)s.insertRowsAfter(s.getMaxRows(),rows.length+1-s.getMaxRows());if(s.getMaxColumns()<heads.length)s.insertColumnsAfter(s.getMaxColumns(),heads.length-s.getMaxColumns());s.getRange(1,1,rows.length+1,heads.length).setNumberFormat('@').setValues([heads].concat(rows.map(r=>r.map(v=>typeof v==='string'&&/^[=+@]/.test(v)?"'"+v:v))));s.setFrozenRows(1);s.getRange(1,1,1,heads.length).setBackground('#10394E').setFontColor('#ffffff').setFontWeight('bold');s.autoResizeColumns(1,heads.length);return s;}
function ensureTable_(name,heads,rows){if(!book_().getSheetByName(name))putTable_(name,heads,rows||[]);}
function settings_(){return {roleSchema:Number(props_().getProperty('ROLE_SCHEMA')||1),regions:table_('Region_Map'),products:table_('Product_Rules'),targets:table_('Target_Periode').concat(targetWide_()),kpi:table_('KPI_Config')};}
function meta_(){const s=settings_(),meta=PortalCore.normalize({sales:table_('Master_Sales'),customers:table_('Master_Customer'),products:table_('Master_Product')},s);meta.regionList=[...new Set(s.regions.map(r=>String(r.WILAYAH_KPI)).filter(Boolean))];meta.rgmPolicies=rgmPolicies_(meta);meta.indukLog=indukLogRead_();meta.nikMerge=nikMergeRead_();meta.regionList=[...new Set(s.regions.map(r=>String(r.WILAYAH_KPI)).filter(Boolean))];const access=optionalTable_('Admin_Access');meta.people.forEach(p=>{if(p.role==='ADMIN')p.adminRegions=[...new Set(access.filter(r=>String(r.NIK)===p.nik).map(r=>String(r.WILAYAH)))];});meta.dealerRegions=optionalTable_('Dealer_Region').map(r=>({customer:PortalCore.text(r['KODE CUSTOMER']),region:PortalCore.text(r.WILAYAH),from:PortalCore.iso(r.BERLAKU_MULAI)}));return applyDealerContacts_(meta);}
function folder_(){return DriveApp.getFolderById(props_().getProperty('FOLDER_ID'));}
function writeJson_(name,obj){return folder_().createFile(Utilities.newBlob(JSON.stringify(obj),'application/json',name+'.json')).getId();}
function readJson_(id){
  const cache=CacheService.getScriptCache(),prefix='json:'+id,parts=Number(cache.get(prefix+':n'));
  if(parts){const keys=Array.from({length:parts},(_,i)=>prefix+':'+i),saved=cache.getAll(keys);if(keys.every(k=>saved[k]!==undefined)){try{return JSON.parse(keys.map(k=>saved[k]).join(''));}catch(e){/* Cache is optional. */}}}
  const s=DriveApp.getFileById(id).getBlob().getDataAsString('UTF-8'),n=Math.ceil(s.length/20000),values={};
  if(n<150){for(let i=0;i<n;i++)values[prefix+':'+i]=s.slice(i*20000,(i+1)*20000);try{cache.putAll(values,900);cache.put(prefix+':n',String(n),900);}catch(e){}}
  return JSON.parse(s);
}
function snapshot_(){const id=props_().getProperty('ACTIVE');if(!id)throw Error('Belum ada data dipublikasikan.');const s=readJson_(id);PortalCore.adaptMeta(s.meta);applyDealerContacts_(s.meta);s.id=id;return s;}
function audit_(nik,action,detail){try{const s=book_().getSheetByName('Audit_Log');s.appendRow([new Date().toISOString(),nik,action,String(detail||'').slice(0,2000)]);}catch(e){console.warn('Audit write failed: '+e.message);}}
function configHash_(meta){return hash_(JSON.stringify(meta));}
function summary_(rows){return {rows:rows.length,qty:rows.reduce((s,r)=>s+r.qty,0),amount:PortalCore.round(rows.reduce((s,r)=>s+r.amount,0)),min:rows.map(r=>r.date).sort()[0]||null,max:rows.map(r=>r.date).sort().pop()||null};}
function publish_(meta,rawMap,coverage,actor,reason,soOverride,partsOverride){
 const started=Date.now(),prior=props_().getProperty('ACTIVE')?snapshot_():null;let parts=partsOverride||prior?.parts,tx=[],soRows=[];const so=soOverride||prior?.so||{raw:{},coverage:{}};
 if(!parts){Object.keys(rawMap).forEach(p=>readJson_(rawMap[p]).forEach(t=>tx.push(t)));const routing=RegionCore.routing(meta,tx,prior?.routing),shell={meta,routing};parts={ST:{},SO:{}};
 for(const kind of ['ST','SO']){const map=kind==='ST'?rawMap:so.raw,cov=kind==='ST'?coverage:so.coverage;Object.keys(map).forEach(p=>{const groups={};readJson_(map[p]).forEach(t=>{const region=RegionCore.route(shell,t,kind);if(!region)throw Error('Region belum terpetakan: '+t.customer);(groups[region]||(groups[region]=[])).push({...t,region});});const allRegions=RegionCore.regions(meta);parts[kind][p]={};allRegions.forEach(r=>parts[kind][p][r]={file:writeJson_(kind+'-'+p+'-'+r,groups[r]||[]),cutoff:cov[p]?.cutoff||PortalCore.end(p)});});} }
 tx=[];const raw={},soRaw={},cov={},soCov={};for(const kind of ['ST','SO'])Object.keys(parts[kind]||{}).forEach(p=>{const rows=[];Object.values(parts[kind][p]).forEach(v=>readJson_(v.file).forEach(t=>rows.push(t)));const common=RegionCore.common(parts,kind,p,RegionCore.regions(meta)),cutoff=common.cutoff||common.latest;if(!cutoff)return;const unchanged=JSON.stringify(parts[kind][p])===JSON.stringify(prior?.parts?.[kind]?.[p]),existing=kind==='ST'?prior?.raw?.[p]:prior?.so?.raw?.[p],pointer=unchanged&&existing?existing:writeJson_(kind+'-month-'+p+'-'+Date.now(),rows);if(kind==='ST'){raw[p]=pointer;cov[p]={cutoff,closed:cutoff===PortalCore.end(p)};rows.forEach(t=>tx.push(t));}else{soRaw[p]=pointer;soCov[p]={cutoff};rows.forEach(t=>soRows.push(t));}});
 if(tx.length>150000||soRows.length>300000)throw Error('Batas histori ST 150.000 / SO 300.000 baris.');
 tx=nikResolveRows_(meta,custResolveRows_(meta,tx));soRows=custResolveRows_(meta,soRows);
 const db=PortalCore.build(meta,tx,cov);db.raw=raw;db.so={raw:soRaw,coverage:soCov};db.parts=parts;db.routing=RegionCore.routing(meta,tx,prior?.routing);db.stock=StockCore.build(meta,tx,{rows:soRows,coverage:soCov});db.dosRules=dosRules_();db.notes=db.notes.concat(db.stock.notes);db.processed=new Date().toISOString();db.version=SP_VERSION;
 if(Date.now()-started>240000)throw Error('Publikasi mendekati batas waktu; data lama tetap aktif.');const id=writeJson_('snapshot-'+Date.now(),db);if(prior)props_().setProperty('PREVIOUS',prior.id);if(book_().getSheetByName('Version_Log'))book_().getSheetByName('Version_Log').appendRow([db.processed,actor,reason,id]);props_().setProperty('ACTIVE',id);audit_(actor,'PUBLISH',reason+' '+id);if(prior)revokeChanged_(prior.meta.people,meta.people);return {version:id,processed:db.processed,notes:db.notes,rows:tx.length};
}
function onOpen(){SpreadsheetApp.getUi().createMenu('Sales Portal').addItem('Upgrade aplikasi ke v4','upgradeV4_').addItem('Pasang autobackup harian','installBackup_').addItem('Jalankan backup sekarang','dailyBackup_').addItem('1. Setup awal','setupPortal_').addItem('Upgrade aplikasi ke v2','upgradeV2_').addItem('Upgrade aplikasi ke v3 (DOS / SO)','upgradeV3_').addItem('2. Publikasikan perubahan master / KPI','publishConfig_').addItem('Pulihkan data publikasi sebelumnya','restorePrevious_').addItem('Reset PIN dari spreadsheet','resetPinMenu_').addSeparator().addItem('🔄 Sync: aktifkan folder & jadwal otomatis','syncSetup_').addItem('🔄 Sync sekarang','syncNow_').addItem('⏸ Sync: matikan jadwal otomatis','syncStop_').addToUi();}
function setupPortal_(){
  const ui=SpreadsheetApp.getUi();if(props_().getProperty('ACTIVE')){ui.alert('Portal sudah terpasang. Gunakan menu publikasi atau reset PIN.');return;}
  const source=SpreadsheetApp.getActiveSpreadsheet();source.setSpreadsheetTimeZone('Asia/Jakarta');props_().setProperty('BOOK_ID',source.getId());
  ['Master_Sales','Master_Customer','Master_Product','Master_Transaksi','Master_Target'].forEach(n=>{if(!source.getSheetByName(n))throw Error('Impor workbook asli ke Google Sheets dahulu: '+n);});
  const a=ui.prompt('Admin pertama','Masukkan NIK salah satu SUPER ADMIN dari Master_Sales.',ui.ButtonSet.OK_CANCEL);if(a.getSelectedButton()!==ui.Button.OK)return;
  const nik=a.getResponseText().trim();if(!table_('Master_Sales').some(r=>String(r['NIK KARYAWAN'])===nik&&String(r.POSISI).toUpperCase()==='SUPER ADMIN'))throw Error('NIK harus SUPER ADMIN.');
  const pinAsk=ui.prompt('PIN admin pertama','Buat PIN baru tepat 4 digit. PIN lama dari workbook tidak dipakai.',ui.ButtonSet.OK_CANCEL);if(pinAsk.getSelectedButton()!==ui.Button.OK)return;const pin=pinAsk.getResponseText().trim();validatePin_(pin);
  const perAsk=ui.prompt('Periode target awal','Isi YYYY-MM. Untuk file sample: 2026-09.',ui.ButtonSet.OK_CANCEL);if(perAsk.getSelectedButton()!==ui.Button.OK)return;const period=PortalCore.month(perAsk.getResponseText());
  const cutoffAsk=ui.prompt('Data lengkap sampai','Isi YYYY-MM-DD. Untuk file sample: 2026-09-10. Tanggal ini menyatakan data sudah lengkap sampai hari tersebut.',ui.ButtonSet.OK_CANCEL);if(cutoffAsk.getSelectedButton()!==ui.Button.OK)return;const cutoff=PortalCore.iso(cutoffAsk.getResponseText());
  const lock=LockService.getScriptLock();lock.waitLock(10000);
  try{
    if(props_().getProperty('ACTIVE'))throw Error('Setup sudah dijalankan admin lain.');
    if(!props_().getProperty('PEPPER'))props_().setProperty('PEPPER',Utilities.getUuid()+Utilities.getUuid()+Utilities.getUuid());
    if(!props_().getProperty('FOLDER_ID'))props_().setProperty('FOLDER_ID',DriveApp.createFolder('Sales Portal - Data Privat').getId());
    ensureTable_('Region_Map',['REGION','WILAYAH_KPI'],[['JAKARTA','JABODETABEK'],['BEKASI','JABODETABEK'],['BOGOR-DEPOK','JABODETABEK'],['JABODETABEK','JABODETABEK'],['JAWA TIMUR 1','JAWA TIMUR'],['JAWA TIMUR 2','JAWA TIMUR'],['JAWA TIMUR 3','JAWA TIMUR'],['JAWA TIMUR','JAWA TIMUR'],['GROSS NAS','JAWA TIMUR']]);
    const brands=Array.from(new Set(table_('Master_Product').map(r=>String(r.BRAND))));ensureTable_('Product_Rules',['BRAND','BRAND_UTAMA','MASUK_QTY'],brands.map(b=>[b,b.includes('ACC')?b.replace(/^ACC /,'').replace(/ ACC$/,''):b,!b.includes('ACC')]));
    const targets=[];table_('Master_Target').forEach(r=>[['QTY','TARGET QTY PENJUALAN'],['DA','TARGET DEALER AKTIF'],['NOO','TARGET NOO']].forEach(v=>targets.push([period,String(r['NIK SALES']),r.BRAND,v[0],r[v[1]]])));
    ensureTable_('Target_Periode',['PERIODE','NIK','BRAND','METRIK','TARGET'],targets);
    const k=[];['JABODETABEK','JAWA TIMUR'].forEach(region=>{['ITEL','VILLAON','MOTOROLA'].forEach(b=>['QTY','DA'].forEach(m=>k.push([period,region,'KPI All Brand',m,b,'',100,false])));['MOTOPAD','REALME'].forEach(b=>['QTY','DA','NOO'].forEach(m=>k.push([period,region,'KPI '+(b==='MOTOPAD'?'Motopad':'Realme'),m,b,'',100,false])));});
    ensureTable_('KPI_Config',['PERIODE','WILAYAH_KPI','KELOMPOK_KPI','METRIK','BRAND','BOBOT','BATAS_SKOR','AKTIF'],k);
    ensureTable_('Audit_Log',['WAKTU_UTC','NIK','AKSI','KETERANGAN']);
    ensureTable_('_Auth',['NIK','SALT','PIN_HASH','AKTIF','VERSI','WAJIB_GANTI','GAGAL','LOCK_UNTIL']);
    upgradeRoles_();ensureInfo_();const meta=meta_();meta.people.forEach(p=>{if(p.nik!=='-'&&!table_('_Auth').some(a=>String(a.NIK)===p.nik))book_().getSheetByName('_Auth').appendRow([p.nik,'','',false,1,true,0,0]);});
    const txRows=table_('Master_Transaksi'),txRm=stRemapNik_(txRows,meta),tx=PortalCore.transactions(txRows,meta),groups={},cov={};
    if(tx.some(t=>t.date>cutoff))throw Error('Cutoff lebih awal daripada transaksi terakhir.');
    tx.forEach(t=>{const p=t.date.slice(0,7);(groups[p]=groups[p]||[]).push(t);});
    const raw={};Object.keys(groups).forEach(p=>{raw[p]=writeJson_('raw-'+p+'-awal',groups[p]);cov[p]={cutoff:p===cutoff.slice(0,7)?cutoff:PortalCore.end(p),closed:p<cutoff.slice(0,7)||cutoff===PortalCore.end(p)};});
    publish_(meta,raw,cov,nik,'Setup awal');setPin_(nik,pin,false);book_().getSheetByName('_Auth').hideSheet();
    ui.alert('Setup selesai. Admin pertama siap login. Aktifkan admin kedua dan pengguna melalui menu Admin. KPI menunggu bobot resmi. PIN AKSES lama tidak digunakan; hapus kolom itu dari salinan Google Sheets bila tidak diperlukan.');
  }finally{lock.releaseLock();}
}
function publishConfig_(){const lock=LockService.getScriptLock();lock.waitLock(10000);try{const old=snapshot_(),meta=meta_();validateConfigChange_(old,meta);checkpoint_('EDITOR','Konfigurasi');const r=publish_(meta,old.raw,old.coverage,'EDITOR','Konfigurasi');SpreadsheetApp.getUi().alert('Publikasi selesai. Login ulang jika hak akses berubah.');return r;}finally{lock.releaseLock();}}
function restorePrevious_(){SpreadsheetApp.getUi().alert('Pemulihan v4 melalui menu Admin → Pemulihan regional. Pilih bagian yang akan dipulihkan.');}
function apiStageImport(form){return stageRegionImport_(form,'ST');}
function apiPublishImport(token,id){return publishRegionImport_(token,id);}
function apiPublishConfig(token){const u=guard_(token,true),lock=LockService.getScriptLock();lock.waitLock(10000);try{guard_(token,true);checkpoint_(u.nik,'Publikasi konfigurasi');const old=snapshot_();validateConfigChange_(old,meta_());return publish_(meta_(),old.raw,old.coverage,u.nik,'Publikasi konfigurasi');}finally{lock.releaseLock();}}
