# モデル反映トグル Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** テンプレート適用時にチェックポイント（モデル）切り替えをスキップできる「モデル反映」チェックボックスをヘッダーに追加する。

**Architecture:** `ETSTemplateManager` に `applyModel` フラグ（初期値 `true`、メモリ保持のみ）を追加し、`applyTemplate()` 内の `selectCheckpoint` 呼び出しをフラグでガードする。UI は `easy_template_selector.js` のヘッダーに既存の `ETSElementBuilder.checkbox()` で追加する。

**Tech Stack:** Vanilla JavaScript（Stable Diffusion WebUI / reForge 拡張）。ビルド・テスト基盤なし、動作確認は WebUI 上で手動。

## Global Constraints

- コードのコメントは日本語で記述する。
- `javascript/` 配下のファイルはトップレベルで他ファイルのクラスを参照しない（実行時参照のみ）。
- 状態は localStorage 等で永続化しない（セッション限り、デフォルトはオン）。
- テンプレート保存側（`Model` メタの書き出し）は変更しない。

---

### Task 1: ETSTemplateManager にモデル反映フラグを追加

**Files:**
- Modify: `javascript/ets_template_manager.js`（constructor と `applyTemplate()` の `selectCheckpoint` 部、現行 126-132 行付近）

**Interfaces:**
- Produces: `templateManager.applyModel`（boolean プロパティ、初期値 `true`）。Task 2 の UI がこのプロパティを直接代入で更新する。

- [ ] **Step 1: constructor にフラグを追加**

`javascript/ets_template_manager.js` の constructor 内、`this.promptEditor = null` の直後に追加:

```javascript
    // テンプレート適用時にモデル（checkpoint）を切り替えるか（セッション限り、永続化しない）
    this.applyModel = true
```

- [ ] **Step 2: selectCheckpoint 呼び出しをガード**

`applyTemplate()` 内の以下のブロック:

```javascript
    const modelName = metaDataMap['Model']
    if (modelName != this.getCurrentModel()) {
```

を次に変更:

```javascript
    const modelName = metaDataMap['Model']
    if (this.applyModel && modelName != this.getCurrentModel()) {
```

- [ ] **Step 3: 構文チェック**

Run: `node --check "javascript/ets_template_manager.js"`
Expected: エラーなし（終了コード 0）

- [ ] **Step 4: Commit**

```bash
git add javascript/ets_template_manager.js
git commit -m "feat: テンプレート適用時のモデル切替を applyModel フラグでガード"
```

### Task 2: ヘッダーに「モデル反映」チェックボックスを追加

**Files:**
- Modify: `javascript/easy_template_selector.js`（`render()` のヘッダー組み立て部、現行 131-163 行付近）

**Interfaces:**
- Consumes: Task 1 の `this.templateManager.applyModel`、既存の `ETSElementBuilder.checkbox(text, checked, { onChange })`

- [ ] **Step 1: チェックボックスを生成しヘッダーに追加**

注意: 以下の追加はいずれも、ヘッダーを組み立てる `if (!container)` ブロックの内側（`saveButton` と同じスコープ）に入れること。`render()` はコンテナ既存時にヘッダーを再構築しないため、ブロック外に置くと動かない。

`render()` 内、`saveButton` の定義（`const saveButton = ...` ブロック）の直後に追加:

```javascript
      const applyModelCheckbox = ETSElementBuilder.checkbox('モデル反映', this.templateManager.applyModel, {
        onChange: (checked) => {
          this.templateManager.applyModel = checked
        }
      })
```

`container.header.appendChild(saveButton)` の直後に追加:

```javascript
      container.header.appendChild(applyModelCheckbox)
```

- [ ] **Step 2: 構文チェック**

Run: `node --check "javascript/easy_template_selector.js"`
Expected: エラーなし（終了コード 0）

- [ ] **Step 3: WebUI で手動確認**

WebUI の UI Reload 後に確認:
1. ヘッダーの保存ボタン右に「モデル反映」チェックボックスが表示され、初期状態はオン。
2. オンのままテンプレート適用 → モデルが切り替わる（コンソールに `selectCheckpoint` ログ）。
3. オフにしてテンプレート適用 → モデルは切り替わらず、プロンプト・Steps 等は反映される。
4. ブラウザのページリロード（`init` 再実行）→ チェックはオンに戻る。※ ヘッダーの 🔄 リロードボタンは `templateManager` を再生成しないため状態が保持されてよい。

- [ ] **Step 4: Commit**

```bash
git add javascript/easy_template_selector.js
git commit -m "feat: ヘッダーにモデル反映チェックボックスを追加"
```
