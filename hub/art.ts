import { readFileSync, mkdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ArtLibrary } from '../shared/art.ts'
export class Art {
  readonly library: ArtLibrary
  private dir: string
  private pending = new Map<string, Promise<Buffer>>()
  constructor(dataDir: string) {
    this.dir=join(dataDir,'art-images');mkdirSync(this.dir,{recursive:true})
    try { this.library=JSON.parse(readFileSync(join(dataDir,'art-library.json'),'utf8')) } catch { this.library={version:1,updatedAt:'',artists:[]} }
  }
  async image(id: string, thumb: boolean): Promise<Buffer> {
    const portrait=id.startsWith('portrait-')?this.library.artists.find(a=>a.id===id.slice(9))?.photo:undefined
    const work=portrait?{image:portrait}:this.library.artists.flatMap(a=>a.works).find(w=>w.id===id)
    if (!work) throw new Error('Dílo nenalezeno')
    const key=id+(thumb?'-thumb':'');const known=this.pending.get(key);if(known)return known
    const task=(async()=>{
      const file=join(this.dir,key+'.jpg');try{return await readFile(file)}catch{}
      const response=await fetch(thumb?work.image.replace('/1686,/', '/400,/'):work.image,{signal:AbortSignal.timeout(25000)})
      if(!response.ok || !response.headers.get('content-type')?.startsWith('image/'))throw new Error('Obraz není dostupný')
      const chunks:Buffer[]=[];let size=0
      for await(const part of response.body!){size+=part.length;if(size>20000000)throw new Error('Obraz je příliš velký');chunks.push(Buffer.from(part))}
      const body=Buffer.concat(chunks);await writeFile(file,body);return body
    })().finally(()=>this.pending.delete(key));this.pending.set(key,task);return task
  }
}
