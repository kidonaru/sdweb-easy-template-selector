# easy_prompt_selector.js 6ファイル分割リファクタ実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `javascript/easy_prompt_selector.js`(1580 行)を責務ごとに 6 ファイルへ分割する。挙動は一切変更しない。

**Architecture:** 既存 3 クラスのうち `ETSSection` / `ETSElementBuilder` はそのままファイル移動。神クラス `EasyTemplateSelector` から `ETSHistory`(Undo/Redo)、`ETSTemplateManager`(テンプレート・メタ情報)、`ETSPromptEditor`(プロンプト編集)を抽出し、メインクラスは UI 描画と結線だけを持つ。各タスク完了時点で拡張は動作可能な状態を保つ(段階的抽出)。

**Tech Stack:** Vanilla JS(クラシックスクリプト、ES Modules 不可)。WebUI が `javascript/` 配下をアルファベット順に `<script>` 読み込み。

**Spec:** `docs/superpowers/specs/2026-07-22-js-refactor-design.md`

## Global Constraints

- 挙動変更禁止。メソッド本体は「移動 + `this.xxx` 参照の付け替え」のみ。ロジックの書き換え・改善は行わない。
- 各ファイルのトップレベルで他ファイルのクラスを参照しない(参照はすべて関数/メソッド内の実行時のみ)。
- `javascript/js-yaml.min.js` は変更禁止。
- コメントは日本語。既存コメントは移動時にそのまま維持。
- 各タスク末尾で `node --check` による構文検証を行ってからコミットする。ただし `node --check` は構文エラーしか検出しない（委譲漏れ・注入ミス由来の `ReferenceError` は Task 7 の手動確認でのみ検出できる）ことに注意。
- 検証用の `grep` / `for` コマンドは bash 構文。必ず Bash ツールで実行する（PowerShell に貼らない）。
- テスト基盤はない。最終タスクで reForge 上の手動確認を行う。

## 依存関係の全体像(実装前に読むこと)

元の `EasyTemplateSelector` のメソッド間依存(クラス抽出後の呼び先):

| 呼び出し元(移動先クラス) | 呼び先 | 抽出後の参照 |
|---|---|---|
| `addTag`(PromptEditor) | `applyMeta` / `applyTemplate` | `this.templateManager.xxx` |
| `addTag` / `removeTag` / `moveTag`(PromptEditor) | `saveTextHistory` | `this.history.saveTextHistory()` |
| `applyTemplate`(TemplateManager) | `resetTextHistory` / `saveTextHistory` | `this.history.xxx` |
| `applyTemplate`(TemplateManager) | `currentSection` 書き換え + `updateTagInfo` | `this.promptEditor.xxx`(setter 注入) |
| `saveTemplate`(TemplateManager) | `this.tags` 参照 / `this.init()` | コンストラクタ注入の `getTags()` / `reinit()` |
| `undoLastAction` 等(History) | `EasyTemplateSelector.IDS.UNDO_BUTTON` 等 | コンストラクタ注入の `ids` |

生成順(循環参照の回避): `history` → `templateManager` → `promptEditor` → `templateManager.setPromptEditor(promptEditor)`。

---

### Task 1: ETSSection を `ets_section.js` へ移動

**Files:**
- Create: `javascript/ets_section.js`
- Modify: `javascript/easy_prompt_selector.js`(370〜470 行目の `class ETSSection { ... }` を削除)

**Interfaces:**
- Produces: グローバルクラス `ETSSection`(constructor(comment, tag, category)、既存メソッドすべて)。変更なし。

- [ ] **Step 1: `javascript/ets_section.js` を作成**

`easy_prompt_selector.js` の `class ETSSection {`(370 行目)から対応する閉じ `}`(470 行目)までを**一字一句そのまま**新ファイルにコピーする。ファイル先頭に以下のヘッダコメントを付ける:

```javascript
// プロンプト内のセクション（カテゴリ単位のブロック）の表現・判定・文字列化
```

- [ ] **Step 2: `easy_prompt_selector.js` から `class ETSSection { ... }` ブロックを削除**

- [ ] **Step 3: 構文検証**

Run: `node --check javascript/ets_section.js && node --check javascript/easy_prompt_selector.js`
Expected: エラーなし(出力なし)

- [ ] **Step 4: コミット**

```bash
git add javascript/ets_section.js javascript/easy_prompt_selector.js
git commit -m "refactor: ETSSection を ets_section.js へ分離"
```

---

### Task 2: ETSElementBuilder を `ets_element_builder.js` へ移動

