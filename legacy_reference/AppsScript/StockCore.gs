/* Sell-out and stock are monitoring only; never input to KPI scoring. */
var StockCore=(function(){
 const BASE='2025-12-01';
 function shift(d,n){return new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);}
 function parse(rows,meta,period,cutoff){return rows.map((r,i)=>{const x={date:PortalCore.iso(r['TANGGAL SO']),customer:PortalCore.text(r['KODE CUSTOMER']),sku:PortalCore.text(r['KODE PRODUK']),qty:PortalCore.number(r.QTY)};if(!x.customer||!meta.products[x.sku])throw Error('SO baris '+(i+2)+': dealer kosong atau produk tidak dikenal '+x.sku);if(!Number.isInteger(x.qty)||x.qty<0)throw Error('SO harus QTY bulat nonnegatif. Koreksi melalui penggantian periode.');if(period&&x.date.slice(0,7)!==period)throw Error('SO berada di luar bulan '+period);if(cutoff&&x.date>cutoff)throw Error('SO melewati cutoff '+cutoff);return x;});}
 function build(meta,tx,so){
  const owners={},candidates={},notes=[];Object.values(meta.customers).forEach(c=>owners[c.id]=c.nik);
  tx.forEach(t=>(candidates[t.customer]||(candidates[t.customer]=new Set())).add(t.nik));
  Object.keys(candidates).forEach(id=>{if(!owners[id]){if(candidates[id].size===1){owners[id]=Array.from(candidates[id])[0];notes.push('Dealer '+id+' belum di master; pemilik sementara dari Sell Thru.');}else notes.push('Dealer '+id+' belum memiliki pemilik tunggal; hanya terlihat nasional.');}});
  const map={};function add(t,kind){const p=meta.products[t.sku];if(!p)throw Error('Produk histori SO tidak ada di master: '+t.sku);if(!p.device)return;const k=PortalCore.key([t.date,t.customer,t.sku,t.region||'']);const r=map[k]||(map[k]={date:t.date,region:t.region||'',customer:t.customer,sku:t.sku,inQty:0,outQty:0});r[kind]+=t.qty;}
  tx.forEach(t=>add(t,'inQty'));(so.rows||[]).forEach(t=>add(t,'outQty'));
  const early=(so.rows||[]).filter(t=>t.date<BASE&&t.qty!==0);if(early.length)notes.push(early.length+' baris SO sebelum baseline '+BASE+'; tidak dikurangkan dari stok dan ditandai perlu cek.');
  Object.keys(map).forEach(k=>{const id=map[k].customer;if(!owners[id]&&!notes.includes('Dealer '+id+' belum terpetakan; hanya terlihat nasional.'))notes.push('Dealer '+id+' belum terpetakan; hanya terlihat nasional.');});
  return {moves:Object.values(map),owners,coverage:so.coverage||{},notes,base:BASE};
 }
 function complete(cov,from,to){for(let d=from;d<=to;){const p=d.slice(0,7),last=PortalCore.end(p)<to?PortalCore.end(p):to;if(!cov[p]||cov[p].cutoff<last)return false;d=shift(last,1);}return true;}
 function canSee(db,ids,customer){const owner=db.stock?.owners[customer];return owner?ids.includes(owner):db.meta.people.every(p=>ids.includes(p.nik));}
 function monthly(db,period,ids,customer,brand,type){
 const st=db.stock;if(!st?.coverage[period])return {qty:null,cutoff:null,complete:false};const cutoff=st.coverage[period].cutoff<db.coverage[period].cutoff?st.coverage[period].cutoff:db.coverage[period].cutoff,cacheKey=PortalCore.key([period,ids,cutoff]);
 if(!db._soIndexes)Object.defineProperty(db,'_soIndexes',{value:{},enumerable:false});let index=db._soIndexes[cacheKey];if(!index){index={};const allowed=new Set(ids),all=db.meta.people.every(p=>allowed.has(p.nik));st.moves.forEach(t=>{const owner=st.owners[t.customer];if(t.date.slice(0,7)!==period||t.date>cutoff||!(owner?allowed.has(owner):all))return;const p=db.meta.products[t.sku];for(const c of ['',t.customer])for(const b of ['',p.brand])for(const ty of new Set(['',p.type||p.nama||t.sku])){const k=PortalCore.key([c,b,ty]);index[k]=(index[k]||0)+t.outQty;}});db._soIndexes[cacheKey]=index;}
 return {qty:index[PortalCore.key([customer||'',brand||'',type||''])]||0,cutoff,complete:cutoff===db.coverage[period].cutoff};
 }
 function rule(db,region){return (db.dosRules||[]).find(r=>r.region===region)||(db.dosRules||[]).find(r=>r.region==='ALL')||{min:7,max:45};}
 function calculate(db,period,ids,filter){
  PortalCore.month(period);if(!db.coverage[period])throw Error('Periode tidak tersedia.');const st=db.stock,soCut=st?.coverage[period]?.cutoff,stCut=db.coverage[period].cutoff;
  if(!soCut)return {ready:false,message:'Sell Out bulan ini belum dipublikasikan.',rows:[],regions:[],total:null,stCut,soCut:null};
  const asof=soCut<stCut?soCut:stCut,from=shift(asof,-29),covered=db.historyComplete!==false&&complete(db.coverage,BASE,asof)&&complete(st.coverage,BASE,asof),windowReady=from>=BASE&&complete(st.coverage,from,asof),skus={};
  st.moves.forEach(t=>{if(t.date>asof||!canSee(db,ids,t.customer))return;const k=PortalCore.key([t.customer,t.sku]),p=db.meta.products[t.sku],owner=st.owners[t.customer],person=db.meta.people.find(p=>p.nik===owner),customer=db.meta.customers[t.customer],region=person?.portfolio||person?.region||customer?.region||'Belum terpetakan',big=person?.wilayah||'Belum terpetakan';
    const r=skus[k]||(skus[k]={customer:t.customer,nama:customer?.nama||t.customer+' (belum di master)',nik:owner||'',sales:person?.nama||'Belum terpetakan',region,big,brand:p.brand,type:p.type||p.nama||t.sku,stock:0,sellout:0,early:false});
    if(t.date<BASE){if(t.outQty)r.early=true;return;}r.stock+=t.inQty-t.outQty;if(t.date>=from)r.sellout+=t.outQty;
  });
  const groups={};Object.values(skus).forEach(r=>{const k=PortalCore.key([r.customer,r.brand,r.type]),g=groups[k]||(groups[k]={...r,stock:0,sellout:0,bad:false,reasons:[]});if(r.early)g.reasons.push('SO sebelum baseline Desember 2025');if(r.stock<0)g.reasons.push('Selisih negatif pada kode barang');if(!r.nik)g.reasons.push('Pemilik dealer belum terpetakan');g.stock+=r.stock;g.sellout+=r.sellout;g.bad=g.bad||r.early||r.stock<0||!r.nik;});
  let rows=Object.values(groups).map(r=>{const limits=rule(db,r.big),avg=windowReady?r.sellout/30:null,dos=covered&&!r.bad&&avg>0?r.stock/avg:null,status=!covered||!windowReady||r.bad?'PERLU CEK DATA':r.stock===0?(r.sellout>0?'HABIS':'TIDAK AKTIF'):r.sellout===0?'BELUM BERGERAK':dos<limits.min?'MENIPIS':dos>limits.max?'STOK TINGGI':'CUKUP';return {...r,reason:[...new Set(r.reasons.concat(!covered?['Histori ST/SO belum lengkap']:[],!windowReady?['Data 30 hari belum lengkap']:[]))].join('; '),avg,dos,status};});
  filter=filter||{};rows=rows.filter(r=>(!filter.region||filter.region==='ALL'||r.big===filter.region)&&(!filter.subRegion||filter.subRegion==='ALL'||r.region===filter.subRegion)&&(!filter.brand||filter.brand==='ALL'||r.brand===filter.brand)&&(!filter.type||filter.type==='ALL'||r.type===filter.type)&&(!filter.status||filter.status==='ALL'||r.status===filter.status)&&(!filter.query||(r.nama+' '+r.customer+' '+r.type+' '+r.sales).toLowerCase().includes(String(filter.query).toLowerCase())));
  rows.sort((a,b)=>a.nama.localeCompare(b.nama)||a.brand.localeCompare(b.brand)||a.type.localeCompare(b.type));
  function total(items){const stock=items.reduce((n,r)=>n+r.stock,0),sellout=items.reduce((n,r)=>n+r.sellout,0),bad=items.some(r=>r.status==='PERLU CEK DATA'),avg=windowReady?sellout/30:null;return {stock,sellout,avg,dos:covered&&!bad&&avg>0?stock/avg:null,dealerCount:new Set(items.map(r=>r.customer)).size,typeCount:items.length,low:items.filter(r=>['MENIPIS','HABIS'].includes(r.status)).length,bad:items.filter(r=>r.status==='PERLU CEK DATA').length};}
  const regions={};rows.forEach(r=>(regions[PortalCore.key([r.big,r.region])]||(regions[PortalCore.key([r.big,r.region])]={big:r.big,region:r.region,items:[]})).items.push(r));
  const brands={};rows.forEach(r=>(brands[PortalCore.key([r.customer,r.brand])]||(brands[PortalCore.key([r.customer,r.brand])]={customer:r.customer,nama:r.nama,brand:r.brand,items:[]})).items.push(r));
  return {ready:true,asof,from,stCut,soCut,covered,windowReady,total:total(rows),regions:Object.values(regions).map(r=>({big:r.big,region:r.region,...total(r.items)})),brands:Object.values(brands).map(r=>({customer:r.customer,nama:r.nama,brand:r.brand,...total(r.items)})),rows};
 }
 return {BASE,shift,parse,build,complete,monthly,calculate,canSee};
})();

