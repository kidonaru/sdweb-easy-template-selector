# プロンプト補完機能 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** txt2img のプロンプト欄で行頭に `#` を打つと `tags/*.yml` のエントリを日本語ラベル・英語タグ・カテゴリ名で検索でき、選択すると ETS のセクション形式（`# カテゴリ (ラベル),` ＋ タグ行）へその場で展開する。

**Architecture:** 検索（`ETSCompletionIndex`）、トリガ判定（`ETSCompletion.extractQuery()`）、行置換（`ETSCompletion.buildReplacement()`）を DOM 非依存の純粋関数として切り出し、`node:test` で検証する。DOM 配線・ポップアップ描画・確定処理は `ETSCompletion` が担い、DOM 生成は既存規約どおり `ETSElementBuilder` に集約する。確定は `ETSPromptEditor.addTag()` を経由せず、カーソル行を `ETSSection.toString()` の結果で置換する。

**Tech Stack:** 素の JavaScript（ブラウザ、クラスはグローバルスコープ）、`node:test`（テストのみ、外部依存なし）

**設計ドキュメント:** `docs/superpowers/specs/2026-07-26-tag-completion-design.md`

## Global Constraints

- `javascript/` 配下の各ファイルは、**トップレベルで他ファイルのクラスを参照しない**。WebUI はアルファベット順に読み込むため、クラス参照は `onUiLoaded` 以降の実行時に限る
- DOM 生成は `ETSElementBuilder` に集約する
- コードのコメントとエラーログメッセージは日本語で書く
- ハードコーディングは避ける。カテゴリ名などのリテラルは静的定数として定義する
- 除外カテゴリは `00_テンプレート` / `90_モデル` / `96_解像度`、除外グループは `01_クオリティ:Model` / `99_ネガティブ:Model`。判定は `startsWith`（`ETSSection` の既存判定と揃える）
- ネガティブカテゴリの判定は `category.startsWith('99_ネガティブ')`
- 候補の表示件数上限は 20
- テストファイル名は `*.test.mjs`。Node の既定検出パターンは `**/*.test.?(c|m)js` 等で `test_*.mjs` は**拾われない**。実行は**リポジトリルートで `node --test`**（`node --test tests/` はディレクトリをファイルとして解決しようとして失敗する）
- JavaScript の変更はブラウザの再読み込み（Ctrl+F5）で反映される。WebUI の再起動は不要

## 前提として確認済みの事実

実装者が調べ直さなくて済むよう、計画時点で実機のソースを読んで確認した内容を残す。

**tagcomplete（`extensions/a1111-sd-webui-tagcomplete`）との共存**

- `navigateInList()` は `if (!isVisible(textArea)) return`（`javascript/tagAutocomplete.js:1369`）で、**自分のポップアップが表示されているときしかキーを消費しない**
- 検索語（`tagword`）はカンマ区切りで切り出されるため、`#細めた` は `#` ごと 1 語として扱われる。通常タグの検索正規表現は `(^|[^a-zA-Z])<tagword>`（同 1244 行）で、danbooru の CSV に `#` を含むタグは無いため**必ず 0 件**になり `hideResults()` される
- したがって行頭 `#` の行では tagcomplete のポップアップは出ず、キーの奪い合いも起きない
- tagcomplete の `input` リスナは `if (!e.inputType && !tacSelfTrigger) return;`（同 1521 行）なので、`updateInput()` が投げる `inputType` なしの input イベントは無視される。確定処理が tagcomplete を誤発火させることはない

**キーイベントの配線先**

- リスナを **イベントの target 自身（textarea）に登録すると `eventPhase` は `AT_TARGET` になり、`capture: true` を付けても登録順でしか呼ばれない**。また `stopPropagation()` は同一要素上の他リスナを止めない
- そのため keydown は **`gradioApp()`（祖先）に `capture: true` で 1 つだけ登録**し、捕捉フェーズで `stopPropagation()` する。これなら登録順に関係なく textarea 上のリスナへ到達しない

---

### Task 1: ETSCompletionIndex（平坦化と検索）

**Files:**
- Create: `javascript/ets_completion_index.js`
- Test: `tests/ets_completion_index.test.mjs`