**Files:**
- Create: `javascript/ets_element_builder.js`
- Modify: `javascript/easy_prompt_selector.js`(先頭の `class ETSElementBuilder { ... }`、1〜368 行目相当を削除)

**Interfaces:**
- Produces: グローバルクラス `ETSElementBuilder`(static メソッド群)。変更なし。

- [ ] **Step 1: `javascript/ets_element_builder.js` を作成**

`class ETSElementBuilder {` から対応する閉じ `}` までを一字一句そのままコピー。ファイル先頭にヘッダコメント:

```javascript
// UI 用 DOM 要素（ボタン・ドロップダウン・テキストエリア等）の生成
```

- [ ] **Step 2: `easy_prompt_selector.js` から `class ETSElementBuilder { ... }` ブロックを削除**

- [ ] **Step 3: 構文検証**

Run: `node --check javascript/ets_element_builder.js && node --check javascript/easy_prompt_selector.js`
Expected: エラーなし

- [ ] **Step 4: コミット**

```bash
git add javascript/ets_element_builder.js javascript/easy_prompt_selector.js
git commit -m "refactor: ETSElementBuilder を ets_element_builder.js へ分離"
```

---

### Task 3: ETSHistory を `ets_history.js` へ抽出

**Files:**
- Create: `javascript/ets_history.js`
- Modify: `javascript/easy_prompt_selector.js`

**Interfaces:**
- Produces: グローバルクラス `ETSHistory`。
  - `constructor({ ids })` — `ids` は `{ UNDO_BUTTON, REDO_BUTTON }` を含むオブジェクト
  - `undoLastAction()` / `redoLastAction()` / `saveTextHistory()` / `resetTextHistory()` / `restoreFromHistory(index)` / `updateUndoRedoButtons()`
- Consumes: グローバル関数 `gradioApp()` / `updateInput()`(WebUI 提供、実行時参照)

- [ ] **Step 1: `javascript/ets_history.js` を作成**

以下の骨格で作成する。各メソッド本体は `easy_prompt_selector.js` の `undoLastAction` / `redoLastAction` / `saveTextHistory` / `resetTextHistory` / `restoreFromHistory` / `updateUndoRedoButtons` を**そのまま移動**し、`EasyTemplateSelector.IDS.UNDO_BUTTON` → `this.ids.UNDO_BUTTON`、`EasyTemplateSelector.IDS.REDO_BUTTON` → `this.ids.REDO_BUTTON` の 2 箇所だけ置換する:

```javascript
// プロンプトテキストの Undo/Redo 履歴管理
class ETSHistory {
  constructor({ ids }) {
    this.ids = ids
    this.textHistory = []
    this.currentHistoryIndex = -1
    this.maxHistoryLength = 20
  }

  // （ここに undoLastAction / redoLastAction / saveTextHistory /
  //   resetTextHistory / restoreFromHistory / updateUndoRedoButtons を移動）
}
```

- [ ] **Step 2: `easy_prompt_selector.js` を修正**

1. コンストラクタから `this.textHistory` / `this.currentHistoryIndex` / `this.maxHistoryLength` の 3 行を削除し、代わりに追加:
   ```javascript
   this.history = new ETSHistory({ ids: EasyTemplateSelector.IDS })
   ```
2. 上記 6 メソッドを `EasyTemplateSelector` から削除。
3. クラス内の呼び出しを置換(この時点で残っている呼び出し元):
   - `render()` 内: `this.undoLastAction()` → `this.history.undoLastAction()`、`this.redoLastAction()` → `this.history.redoLastAction()`、`this.updateUndoRedoButtons()` → `this.history.updateUndoRedoButtons()`
   - `addTag` / `removeTag` / `moveTag` 内: `this.saveTextHistory()` → `this.history.saveTextHistory()`
   - `applyTemplate` 内: `this.resetTextHistory()` → `this.history.resetTextHistory()`、`this.saveTextHistory()` → `this.history.saveTextHistory()`

- [ ] **Step 3: 構文検証と参照漏れチェック**

Run: `node --check javascript/ets_history.js && node --check javascript/easy_prompt_selector.js`
Expected: エラーなし

Run: `grep -nE "this\.(saveTextHistory|resetTextHistory|restoreFromHistory|updateUndoRedoButtons|undoLastAction|redoLastAction|textHistory|currentHistoryIndex|maxHistoryLength)\b" javascript/easy_prompt_selector.js`
Expected: ヒットなし(全て `this.history.` 経由になっている)

