/* Analisa mingguan Brand dan perbandingan Tim. Seluruh ID selalu dipotong oleh cakupan user. */
function analysisRange_(period,week){
  PortalCore.month(period);week=Math.max(1,Math.min(5,Number(week)||1));
  const last=Number(PortalCore.end(period).slice(8)),from=(week-1)*7+1,to=Math.min(last,week*7),pad=n=>String(n).padStart(2,'0');
  return {from:period+'-'+pad(from),to:period+'-'+pad(to),label:'W'+week};
}
function analysisMetric_(db,ids,range,metric,brand,type){
  const rows=PortalCore.slice(db,range.from.slice(0,7),ids).filter(r=>r.date>=range.from&&r.date<=range.to&&(brand==='ALL'||r.brand===brand)&&(!type||type==='ALL'||r.type===type));
  if(metric==='ST')return rows.reduce((n,r)=>n+(Number(r.q)||0),0);
  if(metric==='OMZET')return PortalCore.round(rows.reduce((n,r)=>n+(Number(r.a)||0),0));
  if(metric==='DA'){const dealers={};rows.forEach(r=>dealers[r.customer]=(dealers[r.customer]||0)+(Number(r.q)||0));return Object.values(dealers).filter(q=>q>=2).length;}
  if(metric==='NOO'){const customers=new Set();rows.forEach(r=>{const first=db.first?.[PortalCore.key([r.customer,r.brand])];if(first&&first.date>=range.from&&first.date<=range.to)customers.add(r.customer);});return customers.size;}
  if(metric==='SO')return (db.stock?.moves||[]).reduce((n,m)=>{if(m.date<range.from||m.date>range.to||!m.outQty||!StockCore.canSee(db,ids,m.customer))return n;const p=db.meta.products[m.sku];return n+((brand==='ALL'||p?.brand===brand)&&(!type||type==='ALL'||(p?.type||p?.nama||m.sku)===type)?Number(m.outQty)||0:0);},0);
  throw Error('Indikator analisa tidak dikenal.');
}
function analysisIds_(source,u,selection,filter){
  let ids=allowed_(source,u,selection),people=source.meta.people,chosen=filter?.sales||filter?.asm||filter?.rgm||'';
  if(chosen){if(!ids.includes(chosen))throw Error('Filter berada di luar cakupan.');const scoped=PortalCore.scope(people,chosen);ids=ids.filter(id=>scoped.includes(id));}
  const big=String(filter?.big||'ALL'),region=String(filter?.region||'ALL'),sub=String(filter?.sub||'ALL');
  if(big!=='ALL')ids=ids.filter(id=>people.find(p=>p.nik===id)?.wilayah===big);
  if(region!=='ALL')ids=ids.filter(id=>{const p=people.find(x=>x.nik===id);return (p?.portfolio||p?.region)===region;});
  if(sub!=='ALL')ids=ids.filter(id=>{const p=people.find(x=>x.nik===id);return (p?.portfolio||p?.region)===sub;});
  return ids;
}
function analysisPeriodRange_(db,period,day){
  period=PortalCore.month(period);
  const sourceCut=db.coverage?.[period]?.cutoff||PortalCore.end(period),last=Number(PortalCore.end(period).slice(8)),cut=Math.min(last,Number(sourceCut.slice(8)),Number(day)||last),pad=n=>String(n).padStart(2,'0');
  return {from:period+'-01',to:period+'-'+pad(cut),label:period};
}
function analysisTypes_(db,ids,period,brand){
  const names=PortalCore.slice(db,period,ids).filter(r=>brand==='ALL'||r.brand===brand).map(r=>r.type);
  Object.values(db.meta.products||{}).forEach(p=>{if((brand==='ALL'||p.brand===brand)&&p.device)names.push(p.type||p.nama);});
  return [...new Set(names.map(PortalCore.text).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'id'));
}
function apiWeeklyAnalysis(token,period,selection,request){
  const source=snapshot_(),u=guard_(token,false,false,source),ids=analysisIds_(source,u,selection,request?.filter),db=coverageView_(source,period,ids,'ST',u),brand=String(request?.brand||'ALL'),type=String(request?.type||'ALL'),metric=String(request?.metric||'ST'),mode=String(request?.mode||'WOW').toUpperCase();
  if(!['WOW','MOM'].includes(mode))throw Error('Mode perbandingan tidak dikenal.');
  if(!['ST','SO','OMZET'].includes(metric))throw Error('Metrik analisa brand tidak dikenal.');
  const periods=Object.keys(source.coverage||{}).sort().reverse(),cut=Number((db.coverage[period]?.cutoff||PortalCore.end(period)).slice(8)),maxWeek=Math.max(1,Math.min(5,Math.ceil(cut/7))),weekOptions=Array.from({length:maxWeek},(_,i)=>i+1);
  let rangeA,rangeB;
  if(mode==='MOM'){
    let monthB=String(request?.periodB||period),monthA=String(request?.periodA||PortalCore.prev(monthB));
    if(!periods.includes(monthB))monthB=period;
    if(!periods.includes(monthA))monthA=periods.find(p=>p<monthB)||PortalCore.prev(monthB);
    const day=Math.min(Number((db.coverage?.[monthA]?.cutoff||PortalCore.end(monthA)).slice(8)),Number((db.coverage?.[monthB]?.cutoff||PortalCore.end(monthB)).slice(8)));
    rangeA=analysisPeriodRange_(db,monthA,day);rangeB=analysisPeriodRange_(db,monthB,day);
  }else{
    let weekA=Math.max(1,Math.min(maxWeek,Number(request?.weekA)||Math.max(1,maxWeek-1))),weekB=Math.max(1,Math.min(maxWeek,Number(request?.weekB)||maxWeek));
    if(weekA===weekB&&maxWeek>1)weekA=weekB===1?2:weekB-1;
    rangeA=analysisRange_(period,weekA);rangeB=analysisRange_(period,weekB);
    const cap=period+'-'+String(cut).padStart(2,'0');if(rangeA.to>cap)rangeA.to=cap;if(rangeB.to>cap)rangeB.to=cap;
  }
  const types=analysisTypes_(db,ids,period,brand),shown=type==='ALL'?types:types.filter(t=>t===type),make=(key,label,isTotal)=>{const selectedType=isTotal?'ALL':key,a=analysisMetric_(db,ids,rangeA,metric,brand,selectedType),b=analysisMetric_(db,ids,rangeB,metric,brand,selectedType),delta=b-a;return {key,label,total:!!isTotal,a,b,delta,growth:a?delta/a*100:b?null:0};},total=make('TOTAL','TOTAL '+brand,true),groups=[total,...shown.map(t=>make(t,t,false))],ranked=groups.slice(1).sort((a,b)=>b.delta-a.delta||b.b-a.b),contributors=groups.slice(1).sort((a,b)=>b.b-a.b);
  return {groups,types,scopeCount:ids.filter(id=>source.meta.people.find(p=>p.nik===id)?.sales).length,best:ranked[0]||null,worst:ranked[ranked.length-1]||null,topContributor:contributors[0]||null,total,metric,mode,brand,type,periodA:rangeA.label,periodB:rangeB.label,rangeA,rangeB,periods,weekOptions,cutoff:db.coverage[period]?.cutoff};
}

