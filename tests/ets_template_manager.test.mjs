// ETSTemplateManager の DOM 非依存部分（パラメータ行の加工）の単体テスト
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const managerSrc = readFileSync(new URL('../javascript/ets_template_manager.js', import.meta.url), 'utf8')
const { ETSTemplateManager } = new Function(
  `${managerSrc}\nreturn { ETSTemplateManager }`
)()

test('パラメータ行から Seed 項目を取り除く', () => {
  const input = 'prompt text\nSteps: 25, CFG Scale: 6, Seed: 1095942052, Size: 832x1216,'
  const expected = 'prompt text\nSteps: 25, CFG Scale: 6, Size: 832x1216,'
  assert.equal(ETSTemplateManager.stripSeedParam(input), expected)
})

test('Seed が無いテンプレはそのまま返す', () => {
  const input = 'prompt text\nSteps: 25, CFG Scale: 6,'
  assert.equal(ETSTemplateManager.stripSeedParam(input), input)
})

test('プロンプト行の Seed: で始まる行は触らない', () => {
  const input = 'Seed: not a param line\nSteps: 25, Seed: 42,'
  const expected = 'Seed: not a param line\nSteps: 25,'
  assert.equal(ETSTemplateManager.stripSeedParam(input), expected)
})

test('CRLF の改行を保持する', () => {
  const input = 'prompt\r\nSteps: 25, Seed: 42, CFG Scale: 6,\r\n'
  const expected = 'prompt\r\nSteps: 25, CFG Scale: 6,\r\n'
  assert.equal(ETSTemplateManager.stripSeedParam(input), expected)
})

test('キー名が Seed で終わる別項目は残す', () => {
  const input = 'Steps: 25, Variation seed: 7, Seed: 42,'
  const expected = 'Steps: 25, Variation seed: 7,'
  assert.equal(ETSTemplateManager.stripSeedParam(input), expected)
})
