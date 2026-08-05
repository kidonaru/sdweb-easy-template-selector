# シード値反映トグル Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `00_テンプレート` タブの `99_設定` に「シード値反映」チェックボックスを追加し、テンプレート適用時に `Seed` を反映するかを制御できるようにする。

**Architecture:** 既存の「モデル反映」（`ETSTemplateManager#applyModel`）と同じ形で `applySeed` フラグ（初期値 `true`、セッション限り）を持たせる。ただし `Seed` は pnginfo の貼り付け経路（`APPLY_BUTTON` のクリック）でもシード欄へ書き戻されるため、`applyMeta()` を止めるだけでは足りない。**貼り付けに渡すテキストから `Seed:` 項目そのものを取り除く**ことで、本体側にシード欄を触らせない。加えて 1500ms の遅延反映ループでも反映しないよう `metaDataMap` から `Seed` を落とす。

本体側の裏取り（Forge Neo `modules/infotext_utils.py`）:

- `_populate_defaults()`（318 行）が既定値を補完するのは `Sampler` / `Schedule type` / `RNG` / Hires 系 / `MaHiRo` / `Rescale CFG` のみで、**`Seed` は対象外**。キーを消しても既定値が入らない
- `_parse_info()`（85 行）は `params.get(key)` が `None` のとき `gr.skip()` を返す。**該当欄は更新されずに現在値が残る**

**Tech Stack:** 素の JavaScript（クラスベース、ビルド無し）。純粋関数部分は `node --test`（`tests/*.test.mjs`）で単体テストする。

## Global Constraints

- `javascript/` 配下はトップレベルで他ファイルのクラスを参照しない（`onUiLoaded` 以降の実行時のみ）。
- コメントとエラーログは日本語で記述する。
- ハードコーディングは避ける。要素の取得は既存の `metaInfoMap` / `getMetaElement()` を経由する。
- フラグは `applyModel` と同じくメモリ保持のみ。localStorage へ永続化しない。
- 一括生成モードの UI ハンドラは `guardBatchRunning()` で包む（既存の 2 つのチェックボックスと同じ）。
- テンプレ `.txt` は CRLF 管理。行分割・再結合で改行コードを壊さないこと。
- DOM 依存部分にはテスト基盤が無いため、Task 2 以降の検証は WebUI 上の手動確認で行う。

---

### Task 1: パラメータ行から `Seed` を除く純粋関数を追加

**Files:**
- Modify: `javascript/ets_template_manager.js`（`ETSTemplateManager` に静的メソッドを追加）
- Test: `tests/ets_template_manager.test.mjs`（新規）

**Interfaces:**
- Produces: `ETSTemplateManager.stripSeedParam(template: string) → string`。Task 2 が `applyTemplate()` から呼ぶ。

- [ ] **Step 1: 失敗するテストを書く**

既存の JS テストの読み込み方式に合わせる（`tests/ets_batch_runner.test.mjs` の冒頭を読み、同じ流儀でクラスを読み込むこと。`javascript/` は素のスクリプトで `export` を持たないため、ファイルを読んで評価する形になっている）。

`tests/ets_template_manager.test.mjs` に以下のケースを書く。

```js
test('パラメータ行から Seed 項目を取り除く', () => {
  const input = 'prompt text\nSteps: 25, CFG Scale: 6, Seed: 1095942052, Size: 832x1216,'
  const expected = 'prompt text\nSteps: 25, CFG Scale: 6, Size: 832x1216,'
  assert.equal(ETSTemplateManager.stripSeedParam(input), expected)
})

test('Seed が無いテンプレはそのまま返す', () => {
  const input = 'prompt text\nSteps: 25, CFG Scale: 6,'
  assert.equal(ETSTemplateManager.stripSeedParam(input), input)
})

test('プロンプト行の Seed: で始まる行は触らない', () => {
  const input = 'Seed: not a param line\nSteps: 25, Seed: 42,'
  const expected = 'Seed: not a param line\nSteps: 25,'
  assert.equal(ETSTemplateManager.stripSeedParam(input), expected)
})

test('CRLF の改行を保持する', () => {
  const input = 'prompt\r\nSteps: 25, Seed: 42, CFG Scale: 6,\r\n'
  const expected = 'prompt\r\nSteps: 25, CFG Scale: 6,\r\n'
  assert.equal(ETSTemplateManager.stripSeedParam(input), expected)
})

test('キー名が Seed で終わる別項目は残す', () => {
  const input = 'Steps: 25, Variation seed: 7, Seed: 42,'
  const expected = 'Steps: 25, Variation seed: 7,'
  assert.equal(ETSTemplateManager.stripSeedParam(input), expected)
})
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `node --test tests/ets_template_manager.test.mjs`
Expected: FAIL（`stripSeedParam is not a function`）

- [ ] **Step 3: 実装**

`ETSTemplateManager` クラス内（`getCurrentSize()` の後など、インスタンスメソッドと混ざらない末尾）に追加する。

```js
  // パラメータ行から Seed 項目を取り除く。
  // pnginfo の貼り付けはキーが無い項目の欄を触らない（本体 modules/infotext_utils.py の
  // _parse_info() が gr.skip() を返し、_populate_defaults() も Seed は補完しない）ため、
  // これでテンプレの Seed をシード欄へ書き込ませずに済む
  static stripSeedParam(template) {
    return template.split('\n').map((line) => {
      // パラメータ行の判定は parseMetaText() と同じ規約に合わせる
      if (!line.startsWith('Steps:')) {
        return line
      }
      // 値にカンマを含む項目は無い前提（parseMetaText() も同じ前提でカンマ分割している）
      const items = line.split(',').filter((item) => item.split(':')[0].trim() !== 'Seed')
      return items.join(',')
    }).join('\n')
  }