function apiTeamComparison(token,period,selection,request){
  const source=snapshot_(),u=guard_(token,false,false,source),me=source.meta.people.find(p=>p.nik===u.nik),base=u.role==='SALES'&&me?.atasan?source.meta.people.filter(p=>p.sales&&p.atasan===me.atasan).map(p=>p.nik):allowed_(source,u,selection),filter=request?.filter||{},people=source.meta.people,chosen=filter.sales||filter.asm||filter.rgm||'',chosenScope=chosen?PortalCore.scope(people,chosen):base,ids=base.filter(id=>chosenScope.includes(id)&&(filter.big==='ALL'||!filter.big||people.find(p=>p.nik===id)?.wilayah===filter.big)&&(filter.region==='ALL'||!filter.region||(people.find(p=>p.nik===id)?.portfolio||people.find(p=>p.nik===id)?.region)===filter.region)&&(filter.sub==='ALL'||!filter.sub||(people.find(p=>p.nik===id)?.portfolio||people.find(p=>p.nik===id)?.region)===filter.sub)),db=coverageView_(source,period,ids,'ST',u),level=String(request?.level||'SALES'),metric=String(request?.metric||'ST'),brand=String(request?.brand||'ALL'),mode=String(request?.mode||'WOW');
  let aRange,bRange;if(mode==='MOM'){const pp=PortalCore.prev(period),day=Number((db.coverage[period]?.cutoff||PortalCore.end(period)).slice(8)),pad=n=>String(n).padStart(2,'0');aRange={from:pp+'-01',to:pp+'-'+pad(Math.min(day,Number(PortalCore.end(pp).slice(8)))),label:pp};bRange={from:period+'-01',to:period+'-'+pad(day),label:period};}else{aRange=analysisRange_(period,request?.weekA||1);bRange=analysisRange_(period,request?.weekB||2);if(aRange.label===bRange.label)throw Error('Minggu pembanding harus berbeda.');}
  const allowedLevels=['SALES','ASM','RGM','BIG REGION','REGION'];if(!allowedLevels.includes(level)||u.role==='SALES'&&level!=='SALES')throw Error('Tingkat analisa tidak diizinkan.');
  let groups=[];
  if(level==='BIG REGION'||level==='REGION'){
    const sales=people.filter(p=>ids.includes(p.nik)&&p.sales),bucket={};sales.forEach(p=>{const name=level==='BIG REGION'?(p.wilayah||'LAINNYA'):(p.portfolio||p.region||'LAINNYA');(bucket[name]=bucket[name]||[]).push(p.nik);});groups=Object.keys(bucket).map(name=>({nik:'',nama:name,region:level==='BIG REGION'?'Nasional':sales.find(p=>(p.portfolio||p.region||'LAINNYA')===name)?.wilayah||'',team:bucket[name]}));
  }else groups=people.filter(p=>ids.includes(p.nik)&&(level==='SALES'?p.sales:p.role===level)).map(p=>({nik:p.nik,nama:p.nama,region:p.portfolio||p.region||p.wilayah||'',team:level==='SALES'?[p.nik]:PortalCore.scope(people,p.nik).filter(id=>ids.includes(id))}));
  const rows=groups.map(p=>{const a=analysisMetric_(db,p.team,aRange,metric,brand,'ALL'),b=analysisMetric_(db,p.team,bRange,metric,brand,'ALL'),delta=b-a;return {nik:p.nik,nama:p.nama,region:p.region,a,b,delta,growth:a?delta/a*100:b?null:0};}).sort((x,y)=>y.delta-x.delta||x.nama.localeCompare(y.nama,'id'));
  return {rows,periodA:aRange.label,periodB:bRange.label,best:rows[0]||null,worst:rows[rows.length-1]||null,metric,mode,level};
}