**Interfaces:**
- Consumes: なし（純粋ロジック）
- Produces:
  - `class ETSCompletionIndex`
  - `static EXCLUDED_CATEGORIES: string[]` / `static EXCLUDED_GROUPS: string[]` / `static NEGATIVE_CATEGORY: string` / `static MAX_RESULTS: number`
  - `static flatten(tags: object): Array<{comment: string, tag: string, category: string}>`
  - `constructor(tags: object)` — `this.entries` に平坦化結果を持つ
  - `search(query: string, target: 'positive' | 'negative'): Array<{comment, tag, category}>`

**参考にすべき既存コード:** `javascript/easy_template_selector.js` の `renderContent()` と `renderTagButtons()`。ETS パネルのボタンと同じ単位でエントリを作る。カテゴリ直下（`renderContent()` の `renderTagButton(key, '@${key}@', key)`）とグループ直下（`renderTagButtons()` の `renderTagButton(key, '@${randomKey}@', randomKey)`）の**ランダムエントリも候補に含める**。

`01_クオリティ:Model` / `99_ネガティブ:Model` を除外する理由: `ETSPromptEditor.applyModelTag()` がこの 2 グループのセクションを `replaceSection()` で差し替えるが、`replaceSection()` は先頭 1 件しか置換しない（`javascript/ets_prompt_editor.js:74-94, 113-127`）。補完でセクションが重複するとモデル切替が壊れる。

- [ ] **Step 1: 失敗するテストを書く**

`tests/ets_completion_index.test.mjs` を新規作成:

```js
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

  assert.deepEqual(index.search('低品質', 'negative'), [
    { comment: '低品質', tag: 'worst quality', category: '99_ネガティブ' },
  ])
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
```

- [ ] **Step 2: テストを実行して失敗を確認**

実行: `node --test tests/ets_completion_index.test.mjs`
期待: 全テストが失敗する（`javascript/ets_completion_index.js` が存在しないため `ENOENT`）

- [ ] **Step 3: 実装を書く**

`javascript/ets_completion_index.js` を新規作成:

```js
// タグツリーを平坦化し、プロンプト補完用の候補検索を提供する（DOM 非依存）
class ETSCompletionIndex {
  // テキスト挿入以外の副作用を持つため補完の対象外にするカテゴリ
  static EXCLUDED_CATEGORIES = ['00_テンプレート', '90_モデル', '96_解像度']

  // ETSPromptEditor.applyModelTag() が先頭 1 件だけを差し替える前提で扱うグループ。
  // 補完でセクションが重複するとモデル切替が壊れるため対象外にする
  static EXCLUDED_GROUPS = ['01_クオリティ:Model', '99_ネガティブ:Model']

  // ネガティブプロンプト側のカテゴリ
  static NEGATIVE_CATEGORY = '99_ネガティブ'

  // 候補の表示件数上限
  static MAX_RESULTS = 20

  constructor(tags) {
    this.entries = ETSCompletionIndex.flatten(tags)
  }

  // タグツリーを { comment, tag, category } の配列へ平坦化する
  // 走査の仕方は easy_template_selector.js の renderContent() / renderTagButtons() と同じ
  static flatten(tags) {
    const entries = []

    for (const [filename, values] of Object.entries(tags ?? {})) {
      if (ETSCompletionIndex.EXCLUDED_CATEGORIES.some((prefix) => filename.startsWith(prefix))) {
        continue
      }

      // カテゴリ直下のランダムエントリ
      entries.push({ comment: filename, tag: `@${filename}@`, category: filename })
      ETSCompletionIndex.walk(values, filename, entries)
    }

    return entries
  }

  static walk(node, category, entries) {
    if (Array.isArray(node)) {
      for (const tag of node) {
        entries.push({ comment: tag, tag, category })
      }
      return
    }

    if (typeof node !== 'object' || node === null) {
      return
    }

    for (const [key, values] of Object.entries(node)) {
      if (typeof values === 'string') {
        entries.push({ comment: key, tag: values, category })
        continue
      }

      const groupCategory = `${category}:${key}`
      if (ETSCompletionIndex.EXCLUDED_GROUPS.includes(groupCategory)) {
        continue
      }

      // グループ直下のランダムエントリを作ってから中身を辿る
      entries.push({ comment: key, tag: `@${groupCategory}@`, category: groupCategory })
      ETSCompletionIndex.walk(values, groupCategory, entries)
    }
  }

  // query に一致する候補を優先順に返す
  // target は 'positive' / 'negative' のいずれか
  search(query, target) {
    const normalized = query.trim().toLowerCase()
    if (!normalized) {
      return []
    }

    const wantNegative = target === 'negative'
    const ranked = []

    for (const entry of this.entries) {
      const isNegative = entry.category.startsWith(ETSCompletionIndex.NEGATIVE_CATEGORY)
      if (isNegative !== wantNegative) {
        continue
      }

      const rank = ETSCompletionIndex.rankOf(entry, normalized)
      if (rank === null) {
        continue
      }

      ranked.push({ entry, rank })
    }

    // Array.prototype.sort は安定なので、同順位は this.entries の順（カテゴリ番号順）が保たれる
    ranked.sort((a, b) => a.rank - b.rank)

    return ranked.slice(0, ETSCompletionIndex.MAX_RESULTS).map((item) => item.entry)
  }

  // 一致の強さ。小さいほど上位。一致しない場合は null
  static rankOf(entry, normalized) {
    const comment = entry.comment.toLowerCase()
    if (comment.startsWith(normalized)) return 0
    if (comment.includes(normalized)) return 1
    if (entry.tag.toLowerCase().includes(normalized)) return 2
    if (entry.category.toLowerCase().includes(normalized)) return 3
    return null
  }
}
```

