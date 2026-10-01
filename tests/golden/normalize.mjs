import fs from 'node:fs';

const EXCLUDED_KEYS = new Set(['processed','processedAt','processTimestamp','snapshotId','token','duration','durationMs','requestId']);
const DEFAULT_UNORDERED_ARRAY_PATHS = [
  '$.customers', '$.dealerOptions', '$.gradeOptions', '$.mapsByBrand', '$.brandsMap'
];

function isNumeric(v){ return typeof v === 'number' && Number.isFinite(v); }
function canonicalNumber(v){ return Object.is(v,-0) ? 0 : v; }
function pathUnordered(path, extra){ return [...DEFAULT_UNORDERED_ARRAY_PATHS,...extra].some(p=>path===p || (p.endsWith('.*') && path.startsWith(p.slice(0,-2)))); }
function stableKey(v){
  if (v && typeof v==='object' && !Array.isArray(v)) {
    for (const k of ['id','nik','customer','kode_customer','brand','name','nama','period','date','tanggal','type']) {
      if (v[k] !== undefined && v[k] !== null) return `${k}:${String(v[k])}`;
    }
  }
  return JSON.stringify(v);
}

export function normalize(value, path='$', options={}){
  const unordered=options.unorderedArrayPaths||[];
  if (value===null || value===undefined) return null;
  if (isNumeric(value)) return canonicalNumber(value);
  if (typeof value==='string') {
    // Keep strings as strings; never hide API contract differences such as "5" vs 5.
    const m=value.match(/^(\d{4}-\d{2}-\d{2})(?:T.*)?$/);
    if (m) return m[1];
    return value;
  }
  if (Array.isArray(value)) {
    const out=value.map((x,i)=>normalize(x,`${path}[${i}]`,options));
    if (pathUnordered(path,unordered)) out.sort((a,b)=>stableKey(a).localeCompare(stableKey(b),'en'));
    return out;
  }
  if (typeof value==='object') {
    const out={};
    for (const k of Object.keys(value).sort()) {
      if (EXCLUDED_KEYS.has(k)) continue;
      const n=normalize(value[k],`${path}.${k}`,options);
      // Legacy rule: null and missing are equivalent; omit nulls from canonical form.
      if (n!==null) out[k]=n;
    }
    return out;
  }
  return value;
}

export function diff(a,b,path='$',out=[]){
  if (typeof a==='number' && typeof b==='number') {
    if (a!==b) out.push({path,left:a,right:b});
    return out;
  }
  if (Object.is(a,b)) return out;
  if (Array.isArray(a) && Array.isArray(b)) {
    const n=Math.max(a.length,b.length);
    for(let i=0;i<n;i++) diff(a[i],b[i],`${path}[${i}]`,out);
    return out;
  }
  if (a && b && typeof a==='object' && typeof b==='object' && !Array.isArray(a) && !Array.isArray(b)) {
    const keys=[...new Set([...Object.keys(a),...Object.keys(b)])].sort();
    for(const k of keys) diff(a[k],b[k],`${path}.${k}`,out);
    return out;
  }
  out.push({path,left:a,right:b});
  return out;
}

if (process.argv[1]?.endsWith('normalize.mjs') && process.argv.length>=4) {
  const [leftFile,rightFile]=process.argv.slice(2);
  const left=normalize(JSON.parse(fs.readFileSync(leftFile,'utf8')));
  const right=normalize(JSON.parse(fs.readFileSync(rightFile,'utf8')));
  const d=diff(left,right);
  console.log(JSON.stringify({equal:d.length===0,diff:d},null,2));
  process.exitCode=d.length?1:0;
}
