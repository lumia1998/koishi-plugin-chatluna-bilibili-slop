import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { AuthStore, correspondPath, pickCookies, refreshCredential, type Credential } from '../src/auth.js'

function headersOf(...values: string[]) {
    const headers = new Headers()
    for (const value of values) headers.append('set-cookie', value)
    return headers
}

test('pickCookies 只收登录相关的几个 cookie，忽略其它属性', () => {
    const jar = pickCookies(headersOf(
        'SESSDATA=abc%2C123; Path=/; Domain=bilibili.com; HttpOnly; Secure',
        'bili_jct=def; Path=/',
        'DedeUserID=42; Path=/',
        'DedeUserID__ckMd5=xyz; Path=/',
        'sid=s1; Path=/',
        'buvid3=b3value; Path=/',
        'bogus=1; Path=/',
    ))
    assert.deepEqual(jar, {
        SESSDATA: 'abc%2C123',
        bili_jct: 'def',
        DedeUserID: '42',
        DedeUserID__ckMd5: 'xyz',
        sid: 's1',
        buvid3: 'b3value',
    })
})

test('pickCookies 对空头返回空对象', () => {
    assert.deepEqual(pickCookies(new Headers()), {})
})

test('correspondPath 是 1024 位 RSA 的十六进制密文', () => {
    const path = correspondPath(1700000000000)
    assert.match(path, /^[0-9a-f]+$/)
    assert.equal(path.length, 256)
    assert.notEqual(correspondPath(1), correspondPath(2))
})

test('AuthStore 落盘后可读回，logout 清空', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bili-auth-'))
    try {
        const store = new AuthStore(dir)
        await store.load()
        assert.equal(store.loggedIn, false)

        const credential: Credential = {
            version: 1,
            mid: '42',
            cookies: { SESSDATA: 's', bili_jct: 'j', DedeUserID: '42' },
            refreshToken: 'rt',
            obtainedAt: 1,
        }
        await store.save(credential)
        assert.equal(store.loggedIn, true)
        assert.equal(store.selfId, '42')
        assert.equal(store.csrf, 'j')

        const raw = JSON.parse(await readFile(store.file, 'utf8')) as Credential
        assert.equal(raw.refreshToken, 'rt')

        const again = new AuthStore(dir)
        await again.load()
        assert.equal(again.selfId, '42')
        assert.deepEqual(again.cookies, credential.cookies)

        await again.clear()
        assert.equal(again.loggedIn, false)
    } finally { await rm(dir, { recursive: true, force: true }) }
})

test('merge 只更新变化的 cookie', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bili-merge-'))
    try {
        const store = new AuthStore(dir)
        await store.save({
            version: 1, mid: '42',
            cookies: { SESSDATA: 'old', bili_jct: 'j' },
            refreshToken: '', obtainedAt: 1,
        })
        await store.merge({ SESSDATA: 'new', extra: 'x' })
        assert.equal(store.cookies.SESSDATA, 'new')
        assert.equal(store.cookies.extra, 'x')
        assert.equal(store.csrf, 'j')
    } finally { await rm(dir, { recursive: true, force: true }) }
})

test('没有 refresh_token 时不会尝试刷新', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bili-refresh-'))
    try {
        const store = new AuthStore(dir)
        await store.save({
            version: 1, mid: '42',
            cookies: { SESSDATA: 's', bili_jct: 'j' },
            refreshToken: '', obtainedAt: 1,
        })
        assert.equal(await refreshCredential(store), false)
    } finally { await rm(dir, { recursive: true, force: true }) }
})