- [ ] **Step 4: コミット**

```bash
git add javascript/ets_history.js javascript/easy_prompt_selector.js
git commit -m "refactor: Undo/Redo 履歴管理を ETSHistory (ets_history.js) へ抽出"
```

---

### Task 4: ETSTemplateManager を `ets_template_manager.js` へ抽出

**Files:**
- Create: `javascript/ets_template_manager.js`
- Modify: `javascript/easy_prompt_selector.js`

**Interfaces:**
- Produces: グローバルクラス `ETSTemplateManager`。
  - `constructor({ ids, history, getTags, reinit })` — `ids`: `EasyTemplateSelector.IDS`、`history`: `ETSHistory` インスタンス、`getTags`: `() => tags` オブジェクトを返す関数、`reinit`: `async () => void`(保存/再読込後の再初期化)
  - `setPromptEditor(promptEditor)` — 循環参照回避のための setter 注入(Task 5 で結線)
  - `applyTemplate(template, templateName)` / `convertToTemplate(prompt, negPrompt, metaDataMap)` / `parseMetaText(metaText)` / `getCurrentMetaDataMap()` / `saveTemplate()` / `applyMeta(key, value)` / `getMetaElement(key)` / `getCurrentModel()` / `getCurrentSize()`
- Consumes: `ETSHistory`(Task 3)、グローバル `gradioApp()` / `updateInput()` / `selectCheckpoint()`

- [ ] **Step 1: `javascript/ets_template_manager.js` を作成**

骨格:

```javascript
// テンプレートの適用・保存とメタ情報（モデル・解像度等）の読み書き
class ETSTemplateManager {
  constructor({ ids, history, getTags, reinit }) {
    this.ids = ids
    this.history = history
    this.getTags = getTags
    this.reinit = reinit
    this.promptEditor = null

    this.metaInfoMap = [
      // （EasyTemplateSelector コンストラクタの metaInfoMap 配列をそのまま移動。
      //   先頭要素の EasyTemplateSelector.IDS.TEMPLATE_NAME は ids.TEMPLATE_NAME に置換）
    ]
  }

  // 循環参照回避のため生成後に注入する
  setPromptEditor(promptEditor) {
    this.promptEditor = promptEditor
  }

  // （ここに applyTemplate / convertToTemplate / parseMetaText /
  //   getCurrentMetaDataMap / saveTemplate / applyMeta / getMetaElement /
  //   getCurrentModel / getCurrentSize を移動）
}
```

各メソッドは元コードをそのまま移動し、以下だけ置換する:

| 元の参照(移動対象メソッド内) | 置換後 |
|---|---|
| `this.resetTextHistory()` / `this.saveTextHistory()`(applyTemplate 内、Task 3 適用後は `this.history.` 済み) | そのまま `this.history.xxx` |
| `EasyTemplateSelector.IDS.IMAGE_INFO` / `EasyTemplateSelector.IDS.APPLY_BUTTON`(applyTemplate 内) | `this.ids.IMAGE_INFO` / `this.ids.APPLY_BUTTON` |
| `this.currentSection = new ETSSection(null, null, null)` と `this.updateTagInfo()`(applyTemplate 末尾) | `this.promptEditor.selectNone()`(Task 5 で定義。Task 4 時点では暫定的に `this.promptEditor?.selectNone()` と書く) |

**注意(既知の一時的退行):** Task 4 コミット単体では `promptEditor` が未結線(null)のため、テンプレート適用後の「選択リセット + タグ情報ドロップダウン更新」が no-op になる。Task 5 の結線で復旧する仕様であり、Task 4 と Task 5 の間で単体動作確認を行わないこと。
| `this.tags['00_テンプレート']`(saveTemplate 内) | `this.getTags()['00_テンプレート']` |
| `await this.init()`(saveTemplate 内) | `await this.reinit()` |

- [ ] **Step 2: `easy_prompt_selector.js` を修正**

1. コンストラクタから `this.metaInfoMap = [ ... ]` ブロックを削除し、代わりに追加(`this.history = ...` の直後):
   ```javascript
   this.templateManager = new ETSTemplateManager({
     ids: EasyTemplateSelector.IDS,
     history: this.history,
     getTags: () => this.tags,
     reinit: async () => await this.init(),
   })
   ```
2. 上記 9 メソッドを `EasyTemplateSelector` から削除。
3. 残る呼び出し元を置換:
   - `render()` 内: `this.saveTemplate()` → `this.templateManager.saveTemplate()`
   - `addTag` 内: `this.applyMeta(...)` → `this.templateManager.applyMeta(...)`、`this.applyTemplate(...)` → `this.templateManager.applyTemplate(...)`

