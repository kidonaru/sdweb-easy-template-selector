# キャラ/衣装差し替え一括生成 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 現在のプロンプト欄のキャラ+衣装セクションを差し替え元として、チェック選択した複数テンプレートを「適用 → 差し替え → Generate → 完了待ち」で順次一括生成できるようにする。

**Architecture:** 新クラス `ETSBatchRunner`（`javascript/ets_batch_runner.js`）が差し替えロジック（DOM 非依存の static メソッド、単体テスト対象）と実行ループ（テンプレ適用待ち・生成完了待ちのポーリング）を持つ。テンプレ一覧 UI（`easy_template_selector.js`）に一括生成モードのトグル・チェック選択・実行/停止/進捗表示を追加し、結線は `EasyTemplateSelector` の constructor で行う。

**Tech Stack:** Vanilla JS（WebUI 拡張、ビルドなし）、`node --test`（純粋ロジックの単体テスト）

**Spec:** `docs/superpowers/specs/2026-08-02-batch-generate-with-char-swap-design.md`

## Global Constraints

- コードのコメント・エラーログメッセージは日本語で書く
- `javascript/` 配下のファイルはトップレベルで他ファイルのクラスを参照しない（クラス参照は実行時のみ。結線は `EasyTemplateSelector` の constructor で行う）
- `javascript/js-yaml.min.js` は編集しない
- 差し替え対象プレフィックスは `10_キャラ` / `13_衣装` / `14_衣装小物` / `15_衣装状態`（前方一致、サブ分類 `10_キャラ_ブルアカ` 等も拾う）
- テンプレに対象セクションが無い場合は差し替えずそのまま生成する
- Seed はテンプレに焼かれた値をそのまま使う（`applyTemplate` の既存動作に任せる。上書きしない）
- ネガティブ欄は差し替え対象外
- JS の変更は WebUI の UI Reload で反映される（再起動不要）

---

### Task 1: 差し替えロジック（DOM 非依存の純粋関数）

**Files:**
- Create: `javascript/ets_batch_runner.js`（このタスクでは static メソッドのみ）
- Test: `tests/ets_batch_runner.test.mjs`

**Interfaces:**
- Consumes: `ETSPromptEditor#splitSections(text) → string[]`（join('\n') で原文に戻る）、`ETSPromptEditor#parseSection(sectionText) → ETSSection`（`category` プロパティを持つ。コメント行が無いセクションは `category` が `null`）
- Produces:
  - `ETSBatchRunner.SWAP_PREFIXES: string[]`
  - `ETSBatchRunner.extractSwapSections(editor, promptText) → string[]`（対象セクション文字列の配列。出現順）
  - `ETSBatchRunner.swapSections(editor, templatePrompt, swapSectionTexts) → string`（差し替え後のプロンプト。対象なし or `swapSectionTexts` が空なら原文をそのまま返す）

- [ ] **Step 1: 失敗するテストを書く**

`tests/ets_prompt_editor.test.mjs` と同じ `new Function` 方式でクラスを評価する。

