/* KPI export: dynamic per-region KPI detail plus national ranking for RGM ke atas/Admin. */
function kpiExportRoles_(){return ['ASM','RGM','ADMIN','SUPER ADMIN','HEAD OF SALES','CHIEF OPERATING OFFICER','CHIEF COMMERCIAL OFFICER','BOARD OF DIRECTOR'];}
function kpiExportGuard_(token,db){return exportGuard_(token,'KPI',db);}
function kpiExportSub_(p){return PortalCore.text(p?.portfolio||p?.region);}
function kpiExportIsTopTier_(u){return RegionCore.top(u.role);}
function kpiExportFullDetail_(u){return u.role==='SUPER ADMIN';}
function kpiExportRankAllowed_(u){return u.role==='RGM'||u.role==='ADMIN'||u.role==='SUPER ADMIN'||kpiExportIsTopTier_(u);}
function kpiExportGroupOrder_(names){const priority=n=>/all\s*brand/i.test(n)?0:/motopad/i.test(n)?1:/realme/i.test(n)?2:3;return [...new Set(names.map(PortalCore.text).filter(Boolean))].sort((a,b)=>priority(a)-priority(b)||a.localeCompare(b,'id',{numeric:true,sensitivity:'base'}));}
function kpiExportPeriods_(db){return [...new Set((db.meta.policies||[]).map(p=>p.period).filter(Boolean))].sort().reverse();}
function kpiExportGroups_(db,period){return kpiExportGroupOrder_((db.meta.policies||[]).filter(p=>p.period===period).map(p=>p.group));}
function apiKPIExportOptions(token,period){
 const db=snapshot_(),u=kpiExportGuard_(token,db),periods=kpiExportPeriods_(db);period=PortalCore.text(period);if(!periods.includes(period))period=periods[0]||period;
 const groups=period?kpiExportGroups_(db,period):[];return {periods,period,ranking:kpiExportRankAllowed_(u),rankingOnly:kpiExportIsTopTier_(u),groups,defaultRank:'FINAL'};
}
function kpiExportDetailRegions_(db,u){
 const all=RegionCore.regions(db.meta);
 if(kpiExportIsTopTier_(u))return [];
 if(kpiExportFullDetail_(u))return all;
 if(u.role==='ADMIN')return [...new Set((u.adminRegions||[]).filter(r=>all.includes(r)))].sort();
 return u.wilayah&&all.includes(u.wilayah)?[u.wilayah]:[];
}
function kpiExportBaseIds_(db,u){
 if(kpiExportFullDetail_(u))return db.meta.people.map(p=>p.nik);
 if(u.role==='ADMIN'){const allowed=new Set(u.adminRegions||[]);return db.meta.people.filter(p=>allowed.has(p.wilayah)).map(p=>p.nik);}
 return PortalCore.scope(db.meta.people,u.nik);
}
function kpiExportAncestor_(people,p,role){let x=p,seen=new Set();while(x&&!seen.has(x.nik)){seen.add(x.nik);if(x.role===role)return x;x=people.find(q=>q.nik===x.atasan);}return null;}
function kpiExportBossName_(people,p){return people.find(x=>x.nik===p.atasan)?.nama||'';}
function kpiExportSlimKpi_(k){return {score:k?.score??null,status:k?.status||'',count:k?.count||0,groups:(k?.groups||[]).map(g=>({name:g.name,score:g.score??null,pending:!!g.pending,na:!!g.na,indicators:(g.indicators||[]).map(i=>({indicator:i.indicator||'',label:i.label||'',metric:i.metric,brand:i.brand,weight:i.weight,cap:i.cap,target:i.target,actual:i.actual,ach:i.ach??null,score:i.score??null,state:i.state||'',types:i.types||[],minDA:i.minDA||2}))}))};}
function kpiExportGroupDefs_(k){return (k?.groups||[]).map(g=>({name:g.name,indicators:(g.indicators||[]).map(i=>({indicator:i.indicator||'',label:i.label||i.metric+' '+i.brand,metric:i.metric,brand:i.brand,weight:i.weight,types:i.types||[],minDA:i.minDA||2}))}));}
function kpiExportRegionSheet_(source,u,period,big){
 const people=source.meta.people,base=new Set(kpiExportBaseIds_(source,u)),allSales=people.filter(p=>p.sales&&p.wilayah===big&&base.has(p.nik));
 if(!allSales.length)return null;const ids=allSales.map(p=>p.nik),db=coverageView_(source,period,ids,'ST',u.role==='ADMIN'?u:null),cutoff=db.coverage?.[period]?.cutoff||null;
 const asmAllowed=u.role!=='ASM',allAsm=asmAllowed?people.filter(p=>p.role==='ASM'&&p.wilayah===big&&base.has(p.nik)):[];
 const salesRows=allSales.map(p=>{const asm=kpiExportAncestor_(people,p,'ASM');return {nik:p.nik,nama:p.nama,atasan:asm?.nama||kpiExportBossName_(people,p),subRegion:kpiExportSub_(p),acting:p.role!=='SALES',kpi:kpiExportSlimKpi_(PortalCore.kpi(db,period,[p.nik],big))};}).sort((a,b)=>a.subRegion.localeCompare(b.subRegion,'id',{numeric:true,sensitivity:'base'})||a.atasan.localeCompare(b.atasan,'id',{numeric:true,sensitivity:'base'})||a.nama.localeCompare(b.nama,'id',{numeric:true,sensitivity:'base'}));
 const asmRows=allAsm.map(p=>{const team=PortalCore.scope(people,p.nik).filter(id=>ids.includes(id));return {nik:p.nik,nama:p.nama,atasan:kpiExportBossName_(people,p),subRegion:kpiExportSub_(p),kpi:kpiExportSlimKpi_(PortalCore.kpi(db,period,team,big))};}).sort((a,b)=>a.subRegion.localeCompare(b.subRegion,'id',{numeric:true,sensitivity:'base'})||a.nama.localeCompare(b.nama,'id',{numeric:true,sensitivity:'base'}));
 const total=kpiExportSlimKpi_(PortalCore.kpi(db,period,ids,big)),defs=kpiExportGroupDefs_(PortalCore.kpi(db,period,ids,big));
 const scopeLabel=u.role==='ASM'?(u.nama+' · '+(kpiExportSub_(u)||big)):big;
 return {region:big,scopeLabel,cutoff,groups:defs,salesRows,salesTotal:total,asmRows,asmTotal:asmRows.length?total:null};
}
function kpiExportNationalRows_(source,period,level,rankGroup,groupNames){
 const people=source.meta.people,allIds=people.map(p=>p.nik),db=coverageView_(source,period,allIds,'ST'),participants=people.filter(p=>p.role===level&&p.nik!=='-'),rows=participants.map(p=>{
  const team=level==='ASM'?PortalCore.scope(people,p.nik):[p.nik],k=PortalCore.kpi(db,period,team,p.wilayah),scores={},states={};(k.groups||[]).forEach(g=>{scores[g.name]=g.score??null;states[g.name]={na:!!g.na,pending:!!g.pending};});
  const groupState=states[rankGroup],hasSelected=rankGroup==='FINAL'||!!groupState&&!groupState.na,selected=rankGroup==='FINAL'?k.score:(hasSelected?scores[rankGroup]:null),fallback=hasSelected?selected:k.score;
  return {nik:p.nik,nama:p.nama,region:p.wilayah||'',subRegion:kpiExportSub_(p),atasan:kpiExportBossName_(people,p),scores,final:k.score??null,status:k.status||'',hasSelected,sortScore:fallback??null};
 });
 rows.sort((a,b)=>{const bucketA=rankGroup==='FINAL'||a.hasSelected&&a.scores[rankGroup]!=null?0:1,bucketB=rankGroup==='FINAL'||b.hasSelected&&b.scores[rankGroup]!=null?0:1;if(bucketA!==bucketB)return bucketA-bucketB;const sa=a.sortScore,sb=b.sortScore;if(sa==null&&sb!=null)return 1;if(sa!=null&&sb==null)return -1;if(sa!=null&&sb!=null&&sb!==sa)return sb-sa;if((b.final??-1)!==(a.final??-1))return (b.final??-1)-(a.final??-1);return a.nama.localeCompare(b.nama,'id',{numeric:true,sensitivity:'base'});});
 const rankable=rows.filter(r=>r.sortScore!=null),hi=rankable.length<6?1:3,top=new Set(rankable.slice(0,hi).map(r=>r.nik)),bottom=new Set(rankable.slice(-hi).map(r=>r.nik));
 let rank=0;rows.forEach(r=>{if(r.sortScore!=null)rank++;r.rank=r.sortScore==null?null:rank;r.highlight=top.has(r.nik)?'TOP':bottom.has(r.nik)?'BOTTOM':'';r.groupScores=groupNames.map(name=>Object.prototype.hasOwnProperty.call(r.scores,name)?r.scores[name]:null);delete r.scores;delete r.sortScore;delete r.hasSelected;});
 return {rows,cutoff:db.coverage?.[period]?.cutoff||null};
}
function apiKPIExportData(token,period,selection){
 const source=snapshot_(),u=kpiExportGuard_(token,source);period=PortalCore.month(period);selection=selection&&typeof selection==='object'?selection:{};const groups=kpiExportGroups_(source,period),rankGroup=PortalCore.text(selection.rankGroup)||'FINAL';if(rankGroup!=='FINAL'&&!groups.includes(rankGroup))throw Error('Kelompok KPI untuk ranking tidak tersedia pada periode ini.');
 const detailRegions=kpiExportDetailRegions_(source,u),sheets=detailRegions.map(r=>kpiExportRegionSheet_(source,u,period,r)).filter(Boolean),ranking=kpiExportRankAllowed_(u),rankingOnly=kpiExportIsTopTier_(u);
 if(!rankingOnly&&!sheets.length)throw Error('Tidak ada data KPI dalam hak akses untuk periode ini.');
 const result={name:'KPI-Report-'+period+'.xlsx',period,rankGroup,groupNames:groups,ranking,rankingOnly,sheets};if(ranking){result.rankingSales=kpiExportNationalRows_(source,period,'SALES',rankGroup,groups);result.rankingAsm=kpiExportNationalRows_(source,period,'ASM',rankGroup,groups);}audit_(u.nik,'KPI_XLSX_EXPORT',period+' '+rankGroup+' '+(rankingOnly?'RANKING_ONLY':detailRegions.join('|')));return result;
}
