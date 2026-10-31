import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ACTOR_EXPANSION } from '../shared/actor-expansion.ts'
import { Actors } from '../hub/actors.ts'
import { loadConfig } from '../hub/config.ts'
import type { ActorLibrary, Filmography } from '../shared/actors.ts'
const config=loadConfig();if(!config.tmdbApiKey)throw new Error('Chybí TMDB klíč')
const file=join(config.dataDir,'actors-library.json');const library=JSON.parse(await readFile(file,'utf8')) as ActorLibrary
const service=new Actors(config.tmdbApiKey);const entries=library.entries.slice(0,100);const seen=new Set(entries.map(e=>e.actor.id));const cache=join(config.dataDir,'actors-expansion');await mkdir(cache,{recursive:true})
const fold=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'')
for(const name of ACTOR_EXPANSION){
 if(entries.length>=400)break
 if(entries.some(e=>fold(e.actor.name)===fold(name)))continue
 try{
  const results=(await service.list(name,1,'en-US')).actors
  const actor=results.find(a=>fold(a.name)===fold(name))??(results.length===1?results[0]:undefined)
  if(!actor||seen.has(actor.id))continue
  let detail:Filmography;const checkpoint=join(cache,actor.id+'.json');try{detail=JSON.parse(await readFile(checkpoint,'utf8'))}catch{detail=await service.filmography(actor.id);await writeFile(checkpoint,JSON.stringify(detail))}
  if(!detail.actor.photo||!detail.movies.some(m=>m.year&&m.year>=1996&&m.year<=2026))continue
  detail.actor.name=name;detail.actor.knownFor=actor.knownFor;entries.push(detail);seen.add(actor.id)
  if(entries.length%25===0)console.log('Actors',entries.length,'/400')
 }catch{console.log('Skipped unavailable profile',name)}
}
if(entries.length!==400)throw new Error('Import není kompletní')
await writeFile(file+'.tmp',JSON.stringify({...library,title:'400 známých herců',updatedAt:new Date().toISOString(),entries}),{mode:0o600});await rename(file+'.tmp',file)
console.log(JSON.stringify({actors:entries.length,portraits:entries.filter(e=>e.actor.photo).length,films:new Set(entries.flatMap(e=>e.movies.map(m=>m.id))).size}))
