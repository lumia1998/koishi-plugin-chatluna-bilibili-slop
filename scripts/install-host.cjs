// Targeted development install: preserves unrelated packages in an existing host.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { createRequire } = require('node:module')
const { execFileSync } = require('node:child_process')

const host = fs.realpathSync(process.argv[2])
const req = createRequire(path.join(host, 'package.json'))
const YAML = req('yaml')
const semver = req('semver')
const root = path.resolve(__dirname, '..')
const pkg = require('../package.json')
const sdk = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'))
const modules = fs.realpathSync(path.join(host, 'node_modules'))
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = path.join(host, 'data', 'bilibili-slop-install', stamp)
const modulePath = (name) => path.join(modules, ...name.split('/'))
const sdkArchive = path.resolve(process.argv[3])
const slopArchive = path.join(root, `${pkg.name}-${pkg.version}.tgz`)
const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar'
const integrity = (file) => 'sha512-' + crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64')
if (integrity(sdkArchive) !== sdk.dist.integrity) throw new Error('Adapter archive differs from the published npm package')

const planned = new Map([[sdk.name, sdk.version], [pkg.name, pkg.version]])
for (const target of [sdk, pkg]) {
    for (const [name, range] of Object.entries({ ...target.dependencies, ...target.peerDependencies })) {
        const version = planned.get(name) || req(name + '/package.json').version
        if (!semver.satisfies(version, range, { includePrerelease: true })) throw new Error(`Host dependency mismatch: ${name}@${version}, needs ${range}`)
    }
    if (fs.existsSync(modulePath(target.name))) throw new Error(`Already installed: ${target.name}`)
}

const manifest = path.join(host, 'package.json')
const lockfile = path.join(host, 'package-lock.json')
const hidden = path.join(modules, '.package-lock.json')
const config = path.join(host, 'koishi.yml')
const originals = new Map([manifest, lockfile, hidden, config].filter(fs.existsSync).map((file) => [file, fs.readFileSync(file)]))
const doc = YAML.parseDocument(originals.get(config).toString('utf8'))
if (doc.errors.length) throw new Error('Cannot parse Koishi config safely')
const plugins = doc.get('plugins', true)
if (!YAML.isMap(plugins)) throw new Error('Koishi plugins mapping was not found')
const before = structuredClone(doc.toJSON())
const find = (map, match) => {
    for (const item of map.items) {
        if (match.test(String(item.key))) return map
        if (YAML.isMap(item.value) && /^~?group:/.test(String(item.key))) {
            const found = find(item.value, match)
            if (found) return found
        }
    }
}
const slopGroup = find(plugins, /^chatluna(?::|$)/) || plugins
const adapterGroup = (() => {
    const scan = (map) => {
        for (const item of map.items) {
            if (YAML.isMap(item.value) && /^group:adapter(?::|$)/.test(String(item.key))) return item.value
            if (YAML.isMap(item.value) && /^group:/.test(String(item.key))) { const found = scan(item.value); if (found) return found }
        }
    }
    return scan(plugins) || plugins
})()
const sdkKey = '~@lumia.wang/adapter-bilibili'
const slopKey = 'chatluna-bilibili-slop'
if (find(plugins, /^(?:~?@lumia\.wang\/adapter-bilibili|~?chatluna-bilibili-slop)(?::|$)/)) throw new Error('Plugin configuration already exists')
adapterGroup.set(sdkKey, doc.createNode({ selfId: '' }))
slopGroup.set(slopKey, doc.createNode({ ownerUid: '' }))
const configText = doc.toString({ lineWidth: 0 })
const parsed = YAML.parseDocument(configText)
if (parsed.errors.length) throw new Error('New Koishi config did not round-trip')
const after = parsed.toJSON()
const remove = (value) => {
    if (!value || typeof value !== 'object') return
    delete value[sdkKey]; delete value[slopKey]
    for (const child of Object.values(value)) remove(child)
}
remove(after)
if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('An existing Koishi setting would change')

fs.mkdirSync(backup, { recursive: true })
let index = 0
for (const [file, bytes] of originals) fs.writeFileSync(path.join(backup, `${index++}-${path.basename(file)}`), bytes)
const installed = []
try {
    for (const [name, archive] of [[sdk.name, sdkArchive], [pkg.name, slopArchive]]) {
        const dest = modulePath(name)
        if (!path.resolve(dest).startsWith(modules + path.sep)) throw new Error('Module path escaped host node_modules')
        fs.mkdirSync(dest, { recursive: true })
        installed.push(dest)
        execFileSync(tar, ['-xzf', archive, '--strip-components=1', '-C', dest], { windowsHide: true })
        const actual = JSON.parse(fs.readFileSync(path.join(dest, 'package.json'), 'utf8'))
        if (actual.name !== name || actual.version !== planned.get(name)) throw new Error('Unexpected package identity')
    }
    const app = JSON.parse(originals.get(manifest).toString('utf8'))
    const local = 'file:' + path.relative(host, slopArchive).replaceAll('\\', '/')
    app.dependencies[sdk.name] = '^' + sdk.version
    app.dependencies[pkg.name] = local
    fs.writeFileSync(manifest, JSON.stringify(app, null, 2) + '\n')
    for (const file of [lockfile, hidden].filter((file) => originals.has(file))) {
        const lock = JSON.parse(originals.get(file).toString('utf8'))
        if (!lock.packages || lock.lockfileVersion !== 3) throw new Error('Unsupported npm lock format')
        if (lock.packages['']) {
            lock.packages[''].dependencies[sdk.name] = app.dependencies[sdk.name]
            lock.packages[''].dependencies[pkg.name] = local
        }
        for (const item of [sdk, pkg]) {
            lock.packages['node_modules/' + item.name] = {
                version: item.version, resolved: item === sdk ? sdk.dist.tarball : local,
                integrity: item === sdk ? sdk.dist.integrity : integrity(slopArchive),
                license: item.license, dependencies: item.dependencies, engines: item.engines,
                peerDependencies: item.peerDependencies
            }
        }
        fs.writeFileSync(file, JSON.stringify(lock, null, 2) + '\n')
    }
    fs.writeFileSync(config, originals.get(config).includes(Buffer.from('\r\n')) ? configText.replaceAll('\n', '\r\n') : configText)
    // Resolve from the host to ensure both plugins use its Koishi and ChatLuna.
    const adapter = req(sdk.name)
    const slop = req(pkg.name)
    if (adapter.name !== 'adapter-bilibili' || slop.name !== 'chatluna-bilibili-slop') throw new Error('Installed entry failed validation')
    console.log(`Installed ${sdk.name}@${sdk.version} and ${pkg.name}@${pkg.version}`)
    console.log(`Preserved ChatLuna ${req('koishi-plugin-chatluna/package.json').version}`)
    console.log(`Config: ${slopKey} enabled; adapter disabled until its UID is set`)
    console.log(`Backups: ${backup}`)
} catch (err) {
    for (const [file, bytes] of originals) fs.writeFileSync(file, bytes)
    for (const dir of installed.reverse()) {
        const target = fs.realpathSync(dir)
        if (!target.startsWith(modules + path.sep)) throw new Error('Refusing to remove an unexpected path')
        fs.rmSync(target, { recursive: true, force: true })
    }
    throw err
}
