const { spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const { resolve } = require('node:path')

// stdout es el canal MCP: los errores van a stderr.
const entry = resolve(__dirname, '../out/main/brain-mcp.js')
if (!existsSync(entry)) {
  process.stderr.write('Ejecuta npm run build antes de usar el MCP de Cerebro.\n')
  process.exitCode = 1
} else {
  const child = spawn(require('electron'), [entry, ...process.argv.slice(2)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
    windowsHide: true
  })
  child.on('error', (error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
  child.on('exit', (code) => {
    process.exitCode = code ?? 1
  })
}
