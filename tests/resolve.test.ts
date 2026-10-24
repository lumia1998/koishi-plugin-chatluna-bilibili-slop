import assert from 'node:assert/strict'
import { test } from 'node:test'
import { av2bv, bv2av, extractBv, resolveShortLink, resolveVideo } from '../src/resolve.js'

test('BV 提取：裸 BV、URL 内 BV、av 号与 av URL', () => {
    assert.equal(extractBv('BV17x411w7KC'), 'BV17x411w7KC')
    assert.equal(extractBv('看看这个 https://www.bilibili.com/video/BV17x411w7KC/?spm_id_from=1'), 'BV17x411w7KC')
    assert.equal(extractBv('av170001'), 'BV17x411w7KC')
    assert.equal(extractBv('AV170001'), 'BV17x411w7KC')
    assert.equal(extractBv('https://www.bilibili.com/video/av170001'), 'BV17x411w7KC')
    assert.equal(extractBv('随便什么文本'), undefined)
})

test('av 与 BV 双向转换符合公开测试向量', () => {
    assert.equal(av2bv(170001n), 'BV17x411w7KC')
    assert.equal(bv2av('BV17x411w7KC'), 170001n)
    assert.equal(bv2av(av2bv(882584971n)), 882584971n)
    assert.equal(bv2av(av2bv(10492n)), 10492n)
    // 2020 年后的新视频 av 号超过 2^32，必须走 51 位算法
    assert.equal(av2bv(111298867365120n), 'BV1L9Uoa9EUx')
    assert.equal(bv2av('BV1L9Uoa9EUx'), 111298867365120n)
    assert.equal(av2bv(2n), 'BV1xx411c7mD')
    assert.throws(() => av2bv(0n), /av/)
})

function fetchThat(locations: Record<string, string | [number, string | undefined]>) {
    return async (url: string) => {
        const target = locations[url]
        if (Array.isArray(target)) {
            const headers = { get: (name: string) => name === 'location' ? (target[1] ?? null) : null }
            return { status: target[0], headers }
        }
        if (typeof target === 'string') {
            return { status: 302, headers: { get: (name: string) => name === 'location' ? target : null } }
        }
        throw new Error(`unexpected fetch ${url}`)
    }
}

test('b23.tv 短链跟随 Location 提取 BV；非 B站跳转被拒绝', async () => {
    const fetcher = fetchThat({
        'https://b23.tv/abc': 'https://www.bilibili.com/video/BV17x411w7KC?spm=1'
    })
    assert.equal(await resolveShortLink('https://b23.tv/abc', fetcher), 'BV17x411w7KC')

    const hops = fetchThat({
        'https://b23.tv/two': 'https://b23.tv/three',
        'https://b23.tv/three': 'https://www.bilibili.com/video/av170001'
    })
    assert.equal(await resolveShortLink('https://b23.tv/two', hops), 'BV17x411w7KC')

    const evil = fetchThat({
        'https://b23.tv/evil': 'https://evil.example.com/steal'
    })
    await assert.rejects(resolveShortLink('https://b23.tv/evil', evil), /非 B站域名/)

    // URLs whose text already contains a BV/av are used without any request;
    // only links that carry no recognizable id are refused.
    assert.equal(await resolveVideo('https://evil.example.com/BV17x411w7KC'), 'BV17x411w7KC')
    await assert.rejects(resolveVideo('https://evil.example.com/watch?v=1'), /无法识别视频/)
    await assert.rejects(resolveVideo('什么东西都不是'), /无法识别视频/)
})

test('短链解析失败给出清楚错误', async () => {
    const dead = fetchThat({ 'https://b23.tv/none': [200, undefined] })
    await assert.rejects(resolveVideo('https://b23.tv/none', dead), /短链未返回跳转地址|无法识别视频/)
    const tooMany = fetchThat({
        'https://b23.tv/a': 'https://b23.tv/b',
        'https://b23.tv/b': 'https://b23.tv/c',
        'https://b23.tv/c': 'https://b23.tv/d'
    })
    await assert.rejects(resolveShortLink('https://b23.tv/a', tooMany), /跳转次数过多/)
})
