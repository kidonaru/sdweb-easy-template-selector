# キャレット行に追随するタグ情報ドロップダウン Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ポジティブプロンプト欄のキャレットが乗っている行のセクションを、ヘッダーのタグ情報ドロップダウン（`ETSPromptEditor.currentSection`）へ自動的に反映する。

**Architecture:** キャレットのオフセット → セクション添字の対応付けを `ETSPromptEditor` の静的メソッド（DOM 非依存・純粋関数）として切り出し、`node --test` で検証する。DOM 側は `ETSCompletion.attach()` と同じ形の配線メソッドを `ETSPromptEditor` に足し、`init()` から呼ぶ。**プログラムによる `textarea.value` 代入は必ずキャレットを末尾へ飛ばすため、同期は人手由来のイベント（`event.isTrusted`）に限定する。** 補完確定だけは例外として、配線層からコールバックで明示的に同期させる。

**Tech Stack:** 素の JavaScript（クラス、WebUI がアルファベット順に読む前提）、`node --test` + `node:assert/strict`。

## Global Constraints

- コードのコメントとエラーログメッセージは日本語で書く。
- `javascript/` 配下のファイルは、トップレベルで他ファイルのクラスを参照しない（クラス参照は `onUiLoaded` 以降の実行時に限る）。
- `javascript/js-yaml.min.js` は編集しない。
- ハードコーディングは絶対に必要な場合を除き避ける。
- 動作確認の最終手段は WebUI の UI リロード（JS 変更は再起動不要）。

## 仕様（確定済み）

同期する条件（すべて満たすときのみ `currentSection` を更新する）:

1. イベントが人手由来（`event.isTrusted === true`）、または補完確定のコールバック経由であること
2. キャレットが `txt2img_prompt` のテキスト範囲内にあること
3. キャレットが属するセクションのヘッダーが「`#` で始まり `,` で終わる」形であること
4. `selectCurrent()` のガードを通ること（`97_Color` / `98_特殊` / `99_ネガティブ` は弾かれる）

いずれかを満たさないときは **直前の選択を維持** する（選択解除はしない）。

条件 1 が要る理由（これが無いと既存挙動が壊れる）:

- `textarea.value` への代入は HTML 仕様上キャレットを末尾へ移し、`updateInput()` が同期的に `input` を発火する。素直に `input` を拾うと、以下がすべて「最後のセクションが選択される」に化ける。
  - `moveTag()`（`ets_prompt_editor.js:419-420`）は書き換え後に `selectCurrent()` を呼ばない。現状は選択が保たれるので ↑ ボタン連打で段階的に動かせるが、これが壊れる
  - `ETSHistory.restoreFromHistory()`（`ets_history.js:64-68`）の Undo/Redo
  - `addTag()` / `removeTag()` の `97_Color` / `98_特殊`（`selectCurrent()` が早期 return するため、`input` 由来の誤同期が上書きされない）
  - `ETSTemplateManager.applyTemplate()` 後に Gradio が非同期でプロンプトを書き戻す経路

条件 3 が要る理由:

- `#` を持たない行（パラメータ行・`BREAK`・空行）で選択が変わると、上/下/削除ボタンの対象が不安定になる
- 補完で入力途中のコメント行（`#細めた` など。末尾に `,` が無い）を `parseSection()` に通すと、category が半端な `ETSSection` になり削除・移動が誤爆する。末尾 `,` で確定済みを判定する規約は `ETSCompletion.STOP_CHARS` と同じ

同期対象は `txt2img_prompt`（ポジティブ）のみ。ネガティブ欄は同期しない（ドロップダウンが `txt2img_prompt` のセクションしか列挙しないため）。

意図的に対応しないこと（YAGNI）:

- IME 変換中（`compositionstart`/`end`）の抑止。同一セクション内の編集はヘッダー比較で早期 return するため、DOM 再構築は発生しない
- 複数行のドラッグ選択。`selectionStart`（アンカー側）のセクションが選ばれる

## File Structure

