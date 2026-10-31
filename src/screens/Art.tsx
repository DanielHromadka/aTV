import { useEffect, useRef, useState } from 'preact/hooks'
import type { ArtArtist } from '../../shared/art.ts'
import { GALLERY_INTERVALS, galleryNext } from '../../shared/art.ts'
import { Button, Card, Message, Row, Spinner } from '../components'
import { nav, useScreenKeys } from '../state'
import { hubApi, hubUrl } from '../services/hub'
import { focusById } from '../nav/focus'
type ArtistSummary={id:string;name:string;count:number;cover:string;photo?:string}
const image=(id:string,thumb=false)=>`${hubUrl()}/api/art/images/${id}${thumb?'?thumb=1':''}`
const intervalLabel=(n:number)=>n===0?'Bez střídání':n<60?`${n} s`:n<3600?`${n/60} min`:`${n/3600} h`
function savedInterval(){try{const n=Number(localStorage.getItem('atv.gallery.interval')??60);return GALLERY_INTERVALS.includes(n)?n:60}catch{return 60}}
function ArtistCard({a}:{a:ArtistSummary}){return <Card id={`art-artist-${a.id}`} title={a.name} subtitle={`${a.count} děl`} image={a.photo?image(a.photo,true):image(a.cover,true)} onClick={()=>nav.push({type:'art-artist',id:a.id})}/>}
export function Artists(){
  const [artists,setArtists]=useState<ArtistSummary[]|null>(null);const [error,setError]=useState('');const [query,setQuery]=useState('');const [page,setPage]=useState(1)
  useEffect(()=>{let stop=false;hubApi<{artists:ArtistSummary[]}>('/api/art/artists').then(d=>!stop&&setArtists(d.artists),()=>!stop&&setError('Galerii se nepodařilo načíst. Vraťte se a zkuste to znovu.'));return()=>{stop=true}},[])
  const filtered=artists?.filter(a=>a.name.toLowerCase().includes(query.toLowerCase()))??[]
  return <div class="screen-body padded" data-scroll="y"><h1 class="screen-title">Umělci</h1><p class="muted">Obrazy pro vaši televizi · Wikimedia Commons</p>
    <Button id="art-search" autofocus label={query?`Hledat: ${query}`:'Hledat umělce'} onClick={()=>nav.push({type:'keyboard',title:'Jméno umělce',value:query,onDone:q=>{setQuery(q);setPage(1)}})}/>
    {error&&<Message>{error}</Message>}{!artists&&!error&&<Spinner/>}
    {artists&&!artists.length&&<Message>Galerie zatím nemá importovaná díla.</Message>}
    <div class="grid art-grid">{filtered.slice((page-1)*20,page*20).map(a=><ArtistCard key={a.id} a={a}/>)}</div>
    <div class="buttons">{page>1&&<Button id="art-prev" label="Předchozí strana" onClick={()=>{focusById('art-search');setPage(page-1)}}/>}{page*20<filtered.length&&<Button id="art-next" label="Další strana" onClick={()=>{focusById('art-search');setPage(page+1)}}/>}</div>
    <p class="muted">{filtered.length} umělců · strana {page}</p>
    <p class="muted">Volně dostupné reprodukce z Wikimedia Commons. Portréty: Wikipedia / Wikimedia Commons.</p></div>
}
function useArtist(id:string){const [data,setData]=useState<ArtArtist|null>(null);const [error,setError]=useState('');useEffect(()=>{let stop=false;setData(null);setError('');hubApi<ArtArtist>(`/api/art/artists/${id}`).then(d=>!stop&&setData(d),()=>!stop&&setError('Díla nelze načíst. Vraťte se a zkuste to znovu.'));return()=>{stop=true}},[id]);return {data,error}}
export function ArtArtistDetail({id}:{id:string}){const {data,error}=useArtist(id);return <div class="screen-body padded" data-scroll="y">
  <h1 class="screen-title">{data?.name??'Umělec'}</h1>{error&&<Message>{error}</Message>}{!data&&!error&&<Spinner/>}
  {data&&<>{data.photo&&<img class="actor-photo" src={image(`portrait-${data.id}`)} alt={data.name}/>}<p class="muted">{data.works.length} děl · Vyberte obraz nebo spusťte galerii.</p><Button id="art-start" autofocus primary label="Spustit galerii" onClick={()=>nav.push({type:'gallery',artistId:id,start:0})}/>
    <div class="grid art-grid">{data.works.map((w,i)=><Card key={w.id} id={`art-${w.id}`} title={w.title} subtitle={w.date} image={image(w.id,true)} onClick={()=>nav.push({type:'gallery',artistId:id,start:i})}/>)}</div></>}
  </div>}
