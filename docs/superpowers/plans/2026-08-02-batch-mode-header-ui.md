# 一括生成モードのヘッダー UI 切り替え 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一括生成モード中はヘッダーの編集系 UI を一括生成の操作列に差し替え、プロンプト欄を読み取り専用にし、実行状態に応じて `▶ 一括生成` と `■ 停止` を出し分ける。

**Architecture:** ヘッダーは `render()` の `if (!container)` ブロックで**一度だけ**構築され、以降の `render()` では作り直されない。そのため「モードで表示を変える」要素は、生成時に ID を振っておき、`syncBatchModeUi()` が `style.display` を切り替える方式にする。編集系（タグ情報ドロップダウン・上・下・削除）は 1 つのラッパー `div` にまとめて一括で隠し、その隣に一括生成の操作列（実行・停止・進捗）を常設して排他表示する。実行状態の反映は `syncBatchControls()` に集約し、モード切替・実行開始・実行終了・停止要求の 4 箇所から呼ぶ。

**Tech Stack:** Vanilla JS（WebUI 拡張、ビルドなし）、`node --test`（純粋ロジックの単体テスト）

**先行実装:** `docs/superpowers/plans/2026-08-02-batch-swap-selection.md`（コミット `5e57d42` / `0198cc9` / `611f5f5` / `27c1c8a`）。本計画はその上に載る差分。

## Global Constraints

- コードのコメント・エラーログメッセージは日本語で書く
- `javascript/` 配下のファイルはトップレベルで他ファイルのクラスを参照しない（クラス参照は実行時のみ）
- `javascript/js-yaml.min.js` は編集しない
- ヘッダーは `render()` の `if (!container)` の中でしか構築されない。**モードで見た目を変える要素は「作り直す」のではなく「表示を切り替える」**
- 「■ 停止」は実行中に押すボタンなので `guardBatchRunning()` でラップしない。それ以外の操作系は従来どおりラップする
- 本タスクの変更はすべて DOM 依存のため単体テストを追加しない。既存 67 件が PASS することを回帰確認とする
- JS の変更は WebUI の UI Reload で反映される（再起動不要）

## 仕様の決定事項（ヒアリング済み）

| 論点 | 決定 |
|---|---|
| 実行/停止ボタン | 排他表示。非実行中は `▶ 一括生成` のみ、実行中は `■ 停止` のみ |
| モード中に隠すヘッダー要素 | タグ情報ドロップダウン・上・下・削除の 4 つ |
| 一括生成の操作列の位置 | ヘッダー行（隠した 4 要素の位置）へ移す。タブ行からは撤去する |
| プロンプト欄の無効化 | ポジティブ・ネガティブの両方 |
| 保存 / Undo / Redo / 再読み込み / テンプレート名 | 表示したまま（既存の `guardBatchRunning()` によるガードを維持） |

## 表示状態の一覧

| 要素 | モード OFF | モード ON・非実行中 | モード ON・実行中 |
|---|---|---|---|
| 編集系ラッパー（ドロップダウン・上・下・削除） | 表示 | 非表示 | 非表示 |
| `▶ 一括生成` | 非表示 | 表示 | 非表示 |
| `■ 停止` | 非表示 | 非表示 | 表示 |
| 進捗表示 | 非表示 | 表示 | 表示 |
| プロンプト欄（ポジ・ネガ） | 編集可 | 読み取り専用 | 読み取り専用 |

## File Structure

| ファイル | 責務 | 本計画での変更 |
|---|---|---|
| `javascript/easy_template_selector.js` | UI 描画・選択状態・結線 | ヘッダーへの操作列常設、表示切り替えの集約、プロンプト欄の readonly 化 |
| `CLAUDE.md` | 規約 | ヘッダー UI 切り替えの前提を追記 |
| `README.md` | 使い方 | モード中の UI の説明を更新 |

---

### Task 1: ヘッダーへの操作列常設と表示切り替えの集約

**Files:**
- Modify: `javascript/easy_template_selector.js`

**Interfaces:**
- Consumes: 既存の `renderBatchControls()` / `batchSelectionSummary()` / `guardBatchRunning()` / `this.batchRunner.running`
- Produces:
  - `EasyTemplateSelector.IDS` に `EDIT_CONTROLS` / `BATCH_CONTROLS` / `BATCH_RUN_BUTTON` / `BATCH_STOP_BUTTON` を追加
  - `#syncBatchControls()`（実行状態に応じて実行/停止ボタンの表示を切り替える）
  - `#syncBatchModeUi()`（モードに応じて編集系ラッパー・操作列・プロンプト欄の状態を切り替える。内部で `syncBatchControls()` を呼ぶ）
  - `#setPromptsReadOnly(readOnly)`

- [ ] **Step 1: ID 定数を追加する**