- [ ] **Step 4: テストを実行して成功を確認**

実行: `node --test tests/ets_completion_index.test.mjs`
期待: 全テスト PASS

- [ ] **Step 5: コミット**

```bash
git add javascript/ets_completion_index.js tests/ets_completion_index.test.mjs
git commit -m "feat(completion): 補完候補の検索インデックスを追加"
```

---

### Task 2: トリガ判定と行置換（純粋ロジック）

**Files:**
- Create: `javascript/ets_completion.js`
- Test: `tests/ets_completion.test.mjs`

**Interfaces:**
- Consumes: なし（このタスクで書くのは DOM 非依存の静的メソッドのみ）
- Produces:
  - `class ETSCompletion`
  - `static TARGETS: Array<{id: string, target: 'positive' | 'negative'}>`
  - `static STOP_CHARS: RegExp`
  - `static extractQuery(value: string, caret: number): {lineStart: number, lineEnd: number, query: string} | null`
    - `lineStart` / `lineEnd` はカーソル行の範囲（`lineEnd` は改行文字を含まない）
    - 補完を出すべきでない状況では `null` を返す
  - `static buildReplacement(value: string, range: {lineStart, lineEnd}, sectionText: string): {value: string, caret: number}`

補完を出す条件は 3 つすべてを満たすとき:

1. カーソル行が `#` で始まる
2. カーソル行**全体**に `,` `(` `)` のいずれも含まれない（既存のコメント行 `# 20_目の状態 (細めた目),` は必ずこれらを含むため、行の途中にカーソルを置いても発火しない）
3. クエリ（`#` 直後からカーソルまで）が 1 文字以上

- [ ] **Step 1: 失敗するテストを書く**

`tests/ets_completion.test.mjs` を新規作成:

```js
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
```

- [ ] **Step 2: テストを実行して失敗を確認**

実行: `node --test tests/ets_completion.test.mjs`
期待: 全テストが失敗する（`javascript/ets_completion.js` が存在しないため `ENOENT`）

- [ ] **Step 3: 実装を書く**

`javascript/ets_completion.js` を新規作成:

```js
// プロンプト欄でのタグ補完（トリガ判定・ポップアップ制御・確定処理）
class ETSCompletion {
  // 補完を配線する textarea と、そこで出す候補の種別
  static TARGETS = [
    { id: 'txt2img_prompt', target: 'positive' },
    { id: 'txt2img_neg_prompt', target: 'negative' },
  ]

  // 行に含まれていたら補完を出さない文字（既存のコメント行と区別するため）
  static STOP_CHARS = /[,()]/

  // カーソル行から補完クエリを取り出す。補完を出さない状況では null を返す
  static extractQuery(value, caret) {
    const lineStart = value.lastIndexOf('\n', caret - 1) + 1
    let lineEnd = value.indexOf('\n', caret)
    if (lineEnd === -1) {
      lineEnd = value.length
    }

    const line = value.slice(lineStart, lineEnd)
    if (!line.startsWith('#')) {
      return null
    }
    if (ETSCompletion.STOP_CHARS.test(line)) {
      return null
    }

    const query = value.slice(lineStart + 1, caret)
    if (query.length < 1) {
      return null
    }

    return { lineStart, lineEnd, query }
  }

  // カーソル行を sectionText で置き換えた結果と、置換後のキャレット位置を返す
  static buildReplacement(value, range, sectionText) {
    const before = value.slice(0, range.lineStart)
    const after = value.slice(range.lineEnd)

    return {
      value: `${before}${sectionText}${after}`,
      caret: range.lineStart + sectionText.length,
    }
  }
}
```

- [ ] **Step 4: テストを実行して成功を確認**

実行: `node --test tests/ets_completion.test.mjs`
期待: 全テスト PASS

- [ ] **Step 5: コミット**

```bash
git add javascript/ets_completion.js tests/ets_completion.test.mjs
git commit -m "feat(completion): 補完のトリガ判定と行置換を追加"
```

---

### Task 3: ポップアップの表示と選択

このタスク完了時点で、プロンプト欄に `#細めた` と打つと候補が表示され、↑↓ で選択でき、Esc / フォーカス移動で閉じる。確定（Enter）はまだ動かない。

**Files:**
- Modify: `javascript/ets_element_builder.js`（末尾にメソッド追加）
- Modify: `javascript/ets_completion.js`（Task 2 で作成したクラスに追記）
- Modify: `javascript/easy_template_selector.js`（`IDS` 追加、コンストラクタと `init()` に結線）
- Modify: `style.css`（末尾に追記）

**Interfaces:**
- Consumes:
  - `ETSCompletionIndex#search(query, target)`（Task 1）
  - `ETSCompletion.extractQuery(value, caret)` / `ETSCompletion.TARGETS`（Task 2）
- Produces:
  - `ETSElementBuilder.completionPopup(id): HTMLDivElement`
  - `ETSElementBuilder.completionItem(entry, selected, { onSelect, onHover }): HTMLDivElement`
  - `ETSCompletion#constructor({ ids, history })` — `ids` は `EasyTemplateSelector.IDS`
  - `ETSCompletion#setIndex(index)` — インデックスを差し替える（Reload 時に呼ばれる）
  - `ETSCompletion#attach()` — イベント配線。成功後の 2 回目以降は何もしない
  - `ETSCompletion#isOpen(): boolean` / `#close()` / `#refresh(textarea, target)`

- [ ] **Step 1: ポップアップの DOM 生成を追加**

`javascript/ets_element_builder.js` の `class ETSElementBuilder` の末尾（最後のメソッドの後、クラスの閉じ括弧の前）に追加:

```js
  // 補完候補のポップアップ本体
  static completionPopup(id) {
    const popup = document.createElement('div')
    popup.id = id
    popup.classList.add('easy_template_completion_popup')
    popup.style.display = 'none'

    return popup
  }

  // 補完候補の 1 行
  static completionItem(entry, selected, { onSelect, onHover }) {
    const item = document.createElement('div')
    item.classList.add('easy_template_completion_item')
    if (selected) {
      item.classList.add('selected')
    }

    const label = document.createElement('span')
    label.classList.add('easy_template_completion_label')
    label.textContent = `${entry.category} (${entry.comment})`

    const tag = document.createElement('span')
    tag.classList.add('easy_template_completion_tag')
    tag.textContent = entry.tag

    item.appendChild(label)
    item.appendChild(tag)

    // click だと先に textarea の blur が走ってポップアップが閉じるため mousedown を使う
    item.addEventListener('mousedown', (event) => {
      event.preventDefault()
      onSelect()
    })
    item.addEventListener('mouseenter', onHover)

    return item
  }
```

- [ ] **Step 2: スタイルを追加**

