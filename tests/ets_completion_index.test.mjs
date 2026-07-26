// ETSCompletionIndex の単体テスト
// javascript/ 配下はブラウザ向けの素のスクリプトなので、
// ファイルを読んで new Function で評価しクラスを取り出す
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../javascript/ets_completion_index.js', import.meta.url), 'utf8')
const ETSCompletionIndex = new Function(`${src}\nreturn ETSCompletionIndex`)()

const TAGS = {
  '00_テンプレート': { 'サンプルテンプレ': 'template body' },
  '01_クオリティ': {
    'Model': { 'Nova Anime XL': 'masterpiece, best quality' },
    '基本': 'high resolution',
  },
  '20_目の状態': {
    '細めた目': 'narrowed eyes',
    '細めた目2': 'squinting',
    'ジト目': 'jitome',
  },
  '10_キャラ_ブルアカ': {
    'トリニティ': { 'マリー': 'mari \\(blue archive\\)' },
  },
  '90_モデル': { 'Nova Anime XL': 'nova.safetensors' },
  '96_解像度': { '縦長': '832x1216' },
  '99_ネガティブ': { '低品質': 'worst quality' },
}

test('除外カテゴリは平坦化の時点で落ちる', () => {
  const categories = ETSCompletionIndex.flatten(TAGS).map((e) => e.category)

  assert.ok(!categories.some((c) => c.startsWith('00_テンプレート')))
  assert.ok(!categories.some((c) => c.startsWith('90_モデル')))
  assert.ok(!categories.some((c) => c.startsWith('96_解像度')))
  assert.ok(categories.includes('20_目の状態'))
})

test('除外グループ（Model）は落ちるが、同じカテゴリの他のグループは残る', () => {
  const entries = ETSCompletionIndex.flatten(TAGS)

  assert.ok(!entries.some((e) => e.category === '01_クオリティ:Model'))
  assert.ok(entries.some((e) => e.comment === '基本' && e.category === '01_クオリティ'))
})

test('文字列の値はそのままエントリになる', () => {
  const entries = ETSCompletionIndex.flatten(TAGS)

  assert.deepEqual(
    entries.find((e) => e.comment === '細めた目'),
    { comment: '細めた目', tag: 'narrowed eyes', category: '20_目の状態' }
  )
})

test('カテゴリ直下とグループ直下のランダムエントリが作られる', () => {
  const entries = ETSCompletionIndex.flatten(TAGS)

  assert.deepEqual(
    entries.find((e) => e.comment === '20_目の状態'),
    { comment: '20_目の状態', tag: '@20_目の状態@', category: '20_目の状態' }
  )
  assert.deepEqual(
    entries.find((e) => e.comment === 'トリニティ'),
    { comment: 'トリニティ', tag: '@10_キャラ_ブルアカ:トリニティ@', category: '10_キャラ_ブルアカ:トリニティ' }
  )
})

test('ネストしたグループはカテゴリが連結される', () => {
  const entries = ETSCompletionIndex.flatten(TAGS)

  assert.deepEqual(
    entries.find((e) => e.comment === 'マリー'),
    { comment: 'マリー', tag: 'mari \\(blue archive\\)', category: '10_キャラ_ブルアカ:トリニティ' }
  )
})

test('配列の値はラベルとタグが同一のエントリになる', () => {
  const entries = ETSCompletionIndex.flatten({ '65_その他': ['solo', 'duo'] })

  assert.deepEqual(entries, [
    { comment: '65_その他', tag: '@65_その他@', category: '65_その他' },
    { comment: 'solo', tag: 'solo', category: '65_その他' },
    { comment: 'duo', tag: 'duo', category: '65_その他' },
  ])
})

test('positive 検索ではネガティブカテゴリが出ない', () => {
  const index = new ETSCompletionIndex(TAGS)

  assert.deepEqual(index.search('低品質', 'positive'), [])
})

test('negative 検索ではネガティブカテゴリのみ出る', () => {
  const index = new ETSCompletionIndex(TAGS)

  assert.deepEqual(index.search('低品質', 'negative').map((e) => e.comment), ['低品質'])
  assert.deepEqual(index.search('細めた目', 'negative'), [])
})

test('ラベル前方一致がタグ一致より上位に来る', () => {
  const index = new ETSCompletionIndex({
    '20_目の状態': { '細めた目': 'narrowed eyes' },
    '65_その他': { 'なにか': '細めた目っぽいもの' },
  })

  const result = index.search('細めた目', 'positive')
  assert.equal(result[0].comment, '細めた目')
  assert.equal(result[1].comment, 'なにか')
})

test('英語タグとカテゴリ名でも引ける', () => {
  const index = new ETSCompletionIndex(TAGS)

  assert.ok(index.search('narrowed', 'positive').some((e) => e.comment === '細めた目'))
  assert.ok(index.search('20_目', 'positive').some((e) => e.comment === 'ジト目'))
  assert.ok(index.search('トリニティ', 'positive').some((e) => e.comment === 'マリー'))
})

test('大文字小文字を区別しない', () => {
  const index = new ETSCompletionIndex(TAGS)

  assert.ok(index.search('NARROWED', 'positive').some((e) => e.comment === '細めた目'))
})

test('空クエリは候補なし', () => {
  const index = new ETSCompletionIndex(TAGS)

  assert.deepEqual(index.search('', 'positive'), [])
  assert.deepEqual(index.search('   ', 'positive'), [])
})

test('候補は MAX_RESULTS 件で打ち切られる', () => {
  const many = {}
  for (let i = 0; i < 50; i++) {
    many[`目${i}`] = `eyes ${i}`
  }
  const index = new ETSCompletionIndex({ '20_目の状態': many })

  assert.equal(index.search('目', 'positive').length, ETSCompletionIndex.MAX_RESULTS)
})

test('タグが空でも例外にならない', () => {
  const index = new ETSCompletionIndex({})

  assert.deepEqual(index.search('目', 'positive'), [])
  assert.deepEqual(ETSCompletionIndex.flatten(undefined), [])
})

test('全角カッコのクエリでも半角カッコのラベルに一致する', () => {
  const index = new ETSCompletionIndex({
    '10_キャラ': { 'ブルアカ': { 'マリー(体操服)': 'mari, gym uniform' } },
  })

  assert.deepEqual(index.search('マリー（体操服', 'positive').map((e) => e.comment), ['マリー(体操服)'])
  assert.deepEqual(index.search('マリー(体操服', 'positive').map((e) => e.comment), ['マリー(体操服)'])
})

test('全角英数のクエリでも半角のタグに一致する', () => {
  const index = new ETSCompletionIndex({ '65_その他': { 'ソロ': 'solo' } })

  assert.deepEqual(index.search('ｓｏｌｏ', 'positive').map((e) => e.comment), ['ソロ'])
})