- `javascript/ets_prompt_editor.js`（修正）: 静的メンバ 3 つ（`CARET_KEYS` / `indexOfSectionAtCaret` / `isSyncableSection`）、`syncFromCaret()` / `attachCaretSync()`、`updateTagInfo()` のヘッダー一致化。
- `tests/ets_prompt_editor.test.mjs`（新規）: 静的メソッドの単体テスト。既存 `tests/ets_completion.test.mjs` と同じ `new Function(src)` 方式。
- `javascript/ets_completion.js`（修正）: 確定後に呼ぶコールバック `onConfirm` を受け取る（既定は無指定でも動く）。
- `javascript/easy_template_selector.js`（修正）: `attachCaretSync()` の呼び出しと、`ETSCompletion` への `onConfirm` 注入。
- `CLAUDE.md`（修正）: 同期条件と `isTrusted` を使う理由を追記。

---

### Task 1: キャレット → セクション対応付け（純粋関数 + テスト）

**Files:**
- Modify: `javascript/ets_prompt_editor.js`（`class ETSPromptEditor {` 直後、`constructor` の前）
- Test: `tests/ets_prompt_editor.test.mjs`（新規）

**Interfaces:**
- Consumes: `ETSSection`（`ets_prompt_editor.js` が実行時に参照。テストでは `ets_section.js` を先に評価して解決する）
- Produces:
  - `ETSPromptEditor.CARET_KEYS: string[]` — キャレットが動くキーの `event.key` 一覧
  - `ETSPromptEditor.indexOfSectionAtCaret(sections: string[], caret: number): number` — `splitSections()` の戻り値と `selectionStart` から、キャレットが属するセクションの添字を返す。範囲外は `-1`
  - `ETSPromptEditor.isSyncableSection(sectionText: string): boolean` — セクションの 1 行目が「`#` で始まり `,` で終わる」なら `true`

- [ ] **Step 1: 失敗するテストを書く**

`tests/ets_prompt_editor.test.mjs` を新規作成:

```javascript
// ETSPromptEditor の DOM 非依存部分（キャレット位置 → セクション対応付け）の単体テスト
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// ets_prompt_editor.js は実行時に ETSSection を参照するので、先に評価しておく
const sectionSrc = readFileSync(new URL('../javascript/ets_section.js', import.meta.url), 'utf8')
const editorSrc = readFileSync(new URL('../javascript/ets_prompt_editor.js', import.meta.url), 'utf8')
const ETSPromptEditor = new Function(
  `${sectionSrc}\n${editorSrc}\nreturn ETSPromptEditor`
)()

// DOM を触らないメソッドだけを使うので、依存はダミーで良い
const newEditor = () => new ETSPromptEditor({ ids: {}, history: null, templateManager: null })

// カーソル位置を | で表した文字列から、セクション配列とキャレット位置を作る
const indexAt = (text) => {
  const value = text.replace('|', '')
  return ETSPromptEditor.indexOfSectionAtCaret(newEditor().splitSections(value), text.indexOf('|'))
}

const PROMPT = [
  '# 01_クオリティ (標準),',
  'masterpiece,',
  '# 20_目の状態 (細めた目),',
  'narrowed eyes,',
].join('\n')

test('splitSections の結果は join で原文に戻る（オフセット計算の前提）', () => {
  const sections = newEditor().splitSections(PROMPT)
  assert.equal(sections.join('\n'), PROMPT)
})

test('コメント行のキャレットはそのセクションを指す', () => {
  assert.equal(indexAt(PROMPT.replace('# 20_目の状態', '# 20_目|の状態')), 1)
})

test('タグ行のキャレットは同じセクションを指す', () => {
  assert.equal(indexAt(PROMPT.replace('narrowed eyes,', 'narrowed |eyes,')), 1)
})

test('先頭のキャレットは最初のセクションを指す', () => {
  assert.equal(indexAt(`|${PROMPT}`), 0)
})

test('セクション末尾のキャレットはそのセクションを指す', () => {
  assert.equal(indexAt(PROMPT.replace('masterpiece,', 'masterpiece,|')), 0)
})

test('次セクションの行頭のキャレットは次のセクションを指す', () => {
  assert.equal(indexAt(PROMPT.replace('# 20_目の状態', '|# 20_目の状態')), 1)
})

test('プロンプト末尾のキャレットは最後のセクションを指す', () => {
  assert.equal(indexAt(`${PROMPT}|`), 1)
})

// splitSections() は `#` 以外の行が来るたびに区切るので、コメント行を持たない
// タグ行はそれ自体が 1 セクションになる（＝同期対象外になる）
test('コメント行に属さないタグ行は独立したセクションになる', () => {
  assert.equal(indexAt('# 01_クオリティ (標準),\nmasterpiece,\nbest quality|,'), 1)
})

