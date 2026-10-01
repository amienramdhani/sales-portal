/* Pure business rules. Also executed by the local test suite. No Google services. */
var PortalCore = (function () {
  'use strict';
  const LEVEL = {SALES:1,ASM:2,RGM:3,ADMIN:3.5,'HEAD OF SALES':4,'CHIEF OPERATING OFFICER':5,'CHIEF COMMERCIAL OFFICER':5,'BOARD OF DIRECTOR':6,'SUPER ADMIN':7};
  const text = v => String(v == null ? '' : v).trim();
  const key = parts => JSON.stringify(parts);
  const uniq = a => Array.from(new Set(a));
  const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
  const active = v => v === true || ['TRUE','YA','1'].includes(text(v).toUpperCase());
  function number(v) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    let s = text(v).replace(/\s/g,'');
    if (!s) throw Error('Nilai angka kosong.');
    if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g,'').replace(',','.') : s.replace(/,/g,'');
    else if (s.includes(',')) s = s.replace(',','.');
    if (!/^-?\d+(\.\d+)?$/.test(s)) throw Error('Angka tidak valid: '+s);
    return Number(s);
  }
  function iso(v) {
    const s = text(v).slice(0,10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s) throw Error('Tanggal harus YYYY-MM-DD: '+s);
    return s;
  }
  function month(v) { if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text(v))) throw Error('Periode harus YYYY-MM.'); return text(v); }
  function prev(p) { const d=new Date(p+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()-1);return d.toISOString().slice(0,7); }
  function end(p) { return new Date(Date.UTC(+p.slice(0,4),+p.slice(5),0)).toISOString().slice(0,10); }
  function scope(people, nik) {
    const root=people.find(p=>p.nik===nik); if (!root) throw Error('Pengguna tidak ada dalam master.');
    if(root.role==='ADMIN')return people.filter(p=>p.nik===nik||['SALES','ASM','RGM'].includes(p.role)&&(root.adminRegions||[]).includes(p.wilayah)).map(p=>p.nik);
    if (LEVEL[root.role]>=4) return people.map(p=>p.nik);
    const result=new Set([nik]); let changed=true;
    while(changed){changed=false;people.forEach(p=>{if(p.atasan&&result.has(p.atasan)&&!result.has(p.nik)){result.add(p.nik);changed=true;}});}
    return Array.from(result);
  }
  function people(rows, regionRows, roleSchema) {
    const map={},rm={};regionRows.forEach(r=>rm[text(r.REGION)]=text(r.WILAYAH_KPI));
    rows.forEach(r=>{
      const nik=text(r['NIK KARYAWAN']),role=position(r.POSISI,roleSchema);
      if (!nik || !LEVEL[role]) throw Error('NIK atau posisi tidak valid.');
      const p={nik,nama:text(r.SALES),role,region:text(r.REGION),atasan:text(r['NIK ATASAN']),sales:role==='SALES',portfolio:role==='SALES'?text(r.REGION):''};
      if (!map[nik]) map[nik]=p;
      else {const old=map[nik]; if(old.nama!==p.nama)throw Error('NIK memiliki nama berbeda: '+nik); if(p.role===old.role)throw Error('NIK dan role berulang: '+nik);map[nik]=LEVEL[role]>LEVEL[old.role]?Object.assign(p,{sales:p.sales||old.sales,portfolio:p.portfolio||old.portfolio}):Object.assign(old,{sales:p.sales||old.sales,portfolio:old.portfolio||p.portfolio});}
    });
    Object.values(map).forEach(p=>{
      if(p.atasan===p.nik)throw Error('Atasan utama menunjuk diri sendiri: '+p.nik);
      if(p.atasan&&!map[p.atasan])throw Error('Atasan tidak ditemukan: '+p.atasan);
      const seen=new Set([p.nik]);let n=p.atasan;while(n){if(seen.has(n))throw Error('Siklus hierarki: '+p.nik);seen.add(n);n=map[n]?.atasan;}
      p.wilayah=rm[p.region]||rm[p.portfolio]||'';
      if(!p.wilayah&&LEVEL[p.role]<4&&p.role!=='ADMIN')throw Error('Region belum dipetakan di Region_Map: '+p.region);
    });return Object.values(map);
  }
  function normalize(raw, settings) {
    const warnings=[],ps=people(raw.sales,settings.regions,settings.roleSchema||2),pids=new Set(ps.map(p=>p.nik)),products={},customers={};
    const rules={};settings.products.forEach(r=>rules[text(r.BRAND)]={brand:text(r.BRAND_UTAMA)||text(r.BRAND),device:active(r.MASUK_QTY)});
    raw.products.forEach(r=>{const id=text(r['KODE BARANG']),source=text(r.BRAND),rule=rules[source];if(!id||!rule)throw Error('Product_Rules belum lengkap: '+source);const p={id,nama:text(r['NAMA BARANG']),brand:rule.brand,source,type:text(r.TYPE),device:rule.device};if(products[id]){if(products[id].brand!==p.brand||products[id].device!==p.device)throw Error('Kode produk punya klasifikasi berbeda: '+id);warnings.push('Nama produk berulang; memakai baris pertama: '+id);}else products[id]=p;});
    raw.customers.forEach(r=>{const id=text(r['KODE CUSTOMER']),nik=text(r['NIK SALES']);if(!id||!pids.has(nik))throw Error('Kode customer/NIK tidak valid: '+id);const c={id,nama:text(r['NAMA INDUK CUSTOMER'])||text(r['NAMA CUSTOMER']),nik,region:text(r.REGION),kota:text(r.KOTA),pic:text(r['NAMA PIC']),alamat:text(r.ALAMAT),hp:text(r['No. HP']),aliases:[text(r.ID_DEALER)]};if(customers[id]){if(customers[id].nik!==nik)throw Error('Alias outlet berbeda pemegang: '+id);customers[id].aliases=uniq(customers[id].aliases.concat(c.aliases));}else customers[id]=c;});
    const targets=[],tk=new Set;settings.targets.forEach(r=>{const p=month(r.PERIODE),nik=text(r.NIK),b=text(r.BRAND),metric=text(r.METRIK).toUpperCase(),value=number(r.TARGET),indicator=text(r.INDIKATOR_ID),k=key([p,nik,b,metric,indicator]);if(!pids.has(nik)||!ps.find(x=>x.nik===nik).sales)throw Error('Target hanya untuk portofolio Sales: '+nik);if(!b||!['QTY','DA','NOO','OMZET'].includes(metric)||value<0)throw Error('Target tidak valid.');if(tk.has(k))throw Error('Target duplikat: '+k);tk.add(k);targets.push({period:p,nik,brand:b,metric,target:value,indicator});});
    const policies=[],pk=new Set;settings.kpi.forEach(r=>{if(!active(r.AKTIF))return;const p={period:month(r.PERIODE),region:text(r.WILAYAH_KPI),group:text(r.KELOMPOK_KPI),metric:text(r.METRIK).toUpperCase(),brand:text(r.BRAND),weight:number(r.BOBOT),cap:number(r.BATAS_SKOR),indicator:text(r.INDIKATOR_ID),label:text(r.LABEL),types:uniq(text(r.TYPE_FILTER).split("|").map(text).filter(Boolean)),minDA:text(r.MIN_QTY_DA)?number(r.MIN_QTY_DA):2,minNOO:text(r.MIN_QTY_DA)?number(r.MIN_QTY_DA):1};if(!p.region||!p.group||!p.brand||!['QTY','DA','NOO','OMZET'].includes(p.metric)||p.weight<=0||p.cap<=0)throw Error('Konfigurasi KPI tidak valid.');if(!Number.isInteger(p.minDA)||p.minDA<1)throw Error('MIN_QTY_DA harus bilangan bulat minimal 1.');if(p.types.length&&!['QTY','DA'].includes(p.metric))throw Error('TYPE_FILTER hanya untuk QTY atau DA.');if((p.types.length||p.metric==='DA'&&p.minDA!==2||p.metric==='NOO'&&p.minNOO!==1)&&!p.indicator)throw Error('Isi INDIKATOR_ID untuk aturan khusus.');if(p.types.some(t=>!Object.values(products).some(x=>x.device&&x.type===t&&(p.brand==='ALL'||x.brand===p.brand))))throw Error('TYPE_FILTER tidak ditemukan pada brand perangkat.');const k=key([p.period,p.region,p.group,p.metric,p.brand,p.indicator]);if(pk.has(k))throw Error('Indikator KPI duplikat: '+k);pk.add(k);policies.push(p);});
    const grouped={};policies.forEach(p=>{const k=key([p.period,p.region,p.group]);grouped[k]=(grouped[k]||0)+p.weight;});Object.keys(grouped).forEach(k=>{if(Math.abs(grouped[k]-100)>0.0001)throw Error('Bobot indikator per kelompok harus 100: '+k+' = '+grouped[k]);});
    return {roleSchema:2,people:ps,customers,products,targets,policies,warnings:uniq(warnings)};
  }
  function transactions(rows, meta, period, cutoff) {
    const seen=new Set(),pids=new Set(meta.people.map(p=>p.nik));
    const result=rows.map((r,i)=>{
      const t={date:iso(r['TANGGAL TRANSAKSI']),company:text(r['BADAN USAHA']),doc:text(r['NO TRANSAKSI']),sj:text(r['NOMOR SJ']),sku:text(r['KODE PRODUK']),customer:text(r['KODE CUSTOMER']),nik:text(r['NIK SALES']),qty:number(r.QTY),amount:number(r.AMOUNT),line:text(r.ID_BARIS),ref:text(r.REF_TRANSAKSI)};
      if(period&&t.date.slice(0,7)!==period)throw Error('Baris '+(i+2)+' berada di luar bulan '+period);
      if(cutoff&&t.date>cutoff)throw Error('Tanggal transaksi melewati cutoff impor.');
      if(!meta.products[t.sku])throw Error('KODE PRODUK '+t.sku+' tidak ada di Master Product (baris '+(i+2)+')');if(!pids.has(t.nik))throw Error('NIK SALES '+(t.nik||'(kosong)')+' tidak dikenal & dealer '+t.customer+' tidak ditemukan di Master Customer (baris '+(i+2)+')');if(!t.doc||!t.customer)throw Error('Referensi transaksi tidak valid pada baris '+(i+2)+' (NO TRANSAKSI / KODE CUSTOMER kosong)');
      if(!Number.isInteger(t.qty)||t.qty===0||!Number.isFinite(t.amount))throw Error('Qty/amount tidak valid pada baris '+(i+2));
      if((t.qty<0&&t.amount>0)||(t.qty>0&&t.amount<0))throw Error('Tanda qty dan amount tidak konsisten pada baris '+(i+2));
      const k=t.line?key([t.company,t.doc,t.line]):key([t.date,t.company,t.doc,t.sj,t.sku,t.customer,t.nik,t.qty,t.amount]);
      if(seen.has(k))throw Error('Baris transaksi duplikat '+(i+2)+'. Jika baris sah terpisah, sertakan ID_BARIS unik.');seen.add(k);return t;
    });return result;
  }
  function build(meta, tx, coverage) {
    const cubes={},notes=meta.warnings.slice(),orders={},unlinked={},first={},life={},missing={},peopleIds=new Set(meta.people.map(p=>p.nik));
    tx.forEach(t=>{
      const p=meta.products[t.sku];if(!p)throw Error('Produk tidak ditemukan dalam histori: '+t.sku);if(!peopleIds.has(t.nik))throw Error('NIK historis hilang dari master: '+t.nik+'. Nonaktifkan akun, jangan hapus master.');
      const period=t.date.slice(0,7),k=key([t.date,t.nik,t.customer,p.brand,p.type,t.region||'']);cubes[period]=cubes[period]||{};
      if(!cubes[period][k])cubes[period][k]={date:t.date,region:t.region||'',nik:t.nik,customer:t.customer,brand:p.brand,type:p.type,q:0,a:0,acc:0,docs:{}};
      const c=cubes[period][k];c.q+=p.device?t.qty:0;c.a+=t.amount;c.acc+=p.device?0:t.amount;c.docs[key([t.company,t.doc])]=1;
      if(!meta.customers[t.customer]){missing[t.customer]=true;}
      if(!p.device)return;
      const pair=key([t.customer,p.brand]),ok=key([t.company,t.doc,t.customer,p.brand]);
      if(t.qty>0){orders[ok]=orders[ok]||{pair,date:t.date,nik:t.nik,q:0,doc:t.doc,company:t.company};orders[ok].q+=t.qty;if(t.nik<orders[ok].nik)orders[ok].nik=t.nik;}
      else if(!t.ref){unlinked[pair]=true;}
      life[t.customer]=life[t.customer]||{};life[t.customer][period]=life[t.customer][period]||{q:0,last:''};life[t.customer][period].q+=t.qty;if(t.qty>0&&t.date>life[t.customer][period].last)life[t.customer][period].last=t.date;
    });
    tx.forEach(t=>{if(t.qty>=0||!t.ref||!meta.products[t.sku].device)return;const pair=key([t.customer,meta.products[t.sku].brand]),o=orders[key([t.company,t.ref,t.customer,meta.products[t.sku].brand])];if(o)o.q+=t.qty;else unlinked[pair]=true;});
    Object.values(orders).filter(o=>o.q>0).sort((a,b)=>a.date.localeCompare(b.date)||a.doc.localeCompare(b.doc)||a.nik.localeCompare(b.nik)).forEach(o=>{if(!first[o.pair])first[o.pair]={date:o.date,nik:o.nik};});
    if(Object.keys(missing).length)notes.push('Customer belum ada di master: '+Object.keys(missing).join(', ')+'. Transaksi tetap masuk total; lengkapi master.');
    if(Object.keys(unlinked).length)notes.push(Object.keys(unlinked).length+' pasangan customer–brand memiliki retur tanpa referensi yang dapat diverifikasi. NOO terkait belum final.');
    Object.keys(cubes).forEach(p=>{cubes[p]=Object.values(cubes[p]).map(r=>{r.docs=Object.keys(r.docs);r.a=round(r.a);r.acc=round(r.acc);return r;});});
    return {meta,cubes,coverage,first,unlinked,life,notes};
  }
  function slice(db,period,ids,cut) {const set=new Set(ids);return (db.cubes[period]||[]).filter(r=>set.has(r.nik)&&(!cut||r.date<=cut));}
  // Pembanding (bulan lalu / histori): transaksi dihitung ke pemegang dealer SEKARANG di Master_Customer.
  function sliceCmp(db,period,ids,cut,sel) {if(sel&&sel!==Object.keys(db.coverage||{}).sort().pop())return slice(db,period,ids,cut);const set=new Set(ids),cu=(db.meta&&db.meta.customers)||{};return (db.cubes[period]||[]).filter(r=>!cut||r.date<=cut).map(r=>{const n=cu[r.customer]&&cu[r.customer].nik;return n&&n!==r.nik?Object.assign({},r,{nik:n}):r;}).filter(r=>set.has(r.nik));}
  function metrics(rows,db,period,brand,minDA=2,minNOO=1) {
    let q=0,a=0,acc=0;const pairs={},docs=new Set(),customers=new Set();
    const byPair={};rows.filter(r=>!brand||brand==='ALL'||r.brand===brand).forEach(r=>{q+=r.q;a+=r.a;acc+=r.acc;r.docs.forEach(d=>docs.add(d));const k=key([r.customer,r.brand]);pairs[k]=(pairs[k]||0)+r.q;(byPair[k]||(byPair[k]=[])).push(r);});
    let da=0,noo=0,pending=false;Object.keys(pairs).forEach(k=>{if(pairs[k]>=minDA)da++;if(pairs[k]>0){customers.add(JSON.parse(k)[0]);const f=db.first[k];if(db.unlinked[k])pending=true;if(pairs[k]>=minNOO&&f&&f.date.slice(0,7)===period&&(byPair[k]||[]).some(r=>r.nik===f.nik&&r.date===f.date)){noo++;}}});
    return {qty:q,omzet:round(a),aksesori:round(acc),da,noo,outlets:customers.size,nota:docs.size,nooPending:pending};
  }
  function target(meta,period,ids,brand,metric,indicator="") {
    const eligible=ids.filter(id=>meta.people.find(p=>p.nik===id)?.sales);
    const found=meta.targets.filter(t=>t.period===period&&eligible.includes(t.nik)&&t.brand===brand&&t.metric===metric&&(t.indicator||"")===indicator);
    return {value:found.reduce((s,t)=>s+t.target,0),missing:eligible.filter(id=>!found.some(t=>t.nik===id)),exists:found.length>0};
  }
  // KPI RGM per orang: tiap indikator menghitung Big Region pilihannya sendiri, target diisi langsung di KPI_RGM.
  function kpiRgm(db,period,ids,region,cfg) {
    const all=slice(db,period,ids),groups=[];
    uniq(cfg.map(c=>c.group)).forEach(group=>{let weighted=0,weights=0,pending=false;
      const indicators=cfg.filter(c=>c.group===group).map(c=>{const bigs=c.bigs.map(b=>b.toUpperCase()),rows=all.filter(r=>(!bigs.length||bigs.includes(text(r.region).toUpperCase()))&&(!c.types.length||c.types.includes(r.type))),a=metrics(rows,db,period,c.brand,c.minDA||2,c.minNOO||1),actual={QTY:a.qty,DA:a.da,NOO:a.noo,OMZET:a.omzet}[c.metric];let state='BERLAKU',score=null,ach=null;
        if(c.target==null){state='TARGET BELUM LENGKAP';pending=true;}
        else if(c.target===0)state='TIDAK DIWAJIBKAN';
        else if(c.metric==='NOO'&&a.nooPending){state='VERIFIKASI RETUR';pending=true;}
        else {ach=actual/c.target*100;score=Math.min(c.cap,Math.max(0,ach));weighted+=score*c.weight;weights+=c.weight;}
        return {indicator:c.indicator,label:c.label||(c.metric+' '+c.brand+(c.bigs.length?' · '+c.bigs.join(' + '):'')),types:c.types,bigs:c.bigs,minDA:c.minDA||2,metric:c.metric,brand:c.brand,weight:c.weight,cap:c.cap,target:c.target??0,actual,ach,score,state};});
      groups.push({name:group,score:pending||!weights?null:weighted/weights,pending,na:!pending&&!weights,indicators});
    });
    const scored=groups.filter(g=>!g.na),pending=scored.some(g=>g.pending);return {region,rgm:true,groups,score:pending||!scored.length?null:scored.reduce((s,g)=>s+g.score,0)/scored.length,status:pending?'BELUM FINAL':!scored.length?'TIDAK DIWAJIBKAN':'FINAL',count:scored.length};
  }
  function kpi(db,period,ids,region,owner) {
    if(owner&&owner.role==='RGM'){const rc=(db.meta.rgmPolicies||[]).filter(c=>c.period===period&&c.nik===owner.nik);if(rc.length)return kpiRgm(db,period,ids,region,rc);}
    let reg=region,sub='';{const subs=uniq(ids.map(id=>db.meta.people.find(p=>p.nik===id)).filter(p=>p&&p.sales).map(p=>text(p.portfolio||p.region).toUpperCase()));if(subs.length===1){const own=db.meta.policies.filter(c=>c.period===period&&text(c.region).toUpperCase()===subs[0]);if(own.length){reg=own[0].region;sub=reg;}}}
    const cfg=db.meta.policies.filter(c=>c.period===period&&c.region===reg),rows=slice(db,period,ids),groups=[];
    let tentative=false;uniq(cfg.map(c=>c.group)).forEach(group=>{let weighted=0,weights=0,pending=false;
      const indicators=cfg.filter(c=>c.group===group).map(c=>{const t=target(db.meta,period,ids,c.brand,c.metric,c.indicator||""),a=metrics(c.types?.length?rows.filter(r=>c.types.includes(r.type)):rows,db,period,c.brand,c.minDA||2,c.minNOO||1),actual={QTY:a.qty,DA:a.da,NOO:a.noo,OMZET:a.omzet}[c.metric];let state='BERLAKU',score=null,ach=null;
        // Tetap dihitung walau belum lengkap (angka sementara); penandanya di state & status.
        if(t.value===0&&!t.missing.length)state='TIDAK DIWAJIBKAN';
        else if(t.value>0){ach=actual/t.value*100;score=Math.min(c.cap,Math.max(0,ach));weighted+=score*c.weight;weights+=c.weight;
          if(t.missing.length){state='SEMENTARA · '+t.missing.length+' sales belum ada target';tentative=true;}
          else if(c.metric==='NOO'&&a.nooPending){state='SEMENTARA · verifikasi retur';tentative=true;}}
        else {state='TARGET BELUM LENGKAP';pending=true;}
        return {indicator:c.indicator,label:c.label,types:c.types||[],minDA:c.minDA||2,metric:c.metric,brand:c.brand,weight:c.weight,cap:c.cap,target:t.value,actual,ach,score,state};});
      groups.push({name:group,score:!weights?null:weighted/weights,pending:pending&&!weights,partial:pending&&!!weights,na:!pending&&!weights,indicators});
    });
    const scored=groups.filter(g=>!g.na&&g.score!=null),pending=!groups.length||groups.some(g=>g.pending||g.partial)||tentative;return {region,sub,groups,tentative,score:!scored.length?null:scored.reduce((s,g)=>s+g.score,0)/scored.length,status:!groups.length?'KEBIJAKAN BELUM DIISI':!scored.length?(groups.some(g=>g.pending)?'BELUM FINAL':'TIDAK DIWAJIBKAN'):pending?'SEMENTARA':'FINAL',count:scored.length};
  }
  function report(db,period,ids,region) {
    month(period);const coverage=db.coverage[period];if(!coverage)throw Error('Periode belum tersedia.');
    const rows=slice(db,period,ids),pp=prev(period),cut=coverage.closed?end(pp):pp+'-'+String(Math.min(+coverage.cutoff.slice(8),+end(pp).slice(8))).padStart(2,'0'),previous=sliceCmp(db,pp,ids,cut,period),total=metrics(rows,db,period),brands=uniq(rows.map(r=>r.brand).concat(db.meta.targets.filter(t=>t.period===period&&ids.includes(t.nik)&&!t.indicator&&t.brand!=='ALL').map(t=>t.brand))).sort();
    const brandRows=brands.map(b=>({brand:b,current:metrics(rows,db,period,b),previous:metrics(previous,db,pp,b),target:target(db.meta,period,ids,b,'QTY'),targetDA:target(db.meta,period,ids,b,'DA'),targetNOO:target(db.meta,period,ids,b,'NOO')}));
    const byDate={};rows.forEach(r=>{(byDate[r.date]||(byDate[r.date]=[])).push(r);});const daily=Object.keys(byDate).sort().map(date=>{const dr=byDate[date];return {date,...metrics(dr,db,period),brands:brands.map(b=>metrics(dr,db,period,b).qty)};});
    const weekly=[1,2,3,4,5].filter(w=>(w-1)*7<+end(period).slice(8)).map(w=>{const rr=rows.filter(r=>Math.min(5,Math.ceil(+r.date.slice(8)/7))===w);return {week:w,...metrics(rr,db,period),brands:brands.map(b=>metrics(rr,db,period,b).qty)};});
    const allHistory=Object.keys(db.cubes).filter(p=>p<=period).flatMap(p=>slice(db,p,ids));
    const codes=uniq(Object.values(db.meta.customers).filter(c=>ids.includes(c.nik)).map(c=>c.id).concat(allHistory.map(r=>r.customer)));
    const grp=list=>{const m={};list.forEach(r=>{(m[r.customer]||(m[r.customer]=[])).push(r);});return m;},gCur=grp(rows),gOld=grp(previous),gHist=grp(allHistory);
    const customers=codes.map(id=>{
      const c=db.meta.customers[id],current=gCur[id]||[],old=gOld[id]||[],hist=gHist[id]||[],net={};hist.forEach(r=>{const k=key([r.date.slice(0,7),r.brand]);net[k]=(net[k]||0)+r.q;});
      const history=hist.filter(r=>r.q>0&&net[key([r.date.slice(0,7),r.brand])]>0);
      const periods=uniq(history.map(r=>r.date.slice(0,7))),last=history.map(r=>r.date).sort().pop()||null;
      const currentQty=current.reduce((n,r)=>n+r.q,0);const status=currentQty>=2?'AKTIF':currentQty>0?'BELUM MINIMUM DA':periods.includes(pp)?'DA BULAN LALU':!periods.length?'BELUM ORDER':periods.includes(prev(pp))?'IDLE':'PASIF';
      return {id,nama:c?.nama||'Master belum tersedia',nik:c?.nik||current[0]?.nik,region:c?.region||'',kota:c?.kota||'',alamat:c?.alamat||'',hp:c?.hp||'',status,last,jeda:last?Math.floor((new Date(coverage.cutoff)-new Date(last))/86400000):null,current:metrics(current,db,period),previous:metrics(old,db,pp),brands:brands.map(b=>({brand:b,...metrics(current,db,period,b)}))};
    });
    const types={};rows.forEach(r=>{if(!r.q)return;const k=key([r.brand,r.type]);types[k]=types[k]||{brand:r.brand,type:r.type,qty:0};types[k].qty+=r.q;});
    return {period,coverage,previousPeriod:pp,previousCutoff:cut,previousAvailable:comparisonPeriod(db,period).available,total,previous:metrics(previous,db,pp),brands:brandRows,daily,weekly,customers,types:Object.values(types),kpi:region?kpi(db,period,ids,region):null,trend:Object.keys(db.coverage).filter(p=>p<=period).sort().slice(-12).map(p=>{const info=db.coverage[p],comparison=comparisonPeriod(db,p),now=metrics(p===period?slice(db,p,ids):sliceCmp(db,p,ids,null,period),db,p),before=metrics(sliceCmp(db,comparison.period,ids,comparison.cutoff,period),db,comparison.period);return {period:p,qty:now.qty,omzet:now.omzet,previousQty:comparison.available?before.qty:null,growth:comparison.available&&before.qty!==0?(now.qty-before.qty)/before.qty*100:null,previousPeriod:comparison.period,previousCutoff:comparison.cutoff,closed:info.closed,cutoff:info.cutoff};})};
  }

  function position(value,schema){
    let role=text(value).toUpperCase();
    if(Number(schema)===1)role=({SPV:'ASM',SUPERVISOR:'ASM',ASM:'RGM'})[role]||role;
    role=({'COO':'CHIEF OPERATING OFFICER','CCO':'CHIEF COMMERCIAL OFFICER','CHIEF COMERCIAL OFFICER':'CHIEF COMMERCIAL OFFICER','BOD':'BOARD OF DIRECTOR','BOARD OF DIRECTORS':'BOARD OF DIRECTOR'})[role]||role;
    return role;
  }
  function adaptMeta(meta){
    if(Number(meta.roleSchema)===2)return meta;
    meta.people.forEach(p=>p.role=position(p.role,1));meta.roleSchema=2;return meta;
  }
  function comparisonPeriod(db,p){
    const info=db.coverage[p],prior=prev(p),cutoff=info.closed?end(prior):prior+'-'+String(Math.min(+info.cutoff.slice(8),+end(prior).slice(8))).padStart(2,'0');
    return {period:prior,cutoff,available:!!db.coverage[prior]&&db.coverage[prior].cutoff>=cutoff};
  }
  function groupedTransactions(rows,meta){
    const groups=new Map();
    rows.forEach(t=>{const p=meta.products[t.sku],type=p.type||p.nama||t.sku;
      // Blank SJ must not merge unrelated orders; the source document is the fallback identity.
      const sj=t.sj||'',id=key([t.date,t.company,sj||'DOC:'+t.doc,t.customer,t.nik,p.brand,type]);
      if(!groups.has(id))groups.set(id,{date:t.date,company:t.company,sj,customer:t.customer,nik:t.nik,nama:meta.customers[t.customer]?.nama||t.customer,brand:p.brand,type,qty:0,amount:0,sourceRows:0,deviceQty:0});
      const g=groups.get(id);g.qty+=t.qty;g.amount+=t.amount;g.deviceQty+=p.device?t.qty:0;g.sourceRows++;
    });
    return Array.from(groups.values()).map(g=>Object.assign(g,{amount:round(g.amount)})).sort((a,b)=>b.date.localeCompare(a.date)||a.company.localeCompare(b.company)||a.sj.localeCompare(b.sj)||a.customer.localeCompare(b.customer)||a.nik.localeCompare(b.nik)||a.brand.localeCompare(b.brand)||a.type.localeCompare(b.type));
  }
  return {position,adaptMeta,comparisonPeriod,groupedTransactions,LEVEL,text,number,active,iso,month,prev,end,key,round,scope,normalize,transactions,build,slice,sliceCmp,metrics,target,kpi,report};
})();