`static IDS` の `BATCH_PROGRESS` の次に 4 行足す:

```javascript
    BATCH_PROGRESS: 'easy_template_selector_batch_progress',
    EDIT_CONTROLS: 'easy_template_selector_edit_controls',
    BATCH_CONTROLS: 'easy_template_selector_batch_controls',
    BATCH_RUN_BUTTON: 'easy_template_selector_batch_run_button',
    BATCH_STOP_BUTTON: 'easy_template_selector_batch_stop_button'
```

（既存の `BATCH_PROGRESS` 行は末尾にカンマが無いので、カンマを足してから追記する）

- [ ] **Step 2: ヘッダーの編集系 4 要素をラッパーへまとめ、操作列を常設する**

`render()` の `if (!container)` ブロック末尾、`container.header.appendChild(...)` が並んでいる箇所を以下で置き換える:

```javascript
      // 一括生成モード中はまとめて隠すので、編集系はラッパーに入れておく
      const editControls = document.createElement('div')
      editControls.id = EasyTemplateSelector.IDS.EDIT_CONTROLS
      editControls.style.display = 'flex'
      editControls.style.alignItems = 'center'
      editControls.style.gap = '4px'
      editControls.appendChild(tagInfoSelect)
      editControls.appendChild(upButton)
      editControls.appendChild(downButton)
      editControls.appendChild(deleteButton)

      container.header.appendChild(reloadButton)
      container.header.appendChild(undoButton)
      container.header.appendChild(redoButton)
      container.header.appendChild(templateNameArea)
      container.header.appendChild(saveButton)
      container.header.appendChild(editControls)
      // ヘッダーは初回しか構築されないので、操作列も常設して表示だけ切り替える
      container.header.appendChild(this.renderBatchControls())
```

- [ ] **Step 3: `renderBatchControls()` を ID 付き・排他表示に対応させる**

既存の `renderBatchControls()` を以下で置き換える:

```javascript
  // 一括生成の実行・停止・進捗の操作列。ヘッダーに常設し、表示は syncBatchModeUi() が切り替える
  renderBatchControls() {
    const controls = document.createElement('div')
    controls.id = EasyTemplateSelector.IDS.BATCH_CONTROLS
    controls.style.display = 'none'
    controls.style.alignItems = 'center'
    controls.style.gap = '4px'

    const runButton = ETSElementBuilder.baseButton('▶ 一括生成', { color: 'primary' })
    runButton.id = EasyTemplateSelector.IDS.BATCH_RUN_BUTTON
    runButton.addEventListener('click', this.guardBatchRunning(() => this.startBatch()))
    controls.appendChild(runButton)

    // 停止は実行中に押すボタンなのでガードしない
    const stopButton = ETSElementBuilder.baseButton('■ 停止', { color: 'secondary' })
    stopButton.id = EasyTemplateSelector.IDS.BATCH_STOP_BUTTON
    stopButton.addEventListener('click', () => {
      this.batchRunner.stop()
      this.syncBatchControls()
    })
    controls.appendChild(stopButton)

    const progress = document.createElement('span')
    progress.id = EasyTemplateSelector.IDS.BATCH_PROGRESS
    progress.style.alignSelf = 'center'
    progress.style.whiteSpace = 'nowrap'
    progress.textContent = this.batchSelectionSummary()
    controls.appendChild(progress)

    return controls
  }
```

- [ ] **Step 4: 表示切り替えのメソッドを追加する**

`updateBatchProgress()` の直前に以下を追加する:

```javascript
  // 実行状態に応じて実行/停止ボタンを出し分ける（排他表示）
  syncBatchControls() {
    const running = this.batchRunner.running
    const runButton = gradioApp().getElementById(EasyTemplateSelector.IDS.BATCH_RUN_BUTTON)
    const stopButton = gradioApp().getElementById(EasyTemplateSelector.IDS.BATCH_STOP_BUTTON)
    if (runButton) {
      runButton.style.display = running ? 'none' : ''
    }
    if (stopButton) {
      stopButton.style.display = running ? '' : 'none'
    }
  }

  // 一括生成モードの ON/OFF でヘッダーとプロンプト欄の状態を切り替える。
  // ヘッダーは初回の render() でしか構築されないため、作り直しではなく表示の切り替えで行う
  syncBatchModeUi() {
    const editControls = gradioApp().getElementById(EasyTemplateSelector.IDS.EDIT_CONTROLS)
    if (editControls) {
      editControls.style.display = this.batchMode ? 'none' : 'flex'
    }
    const batchControls = gradioApp().getElementById(EasyTemplateSelector.IDS.BATCH_CONTROLS)
    if (batchControls) {
      batchControls.style.display = this.batchMode ? 'flex' : 'none'
    }
    // モード中の手編集はバッチ側の書き換えと競合するので読み取り専用にする
    this.setPromptsReadOnly(this.batchMode)
    this.syncBatchControls()
  }

  // ポジティブ・ネガティブのプロンプト欄を読み取り専用にする（テンプレ適用による書き換えは readOnly でも通る）
  setPromptsReadOnly(readOnly) {
    for (const id of ['txt2img_prompt', 'txt2img_neg_prompt']) {
      const textarea = gradioApp().getElementById(id)?.querySelector('textarea')
      if (!textarea) {
        continue
      }
      textarea.readOnly = readOnly
      textarea.style.opacity = readOnly ? '0.6' : ''
    }
  }
```