test('空行はそれ自体が 1 セクションになる', () => {
  const text = '# 01_クオリティ (標準),\nmasterpiece,\n|\nblush,'
  assert.equal(indexAt(text), 1)
  assert.equal(newEditor().splitSections(text.replace('|', ''))[1], '')
})

test('範囲外のキャレットは -1', () => {
  const sections = newEditor().splitSections(PROMPT)
  assert.equal(ETSPromptEditor.indexOfSectionAtCaret(sections, PROMPT.length + 1), -1)
})

test('確定済みのコメント行を持つセクションだけ同期対象', () => {
  assert.equal(ETSPromptEditor.isSyncableSection('# 20_目の状態 (細めた目),\nnarrowed eyes,'), true)
  assert.equal(ETSPromptEditor.isSyncableSection('# 20_目の状態 (細めた目),'), true)
})

test('入力途中のコメント行・コメントを持たない行は同期対象外', () => {
  assert.equal(ETSPromptEditor.isSyncableSection('#細めた'), false)
  assert.equal(ETSPromptEditor.isSyncableSection('masterpiece,'), false)
  assert.equal(ETSPromptEditor.isSyncableSection('BREAK'), false)
  assert.equal(ETSPromptEditor.isSyncableSection(''), false)
})
```

- [ ] **Step 2: テストが落ちることを確認する**

リポジトリルートで実行:

```bash
node --test tests/ets_prompt_editor.test.mjs
```

Expected: FAIL（`ETSPromptEditor.indexOfSectionAtCaret is not a function`）

- [ ] **Step 3: 静的メンバを実装する**

`javascript/ets_prompt_editor.js` の `class ETSPromptEditor {` 直後、`constructor` の前に追加:

```javascript
  // キャレットが動くキー。上下移動はセクションをまたぐので必須
  static CARET_KEYS = [
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Home', 'End', 'PageUp', 'PageDown',
  ]

  // キャレット位置が属するセクションの添字を返す（範囲外は -1）。
  // splitSections() の結果は '\n' で join すると元テキストに戻るので、
  // 各セクションの長さ + 区切りの 1 文字を積み上げれば位置を特定できる
  static indexOfSectionAtCaret(sections, caret) {
    let offset = 0

    for (let i = 0; i < sections.length; i++) {
      const end = offset + sections[i].length
      if (caret <= end) {
        return i
      }
      offset = end + 1 // join('\n') の区切り分
    }

    return -1
  }

  // 選択の同期対象となるセクションか。確定済みのコメント行は必ず `,` で終わる
  // （ETSSection.toString()）ので、入力途中の `#細めた` のような行と区別できる
  static isSyncableSection(sectionText) {
    const head = sectionText.split('\n')[0]
    return head.startsWith('#') && head.endsWith(',')
  }
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `node --test tests/ets_prompt_editor.test.mjs`
Expected: PASS（12 tests）

- [ ] **Step 5: 既存テストの巻き込み確認**

Run: `node --test`
Expected: PASS（`ets_completion.test.mjs` / `ets_completion_index.test.mjs` を含め全件）

- [ ] **Step 6: コミット**

```bash
git add javascript/ets_prompt_editor.js tests/ets_prompt_editor.test.mjs
git commit -m "feat(editor): キャレット位置からセクションを特定する純粋関数を追加"
```

---

### Task 2: ドロップダウンの選択反映をヘッダー一致にする

**Files:**
- Modify: `javascript/ets_prompt_editor.js:264-285`（`updateTagInfo()`）

**Interfaces:**
- Consumes: 既存の `splitSections()` / `ETSSection.getHeader()`
- Produces: なし（`updateTagInfo()` の内部挙動の変更のみ）

**なぜ必要か:** 現行は `tagInfoSelect.value = this.currentSection.toString()` の **完全一致**で選択を復元している。これまで `currentSection` の出所はタグ定義由来の正規化済みテキストだけだったが、Task 3 で「ユーザーが手で書いたセクション」が入るようになる。タグ行末尾のカンマ欠落や余分な空白があると `getFormattedTag()` の `trim()`／カンマ補完で文字列が一致せず、**内部状態は正しいのにドロップダウンだけ空表示**になる。ヘッダー行（＝`option` の表示文字列）で一致させれば恒久的に解消する。

- [ ] **Step 1: `updateTagInfo()` の末尾を書き換える**

現行の最後の 2 行:

```javascript
    // 現在のセクションを選択
    tagInfoSelect.value = this.currentSection.toString()
```

を次に置き換える:

```javascript
    // 現在のセクションを選択。タグ本文ではなくヘッダー行で一致させる
    // （手書きのプロンプトはカンマや空白の揺れでタグ本文が一致しないため）
    const currentHeader = this.currentSection.getHeader()
    tagInfoSelect.selectedIndex = Array.from(tagInfoSelect.options)
      .findIndex(option => option.textContent === currentHeader)
```

- [ ] **Step 2: WebUI で退行がないことを確認する**

UI をリロードしてから:

| 操作 | 期待 |
|---|---|
| タグを追加 | 追加したセクションがドロップダウンに選択表示される |
| タグを削除 | `(なし)` のセクションが選択表示される |
| テンプレートを適用 | 選択なし（空表示）になる |
| ドロップダウンを手動で選ぶ | 選んだ項目のまま留まる |

- [ ] **Step 3: コミット**

```bash
git add javascript/ets_prompt_editor.js
git commit -m "refactor(editor): タグ情報ドロップダウンの選択をヘッダー一致で復元する"
```

---

### Task 3: キャレット同期の配線

**Files:**
- Modify: `javascript/ets_prompt_editor.js`（`constructor` にフラグ追加、`selectCurrent()` の直後にメソッド 2 つ追加）
- Modify: `javascript/easy_template_selector.js:78` 付近

**Interfaces:**
- Consumes: `ETSPromptEditor.CARET_KEYS` / `.indexOfSectionAtCaret()` / `.isSyncableSection()`（Task 1）、既存の `splitSections()` / `parseSection()` / `selectCurrent()`
- Produces:
  - `ETSPromptEditor#syncFromCaret(textarea: HTMLTextAreaElement): void` — キャレット行のセクションを選択へ反映する。条件を満たさなければ何もしない
  - `ETSPromptEditor#attachCaretSync(): void` — `txt2img_prompt` にキャレット監視を張る。多重配線はフラグで防ぐ

- [ ] **Step 1: `constructor` に配線済みフラグを足す**

`javascript/ets_prompt_editor.js` の `constructor` 末尾（`this.currentSection = ...` の次の行）:

```javascript
    this.caretSyncAttached = false
```

- [ ] **Step 2: 同期メソッドを実装する**

`selectCurrent()`（現行 `:287-294`）の直後に追加:

```javascript
  // キャレット行のセクションを選択状態へ反映する。
  // 同期しないケース（いずれも直前の選択を維持する）:
  //   - キャレットが範囲外
  //   - コメント行を持たないセクション / 入力途中のコメント行（isSyncableSection）
  //   - selectCurrent() が弾く除外カテゴリ（97_Color / 98_特殊 / 99_ネガティブ）
  syncFromCaret(textarea) {
    const sections = this.splitSections(textarea.value)
    const index = ETSPromptEditor.indexOfSectionAtCaret(sections, textarea.selectionStart)
    if (index === -1) {
      return
    }

    const sectionText = sections[index]
    if (!ETSPromptEditor.isSyncableSection(sectionText)) {
      return
    }

    const section = this.parseSection(sectionText)
    // ヘッダーで比較する。タグ本文で比べると同一セクションの編集中も差分ありになり、
    // キー入力ごとに updateTagInfo() が select を作り直してしまう
    if (section.getHeader() === this.currentSection.getHeader()) {
      return
    }

    this.selectCurrent(section)
  }

  // キャレット監視の配線。init() は Reload のたびに走るので二重配線を防ぐ。
  // 対象はポジティブ欄のみ（ドロップダウンが txt2img_prompt のセクションしか列挙しないため）
  attachCaretSync() {
    if (this.caretSyncAttached) {
      return
    }

    const textarea = gradioApp().getElementById('txt2img_prompt')?.querySelector('textarea')
    if (!textarea) {
      console.error('キャレット同期の配線に失敗しました: txt2img_prompt の textarea が見つかりません')
      return
    }

    // isTrusted で人手の入力に限定する。textarea.value の代入はキャレットを末尾へ飛ばし、
    // updateInput() が input を発火するため、拾うと moveTag / Undo / 97_98 の追加で
    // 選択が最後のセクションへ化ける（補完確定だけは onConfirm から明示的に呼ぶ）
    const onCaretEvent = (event) => {
      if (!event.isTrusted) {
        return
      }
      this.syncFromCaret(textarea)
    }

    textarea.addEventListener('input', onCaretEvent)
    textarea.addEventListener('click', onCaretEvent)
    textarea.addEventListener('keyup', (event) => {
      // カーソル移動だけでも判定し直す
      if (ETSPromptEditor.CARET_KEYS.includes(event.key)) {
        onCaretEvent(event)
      }
    })

    this.caretSyncAttached = true
  }
```

- [ ] **Step 3: 補完確定後のコールバックを足す**

`javascript/ets_completion.js` の `constructor`（現行 `:79-89`）の引数とフィールドを変更:

```javascript
  constructor({ ids, history, onConfirm }) {
    this.ids = ids
    this.history = history
    this.onConfirm = onConfirm
```

`confirm()` の末尾（現行 `:335` の `this.history.saveTextHistory()` の次の行）に追加:

```javascript
    // 確定した行のセクションを選択へ反映する。updateInput() の input は
    // isTrusted が false なのでキャレット同期側では拾えない
    this.onConfirm?.(textarea)
```

- [ ] **Step 4: `init()` から配線する**

`javascript/easy_template_selector.js` の `constructor` にある `ETSCompletion` の生成（現行 `:38-41`）を変更:

```javascript
    this.completion = new ETSCompletion({
      ids: EasyTemplateSelector.IDS,
      history: this.history,
      onConfirm: (textarea) => this.promptEditor.syncFromCaret(textarea),
    })
```

`init()` の `this.completion.attach()`（現行 `:78`）の直前に追加:

```javascript
    this.promptEditor.attachCaretSync()
```

ドロップダウンは `render()` で生成されるため、位置は必ず `.after(this.render())` より下。

- [ ] **Step 5: 既存テストが壊れていないことを確認する**

Run: `node --test`
Expected: PASS（全件）

- [ ] **Step 6: WebUI で手動確認する**

UI をリロードしてから、txt2img のプロンプト欄で以下を確認:

追随すること:

| 操作 | 期待 |
|---|---|
| コメント行をクリック | ドロップダウンがその行の表示に変わる |
| タグ行をクリック | 同じセクションが選択される（コメント行と同じ表示） |
| ↑↓ でセクションをまたぐ | 追随して変わる |
| Home / End / PageUp / PageDown | 追随して変わる |
| `#…` を打って補完を確定 | 確定した行のセクションが選択される |

追随しないこと（直前の選択を維持）:

| 操作 | 期待 |
|---|---|
| ネガティブ欄をクリック | 変わらない |
| `#` 無しの行（パラメータ行・`BREAK`）をクリック | 変わらない |
| 空行をクリック | 変わらない |
| `#細めた` と入力中（補完ポップアップ表示中） | 変わらない |
| 補完ポップアップ表示中の ↑↓ | 変わらない（候補の移動だけ） |
| `97_Color` / `98_特殊` のタグ行をクリック | 変わらない |

既存挙動の退行チェック（🔴 対策の再現手順）:

| 操作 | 期待 |
|---|---|
| セクションを選んで ↑ ボタンを **連打** | 同じセクションが段階的に上へ移動し続ける（選択が末尾へ飛ばない） |
| Undo / Redo ボタン | ドロップダウンの選択が変わらない |
| `97_Color` / `98_特殊` のタグを追加 | 直前の選択が維持される |
| テンプレートを適用 | 選択なし（空表示）になり、その後に選択が復活しない |
| タグ追加・削除 | 追加/削除したセクションが選択される |

- [ ] **Step 7: コミット**

```bash
git add javascript/ets_prompt_editor.js javascript/ets_completion.js javascript/easy_template_selector.js
git commit -m "feat(editor): プロンプト欄のキャレット行に選択セクションを追随させる"
```

---

### Task 4: CLAUDE.md への仕様追記

**Files:**
- Modify: `CLAUDE.md`（`Coding Conventions` の補完関連の記述の直後）

**Interfaces:**
- Consumes: Task 1〜3 で確定した挙動
- Produces: なし（ドキュメントのみ）

- [ ] **Step 1: 追記する**

`Coding Conventions` の最後の補完関連の項目（「落とし穴: 候補が出ている間の Enter は…」）の直後に追加:

```markdown
- タグ情報ドロップダウン（選択中セクション）はポジティブ欄のキャレット行に追随する（`ETSPromptEditor.attachCaretSync()`）。同期しないのは「キャレットが範囲外」「セクションのコメント行が `#` で始まり `,` で終わる形でない」「`selectCurrent()` が弾く除外カテゴリ（`97_Color` / `98_特殊` / `99_ネガティブ`）」の 3 ケースで、いずれも直前の選択を維持する
- 落とし穴: キャレット同期は `event.isTrusted` で人手の入力に限定している。`textarea.value` への代入は HTML 仕様上キャレットを末尾へ飛ばし、`updateInput()` が同期的に `input` を発火するため、これが無いと `moveTag()`・Undo/Redo・`97_Color` / `98_特殊` の追加・テンプレ適用後の Gradio の書き戻しで、選択が最後のセクションへ化ける
- 補完の確定だけは例外で、`ETSCompletion` の `onConfirm` コールバック（配線は `EasyTemplateSelector` の constructor）から `syncFromCaret()` を明示的に呼んでいる。`confirm()` が `setSelectionRange()` を `updateInput()` より先に呼ぶ順序に依存しているので、ここを入れ替えないこと
- 同期対象の判定に「コメント行が `,` で終わること」を使っているのは、補完で入力途中の行（`#細めた`）を `parseSection()` に通すと category が半端な `ETSSection` になり、上/下/削除ボタンが誤爆するため。`ETSCompletion.STOP_CHARS` と同じ規約に乗っている
- ネガティブ欄を同期対象にしていないのは、ドロップダウンが `txt2img_prompt` のセクションしか列挙しないため（`updateTagInfo()`）
- `updateTagInfo()` の選択復元はセクション全文ではなくヘッダー行で一致させる。手書きのプロンプトはタグ末尾のカンマや空白が揺れるため、全文一致だと内部状態が正しくてもドロップダウンだけ空表示になる
```

- [ ] **Step 2: コミット**

```bash
git add CLAUDE.md
git commit -m "docs: 選択セクションのキャレット追随の仕様を追記"
```

---

## Self-Review

**1. Spec coverage**

| 仕様 | 実装タスク |
|---|---|
| キャレット行 → セクション特定 | Task 1（純粋関数 + テスト） |
| 人手入力に限定（既存挙動の退行防止） | Task 3 Step 2（`isTrusted`） |
| 補完確定は例外として同期 | Task 3 Step 3・4（`onConfirm`） |
| ポジティブ欄のみ同期 | Task 3 Step 2 |
| 除外カテゴリは直前の選択を維持 | Task 3 Step 2（`selectCurrent()` へ委譲） |
| `#` 無し・入力途中の行は維持 | Task 1（`isSyncableSection`）+ Task 3 Step 2 |
| 手書きプロンプトでの選択表示崩れ | Task 2（ヘッダー一致） |
| キー入力ごとの `select` 再構築を避ける | Task 3 Step 2（`getHeader()` 比較で早期 return） |
| Reload での二重配線防止 | Task 3 Step 1・2（`caretSyncAttached`） |
| ドキュメント化 | Task 4 |

**2. Placeholder scan:** なし（全ステップに実コードまたは実コマンドを記載）。

**3. Type consistency:** `CARET_KEYS` / `indexOfSectionAtCaret(sections, caret)` / `isSyncableSection(sectionText)` / `syncFromCaret(textarea)` / `attachCaretSync()` / `caretSyncAttached` / `onConfirm(textarea)` は Task 1〜4 で同一表記。`selectCurrent(section)` / `parseSection(sectionText)` / `splitSections(content)` / `getHeader()` は既存シグネチャのまま。

---

## レビュー却下メモ

- IME（`compositionstart` / `compositionend`）中の同期抑止 — 同一セクション内の編集は `getHeader()` 比較で早期 return するため DOM 再構築が発生せず、対処が不要。YAGNI として見送る。
- `document` の `selectionchange` への移行案 — 既存の `ETSCompletion.attach()` のパターンから逸脱するコストに見合わない。`isTrusted` で 🔴 の原因が解消するため不要。
- 複数行ドラッグ選択時のセクション決定の仕様化 — `selectionStart` 側になる旨を仕様セクションに記載するに留める（挙動を変える価値がない）。
