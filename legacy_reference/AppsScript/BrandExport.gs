/* Brand export: one brand per Excel sheet, aggregated by Big Region or Sub Region. */
function brandExportDeviceBrands_(meta){return [...new Set(Object.values(meta.products||{}).filter(p=>p.device).map(p=>PortalCore.text(p.brand)).filter(Boolean))].sort();}
function brandExportAccess_(db,u){
 const all=RegionCore.regions(db.meta),own=PortalCore.text(u.wilayah),top=RegionCore.top(u.role)||u.role==='SUPER ADMIN';let big=[],subParents=[];
 if(top){big=all;subParents=all;}
 else if(u.role==='ADMIN'){big=(u.adminRegions||[]).filter(r=>all.includes(r));subParents=big.slice();}
 else if(u.role==='RGM'){big=all;subParents=own?[own]:[];}
 else {big=own&&all.includes(own)?[own]:[];subParents=big.slice();}
 return {big:[...new Set(big)].sort(),subParents:[...new Set(subParents)].sort()};
}
function brandExportSubRegion_(p){return PortalCore.text(p.portfolio||p.region);}
function brandExportRgm_(meta,big){const names=[...new Set(meta.people.filter(p=>p.role==='RGM'&&p.wilayah===big).map(p=>p.nama).filter(Boolean))].sort();return names.join(', ')||'—';}
function apiBrandExportOptions(token){
 const db=snapshot_(),u=exportGuard_(token,'BRAND',db),access=brandExportAccess_(db,u),scope=new Set(PortalCore.scope(db.meta.people,u.nik)),full=exportAccessAutomatic_(u)||RegionCore.top(u.role),sales=db.meta.people.filter(p=>p.sales&&(full||scope.has(p.nik))),subs={};
 access.subParents.forEach(big=>subs[big]=[...new Set(sales.filter(p=>p.wilayah===big).map(brandExportSubRegion_).filter(Boolean))].sort());
 return {brands:brandExportDeviceBrands_(db.meta),bigRegions:access.big,subParents:access.subParents,subRegions:subs,defaultBig:access.subParents.includes(u.wilayah)?u.wilayah:(access.subParents[0]||'')};
}
function brandExportParseList_(value,label){if(!Array.isArray(value))throw Error(label+' tidak valid.');return [...new Set(value.map(PortalCore.text).filter(Boolean))];}
function brandExportCutoff_(db,kind,period,bigs){
 if(db.parts){const info=RegionCore.common(db.parts,kind,period,bigs);return info.cutoff||null;}
 return kind==='ST'?db.coverage?.[period]?.cutoff||null:db.stock?.coverage?.[period]?.cutoff||null;
}
function brandExportPrevCutoff_(db,kind,period,current,bigs){
 if(!current)return null;const prev=PortalCore.prev(period),want=prev+'-'+String(Math.min(+current.slice(8),+PortalCore.end(prev).slice(8))).padStart(2,'0'),available=brandExportCutoff_(db,kind,prev,bigs);return available?(available<want?available:want):null;
}
function brandExportGroups_(db,u,selection){
 const access=brandExportAccess_(db,u),scope=new Set(PortalCore.scope(db.meta.people,u.nik)),full=exportAccessAutomatic_(u)||RegionCore.top(u.role),sales=db.meta.people.filter(p=>p.sales&&(full||scope.has(p.nik))),level=PortalCore.text(selection.level).toUpperCase();if(!['BIG','SUB'].includes(level))throw Error('Pilih Big Region atau Sub Region.');
 if(level==='BIG'){
  let bigs=brandExportParseList_(selection.bigRegions||[],'Big Region');if(!bigs.length)bigs=access.big.slice();if(!bigs.length||bigs.some(r=>!access.big.includes(r)))throw Error('Big Region di luar hak akses.');bigs.sort((a,b)=>a.localeCompare(b));
  return {level,bigs,groups:bigs.map(big=>{const ids=sales.filter(p=>p.wilayah===big).map(p=>p.nik);return {name:big,big,sub:'',ids,rgm:brandExportRgm_(db.meta,big)};})};
 }
 const parent=PortalCore.text(selection.parentBig);if(!parent||!access.subParents.includes(parent))throw Error('Pilih Big Region induk yang diizinkan.');const known=[...new Set(sales.filter(p=>p.wilayah===parent).map(brandExportSubRegion_).filter(Boolean))].sort();let subs=brandExportParseList_(selection.subRegions||[],'Sub Region');if(!subs.length)subs=known.slice();if(!subs.length||subs.some(r=>!known.includes(r)))throw Error('Sub Region di luar Big Region induk atau hak akses.');subs.sort((a,b)=>a.localeCompare(b));
 return {level,bigs:[parent],groups:subs.map(sub=>{const ids=sales.filter(p=>p.wilayah===parent&&brandExportSubRegion_(p)===sub).map(p=>p.nik);return {name:sub,big:parent,sub,ids,rgm:brandExportRgm_(db.meta,parent)};})};
}
function brandExportRowMatch_(r,g){if(!g._set)g._set=new Set(g.ids);return g._set.has(r.nik)&&(!r.region||r.region===g.big);}
function brandExportStRows_(db,period,g,cut){if(!cut)return [];return (db.cubes?.[period]||[]).filter(r=>r.date<=cut&&brandExportRowMatch_(r,g));}
function brandExportAssignmentIndex_(){const rows=optionalTable_('Dealer_Assignment_History'),out={};rows.forEach(r=>{const customer=PortalCore.text(r['KODE CUSTOMER']),nik=PortalCore.text(r['NIK SALES']),from=PortalCore.text(r.BERLAKU_MULAI),to=PortalCore.text(r.BERLAKU_SAMPAI);if(customer&&nik)(out[customer]||(out[customer]=[])).push({nik,from,to});});Object.values(out).forEach(a=>a.sort((x,y)=>(y.from||'').localeCompare(x.from||'')));return out;}
function brandExportOwnerAt_(db,index,customer,date){const found=(index[customer]||[]).find(x=>(!x.from||x.from<=date)&&(!x.to||x.to>=date));return found?.nik||db.stock?.owners?.[customer]||db.meta.customers?.[customer]?.nik||'';}
function brandExportSoQty_(db,assign,period,g,brand,cut,onlyDate){if(!cut||!db.stock)return null;const set=new Set(g.ids);let qty=0;db.stock.moves.forEach(t=>{if(!t.outQty||t.date.slice(0,7)!==period||t.date>cut||(onlyDate&&t.date!==onlyDate))return;const p=db.meta.products[t.sku];if(!p||p.brand!==brand)return;const owner=brandExportOwnerAt_(db,assign,t.customer,t.date);if(!set.has(owner))return;const person=db.meta.people.find(x=>x.nik===owner);if(person?.wilayah&&person.wilayah!==g.big)return;if(g.sub&&brandExportSubRegion_(person||{})!==g.sub)return;qty+=t.outQty;});return qty;}
function brandExportGrowth_(now,prev){if(now==null||prev==null)return null;if(!prev)return 0;return Math.min(5,now/prev-1);}
function brandExportTarget_(meta,period,ids,brand){const t=PortalCore.target(meta,period,ids,brand,'QTY');return !t.exists||t.missing?.length?0:Number(t.value||0);}
function brandExportJoinSet_(db,g,brand,period,cut){const set=new Set;Object.keys(db.cubes||{}).filter(p=>p<=period).forEach(p=>(db.cubes[p]||[]).forEach(r=>{if(r.brand!==brand||r.q<=0||p===period&&cut&&r.date>cut||!brandExportRowMatch_(r,g))return;set.add(r.customer);}));return set;}
function brandExportMetrics_(db,assign,period,g,brand,stCut,soCut,prevStCut,prevSoCut){
 const prev=PortalCore.prev(period),nowRows=brandExportStRows_(db,period,g,stCut),prevRows=brandExportStRows_(db,prev,g,prevStCut),todayRows=nowRows.filter(r=>r.date===stCut),now=PortalCore.metrics(nowRows,db,period,brand),before=PortalCore.metrics(prevRows,db,prev,brand),today=PortalCore.metrics(todayRows,db,period,brand),target=brandExportTarget_(db.meta,period,g.ids,brand),soNow=brandExportSoQty_(db,assign,period,g,brand,soCut,''),soToday=brandExportSoQty_(db,assign,period,g,brand,soCut,soCut),soPrev=brandExportSoQty_(db,assign,prev,g,brand,prevSoCut,'');
 return {region:g.name,rgm:g.rgm,target,todayST:today.qty,mtdST:now.qty,lmtdST:before.qty,achv:target>0?now.qty/target:0,growthST:brandExportGrowth_(now.qty,before.qty),todayOmzet:today.omzet,mtdOmzet:now.omzet,lmtdOmzet:before.omzet,growthOmzet:brandExportGrowth_(now.omzet,before.omzet),dealerJoin:brandExportJoinSet_(db,g,brand,period,stCut).size,todayDA:today.da,mtdDA:now.da,lmtdDA:before.da,growthDA:brandExportGrowth_(now.da,before.da),todaySO:soToday,mtdSO:soNow,lmtdSO:soPrev,growthSO:brandExportGrowth_(soNow,soPrev),noo:now.noo};
}
function brandExportTotal_(db,assign,period,groups,brand,stCut,soCut,prevStCut,prevSoCut){
 const ids=[...new Set(groups.flatMap(g=>g.ids))],bigs=[...new Set(groups.map(g=>g.big))],all={name:'GRAND TOTAL',big:'',sub:'',ids,rgm:'',_set:new Set(ids)},prev=PortalCore.prev(period),filter=(rows,cut)=>rows.filter(r=>r.date<=cut&&all._set.has(r.nik)&&(!r.region||bigs.includes(r.region))),nowRows=stCut?filter(db.cubes?.[period]||[],stCut):[],prevRows=prevStCut?filter(db.cubes?.[prev]||[],prevStCut):[],todayRows=nowRows.filter(r=>r.date===stCut),now=PortalCore.metrics(nowRows,db,period,brand),before=PortalCore.metrics(prevRows,db,prev,brand),today=PortalCore.metrics(todayRows,db,period,brand),target=brandExportTarget_(db.meta,period,ids,brand);
 // Total SO uses all selected IDs; no per-group region filter is required because IDs are already restricted.
 const soQty=(p,cut,day)=>{if(!cut||!db.stock)return null;const set=new Set(ids);let qty=0;db.stock.moves.forEach(t=>{if(!t.outQty||t.date.slice(0,7)!==p||t.date>cut||(day&&t.date!==day))return;const product=db.meta.products[t.sku];if(!product||product.brand!==brand)return;const owner=brandExportOwnerAt_(db,assign,t.customer,t.date);if(set.has(owner))qty+=t.outQty;});return qty;},soNow=soQty(period,soCut,''),soToday=soQty(period,soCut,soCut),soPrev=soQty(prev,prevSoCut,''),join=new Set;groups.forEach(g=>brandExportJoinSet_(db,g,brand,period,stCut).forEach(x=>join.add(x)));
 return {region:'GRAND TOTAL',rgm:'',target,todayST:today.qty,mtdST:now.qty,lmtdST:before.qty,achv:target>0?now.qty/target:0,growthST:brandExportGrowth_(now.qty,before.qty),todayOmzet:today.omzet,mtdOmzet:now.omzet,lmtdOmzet:before.omzet,growthOmzet:brandExportGrowth_(now.omzet,before.omzet),dealerJoin:join.size,todayDA:today.da,mtdDA:now.da,lmtdDA:before.da,growthDA:brandExportGrowth_(now.da,before.da),todaySO:soToday,mtdSO:soNow,lmtdSO:soPrev,growthSO:brandExportGrowth_(soNow,soPrev),noo:now.noo};
}
function brandExportTypeData_(db,assign,period,scope,brand,stCut,soCut){
 if(!soCut)throw Error('Data SO belum tersedia untuk export Per Type.');
 const cut=[stCut,soCut].filter(Boolean).sort()[0],selected=new Set(scope.groups.flatMap(g=>g.ids)),weeks=Array.from({length:5},()=>0),types=[...new Set(Object.values(db.meta.products||{}).filter(p=>p.device&&p.brand===brand).map(p=>PortalCore.text(p.type||p.nama||p.id)).filter(Boolean))].sort(),map={};
 types.forEach(type=>map[type]={type,st:[0,0,0,0,0],so:[0,0,0,0,0]});
 (db.cubes?.[period]||[]).forEach(r=>{if(r.date>cut||r.brand!==brand||!r.q||!selected.has(r.nik)||r.region&&!scope.bigs.includes(r.region))return;const type=PortalCore.text(r.type)||'TANPA TYPE',row=map[type]||(map[type]={type,st:[0,0,0,0,0],so:[0,0,0,0,0]}),w=Math.min(4,Math.floor((Number(r.date.slice(8))-1)/7));row.st[w]+=r.q;});
 (db.stock?.moves||[]).forEach(t=>{if(!t.outQty||t.date.slice(0,7)!==period||t.date>cut)return;const product=db.meta.products[t.sku];if(!product||product.brand!==brand)return;const owner=brandExportOwnerAt_(db,assign,t.customer,t.date);if(!selected.has(owner))return;const person=db.meta.people.find(p=>p.nik===owner);if(person?.wilayah&&!scope.bigs.includes(person.wilayah))return;const type=PortalCore.text(product.type||product.nama||t.sku)||'TANPA TYPE',row=map[type]||(map[type]={type,st:[0,0,0,0,0],so:[0,0,0,0,0]}),w=Math.min(4,Math.floor((Number(t.date.slice(8))-1)/7));row.so[w]+=t.outQty;});
 const rows=Object.values(map).sort((a,b)=>a.type.localeCompare(b.type));rows.forEach(r=>{r.totalST=r.st.reduce((n,x)=>n+x,0);r.totalSO=r.so.reduce((n,x)=>n+x,0);});
 const total={type:'TOTAL',st:[0,0,0,0,0],so:[0,0,0,0,0]};rows.forEach(r=>r.st.forEach((n,i)=>total.st[i]+=n));rows.forEach(r=>r.so.forEach((n,i)=>total.so[i]+=n));total.totalST=total.st.reduce((n,x)=>n+x,0);total.totalSO=total.so.reduce((n,x)=>n+x,0);
 const scopeLabel=scope.level==='BIG'?scope.groups.map(g=>g.name).join(', '):scope.groups.map(g=>g.name).join(', ');
 return {cutoff:cut,scopeLabel:scopeLabel||'—',rows,total};
}
function apiBrandExportData(token,period,selection){
 const db=snapshot_(),u=exportGuard_(token,'BRAND',db);period=PortalCore.month(period);selection=selection&&typeof selection==='object'?selection:{};const scope=brandExportGroups_(db,u,selection),known=brandExportDeviceBrands_(db.meta);let brands=brandExportParseList_(selection.brands||[],'Brand');if(!brands.length)brands=known.slice();if(brands.some(b=>!known.includes(b)))throw Error('Brand export tidak dikenal.');brands.sort((a,b)=>a.localeCompare(b));
 const includeSummary=selection.includeSummary!==false,includeType=selection.includeType!==false;if(!includeSummary&&!includeType)throw Error('Pilih minimal satu isi export.');
 const stCut=brandExportCutoff_(db,'ST',period,scope.bigs),soCut=brandExportCutoff_(db,'SO',period,scope.bigs);if(!stCut)throw Error('Data ST belum lengkap untuk region pilihan.');if(includeType&&!soCut)throw Error('Data SO belum lengkap untuk export Per Type.');const prevStCut=brandExportPrevCutoff_(db,'ST',period,stCut,scope.bigs),prevSoCut=soCut?brandExportPrevCutoff_(db,'SO',period,soCut,scope.bigs):null,assign=brandExportAssignmentIndex_(),sheets=brands.map(brand=>({brand,summary:includeSummary?{rows:scope.groups.map(g=>brandExportMetrics_(db,assign,period,g,brand,stCut,soCut,prevStCut,prevSoCut)),total:brandExportTotal_(db,assign,period,scope.groups,brand,stCut,soCut,prevStCut,prevSoCut)}:null,type:includeType?brandExportTypeData_(db,assign,period,scope,brand,stCut,soCut):null}));
 audit_(u.nik,'BRAND_XLSX_EXPORT',period+' '+scope.level+' '+scope.bigs.join('|')+' '+brands.join('|')+' '+(includeSummary?'SUMMARY ':'')+(includeType?'TYPE':''));return {name:'Brand-Report-'+period+'-'+scope.level+'.xlsx',period,level:scope.level,parentBig:scope.level==='SUB'?scope.bigs[0]:'',stCut,soCut,prevPeriod:PortalCore.prev(period),prevStCut,prevSoCut,includeSummary,includeType,sheets};
}
