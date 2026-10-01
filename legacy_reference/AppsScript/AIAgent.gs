/*
 * Sales Portal AI Agent v2
 * Read-only dan tetap mengikuti scope user.
 *
 * Script Properties yang digunakan:
 *
 * Wajib untuk OpenAI-compatible:
 *   OPENAI_API_KEY                  API key tanpa tulisan "Bearer"
 *   OPENAI_MODEL                    ID model yang tersedia di endpoint
 *
 * Alternatif nama property:
 *   OPENAI_COMPATIBLE_API_KEY
 *   OPENAI_COMPATIBLE_MODEL
 *
 * Opsional:
 *   OPENAI_BASE_URL                 contoh: https://router.rizqis.com/v1
 *   OPENAI_COMPATIBLE_BASE_URL      alias dari OPENAI_BASE_URL
 *   OPENAI_FALLBACK_MODELS          pisahkan dengan koma
 *   OPENAI_COMPATIBLE_FALLBACK_MODELS
 *   OPENAI_MAX_TOKENS               default 2200
 *   OPENAI_TOKEN_PARAMETER          max_tokens atau max_completion_tokens
 *   OPENAI_SEND_TEMPERATURE         true jika endpoint memang mendukungnya
 *   OPENAI_TEMPERATURE               default 0.2 jika OPENAI_SEND_TEMPERATURE=true
 *
 * Jika OPENAI_MODEL kosong, script mencoba mengambil model pertama dari
 * endpoint /v1/models. Tetap disarankan mengisi OPENAI_MODEL dengan ID model
 * yang memang ingin digunakan.
 */

const AI_MODEL_DEFAULT_='cx/gpt-5.6-luna-review';
const AI_OPENAI_FALLBACK_DEFAULT_=['cx/gpt-5.6-terra-review'];
const AI_GEMINI_DEFAULT_='gemini-3.5-flash-lite';
const AI_INTENTS_=[
  'PERFORMANCE_SUMMARY','DAILY_PERFORMANCE','TARGET_GAP',
  'SALES_NOT_SELL','SALES_NO_TRANSACTION',
  'DEALER_NOT_ORDER','DEALER_ACTIVE',
  'KPI_RISK','DOS_RISK','STOCK_ZERO',
  'BRAND_PERFORMANCE','SALES_RANKING','ASM_RANKING','REGION_RANKING',
  'WEEKLY_TREND','DATA_COVERAGE',
  // v6.20: analisa baru
  'PROJECTION','EARLY_WARNING','KPI_DETAIL','DEALER_ORDER_COUNT','DEALER_PRIORITY',
  'CROSS_SELL','REACTIVATION','NOO_RETENTION','DAY_PATTERN','DEALER_CLOSED','RESTOCK'
];

// Cache hanya berlaku selama satu eksekusi Apps Script.
var AI_OPENAI_DISCOVERED_MODELS_CACHE_=null;

function aiLogSheet_(){
  ensureTable_('AI_Audit_Log',['TIMESTAMP','NIK','ROLE','QUESTION','INTENT','SCOPE','ROWS_RETURNED','MODEL','STATUS','DURATION_MS'],[]);
  return book_().getSheetByName('AI_Audit_Log');
}

function aiAudit_(u,q,intent,scope,count,model,status,ms){
  try{
    aiLogSheet_().appendRow([
      new Date().toISOString(),u.nik,u.role,String(q||'').slice(0,500),
      intent||'',scope||'',Number(count)||0,model||'',status||'',Number(ms)||0
    ]);
  }catch(e){
    console.warn('AI audit failed: '+e.message);
  }
}

function aiPropText_(names){
  for(const name of names){
    const value=PortalCore.text(props_().getProperty(name));
    if(value)return value;
  }
  return '';
}

function aiOpenAIBaseUrl_(){
  let base=aiPropText_(['OPENAI_COMPATIBLE_BASE_URL','OPENAI_BASE_URL']);
  if(!base)base='https://router.rizqis.com/v1';

  // Pengguna boleh mengisi base URL saja atau tidak sengaja mengisi endpoint.
  // Keduanya dinormalisasi agar tidak terjadi /chat/completions berulang.
  return String(base)
    .trim()
    .replace(/\/+$/,'')
    .replace(/\/(?:chat\/completions|models)$/i,'');
}

function aiModel_(){
  return aiPropText_(['OPENAI_COMPATIBLE_MODEL','OPENAI_MODEL'])||AI_MODEL_DEFAULT_;
}

function aiOpenAIKey_(){
  return aiPropText_(['OPENAI_COMPATIBLE_API_KEY','OPENAI_API_KEY','OPENAI_KEY']);
}

function aiOpenAIFallbackModels_(){
  const raw=aiPropText_(['OPENAI_COMPATIBLE_FALLBACK_MODELS','OPENAI_FALLBACK_MODELS']);
  const configured=raw?raw.split(',').map(x=>PortalCore.text(x)).filter(Boolean):[];
  return [...new Set([...configured,...AI_OPENAI_FALLBACK_DEFAULT_].filter(Boolean))];
}

function aiBodyMessage_(body){
  let msg=body;
  try{
    const parsed=JSON.parse(body);
    msg=parsed?.error?.message||parsed?.message||parsed?.error||body;
    if(typeof msg!=='string')msg=JSON.stringify(msg);
  }catch(e){}
  return String(msg||body||'').slice(0,700);
}

function aiOpenAIError_(code,body,model){
  const err=Error('OpenAI Compatible API '+code+' ['+model+']: '+aiBodyMessage_(body));
  err.httpCode=code;
  err.model=model;
  err.responseBody=String(body||'').slice(0,2000);
  return err;
}

function aiOpenAIListModels_(key){
  const res=UrlFetchApp.fetch(aiOpenAIBaseUrl_()+'/models',{
    method:'get',
    headers:{Authorization:'Bearer '+key,Accept:'application/json'},
    muteHttpExceptions:true
  });

  const code=res.getResponseCode();
  const body=res.getContentText();

  // Tidak semua provider OpenAI-compatible menyediakan endpoint /models.
  // Dalam kondisi itu, model yang diisi manual tetap boleh digunakan.
  if(code===404||code===405)return [];
  if(code<200||code>=300)throw aiOpenAIError_(code,body,'/models');

  let obj;
  try{
    obj=JSON.parse(body);
  }catch(e){
    throw Error('Endpoint OpenAI-compatible /models mengembalikan JSON tidak valid.');
  }

  const raw=Array.isArray(obj?.data)?obj.data:
    Array.isArray(obj?.models)?obj.models:
    Array.isArray(obj)?obj:[];

  return [...new Set(raw.map(x=>{
    if(typeof x==='string')return x.trim();
    return PortalCore.text(x?.id||x?.name||x?.model);
  }).filter(Boolean))];
}

function aiOpenAIModels_(key){
  const primary=aiModel_();
  const configuredFallback=aiOpenAIFallbackModels_();

  if(primary&&/^openai[_-]?compatible$/i.test(primary)){
    throw Error('OPENAI_MODEL tidak boleh diisi "openai_compatible". Isi dengan ID model dari endpoint /v1/models.');
  }

  const explicit=[primary,...configuredFallback].filter(Boolean);
  if(explicit.length)return [...new Set(explicit)];

  if(!AI_OPENAI_DISCOVERED_MODELS_CACHE_){
    const discovered=aiOpenAIListModels_(key);
    AI_OPENAI_DISCOVERED_MODELS_CACHE_=discovered.length?[discovered[0]]:[];
  }

  if(AI_OPENAI_DISCOVERED_MODELS_CACHE_.length)return AI_OPENAI_DISCOVERED_MODELS_CACHE_;
  throw Error('OPENAI_MODEL belum diisi dan endpoint /v1/models tidak mengembalikan model.');
}

function aiTextFromParts_(parts){
  if(!Array.isArray(parts))return '';
  return parts.map(x=>{
    if(typeof x==='string')return x;
    if(!x)return '';
    if(typeof x.text==='string')return x.text;
    if(x.text&&typeof x.text.value==='string')return x.text.value;
    if(Array.isArray(x.content))return aiTextFromParts_(x.content);
    if(typeof x.value==='string')return x.value;
    return '';
  }).filter(Boolean).join('\n').trim();
}

function aiOpenAIText_(obj){
  const choice=obj&&Array.isArray(obj.choices)?obj.choices[0]:null;
  const msg=choice&&choice.message?choice.message:null;

  if(msg){
    const messageText=typeof msg.content==='string'
      ?msg.content.trim()
      :aiTextFromParts_(msg.content);
    if(messageText)return messageText;

    // Beberapa gateway memisahkan reasoning dan jawaban.
    if(typeof msg.reasoning_content==='string'&&msg.reasoning_content.trim()){
      return msg.reasoning_content.trim();
    }
  }

  if(choice&&typeof choice.text==='string'&&choice.text.trim())return choice.text.trim();
  if(obj&&typeof obj.output_text==='string'&&obj.output_text.trim())return obj.output_text.trim();
  if(obj&&Array.isArray(obj.output)){
    const outputText=aiTextFromParts_(obj.output);
    if(outputText)return outputText;
  }
  return '';
}

