# 95_モデル.yml モデル選択機能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `tags/95_モデル.yml` のボタン押下でチェックポイントを切り替え、プロンプト中の `# 01_クオリティ:Model` / `# 99_ネガティブ:Model` セクションを選択モデル対応のタグへ差し替える。

**Architecture:** `96_解像度` と同じ「プロンプトに挿入しない特殊カテゴリ」として実装。`ETSSection.isModelCategory()` で判定し、`ETSPromptEditor.addTag` で early return してモデル切替とセクション差し替えを行う。タグデータは `templateManager.getTags()` から参照。

**Tech Stack:** Vanilla JS(WebUI 拡張)、YAML タグ定義。ビルド・自動テスト基盤なし(reForge 上で手動確認)。

## Global Constraints

- コードのコメント・エラーログは日本語で記述する
- `javascript/js-yaml.min.js` は編集禁止
- `javascript/` 配下のファイルはトップレベルで他ファイルのクラスを参照しない(実行時参照のみ可)
- YAML ファイルは既存の命名規則・番号順序を維持する
- コミットは main ブランチへ直接、push はしない

**仕様書:** `docs/superpowers/specs/2026-07-24-model-selector-design.md`

---

### Task 1: `ETSSection.isModelCategory()` 追加

**Files:**
- Modify: `javascript/ets_section.js`(`isResolutionCategory` の直後、97〜101 行付近)

**Interfaces:**
- Produces: `ETSSection.prototype.isModelCategory(): boolean` — Task 2 が使用

- [ ] **Step 1: メソッド追加**

`isResolutionCategory()` の直後に追加:

```javascript
  // モデルカテゴリかどうかを判定
  isModelCategory() {
    if (!this.category) return false
    return this.category.startsWith('95_モデル')
  }
```

- [ ] **Step 2: コミット**

```bash
git add javascript/ets_section.js
git commit -m "feat: ETSSection にモデルカテゴリ判定を追加"
```

---

### Task 2: `addTag` にモデルカテゴリ分岐を追加

**Files:**
- Modify: `javascript/ets_prompt_editor.js`(`addTag` 内、解像度分岐 81〜89 行の直後に分岐追加。ヘルパー 2 メソッドは `addTag` の直前に追加)

**Interfaces:**
- Consumes: Task 1 の `isModelCategory()`、既存の `this.templateManager.getTags()` / `getCurrentModel()` / グローバル `selectCheckpoint`
- Produces: なし(内部処理のみ)

**前提知識:**
- `addTag(comment, tag, category, isAddMode)` の引数は、モデルボタンの場合 `comment` = 表示名(YAML キー)、`tag` = チェックポイント名(YAML 値)、`category` = `"95_モデル:Illustrious"` 等。
- `this.templateManager.getTags()` はファイル名 stem をキーとするオブジェクトを返す。`getTags()['01_クオリティ']['Model']['WAI-illustrious-SDXL v17.0']` でタグ列(カンマ区切り文字列)が引ける。
- `ETSSection('表示名', 'タグ列', '01_クオリティ:Model').toString()` は `# 01_クオリティ:Model (表示名),\nタグ列,` を生成する。

- [ ] **Step 1: セクション差し替えヘルパーを追加**

`addTag` メソッドの直前に追加:

```javascript
  // 指定 textarea 内の対象カテゴリセクションを差し替える(存在しない場合は何もしない)
  replaceSection(textareaId, newSection) {
    const textarea = gradioApp().getElementById(textareaId).querySelector('textarea')
    const targetName = `# ${newSection.category}`
    const sections = this.splitSections(textarea.value)
    let found = false

    const newSections = sections.map(section => {
      if (!found && section.startsWith(targetName)) {
        found = true
        return newSection.toString()
      }
      return section
    })

    if (!found) {
      return false
    }

    textarea.value = newSections.join('\n')
    updateInput(textarea)
    return true
  }

  // モデル選択: チェックポイント切替と Model セクションの差し替え
  applyModelTag(modelName, checkpointName) {
    // チェックポイント切り替え(現在と同じ場合はスキップ)
    if (typeof selectCheckpoint !== 'function') {
      console.error('selectCheckpoint が見つかりません。WebUI のバージョンを確認してください')
      return
    }
    if (checkpointName !== this.templateManager.getCurrentModel()) {
      selectCheckpoint(checkpointName)
    }

    // Model セクションの差し替え(01_クオリティ / 99_ネガティブ)
    const tags = this.templateManager.getTags()
    let replaced = false
    let entryFound = false

    const targets = [
      { file: '01_クオリティ', textareaId: 'txt2img_prompt' },
      { file: '99_ネガティブ', textareaId: 'txt2img_neg_prompt' },
    ]
    for (const { file, textareaId } of targets) {
      const modelTag = tags?.[file]?.['Model']?.[modelName]
      if (!modelTag) {
        continue
      }
      entryFound = true
      const newSection = new ETSSection(modelName, modelTag, `${file}:Model`)
      if (this.replaceSection(textareaId, newSection)) {
        replaced = true
      }
    }

    // 表記ゆれによるキー不一致の切り分け用(01/99 のどちらにもエントリが無い場合)
    if (!entryFound) {
      console.warn(`Model エントリが見つかりません: ${modelName}(01_クオリティ / 99_ネガティブ の Model: キーと完全一致しているか確認してください)`)
    }

    if (replaced) {
      this.history.saveTextHistory()
    }
  }