`style.css` の末尾に追加。`position: fixed` にしているのは、ポップアップを gradio コンテナ配下に置いたまま（＝テーマの CSS 変数が解決される状態で）ビューポート座標で配置するため。

```css
.easy_template_completion_popup {
  position: fixed;
  z-index: 1001;
  max-height: 20em;
  overflow-y: auto;
  background-color: var(--input-background-fill, #1f2937);
  border: 1px solid var(--block-border-color, #4b5563);
  border-radius: var(--block-radius, 4px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.easy_template_completion_item {
  display: flex;
  justify-content: space-between;
  gap: 1em;
  padding: 2px 8px;
  white-space: nowrap;
  cursor: pointer;
  color: var(--body-text-color, #e5e7eb);
}

.easy_template_completion_item.selected {
  background-color: var(--background-fill-secondary, #374151);
}

.easy_template_completion_tag {
  opacity: 0.6;
  font-size: 0.9em;
}
```

- [ ] **Step 3: ETSCompletion にポップアップ制御を実装**

`javascript/ets_completion.js` の `buildReplacement()` の後（クラスの閉じ括弧の前）に追加:

```js
  constructor({ ids, history }) {
    this.ids = ids
    this.history = history
    this.index = null
    this.popup = null
    this.entries = []
    this.selectedIndex = 0
    this.textarea = null
    this.composing = false
    this.attached = false
  }

  setIndex(index) {
    this.index = index
  }

  // イベント配線。init() は Reload のたびに走るので二重配線を防ぐ。
  // 配線に失敗したときは attached を立てず、次の Reload でやり直せるようにする
  attach() {
    if (this.attached) {
      return
    }

    const targets = []
    for (const { id, target } of ETSCompletion.TARGETS) {
      const textarea = gradioApp().getElementById(id)?.querySelector('textarea')
      if (!textarea) {
        console.error(`補完の配線に失敗しました: ${id} の textarea が見つかりません`)
        return
      }
      targets.push({ textarea, target })
    }

    for (const { textarea, target } of targets) {
      textarea.addEventListener('input', () => this.refresh(textarea, target))
      textarea.addEventListener('click', () => this.refresh(textarea, target))
      textarea.addEventListener('keyup', (event) => {
        // カーソル移動だけでも判定し直す
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
          this.refresh(textarea, target)
        }
      })
      textarea.addEventListener('blur', () => this.close())
      textarea.addEventListener('compositionstart', () => { this.composing = true })
      textarea.addEventListener('compositionend', () => { this.composing = false })
    }

    // keydown は祖先の捕捉フェーズで受ける。
    // textarea 自身に登録すると eventPhase が AT_TARGET になり、capture を付けても
    // 登録順でしか呼ばれず、tagcomplete より先に処理できる保証がないため
    gradioApp().addEventListener('keydown', (event) => this.onKeyDown(event), true)

    // position: fixed なのでスクロール・リサイズには追従しない。ずれるより閉じる
    window.addEventListener('scroll', () => this.close(), true)
    window.addEventListener('resize', () => this.close())

    this.attached = true
  }

  isOpen() {
    return this.popup !== null && this.popup.style.display !== 'none'
  }

  // 現在のカーソル位置から候補を引き直し、ポップアップを開閉する
  refresh(textarea, target) {
    if (!this.index) {
      this.close()
      return
    }

    const range = ETSCompletion.extractQuery(textarea.value, textarea.selectionStart)
    if (!range) {
      this.close()
      return
    }

    const entries = this.index.search(range.query, target)
    if (entries.length === 0) {
      this.close()
      return
    }

    this.textarea = textarea
    this.entries = entries
    this.selectedIndex = 0
    this.open()
  }

  open() {
    if (!this.popup) {
      this.popup = ETSElementBuilder.completionPopup(this.ids.COMPLETION_POPUP)
      // テーマの CSS 変数を解決させるため gradio コンテナ配下に置く
      const parent = gradioApp().querySelector('.gradio-container') ?? document.body
      parent.appendChild(this.popup)
    }

    this.renderItems()
    this.popup.style.display = 'block'
    this.updatePosition()
  }

  close() {
    if (this.popup) {
      this.popup.style.display = 'none'
    }
    this.entries = []
    this.selectedIndex = 0
  }

  renderItems() {
    this.popup.replaceChildren()

    this.entries.forEach((entry, index) => {
      const item = ETSElementBuilder.completionItem(entry, index === this.selectedIndex, {
        onSelect: () => {
          this.selectedIndex = index
          this.confirm()
        },
        onHover: () => this.select(index),
      })
      this.popup.appendChild(item)
    })
  }

  select(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.entries.length) {
      return
    }

    this.selectedIndex = index
    this.popup.querySelectorAll('.easy_template_completion_item').forEach((item, i) => {
      item.classList.toggle('selected', i === index)
    })
    this.popup.children[index]?.scrollIntoView({ block: 'nearest' })
  }

  // 候補を上下に移動する。端では折り返す
  move(delta) {
    const count = this.entries.length
    if (count === 0) {
      return
    }

    this.select((this.selectedIndex + delta + count) % count)
  }

  // textarea の直下に左寄せで置く（ビューポート座標）
  updatePosition() {
    const rect = this.textarea.getBoundingClientRect()
    this.popup.style.left = `${rect.left}px`
    this.popup.style.top = `${rect.bottom}px`
    this.popup.style.minWidth = `${rect.width}px`
  }

  onKeyDown(event) {
    if (!this.isOpen() || event.target !== this.textarea) {
      return
    }

    // IME 変換中のキーは変換操作なので素通しする。
    // isComposing だけでは取りこぼす環境があるため keyCode 229 と自前のフラグも見る
    if (event.isComposing || event.keyCode === 229 || this.composing) {
      return
    }

    switch (event.key) {
      case 'ArrowDown':
        this.move(1)
        break
      case 'ArrowUp':
        this.move(-1)
        break
      case 'Escape':
        this.close()
        break
      default:
        return
    }

    event.preventDefault()
    event.stopPropagation()
  }

  // Task 4 で実装する
  confirm() {
    this.close()
  }
```

