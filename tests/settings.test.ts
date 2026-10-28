import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
    DEFAULT_KEYWORDS, DEFAULT_TARGET_AUTHORS, defaultSettings, normalize, SettingsStore,
} from '../src/settings.js'

test('默认值：三种发布方式里只开群推送，三个互动开关全关', () => {
    const cfg = defaultSettings()
    assert.equal(cfg.publishComment, false)
    assert.equal(cfg.publishDm, false)
    assert.equal(cfg.publishGroup, true)
    assert.equal(cfg.allowComment, false)
    assert.equal(cfg.allowReplyRoot, false)
    assert.equal(cfg.allowReplySub, false)
    assert.equal(cfg.commentPerHour, 10)
    assert.equal(cfg.perRun, 3)
    assert.equal(cfg.preferSubtitle, true)
    assert.equal(cfg.transcribe, false)
    assert.equal(cfg.summaryModel, '', '默认不挂模型，日报只列清单')
    assert.deepEqual(cfg.keywords, [])
    assert.deepEqual(cfg.targetAuthors, DEFAULT_TARGET_AUTHORS)
    assert.deepEqual(cfg.channels, [])
    assert.deepEqual(cfg.mentionUids, [])
})

test('normalize 丢弃未知键，并按目标类型归一', () => {
    const cfg = normalize({
        ownerUid: 12345, keywords: [' 赤石 ', '', 42, '抽象'],
        publishGroup: 'false', commentPerHour: '999', perRun: -3,
        channels: ['onebot:123456', 'bad', 'qq:group1'],
        pushTimes: ['12:00', '25:00', 'abc', '9:05'],
        unknownKey: 'should be dropped',
    })
    assert.equal(cfg.ownerUid, '12345')
    assert.deepEqual(cfg.keywords, ['赤石', '抽象'])
    assert.equal(cfg.publishGroup, false)
    assert.equal(cfg.commentPerHour, 30) // 钳到上限
    assert.equal(cfg.perRun, 1)         // 钳到下限
    assert.deepEqual(cfg.channels, ['onebot:123456', 'qq:group1'])
    assert.deepEqual(cfg.pushTimes, ['12:00', '9:05'])
    assert.equal('unknownKey' in cfg, false)
})

test('normalize：日报模型只接受 platform/name 全名', () => {
    assert.equal(normalize({ summaryModel: 'openai/gpt-4o' }).summaryModel, 'openai/gpt-4o')
    // 半截名字加载不了模型，当作没配
    assert.equal(normalize({ summaryModel: 'gpt-4o' }).summaryModel, '')
    assert.equal(normalize({ summaryModel: ' aws claude/x' }).summaryModel, '')
    assert.equal(normalize({ summaryModel: 'not-a-model' }).summaryModel, '')
    assert.equal(normalize({ summaryModel: 42 }).summaryModel, '')
})

test('normalize 对非对象输入返回默认值', () => {
    assert.deepEqual(normalize(null), defaultSettings())
    assert.deepEqual(normalize('string'), defaultSettings())
    assert.deepEqual(normalize(undefined), defaultSettings())
})

test('SettingsStore：首次启动写默认值，update 落盘并可重新读回', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bili-settings-'))
    try {
        const store = new SettingsStore(dir)
        assert.deepEqual(await store.init(), defaultSettings())

        const next = await store.update({ ownerUid: '99', allowComment: true, channels: ['onebot:1'] })
        assert.equal(next.ownerUid, '99')
        assert.equal(next.allowComment, true)
        assert.deepEqual(next.channels, ['onebot:1'])

        const raw = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))
        assert.equal(raw.ownerUid, '99')

        const again = new SettingsStore(dir)
        assert.deepEqual(await again.init(), next)
    } finally { await rm(dir, { recursive: true, force: true }) }
})

test('SettingsStore：损坏的 settings.json 退回默认值而不是抛错', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bili-settings-'))
    try {
        await import('node:fs/promises').then((fs) => fs.writeFile(join(dir, 'settings.json'), '{bad json'))
        const store = new SettingsStore(dir)
        assert.deepEqual(await store.init(), defaultSettings())
    } finally { await rm(dir, { recursive: true, force: true }) }
})

test('内置词表与默认作者名单非空', () => {
    assert.ok(DEFAULT_KEYWORDS.length > 0)
    assert.ok(DEFAULT_TARGET_AUTHORS.length > 0)
    assert.ok(DEFAULT_KEYWORDS.every((word) => typeof word === 'string' && word.length > 0))
})
