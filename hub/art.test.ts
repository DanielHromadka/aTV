import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Art } from './art.ts'
const dirs:string[]=[]
afterEach(()=>{vi.unstubAllGlobals();for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true})})
function fixture(){const d=mkdtempSync(join(tmpdir(),'atv-art-'));dirs.push(d);writeFileSync(join(d,'art-library.json'),JSON.stringify({version:1,artists:[{id:'1',name:'Artist',photo:'https://example.org/portrait.jpg',works:[{id:'10',image:'https://example.org/art.jpg'}]}]}));return d}
it('proxies portraits and persists image bytes across service restarts',async()=>{
 const fetcher=vi.fn(async()=>new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/jpeg'}}));vi.stubGlobal('fetch',fetcher)
 const dir=fixture();expect(await new Art(dir).image('portrait-1',true)).toEqual(Buffer.from([1,2,3]));expect(await new Art(dir).image('portrait-1',true)).toEqual(Buffer.from([1,2,3]));expect(fetcher).toHaveBeenCalledOnce()
})
it('rejects unknown images and error pages without storing them as pictures',async()=>{
 const fetcher=vi.fn(async()=>new Response('<html>blocked</html>',{status:403}));vi.stubGlobal('fetch',fetcher)
 const art=new Art(fixture());await expect(art.image('../config',false)).rejects.toThrow('nenalezeno');expect(fetcher).not.toHaveBeenCalled();await expect(art.image('10',false)).rejects.toThrow('není dostupný')
})
