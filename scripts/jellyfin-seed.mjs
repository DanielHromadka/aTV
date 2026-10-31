// Sets up a fresh Jellyfin for local testing: finishes the startup wizard with user atv/atv,
// adds the Filmy and Seriály libraries from ./media, and turns Quick Connect on.
// Leaves a Jellyfin that is already set up alone, apart from adding missing libraries.
const server = (process.env.JELLYFIN_URL ?? 'http://localhost:8096').replace(/\/+$/, '')
const user = process.env.JELLYFIN_USER ?? 'atv'
const password = process.env.JELLYFIN_PASSWORD ?? 'atv'
const auth = (token) =>
  `MediaBrowser Client="aTV seed", Device="seed", DeviceId="atv-seed", Version="0.1.0"${token ? `, Token="${token}"` : ''}`

async function call(method, path, body, token) {
  const res = await fetch(server + path, {
    method,
    headers: { Authorization: auth(token), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${await res.text()}`)
  const text = await res.text()
  return text ? JSON.parse(text) : undefined
}

async function waitForServer() {
  for (let i = 0; i < 90; i++) {
    try {
      return await call('GET', '/System/Info/Public')
    } catch {
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
  throw new Error(`Jellyfin at ${server} did not start`)
}

const info = await waitForServer()
console.log(`Jellyfin ${info.Version} at ${server}`)

if (!info.StartupWizardCompleted) {
  await call('POST', '/Startup/Configuration', { UICulture: 'cs', MetadataCountryCode: 'CZ', PreferredMetadataLanguage: 'cs' })
  await call('GET', '/Startup/User')
  await call('POST', '/Startup/User', { Name: user, Password: password })
  await call('POST', '/Startup/RemoteAccess', { EnableRemoteAccess: true, EnableAutomaticPortMapping: false })
  await call('POST', '/Startup/Complete')
  console.log(`Startup wizard done, user ${user}/${password}`)
}

const session = await call('POST', '/Users/AuthenticateByName', { Username: user, Pw: password })
const token = session.AccessToken

const config = await call('GET', '/System/Configuration', undefined, token)
const patch = {}
if (!config.QuickConnectAvailable) patch.QuickConnectAvailable = true
// Jellyfin never offers to resume items under 5 minutes; the test clips are shorter.
if (!info.StartupWizardCompleted || process.env.SHORT_RESUME) patch.MinResumeDurationSeconds = 30
if (Object.keys(patch).length) {
  await call('POST', '/System/Configuration', { ...config, ...patch }, token)
  console.log('Server settings:', JSON.stringify(patch))
}

const folders = await call('GET', '/Library/VirtualFolders', undefined, token)
for (const [name, type, path] of [
  ['Filmy', 'movies', '/media/Filmy'],
  ['Seriály', 'tvshows', '/media/Seriály'],
]) {
  if (folders.some((f) => f.Name === name)) continue
  const q = new URLSearchParams({ name, collectionType: type, refreshLibrary: 'true' })
  await call('POST', `/Library/VirtualFolders?${q}`, { LibraryOptions: { PathInfos: [{ Path: path }] } }, token)
  console.log(`Library ${name} → ${path}`)
}

await call('POST', '/Library/Refresh', undefined, token)
console.log('Library scan started; give it a few seconds.')