- [ ] **Step 5: タブ行から操作列を撤去し、`render()` の末尾で状態を同期する**

`render()` のタブ行に足した分岐を削除する（`row.appendChild(tabs)` の後の 5 行）:

```javascript
    // 一括生成の実行・停止・進捗はどのタブからでも触れるようタブ行に置く
    // （キャラ/衣装は 00_テンプレート 以外のタブで選ぶため）
    if (this.batchMode) {
      row.appendChild(this.renderBatchControls())
    }
```

`render()` の `this.history.updateUndoRedoButtons()` の次に 1 行足す:

```javascript
    this.syncBatchModeUi()
```

- [ ] **Step 6: 進捗更新のたびにボタンの出し分けを同期する**

`startBatch()` から `await` の直前に `syncBatchControls()` を置いても間に合わない。`this.batchRunner.start(...)` の呼び出し式が評価されるのは `await` 演算子の適用より前なので、`await` の直前に書いた同期は `running` が立つ前に走ってしまうためである。

代わりに `updateBatchProgress()`（`ETSBatchRunner` の `onProgress` に結線済み）から同期する。`start()` はループの最初のテンプレで `onProgress()` を呼ぶので、そこで停止ボタンへ切り替わる。`updateBatchProgress()` を以下で置き換える:

```javascript
  // 進捗表示を更新する。進捗は実行の開始・終了に合わせて飛んでくるので、
  // ここで実行/停止ボタンの出し分けも同期する
  updateBatchProgress(text) {
    const progress = gradioApp().getElementById(EasyTemplateSelector.IDS.BATCH_PROGRESS)
    if (progress) {
      progress.textContent = text
    }
    this.syncBatchControls()
  }
```

- [ ] **Step 7: 実行終了で確実に戻す**

進捗経由の同期だけでは、`start()` が `catch` で中断した場合など最後の同期が `running = false` より前になりうる。`startBatch()` の `await` を `try` / `finally` で囲み、終了時に必ず戻す。既存の `startBatch()` の `await` の行を以下で置き換える:

```javascript
    try {
      await this.batchRunner.start(items, Array.from(this.batchSwapSelection.values()))
    } finally {
      this.syncBatchControls()
    }
```

- [ ] **Step 8: グループ一括選択後の件数表示を明示的に更新する**

これまで `toggleBatchGroup()` は `this.render()` を呼ぶだけで件数表示を更新していた。操作列が `render()` のたびに作り直され、`batchSelectionSummary()` が再計算されていたためである。Task 1 で操作列をヘッダーへ常設すると `renderBatchControls()` は初回しか呼ばれなくなるので、グループ一括選択・解除で件数が更新されなくなる（個別選択の `toggleBatchSelection()` は `updateBatchProgress()` を明示的に呼んでいるので影響しない）。

`toggleBatchGroup()` の末尾を以下で置き換える:

```javascript
    // 枠線の復元は renderTagButton が行うので、まとめて描き直す
    this.render()
    // 操作列はヘッダーに常設で作り直されないため、件数表示は明示的に更新する
    this.updateBatchProgress(this.batchSelectionSummary())
  }
```

- [ ] **Step 9: モード切替時の同期を確認する**

`renderTemplateSettings()` の `batchModeCheckbox` は `onChange` の末尾で `this.render()` を呼んでおり、Step 5 で `render()` の末尾に `syncBatchModeUi()` を足したため、モード切替は自動的に反映される。**追加の変更は不要**。この Step は変更が不要であることの確認のみで、コードは触らない。

- [ ] **Step 10: 構文チェックと単体テストの回帰確認**

Run: `node --check javascript/easy_template_selector.js`
Expected: エラーなし

Run: `node --test`
Expected: 全 67 件 PASS（本タスクは DOM 依存のためテストの増減なし）

- [ ] **Step 11: WebUI 実機確認**

WebUI の UI Reload 後、以下を確認する:

1. モード OFF のとき、ヘッダーは従来どおり（タグ情報ドロップダウン・上・下・削除が表示され、一括生成の操作列は出ない）
2. `一括生成モード` を ON にすると、ドロップダウン・上・下・削除が消え、その位置に `▶ 一括生成` と進捗が出る。`■ 停止` はこの時点では出ない
3. モード ON でポジティブ・ネガティブのプロンプト欄が読み取り専用になり（文字を打っても入らない）、薄く表示される
4. モード ON でも再読み込み・Undo・Redo・テンプレート名・保存は表示されたまま
5. テンプレとキャラを選んで `▶ 一括生成` を押すと、`▶ 一括生成` が消えて `■ 停止` に切り替わる
6. 生成が全部終わると `■ 停止` が消えて `▶ 一括生成` に戻り、進捗に `完了: 成功 N 件 / 失敗 M 件` が出る
7. 実行中に `■ 停止` を押すと進捗が `停止要求中…` に変わり、現在の生成完了後に `▶ 一括生成` へ戻る
8. モードを OFF に戻すと、編集系のヘッダー要素が復帰し、プロンプト欄が編集可能に戻る
9. テンプレ適用による書き換えは読み取り専用でも通る（実行中もプロンプト欄の中身がテンプレごとに切り替わる）
10. タブを切り替えても一括生成の操作列が消えない（ヘッダーにあるため）
11. グループの見出しボタン（`@カテゴリ@`）で一括選択・一括解除したとき、進捗欄の `選択中: テンプレ N 件 / キャラ・衣装 M 件` が正しく増減する

- [ ] **Step 12: コミット**

```bash
git add javascript/easy_template_selector.js
git commit -m "feat(batch): 一括生成モードでヘッダーを操作列に差し替え、実行状態でボタンを出し分ける"
```

---

### Task 2: ドキュメント更新

**Files:**
- Modify: `CLAUDE.md`（Coding Conventions の一括生成の記述）
- Modify: `README.md`（「一括生成モード」節）

**Interfaces:**
- Consumes: Task 1 の実装内容
- Produces: なし

- [ ] **Step 1: CLAUDE.md を更新する**

`Coding Conventions` の一括生成に関する記述のうち、「一括生成の実行・停止・進捗はタブ行（`render()` 内）に置く。…」の行を以下で置き換える:

- 一括生成の実行・停止・進捗はヘッダー（`container.header`）に常設し、`syncBatchModeUi()` が表示を切り替える。**ヘッダーは `render()` の `if (!container)` でしか構築されない**ため、モードで見た目を変える要素は作り直しではなく `style.display` の切り替えで扱うこと
- 一括生成モード中は編集系（タグ情報ドロップダウン・上・下・削除）をラッパー `#easy_template_selector_edit_controls` ごと隠し、その位置に操作列を出す。ヘッダーに編集系の操作を足すときはこのラッパーの中に入れる
- 実行/停止ボタンは排他表示で、切り替えは `syncBatchControls()` に集約する。`updateBatchProgress()` から呼んでいるのは、`ETSBatchRunner.start()` が `running` を立てた後に最初の進捗を通知するため（`startBatch()` 側で `await` の前に呼んでも `running` はまだ false）
- 落とし穴: モード中はプロンプト欄を `readOnly` にするが、これは手入力を止めるだけで `textarea.value` への代入は通る。テンプレ適用と差し替えは従来どおり動く

- [ ] **Step 2: README.md の「一括生成モード」節を更新する**

以下の点を反映する:

- モードを ON にすると、ヘッダーの編集用 UI（タグ情報のドロップダウン・上下移動・削除）が一括生成の操作列に切り替わること
- モード中はプロンプト欄（ポジティブ・ネガティブ）が読み取り専用になること。テンプレートの適用・差し替えは通常どおり行われること
- 実行中は `▶ 一括生成` が `■ 停止` に切り替わり、完了・停止で戻ること
- 既存の手順（1〜4）のうち、操作列の位置に関する記述（「タブ行に現れます」）をヘッダーに読み替えること

- [ ] **Step 3: コミット**

```bash
git add CLAUDE.md README.md
git commit -m "docs: 一括生成モードのヘッダー UI 切り替えを反映"
```

---

## 判断メモ

- **`disabled` ではなく `readOnly` を使う理由**: `disabled` にすると Gradio がフォーム値を送らなくなる可能性があり、生成そのものに影響しうる。`readOnly` は手入力だけを止めて `value` の代入とフォーム送信は通るため、テンプレ適用・差し替えを壊さない
- **ヘッダーへ移す理由**: ヘッダーは `render()` をまたいで生き残るため、タブ切替やモード切替で作り直されない。タブ行に置いていた現状は `render()` のたびに作り直されており、実行中に再描画が走るとボタンの状態が失われうる
- **保存・Undo/Redo を隠さない理由**: これらは既に `guardBatchRunning()` でガードされており、モード中（非実行中）は使えて困らない。隠すと一括生成の準備中に手直しできなくなる
- **進捗表示をモード OFF 時に隠す理由**: 操作列ごと隠すため。件数表示はモード中しか意味を持たない
