# Generate ボタンの一括生成インターセプト 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一括生成モード中に本体の Generate ボタンを押したら、通常生成の代わりに一括生成を開始する。

**Architecture:** `gradioApp()` の捕捉フェーズで `#txt2img_generate` へのクリックを検知し、一括生成モード中かつ人手のクリック（`event.isTrusted`）のときだけ `preventDefault()` + `stopPropagation()` して `startBatch()` へ差し替える。`ETSBatchRunner` が発火する合成クリック（`isTrusted: false`）は素通しする。補完の keydown（`ets_completion.js`）と同じ「捕捉フェーズで先回り」パターン。

**Tech Stack:** Vanilla JS（既存拡張のコード規約に準拠）。ビルド・テスト基盤なし、動作確認は WebUI 実機。

## Global Constraints

- コードのコメントとエラーログメッセージは日本語で記述する
- `javascript/` 配下のファイルは、トップレベルで他ファイルのクラスを参照しない（クラス参照は `onUiLoaded` 以降の実行時のみ）
- 一括生成の UI 操作は実行中の競合を避ける（既存の `guardBatchRunning()` の思想に合わせ、実行中の生クリックは無視する）
- `init()` は `reload()` からも呼ばれるため、リスナー登録は一度だけ行う（多重登録防止）

---

### Task 1: Generate クリックのインターセプト

**Files:**
- Modify: `javascript/easy_template_selector.js`（`init()` 末尾＝`this.completion.attach()` の直後にフック登録呼び出しを追加、メソッド本体はクラス内に新設）

**Interfaces:**
- Consumes: `this.batchMode`（一括生成モードのフラグ）、`this.batchRunner.running`、`this.startBatch()`（`easy_template_selector.js:819`）
- Produces: `attachGenerateIntercept()`（引数なし・戻り値なし。`init()` から呼ぶ）

- [ ] **Step 1: `attachGenerateIntercept()` メソッドを追加**

`syncBatchModeUi()` の近く（一括生成関連メソッド群）に以下を追加する:

```javascript
  // 一括生成モード中の Generate ボタン押下を一括生成の開始に差し替える。
  // ETSBatchRunner 自身が発火する合成クリック（isTrusted: false）は素通しし、
  // 人手のクリックだけを捕捉フェーズで先回りして本体の生成を止める。
  // Ctrl+Enter は本体がプログラム的に click() するため isTrusted が false になり
  // 差し替え対象外（通常生成が走る）。ここは既知の抜け道として許容する
  attachGenerateIntercept() {
    if (this.generateInterceptAttached) {
      return
    }
    this.generateInterceptAttached = true
    gradioApp().addEventListener('click', (event) => {
      if (!this.batchMode || !event.isTrusted) {
        return
      }
      const generateButton = gradioApp().getElementById('txt2img_generate')
      if (!generateButton || !event.composedPath().includes(generateButton)) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      // 実行中は Runner の合成クリックと競合するため開始しない（停止は「■ 停止」ボタンで行う）
      if (this.batchRunner.running) {
        return
      }
      this.startBatch()
    }, { capture: true })
  }
```

設計メモ（実装者向け）:

- リスナーは textarea ではなく `gradioApp()` に登録する。ボタン自身への登録では Gradio のハンドラとの実行順が登録順依存になるため（補完 keydown と同じ理由。CLAUDE.md 参照）
- ボタン判定は `composedPath()` を使う。Generate ボタンは内部に子要素を持ちうるので `event.target` の直接比較では取りこぼす。Shadow DOM の retarget 回避も補完ポップアップの外側判定と同じ流儀
- `isTrusted` チェックが最重要。`ets_batch_runner.js:294` の合成クリックをここで横取りすると一括生成が永久に開始しない
- `stopPropagation()` は実行中でも行う（実行中の生クリックが本体の生成を二重に走らせるのを防ぐ）。`startBatch()` の呼び出しだけを `running` で抑止する
- **`guardBatchRunning()` でハンドラ全体をラップしない理由**: ラップすると実行中はハンドラごと無視され、上記の `stopPropagation()` まで効かなくなる（実行中の生クリックで通常生成が走ってしまう）。規約違反ではなく意図的な不採用。この旨をコード内コメントにも残す
- 多重登録防止フラグは `constructor` での初期化不要（`undefined` は falsy）だが、既存フィールドの宣言スタイルに合わせて constructor に `this.generateInterceptAttached = false` を追加してよい

- [ ] **Step 2: `init()` から呼び出す**

`easy_template_selector.js:178`（`this.completion.attach()` の直後）に追加:

```javascript
    this.attachGenerateIntercept()
```

- [ ] **Step 3: 実機で動作確認**

WebUI の UI Reload 後、以下を確認する:

1. 一括生成モード OFF: Generate 押下で通常生成が走る（従来どおり）
2. 一括生成モード ON・テンプレ選択あり: Generate 押下で一括生成が開始され、通常生成は走らない
3. 一括生成モード ON・テンプレ選択なし: Generate 押下で「テンプレートが選択されていません」が表示され、生成は走らない
4. 一括生成の実行中: 既存の「▶ 実行」から開始した一括生成が最後まで完走する（Runner の合成クリックが素通しされている）
5. 一括生成の実行中に Generate を生クリック: 何も起きない（二重生成しない）
6. Reload ボタンで拡張を再読込後、2 を再確認（リスナーが多重登録されて `startBatch()` が二重に呼ばれないこと）

- [ ] **Step 4: コミット**

```bash
git add javascript/easy_template_selector.js
git commit -m "feat: 一括生成モード中の Generate ボタンを一括生成の開始に差し替え"
```

---

## テスト方針

インターセプトは DOM イベントと Gradio の実挙動（合成クリック・実行順）に強く依存し、純粋モジュールとして切り出せる判断ロジックが 3 条件の boolean のみのため、単体テストは追加しない。検証は Step 3 の実機チェックリスト（6 項目）で行う。プロジェクトの規約（「動作確認は基本的に WebUI 上で行う」）に準拠。

## 既知の制限（仕様として許容）

- **Ctrl+Enter は差し替えない**: 本体のショートカットはプログラム的な `click()` のため `isTrusted` が false。モード中でも通常生成が走る。塞ぐには keydown の横取りが別途必要で、初版のスコープ外とする
- **操作説明表示との整合**: 一括生成モードの操作説明（ヘッダー表示）に「Generate でも開始できる」旨を足すかは動作確認後に判断

## レビュー却下メモ

- `stopImmediatePropagation()` の採用 — 同一ノード（`gradioApp()`）上に競合する capture の click リスナーは存在せず（補完は keydown）、`stopPropagation()` で子孫のリスナーは全て止まる。実害の裏付けなしのため見送り
- 判定ロジックの純粋関数化と `node --test` 追加 — 3 条件の boolean 合成のみで、テストが検証するのは自明な真理値表。過剰品質として却下
- 操作説明への追記を初版で行う — 計画どおり動作確認後に判断（先送りは意図的）
- `applyTemplate()` 非同期進行中の Generate 押下 — テンプレ適用中の排他フラグは存在せず、既存の「▶ 実行」ボタンも同じ条件で同じ挙動になる。本件で新設する差分はないため未確認のまま見送り
