import type { MediaResult, SearchProvider } from '../shared/media.ts'

export interface SearchJob { id: string; name: string; run(): Promise<MediaResult[]> }
export interface SearchBatch { id: string; name: string; load(): Promise<SearchJob[]> }
export type SearchTask = SearchJob | SearchBatch
interface Session {
  expires: number
  groups: MediaResult[][]
  providers: SearchProvider[]
  done: Promise<void>
}

/** A search starts once; polling returns fast providers while slower ones keep running. */
export class Searches {
  private readonly sessions = new Map<string, Session>()
  private readonly jobs: (query: string) => SearchTask[]
  constructor(jobs: (query: string) => SearchTask[]) { this.jobs = jobs }

  private session(query: string): Session {
    const q = query.trim().slice(0, 200)
    const key = q.toLowerCase()
    const cached = this.sessions.get(key)
    if (cached && cached.expires > Date.now()) return cached
    for (const [k, session] of this.sessions) if (session.expires <= Date.now()) this.sessions.delete(k)
    if (this.sessions.size >= 50) this.sessions.delete(this.sessions.keys().next().value!)
    const jobs = q.length >= 2 ? this.jobs(q) : []
    const session: Session = {
      expires: Date.now() + 120_000,
      groups: jobs.map(() => []),
      providers: jobs.map((j) => ({ id: j.id, name: j.name, state: 'pending', count: 0 })),
      done: Promise.resolve(),
    }
    const update = (id: string, value: SearchProvider) => {
      const index = session.providers.findIndex((p) => p.id === id)
      if (index >= 0) session.providers[index] = value
    }
    session.done = Promise.all(jobs.map(async (job, i) => {
      try {
        if ('load' in job) {
          const children = await job.load()
          if (!children.length) { update(job.id, { id: job.id, name: job.name, state: 'done', count: 0 }); return }
          const index = session.providers.findIndex((p) => p.id === job.id)
          session.providers.splice(index, 1, ...children.map((j): SearchProvider => ({ id: j.id, name: j.name, state: 'pending', count: 0 })))
          const groups: MediaResult[][] = children.map(() => [])
          await Promise.all(children.map(async (child, childIndex) => {
            try {
              groups[childIndex] = await child.run()
              session.groups[i] = groups.flat()
              update(child.id, { id: child.id, name: child.name, state: 'done', count: groups[childIndex].length })
            } catch { update(child.id, { id: child.id, name: child.name, state: 'error', count: 0 }) }
          }))
        } else {
          const results = await job.run()
          session.groups[i] = results
          update(job.id, { id: job.id, name: job.name, state: 'done', count: results.length })
        }
      } catch {
        // Provider errors may contain credentials. Only publish its name and availability.
        update(job.id, { id: job.id, name: job.name, state: 'error', count: 0 })
      }
    })).then(() => {})
    this.sessions.set(key, session)
    return session
  }

  snapshot(query: string): { groups: MediaResult[][]; providers: SearchProvider[] } {
    const session = this.session(query)
    return { groups: session.groups.slice(), providers: session.providers.slice() }
  }

  async complete(query: string): Promise<MediaResult[][]> {
    const session = this.session(query)
    await session.done
    return session.groups
  }
}