- [ ] **Step 4: easy_template_selector.js に結線**

`javascript/easy_template_selector.js` の `static IDS` の最後の行に `,` を足して 1 行追加:

```js
    CONTAINER: 'easy_template_selector_container',
    COMPLETION_POPUP: 'easy_template_selector_completion_popup'
```

コンストラクタの `this.templateManager.setPromptEditor(this.promptEditor)` の直前に追加:

```js
    this.completion = new ETSCompletion({
      ids: EasyTemplateSelector.IDS,
      history: this.history,
    })
```

`init()` の `this.tags = await this.fetchTags()` の直後に追加:

```js
    // Reload でタグが差し替わるのでインデックスを作り直す
    this.completion.setIndex(new ETSCompletionIndex(this.tags))
```

`init()` の末尾（`gradioApp().getElementById('txt2img_toprow').after(this.render())` の後）に追加:

```js
    this.completion.attach()
```

- [ ] **Step 5: WebUI で動作を確認**

ブラウザを Ctrl+F5 で再読み込みし、txt2img のプロンプト欄で以下を確認する:

1. 空行で `#細めた` と入力 → `20_目の状態 (細めた目)` などの候補が textarea の直下に出る
2. ポップアップの背景が不透明で、文字が読める（CSS 変数が解決されている）
3. ↑↓ で選択行が移動し、端で折り返す
4. Esc で閉じる。プロンプト欄の外をクリックしても閉じる
5. `#zzzz` のように一致しない語 → ポップアップが出ない
6. 既存のコメント行（`# 20_目の状態 (細めた目),`）の途中をクリック → ポップアップが出ない
7. ネガティブプロンプト欄で `#低品質` → ネガティブの候補が出る。ポジ欄で `#低品質` → 出ない
8. ポップアップが出ている状態で tagcomplete のポップアップが**同時に出ていない**
9. ページをスクロールするとポップアップが閉じる
10. DevTools のコンソールにエラーが出ていない

確認 8 で tagcomplete が同時に出た場合は、`#` を含む語で tagcomplete がヒットしている（計画の前提が崩れている）。実装を進めず、tagcomplete 側の設定（翻訳ファイル・追加パーサ）を確認して報告すること。

- [ ] **Step 6: コミット**

```bash
git add javascript/ets_completion.js javascript/ets_element_builder.js javascript/easy_template_selector.js style.css
git commit -m "feat(completion): 補完候補のポップアップ表示を追加"
```