```javascript
// ETSBatchRunner の DOM 非依存部分（キャラ/衣装セクションの抽出・差し替え）の単体テスト
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

const CHAR_SWAP = [
  '# 10_キャラ_ブルアカ:アビドス (ホシノ),\nhoshino \\(blue archive\\),pink hair,halo,',
  '# 13_衣装_基本 (セーラー服),\nserafuku,',
].join('\n')

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

test('extractSwapSections は対象プレフィックスのセクションだけを出現順で返す', () => {
  const result = ETSBatchRunner.extractSwapSections(editor, TEMPLATE_PROMPT)
  assert.equal(result.length, 2)
  assert.match(result[0], /^# 10_キャラ_ブルアカ:トリニティ/)
  assert.match(result[1], /^# 15_衣装状態_基本/)
})

test('extractSwapSections は対象セクションが無ければ空配列を返す', () => {
  const prompt = '# 01_クオリティ (標準),\nmasterpiece,'
  assert.deepEqual(ETSBatchRunner.extractSwapSections(editor, prompt), [])
})

test('swapSections は最初の対象位置に一式を挿入し、残りの対象を削除する', () => {
  const swap = ETSBatchRunner.extractSwapSections(editor, CHAR_SWAP)
  const result = ETSBatchRunner.swapSections(editor, TEMPLATE_PROMPT, swap)
  const lines = result.split('\n')
  // カズサのセクションがあった位置にホシノ+セーラー服が入る
  assert.equal(lines[4], '# 10_キャラ_ブルアカ:アビドス (ホシノ),')
  assert.equal(lines[6], '# 13_衣装_基本 (セーラー服),')
  // 元のキャラ・衣装状態セクションは消える
  assert.doesNotMatch(result, /カズサ/)
  assert.doesNotMatch(result, /open clothes/)
  // 非対象セクションは維持される
  assert.match(result, /outdoors,/)
  assert.match(result, /smile,/)
})

test('swapSections は対象セクションの無いテンプレを変更しない', () => {
  const prompt = '# 01_クオリティ (標準),\nmasterpiece,\n# 50_背景_基本:基本 (屋外),\noutdoors,'
  const swap = ETSBatchRunner.extractSwapSections(editor, CHAR_SWAP)
  assert.equal(ETSBatchRunner.swapSections(editor, prompt, swap), prompt)
})

test('swapSections は差し替え元が空なら原文を返す', () => {
  assert.equal(ETSBatchRunner.swapSections(editor, TEMPLATE_PROMPT, []), TEMPLATE_PROMPT)
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
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/ets_batch_runner.test.mjs`
Expected: FAIL（`ets_batch_runner.js` が存在しないため readFileSync がエラー）

- [ ] **Step 3: 最小実装を書く**

`javascript/ets_batch_runner.js` を新規作成（このタスクでは static 部分のみ。実行ループは Task 2 で追加）:

```javascript
// キャラ/衣装セクションを差し替えながら複数テンプレートを順次生成するバッチ実行
class ETSBatchRunner {
  // 差し替え対象カテゴリのプレフィックス（前方一致でサブ分類も拾う）
  static SWAP_PREFIXES = ['10_キャラ', '13_衣装', '14_衣装小物', '15_衣装状態']

  // セクションのカテゴリが差し替え対象か
  static isSwapTarget(editor, sectionText) {
    const category = editor.parseSection(sectionText).category
    if (!category) {
      return false
    }
    return ETSBatchRunner.SWAP_PREFIXES.some((prefix) => category.startsWith(prefix))
  }

  // プロンプトから差し替え対象セクションを出現順に抽出する
  static extractSwapSections(editor, promptText) {
    return editor.splitSections(promptText)
      .filter((section) => ETSBatchRunner.isSwapTarget(editor, section))
  }

  // テンプレのプロンプト内の対象セクションを swapSectionTexts 一式に差し替える。
  // 最初の対象位置に一式を挿入し、残りの対象は削除する。対象が無ければ原文のまま返す
  static swapSections(editor, templatePrompt, swapSectionTexts) {
    if (swapSectionTexts.length === 0) {
      return templatePrompt
    }

    const sections = editor.splitSections(templatePrompt)
    const firstIndex = sections.findIndex((section) => ETSBatchRunner.isSwapTarget(editor, section))
    if (firstIndex < 0) {
      return templatePrompt
    }

    const newSections = []
    sections.forEach((section, index) => {
      if (index === firstIndex) {
        newSections.push(...swapSectionTexts)
      } else if (!ETSBatchRunner.isSwapTarget(editor, section)) {
        newSections.push(section)
      }
    })
    return newSections.join('\n')
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/ets_batch_runner.test.mjs`
Expected: 全件 PASS

Run: `node --test`
Expected: 既存テスト含め全件 PASS

