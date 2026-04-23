import * as esbuild from 'esbuild'
import { glob } from 'node:fs/promises'
import path from 'node:path'

const entryPoints = []
for await (const file of glob('lambdas/**/handler.ts')) {
  entryPoints.push(file)
}

await esbuild.build({
  entryPoints,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outdir: 'dist',
  external: ['@aws-sdk/*'],   // provided by Lambda runtime
  sourcemap: true,
  minify: false,
})

console.log('Build complete:', entryPoints)