```

補足（実装者向け）:

- 行末の `,` により最終要素は空文字（CRLF なら `'\r'`）になる。`split(':')[0].trim()` が `Seed` に一致しないのでそのまま残り、末尾カンマと改行コードが保たれる。
- `'Steps: 25, Seed: 42, CFG Scale: 6,'` → 除去後は `'Steps: 25, CFG Scale: 6,'`。`Seed` の後ろの空白は次項目の先頭に付いていた分がそのまま残るため、余分な二重空白は出ない。

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/ets_template_manager.test.mjs`
Expected: PASS（5 件）

- [ ] **Step 5: 既存テストの回帰確認**

Run: `node --test`
Expected: 既存テストがすべて PASS

- [ ] **Step 6: コミット**

```bash
git add javascript/ets_template_manager.js tests/ets_template_manager.test.mjs
git commit -m "feat: パラメータ行から Seed を除く stripSeedParam を追加"
```

---

### Task 2: `ETSTemplateManager` に `applySeed` フラグを追加し適用経路へ組み込む

**Files:**
- Modify: `javascript/ets_template_manager.js:12-13`（フラグ定義）
- Modify: `javascript/ets_template_manager.js:106-131`（`applyTemplate()` の metaDataMap 加工と貼り付け）
- Test: なし（DOM 依存のため WebUI 上で手動確認）

**Interfaces:**
- Produces: `ETSTemplateManager#applySeed: boolean`（初期値 `true`）。Task 3 の UI が直接代入で更新する。
- Consumes: Task 1 の `ETSTemplateManager.stripSeedParam(template)`。

- [ ] **Step 1: フラグを追加**

`applyModel` の直後に追加する。

```js
    // テンプレート適用時にモデル（checkpoint）を切り替えるか（セッション限り、永続化しない）
    this.applyModel = true

    // テンプレート適用時に Seed を反映するか（セッション限り、永続化しない）
    this.applySeed = true
```

- [ ] **Step 2: `applyTemplate()` で Seed を落とす**

`metaDataMap['Hires visible'] = ...` の直後（`textarea.value = prompt.trim()` の前）に挿入する。

```js
    // Hiresが有効か
    metaDataMap['Hires visible'] = 'Hires upscaler' in metaDataMap ? 'true' : 'false'

    // シード反映が OFF のときは、遅延反映ループの対象から外し、
    // 貼り付け用テキストからも Seed 項目を落としてシード欄を現在値のまま残す
    let pasteText = template
    if (!this.applySeed) {
      delete metaDataMap['Seed']
      pasteText = ETSTemplateManager.stripSeedParam(template)
    }
```

- [ ] **Step 3: 貼り付けに `pasteText` を使う**

同メソッド内の `imageInfo.value = template` を差し替える。**`applyButton` のクリックや他の箇所は変更しない。**

```js
    if (imageInfo && applyButton) {
      imageInfo.value = pasteText
      updateInput(imageInfo)
```

- [ ] **Step 4: 構文チェック**

Run: `node --check javascript/ets_template_manager.js`
Expected: 出力なし（終了コード 0）

- [ ] **Step 5: コミット**

```bash
git add javascript/ets_template_manager.js
git commit -m "feat: テンプレート適用時の Seed 反映を applySeed フラグでガード"
```

---

### Task 3: `99_設定` に「シード値反映」チェックボックスを追加

**Files:**
- Modify: `javascript/easy_template_selector.js:475-484`（`renderTemplateSettings()` 内）
- Test: なし（DOM 依存のため WebUI 上で手動確認）

**Interfaces:**
- Consumes: Task 2 の `this.templateManager.applySeed`、既存の `ETSElementBuilder.checkbox(text, checked, { onChange })`、既存の `this.guardBatchRunning(fn)`。

- [ ] **Step 1: チェックボックスを追加**

`buttons.append(applyModelCheckbox)` の直後、`batchModeCheckbox` の定義より前に挿入する。

```js
    buttons.append(applyModelCheckbox)

    // テンプレート適用時に Seed を反映するかのトグル
    const applySeedCheckbox = ETSElementBuilder.checkbox('シード値反映', this.templateManager.applySeed, {
      onChange: this.guardBatchRunning((checked) => {
        this.templateManager.applySeed = checked
      })
    })
    buttons.append(applySeedCheckbox)
```

- [ ] **Step 2: 構文チェック**