---

### Task 4: 確定してセクションへ展開

**Files:**
- Modify: `javascript/ets_completion.js`（Task 3 で置いた仮の `confirm()` を差し替え、`onKeyDown()` に分岐を追加）

**Interfaces:**
- Consumes:
  - `ETSCompletion.buildReplacement()`（Task 2）
  - `ETSSection#constructor(comment, tag, category)` / `#toString()`（既存 `javascript/ets_section.js`）
  - `updateInput(textarea)`（WebUI 本体のグローバル関数）
  - `ETSHistory#saveTextHistory()`（既存 `javascript/ets_history.js`）
- Produces: `ETSCompletion#confirm()` の実装

`ETSSection#toString()` の既存仕様により、`97_Color` / `98_特殊` はコメント行なしのタグ 1 行に、タグが `@` で始まるランダムエントリはヘッダが `(ランダム)` になる。ここで分岐は書かない。

- [ ] **Step 1: onKeyDown に確定のキーを足す**

`javascript/ets_completion.js` の `onKeyDown()` の `switch` に、`case 'Escape'` の前へ追加:

```js
      case 'Enter':
      case 'Tab':
        this.confirm()
        break
```

- [ ] **Step 2: confirm() を実装**

Task 3 で置いた仮実装を丸ごと差し替える:

```js
  // 選択中の候補でカーソル行を置き換える
  confirm() {
    const entry = this.entries[this.selectedIndex]
    const textarea = this.textarea
    if (!entry || !textarea) {
      this.close()
      return
    }

    const range = ETSCompletion.extractQuery(textarea.value, textarea.selectionStart)
    if (!range) {
      this.close()
      return
    }

    const section = new ETSSection(entry.comment, entry.tag, entry.category).toString()
    const replacement = ETSCompletion.buildReplacement(textarea.value, range, section)

    this.close()

    // setSelectionRange を updateInput より先に呼ぶ。
    // updateInput が投げる input イベントで refresh() が走るため、
    // その時点でキャレットが挿入位置に無いと古いクエリのまま開き直すことがある
    textarea.value = replacement.value
    textarea.focus()
    textarea.setSelectionRange(replacement.caret, replacement.caret)
    updateInput(textarea)

    this.history.saveTextHistory()
  }
```

- [ ] **Step 3: WebUI で動作を確認**

ブラウザを Ctrl+F5 で再読み込みし、以下を確認する:

1. `#細めた` → Enter で以下の 2 行に置き換わり、キャレットが `narrowed eyes,` の行末にある

```
# 20_目の状態 (細めた目),
narrowed eyes,
```

2. Tab でも同じように確定する
3. マウスで候補をクリックしても確定する
4. 日本語入力の変換中（`#ほそめた` を変換中）に Enter を押しても補完が確定せず、変換だけが確定する
5. 確定直後にポップアップが開き直さない（挿入位置より後ろの行に `#` で始まる行があっても）
6. `97_Color` / `98_特殊` のエントリを確定 → コメント行なしのタグ 1 行が入る
7. カテゴリ名（例 `#20_目の状態`）やグループ名（例 `#トリニティ`）を確定 → `(ランダム)` ヘッダ＋ `@…@` のタグ行が入る
8. **テンプレートを適用してから** `#細めた` を確定し、ETS パネルの Undo ボタンで確定前に戻る（`ETSHistory` は変更後の状態だけを積むため、セッション最初の操作が補完確定だと戻り先が無く Undo が効かない。前提を満たしてから確認すること）
9. ネガティブ欄で確定すると、ネガティブ欄のカーソル位置に入る
10. 行の途中（`1girl,solo,` の次の行など）で確定しても、周囲の行が壊れない

- [ ] **Step 4: コミット**

```bash
git add javascript/ets_completion.js
git commit -m "feat(completion): 候補確定でセクションへ展開する処理を追加"
```

---

### Task 5: 受け入れ確認とドキュメント更新

**Files:**
- Modify: `CLAUDE.md`（`System Structure` / `Coding Conventions` / `Build & Test`）

- [ ] **Step 1: 全テストを実行**

