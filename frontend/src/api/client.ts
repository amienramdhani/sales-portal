export type APIError={error:string;requestId?:string};
export async function api<T=any>(name:string, body:Record<string,unknown>={}):Promise<T>{
 const r=await fetch(`/api/${name}`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
 const id=r.headers.get('X-Request-ID')||undefined;let data:any;try{data=await r.json()}catch{data={error:`HTTP ${r.status}`}}
 if(!r.ok){const e=new Error(data?.error||data?.message||`HTTP ${r.status}`) as Error&{requestId?:string,status?:number};e.requestId=id;e.status=r.status;throw e}return data as T
}