```

- [ ] **Step 2: `addTag` に分岐を追加**

解像度分岐(`// 解像度カテゴリの場合、解像度を反映` の if ブロック)の直後に追加:

```javascript
    // モデルカテゴリの場合、モデル切替と Model セクションの差し替えを行う
    if (targetSection.isModelCategory()) {
      this.applyModelTag(comment, tag)
      return
    }
```

- [ ] **Step 3: コミット**

```bash
git add javascript/ets_prompt_editor.js
git commit -m "feat: モデルカテゴリのボタンでモデル切替と Model セクション差し替えを実装"
```

---

### Task 3: タグ YAML の追加・リネーム

**Files:**
- Create: `tags/95_モデル.yml`
- Modify: `tags/01_クオリティ.yml`(`Model:` サブカテゴリのキー)
- Modify: `tags/99_ネガティブ.yml`(`Model:` サブカテゴリのキー)

**Interfaces:**
- Produces: `95_モデル.yml` のキー(表示名)と `01/99` の `Model:` キーの完全一致対応

**注意:** `tags/` は git 管理外。コミット対象は無いが、ファイル編集は通常どおり行う。

- [ ] **Step 1: `tags/95_モデル.yml` を作成**

インストール済みチェックポイントのうち `Model:` タグを持つもの・持たせるものを登録:

```yaml
Illustrious:
  "WAI-illustrious-SDXL v17.0": waiIllustriousSDXL_v170
  "WAI-illustrious-SDXL v15.0": waiIllustriousSDXL_v150
  "WAI-NSFW-illustrious v14.0": waiNSFWIllustrious_v140
  "Unholy Desire Mix v5.0": unholyDesireMixSinister_v50
```

注: 仕様書の YAML 例には `SDXL:` グループもあるが、あれは構造例。現在インストール済みのチェックポイントは全て Illustrious 系のため単一グループとする(本計画を正とする)。SDXL 系モデル導入時にグループを追記すればよい。

- [ ] **Step 2: `01_クオリティ.yml` の `Model:` キーをリネーム**

`WAI-NSFW-illustrious-SDXL` の行を、同じ値のまま 3 エントリに複製リネーム(v17.0 / v15.0 / v14.0)。`Unholy Desire Mix` → `Unholy Desire Mix v5.0` にリネーム。`Nova Anime XL` / `KonpaEvo Mix` / `LunarCherryMix` は対応チェックポイント未導入のためそのまま残す。

```yaml
Model:
  Nova Anime XL: masterpiece, best quality, amazing quality, very aesthetic, high resolution, ultra-detailed, absurdres, newest, scenery
  Unholy Desire Mix v5.0: unholy-aesthetic,masterpiece,best quality,amazing quality,very aesthetic,absurdres,ultra detailed face,ultra detailed eyes
  WAI-illustrious-SDXL v17.0: masterpiece,best quality,amazing quality
  WAI-illustrious-SDXL v15.0: masterpiece,best quality,amazing quality
  WAI-NSFW-illustrious v14.0: masterpiece,best quality,amazing quality
  KonpaEvo Mix: masterpiece,best quality,very awa
  LunarCherryMix: masterpiece,best quality,ultra high res,photorealistic,8K UHD,hyper-detailed
```

- [ ] **Step 3: `99_ネガティブ.yml` の `Model:` キーを同様にリネーム**

`WAI-NSFW-illustrious-SDXL` の値 `bad quality,worst quality,worst detail,sketch,censor` を v17.0 / v15.0 / v14.0 の 3 エントリに複製。`Unholy Desire Mix` → `Unholy Desire Mix v5.0`。他はそのまま。

- [ ] **Step 4: YAML 構文チェック**

```bash
python -c "import yaml, sys; [yaml.safe_load(open(f, encoding='utf-8')) for f in sys.argv[1:]]" tags/95_モデル.yml tags/01_クオリティ.yml tags/99_ネガティブ.yml
```

Expected: エラーなしで終了(exit 0)

---

### Task 4: reForge 上での手動確認

**Files:** なし(動作確認のみ。UI の Reload で JS/YAML を反映)

- [ ] **Step 1: UI に「95_モデル」カテゴリが表示され、4 ボタンが並ぶことを確認**
- [ ] **Step 2: 現在と異なるモデルのボタン押下でチェックポイントが切り替わることを確認**
- [ ] **Step 3: プロンプトに `# 01_クオリティ:Model` / `# 99_ネガティブ:Model` セクションがある状態でボタン押下 → 両セクションのコメントとタグが選択モデルのものに差し替わり、プロンプトへの新規タグ挿入が無いことを確認**
- [ ] **Step 4: Model セクションが無いプロンプトでボタン押下 → プロンプトが変化しないことを確認**
- [ ] **Step 5: 差し替え後に Undo で元のプロンプトに戻ることを確認**

  注意: `ETSHistory` は変更後の状態のみ push するため、セッション最初の操作では履歴 index=0 で Undo 不可(既存仕様)。事前にタグ追加など保存済み操作を 1 回行った状態で確認すること。
- [ ] **Step 6: 現在と同じモデルのボタン押下 → チェックポイント再読込が発生しないことを確認**

## レビュー却下メモ

- 01/99 の `Model:` 配下に 95 非対応の旧キー(Nova Anime XL / KonpaEvo Mix / LunarCherryMix)を残すのは YAGNI 違反では — 却下: これらは通常のタグボタン・既存テンプレートからの利用が残る可能性があるため互換目的で残置する