function aiClone_(obj){
  return JSON.parse(JSON.stringify(obj));
}

function aiOpenAIPayloads_(model,system,user,responseJson){
  const maxRaw=aiPropText_(['OPENAI_MAX_TOKENS']);
  const maxTokens=Math.max(256,Number(maxRaw)||2200);
  const tokenParameter=aiPropText_(['OPENAI_TOKEN_PARAMETER'])||'max_tokens';
  const base={
    model:model,
    messages:[
      {role:'system',content:system},
      {role:'user',content:user}
    ],
    stream:false
  };

  base[tokenParameter]=maxTokens;

  const sendTemperature=aiPropText_(['OPENAI_SEND_TEMPERATURE']).toLowerCase()==='true';
  if(sendTemperature){
    const temperature=Number(aiPropText_(['OPENAI_TEMPERATURE']));
    base.temperature=Number.isFinite(temperature)?temperature:0.2;
  }

  const payloads=[];
  const jsonPayload=aiClone_(base);
  if(responseJson)jsonPayload.response_format={type:'json_object'};
  payloads.push(jsonPayload);

  // Sebagian gateway belum mendukung response_format, tetapi tetap bisa
  // menghasilkan JSON karena prompt-nya meminta JSON.
  if(responseJson)payloads.push(aiClone_(base));

  // Kompatibilitas dengan model/gateway yang memakai nama parameter baru.
  if(tokenParameter==='max_tokens'){
    const alternate=aiClone_(base);
    delete alternate.max_tokens;
    alternate.max_completion_tokens=maxTokens;
    if(responseJson){
      const alternateJson=aiClone_(alternate);
      alternateJson.response_format={type:'json_object'};
      payloads.push(alternateJson);
    }
    payloads.push(alternate);
  }

  return payloads;
}

function aiOpenAIOnce_(model,key,system,user,responseJson){
  const payloads=aiOpenAIPayloads_(model,system,user,responseJson);
  let lastErr=null;

  for(let i=0;i<payloads.length;i++){
    const res=UrlFetchApp.fetch(aiOpenAIBaseUrl_()+'/chat/completions',{
      method:'post',
      contentType:'application/json',
      headers:{Authorization:'Bearer '+key,Accept:'application/json'},
      payload:JSON.stringify(payloads[i]),
      muteHttpExceptions:true
    });

    const code=res.getResponseCode();
    const body=res.getContentText();

    if(code>=200&&code<300){
      let obj;
      try{
        obj=JSON.parse(body);
      }catch(e){
        throw Error('OpenAI Compatible API mengembalikan JSON tidak valid ['+model+'].');
      }

      const text=aiOpenAIText_(obj);
      if(!text)throw Error('OpenAI Compatible API tidak mengembalikan jawaban ['+model+'].');
      return {model:model,text:text,provider:'openai-compatible'};
    }

    lastErr=aiOpenAIError_(code,body,model);

    // Coba payload kompatibilitas berikutnya untuk error request 400.
    // Untuk 401/403/429/error server, biarkan aiOpenAI_ menangani retry.
    if(code===400&&i<payloads.length-1)continue;
    throw lastErr;
  }

  throw lastErr||Error('OpenAI Compatible API tidak tersedia.');
}

function aiOpenAI_(system,user,responseJson){
  const key=aiOpenAIKey_();
  if(!key)throw Error('OPENAI_API_KEY belum diisi di Script Properties.');

  const models=aiOpenAIModels_(key);
  let lastErr=null;

  for(let m=0;m<models.length;m++){
    const model=models[m];

    for(let attempt=1;attempt<=2;attempt++){
      try{
        return aiOpenAIOnce_(model,key,system,user,responseJson);
      }catch(e){
        lastErr=e;
        const code=Number(e&&e.httpCode)||0;

        // Kredensial salah tidak akan membaik dengan model lain.
        if([401,403].includes(code))throw e;

        const transient=[408,409,429,500,502,503,504].includes(code);
        if(transient&&attempt<2){
          Utilities.sleep(900*attempt);
          continue;
        }

        // 400/404/422 dapat berarti model atau parameter tidak cocok.
        // Lanjutkan ke model OpenAI-compatible berikutnya.
        break;
      }
    }
  }

  throw lastErr||Error('OpenAI Compatible API tidak tersedia.');
}

function aiGeminiModel_(){
  return PortalCore.text(props_().getProperty('GEMINI_MODEL'))||AI_GEMINI_DEFAULT_;
}

function aiFallbackModels_(){
  const raw=PortalCore.text(props_().getProperty('GEMINI_FALLBACK_MODELS'));
  const configured=raw?raw.split(',').map(x=>PortalCore.text(x)).filter(Boolean):[];
  const models=[aiGeminiModel_(),...configured,'gemini-3.6-flash','gemini-3.5-flash'];
  return [...new Set(models.filter(Boolean))];
}

function aiGeminiOnce_(model,key,system,user,responseJson){
  const url='https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent?key='+encodeURIComponent(key);
  const payload={systemInstruction:{parts:[{text:system}]},contents:[{role:'user',parts:[{text:user}]}]};
  if(responseJson)payload.generationConfig={responseMimeType:'application/json'};

  const res=UrlFetchApp.fetch(url,{
    method:'post',
    contentType:'application/json',
    payload:JSON.stringify(payload),
    muteHttpExceptions:true
  });

  const code=res.getResponseCode(),body=res.getContentText();
  if(code<200||code>=300){
    let msg=body;
    try{msg=JSON.parse(body)?.error?.message||body;}catch(e){}
    const err=Error('Gemini API '+code+': '+String(msg).slice(0,500));
    err.httpCode=code;
    throw err;
  }

  let obj;
  try{
    obj=JSON.parse(body);
  }catch(e){
    throw Error('Gemini API mengembalikan JSON tidak valid.');
  }

  const text=obj?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('\n').trim();
  if(!text)throw Error('Gemini tidak mengembalikan jawaban.');
  return {model,text,provider:'gemini'};
}

function aiGemini_(system,user,responseJson){
  const key=PortalCore.text(props_().getProperty('GEMINI_API_KEY'));
  if(!key)throw Error('GEMINI_API_KEY belum diisi di Script Properties.');

  const models=aiFallbackModels_();
  let lastErr=null;

  for(let m=0;m<models.length;m++){
    const model=models[m];

    for(let attempt=1;attempt<=2;attempt++){
      try{
        return aiGeminiOnce_(model,key,system,user,responseJson);
      }catch(e){
        lastErr=e;
        const code=Number(e&&e.httpCode)||0;
        const transient=[429,500,502,503,504].includes(code);
        if(!transient)throw e;
        if(attempt<2)Utilities.sleep(900*attempt);
      }
    }
  }

  throw Error('Semua model Gemini sedang sibuk/tidak tersedia. Coba beberapa saat lagi. Detail terakhir: '+String(lastErr&&lastErr.message||lastErr).slice(0,300));
}

function aiSafeError_(e){
  let s=String(e&&e.message||e||'Unknown error');
  // Hindari menampilkan credential/query key bila provider memasukkannya ke error.
  s=s.replace(/sk-[A-Za-z0-9_-]+/g,'sk-***')
    .replace(/key=[^\s&]+/gi,'key=***')
    .replace(/Bearer\s+[^\s]+/gi,'Bearer ***');
  return s.slice(0,300);
}

function aiLLM_(system,user,responseJson){
  let openaiErr=null;

  if(aiOpenAIKey_()){
    try{
      const result=aiOpenAI_(system,user,responseJson);

      // Validasi di sini supaya respons OpenAI yang bukan JSON benar-benar
      // masuk ke fallback Gemini, bukan gagal di aiRoute_ sesudahnya.
      if(responseJson)aiJson_(result.text);
      return result;
    }catch(e){
      openaiErr=e;
      console.warn('OpenAI fallback to Gemini: '+aiSafeError_(e));
    }
  }else{
    openaiErr=Error('OPENAI_API_KEY tidak ditemukan di Script Properties.');
  }

  try{
    const g=aiGemini_(system,user,responseJson);
    g.fallbackReason=aiSafeError_(openaiErr);
    return g;
  }catch(g){
    if(openaiErr){
      throw Error('OpenAI gagal ('+aiSafeError_(openaiErr)+'); Gemini fallback juga gagal ('+aiSafeError_(g)+').');
    }
    throw g;
  }
}