- [ ] **Step 3: 構文検証と参照漏れチェック**

Run: `node --check javascript/ets_template_manager.js && node --check javascript/easy_prompt_selector.js`
Expected: エラーなし

Run: `grep -nE "this\.(applyTemplate|convertToTemplate|parseMetaText|getCurrentMetaDataMap|saveTemplate|applyMeta|getMetaElement|getCurrentModel|getCurrentSize|metaInfoMap)\b" javascript/easy_prompt_selector.js`
Expected: ヒットなし(全て `this.templateManager.` 経由)

- [ ] **Step 4: コミット**

```bash
git add javascript/ets_template_manager.js javascript/easy_prompt_selector.js
git commit -m "refactor: テンプレート・メタ情報管理を ETSTemplateManager (ets_template_manager.js) へ抽出"
```

---

### Task 5: ETSPromptEditor を `ets_prompt_editor.js` へ抽出

**Files:**
- Create: `javascript/ets_prompt_editor.js`
- Modify: `javascript/easy_prompt_selector.js`

**Interfaces:**
- Produces: グローバルクラス `ETSPromptEditor`。
  - `constructor({ ids, history, templateManager })`
  - `currentSection` プロパティ(`ETSSection`)
  - `splitSections(content)` / `parseSection(section)` / `addTag(comment, tag, category, isAddMode)` / `removeTag(targetSection)` / `moveTag(targetSection, direction)` / `updateTagInfo()` / `selectCurrent(section)` / `selectNone()`
- Consumes: `ETSSection`(Task 1)、`ETSHistory`(Task 3)、`ETSTemplateManager`(Task 4)、グローバル `gradioApp()` / `updateInput()`

- [ ] **Step 1: `javascript/ets_prompt_editor.js` を作成**

骨格:

```javascript
// プロンプトテキストのセクション分解とタグの追加・削除・移動・選択状態管理
class ETSPromptEditor {
  constructor({ ids, history, templateManager }) {
    this.ids = ids
    this.history = history
    this.templateManager = templateManager
    this.currentSection = new ETSSection(null, null, null)
  }

  // 選択状態を初期化しタグ情報ドロップダウンを更新する
  selectNone() {
    this.currentSection = new ETSSection(null, null, null)
    this.updateTagInfo()
  }

  // （ここに splitSections / parseSection / addTag / removeTag /
  //   moveTag / updateTagInfo / selectCurrent を移動）
}
```

各メソッドは元コードをそのまま移動し、以下だけ置換する:

| 元の参照 | 置換後 |
|---|---|
| `this.templateManager.applyMeta(...)` / `this.templateManager.applyTemplate(...)`(Task 4 適用後の addTag 内) | そのまま(`this.templateManager` はコンストラクタ注入済み) |
| `this.history.saveTextHistory()`(Task 3 適用後) | そのまま |
| `EasyTemplateSelector.IDS.TAG_INFO`(updateTagInfo 内) | `this.ids.TAG_INFO` |

- [ ] **Step 2: `easy_prompt_selector.js` を修正**

1. コンストラクタの `this.currentSection = new ETSSection(null, null, null)` を削除し、`this.templateManager = ...` の直後に追加:
   ```javascript
   this.promptEditor = new ETSPromptEditor({
     ids: EasyTemplateSelector.IDS,
     history: this.history,
     templateManager: this.templateManager,
   })
   this.templateManager.setPromptEditor(this.promptEditor)
   ```
2. 上記 7 メソッドを `EasyTemplateSelector` から削除。
3. `ets_template_manager.js` の `applyTemplate` 末尾の暫定 `this.promptEditor?.selectNone()` を `this.promptEditor.selectNone()` に確定する。
4. 残る呼び出し元を置換:
   - `render()` 内: `this.moveTag(this.currentSection, -1)` → `this.promptEditor.moveTag(this.promptEditor.currentSection, -1)`(+1 側も同様)、`this.removeTag(this.currentSection)` → `this.promptEditor.removeTag(this.promptEditor.currentSection)`、`this.parseSection(value)` → `this.promptEditor.parseSection(value)`、`this.selectCurrent(selectedSection)` → `this.promptEditor.selectCurrent(selectedSection)`
   - `renderTagButton` 内: `this.addTag(...)` → `this.promptEditor.addTag(...)`、`this.removeTag(targetSection)` → `this.promptEditor.removeTag(targetSection)`

