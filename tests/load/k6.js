import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 100,
  duration: '10m',
  thresholds: {
    http_req_duration: ['p(95)<1000','p(99)<2000'],
    http_req_failed: ['rate<0.005'],
  },
};

const BASE=__ENV.BASE_URL || 'https://portal.example.com';
const NIK=__ENV.TEST_NIK || '';
const PIN=__ENV.TEST_PIN || '';

function post(path, body={}) {
  return http.post(`${BASE}${path}`, JSON.stringify(body), {headers:{'Content-Type':'application/json'}, redirects:0});
}
export function setup(){
  if(!NIK || !PIN) throw new Error('TEST_NIK and TEST_PIN are required');
}
export default function(){
  const login=post('/api/apiLogin',{nik:NIK,pin:PIN});
  check(login, {'login 200': r=>r.status===200});
  const token=login.json('token');
  if(!token){ sleep(3); return; }
  const calls=[
    ['/api/apiBootstrap',{token}],
    ['/api/apiDashboard',{token,period:__ENV.TEST_PERIOD||'2026-09',selection:'ALL'}],
    ['/api/apiDealerHistory',{token,selection:'ALL',brand:[],from:__ENV.TEST_PERIOD||'2026-09',to:__ENV.TEST_PERIOD||'2026-09',page:1,query:'',filters:{}}],
    ['/api/apiTeam',{token,period:__ENV.TEST_PERIOD||'2026-09',level:'SALES',brand:'ALL',selection:'ALL',filters:{}}],
    ['/api/apiTransactions',{token,period:__ENV.TEST_PERIOD||'2026-09',selection:'ALL',customer:'',page:1,dateFrom:'',dateTo:'',sort:{},pageSize:100}],
  ];
  for(const [p,b] of calls){
    const r=post(p,b);
    check(r,{[`${p} < 500`]:x=>x.status<500});
    sleep(3+Math.random()*2);
  }
}