function aiJson_(text){
  let clean=String(text||'')
    .replace(/^```(?:json)?\s*/i,'')
    .replace(/\s*```$/,'')
    .trim();

  try{return JSON.parse(clean);}catch(e){}

  // Toleransi terhadap model yang menambahkan satu kalimat sebelum/sesudah JSON.
  const start=clean.indexOf('{');
  const end=clean.lastIndexOf('}');
  if(start>=0&&end>start){
    try{return JSON.parse(clean.slice(start,end+1));}catch(e){}
  }

  throw Error('Router AI mengembalikan format JSON yang tidak valid.');
}

function aiBrands_(db){
  return [...new Set(Object.values(db.meta.products||{}).filter(p=>p.device).map(p=>p.brand).filter(Boolean))].sort();
}

function aiScopeLabel_(source,u,selection,ids){
  const p=selection&&selection!=='ALL'?source.meta.people.find(x=>x.nik===selection):null;
  if(p)return p.role+' · '+p.nama;
  return (u.wilayah||u.region||'Nasional')+' · '+ids.filter(id=>source.meta.people.find(x=>x.nik===id)?.sales).length+' Sales';
}

function aiNormalizeBrand_(brand,brands){
  const q=PortalCore.text(brand).toLowerCase();
  if(!q)return '';
  return brands.find(b=>b.toLowerCase()===q)||brands.find(b=>b.toLowerCase().includes(q)||q.includes(b.toLowerCase()))||'';
}

function aiMonthNumber_(name){
  const names={januari:1,februari:2,maret:3,april:4,mei:5,juni:6,juli:7,agustus:8,september:9,oktober:10,november:11,desember:12};
  return names[String(name||'').toLowerCase()]||null;
}