- [ ] **Step 3: 構文検証と参照漏れチェック**

Run: `node --check javascript/ets_prompt_editor.js && node --check javascript/ets_template_manager.js && node --check javascript/easy_prompt_selector.js`
Expected: エラーなし

Run: `grep -nE "this\.(splitSections|parseSection|addTag|removeTag|moveTag|updateTagInfo|selectCurrent|currentSection)\b" javascript/easy_prompt_selector.js`
Expected: ヒットなし

- [ ] **Step 4: コミット**

```bash
git add javascript/ets_prompt_editor.js javascript/ets_template_manager.js javascript/easy_prompt_selector.js
git commit -m "refactor: プロンプト編集ロジックを ETSPromptEditor (ets_prompt_editor.js) へ抽出"
```

---

### Task 6: メインファイルのリネームと CLAUDE.md 更新

**Files:**
- Rename: `javascript/easy_prompt_selector.js` → `javascript/easy_template_selector.js`(git mv)
- Modify: `CLAUDE.md`(System Structure セクションと規約追記)

**Interfaces:**
- Consumes: Task 1〜5 の全クラス。
- Produces: 最終ファイル構成(spec 参照)。

- [ ] **Step 1: リネーム前の確認**

Run: `grep -rn "easy_prompt_selector" scripts/ *.py 2>/dev/null; grep -n "easy_prompt_selector" scripts/*.py`
Expected: JS ファイル名への参照がないこと(あれば追随修正してからリネーム)

- [ ] **Step 2: git mv でリネーム**

```bash
git mv javascript/easy_prompt_selector.js javascript/easy_template_selector.js
```

- [ ] **Step 3: CLAUDE.md の System Structure を更新**

`javascript/` の項を以下に置き換え:

```
├── javascript/
│   ├── easy_template_selector.js # エントリポイント（タグ読込・UI 描画・各クラスの結線）
│   ├── ets_section.js            # ETSSection: セクション表現・判定
│   ├── ets_element_builder.js    # ETSElementBuilder: DOM 生成
│   ├── ets_prompt_editor.js      # ETSPromptEditor: タグ追加/削除/移動・選択管理
│   ├── ets_template_manager.js   # ETSTemplateManager: テンプレート適用/保存・メタ情報
│   ├── ets_history.js            # ETSHistory: Undo/Redo 履歴
│   └── js-yaml.min.js            # YAML パーサ（vendored、編集禁止）
```

Coding Conventions に追記:

```
- `javascript/` 配下の各ファイルは、トップレベルで他ファイルのクラスを参照しないこと（WebUI はアルファベット順に読み込むため、クラス参照は `onUiLoaded` 以降の実行時に限る）。
```

- [ ] **Step 4: 構文検証**

Run: `for f in javascript/*.js; do node --check "$f"; done`
Expected: 全ファイルでエラーなし(js-yaml.min.js 含む)

- [ ] **Step 5: コミット**

```bash
git add -A javascript/ CLAUDE.md
git commit -m "refactor: メインファイルを easy_template_selector.js へリネームし CLAUDE.md を更新"
```

---

### Task 7: 動作確認(手動)

**Files:** なし(検証のみ)

- [ ] **Step 1: WebUI を再起動してから UI をリロード**

今回は `ets_*.js` を**新規追加**しているため、サーバ側の `<script>` インクルードリスト再生成が必要。ブラウザリロードだけでは新規ファイルが読み込まれず、新クラスが `undefined` になる場合がある。**必ず WebUI(reForge)を再起動**してからブラウザをリロードすること。パネルが出ない・コンソールに `XXX is not defined` が出る場合はまず再起動漏れを疑う。

- [ ] **Step 2: 以下を確認**

1. 「🔯タグを選択」パネルが表示され、タブ切替が動く
2. タグボタン左クリックでプロンプトへ追加、右クリックで削除
3. テンプレートボタンでテンプレート適用(メタ情報・モデル・解像度反映含む)
4. テンプレート名入力 → 💾 で保存できる(上書き確認ダイアログ含む)
5. ⬆️⬇️🗑️ でセクションの移動・削除
6. ↩️↪️ で Undo/Redo(ボタンの活性/非活性も)
7. タグ情報ドロップダウンで選択セクションが切り替わる
8. 96_解像度 タブで Width/Height が反映される
9. 🔄 で再読み込みできる
10. ブラウザのコンソールにエラーが出ていない

- [ ] **Step 3: 問題があれば該当タスクへ戻り修正、なければ完了**
