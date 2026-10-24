import { build } from 'esbuild'

await build({
    entryPoints: { index: 'src/index.ts' },
    bundle: true,
    platform: 'node',
    target: 'node20',
    packages: 'external',
    format: 'cjs',
    outdir: 'lib',
    outExtension: { '.js': '.cjs' },
    sourcemap: true
})