function aiPeriodParts_(period){
  const s=String(period||'').toLowerCase();
  let m=s.match(/(20\d{2})[-\/]([01]?\d)/);
  if(m)return {year:Number(m[1]),month:Number(m[2])};
  m=s.match(/(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s+(20\d{2})/i);
  if(m)return {year:Number(m[2]),month:aiMonthNumber_(m[1])};
  return null;
}

function aiFormatDate_(date){
  if(!(date instanceof Date)||isNaN(date.getTime()))return '';
  return Utilities.formatDate(date,Session.getScriptTimeZone()||'Asia/Jakarta','yyyy-MM-dd');
}

function aiDateAdd_(date,days){
  const d=new Date(date.getTime());
  d.setDate(d.getDate()+days);
  return d;
}

function aiDateFromDay_(day,period){
  const p=aiPeriodParts_(period);
  if(!p||!day||day<1||day>31)return '';
  const d=new Date(p.year,p.month-1,day);
  if(d.getFullYear()!==p.year||d.getMonth()!==p.month-1||d.getDate()!==day)return '';
  return aiFormatDate_(d);
}

function aiParseDateText_(value,period){
  const s=String(value||'').trim().toLowerCase();
  if(!s)return '';

  const iso=s.match(/(20\d{2})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if(iso)return aiDateFromDay_(Number(iso[3]),String(iso[1])+'-'+String(iso[2]).padStart(2,'0'));

  const slash=s.match(/\b(\d{1,2})[-\/](\d{1,2})(?:[-\/](20\d{2}))?\b/);
  if(slash){
    const year=Number(slash[3]||aiPeriodParts_(period)?.year||new Date().getFullYear());
    const d=new Date(year,Number(slash[2])-1,Number(slash[1]));
    if(d.getFullYear()===year&&d.getMonth()===Number(slash[2])-1&&d.getDate()===Number(slash[1]))return aiFormatDate_(d);
  }

  const monthText=s.match(/\b(\d{1,2})\s+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)(?:\s+(20\d{2}))?\b/i);
  if(monthText){
    const year=Number(monthText[3]||aiPeriodParts_(period)?.year||new Date().getFullYear());
    const month=aiMonthNumber_(monthText[2]);
    const d=new Date(year,month-1,Number(monthText[1]));
    if(d.getFullYear()===year&&d.getMonth()===month-1&&d.getDate()===Number(monthText[1]))return aiFormatDate_(d);
  }

  const day=s.match(/\b(?:tanggal|tgl)\s*(\d{1,2})\b/);
  if(day)return aiDateFromDay_(Number(day[1]),period);

  return '';
}

function aiDateRangeFromQuestion_(question,period){
  const q=String(question||'').toLowerCase();
  const p=aiPeriodParts_(period);

  if(/\bhari ini\b/.test(q)){
    const today=aiFormatDate_(new Date());
    return {dateFrom:today,dateTo:today,mode:'day'};
  }
  if(/\bkemarin\b/.test(q)){
    const yesterday=aiFormatDate_(aiDateAdd_(new Date(),-1));
    return {dateFrom:yesterday,dateTo:yesterday,mode:'day'};
  }

  const range=q.match(/(?:tanggal|tgl)\s*(\d{1,2})\s*(?:sampai|hingga|s\/d|sd|-|sampai dengan)\s*(?:tanggal|tgl)?\s*(\d{1,2})/);
  if(range&&p){
    const from=aiDateFromDay_(Number(range[1]),period);
    const to=aiDateFromDay_(Number(range[2]),period);
    if(from&&to)return {dateFrom:from,dateTo:to,mode:'range'};
  }

  const explicit=String(question||'').match(/\b(?:\d{1,2}[-\/]\d{1,2}(?:[-\/]20\d{2})?|20\d{2}[-\/]\d{1,2}[-\/]\d{1,2}|(?:tanggal|tgl)\s*\d{1,2}|\d{1,2}\s+(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)(?:\s+20\d{2})?)\b/i);
  if(explicit){
    const date=aiParseDateText_(explicit[0],period);
    if(date)return {dateFrom:date,dateTo:date,mode:'day'};
  }

  if(/\b(?:bulan ini|bulan berjalan|bulan tersebut|bulan sekarang)\b/.test(q)&&p){
    const from=aiDateFromDay_(1,period);
    const to=aiFormatDate_(new Date(p.year,p.month,0));
    return {dateFrom:from,dateTo:to,mode:'month'};
  }

  return {dateFrom:'',dateTo:'',mode:''};
}

function aiNormalizeRouteDate_(value,period){
  const parsed=aiParseDateText_(value,period);
  if(parsed)return parsed;
  const s=String(value||'').trim();
  return /^20\d{2}-\d{2}-\d{2}$/.test(s)?s:'';
}

function aiRoute_(question,history,brands,period){
  const hist=(Array.isArray(history)?history:[]).slice(-6).map(x=>(x.role==='assistant'?'AI':'USER')+': '+String(x.text||'').slice(0,500)).join('\n');
  const prompt=`Periode aktif: ${period}\nBrand valid: ${brands.join(', ')}\nRiwayat singkat:\n${hist||'-'}\n\nPertanyaan sekarang: ${question}\n\nPilih tepat satu intent dari: ${AI_INTENTS_.join(', ')}.\n\nAturan intent penting:\n- SALES_NOT_SELL: user menanyakan SALES yang tidak/belum menjual atau bertransaksi pada brand/tanggal tertentu.\n- SALES_NO_TRANSACTION: user menanyakan sales tanpa transaksi selama rentang tanggal/periode.\n- DAILY_PERFORMANCE: user menanyakan penjualan pada hari/tanggal tertentu.\n- DEALER_NOT_ORDER: user menanyakan DEALER/CUSTOMER yang belum order.\n- DEALER_ACTIVE: user menanyakan dealer aktif/prodiktif.\n- REGION_RANKING: user menanyakan perbandingan atau ranking region.\n- ASM_RANKING: user menanyakan ranking/performa ASM.\n- DATA_COVERAGE: user menanyakan cutoff, upload, kelengkapan, atau kesiapan data.\n- PROJECTION: proyeksi/perkiraan akhir bulan, tembus target atau tidak, butuh berapa per hari kerja.\n- EARLY_WARNING: sales/tim yang proyeksinya bahaya/waspada, siapa yang harus jualan lebih cepat.\n- KPI_DETAIL: rincian pencapaian KPI per indikator, bobot, skor, indikator yang menurunkan skor, simulasi skor KPI.\n- DEALER_ORDER_COUNT: berapa/berapa banyak dealer yang sudah order (total, per brand, hari ini, minggu ini), kurang berapa dealer dari target DA.\n- DEALER_PRIORITY: dealer prioritas kunjungan, GAP potensi terbesar, dealer yang turun dibanding rata-rata 3 bulan.\n- CROSS_SELL: dealer yang bisa ditawari brand lain, dealer yang baru ambil 1 brand, peluang cross-sell per brand.\n- REACTIVATION: dealer idle/pasif/DA bulan lalu yang layak diaktifkan lagi.\n- NOO_RETENTION: dealer baru (NOO) yang order lagi atau tidak, NOO terbaik.\n- DAY_PATTERN: hari/minggu/tanggal penjualan paling ramai atau paling sepi.\n- DEALER_CLOSED: dealer tutup, pengajuan dealer tutup, unit yang hilang karena dealer tutup.\n- RESTOCK: TYPE yang harus di-restock, stok menumpuk tapi sell out kecil.\n\nEkstrak brand jika disebut. Ekstrak tanggal sebagai YYYY-MM-DD. Untuk rentang, isi date_from dan date_to. threshold hanya angka jika user menyebut batas KPI/DOS, jika tidak null. query hanya kata kunci dealer/sales bila relevan. level harus salah satu dari SALES, DEALER, BRAND, ASM, REGION, NATIONAL. Jawab JSON saja: {"intent":"...","level":"...","brand":"","date_from":"","date_to":"","threshold":null,"query":"","reason":"singkat"}`;
  const r=aiLLM_('Anda router intent untuk Sales Portal. Jangan menjawab pertanyaan bisnis. Hanya klasifikasikan ke tool yang tersedia. Jangan menciptakan brand di luar daftar. Bedakan SALES dan DEALER dengan ketat.',prompt,true);
  const o=aiJson_(r.text);
  const q=String(question||'').toLowerCase();
  const extracted=aiDateRangeFromQuestion_(question,period);
  const mentionsSales=/\b(?:sales|spg|team|orang)\b/.test(q);
  const negative=/\b(?:tidak|belum|ga|gak|nggak|ngga|enggak|tanpa|no)\b/.test(q);
  const selling=/\b(?:jual|jualan|menjual|penjualan|terjual|transaksi|order)\b/.test(q);
  const mentionsDealer=/\b(?:dealer|customer|outlet)\b/.test(q);

  // Guard deterministik agar pertanyaan yang jelas tidak salah diarahkan ke
  // DEALER_ACTIVE atau DEALER_NOT_ORDER oleh model.
  if(mentionsSales&&negative&&selling&&!['EARLY_WARNING'].includes(o.intent))o.intent=extracted.dateFrom?'SALES_NOT_SELL':'SALES_NO_TRANSACTION';
  else if(mentionsDealer&&negative&&selling&&!['NOO_RETENTION','REACTIVATION','DEALER_CLOSED','CROSS_SELL','DEALER_PRIORITY'].includes(o.intent))o.intent='DEALER_NOT_ORDER';
  else if(extracted.dateFrom&&!negative&&selling&&!mentionsDealer&&(mentionsSales||/\b(?:penjualan|terjual|jual)\b/.test(q)))o.intent='DAILY_PERFORMANCE';
  else if(/\btarget\b/.test(q)&&!['PROJECTION','KPI_DETAIL','EARLY_WARNING','DEALER_ORDER_COUNT'].includes(o.intent))o.intent='TARGET_GAP';
  if(!AI_INTENTS_.includes(o.intent))o.intent='PERFORMANCE_SUMMARY';

  const dateFrom=extracted.dateFrom||aiNormalizeRouteDate_(o.date_from,period);
  const dateTo=extracted.dateTo||aiNormalizeRouteDate_(o.date_to,period)||dateFrom;
  return {
    model:r.model,
    fallbackReason:r.fallbackReason||'',
    intent:o.intent,
    level:PortalCore.text(o.level)||'',
    brand:PortalCore.text(o.brand),
    dateFrom,
    dateTo,
    dateMode:extracted.mode||'day',
    threshold:Number.isFinite(Number(o.threshold))?Number(o.threshold):null,
    query:PortalCore.text(o.query),
    question:PortalCore.text(question),
    reason:PortalCore.text(o.reason)
  };
}

function aiPct_(a,b){return b&&b.value>0&&b.exists&&!b.missing?.length?a/b.value*100:null;}

function aiValue_(obj,names){
  if(!obj)return '';
  for(const name of names){
    if(obj[name]!==undefined&&obj[name]!==null&&String(obj[name]).trim()!=='')return obj[name];
  }
  return '';
}

function aiRawRows_(source,period){
  // Snapshot selalu membawa cube transaksi yang juga dipakai dashboard.
  // Gunakan ini lebih dulu agar AI tidak bergantung pada pointer file raw di Drive.
  const cubeRows=source&&source.cubes&&Array.isArray(source.cubes[period])
    ?source.cubes[period]
    :[];
  if(cubeRows.length)return cubeRows;

  const decode=value=>{
    if(typeof value!=='string')return value;
    const text=value.trim();
    if(!text)return null;
    try{return JSON.parse(text);}catch(e){
      try{return typeof readJson_==='function'?readJson_(text):null;}catch(e2){return null;}
    }
  };
  const raw=decode(source&&source.raw);
  if(Array.isArray(raw))return raw;
  if(!raw)return [];

  const keys=[period,String(period||''),String(period||'').replace(/\//g,'-')];
  for(const key of keys){
    const value=decode(raw[key]);
    if(Array.isArray(value))return value;
    if(Array.isArray(value?.rows))return value.rows;
    if(Array.isArray(value?.data))return value.data;
  }

  const all=[];
  Object.values(raw).forEach(item=>{
    const value=decode(item);
    if(Array.isArray(value))all.push(...value);
    else if(Array.isArray(value?.rows))all.push(...value.rows);
    else if(Array.isArray(value?.data))all.push(...value.data);
  });
  return all;
}

function aiProduct_(source,code){
  if(!code)return null;
  const products=source?.meta?.products||{};
  if(Array.isArray(products))return products.find(p=>String(aiValue_(p,['id','code','kode','sku','kodeProduk']))===String(code))||null;
  return products[code]||products[String(code)]||Object.values(products).find(p=>String(aiValue_(p,['id','code','kode','sku','kodeProduk']))===String(code))||null;
}

function aiTxDate_(tx){
  return aiValue_(tx,['date','tanggal','DATE','TANGGAL','orderDate','transactionDate','tgl']);
}

function aiTxNik_(tx){
  return String(aiValue_(tx,['nik','NIK','salesNik','sales_nik','nikSales','NIK_SALES','kodeSales','salesCode'])||'').trim();
}

function aiTxQty_(tx){
  const n=Number(aiValue_(tx,['qty','QTY','q','quantity','QTY_ORDER','unit','units'])||0);
  return Number.isFinite(n)?n:0;
}

function aiTxAmount_(tx){
  const n=Number(aiValue_(tx,['amount','AMOUNT','a','omzet','OMZET','value','nilai'])||0);
  return Number.isFinite(n)?n:0;
}

function aiTxCustomerId_(tx){
  return String(aiValue_(tx,['customer','customerId','customer_id','kodeCustomer','KODE_CUSTOMER','dealer','dealerId','idDealer','ID_DEALER'])||'').trim();
}

function aiTxProductCode_(tx){
  return aiValue_(tx,['productCode','product_code','kodeProduk','KODE_PRODUK','sku','SKU','kodeBarang','KODE_BARANG','product']);
}

function aiTxBrand_(tx,source){
  const direct=aiValue_(tx,['brand','BRAND','merek','MERK']);
  if(direct)return String(direct).trim();
  const product=aiProduct_(source,aiTxProductCode_(tx));
  return String(aiValue_(product,['brand','BRAND','merek','MERK'])||'').trim();
}

function aiTxType_(tx,source){
  const direct=aiValue_(tx,['type','TYPE','tipe','TYPE_PRODUK']);
  if(direct)return String(direct).trim();
  const product=aiProduct_(source,aiTxProductCode_(tx));
  return String(aiValue_(product,['type','TYPE','tipe','TYPE_PRODUK'])||'').trim();
}

function aiDateKey_(value){
  if(value instanceof Date)return aiFormatDate_(value);
  if(typeof value==='number'&&value>20000&&value<80000){
    return aiFormatDate_(new Date(Math.round((value-25569)*86400000)));
  }

  const s=String(value||'').trim();
  if(!s)return '';
  const iso=s.match(/^(20\d{2})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if(iso)return String(iso[1])+'-'+String(iso[2]).padStart(2,'0')+'-'+String(iso[3]).padStart(2,'0');
  const dmy=s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](20\d{2})/);
  if(dmy)return String(dmy[3])+'-'+String(dmy[2]).padStart(2,'0')+'-'+String(dmy[1]).padStart(2,'0');
  const date=new Date(s);
  return isNaN(date.getTime())?'':aiFormatDate_(date);
}

function aiTxPersonMap_(source,ids){
  const people=Array.isArray(source?.meta?.people)?source.meta.people:Object.values(source?.meta?.people||{});
  const allowedSet=new Set((ids||[]).map(String));
  return people.filter(p=>{
    const nik=String(aiValue_(p,['nik','NIK','salesNik','kodeSales'])||'');
    const role=String(aiValue_(p,['role','ROLE','posisi','POSITION'])||'').toUpperCase();
    const isSales=Boolean(p.sales)||/SALES|SALESMAN|SPG/.test(role);
    return allowedSet.has(nik)&&isSales;
  });
}

function aiPersonNik_(person){return String(aiValue_(person,['nik','NIK','salesNik','kodeSales'])||'');}
function aiPersonName_(person){return String(aiValue_(person,['nama','NAMA','name','NAME','salesName'])||aiPersonNik_(person));}
function aiPersonRegion_(person){return String(aiValue_(person,['wilayah','WILAYAH','region','REGION','subregion','area'])||'');}
function aiPersonAsm_(person){return String(aiValue_(person,['asm','ASM','namaASM','supervisor','SUPERVISOR'])||'');}

function aiFindMentionedSales_(source,ids,route){
  const normalize=value=>' '+String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()+' ';
  const hay=normalize((route.question||'')+' '+(route.query||''));
  const allowedSet=new Set((ids||[]).map(String));
  const people=(Array.isArray(source?.meta?.people)?source.meta.people:Object.values(source?.meta?.people||{}))
    .filter(p=>allowedSet.has(String(p.nik))&&p.sales)
    .sort((a,b)=>String(b.nama||'').length-String(a.nama||'').length);
  return people.find(p=>{
    const name=normalize(p.nama).trim();
    const nik=normalize(p.nik).trim();
    return name&&hay.includes(' '+name+' ')||nik&&hay.includes(' '+nik+' ');
  })||null;
}

function aiRoleKey_(role){return String(role||'').toUpperCase().replace(/[^A-Z0-9]+/g,'_');}

function aiIsTopTier_(u){
  const role=aiRoleKey_(u?.role);
  return /HEAD_OF_SALES|COO|CCO|BOD|DIREKSI|TOP_TIER/.test(role);
}

function aiTxMatches_(tx,source,brand,dateFrom,dateTo,ids){
  const date=aiDateKey_(aiTxDate_(tx));
  if(!date||((dateFrom&&date<dateFrom)||(dateTo&&date>dateTo)))return false;
  if(brand&&aiTxBrand_(tx,source).toLowerCase()!==brand.toLowerCase())return false;
  if(ids){
    const nik=aiTxNik_(tx);
    if(ids instanceof Set){
      if(!ids.has(nik))return false;
    }else if(ids.length&&!ids.includes(nik)){
      return false;
    }
  }
  return aiTxQty_(tx)>0;
}

function aiSalesNotSell_(source,u,ids,period,route,brand,report){
  const people=aiTxPersonMap_(source,ids);
  const raw=aiRawRows_(source,period);
  const dateFrom=route.dateFrom||'';
  const cutoff=String(report.coverage?.cutoff||'').slice(0,10);
  let dateTo=route.dateTo||dateFrom||'';
  if(route.dateMode==='month'&&cutoff&&dateTo>cutoff)dateTo=cutoff;
  const idSet=new Set((ids||[]).map(String));
  const sold=new Set();

  raw.forEach(tx=>{
    if(aiTxMatches_(tx,source,brand,dateFrom,dateTo,idSet))sold.add(aiTxNik_(tx));
  });

  const hasRaw=raw.length>0;
  const futureDate=dateTo&&cutoff&&dateTo>String(cutoff).slice(0,10);
  const evidence={
    ready:hasRaw&&!futureDate,
    dateFrom,dateTo,brand:brand||'SEMUA BRAND',
    cutoff,transactionRows:raw.length,
    totalSales:people.length,
    totalSold:sold.size,
    totalNotSold:0,
    rows:[]
  };

  if(!evidence.ready){
    evidence.message=futureDate
      ?'Tanggal yang diminta melewati cutoff data.'
      :'Data transaksi mentah untuk periode ini belum tersedia.';
    return evidence;
  }

  const notSold=people.filter(p=>!sold.has(aiPersonNik_(p)));
  evidence.totalNotSold=notSold.length;

  // Top Tier tidak menerima rincian individu Sales. Berikan agregasi per region/ASM.
  if(aiIsTopTier_(u)){
    const groups={};
    people.forEach(p=>{
      const group=aiPersonAsm_(p)||aiPersonRegion_(p)||'Tidak diketahui';
      if(!groups[group])groups[group]={group,totalSales:0,totalSold:0,totalNotSold:0};
      groups[group].totalSales++;
      if(sold.has(aiPersonNik_(p)))groups[group].totalSold++;
      else groups[group].totalNotSold++;
    });
    evidence.groupBy='ASM/REGION';
    evidence.rows=Object.values(groups);
    evidence.detailRestricted=true;
  }else{
    evidence.rows=notSold.slice(0,100).map(p=>({
      nik:aiPersonNik_(p),nama:aiPersonName_(p),region:aiPersonRegion_(p),asm:aiPersonAsm_(p),status:'TIDAK ADA TRANSAKSI'
    }));
  }

  return evidence;
}

function aiDealerNotOrderByDate_(source,u,report,period,route,brand){
  const raw=aiRawRows_(source,period);
  const customers=Array.isArray(report.customers)?report.customers:[];
  const dateFrom=route.dateFrom||'';
  const cutoff=String(report.coverage?.cutoff||'').slice(0,10);
  let dateTo=route.dateTo||dateFrom||'';
  if(route.dateMode==='month'&&cutoff&&dateTo>cutoff)dateTo=cutoff;
  const ordered=new Set();

  raw.forEach(tx=>{
    if(!aiTxMatches_(tx,source,brand,dateFrom,dateTo,null))return;
    const id=aiTxCustomerId_(tx);
    if(id)ordered.add(id);
  });

  const futureDate=dateTo&&cutoff&&dateTo>String(cutoff).slice(0,10);
  const evidence={
    ready:raw.length>0&&!futureDate,
    dateFrom,dateTo,brand:brand||'SEMUA BRAND',cutoff,
    transactionRows:raw.length,totalDealers:customers.length,
    totalOrdered:0,totalNotOrder:0,rows:[]
  };

  if(!evidence.ready){
    evidence.message=futureDate
      ?'Tanggal yang diminta melewati cutoff data.'
      :'Data transaksi mentah untuk periode ini belum tersedia.';
    return evidence;
  }

  const notOrder=customers.filter(c=>{
    const id=String(c.id||c.kode||c.customer||'');
    return id&&!ordered.has(id);
  });
  evidence.totalOrdered=customers.length-notOrder.length;
  evidence.totalNotOrder=notOrder.length;

  if(aiIsTopTier_(u)){
    const groups={};
    notOrder.forEach(c=>{
      const group=c.region||c.wilayah||c.asm||c.rgm||'Scope dipilih';
      if(!groups[group])groups[group]={group,totalDealerNotOrder:0};
      groups[group].totalDealerNotOrder++;
    });
    evidence.rows=Object.values(groups);
    evidence.detailRestricted=true;
    evidence.groupBy='REGION/ASM';
  }else{
    evidence.rows=notOrder.slice(0,100).map(c=>({
      kode:c.id||c.kode||c.customer,
      nama:c.nama||c.name,
      kota:c.kota||c.city,
      status:c.status||'',
      brand:brand||'SEMUA BRAND'
    }));
  }
  return evidence;
}

function aiDailyPerformance_(source,u,ids,period,route,brand,report){
  const raw=aiRawRows_(source,period);
  const dateFrom=route.dateFrom||route.dateTo||'';
  const cutoff=String(report.coverage?.cutoff||'').slice(0,10);
  let dateTo=route.dateTo||dateFrom;
  if(route.dateMode==='month'&&cutoff&&dateTo>cutoff)dateTo=cutoff;
  const idSet=new Set((ids||[]).map(String));
  const groups={};
  raw.forEach(tx=>{
    if(!aiTxMatches_(tx,source,brand,dateFrom,dateTo,idSet))return;
    const date=aiDateKey_(aiTxDate_(tx));
    if(!groups[date])groups[date]={date,qty:0,omzet:0,sales:new Set(),dealers:new Set()};
    groups[date].qty+=aiTxQty_(tx);
    groups[date].omzet+=aiTxAmount_(tx);
    groups[date].sales.add(aiTxNik_(tx));
    groups[date].dealers.add(String(aiValue_(tx,['customer','customerId','kodeCustomer','KODE_CUSTOMER','dealer','dealerId','idDealer'])||''));
  });

  return {
    ready:raw.length>0,
    dateFrom,dateTo,brand:brand||'SEMUA BRAND',cutoff,
    rows:Object.values(groups).map(x=>({date:x.date,qty:x.qty,omzet:x.omzet,sales:x.sales.size,dealers:x.dealers.size}))
  };
}

function aiExecute_(token,period,selection,route){
  const source=snapshot_();
  const u=guard_(token,false,false,source);
  const ids=allowed_(source,u,selection);
  const scope=aiScopeLabel_(source,u,selection,ids);
  const report=apiDashboard(token,period,selection);
  const brands=aiBrands_(source);
  const brand=aiNormalizeBrand_(route.brand,brands);
  let out={intent:route.intent,period,scope,cutoff:report.coverage?.cutoff||null,brand:brand||null,rows:[]};

  if(route.intent==='PERFORMANCE_SUMMARY'){
    out.summary={
      qty:report.total.qty,
      omzet:report.total.omzet,
      da:report.total.da,
      noo:report.total.noo,
      so:report.total.sellout||0,
      previousQty:report.previous?.qty??null,
      previousAvailable:!!report.previousAvailable,
      scopeCount:report.scopeCount
    };
    out.rows=report.brands.slice(0,20).map(b=>({
      brand:b.brand,st:b.current.qty,so:b.current.sellout||0,da:b.current.da,
      noo:b.current.noo,target:b.target?.value||0,ach:aiPct_(b.current.qty,b.target)
    }));
  }
  else if(route.intent==='TARGET_GAP'){
    const person=aiFindMentionedSales_(source,ids,route);
    const targetReport=person?apiDashboard(token,period,person.nik):report;
    if(person){
      out.person={nik:person.nik,nama:person.nama,region:person.wilayah||person.region||''};
      out.scope='Sales · '+person.nama;
      out.targetLevel='SALES';
      out.cutoff=targetReport.coverage?.cutoff||out.cutoff;
    }
    out.rows=targetReport.brands.map(b=>({
      brand:b.brand,
      actual:b.current.qty,
      target:b.target?.value||0,
      gap:b.target?.exists&&!b.target?.missing?.length?Math.max(0,(b.target.value||0)-b.current.qty):null,
      ach:aiPct_(b.current.qty,b.target)
    })).sort((a,b)=>(b.gap??-1)-(a.gap??-1));
  }
  else if(route.intent==='SALES_NOT_SELL'||route.intent==='SALES_NO_TRANSACTION'){
    const salesEvidence=aiSalesNotSell_(source,u,ids,period,route,brand,report);
    out=Object.assign(out,salesEvidence);
  }
  else if(route.intent==='DAILY_PERFORMANCE'){
    const daily=aiDailyPerformance_(source,u,ids,period,route,brand,report);
    out=Object.assign(out,daily);
  }
  else if(route.intent==='DEALER_NOT_ORDER'){
    if(route.dateFrom){
      const dateEvidence=aiDealerNotOrderByDate_(source,u,report,period,route,brand);
      out=Object.assign(out,dateEvidence);
    }else{
      let rows=report.customers.filter(c=>{
        const m=brand?c.brands.find(x=>x.brand===brand):c.current;
        return (m?.qty||0)<=0;
      });
      if(route.query)rows=rows.filter(c=>(c.id+' '+c.nama+' '+c.kota).toLowerCase().includes(route.query.toLowerCase()));
      if(aiIsTopTier_(u)){
        const groups={};
        rows.forEach(c=>{
          const group=c.region||c.wilayah||c.asm||c.rgm||'Scope dipilih';
          if(!groups[group])groups[group]={group,totalDealerNotOrder:0};
          groups[group].totalDealerNotOrder++;
        });
        out.rows=Object.values(groups);
        out.detailRestricted=true;
        out.groupBy='REGION/ASM';
      }else{
        out.rows=rows.slice(0,30).map(c=>({
          kode:c.id,nama:c.nama,kota:c.kota,status:c.status,last:c.last,brand,
          qty:brand?(c.brands.find(x=>x.brand===brand)?.qty||0):c.current.qty
        }));
      }
      out.total=rows.length;
    }
  }
  else if(route.intent==='DEALER_ACTIVE'){
    let rows=report.customers.filter(c=>c.status==='AKTIF');
    if(brand)rows=rows.filter(c=>(c.brands.find(x=>x.brand===brand)?.qty||0)>=2);
    if(aiIsTopTier_(u)){
      const groups={};
      rows.forEach(c=>{
        const group=c.region||c.wilayah||c.asm||c.rgm||'Scope dipilih';
        if(!groups[group])groups[group]={group,totalDealerActive:0};
        groups[group].totalDealerActive++;
      });
      out.rows=Object.values(groups);
      out.detailRestricted=true;
      out.groupBy='REGION/ASM';
    }else{
      out.rows=rows.slice(0,30).map(c=>({
        kode:c.id,nama:c.nama,kota:c.kota,status:c.status,
        qty:brand?(c.brands.find(x=>x.brand===brand)?.qty||0):c.current.qty
      }));
    }
    out.total=rows.length;
  }
  else if(route.intent==='KPI_RISK'){
    if(aiIsTopTier_(u)){
      out.ready=false;
      out.detailRestricted=true;
      out.message='Top Tier hanya dapat melihat risiko KPI pada level ASM/region, bukan rincian individu Sales.';
    }else{
      const threshold=route.threshold==null?90:route.threshold;
      const rows=apiRank(token,period,false,'SALES').filter(r=>r.score!=null&&r.score<threshold);
      out.threshold=threshold;
      out.rows=rows.slice(-30).sort((a,b)=>(a.score??999)-(b.score??999)).map(r=>({
        nama:r.nama,region:r.wilayah,subregion:r.region,kpi:r.score,rank:r.rank,status:r.status,groups:r.groupScores
      }));
      out.total=rows.length;
    }
  }
  else if(route.intent==='SALES_RANKING'){
    if(aiIsTopTier_(u)){
      out.ready=false;
      out.detailRestricted=true;
      out.message='Top Tier tidak menampilkan ranking individu Sales. Gunakan ranking ASM atau region.';
    }else{
      out.rows=apiRank(token,period,false,'SALES').filter(r=>r.score!=null).slice(0,20).map(r=>({
        rank:r.rank,nama:r.nama,region:r.wilayah,subregion:r.region,kpi:r.score,groups:r.groupScores
      }));
      out.total=out.rows.length;
    }
  }
  else if(route.intent==='ASM_RANKING'||route.intent==='REGION_RANKING'){
    const rankType=route.intent==='ASM_RANKING'?'ASM':'REGION';
    try{
      const rows=apiRank(token,period,false,rankType).filter(r=>r.score!=null);
      out.rows=rows.slice(0,30).map(r=>({
        rank:r.rank,nama:r.nama||r.asm||r.region||r.wilayah,
        region:r.wilayah||r.region,subregion:r.region,kpi:r.score,
        groups:r.groupScores,status:r.status
      }));
      out.total=rows.length;
    }catch(e){
      out.ready=false;
      out.message='Endpoint ranking '+rankType+' belum tersedia pada backend saat ini.';
      out.rows=[];
    }
  }
  else if(route.intent==='DATA_COVERAGE'){
    out.ready=Boolean(report.coverage);
    out.coverage=report.coverage||null;
    out.scopeCount=report.scopeCount||0;
    out.message=report.coverage?'Informasi cutoff dan cakupan data tersedia.':'Metadata coverage belum tersedia.';
  }
  else if(route.intent==='BRAND_PERFORMANCE'){
    let rows=report.brands;
    if(brand)rows=rows.filter(b=>b.brand===brand);
    out.rows=rows.map(b=>({
      brand:b.brand,st:b.current.qty,so:b.current.sellout||0,omzet:b.current.omzet,
      da:b.current.da,noo:b.current.noo,previousST:b.previous?.qty??null,
      target:b.target?.value||0,ach:aiPct_(b.current.qty,b.target)
    }));
  }
  else if(route.intent==='WEEKLY_TREND'){
    out.rows=(report.weekly||[]).map(w=>({
      week:w.week,st:w.qty,omzet:w.omzet,da:w.da,noo:w.noo,
      brands:(report.brands||[]).map((b,i)=>({brand:b.brand,qty:w.brands?.[i]||0}))
    }));
  }
  else if(route.intent==='DOS_RISK'||route.intent==='STOCK_ZERO'){
    const f={
      view:'TYPE',
      brand:brand||'',
      status:route.intent==='STOCK_ZERO'?'HABIS':'',
      sort:route.intent==='DOS_RISK'?8:4
    };
    const d=apiDOS(token,period,selection,f,0);
    out.ready=d.ready;
    if(!d.ready){
      out.message=d.message;
      out.rows=[];
    }else{
      let rows=d.rows||[];
      if(route.intent==='STOCK_ZERO'){
        rows=rows.filter(r=>Number(r.stock||0)<=0);
      }else{
        const th=route.threshold==null?45:route.threshold;
        out.threshold=th;
        rows=rows.filter(r=>r.dos!=null&&r.dos>th).sort((a,b)=>(b.dos||0)-(a.dos||0));
      }
      out.rows=rows.slice(0,30).map(r=>({
        dealer:r.nama,customer:r.customer,brand:r.brand,type:r.type,stock:r.stock,
        sellout30:r.sellout,dos:r.dos,status:r.status,region:r.region,big:r.big,sales:r.sales
      }));
      out.total=rows.length;
      out.asof=d.asof;
    }
  }

  else aiExecuteV6_(token,period,selection,route,u,ids,report,brand,out);

  return {u,scope,evidence:out,count:Array.isArray(out.rows)?out.rows.length:0};
}

function aiAnswer_(question,history,evidence,model){
  const hist=(Array.isArray(history)?history:[]).slice(-6).map(x=>(x.role==='assistant'?'AI':'USER')+': '+String(x.text||'').slice(0,500)).join('\n');
  const prompt=`Pertanyaan: ${question}\n\nRiwayat singkat:\n${hist||'-'}\n\nData terverifikasi dari Sales Portal (JSON):\n${JSON.stringify(evidence).slice(0,45000)}\n\nAturan jawaban:\n- Jawab dalam Bahasa Indonesia santai-profesional, ringkas tapi berguna.\n- Jangan mengarang angka, nama, tanggal, atau alasan di luar JSON.\n- Jika ready=false, katakan data belum terverifikasi/ belum tersedia dan jangan membuat daftar nama.\n- Untuk SALES_NOT_SELL, jelaskan bahwa rows adalah sales yang tidak memiliki transaksi positif pada tanggal/rentang dan brand yang tercantum.\n- Jika detailRestricted=true, tampilkan hanya agregasi group; jangan membocorkan nama atau NIK Sales.\n- Sebutkan periode, tanggal, brand, cutoff, dan scope bila relevan.\n- Untuk list, tampilkan maksimal 10 item paling relevan lalu sebut total bila tersedia.\n- Bila ada gap/risiko, berikan 1-2 tindak lanjut operasional sebagai saran, bukan tindakan otomatis.\n- Gunakan teks polos. Jangan gunakan Markdown, tanda bintang untuk bold, heading #, atau backtick.`;
  return aiLLM_('Anda AI Sales Assistant read-only. Semua angka harus berasal dari data terverifikasi yang diberikan. Hormati scope user. Jangan pernah mengklaim mengubah data. Jangan tampilkan PIN, token, API key, atau informasi autentikasi.',prompt,false);
}

function aiPlainText_(value){
  return String(value||'')
    .replace(/\*\*([^*]+)\*\*/g,'$1')
    .replace(/__([^_]+)__/g,'$1')
    .replace(/`([^`\n]+)`/g,'$1')
    .replace(/^#{1,6}\s+/gm,'')
    .replace(/^\s*\*\s+/gm,'- ')
    .replace(/\*\*/g,'')
    .trim();
}

function apiAIOptions(token){
  const source=snapshot_();
  const u=guard_(token,false,false,source);
  return {
    model:aiModel_()||'AUTO /v1/models',
    readOnly:true,
    role:u.role,
    name:u.nama,
    groups:aiQuickGroups_(u),
    quick:[
      'Ringkas performa periode ini',
      'Sales yang belum jual MOTOPAD tanggal 10 siapa?',
      'Berapa gap target per brand?',
      'Dealer yang belum order siapa saja?',
      'Sales mana yang KPI-nya berisiko?',
      'DOS tinggi ada di dealer mana?',
      'Dealer stock 0 siapa saja?',
      'Region mana yang pencapaiannya paling rendah?'
    ]
  };
}

function apiAIChat(token,period,selection,message,history){
  const started=Date.now();
  const source=snapshot_();
  const u=guard_(token,false,false,source);
  const ids=allowed_(source,u,selection);
  const scope=aiScopeLabel_(source,u,selection,ids);
  const q=PortalCore.text(message).slice(0,1000);
  if(q.length<2)throw Error('Tulis pertanyaan minimal 2 karakter.');

  let route=null;
  let model=aiModel_()||'AUTO /v1/models';

  try{
    const brands=aiBrands_(source);
    route=aiRoute_(q,history,brands,period);
    model=route.model||model;

    const exec=aiExecute_(token,period,selection,route);
    const ans=aiAnswer_(q,history,exec.evidence,model);

    aiAudit_(u,q,route.intent,scope,exec.count,ans.model,'OK',Date.now()-started);
    return {
      answer:aiPlainText_(ans.text),
      intent:route.intent,
      scope,
      period,
      model:ans.model,
      rows:exec.count,
      readOnly:true,
      fallbackReason:ans.fallbackReason||route.fallbackReason||''
    };
  }catch(e){
    aiAudit_(u,q,route?.intent||'',scope,0,model,'ERROR: '+e.message,Date.now()-started);
    throw e;
  }
}

/* Jalankan manual untuk melihat model yang disediakan endpoint. */
function debugOpenAIModels_(){
  const key=aiOpenAIKey_();
  if(!key)throw Error('OPENAI_API_KEY belum diisi di Script Properties.');
  const res=UrlFetchApp.fetch(aiOpenAIBaseUrl_()+'/models',{
    method:'get',
    headers:{Authorization:'Bearer '+key,Accept:'application/json'},
    muteHttpExceptions:true
  });
  Logger.log('HTTP '+res.getResponseCode());
  Logger.log(res.getContentText());
}


/* ===================== v6.20: jenis pertanyaan baru ===================== */
function aiQuickGroups_(u){
  if(u.role==='SALES')return [
    {cat:'Saya',items:['Berapa lagi yang harus saya jual biar tembus target?','Rincian pencapaian KPI saya','Kalau ST naik 50 unit, skor KPI saya jadi berapa?','Proyeksi akhir bulan saya tembus target nggak?']},
    {cat:'Dealer saya',items:['Dealer saya mana yang harus dikunjungi hari ini?','Udah berapa dealer saya yang order bulan ini?','Dealer saya mana yang belum order bulan ini?','Dealer saya mana yang bisa ditawarin brand lain?','Dealer idle saya yang paling layak diaktifin lagi']},
    {cat:'Stok & pola',items:['Dealer saya mana yang stoknya habis?','Hari apa dealer saya paling banyak order?']}
  ];
  return [
    {cat:'Performa & target',items:['Ringkas performa bulan ini','Proyeksi akhir bulan tembus target nggak?','Berapa lagi yang harus dikejar per hari kerja?','Brand mana yang paling ketinggalan dari target?','Omzet bulan ini dibanding bulan lalu gimana?']},
    {cat:'Tim',items:['Siapa sales ranking 1 dan terbawah bulan ini?','Siapa yang proyeksinya bahaya?','Rincian pencapaian KPI tim saya','Indikator KPI mana yang paling nurunin skor?','Sales mana yang belum transaksi 7 hari terakhir?','Region mana yang paling ketinggalan?']},
    {cat:'Dealer',items:['Udah berapa dealer yang order bulan ini?','Udah berapa dealer yang order per brand?','10 dealer prioritas kunjungan minggu ini','Dealer mana yang bisa ditawarin brand lain?','Dealer idle/pasif mana yang paling layak diaktifin lagi?','Dealer baru bulan lalu yang nggak order lagi bulan ini','Dealer mana aja yang tutup bulan ini?']},
    {cat:'Stok & pola',items:['Dealer mana yang stoknya menipis?','TYPE apa yang harus di-restock duluan?','DOS tinggi ada di dealer mana?','Hari apa penjualan paling ramai?','Kenapa penjualan minggu ini turun?']}
  ];
}
function aiExecuteV6_(token,period,selection,route,u,ids,report,brand,out){
  const r1=v=>v==null?null:Math.round(v*10)/10;
  const cut=report.coverage?.cutoff||'',closed=!!report.coverage?.closed;
  const wk=anaWork_(period,cut,closed);
  out.workDays={total:wk.days,elapsed:wk.run,left:wk.days-wk.run,note:'Hari kerja = Senin–Sabtu di luar sheet Hari_Libur'};
  const intent=route.intent;
  if(intent==='PROJECTION'){
    const rows=report.brands.filter(b=>(b.current.qty||0)||(b.target?.value||0)).map(b=>{const t=b.target?.value||0,a=b.current.qty||0,rr=wk.run?a/wk.run:0,proj=rr*wk.days;return {brand:b.brand,actual:a,target:t,runRatePerWorkDay:r1(rr),projection:Math.round(proj),projectionPct:t?r1(proj/t*100):null,needPerWorkDay:t&&wk.days>wk.run?r1(Math.max(0,t-a)/(wk.days-wk.run)):null};});
    const T=rows.reduce((n,x)=>n+x.target,0),A=report.total.qty,rr=wk.run?A/wk.run:0;
    out.total={actual:A,target:T,runRatePerWorkDay:r1(rr),projection:Math.round(rr*wk.days),projectionPct:T?r1(rr*wk.days/T*100):null,needPerWorkDay:T&&wk.days>wk.run?r1(Math.max(0,T-A)/(wk.days-wk.run)):null};
    out.rows=brand?rows.filter(x=>x.brand===brand):rows;
  }
  else if(intent==='EARLY_WARNING'){
    const ew=apiEarlyWarning(token,period,'SALES',brand||'ALL','QTY',selection,{});
    out.rows=ew.rows.map(x=>{const proj=ew.run?x.actual/ew.run*ew.days:x.actual,pp=x.target?proj/x.target*100:null,rr=ew.run?x.actual/ew.run:0,need=x.target&&ew.days>ew.run?Math.max(0,x.target-x.actual)/(ew.days-ew.run):null;return {nama:x.nama,region:x.region,atasan:x.boss,actual:x.actual,target:x.target,projection:Math.round(proj),projectionPct:r1(pp),status:pp==null?'TANPA TARGET':pp>=100?'AMAN':pp>=80?'WASPADA':'BAHAYA',runRate:r1(rr),needPerWorkDay:r1(need),needVsRunRate:rr&&need!=null?r1(need/rr):null,last7WorkDays:x.daily7};}).sort((a,b)=>(a.projectionPct??999)-(b.projectionPct??999)).slice(0,40);
  }
  else if(intent==='KPI_DETAIL'){
    const person=aiFindMentionedSales_(snapshot_(),ids,route),rep=person?apiDashboard(token,period,person.nik):report,k=rep.kpi;
    if(person)out.scope='Sales · '+person.nama;
    out.kpi=k?{score:r1(k.score),status:k.status,region:k.region,groups:(k.groups||[]).map(g=>({name:g.name,score:r1(g.score),indicators:(g.indicators||[]).map(i=>({label:i.label,metric:i.metric,brand:i.brand,weight:i.weight,cap:i.cap,target:i.target,actual:i.actual,ach:r1(i.ach),score:r1(i.score),state:i.state}))}))}:null;
    out.simulationNote='Skor kelompok = rata-rata tertimbang skor indikator (bobot). Skor indikator = ach dibatasi cap. Skor akhir = rata-rata skor kelompok. Untuk simulasi, hitung ulang ach = actual baru / target.';
    out.rows=out.kpi?out.kpi.groups:[];
  }
  else if(intent==='DEALER_ORDER_COUNT'){
    const cs=(report.customers||[]).filter(c=>!aiClosed_(c.id,cut));
    const ordered=cs.filter(c=>(c.current?.qty||0)>0);
    const daT=report.brands.reduce((n,b)=>n+(b.targetDA?.value||0),0);
    out.summary={dealersInScope:cs.length,dealersOrdered:ordered.length,dealerAktif:report.total.da,targetDA:daT||null,gapDA:daT?Math.max(0,daT-report.total.da):null};
    out.rows=report.brands.map((b,i)=>({brand:b.brand,dealersOrdered:cs.filter(c=>(c.brands||[]).some(x=>x.brand===b.brand&&x.qty>0)).length,dealerAktif:b.current.da,targetDA:b.targetDA?.value||null})).filter(x=>x.dealersOrdered||x.targetDA);
    const days=(report.daily||[]).slice().sort((a,b)=>a.date.localeCompare(b.date));out.daily=days.slice(-7).map(d=>({date:d.date,dealersOrdered:d.outlets,st:d.qty}));
  }
  else if(intent==='DEALER_PRIORITY'){
    const pot=apiPotensi(token,period,selection),cs=(report.customers||[]).filter(c=>!aiClosed_(c.id,cut));
    const rows=cs.map(c=>{const m=pot.map[c.id]||{};let gap=0,parts=[];Object.keys(m).forEach(b=>{const p=m[b],q=((c.brands||[]).find(x=>x.brand===b)||{}).qty||0,e=p.v*pot.run/Math.max(1,pot.days),k=Math.max(0,e-q);if(k>=0.5){gap+=k;parts.push(b+(p.k==='p'&&q<=0?' (peluang)':'')+' kurang '+Math.round(k));}});return {dealer:c.nama,kode:c.id,kota:c.kota,status:c.status,lastOrder:c.last,st:c.current?.qty||0,gapPotensi:Math.round(gap),rincian:parts.slice(0,4).join('; ')};}).filter(x=>x.gapPotensi>0).sort((a,b)=>b.gapPotensi-a.gapPotensi);
    out.note='GAP potensi = kekurangan dari estimasi s.d. hari ini (rata-rata ST 3 bulan × hari kerja berjalan ÷ total hari kerja), per brand.';out.rows=rows.slice(0,25);out.total=rows.length;
  }
  else if(intent==='CROSS_SELL'||intent==='REACTIVATION'||intent==='NOO_RETENTION'){
    const a=apiAnalisa(token,period,selection);
    if(intent==='CROSS_SELL'){const cs=a.crossSell;out.rows=cs.dealers.map(d=>{const miss=Object.keys(d.cells).filter(b=>!d.cells[b].has&&d.cells[b].est>0&&(!brand||b===brand)).map(b=>({brand:b,estimasiPerBulan:d.cells[b].est,pembanding:d.cells[b].basis}));return {dealer:d.nama,kode:d.id,sales:d.sales,brandDiambil:d.taken,rataST:d.avg,peluang:miss,totalPeluang:miss.reduce((n,x)=>n+x.estimasiPerBulan,0)};}).filter(x=>x.peluang.length).sort((x,y)=>y.totalPeluang-x.totalPeluang).slice(0,25);out.months=cs.months;}
    if(intent==='REACTIVATION'){out.rows=a.reactivation.rows.slice().sort((x,y)=>(y.score||0)-(x.score||0)).slice(0,25).map(x=>({dealer:x.nama,kode:x.id,sales:x.sales,status:x.status,rataST:x.avg,lastOrder:x.last,jedaHari:x.jeda,skor:x.score}));}
    if(intent==='NOO_RETENTION'){const n=a.noo;out.months={noo:n.prev,current:n.current};out.rows=(n.pairs||[]).slice().sort((x,y)=>(x.again?1:0)-(y.again?1:0)||(y.qM||0)-(x.qM||0)).slice(0,60).map(x=>({dealer:x.n,kode:x.c,brand:x.b,bulanNOO:x.m,stBulanPertama:x.qM,stBulanIni:x.qCur,brandBulanIni:x.bl,orderLagi:!!x.again,lastOrder:x.last}));}
  }
  else if(intent==='DAY_PATTERN'){
    const names=['Senin','Selasa','Rabu','Kamis','Jumat','Sabtu','Minggu'],hol=anaHol_(),cnt=Array(7).fill(0),sum=Array(7).fill(0),by={};(report.daily||[]).forEach(d=>by[d.date]=d);
    for(let i=1;i<=+String(cut).slice(8);i++){const d=period+'-'+('0'+i).slice(-2),w=(new Date(d+'T00:00:00Z').getUTCDay()+6)%7;if(anaOff_(d,hol))continue;cnt[w]++;sum[w]+=(by[d]||{}).qty||0;}
    const avg=sum.map((s,i)=>cnt[i]?s/cnt[i]:0),base=avg.slice(0,6).reduce((a,b)=>a+b,0)/6||1;
    out.rows=names.slice(0,6).map((n,i)=>({hari:n,rataPerHari:r1(avg[i]),vsRataHariKerjaPct:r1((avg[i]/base-1)*100),jumlahHari:cnt[i]}));
    out.note='Minggu & tanggal di Hari_Libur tidak dianalisa.';
    out.daily=(report.daily||[]).map(d=>({date:d.date,st:d.qty,dealer:d.outlets}));
  }
  else if(intent==='DEALER_CLOSED'){
    const l=apiDealerTutupList(token);const cur=l.rows.filter(x=>x.current);
    out.rows=cur.filter(x=>x.status==='TUTUP'||x.status==='PENGAJUAN').map(x=>({dealer:x.nama,kode:x.id,subRegion:x.sub,status:x.status,tanggalTutup:x.date,alasan:x.alasan,diajukan:x.byName}));
    const cl=(report.customers||[]).filter(c=>aiClosed_(c.id,cut));out.summary={tutup:out.rows.filter(x=>x.status==='TUTUP').length,menungguApproval:out.rows.filter(x=>x.status==='PENGAJUAN').length,stLMTDdariDealerTutup:cl.reduce((n,c)=>n+(c.previous?.qty||0),0)};
  }
  else if(intent==='RESTOCK'){
    const low=[];['MENIPIS','HABIS'].forEach(st=>{try{const d=apiDOS(token,period,selection,{region:'ALL',subRegion:'ALL',brand:brand||'ALL',type:'ALL',status:st,query:'',pageSize:200},0);if(d.ready)(d.rows||[]).forEach(r=>low.push(r));}catch(e){}});
    const g={};low.forEach(r=>{const k=r.brand+'|'+r.type,x=g[k]||(g[k]={brand:r.brand,type:r.type,dealer:0,stok:0,sellout30:0});x.dealer++;x.stok+=r.stock||0;x.sellout30+=r.sellout||0;});
    out.rows=Object.values(g).sort((a,b)=>b.dealer-a.dealer||b.sellout30-a.sellout30).slice(0,25);out.note='Dealer–TYPE berstatus MENIPIS/HABIS, dikelompokkan per TYPE.';
  }
}
function aiClosed_(id,cut){try{const t=dtClosed_()[id];return !!(t&&t<=cut);}catch(e){return false;}}
