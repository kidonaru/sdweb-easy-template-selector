// ETSCompletion の DOM 非依存部分（トリガ判定・行置換）の単体テスト
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../javascript/ets_completion.js', import.meta.url), 'utf8')
const ETSCompletion = new Function(`${src}\nreturn ETSCompletion`)()

// カーソル位置を | で表した文字列からテキストとキャレット位置を作る
const at = (text) => ({ value: text.replace('|', ''), caret: text.indexOf('|') })

const extract = (text) => {
  const { value, caret } = at(text)
  return ETSCompletion.extractQuery(value, caret)
}

test('行頭 # に続く入力を拾う', () => {
  assert.deepEqual(extract('#細めた|'), { lineStart: 0, lineEnd: 4, query: '細めた' })
})

test('複数行のとき、カーソル行だけを見る', () => {
  assert.deepEqual(extract('1girl,solo,\n#細めた|\nblush,'), {
    lineStart: 12,
    lineEnd: 16,
    query: '細めた',
  })
})

test('# で始まらない行では発火しない', () => {
  assert.equal(extract('細めた|'), null)
  assert.equal(extract('1girl, #細めた|'), null)
})

test('既存のコメント行では発火しない', () => {
  assert.equal(extract('# 20_目|の状態 (細めた目),'), null)
  assert.equal(extract('# 20_目の状態 (細めた目),|'), null)
})

test('カンマ・カッコが行に入った時点で発火しない', () => {
  assert.equal(extract('#細めた,|'), null)
  assert.equal(extract('#細めた(|'), null)
  assert.equal(extract('#細め|た)'), null)
})

test('クエリが空なら発火しない', () => {
  assert.equal(extract('#|'), null)
  assert.equal(extract('|#細めた'), null)
})

test('カーソルより後ろの文字はクエリに含めない', () => {
  assert.deepEqual(extract('#細め|た'), { lineStart: 0, lineEnd: 4, query: '細め' })
})

test('行置換はカーソル行だけを差し替え、キャレットを末尾に置く', () => {
  const value = '1girl,solo,\n#細めた\nblush,'
  const range = { lineStart: 12, lineEnd: 16 }
  const section = '# 20_目の状態 (細めた目),\nnarrowed eyes,'

  const result = ETSCompletion.buildReplacement(value, range, section)

  assert.equal(result.value, `1girl,solo,\n${section}\nblush,`)
  assert.equal(result.caret, 12 + section.length)
  assert.equal(result.value.slice(result.caret), '\nblush,')
})

test('行置換は末尾行でも動く', () => {
  const result = ETSCompletion.buildReplacement('#細めた', { lineStart: 0, lineEnd: 4 }, 'X,\nY,')

  assert.equal(result.value, 'X,\nY,')
  assert.equal(result.caret, 5)
})
