// EasyTemplateSelector の DOM 非依存部分（タグツリーの走査）の単体テスト
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// easy_template_selector.js はトップレベルで onUiLoaded() を呼ぶので、ダミーを先に置く
const selectorSrc = readFileSync(new URL('../javascript/easy_template_selector.js', import.meta.url), 'utf8')
const EasyTemplateSelector = new Function(
  `const onUiLoaded = () => {}\n${selectorSrc}\nreturn EasyTemplateSelector`
)()

// /easy-template/tags と /easy-template/templates が返す形（ファイル → グループ → ラベル → タグ）
const TAGS = {
  '00_テンプレート': {
    '01_SFW': {
      '公園で笑う': 'prompt-a',
      '教室で読書': 'prompt-b',
    },
    '02_NSFW': {
      '夜の部屋': 'prompt-c',
    },
  },
  '10_キャラ_ブルアカ': {
    'アビドス': {
      'ホシノ': 'hoshino \\(blue archive\\)',
      'シロコ': 'shiroko \\(blue archive\\)',
    },
    'トリニティ': {
      'カズサ': 'kazusa \\(blue archive\\)',
    },
  },
  '97_Color': ['red theme', 'blue theme'],
}

test('collectBatchLeaves はグループ配下のリーフを集める', () => {
  const leaves = EasyTemplateSelector.collectBatchLeaves(TAGS, '10_キャラ_ブルアカ:アビドス')
  assert.deepEqual(leaves, [
    { comment: 'ホシノ', tag: 'hoshino \\(blue archive\\)', category: '10_キャラ_ブルアカ:アビドス' },
    { comment: 'シロコ', tag: 'shiroko \\(blue archive\\)', category: '10_キャラ_ブルアカ:アビドス' },
  ])
})

test('collectBatchLeaves はサブグループを再帰的にたどり、カテゴリを引き回す', () => {
  const leaves = EasyTemplateSelector.collectBatchLeaves(TAGS, '10_キャラ_ブルアカ')
  assert.equal(leaves.length, 3)
  assert.deepEqual(leaves.map((leaf) => leaf.comment), ['ホシノ', 'シロコ', 'カズサ'])
  assert.equal(leaves[2].category, '10_キャラ_ブルアカ:トリニティ')
})

test('collectBatchLeaves はテンプレのカテゴリでも同じ形で集められる', () => {
  const leaves = EasyTemplateSelector.collectBatchLeaves(TAGS, '00_テンプレート')
  assert.deepEqual(leaves.map((leaf) => leaf.comment), ['公園で笑う', '教室で読書', '夜の部屋'])
  assert.equal(leaves[0].category, '00_テンプレート:01_SFW')
  assert.equal(leaves[0].tag, 'prompt-a')
})

test('collectBatchLeaves は配列（ラベル = タグ）も拾う', () => {
  const leaves = EasyTemplateSelector.collectBatchLeaves(TAGS, '97_Color')
  assert.deepEqual(leaves, [
    { comment: 'red theme', tag: 'red theme', category: '97_Color' },
    { comment: 'blue theme', tag: 'blue theme', category: '97_Color' },
  ])
})

test('collectBatchLeaves は存在しないカテゴリで空配列を返す', () => {
  assert.deepEqual(EasyTemplateSelector.collectBatchLeaves(TAGS, '99_無い:カテゴリ'), [])
})
