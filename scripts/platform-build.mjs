import { parse } from 'acorn'
import { transformSync } from '@babel/core'
import presetEnv from '@babel/preset-env'
// Copies the web build (dist/) and the platform's manifest and icon into build/<platform>/,
// ready for `tizen package`, `ares-package` or an Android project's assets/www.
import { cpSync, existsSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const platform = process.argv[2]
const manifests = { tizen: ['config.xml'], webos: ['appinfo.json'], android: [] }
if (!(platform in manifests)) {
  console.error('usage: node scripts/platform-build.mjs <tizen|webos|android>')
  process.exit(1)
}

const out = join('build', platform)
rmSync(out, { recursive: true, force: true })
cpSync('dist', out, { recursive: true })
for (const file of manifests[platform]) cpSync(join('platforms', platform, file), join(out, file))
if (platform !== 'android') {
  if (!existsSync('platforms/icon.png')) {
    console.error('platforms/icon.png is missing (render it from platforms/icon.svg)')
    process.exit(1)
  }
  cpSync('platforms/icon.png', join(out, 'icon.png'))
}
// Tizen 3 loads widgets from file:// and has no ES modules. Use only classic
// scripts here; the desktop module/nomodule detection is unnecessary on this target.
if (platform === 'tizen') {
  for (const name of readdirSync(join(out, 'assets'))) {
    if (!name.endsWith('.js') || !name.includes('legacy')) continue
    const file = join(out, 'assets', name)
    const result = transformSync(readFileSync(file, 'utf8'), { babelrc: false, configFile: false, sourceType: 'script', presets: [[presetEnv, { targets: { ie: '11' }, modules: false, useBuiltIns: false }]], comments: false, compact: true })
    const code = '"use strict";\n' + result.code
    parse(code, { ecmaVersion: 5 })
    writeFileSync(file, code)
  }
  const html = readFileSync(join(out, 'index.html'), 'utf8')
  const polyfill = /id="vite-legacy-polyfill" src="([^"]+)"/.exec(html)?.[1]
  const entry = /id="vite-legacy-entry" data-src="([^"]+)"/.exec(html)?.[1]
  if (!polyfill || !entry) throw new Error('Missing legacy TV bundles')
  const styles = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)].map(m => m[0].replace(/ crossorigin/g, '')).join('\n')
  writeFileSync(join(out, 'index.html'), `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=1920, initial-scale=1"><title>aTV</title>${styles}</head><body>
  <div id="app"><div style="padding:80px;color:white;background:#121827;font:32px sans-serif">Spouštím aTV…</div></div>
  <script>
  function bootFailure(message) { var root=document.getElementById('app'); if(root) { root.textContent='aTV: '+String(message).slice(0,600); root.style.cssText='padding:80px;color:white;background:#121827;font:30px sans-serif;white-space:pre-wrap'; } }
  window.addEventListener('error',function(e){bootFailure(e.message || 'Chyba načítání aplikace');});
  </script>
  <script src="${polyfill}" onerror="bootFailure('Nelze načíst podporu starší TV')"></script>
  <script>System.import('${entry}').catch(function(e){bootFailure(e.message || e);});</script>
  </body></html>`)
}
console.log(`${platform} build ready in ${out}`)