- [ ] **Step 5: コミット**

```bash
git add javascript/ets_batch_runner.js tests/ets_batch_runner.test.mjs
git commit -m "feat(batch): キャラ/衣装セクションの抽出・差し替えロジックを追加"
```

---

### Task 2: バッチ実行ループ（待機・Generate・停止）

**Files:**
- Modify: `javascript/ets_batch_runner.js`（Task 1 の static 部分に実行ループを追加）

**Interfaces:**
- Consumes:
  - `ETSTemplateManager#applyTemplate(template, templateName)`（pnginfo 貼り付け + 1500ms 後のメタ反映 + 非同期モデル切替を含む fire-and-forget）
  - `ETSTemplateManager#applyModel: boolean` / `ETSTemplateManager#getCurrentModel() → string`
  - `ETSTemplateManager#parseMetaText(template) → { prompt, negPrompt, metaDataMap }`
  - Task 1 の `extractSwapSections` / `swapSections`
- Produces:
  - `new ETSBatchRunner({ promptEditor, templateManager, onProgress })`
  - `#start(items) → Promise<{ success: number, failure: number }>`（`items: { name: string, template: string }[]`）
  - `#stop()`（現在の生成完了後に打ち切り）
  - `#running: boolean`
  - `onProgress(text)` コールバック（進捗表示文字列。UI 側が表示する）

- [ ] **Step 1: 実行ループを実装する**

`javascript/ets_batch_runner.js` に constructor とインスタンスメソッドを追加:

```javascript
  constructor({ promptEditor, templateManager, onProgress }) {
    this.promptEditor = promptEditor
    this.templateManager = templateManager
    this.onProgress = onProgress || (() => {})
    this.running = false
    this.stopRequested = false
  }

  // ミリ秒待つ
  static delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  // predicate が true になるまでポーリングする。タイムアウトで false を返す
  static async waitFor(predicate, timeoutMs, intervalMs = 500) {
    const limit = Date.now() + timeoutMs
    while (Date.now() < limit) {
      if (predicate()) {
        return true
      }
      await ETSBatchRunner.delay(intervalMs)
    }
    return false
  }

  // Interrupt ボタンが表示中（= 生成中）か
  static isGenerating() {
    const interrupt = gradioApp().getElementById('txt2img_interrupt')
    return !!interrupt && getComputedStyle(interrupt).display !== 'none'
  }

  getPromptTextarea() {
    return gradioApp().getElementById('txt2img_prompt').querySelector('textarea')
  }

  // 停止要求。現在の生成完了後にループを打ち切る
  stop() {
    this.stopRequested = true
    this.onProgress('停止要求中…（現在の生成完了後に停止）')
  }

  // 選択テンプレを順次生成する
  async start(items) {
    if (this.running) {
      return { success: 0, failure: 0 }
    }
    this.running = true
    this.stopRequested = false

    // 差し替え元は開始時点のプロンプト欄から抽出して固定する
    const swapSectionTexts = ETSBatchRunner.extractSwapSections(
      this.promptEditor, this.getPromptTextarea().value)

    let success = 0
    let failure = 0
    try {
      for (let i = 0; i < items.length; i++) {
        if (this.stopRequested) {
          break
        }
        const item = items[i]
        this.onProgress(`${i + 1}/${items.length}: ${item.name}`)
        const ok = await this.runOne(item, swapSectionTexts)
        ok ? success++ : failure++
      }
    } finally {
      this.running = false
      const suffix = this.stopRequested ? '（停止）' : ''
      this.onProgress(`完了${suffix}: 成功 ${success} 件 / 失敗 ${failure} 件`)
    }
    return { success, failure }
  }

  // プロンプト欄の書き戻しが落ち着く（連続 3 回のポーリングで値が変化しない）まで待つ
  async waitForPromptQuiescence(timeoutMs) {
    const textarea = this.getPromptTextarea()
    let last = null
    let stableCount = 0
    return ETSBatchRunner.waitFor(() => {
      if (textarea.value === last) {
        stableCount++
      } else {
        stableCount = 0
        last = textarea.value
      }
      return stableCount >= 3
    }, timeoutMs)
  }

  // 1 テンプレ分の適用・差し替え・生成を行う。成功で true
  async runOne(item, swapSectionTexts) {
    try {
      const parsed = this.templateManager.parseMetaText(item.template)
      // テンプレに差し替え対象セクションがあるか（無ければ差し替え工程を丸ごとスキップ）
      const hasSwapTarget = swapSectionTexts.length > 0 &&
        ETSBatchRunner.extractSwapSections(this.promptEditor, parsed.prompt).length > 0

      this.templateManager.applyTemplate(item.template, item.name)

      // メタ反映タイマー（1500ms）の経過を待つ
      await ETSBatchRunner.delay(2000)

      // pnginfo 貼り付けの非同期書き戻しが落ち着くまで待つ（固定待ちではなく静穏検知。最長 60 秒）
      const settled = await this.waitForPromptQuiescence(60 * 1000)
      if (!settled) {
        console.error(`一括生成: テンプレ適用の書き戻しが安定しませんでした (${item.name})`)
        return false
      }

      // モデル切替が必要な場合はロード完了を待つ（最長 5 分）
      const modelName = parsed.metaDataMap['Model']
      if (this.templateManager.applyModel && modelName) {
        const loaded = await ETSBatchRunner.waitFor(
          () => this.templateManager.getCurrentModel() === modelName, 5 * 60 * 1000)
        if (!loaded) {
          console.error(`一括生成: モデル切替がタイムアウトしました (${item.name})`)
          return false
        }
        // ロード直後の UI 更新の猶予
        await ETSBatchRunner.delay(1000)
      }

      // キャラ/衣装セクションを差し替える。遅延書き戻しで消えた場合に備えて反映確認つきで再試行し、
      // 最終的に反映できなければ失敗として次のテンプレへ進む（元キャラのままサイレント生成しない）
      if (hasSwapTarget) {
        let applied = false
        for (let attempt = 0; attempt < 5; attempt++) {
          this.applySwap(swapSectionTexts)
          await ETSBatchRunner.delay(1500)
          if (this.isSwapApplied(swapSectionTexts)) {
            applied = true
            break
          }
        }
        if (!applied) {
          console.error(`一括生成: キャラ/衣装の差し替えが反映できませんでした (${item.name})`)
          return false
        }
      }

      // 生成開始
      const generateButton = gradioApp().getElementById('txt2img_generate')
      generateButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))

      // 生成開始（Interrupt 表示）を待つ（最長 30 秒）
      const started = await ETSBatchRunner.waitFor(() => ETSBatchRunner.isGenerating(), 30 * 1000)
      if (!started) {
        console.error(`一括生成: 生成が開始されませんでした (${item.name})`)
        return false
      }

      // 生成完了（Interrupt 非表示）を待つ（最長 15 分）
      const finished = await ETSBatchRunner.waitFor(() => !ETSBatchRunner.isGenerating(), 15 * 60 * 1000)
      if (!finished) {
        console.error(`一括生成: 生成完了がタイムアウトしました (${item.name})`)
        return false
      }
      return true
    } catch (error) {
      console.error(`一括生成: エラーが発生しました (${item.name})`, error)
      return false
    }
  }

  // プロンプト欄へ差し替えを適用する
  applySwap(swapSectionTexts) {
    if (swapSectionTexts.length === 0) {
      return
    }
    const textarea = this.getPromptTextarea()
    const swapped = ETSBatchRunner.swapSections(this.promptEditor, textarea.value, swapSectionTexts)
    if (swapped !== textarea.value) {
      textarea.value = swapped
      updateInput(textarea)
    }
  }

  // 差し替えが反映済みか（差し替え元の全セクションがプロンプト欄に存在すること）
  isSwapApplied(swapSectionTexts) {
    const value = this.getPromptTextarea().value
    return swapSectionTexts.every((section) => value.includes(section))
  }
```