リポジトリルートで実行: `node --test`
期待: `tests/ets_completion_index.test.mjs` と `tests/ets_completion.test.mjs` の全テストが PASS

補足: Node の既定検出パターンは `test_*.mjs` を拾わないため、`tests/` に同居する Python の `test_*.py` とは干渉しない。

- [ ] **Step 2: Python 側のテストが壊れていないことを確認**

Bash ツールから実行:

```bash
PYTHONIOENCODING=utf-8 python tests/test_upscaler_aliases.py
PYTHONIOENCODING=utf-8 python tests/test_hr_cfg_inherit.py
```

期待: どちらも成功（本タスクでは Python を触っていないため、退行がないことの確認）

- [ ] **Step 3: 設計ドキュメントの確認項目を通す**

`docs/superpowers/specs/2026-07-26-tag-completion-design.md` の「テスト方針」にある確認項目を、WebUI 上で順に通す。

- [ ] **Step 4: ETS の Reload 後も動くことを確認**

ETS パネルの Reload ボタンを押した後、補完が二重に発火しないこと（1 回の Enter で 1 セクションだけ入ること）と、追加したタグが候補に出ることを確認する。

- [ ] **Step 5: CLAUDE.md を更新**

`System Structure` のツリーの `javascript/` 配下に 2 行追加（`ets_history.js` の後、`js-yaml.min.js` の前）:

```
│   ├── ets_completion.js         # ETSCompletion: プロンプト欄の補完（トリガ判定・ポップアップ・確定）
│   ├── ets_completion_index.js   # ETSCompletionIndex: 補完候補の平坦化と検索
```

`Coding Conventions` の末尾に追加:

```
- プロンプト補完は行頭 `#` をトリガとする。tagcomplete も同じ textarea を見ているが、検索語がカンマ区切りで切り出され `#` ごと検索されるため danbooru タグには一致せず、tagcomplete 側のポップアップは出ない（`navigateInList()` は自分のポップアップが出ているときしかキーを消費しない）。この性質に依存しているので、tagcomplete 側の設定でパーサや翻訳を増やしたときは共存を再確認すること
- 補完の keydown は `gradioApp()` の捕捉フェーズで受ける。textarea 自身に登録すると `eventPhase` が `AT_TARGET` になり、`capture: true` を付けても登録順でしか呼ばれないため、他拡張より先に処理できる保証がない
- 補完の対象外は `00_テンプレート` / `90_モデル` / `96_解像度` の 3 カテゴリと、`01_クオリティ:Model` / `99_ネガティブ:Model` の 2 グループ。前者はテキスト挿入以外の副作用を持ち、後者は `applyModelTag()` が先頭 1 件だけを差し替える前提のためセクションが重複すると壊れる
- 落とし穴: 補完のラベル検索は行に `(` が入った時点で止まるため、`マリー(体操服)` のようにカッコを含むラベルは `マリー` までしか打てない。前方部分で絞って候補から選ぶ
- 落とし穴: 候補が出ている間の Enter は確定に使われる。普通に改行したいときは Esc で閉じてから
```

`Build & Test` のコマンド例に追加:

```bash
# JavaScript の純粋モジュールの単体テスト（リポジトリルートで実行）
node --test
```

- [ ] **Step 6: コミット**

```bash
git add CLAUDE.md
git commit -m "docs: プロンプト補完機能を CLAUDE.md に反映"
```

---

## レビュー却下メモ

- **`search()` の `toLowerCase()` を `flatten()` 時に前計算する** — 却下。エントリ数は数千規模で 1 キーストローク当たりの走査は十分軽い。実測で問題が出てから対処する（YAGNI）
- **`ETSCompletion.TARGETS` の内容を deepEqual で検証するテスト** — 却下（レビュー指摘に同意し削除済み）。定数を定数と比較するだけで回帰検出力がない
- **tagcomplete のポップアップを ETS 側から明示的に隠す** — 却下。tagcomplete のソースを読み、`#` 付きの語では検索が 0 件になり `hideResults()` されること、`navigateInList()` が非表示時に早期 return することを確認したため、抑止コードは不要。代わりに前提として計画・CLAUDE.md に明記し、Task 3 Step 5 の確認項目 8 で実機検証する
