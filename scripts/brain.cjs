const { spawnSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { resolve } = require('node:path')

const entry = resolve(__dirname, '../out/main/brain-cli.js')
if (!existsSync(entry)) {
  process.stdout.write(JSON.stringify({ error: 'Ejecuta npm run build antes de usar Cerebro.' }) + '\n')
  process.exitCode = 1
} else {
  const child = spawnSync(require('electron'), [entry, ...process.argv.slice(2)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
    windowsHide: true
  })
  if (child.error) process.stderr.write(`${child.error.message}\n`)
  process.exitCode = child.status ?? 1
}
