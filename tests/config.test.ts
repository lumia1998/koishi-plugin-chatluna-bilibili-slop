import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Config } from '../src/config.js'
import { DEFAULT_KEYWORDS, DEFAULT_TARGET_AUTHORS, defaultSettings } from '../src/settings.js'

test('ChatLuna 原生配置页为空 Schema：不再有任何可配置项', () => {
    const cfg = Config({}) as Record<string, unknown>
    assert.deepEqual(Object.keys(cfg), [])
    assert.match(String((Config as unknown as { meta?: { description?: string } }).meta?.description || ''), /控制台/)
})

test('默认配置与面板默认值一致：赤石词表留空、作者名单有内置值', () => {
    const cfg = defaultSettings()
    assert.deepEqual(cfg.keywords, [], '留空时由 scout 用内置词表兜底')
    assert.deepEqual(cfg.targetAuthors, DEFAULT_TARGET_AUTHORS)
    assert.ok(DEFAULT_KEYWORDS.length > 0)
})
