/* NIK + four-digit PIN. Pepper is private to Script Properties. Never sent to client. */
function hash_(value){const pepper=props_().getProperty('PEPPER');if(!pepper)throw Error('Setup portal belum selesai.');return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(String(value),pepper)).replace(/=+$/,'');}
function randomPin_(){const b=Utilities.computeHmacSha256Signature(Utilities.getUuid()+Utilities.getUuid(),props_().getProperty('PEPPER'));return String(((b[0]&255)*65536+(b[1]&255)*256+(b[2]&255))%10000).padStart(4,'0');}
function validatePin_(pin){if(!/^\d{4}$/.test(String(pin)))throw Error('PIN harus tepat 4 digit.');}
function safeEqual_(a,b){a=String(a);b=String(b);let diff=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return diff===0;}
/* v6.23: _Auth dibaca dari cache 30 detik (dipakai setiap klik untuk cek sesi); dibuang tiap ada perubahan akun. */
function authTable_(){const c=CacheService.getScriptCache();try{const hit=c.get('V6_AUTH');if(hit)return JSON.parse(hit);}catch(e){}const rows=table_('_Auth');try{const s=JSON.stringify(rows);if(s.length<95000)c.put('V6_AUTH',s,30);}catch(e){}return rows;}
function authCacheClear_(){try{CacheService.getScriptCache().remove('V6_AUTH');}catch(e){}}
function account_(nik){const r=authTable_().find(r=>PortalCore.text(r.NIK)===PortalCore.text(nik));return r?Object.assign({},r):undefined;}
function writeAccount_(a){const s=book_().getSheetByName('_Auth'),v=s.getDataRange().getValues(),i=v.findIndex((r,n)=>n>0&&PortalCore.text(r[0])===PortalCore.text(a.NIK));if(i<1)throw Error('Akun belum terdaftar. Publikasikan master terlebih dahulu.');s.getRange(i+1,1,1,8).setNumberFormat('@').setValues([[a.NIK,a.SALT,a.PIN_HASH,a.AKTIF,a.VERSI,a.WAJIB_GANTI,a.GAGAL,a.LOCK_UNTIL]]);authCacheClear_();}
function setPin_(nik,pin,force){validatePin_(pin);let a=account_(nik);if(!a){book_().getSheetByName('_Auth').appendRow([nik,'','',false,0,true,0,0]);authCacheClear_();a=account_(nik);}a.SALT=Utilities.getUuid();a.PIN_HASH=hash_(nik+'|'+a.SALT+'|'+pin);a.AKTIF=true;a.VERSI=Number(a.VERSI||0)+1;a.WAJIB_GANTI=force;a.GAGAL=0;a.LOCK_UNTIL=0;writeAccount_(a);return a;}
function cleanupAuth_(){const all=props_().getProperties(),now=Date.now();Object.keys(all).filter(k=>k.startsWith('SESSION_')).forEach(k=>{try{if(JSON.parse(all[k]).until<now)props_().deleteProperty(k);}catch(e){props_().deleteProperty(k);}});}
function issue_(a){cleanupAuth_();const all=props_().getProperties();Object.keys(all).filter(k=>k.startsWith('SESSION_')).forEach(k=>{if(JSON.parse(all[k]).nik===String(a.NIK))props_().deleteProperty(k);});const token=hash_(Utilities.getUuid()+Utilities.getUuid()+Date.now());props_().setProperty('SESSION_'+hash_(token),JSON.stringify({nik:String(a.NIK),version:Number(a.VERSI),until:Date.now()+8*3600000}));return token;}
function authSession_(token){
  if(typeof token!=='string'||token.length<30||token.length>200)throw Error('SESI: Silakan masuk kembali.');
  const key='SESSION_'+hash_(token),raw=props_().getProperty(key);if(!raw)throw Error('SESI: Silakan masuk kembali.');
  let s;try{s=JSON.parse(raw);}catch(e){props_().deleteProperty(key);throw Error('SESI: Silakan masuk kembali.');}
  const a=account_(String(s.nik));if(!a||Number(s.until)<Date.now()||!PortalCore.active(a.AKTIF)||Number(a.VERSI)!==Number(s.version))throw Error('SESI: Silakan masuk kembali.');
  return {key,s,a};
}
function demoState_(token,db){
  const auth=authSession_(token);db=db||snapshot_();const actor=db.meta.people.find(p=>p.nik===auth.s.nik),target=auth.s.demoNik?db.meta.people.find(p=>p.nik===auth.s.demoNik):null;
  if(!actor)throw Error('Akun tidak ditemukan.');
  return {active:!!target,canStart:actor.role==='SUPER ADMIN',actor:{nik:actor.nik,nama:actor.nama,role:actor.role},target:target?{nik:target.nik,nama:target.nama,role:target.role,wilayah:target.wilayah||'',region:target.portfolio||target.region||''}:null,readOnly:!!target};
}
function demoAssertWritable_(token){if(authSession_(token).s.demoNik)throw Error('Mode Demo hanya-baca. Kembali ke akun Super Admin untuk melakukan perubahan.');}
function demoTargetAllowed_(p){return p&&p.nik!=='-'&&!['ADMIN','SUPER ADMIN'].includes(p.role);}
function apiDemoOptions(token){
  const db=snapshot_(),state=demoState_(token,db);if(!state.canStart)throw Error('Hanya Super Admin yang dapat menggunakan Mode Demo.');
  return db.meta.people.filter(demoTargetAllowed_).filter(p=>{const a=account_(p.nik);return a&&PortalCore.active(a.AKTIF)&&!!a.PIN_HASH;}).map(p=>({nik:p.nik,nama:p.nama,role:p.role,bigRegion:p.wilayah||'Nasional',region:p.portfolio||p.region||'—'})).sort((a,b)=>a.bigRegion.localeCompare(b.bigRegion,'id')||a.region.localeCompare(b.region,'id')||a.role.localeCompare(b.role,'id')||a.nama.localeCompare(b.nama,'id'));
}
function apiStartDemo(token,targetNik){
  const lock=LockService.getScriptLock();lock.waitLock(10000);try{const db=snapshot_(),auth=authSession_(token),actor=db.meta.people.find(p=>p.nik===auth.s.nik),target=db.meta.people.find(p=>p.nik===String(targetNik));if(actor?.role!=='SUPER ADMIN')throw Error('Hanya Super Admin yang dapat menggunakan Mode Demo.');if(!demoTargetAllowed_(target))throw Error('Pilih akun operasional selain Admin/Super Admin.');const a=account_(target.nik);if(!a||!PortalCore.active(a.AKTIF)||!a.PIN_HASH)throw Error('Akun tujuan tidak aktif atau belum memiliki PIN.');auth.s.demoNik=target.nik;props_().setProperty(auth.key,JSON.stringify(auth.s));audit_(actor.nik,'DEMO_START',target.nik+' | '+target.nama+' | '+target.role);return demoState_(token,db);}finally{lock.releaseLock();}
}
function apiStopDemo(token){
  const lock=LockService.getScriptLock();lock.waitLock(10000);try{const db=snapshot_(),auth=authSession_(token),actor=db.meta.people.find(p=>p.nik===auth.s.nik),target=auth.s.demoNik?db.meta.people.find(p=>p.nik===auth.s.demoNik):null;if(actor?.role!=='SUPER ADMIN')throw Error('Hanya Super Admin yang dapat mengakhiri Mode Demo.');delete auth.s.demoNik;props_().setProperty(auth.key,JSON.stringify(auth.s));audit_(actor.nik,'DEMO_STOP',target?target.nik+' | '+target.nama:'');return demoState_(token,db);}finally{lock.releaseLock();}
}
function apiLogin(nik,pin){
  nik=String(nik||'').trim();pin=String(pin||'');if(nik.length>60||!/^\d{4}$/.test(pin))throw Error('NIK atau PIN tidak sesuai.');
  const lock=LockService.getScriptLock();if(!lock.tryLock(15000))throw Error('Sedang sibuk. Coba beberapa saat lagi.');
  try{
    const now=Date.now(),throttle=JSON.parse(props_().getProperty('LOGIN_GLOBAL')||'{"start":0,"count":0}');if(now-throttle.start>60000){throttle.start=now;throttle.count=0;}throttle.count++;props_().setProperty('LOGIN_GLOBAL',JSON.stringify(throttle));if(throttle.count>150)throw Error('Terlalu banyak percobaan masuk. Coba beberapa saat lagi.');
    const a=account_(nik);if(!a||!PortalCore.active(a.AKTIF)||nik==='-')throw Error('NIK atau PIN tidak sesuai.');if(Number(a.LOCK_UNTIL)>now)throw Error('Akun dikunci sementara. Coba lagi setelah 15 menit.');
    if(!safeEqual_(hash_(nik+'|'+a.SALT+'|'+pin),a.PIN_HASH)){a.GAGAL=Number(a.GAGAL||0)+1;if(a.GAGAL>=5){a.LOCK_UNTIL=now+15*60000;a.GAGAL=0;}writeAccount_(a);audit_(nik,'LOGIN_GAGAL','');throw Error('NIK atau PIN tidak sesuai.');}
    if(Number(a.GAGAL||0)||Number(a.LOCK_UNTIL||0)){a.GAGAL=0;a.LOCK_UNTIL=0;writeAccount_(a);}const token=issue_(a);audit_(nik,'LOGIN','');return {token,mustChange:PortalCore.active(a.WAJIB_GANTI)};
  }finally{lock.releaseLock();}
}
function guard_(token,admin,allowChange,db){
  const auth=authSession_(token),s=auth.s,a=auth.a;
  if(!allowChange&&PortalCore.active(a.WAJIB_GANTI))throw Error('PIN: Ganti PIN sementara terlebih dahulu.');
  db=db||snapshot_();const actor=db.meta.people.find(p=>p.nik===s.nik);if(!actor||actor.nik==='-')throw Error('Akun tidak ditemukan.');
  if(s.demoNik){if(admin)throw Error('Mode Demo hanya-baca. Kembali ke akun Super Admin untuk membuka administrasi.');const target=db.meta.people.find(p=>p.nik===s.demoNik),targetAccount=target&&account_(target.nik);if(!demoTargetAllowed_(target)||!targetAccount||!PortalCore.active(targetAccount.AKTIF))throw Error('Akun Demo tidak lagi tersedia. Kembali ke Super Admin.');return Object.assign({},target,{demo:true,demoActor:{nik:actor.nik,nama:actor.nama,role:actor.role}});}
  if(admin&&actor.role!=='SUPER ADMIN')throw Error('Akses admin diperlukan.');return actor;
}
function apiLogout(token){if(typeof token==='string'&&token.length<200)props_().deleteProperty('SESSION_'+hash_(token));return true;}
function apiChangePin(token,pin){demoAssertWritable_(token);const user=guard_(token,false,true);validatePin_(pin);const lock=LockService.getScriptLock();lock.waitLock(10000);try{demoAssertWritable_(token);guard_(token,false,true);const a=account_(user.nik);if(safeEqual_(hash_(user.nik+'|'+a.SALT+'|'+pin),a.PIN_HASH))throw Error('Pilih PIN yang berbeda.');const changed=setPin_(user.nik,pin,false);audit_(user.nik,'CHANGE_PIN','');return {token:issue_(changed)};}finally{lock.releaseLock();}}
function apiResetPin(token,nik){enforceUser_(token,nik);const lock=LockService.getScriptLock();lock.waitLock(10000);try{const {u}=enforceUser_(token,nik);checkpoint_(u.nik,'Reset PIN '+nik);const pin=randomPin_();setPin_(nik,pin,true);audit_(u.nik,'RESET_PIN',nik);return {nik,pin};}finally{lock.releaseLock();}}
function apiSetActive(token,nik,isActive){enforceUser_(token,nik);const lock=LockService.getScriptLock();lock.waitLock(10000);try{const {u,target,db}=enforceUser_(token,nik);if(nik===u.nik)throw Error('Tidak dapat mengubah status akun sendiri.');if(!isActive&&target.role==='SUPER ADMIN'&&lastSuper_(db,nik))throw Error('Super Admin aktif terakhir harus dipertahankan.');const a=account_(nik);if(!a)throw Error('Buat PIN terlebih dahulu.');if(isActive&&!a.PIN_HASH)throw Error('Buat PIN sementara dahulu.');checkpoint_(u.nik,'Status akun '+nik);a.AKTIF=!!isActive;a.VERSI=Number(a.VERSI)+1;writeAccount_(a);audit_(u.nik,'ACCOUNT_ACTIVE',nik+' '+!!isActive);return true;}finally{lock.releaseLock();}}
function resetPinMenu_(){const ui=SpreadsheetApp.getUi(),ask=ui.prompt('Reset PIN','NIK yang akan direset. PIN baru akan ditampilkan sekali.',ui.ButtonSet.OK_CANCEL);if(ask.getSelectedButton()!==ui.Button.OK)return;const nik=ask.getResponseText().trim();if(!snapshot_().meta.people.some(p=>p.nik===nik&&p.nik!=='-'))throw Error('NIK tidak ditemukan.');const pin=randomPin_();const lock=LockService.getScriptLock();lock.waitLock(10000);try{setPin_(nik,pin,true);audit_('EDITOR','RESET_PIN',nik);}finally{lock.releaseLock();}ui.alert('PIN sementara: '+pin+'\nPengguna wajib menggantinya saat masuk.');}