export function Gallery({artistId,start,screenKey}:{artistId:string;start:number;screenKey:number}){
  const {data,error}=useArtist(artistId);const [index,setIndex]=useState(start);const [seconds,setSeconds]=useState(savedInterval);const [paused,setPaused]=useState(false);const [loaded,setLoaded]=useState(false);const [failed,setFailed]=useState(false);const [hud,setHud]=useState(true);const [menu,setMenu]=useState(false);const hide=useRef<number | undefined>(undefined);const shown=useRef<ArtArtist['works'][number] | null>(null);const [previous,setPrevious]=useState<ArtArtist['works'][number] | null>(null);
  const work=data?.works[galleryNext(index,data.works.length)];const move=(delta:number)=>{if(data){const target=galleryNext(index,data.works.length,delta);if(target===index)return;setPrevious(shown.current);setLoaded(false);setFailed(false);setIndex(target)}}
  function show(){setHud(true);window.clearTimeout(hide.current);hide.current=window.setTimeout(()=>setHud(false),4000)}
  useEffect(()=>{show();return()=>window.clearTimeout(hide.current)},[])
  useEffect(()=>{if(!work||!loaded||paused||!seconds||menu)return;const t=window.setTimeout(()=>move(1),seconds*1000);return()=>window.clearTimeout(t)},[work?.id,loaded,paused,seconds,menu])
  useEffect(()=>{if(!data||data.works.length<2)return;const next=new Image();next.src=image(data.works[galleryNext(index,data.works.length,1)].id)},[work?.id])
  useEffect(()=>{try{localStorage.setItem('atv.gallery.interval',String(seconds))}catch{}},[seconds])
  useScreenKeys(screenKey,a=>{show();if(menu){if(a==='back'){setMenu(false);return true}return false}if(a==='left'){move(-1);return true}if(a==='right'){move(1);return true}if(a==='ok'||a==='playpause'){setPaused(p=>!p);return true}if(a==='up'||a==='down'){setMenu(true);window.setTimeout(()=>focusById('gallery-interval'),0);return true}if(a==='pause'){setPaused(true);return true}if(a==='play'){setPaused(false);return true}return false})
  return <div class="art-gallery" onMouseMove={show} onTouchStart={show} onClick={show}>
    {previous&&<img class="gallery-image gallery-previous" src={image(previous.id)} alt="" aria-hidden="true"/>}
    {work&&<img key={work.id} class={`gallery-image gallery-current${loaded?' ready':''}`}  src={image(work.id)} alt={`${work.title} — ${work.artist}`} onLoad={()=>{shown.current=work??null;setLoaded(true)}} onError={()=>{setLoaded(false);setFailed(true);setHud(true)}}/>}
    {(error||failed)&&<div class="gallery-message"><Message>{error||'Obraz není dostupný. Šipkou přejděte na další dílo.'}</Message></div>}
    {!loaded&&!previous&&!error&&!failed&&<div class="player-center"><Spinner label="Načítám dílo…"/></div>}
    <div class={`gallery-hud${hud||menu||failed?' show':''}`}><h1>{work?.title}</h1><p>{work?.artist} · {work?.date} · Wikimedia Commons</p>
      <p>{paused?'Pozastaveno':intervalLabel(seconds)} · ◀ ▶ další dílo · OK pauza · ↑ nastavení · Zpět ukončit</p>
      <div class="gallery-mouse"><Button id="gallery-settings" label="Nastavení galerie" onClick={()=>setMenu(!menu)}/></div>
      {menu&&<div class="buttons"><Button id="gallery-interval" primary label={`Doba zobrazení: ${intervalLabel(seconds)}`} onClick={()=>setSeconds(current=>GALLERY_INTERVALS[(GALLERY_INTERVALS.indexOf(current)+1)%GALLERY_INTERVALS.length])}/>
      <Button id="gallery-pause" label={paused?'Pokračovat':'Pozastavit'} onClick={()=>setPaused(!paused)}/><Button id="gallery-close-settings" label="Hotovo" onClick={()=>{setMenu(false);show()}}/></div>}
    </div></div>
}
export function ArtistsRow({active}:{active:boolean}){const [artists,setArtists]=useState<ArtistSummary[]>([]);useEffect(()=>{if(!active)return;let stop=false;hubApi<{artists:ArtistSummary[]}>('/api/art/artists').then(d=>!stop&&setArtists(d.artists.slice(0,12)),()=>{});return()=>{stop=true}},[active]);return artists.length?<Row title="Umělci · Galerie">{artists.map(a=><ArtistCard key={a.id} a={a}/>)}</Row>:null}
