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

test('カンマが行に入った時点で発火しない', () => {
  assert.equal(extract('#細めた,|'), null)
})

test('カッコはクエリに含める（ラベル自体がカッコを含むため）', () => {
  assert.deepEqual(extract('#マリー(体操服|'), {
    lineStart: 0,
    lineEnd: 8,
    query: 'マリー(体操服',
  })
  assert.deepEqual(extract('#マリー（体操服|'), {
    lineStart: 0,
    lineEnd: 8,
    query: 'マリー（体操服',
  })
  assert.deepEqual(extract('#マリー(体操服)|'), {
    lineStart: 0,
    lineEnd: 9,
    query: 'マリー(体操服)',
  })
})

test('カンマを消しただけの既存コメント行はクエリになる（候補が無ければ閉じる）', () => {
  assert.deepEqual(extract('# 20_目の状態 (細めた目)|'), {
    lineStart: 0,
    lineEnd: 16,
    query: ' 20_目の状態 (細めた目)',
  })
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

// 行末インデックス（改行の位置、無ければ末尾）を求める
const lineEndOf = (value, lineStart) => {
  const index = value.indexOf('\n', lineStart)
  return index === -1 ? value.length : index
}

// コメント行の開始位置を指定して extendToTagLine を呼ぶ
const extendFrom = (value, lineStart) =>
  ETSCompletion.extendToTagLine(value, lineStart, lineEndOf(value, lineStart))

test('コメント行に続くタグ行を置換範囲に含める', () => {
  const value = '#細めた\nnarrowed eyes,\nblush,'

  // タグ行 1 行だけを飲み込み、その先の行は残す
  assert.equal(extendFrom(value, 0), value.indexOf('\nblush,'))
})

test('次の行がコメント行なら置換範囲を広げない', () => {
  const value = '#細めた\n# 30_ポーズ (立ち),\nstanding,'

  assert.equal(extendFrom(value, 0), lineEndOf(value, 0))
})

test('次の行が空行・空白のみなら置換範囲を広げない', () => {
  const blank = '#細めた\n\nblush,'
  assert.equal(extendFrom(blank, 0), lineEndOf(blank, 0))

  const spaces = '#細めた\n   \nblush,'
  assert.equal(extendFrom(spaces, 0), lineEndOf(spaces, 0))
})

test('末尾行・改行で終わるテキストでは置換範囲を広げない', () => {
  const value = '1girl,\n#細めた'
  assert.equal(extendFrom(value, value.indexOf('#')), value.length)

  const trailing = '#細めた\n'
  assert.equal(extendFrom(trailing, 0), lineEndOf(trailing, 0))
})

test('直前がコメント行なら置換範囲を広げない（挿入された行とみなす）', () => {
  // 既存セクションのコメント行直後に改行して打った状況。
  // 次行 narrowed eyes, は前のセクションのタグなので飲み込んではいけない
  const value = '# 20_目の状態 (細めた目),\n#立ち\nnarrowed eyes,'
  const lineStart = value.indexOf('#立ち')

  assert.equal(extendFrom(value, lineStart), lineEndOf(value, lineStart))
})

test('タグ行まで含めて置換すると古いタグが残らない', () => {
  const value = '1girl,\n# 20_目の状態 (見開いた目),\nwide-eyed,\nblush,'
  const lineStart = value.indexOf('# 20_')
  const section = '# 20_目の状態 (細めた目),\nnarrowed eyes,'

  const range = { lineStart, lineEnd: extendFrom(value, lineStart) }
  const result = ETSCompletion.buildReplacement(value, range, section)

  assert.equal(result.value, `1girl,\n${section}\nblush,`)
  assert.equal(result.value.includes('wide-eyed'), false)
})
