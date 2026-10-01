// Run after TestMigratedDatabaseContracts writes REPORTING_UI_FIXTURE.
// Executes the shipped rendering functions with real Go responses, without a browser login.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const fixture = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (process.argv[3]) fixture.api = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const html = fs.readFileSync(new URL('../frontend/public/legacy/index.html', import.meta.url), 'utf8');
const context = vm.createContext({console, Intl, Date, Map, Set, fixture});
for (const match of html.matchAll(/^(?:async )?function (\w+)\(/gm)) {
  const lines = html.slice(match.index).split('\n');
  let source = '';
  for (const line of lines) {
    source += line + '\n';
    let script;
    try { script = new vm.Script(source); } catch { continue; }
    script.runInContext(context);
    break;
  }
}
vm.runInContext(`
const elements=new Map();
const element=()=>({innerHTML:'',value:'ALL',isConnected:true,dataset:{},style:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},querySelectorAll(){return []},querySelector(){return element()},setAttribute(){},addEventListener(){}});
const $=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id)};
const document={querySelectorAll:()=>[],getElementById:$};
const esc=x=>String(x??''),num=x=>String(x??'—'),decimal=num,pct=num,rupiah=num,tgl=num,bulan=num;
const BOOT={user:{role:'SUPER ADMIN',nik:'test'},people:[]},REPORT=fixture.dashboard;
const V6TIPS=new Map();let v6TipSeq=0,v6NooSets={},v6ReFilter='ALL',v6HOL={},v6AnaTab='cross';
let v6ANA=fixture.analysis;
v6Pass=()=>true;v6Org=()=>({SALES:'Sales',REGION:'Region',BIG:'Big'});
const mobileViewport={matches:false};
`, context);
for (const expression of [
  'v6CrossHtml(fixture.analysis.crossSell)',
  'v6ReactHtml(fixture.analysis.reactivation)',
  'v6NooHtml(fixture.analysis.noo)',
  'fixture.dashboard.regionalKpi.map(k=>kpiHtml(k)).join("")',
  'v6XKpi(fixture.executive.kpiMe)',
  'fixture.dashboard.daily.map(d=>d.brands.map(num).join(",")).join("")',
  'targetActual(fixture.dashboard.brandTotals.target,fixture.dashboard.total.qty)',
  'fixture.teams.SALES.filter(p=>p.nama!=="Total").map(p=>targetActual(p.target,p.total.qty)).join("")',
  'Object.values(fixture.executive.nodes).map(n=>fixture.executive.brands.map(b=>v6XM(n,b,"st").a)).join("")',
]) {
  const result = vm.runInContext(expression, context);
  assert.equal(typeof result, 'string');
  assert.ok(!result.includes('NaN'), `NaN in ${expression}`);
  console.log('PASS', expression.split('(')[0]);
}
if (fixture.api) {
  for (const expression of [
    'fixture.api.apiInfo.regions.map(esc).join("")',
    'fixture.api.apiInfo.rows.map(r=>r.title+r.body).join("")',
    'fixture.api.apiTransactionGroups.rows.map(g=>transactionTable(g.rows,false,{qty:g.qty,amount:g.amount})).join("")',
    'fixture.api.apiKpiTree.map(p=>kpiHtml(p.kpi)).join("")',
  ]) {
    const result = vm.runInContext(expression, context);
    assert.equal(typeof result, 'string');
    assert.ok(!result.includes('NaN'), `NaN in ${expression}`);
    console.log('PASS', expression.split('(')[0]);
  }
}
