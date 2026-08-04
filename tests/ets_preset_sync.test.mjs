// ETSPresetSync の DOM 非依存部分（UI Preset → プロファイルの対応規則）の単体テスト
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../javascript/ets_preset_sync.js', import.meta.url), 'utf8')
const { ETSPresetSync } = new Function(`${src}\nreturn { ETSPresetSync }`)()

const PROFILES = ['illustrious', 'anima']

test('Preset と同名のプロファイルがあればそれを選ぶ', () => {
  assert.equal(ETSPresetSync.resolveProfile('anima', PROFILES, 'illustrious'), 'anima')
})

test('同名のプロファイルが無い Preset は既定へ戻す', () => {
  assert.equal(ETSPresetSync.resolveProfile('xl', PROFILES, 'illustrious'), 'illustrious')
  assert.equal(ETSPresetSync.resolveProfile('flux', PROFILES, 'illustrious'), 'illustrious')
})

test('Preset が取れないときは null（＝何もしない）', () => {
  assert.equal(ETSPresetSync.resolveProfile(null, PROFILES, 'illustrious'), null)
  assert.equal(ETSPresetSync.resolveProfile('', PROFILES, 'illustrious'), null)
})
