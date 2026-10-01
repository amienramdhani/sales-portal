// =====================================================================
// Sync.gs — Auto-sync SELL THRU / SELL OUT dari folder Google Drive
// Alur: taruh file CSV/XLSX di "SYNC PORTAL/1. MASUK" -> tiap 15 menit
// diproses -> data bulan+region di file MENGGANTI data lama -> publish
// -> file dipindah ke "2. SELESAI" atau "3. GAGAL". Riwayat di sheet Log_Sync.
// =====================================================================
var SYNC_MONTHS_PER_RUN = 2;
function syncCsv_(heads,objects){const q=v=>{v=v==null?'':String(v);return /[",\n\r]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;};return [heads.map(q).join(',')].concat(objects.map(o=>heads.map(h=>q(o[h])).join(','))).join('\n');}
var SYNC_HEAD_ = ['WAKTU','FILE','JENIS','STATUS','BULAN','REGION','BARIS','QTY','KETERANGAN'];

function syncFolderIds_(){const p=props_();return {root:p.getProperty('SYNC_ROOT'),masuk:p.getProperty('SYNC_MASUK'),selesai:p.getProperty('SYNC_SELESAI'),gagal:p.getProperty('SYNC_GAGAL')};}

function syncLog_(row){let sh=book_().getSheetByName('Log_Sync');if(!sh){sh=book_().insertSheet('Log_Sync');sh.getRange(1,1,1,SYNC_HEAD_.length).setValues([SYNC_HEAD_]);sh.setFrozenRows(1);}
 sh.appendRow([Utilities.formatDate(new Date(),'Asia/Jakarta','yyyy-MM-dd HH:mm:ss')].concat(row));}

// Menu: buat folder, sheet log, dan jadwal otomatis tiap 15 menit.
function syncSetup_(){
 const p=props_(),mk=(parent,name)=>{const it=parent.getFoldersByName(name);return it.hasNext()?it.next():parent.createFolder(name);};
 let root=p.getProperty('SYNC_ROOT')?DriveApp.getFolderById(p.getProperty('SYNC_ROOT')):null;
 if(!root)root=mk(DriveApp.getRootFolder(),'SYNC PORTAL');
 const masuk=mk(root,'1. MASUK'),selesai=mk(root,'2. SELESAI'),gagal=mk(root,'3. GAGAL');
 p.setProperties({SYNC_ROOT:root.getId(),SYNC_MASUK:masuk.getId(),SYNC_SELESAI:selesai.getId(),SYNC_GAGAL:gagal.getId()});
 if(!book_().getSheetByName('Log_Sync'))syncLog_(['-','-','SETUP','Folder sync dibuat','','','','']);
 ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='syncFolder_').forEach(t=>ScriptApp.deleteTrigger(t));
 ScriptApp.newTrigger('syncFolder_').timeBased().everyMinutes(15).create();
 try{SpreadsheetApp.getUi().alert('Sync aktif (cek tiap 15 menit).\n\nTaruh file CSV/XLSX di folder:\n'+masuk.getUrl()+'\n\nRiwayat ada di sheet Log_Sync.');}catch(e){}
}
function syncStop_(){ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='syncFolder_').forEach(t=>ScriptApp.deleteTrigger(t));try{SpreadsheetApp.getUi().alert('Auto-sync dimatikan. File di folder MASUK tidak diproses sampai diaktifkan lagi / Sync sekarang.');}catch(e){}}
function syncNow_(){const r=syncFolder_();try{SpreadsheetApp.getUi().alert(r.processed?('Selesai: '+r.ok+' sukses'+(r.partial?' ('+r.partial+' file ada baris DITOLAK — file DITOLAK di folder 3. GAGAL)':'')+', '+r.fail+' gagal'+(r.left?', '+r.left+' file lanjut di putaran berikutnya':'')+'.\nDetail di sheet Log_Sync.'):(r.busy?'Sync lain sedang berjalan, coba lagi sebentar.':'Tidak ada file di folder MASUK.'));}catch(e){}}

// Dipanggil trigger. Memproses file terlama dulu, berhenti aman sebelum limit 6 menit.
function syncFolder_(){
 const ids=syncFolderIds_();if(!ids.masuk)return {processed:0,ok:0,fail:0,left:0};
 const lock=LockService.getScriptLock();if(!lock.tryLock(5000))return {processed:0,ok:0,fail:0,left:0,busy:true};
 const start=Date.now(),out={processed:0,ok:0,fail:0,left:0};
 try{
  const masuk=DriveApp.getFolderById(ids.masuk),files=[],it=masuk.getFiles();while(it.hasNext())files.push(it.next());
  const RANK={PRODUCT:0,CUSTOMER:1,ST:2,SO:3},list=[];
  files.filter(f=>/\.(csv|xlsx)$/i.test(f.getName())).sort((a,b)=>a.getDateCreated()-b.getDateCreated()).forEach(f=>{
   if(Date.now()-start>120000){out.left++;return;}
   try{list.push({f,rd:syncRead_(f)});}catch(e){out.processed++;syncLog_([f.getName(),'','GAGAL','','','','',String(e&&e.message||e)]);try{f.moveTo(DriveApp.getFolderById(ids.gagal));}catch(_){}out.fail++;}
  });
  // urutan aman: produk & dealer baru terdaftar dulu sebelum transaksi dibaca
  list.sort((a,b)=>RANK[a.rd.kind]-RANK[b.rd.kind]).forEach(({f,rd})=>{
   if(Date.now()-start>220000){out.left++;return;}   // sisakan waktu untuk publish; lanjut 15 menit lagi
   out.processed++;
   try{const r=syncFile_(f,rd);if(r.remainder&&r.remainder.objects.length){masuk.createFile(Utilities.newBlob(syncCsv_(r.remainder.heads,r.remainder.objects),'text/csv',f.getName().replace(/\.(csv|xlsx)$/i,'')+' (lanjutan '+r.remainder.months[0]+(r.remainder.months.length>1?' s.d. '+r.remainder.months[r.remainder.months.length-1]:'')+').csv'));out.left++;}r.forEach(x=>syncLog_([f.getName(),x.kind,r.rejected&&r.rejected.length?'SEBAGIAN':'SUKSES',x.period,x.region,x.rows,x.qty,x.note||'']));if(r.rejected&&r.rejected.length){try{const blob=rejectXlsxBlob_(f.getName(),r.heads,r.rejected);DriveApp.getFolderById(ids.gagal).createFile(blob);syncLog_([blob.getName(),rd.kind,'DITOLAK','','',r.rejected.length,'','Baris ditolak + alasan & solusi. Perbaiki lalu taruh ulang di 1. MASUK.']);}catch(x){syncLog_([f.getName(),rd.kind,'DITOLAK','','',r.rejected.length,'','Gagal membuat file DITOLAK: '+(x&&x.message||x)]);}}f.moveTo(DriveApp.getFolderById(ids.selesai));out.ok++;if(r.rejected&&r.rejected.length)out.partial=(out.partial||0)+1;}
   catch(e){syncLog_([f.getName(),'','GAGAL','','','','',String(e&&e.message||e)]);if(e&&e.rejected&&e.rejected.length){try{const blob=rejectXlsxBlob_(f.getName(),e.heads||Object.keys(e.rejected[0].row||{}),e.rejected);DriveApp.getFolderById(ids.gagal).createFile(blob);syncLog_([blob.getName(),rd.kind,'DITOLAK','','',e.rejected.length,'','Semua baris bermasalah + alasan & solusi. Perbaiki di file asli lalu taruh ulang di 1. MASUK.']);}catch(x){}}try{f.moveTo(DriveApp.getFolderById(ids.gagal));}catch(_){}out.fail++;}
  });
 }finally{lock.releaseLock();}
 return out;
}

function syncRead_(file){
 const name=file.getName();let data,tmp;
 try{
  if(/\.csv$/i.test(name)){const s=file.getBlob().getDataAsString('UTF-8').replace(/^﻿/,''),line=s.split(/\r?\n/)[0];data=Utilities.parseCsv(s,line.split(';').length>line.split(',').length?';':',');}
  else{tmp=Drive.Files.create({name:'SYNC_TMP_'+Date.now(),mimeType:'application/vnd.google-apps.spreadsheet',parents:[folder_().getId()]},file.getBlob(),{fields:'id'}).id;
   const w=SpreadsheetApp.openById(tmp);w.setSpreadsheetTimeZone('Asia/Jakarta');
   const sh=w.getSheetByName('Master_Transaksi')||w.getSheetByName('Master_SO')||w.getSheetByName('Master_Customer')||w.getSheetByName('Master_Product')||w.getSheets()[0];data=sh.getDataRange().getValues();}
  if(!data||data.length<2)throw Error('File kosong.');
  const heads=data.shift().map(PortalCore.text);
  const kind=heads.includes('KODE BARANG')&&heads.includes('NAMA BARANG')?'PRODUCT':heads.includes('TANGGAL SO')?'SO':heads.includes('TANGGAL TRANSAKSI')?'ST':heads.includes('KODE CUSTOMER')&&heads.includes('NIK SALES')?'CUSTOMER':'ST';
  const need={ST:['TANGGAL TRANSAKSI','NO TRANSAKSI','KODE PRODUK','KODE CUSTOMER','NIK SALES','QTY','AMOUNT'],SO:['KODE CUSTOMER','TANGGAL SO','KODE PRODUK','QTY'],CUSTOMER:['KODE CUSTOMER','NIK SALES'],PRODUCT:['KODE BARANG','NAMA BARANG','BRAND']}[kind];
  need.forEach(k=>{if(!heads.includes(k))throw Error('Kolom wajib tidak ada: '+k);});
  const objects=data.filter(r=>r.some(v=>v!==''&&v!=null)).map(r=>Object.fromEntries(heads.map((k,i)=>[k,r[i] instanceof Date?Utilities.formatDate(r[i],'Asia/Jakarta','yyyy-MM-dd'):r[i]])));
  return {kind,objects,heads};
 }finally{if(tmp)try{DriveApp.getFileById(tmp).setTrashed(true);}catch(e){}}
}

// Inti: 1 file bisa berisi beberapa bulan & region. Tiap (bulan, region) yang ADA di file diganti penuh.
function syncFile_(file,pre){
 const rd=pre||syncRead_(file);if(rd.kind==='CUSTOMER'||rd.kind==='PRODUCT')return syncMaster_(rd,file.getName());
 const {kind,objects}=rd,old=snapshot_(),meta=meta_();
 if(!old.parts)throw Error('Jalankan "Upgrade aplikasi ke v4" dulu.');
 if(objects.length>150000)throw Error('Maksimal 150.000 baris per file. Pecah per bulan.');
 const rm=kind==='ST'?stRemapNik_(objects,meta):{count:0,note:''};
 const parse=list=>kind==='ST'?PortalCore.transactions(list,meta):StockCore.parse(list,meta,null,null);let rows;
 try{rows=parse(objects);}catch(e){const sc=strictScan_(kind,objects,meta,parse);if(sc.rejected.length){const err=Error(String(e&&e.message||e)+' — total '+sc.rejected.length+' baris bermasalah'+(sc.stopped&&sc.error?' ('+sc.error+')':'')+'. File TIDAK diproses; lihat file DITOLAK, perbaiki semua, lalu taruh ulang.');err.rejected=sc.rejected;err.heads=rd.heads;throw err;}throw e;}
 const today=Utilities.formatDate(new Date(),'Asia/Jakarta','yyyy-MM-dd');
 if(rows.some(t=>t.date>today))throw Error('Ada tanggal di masa depan (lebih dari '+today+').');
 if(kind==='SO'&&rows.some(t=>t.date<StockCore.BASE))throw Error('SO minimal mulai '+StockCore.BASE+'.');
 const routing=old.routing?RegionCore.routing(meta,[],old.routing):RegionCore.routing(meta,Object.keys(old.raw||{}).flatMap(p=>readJson_(old.raw[p])),old.routing),shell={meta,routing},groups={};
 const unmapped=[];rows.forEach((t,i)=>{const region=RegionCore.route(shell,t,kind);if(!region){unmapped.push({row:objects[i]||{},alasan:'Baris '+(i+2)+': dealer '+t.customer+' belum terpetakan ke Big Region.',solusi:strictSolusi_('terpetakan')});return;}t.region=region;const p=t.date.slice(0,7);((groups[p]=groups[p]||{})[region]=groups[p][region]||[]).push(t);});
 if(unmapped.length){const err=Error(unmapped.length+' baris dealernya belum terpetakan ke Big Region (mis. '+unmapped[0].alasan+'). File TIDAK diproses; lihat file DITOLAK.');err.rejected=unmapped;err.heads=rd.heads;throw err;}
 let months=Object.keys(groups).sort();let remainder=null;
 // File besar (banyak bulan) diproses bertahap supaya tidak kena batas 6 menit Apps Script: sisa bulan ditaruh balik ke 1. MASUK.
 if(months.length>SYNC_MONTHS_PER_RUN&&rows.length===objects.length){const keep=new Set(months.slice(0,SYNC_MONTHS_PER_RUN)),rest=objects.filter((o,i)=>!keep.has(rows[i].date.slice(0,7)));months.filter(m=>!keep.has(m)).forEach(m=>delete groups[m]);remainder={heads:rd.heads,objects:rest,months:months.filter(m=>!keep.has(m))};months=months.filter(m=>keep.has(m));}
 months.forEach(assertPeriodOpen_);
 checkpoint_('SYNC','Sync '+kind+' '+file.getName());
 let parts=old.parts;const report=[];const bOf=t=>PortalCore.text((meta.products[t.sku]||{}).brand)||'(TANPA BRAND)';
 months.forEach(p=>{
  const regions=Object.keys(groups[p]).sort(),incoming={},maxDate=groups[p][regions[0]].concat(...regions.slice(1).map(r=>groups[p][r])).reduce((m,t)=>t.date>m?t.date:m,'');
  const cutoff=p<today.slice(0,7)?PortalCore.end(p):maxDate; // bulan lalu = lengkap; bulan berjalan = sampai tanggal terakhir di file
  regions.forEach(r=>{
   // Ganti per (bulan, region, BRAND): brand yang tidak ada di file ini tetap utuh.
   const entry=parts?.[kind]?.[p]?.[r],oldRows=entry?readJson_(entry.file):[],inB=new Set(groups[p][r].map(bOf)),kept=oldRows.filter(t=>!inB.has(bOf(t))),merged=kept.concat(groups[p][r]);
   const prev=entry?summarySO_(oldRows.filter(t=>inB.has(bOf(t)))):null,now=summarySO_(groups[p][r]);
   const mMax=merged.reduce((m,t)=>t.date>m?t.date:m,''),cutR=p<today.slice(0,7)?PortalCore.end(p):(mMax||cutoff);
   let note='brand '+[...inB].sort().join(', ')+(kept.length?' · brand lain tetap ('+kept.length+' baris)':'')+' · cutoff '+cutR;if(entry&&cutR<entry.cutoff)note+=' | PERINGATAN: cutoff mundur dari '+entry.cutoff;if(prev&&prev.qty>0&&now.qty<prev.qty*.7)note+=' | PERINGATAN: QTY brand ini turun >30% dari data lama ('+prev.qty+' → '+now.qty+')';
   incoming[r]={file:writeJson_(kind+'-'+p+'-'+r+'-'+Date.now(),merged),cutoff:cutR};
   report.push({kind,period:p,region:r,rows:now.rows,qty:now.qty,note});
  });
  parts=RegionCore.replace(parts,kind,p,regions,incoming);
 });
 publish_(meta,old.raw,old.coverage,'SYNC','Sync '+kind+' '+months.join(',')+' ('+file.getName()+')',null,parts);
 if(rm.count){report.push({kind,period:'-',region:'-',rows:rm.count,qty:'',note:rm.note});}
 if(remainder){report.remainder=remainder;report.push({kind,period:'-',region:'-',rows:remainder.objects.length,qty:'',note:'File besar: bulan '+remainder.months.join(', ')+' dilanjutkan otomatis di putaran berikutnya (file lanjutan di 1. MASUK).'});}
 return report;
}

// Sekali jalan: pakai folder Drive milik user sebagai root Sync (subfolder dibuat otomatis).
// TIDAK menyalakan jadwal otomatis — jalankan syncSetup_ (menu) kalau sudah siap.
var SYNC_FOLDER_USER_ = '1o3ZQUjpjz8v8olPp0iGDVnXO6j9LmDGA';
function syncPakaiFolderSaya(){
 const root=DriveApp.getFolderById(SYNC_FOLDER_USER_),mk=(parent,name)=>{const it=parent.getFoldersByName(name);return it.hasNext()?it.next():parent.createFolder(name);};
 const masuk=mk(root,'1. MASUK'),selesai=mk(root,'2. SELESAI'),gagal=mk(root,'3. GAGAL');
 props_().setProperties({SYNC_ROOT:root.getId(),SYNC_MASUK:masuk.getId(),SYNC_SELESAI:selesai.getId(),SYNC_GAGAL:gagal.getId()});
 if(!book_().getSheetByName('Log_Sync'))syncLog_(['-','-','SETUP','Folder sync: '+root.getName(),'','','','']);
 try{SpreadsheetApp.getUi().alert('Folder Sync diset ke "'+root.getName()+'".\n\nSubfolder 1. MASUK / 2. SELESAI / 3. GAGAL sudah dibuat.\nJadwal otomatis BELUM aktif — nyalakan lewat menu Sync saat siap.');}catch(e){}
}


// ===== Master Customer / Master Product via Sync: UPSERT, tidak pernah menghapus =====
// - Kode baru ditambah, kode lama diperbarui. Sel kosong di file TIDAK menimpa isi lama.
// - Dealer/produk yang tidak ada di file dibiarkan.
// - Customer: NIK SALES berbeda dari database DITOLAK (pindah sales wajib lewat Transfer Dealer).
// - Product: BRAND wajib sudah ada di Product_Rules.
function syncMaster_(rd,fileName,dry){
 const cust=rd.kind==='CUSTOMER',sheet=cust?'Master_Customer':'Master_Product',keyCol=cust?'KODE CUSTOMER':'KODE BARANG';
 if(cust){const oh=rd.heads;rd=Object.assign({},rd,{heads:uniqHeads_(oh),objects:uniqObjects_(oh,rd.objects)});}
 const old=snapshot_(),before=readGrid_(sheet);if(!before)throw Error('Sheet '+sheet+' tidak ditemukan.');
 const heads=before[0].map(PortalCore.text),ki=heads.indexOf(keyCol);if(ki<0)throw Error(sheet+' tidak punya kolom '+keyCol+'.');
 // Master_Customer: 1 baris = 1 ID_DEALER (alias); beberapa ID_DEALER boleh menunjuk KODE CUSTOMER yang sama (wajib NIK sama).
 const ai=cust?heads.indexOf('ID_DEALER'):-1,ni=cust?heads.indexOf('NIK SALES'):-1,useAlias=cust&&ai>=0&&rd.heads.includes('ID_DEALER'),rowKey=r=>{const a=useAlias?PortalCore.text(r[ai]):'';return a||PortalCore.text(r[ki]);};
 const rows=before.slice(1).filter(r=>r.some(v=>v!==''&&v!=null)).map(r=>r.slice()),pos={},kodeNik={};rows.forEach((r,i)=>{pos[rowKey(r)]=i;if(cust)kodeNik[PortalCore.text(r[ki])]=PortalCore.text(r[ni]);});
 const mangled=excelMangledMap_(rows.map(r=>PortalCore.text(r[ki])));
 const cols=rd.heads.filter(h=>heads.includes(h)),ignored=rd.heads.filter(h=>h&&!heads.includes(h)&&!['ALASAN','SOLUSI'].includes(h));
 const people={};old.meta.people.forEach(p=>{people[p.nik]=p;});
 const brands={};try{table_('Product_Rules').forEach(r=>{brands[PortalCore.text(r.BRAND).toUpperCase()]=1;});}catch(e){}
 const indukPairs={},namaFile={},seen={},rejected=[],fileNik={},sig=o=>JSON.stringify(rd.heads.filter(h=>!['ALASAN','SOLUSI'].includes(h)).map(h=>PortalCore.text(o[h])));let add=0,upd=0,same=0,dupSame=0;
 const rej=(o,alasan,solusi)=>{rejected.push({row:o,alasan,solusi});};
 rd.objects.forEach((o,i)=>{
  const kode=PortalCore.text(o[keyCol]),alias=useAlias?PortalCore.text(o.ID_DEALER):'',k=alias||kode,label=useAlias?'ID_DEALER':keyCol;
  if(!kode){rej(o,keyCol+' kosong.','Isi '+keyCol+'.');return;}
  if(seen[k]!==undefined){if(seen[k]===sig(o)){dupSame++;return;}rej(o,label+' '+k+' dobel di file dengan isi berbeda.','Sisakan satu baris untuk '+label+' '+k+'.');return;}seen[k]=sig(o);
  if(mangled[kode]&&pos[k]===undefined){rej(o,keyCol+' '+kode+' kemungkinan rusak oleh Excel (angka nol hilang).','Harusnya '+mangled[kode]+'. Di Excel format kolom kode sebagai Teks, lalu isi ulang kodenya.');return;}
  const has=pos[k]!==undefined,cur=has?rows[pos[k]]:heads.map(()=>'');
  const prevKode=cust&&has&&useAlias?PortalCore.text(cur[ki]):'';
  if(prevKode&&prevKode!==kode){if(indukPairs[prevKode]&&indukPairs[prevKode]!==kode){rej(o,'Induk '+prevKode+' diganti ke 2 kode berbeda di file ('+indukPairs[prevKode]+' & '+kode+').','Semua toko satu induk harus pindah ke induk yang sama.');return;}if(kodeNik[kode]&&kodeNik[kode]!==kodeNik[prevKode]){rej(o,'Ganti induk '+prevKode+' → '+kode+': induk '+kode+' dipegang NIK '+kodeNik[kode]+', bukan '+kodeNik[prevKode]+'.','Samakan pemegangnya dulu lewat Transfer dealer.');return;}indukPairs[prevKode]=kode;}
  if(cust){const nik=PortalCore.text(o['NIK SALES']),oldNik=kodeNik[kode]||(prevKode?kodeNik[prevKode]:'')||'';
   if(fileNik[kode]!==undefined&&nik&&fileNik[kode]!==nik){rej(o,'KODE CUSTOMER '+kode+' punya NIK SALES berbeda di file ('+fileNik[kode]+' vs '+nik+').','Satu dealer = satu pemegang. Samakan NIK SALES semua baris dealer ini.');return;}
   if(oldNik&&nik&&nik!==oldNik){rej(o,'NIK SALES beda dari pemegang sekarang ('+oldNik+' → '+nik+').','Pindah pemegang pakai Admin › Dealer › Transfer dealer. Di file ini kosongkan/samakan NIK SALES.');return;}
   if(!oldNik&&(!nik||!people[nik]||!people[nik].sales)){rej(o,'NIK SALES '+(nik||'(kosong)')+' belum terdaftar sebagai sales aktif.','Daftarkan NIK lewat Admin › User › Tambah user massal (POSISI SALES), lalu upload ulang.');return;}
   if(nik)fileNik[kode]=nik;
   if(!has&&!nik)o={...o,'NIK SALES':oldNik};}
  else{const b=PortalCore.text(o.BRAND).toUpperCase();if(b&&!brands[b]){rej(o,'BRAND "'+o.BRAND+'" belum ada di Product_Rules.','Tambah brand di Admin › Master › Product Rules, lalu upload ulang.');return;}
   if(!has&&!b){rej(o,'Produk baru tanpa BRAND.','Isi kolom BRAND.');return;}}
  let changed=false;cols.forEach(h=>{const v=o[h];if(v===''||v==null)return;const j=heads.indexOf(h),nv=PortalCore.text(v);if(PortalCore.text(cur[j])!==nv){cur[j]=nv;changed=true;}});
  if(cust&&PortalCore.text(o['NAMA INDUK CUSTOMER']))namaFile[kode]=PortalCore.text(o['NAMA INDUK CUSTOMER']);
  if(!has){rows.push(cur);pos[k]=rows.length-1;add++;}else if(changed)upd++;else same++;
 });
 let indukMoved=0,namaFix=0;const pairList=Object.keys(indukPairs).map(l=>({lama:l,baru:indukPairs[l]}));
 if(cust){const nii=heads.indexOf('NAMA INDUK CUSTOMER');rows.forEach(r=>{const kk=PortalCore.text(r[ki]),to=indukPairs[kk];if(to){if(ai>=0&&!PortalCore.text(r[ai]))r[ai]=kk;r[ki]=to;indukMoved++;}});
  if(nii>=0){const nm={};rows.forEach(r=>{const kk=PortalCore.text(r[ki]);if(namaFile[kk])nm[kk]=namaFile[kk];});rows.forEach(r=>{const kk=PortalCore.text(r[ki]);if(nm[kk]&&PortalCore.text(r[nii])!==nm[kk]){r[nii]=nm[kk];namaFix++;}});}
  if(indukMoved||namaFix)upd=upd||1;}
 let hint='';if(cust&&rejected.length){const miss={};rejected.forEach(x=>{const m=/NIK SALES (\S+) belum terdaftar/.exec(x.alasan);if(m)miss[m[1]]=(miss[m[1]]||0)+1;});const ks=Object.keys(miss);if(ks.length)hint=' | NIK belum terdaftar ('+ks.length+'): '+ks.slice(0,30).map(k=>k+' ('+miss[k]+')').join(', ')+(ks.length>30?', dst.':'');}
 const note=(pairList.length?'GANTI INDUK '+pairList.length+' ('+pairList.slice(0,10).map(p=>p.lama+'→'+p.baru).join(', ')+(pairList.length>10?', dst.':'')+'), ':'')+(namaFix?'nama induk diseragamkan '+namaFix+' baris, ':'')+'baru '+add+', diperbarui '+upd+', sama '+same+(dupSame?', kembar dilewati '+dupSame:'')+(rejected.length?', DITOLAK '+rejected.length+' (lihat file DITOLAK)':'')+hint+(ignored.length?' | kolom diabaikan: '+ignored.join(', '):'');
 if(dry)return {add,upd,same,dupSame,rejected,note,total:rd.objects.length,ignored,induk:pairList,namaFix};
 const out=[{kind:rd.kind,period:'-',region:'-',rows:rd.objects.length,qty:'',note}];out.rejected=rejected;out.heads=rd.heads;
 if(!add&&!upd){out[0].note=note+' | tidak ada perubahan';return out;}
 checkpoint_('SYNC','Sync '+rd.kind+' '+fileName);
 const others={};if(pairList.length){INDUK_KEYED.concat([{sheet:INDUK_LOG}]).forEach(c=>{others[c.sheet]=readGrid_(c.sheet);});}
 try{putTable_(sheet,heads,rows);if(pairList.length){const mp={};pairList.forEach(p=>mp[p.lama]=p.baru);indukRewriteOthers_(mp);indukLogAppend_(pairList,'SYNC','Upload dealer '+fileName);}const meta=meta_();if(typeof validateConfigChange_==='function')validateConfigChange_(old,meta);
  publish_(meta,old.raw,old.coverage,'SYNC','Sync '+rd.kind+' ('+fileName+') '+note,null,old.parts);}
 catch(e){restoreGrid_(sheet,before);Object.keys(others).forEach(x=>{if(others[x])restoreGrid_(x,others[x]);});throw e;}
 return out;
}
