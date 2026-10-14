const { buildSync } = require('esbuild')
const { spawnSync } = require('node:child_process')
const path = require('node:path')

buildSync({ entryPoints: ['tests/main.test.ts'], bundle: true, platform: 'node', format: 'cjs', packages: 'external', outfile: 'tests/.build/main.cjs' })
const environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE
const result = spawnSync(require('electron'), [path.resolve('tests/.build/main.cjs')], { env: environment, encoding: 'utf8', windowsHide: true, timeout: 60000 })
process.stdout.write(result.stdout || '')
process.stderr.write(result.stderr || '')
if (result.error) console.error(result.error.message)
process.exitCode = result.status === 0 ? 0 : 1
