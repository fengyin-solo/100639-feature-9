/* 冒烟测试入口：打包 scripts/ 下的 smoke-*.ts 并依次在 node 里跑。用法：npm run smoke */
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const root = fileURLToPath(new URL('..', import.meta.url))
const outdir = `${root}node_modules/.cache/smoke`
mkdirSync(outdir, { recursive: true })

const suites = ['smoke-ventilation', 'smoke-storage']
for (const name of suites) {
  await build({
    entryPoints: [`${root}scripts/${name}.ts`],
    bundle: true,
    platform: 'node',
    format: 'esm',
    alias: { '@': `${root}src` },
    outfile: `${outdir}/${name}.mjs`,
    logLevel: 'silent',
  })
  execFileSync(process.execPath, [`${outdir}/${name}.mjs`], { stdio: 'inherit' })
}
console.log('全部冒烟测试通过')
