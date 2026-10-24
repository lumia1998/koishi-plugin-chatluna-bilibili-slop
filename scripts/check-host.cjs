const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const { mkdtempSync, realpathSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve, dirname, basename } = require('node:path')

async function main() {
    const host = createRequire(join(resolve(process.argv[2]), 'package.json'))
    host('koishi-plugin-chatluna')
    const { PlatformService } = host('koishi-plugin-chatluna/llm-core/platform/service')
    const plugin = process.argv.includes('--installed') ? host('koishi-plugin-chatluna-bilibili-slop') : require('../lib/index.cjs')
    const root = realpathSync(tmpdir())
    const dir = realpathSync(mkdtempSync(join(root, 'bili-host-check-')))
    const ready = []
    const methods = ['getVideoSubtitle', 'getVideoComments', 'getUserVideos', 'getRelatedVideos', 'createVideoComment', 'getCommentVisibility', 'searchUsers', 'searchUsersByName', 'getVideoInfo', 'getVideoConclusion', 'getUserInfo', 'followUser', 'unfollowUser', 'isFollowing', 'sendComment']
    const cmd = { action: () => cmd }
    const ctx = {
        baseDir: dir,
        bots: [{ platform: 'bilibili', selfId: '42', internal: Object.fromEntries([
            ...methods.map((name) => [name, async () => []]), ['searchVideos', async () => []]
        ]) }],
        on: (event, fn) => { if (event === 'ready') ready.push(fn) },
        emit: () => {}, effect: (fn) => fn(), command: () => cmd,
        logger: () => ({ warn: () => {} })
    }
    ctx.chatluna = { platform: new PlatformService(ctx) }
    const options = { configurable: { session: {
        platform: 'test', selfId: 'bot', channelId: 'check', userId: 'owner',
        observeUser: async () => ({ authority: 3 })
    } } }
    const call = async (name, input) => JSON.parse(await ctx.chatluna.platform.getTool(name).createTool({}).invoke(input, options))
    try {
        await plugin.apply(ctx, plugin.Config({}))
        for (const fn of ready) await fn()
        assert.equal(ctx.chatluna.platform.getTools().value.length, 7)
        assert.equal((await call('bili_status', {})).ok, true)
        assert.equal((await call('bili_find_slop', { keywords: ['test'], ups: [] })).ok, true)
        console.log(`ChatLuna ${host('koishi-plugin-chatluna/package.json').version}: 7 default tools and empty slop scan passed`)
    } finally {
        if (dirname(dir) !== root || !basename(dir).startsWith('bili-host-check-')) throw new Error('Unexpected temporary directory')
        rmSync(dir, { recursive: true, force: true })
    }
}
main().catch((err) => { console.error(err); process.exitCode = 1 })
