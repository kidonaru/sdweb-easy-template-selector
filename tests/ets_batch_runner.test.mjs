// ETSBatchRunner の DOM 非依存部分（帯判定・抽選・帯単位の差し替え）の単体テスト
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// ets_batch_runner.js は実行時に ETSSection / ETSPromptEditor を参照するので、先に評価しておく
const sectionSrc = readFileSync(new URL('../javascript/ets_section.js', import.meta.url), 'utf8')
const editorSrc = readFileSync(new URL('../javascript/ets_prompt_editor.js', import.meta.url), 'utf8')
const runnerSrc = readFileSync(new URL('../javascript/ets_batch_runner.js', import.meta.url), 'utf8')
const { ETSPromptEditor, ETSBatchRunner } = new Function(
  `${sectionSrc}\n${editorSrc}\n${runnerSrc}\nreturn { ETSPromptEditor, ETSBatchRunner }`
)()

// DOM を触らないメソッドだけを使うので、依存はダミーで良い
const editor = new ETSPromptEditor({ ids: {}, history: null, templateManager: null })

const HOSHINO = '# 10_キャラ_ブルアカ:アビドス (ホシノ),\nhoshino \\(blue archive\\),pink hair,halo,'
const KAZUSA = '# 10_キャラ_ブルアカ:トリニティ (カズサ),\nkazusa \\(blue archive\\),red eyes,black hair,'
const SERAFUKU = '# 13_衣装_基本 (セーラー服),\nserafuku,'
const TAISOFUKU = '# 13_衣装_基本 (体操服),\ngym uniform,'

const TEMPLATE_PROMPT = [
  '# 01_クオリティ:Model (Nova Anime XL v6.0),',
  'masterpiece, best quality,',
  '# 02_対象 (一人の女の子(強調)),',
  '1girl,solo,',
  '# 10_キャラ_ブルアカ:トリニティ (カズサ),',
  'kazusa \\(blue archive\\),red eyes,black hair,',
  '# 50_背景_基本:基本 (屋外),',
  'outdoors,',
  '# 15_衣装状態_基本 (はだけた服),',
  'open clothes,',
  '# 23_表情:基本 (笑う),',
  'smile,',
].join('\n')

test('bandOf はカテゴリ先頭の番号を帯として返す', () => {
  assert.equal(ETSBatchRunner.bandOf('10_キャラ_ブルアカ:トリニティ'), '10')
  assert.equal(ETSBatchRunner.bandOf('15_衣装状態_基本'), '15')
  // 同じ番号のファイルは同じ帯にまとまる
  assert.equal(ETSBatchRunner.bandOf('10_キャラ'), ETSBatchRunner.bandOf('10_キャラ_LoRA'))
})

test('bandOf はキャラ/衣装以外のカテゴリも対象にする', () => {
  assert.equal(ETSBatchRunner.bandOf('50_背景_基本:基本'), '50')
  assert.equal(ETSBatchRunner.bandOf('01_クオリティ:Model'), '01')
  assert.equal(ETSBatchRunner.bandOf('23_表情:基本'), '23')
})

test('bandOf はテンプレ本体と 90 番台以降を対象外にする', () => {
  assert.equal(ETSBatchRunner.bandOf('00_テンプレート:01_SFW'), null)
  assert.equal(ETSBatchRunner.bandOf('90_モデル'), null)
  assert.equal(ETSBatchRunner.bandOf('96_解像度'), null)
  assert.equal(ETSBatchRunner.bandOf('97_Color'), null)
  assert.equal(ETSBatchRunner.bandOf('99_ネガティブ:Model'), null)
})

test('bandOf は番号で始まらないカテゴリと null を対象外にする', () => {
  assert.equal(ETSBatchRunner.bandOf('カスタム'), null)
  assert.equal(ETSBatchRunner.bandOf(null), null)
})

test('groupByBand は帯ごとにセクションをまとめる', () => {
  const pools = ETSBatchRunner.groupByBand(editor, [HOSHINO, KAZUSA, SERAFUKU])
  assert.deepEqual(Array.from(pools.keys()), ['10', '13'])
  assert.equal(pools.get('10').length, 2)
  assert.equal(pools.get('13').length, 1)
})

test('groupByBand はコメント行なしのセクションを捨てる', () => {
  const pools = ETSBatchRunner.groupByBand(editor, ['red theme,', HOSHINO])
  assert.deepEqual(Array.from(pools.keys()), ['10'])
})

test('pickSwapSections は帯ごとに 1 件ずつ引く（乱数は注入する）', () => {
  const pools = ETSBatchRunner.groupByBand(editor, [HOSHINO, KAZUSA, SERAFUKU, TAISOFUKU])
  // 常に 0 番目を引く乱数源
  const picked = ETSBatchRunner.pickSwapSections(pools, () => 0)
  assert.equal(picked.size, 2)
  assert.equal(picked.get('10'), HOSHINO)
  assert.equal(picked.get('13'), SERAFUKU)

  // 常に末尾を引く乱数源（Math.random は 1 を返さないので 0.999 で代用）
  const pickedLast = ETSBatchRunner.pickSwapSections(pools, () => 0.999)
  assert.equal(pickedLast.get('10'), KAZUSA)
  assert.equal(pickedLast.get('13'), TAISOFUKU)
})