Run: `node --check javascript/easy_template_selector.js`
Expected: 出力なし（終了コード 0）

- [ ] **Step 3: WebUI で手動確認**

WebUI の UI リロード（Python 変更が無いので再起動は不要）を行ってから、次を順に確認する。

1. `00_テンプレート` タブの `99_設定` に `モデル反映` の右隣で `シード値反映` が表示され、初期状態は ON。
2. ON のまま任意のテンプレートを適用 → シード欄がテンプレートの `Seed` 値になる（従来動作）。
3. シード欄に手で `12345` を入れる → OFF にする → 別のテンプレート（`Seed` が異なるもの）を適用 → **一瞬たりともテンプレの値にならず `12345` のまま**であること（Task 2 の方式が効いていれば、モデル反映と違いちらつきは起きない）。
4. シード欄に `-1` を入れて OFF のままテンプレートを適用 → `-1` のままであること。
5. OFF で適用したあと、他のメタ情報（Steps / CFG Scale / Size / Hires 各項目）は従来どおりテンプレの値になること（`Seed` の除去が他項目のパースを壊していないことの確認）。
6. OFF で適用したあと `Override Settings` のドロップダウンに `Seed` 由来の項目が現れないこと。
7. OFF の状態でテンプレートを適用した直後に保存（💾）→ 保存されたテンプレの `Seed` はシード欄の現在値になる。これは仕様どおり（保存は常に UI の現在値を書く）。
8. 一括生成モードを ON にして実行中に `シード値反映` を操作しても無視されること（`guardBatchRunning`）。
9. OFF・シード欄 `-1` で一括生成を実行 → 各テンプレの `Seed` に引きずられず毎回ランダムになること。シード欄が `-1` 以外の固定値だと**全件が同じシード**になる点に注意（仕様どおり）。

- [ ] **Step 4: コミット**

```bash
git add javascript/easy_template_selector.js
git commit -m "feat: 99_設定 にシード値反映チェックボックスを追加"
```

---

### Task 4: README と CLAUDE.md の追記

**Files:**
- Modify: `README.md:211`（一括生成モードの Seed に関する注記）
- Modify: `CLAUDE.md`（テンプレ適用まわりの規約リストへ追記）

- [ ] **Step 1: README を更新**

`README.md:211` の行を次に置き換える。

```markdown
- Seed はテンプレートに保存されている値がそのまま使われます (固定Seedのテンプレートは毎回同じ絵になります)
  - `99_設定` の `シード値反映` をOFFにすると、テンプレートの Seed を無視してシード欄の現在値を使います (`-1` にしておけば毎回ランダム)
```

- [ ] **Step 2: CLAUDE.md に規約を追記**

`## Coding Conventions` の中、テンプレ適用の一般則が並ぶ位置（`Hires CFG Scale` 関連より前）に次の 2 行を足す。

```markdown
- テンプレ適用時の `Seed` 反映は `ETSTemplateManager#applySeed`（`99_設定` の「シード値反映」）で制御する。OFF のときは `metaDataMap` から `Seed` を落とすだけでなく、`stripSeedParam()` で**貼り付けテキストからも `Seed:` 項目を除く**。pnginfo の貼り付けが直接シード欄を書き戻すため、遅延反映ループを止めるだけでは防げない
- 上記が成立する根拠は本体側の実装。`modules/infotext_utils.py` の `_populate_defaults()` は `Seed` に既定値を補完せず、`_parse_info()` はキーが無いとき `gr.skip()` を返して欄を触らない。本体のこの 2 箇所が変わると壊れる
```

- [ ] **Step 3: コミット**

```bash
git add README.md CLAUDE.md
git commit -m "docs: シード値反映トグルの説明を追加"
```

---

## Self-Review

- **要件カバレッジ**: 「モデル反映同様のシード値反映チェックボックス」＝ 純粋関数（Task 1）・フラグと適用経路（Task 2）・UI（Task 3）・ドキュメント（Task 4）で網羅。
- **プレースホルダ**: なし。全ステップに実コードまたは実手順を記載。
- **型・名前の整合**: `stripSeedParam` は Task 1 で定義し Task 2 で `ETSTemplateManager.stripSeedParam(template)` として参照。`applySeed` は Task 2 で定義し Task 3 で参照。`ETSElementBuilder.checkbox(text, checked, { onChange })` は実装（`javascript/ets_element_builder.js:196`）と一致。
- **前方式からの変更**: 初版は「適用前のシード欄の値を `metaDataMap` に入れて遅延ループで復元する」方式だったが、本体側が欠落キーの欄を触らないことを確認できたため、貼り付けテキストから除去する方式へ差し替えた。復元のちらつき（1.5 秒間テンプレの値が表示される）が無くなり、純粋関数として単体テストできる。

## レビュー却下メモ

- 1500ms の遅延ループが終わる前に 2 回目の `applyTemplate()` を呼ぶと、読み取る「現在のシード欄の値」が復元前の値になり得るレース — 却下。初版方式への指摘であり、現方式ではシード欄を読まないため該当しない。