注意点:

- `parseMetaText` は `ETSTemplateManager` の既存メソッド。private でないことを確認してそのまま使う
- `updateInput` / `gradioApp` / `getComputedStyle` は WebUI のグローバル。トップレベルでは呼ばず、メソッド内でのみ使う（読み込み順規約）
- `isSwapApplied` の分岐: テンプレに対象セクションが無い場合、`swapSections` は原文を返すため swap テキストは含まれない。それを「適用済み」と判定させるための分岐

- [ ] **Step 2: 単体テストが引き続き通ることを確認**

Run: `node --test`
Expected: 全件 PASS（実行ループは DOM 依存のためテスト対象外。static 部分の回帰確認）

- [ ] **Step 3: コミット**

```bash
git add javascript/ets_batch_runner.js
git commit -m "feat(batch): テンプレ適用・生成完了を待機する順次実行ループを追加"
```

---

### Task 3: UI 結線（一括生成モード・チェック選択・実行/停止/進捗）

**Files:**
- Modify: `javascript/easy_template_selector.js`

**Interfaces:**
- Consumes: Task 2 の `ETSBatchRunner`（constructor / `start` / `stop` / `running`）
- Produces: なし（最終タスク）

- [ ] **Step 1: 状態と結線を追加する**

`EasyTemplateSelector` の constructor に追加（`this.templateManager` / `this.promptEditor` 生成より後）:

```javascript
    // 一括生成モードの状態。selection は「テンプレ名 → テンプレ本文」
    this.batchMode = false
    this.batchSelection = new Map()
    this.batchRunner = new ETSBatchRunner({
      promptEditor: this.promptEditor,
      templateManager: this.templateManager,
      onProgress: (text) => this.updateBatchProgress(text),
    })
```

`IDS` に追加:

```javascript
    BATCH_PROGRESS: 'easy_template_selector_batch_progress',
```

- [ ] **Step 2: テンプレボタンのクリックを一括生成モードで選択トグルにする**

`renderTagButton` を修正。テンプレボタン（category が `00_テンプレート` で始まり、tag が `@` で始まらない）かつ `this.batchMode` のときは適用せず選択をトグルする:

```javascript
  renderTagButton(comment, tag, category, color = 'primary') {
    const button = ETSElementBuilder.tagButton({
      title: comment,
      value: tag,
      onClick: (e) => {
        e.preventDefault();

        // 一括生成の実行中はプロンプト欄を競合して書き換えないよう全タグ操作を無視する
        if (this.batchRunner.running) {
          return
        }

        // 一括生成モード中のテンプレボタンは適用せず選択をトグルする
        if (this.batchMode && category.startsWith('00_テンプレート') && !tag.startsWith('@')) {
          this.toggleBatchSelection(button, comment, tag, category)
          return
        }

        this.promptEditor.addTag(comment, tag, category, e.metaKey || e.ctrlKey)
      },
      onRightClick: (e) => {
        e.preventDefault();

        if (this.batchRunner.running) {
          return
        }

        const targetSection = new ETSSection(comment, tag, category)
        this.promptEditor.removeTag(targetSection)
      },
      color
    })

    // 再描画時に選択状態の見た目を復元する
    if (this.batchMode && category.startsWith('00_テンプレート') && !tag.startsWith('@')) {
      const name = this.batchTemplateName(comment, category)
      if (this.batchSelection.has(name)) {
        button.style.outline = '2px solid var(--color-accent, #ff7c00)'
      }
    }

    return button
  }
```

選択トグルとテンプレ名の組み立て（`addTag` のテンプレ分岐と同じ規則でフォルダパスを付ける）をクラスに追加:

```javascript
  // テンプレボタンの category ('00_テンプレート:01_SFW' 等) と comment からテンプレ名を組み立てる
  batchTemplateName(comment, category) {
    const categories = category.split(':')
    let name = ''
    for (let i = 1; i < categories.length; i++) {
      name += `${categories[i].trim()}/`
    }
    return name + comment
  }

  // 一括生成対象の選択をトグルし、ボタンの見た目と件数表示を更新する
  toggleBatchSelection(button, comment, tag, category) {
    const name = this.batchTemplateName(comment, category)
    if (this.batchSelection.has(name)) {
      this.batchSelection.delete(name)
      button.style.outline = ''
    } else {
      this.batchSelection.set(name, tag)
      button.style.outline = '2px solid var(--color-accent, #ff7c00)'
    }
    this.updateBatchProgress(`選択中: ${this.batchSelection.size} 件`)
  }

  // 進捗表示を更新する
  updateBatchProgress(text) {
    const progress = gradioApp().getElementById(EasyTemplateSelector.IDS.BATCH_PROGRESS)
    if (progress) {
      progress.textContent = text
    }
  }
```

- [ ] **Step 3: 99_設定グループに一括生成 UI を追加する**

`renderTemplateSettings` の `buttons.append(applyModelCheckbox)` の後に追加:

```javascript
    // 一括生成モードのトグル。ON の間はテンプレボタンが選択トグルになる
    const batchModeCheckbox = ETSElementBuilder.checkbox('一括生成モード', this.batchMode, {
      onChange: (checked) => {
        this.batchMode = checked
        if (!checked) {
          this.batchSelection.clear()
        }
        this.render()
      }
    })
    buttons.append(batchModeCheckbox)

    // 一括生成の実行・停止・進捗。モード ON のときだけ表示する
    if (this.batchMode) {
      const runButton = ETSElementBuilder.baseButton('▶ 一括生成', { color: 'primary' })
      runButton.addEventListener('click', () => this.startBatch())
      buttons.append(runButton)

      const stopButton = ETSElementBuilder.baseButton('■ 停止', { color: 'secondary' })
      stopButton.addEventListener('click', () => this.batchRunner.stop())
      buttons.append(stopButton)

      const progress = document.createElement('span')
      progress.id = EasyTemplateSelector.IDS.BATCH_PROGRESS
      progress.style.alignSelf = 'center'
      progress.textContent = `選択中: ${this.batchSelection.size} 件`
      buttons.append(progress)
    }
```

実行開始メソッドをクラスに追加:

```javascript
  // 一括生成を開始する。実行順は選択順ではなく名前順（一覧の表示順に近い）
  async startBatch() {
    if (this.batchRunner.running) {
      return
    }
    if (this.batchSelection.size === 0) {
      this.updateBatchProgress('テンプレートが選択されていません')
      return
    }
    const items = Array.from(this.batchSelection, ([name, template]) => ({ name, template }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'))
    await this.batchRunner.start(items)
  }
```

さらに、実行中の競合を防ぐため、ヘッダー系の操作ハンドラにもガードを追加する（`render()` 内の各 onClick / onChange の先頭に `if (this.batchRunner.running) return` を入れる）。対象: リロードボタン・保存ボタン・Undo/Redo ボタン・タグ情報ドロップダウン・上/下/削除ボタン。「■ 停止」ボタンにはガードを入れない（実行中に押すためのボタン）。

- [ ] **Step 4: 単体テストの回帰確認**

Run: `node --test`
Expected: 全件 PASS

- [ ] **Step 5: WebUI 実機確認**

WebUI の UI Reload 後、以下を確認する:

1. 「一括生成モード」ON でテンプレボタンのクリックが選択トグルになる（枠線表示・件数カウント）。OFF で通常適用に戻り選択はクリアされる
2. プロンプト欄にキャラ+衣装（例: `10_キャラ_ブルアカ` + `13_衣装_基本`）を組んだ状態で 2〜3 テンプレを選択して「▶ 一括生成」→ 各テンプレが適用され、キャラ/衣装が差し替わった状態で順次生成される
3. キャラセクションの無いテンプレ（例: `うさぎのポーズ 水彩画風`）はそのまま生成される
4. モデルの異なるテンプレを跨いでもモデル切替を待ってから生成される
5. 「■ 停止」で現在の生成完了後に止まり、`完了（停止）: 成功 N 件 / 失敗 M 件` が表示される
6. 生成中に手動 Interrupt しても次のテンプレへ進む
7. 実行中にタグボタン・テンプレボタン・保存・Undo/Redo を押しても無視される（プロンプト欄が壊れない）
8. モデルロードが遅いテンプレ（初回ロードの大きいモデル）でも、書き戻しの静穏検知とモデル待ちを経て差し替えが確実に反映される（生成画像の infotext で差し替え後のキャラタグを確認する）
9. 差し替えが反映できない状況を擬似的に作った場合（例: 静穏待ちタイムアウトを一時的に極端に短くする）、失敗としてカウントされ元キャラのまま生成されないこと

- [ ] **Step 6: コミット**

```bash
git add javascript/easy_template_selector.js
git commit -m "feat(batch): テンプレ一覧に一括生成モードと実行・停止・進捗 UI を追加"
```

---

### Task 4: ドキュメント更新

**Files:**
- Modify: `CLAUDE.md`（System Structure のファイル一覧と落とし穴の追記）
- Modify: `README.md`（使い方の追記。既存の記述スタイルに合わせる）

**Interfaces:**
- Consumes: Task 1〜3 の実装内容
- Produces: なし

- [ ] **Step 1: CLAUDE.md を更新する**

- `System Structure` のファイル一覧に `ets_batch_runner.js` の行を追加: `│   ├── ets_batch_runner.js       # ETSBatchRunner: キャラ/衣装差し替えの一括生成（順次実行・待機制御）`
- `Coding Conventions` に以下の要点を追記:
  - 差し替え対象は `SWAP_PREFIXES`（`10_キャラ` / `13_衣装` / `14_衣装小物` / `15_衣装状態` の前方一致）。カテゴリ帯を増やすときはここを更新する
  - 生成完了の判定は `#txt2img_interrupt` の表示状態のポーリング。本体 UI の構造変更で壊れうる
  - 落とし穴: `applyTemplate()` の pnginfo 貼り付けは非同期にプロンプト欄を書き戻すため、差し替えは「プロンプト欄の静穏検知 → 反映確認つき再試行 → 失敗なら当該テンプレをエラー扱い」で行っている。ここの待機・確認を削ると差し替えが上書きされて消える

- [ ] **Step 2: README.md に使い方を追記する**

「一括生成モード」節を追加: モードの入り方、キャラ+衣装をプロンプト欄に組んでから実行する手順、キャラなしテンプレはそのまま生成されること、Seed はテンプレの値が使われること、停止の挙動。差し替え境界も明記する: 対象は `10_キャラ*` / `13_衣装*` / `14_衣装小物*` / `15_衣装状態*` のみで、体型（11）・容姿（12）・肌の状態（16）はテンプレ側の値が維持される。

- [ ] **Step 3: コミット**

```bash
git add CLAUDE.md README.md
git commit -m "docs: 一括生成モードの仕様と使い方を追記"
```

---

## レビュー却下メモ

- `batchTemplateName()` が `addTag()` 内のテンプレ名組み立てと重複 — 共通化には `ets_prompt_editor.js` 側の改変が必要で、3 行の重複解消に対しリスクが見合わない（未確認のまま見送りではなく判断済み却下）
- `11_体型` / `12_容姿` / `16_肌の状態` を差し替え対象に含めるべきでは — ヒアリングで「10_キャラ* + 13〜15_衣装*」を明示選択済み（選択肢に 11/12/16 を含める案も提示した上での決定）。README への境界明記のみ取り込み