test('pickSwapSections は空のプールから空の Map を返す', () => {
  assert.equal(ETSBatchRunner.pickSwapSections(new Map()).size, 0)
})

test('applicableSections はテンプレに存在する帯の抽選結果だけを返す', () => {
  const pools = ETSBatchRunner.groupByBand(editor, [HOSHINO, SERAFUKU])
  const picked = ETSBatchRunner.pickSwapSections(pools, () => 0)
  // テンプレは 10_キャラ と 15_衣装状態 を持つが 13_衣装 は持たない
  const applicable = ETSBatchRunner.applicableSections(editor, TEMPLATE_PROMPT, picked)
  assert.deepEqual(applicable, [HOSHINO])
})

test('swapSections はテンプレに存在する帯だけを置換し、存在しない帯は挿入しない', () => {
  const pools = ETSBatchRunner.groupByBand(editor, [HOSHINO, SERAFUKU])
  const picked = ETSBatchRunner.pickSwapSections(pools, () => 0)
  const result = ETSBatchRunner.swapSections(editor, TEMPLATE_PROMPT, picked)

  // 10_キャラ はホシノに置き換わる
  assert.match(result, /アビドス \(ホシノ\)/)
  assert.doesNotMatch(result, /カズサ/)
  // テンプレに 13_衣装 のセクションが無いのでセーラー服は入らない
  assert.doesNotMatch(result, /セーラー服/)
  // 選択していない 15_衣装状態 はテンプレの値が残る
  assert.match(result, /open clothes,/)
  // 非対象セクションは維持される
  assert.match(result, /outdoors,/)
  assert.match(result, /smile,/)
})

test('swapSections は置換後も帯の出現位置を保つ', () => {
  const pools = ETSBatchRunner.groupByBand(editor, [HOSHINO])
  const picked = ETSBatchRunner.pickSwapSections(pools, () => 0)
  const lines = ETSBatchRunner.swapSections(editor, TEMPLATE_PROMPT, picked).split('\n')
  // 元のカズサのセクションは 5 行目（添字 4）から始まる
  assert.equal(lines[4], '# 10_キャラ_ブルアカ:アビドス (ホシノ),')
})

test('swapSections は同じ帯の最初の 1 件だけ置換し、2 件目以降はそのまま残す', () => {
  const prompt = [
    '# 10_キャラ_ブルアカ:トリニティ (カズサ),',
    'kazusa \\(blue archive\\),',
    '# 50_背景_基本:基本 (屋外),',
    'outdoors,',
    '# 10_キャラ_ブルアカ:アビドス (シロコ),',
    'shiroko \\(blue archive\\),',
  ].join('\n')
  const pools = ETSBatchRunner.groupByBand(editor, [HOSHINO])
  const picked = ETSBatchRunner.pickSwapSections(pools, () => 0)
  const result = ETSBatchRunner.swapSections(editor, prompt, picked)

  // 最初の 1 件だけホシノに置き換わる
  assert.match(result, /ホシノ/)
  assert.doesNotMatch(result, /カズサ/)
  // 2 件目以降はテンプレの記述として残す（消すとポーズや状況の描写が欠落するため）
  assert.match(result, /シロコ/)
  assert.match(result, /outdoors,/)
})

test('swapSections は同じ帯が並ぶテンプレのセクション数を変えない', () => {
  const prompt = [
    '# 33_状況:精液 (射精),',
    'ejaculation,',
    '# 33_状況:精液 (顔射),',
    'facial,',
    '# 33_状況:精液 (精液が滴る),',
    'cum drip,',
  ].join('\n')
  const pools = ETSBatchRunner.groupByBand(editor, ['# 33_状況:精液 (ぶっかけ),\nbukkake,'])
  const picked = ETSBatchRunner.pickSwapSections(pools, () => 0)
  const result = ETSBatchRunner.swapSections(editor, prompt, picked)

  assert.equal(result.split('\n').length, prompt.split('\n').length)
  assert.match(result, /ぶっかけ/)
  assert.doesNotMatch(result, /射精/)
  assert.match(result, /顔射/)
  assert.match(result, /精液が滴る/)
})

test('swapSections は picked が空なら原文を返す', () => {
  assert.equal(ETSBatchRunner.swapSections(editor, TEMPLATE_PROMPT, new Map()), TEMPLATE_PROMPT)
})

test('コメント行を持たないセクション（97_Color 等の生タグ行）は差し替え対象にしない', () => {
  const prompt = 'red theme,\n# 10_キャラ (ホシノ),\nhoshino \\(blue archive\\),'
  const result = ETSBatchRunner.extractSwapSections(editor, prompt)
  assert.equal(result.length, 1)
  assert.match(result[0], /^# 10_キャラ/)
})

test('入れ子カッコ入りラベルのセクションも正しく判定できる', () => {
  const prompt = '# 13_衣装_ブルアカ (マリー(体操服)),\nmari \\(track\\) \\(blue archive\\),'
  const result = ETSBatchRunner.extractSwapSections(editor, prompt)
  assert.equal(result.length, 1)
})
