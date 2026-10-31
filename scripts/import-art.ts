import { ART_SELECTION } from '../shared/art-selection.ts'
import { createHash } from 'node:crypto'
import { mkdir, writeFile, rename, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadConfig } from '../hub/config.ts'
import type { ArtLibrary } from '../shared/art.ts'
const names = ART_SELECTION

const artists: ArtLibrary['artists']=[]
const plain=(s:string)=>s.replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim()
const fold=(s:string)=>plain(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
const {dataDir: cacheRoot}=loadConfig();const cache=join(cacheRoot,'art-import');await mkdir(cache,{recursive:true})
async function get(host:string,params:Record<string,string>){
 const url='https://'+host+'/w/api.php?'+new URLSearchParams({action:'query',format:'json',...params});const file=join(cache,createHash('sha256').update(url).digest('hex')+'.json')
 try{return JSON.parse(await readFile(file,'utf8'))}catch{}
 for(let attempt=0;attempt<5;attempt++){
  const r=await fetch(url,{signal:AbortSignal.timeout(25000),headers:{'User-Agent':'aTV art gallery/0.1'}})
  if(r.status===429||r.status===503){await new Promise(resolve=>setTimeout(resolve,Math.max(Number(r.headers.get('retry-after'))||0,10*(attempt+1))*1000));continue}
  if(!r.ok)throw new Error('Image API HTTP '+r.status)
  const value=await r.json() as any;await writeFile(file,JSON.stringify(value));await new Promise(resolve=>setTimeout(resolve,1500));return value
 }
 throw new Error('Image API stále omezuje požadavky; spusťte import později.')
}

// Wikipedia accepts up to 50 titles per request; batch portraits to reduce API load.
const portraits=new Map<string,any>()
for(let i=0;i<names.length;i+=50){
 const group=names.slice(i,i+50)
 const data=await get('en.wikipedia.org',{titles:group.join('|'),redirects:'1',prop:'pageimages',pithumbsize:'500',pilimit:'50'})
 const pages=Object.values(data.query?.pages??{}) as any[]
 for(const name of group){let title=name;for(const n of data.query?.normalized??[])if(n.from===title)title=n.to;for(const r of data.query?.redirects??[])if(r.from===title)title=r.to;const page=pages.find(p=>p.title===title);if(page)portraits.set(name,page)}
}

for(const name of names){
 if(artists.length===100)break
 const person:any=portraits.get(name)
 const params={generator:'search',gsrsearch:name+' painting',gsrnamespace:'6',gsrlimit:'12',prop:'imageinfo',iiprop:'url|extmetadata',iiurlwidth:'1686'}
 const oldUrl='https://commons.wikimedia.org/w/api.php?'+new URLSearchParams({action:'query',format:'json',...params})
 let found:any
 try{found=JSON.parse(await readFile(join(cache,createHash('sha256').update(oldUrl).digest('hex')+'.json'),'utf8'))}catch{found=await get('commons.wikimedia.org',{...params,gsrlimit:'3'})}
 const works=[]
 for(const p of Object.values(found.query?.pages??{}) as any[]){
  const info=p.imageinfo?.[0],meta=info?.extmetadata
  if(!info?.thumburl||meta?.LicenseShortName?.value!=='Public domain'||!fold(meta.Artist?.value||'').includes(fold(name)))continue
  works.push({id:'90'+p.pageid,title:p.title.replace(/^File:/,'').replace(/\.(jpe?g|png|tiff?)$/i,'').replace(/ - Google Art Project$/i,''),artist:name,date:plain(meta.DateTimeOriginal?.value||meta.DateTime?.value||'').split(/\b(?:date|title|label) QS:/i)[0].trim(),image:info.thumburl,museum:'Wikimedia Commons · Public domain'})
 }
 if(works.length && person?.thumbnail)artists.push({id:String(names.indexOf(name)+1),name,works,photo:person?.thumbnail?.source})
 console.log(name,works.length,person?.thumbnail?'portrait':'no portrait')
 await new Promise(r=>setTimeout(r,250))
}
if(artists.length!==100)throw new Error(`Neúplný import: ${artists.length}/100 ověřených umělců; původní knihovna zachována`)
const {dataDir}=loadConfig();await mkdir(dataDir,{recursive:true});const file=join(dataDir,'art-library.json')
await writeFile(file+'.tmp',JSON.stringify({version:1,updatedAt:new Date().toISOString(),artists}));await rename(file+'.tmp',file)
console.log('Imported',artists.length,'artists',artists.reduce((n,a)=>n+a.works.length,0),'works; portraits',artists.filter(a=>a.photo).length)
