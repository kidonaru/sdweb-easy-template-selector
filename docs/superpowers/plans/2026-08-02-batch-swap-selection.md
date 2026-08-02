# キャラ/衣装のボタン選択化とランダム抽選 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一括生成の差し替え元をプロンプト欄からの抽出ではなくボタン選択に変え、テンプレごとにカテゴリ帯単位でランダム抽選した組み合わせで生成できるようにする。あわせてグループボタンで配下を再帰的にトグル全選択できるようにする。

**Architecture:** `ETSBatchRunner` の差し替えロジックを「セクション配列を一式差し替え」から「カテゴリ帯（`10_キャラ` / `13_衣装` / `14_衣装小物` / `15_衣装状態`）ごとの Map で差し替え」に作り替える。抽選（`pickSwapSections`）はテンプレごとに実行し、乱数源を引数で注入して単体テスト可能にする。UI 側（`easy_template_selector.js`）はテンプレ選択とキャラ/衣装選択を別の Map で保持し、選択判定・設定を共通ヘルパーに集約する。

**Tech Stack:** Vanilla JS（WebUI 拡張、ビルドなし）、`node --test`（純粋ロジックの単体テスト）

**先行実装:** `docs/superpowers/plans/2026-08-02-batch-generate-with-char-swap.md`（コミット `a01d0a3` / `e96855b` / `19a3e25` / `65d1b42`）。本計画はその上に載る差分。

## Global Constraints

- コードのコメント・エラーログメッセージは日本語で書く
- `javascript/` 配下のファイルはトップレベルで他ファイルのクラスを参照しない（クラス参照は実行時のみ。結線は `EasyTemplateSelector` の constructor で行う）
- `javascript/js-yaml.min.js` は編集しない
- 差し替え対象帯は既存の `ETSBatchRunner.SWAP_PREFIXES`（`10_キャラ` / `13_衣装` / `14_衣装小物` / `15_衣装状態` の前方一致）を単一のソースとする
- **プロンプト欄からの差し替え元抽出は廃止する**（差し替え元はボタン選択のみ）
- 抽選はテンプレごとに毎回引き直す（重複可）。帯ごとに独立して 1 件引く
- **テンプレに存在しない帯は挿入しない**。選択していない帯のテンプレ側セクションはそのまま残す
- Seed はテンプレに焼かれた値をそのまま使う（上書きしない）
- ネガティブ欄は差し替え対象外
- JS の変更は WebUI の UI Reload で反映される（再起動不要）

## 仕様の決定事項（ヒアリング済み）

| 論点 | 決定 |
|---|---|
| キャラ/衣装の複数選択 | 選択した中からランダムに引く |
| 抽選の単位 | カテゴリ帯ごとに独立で 1 件ずつ |
| 抽選のタイミング | テンプレごとに毎回引き直す（重複可） |
| テンプレに無い帯 | 反映しない（挿入しない） |
| プロンプト欄からの抽出 | 廃止（常にボタン選択のみ） |
| グループボタン | トグル（全選択／全解除）。配下のサブグループも再帰的に含む |

## 差し替え規則（帯単位）

テンプレのプロンプトの各セクションについて:

| テンプレ側の帯 | 選択（picked）の状態 | 結果 |
|---|---|---|
| 帯 X のセクション（1 件目） | 帯 X が picked にある | picked の帯 X のセクションへ置換 |
| 帯 X のセクション（2 件目以降） | 帯 X が picked にある | 削除する |
| 帯 X のセクション | 帯 X が picked に無い | そのまま残す |
| 帯 X のセクションが無い | 帯 X が picked にある | 何もしない（挿入しない） |
| 対象外カテゴリ / コメント行なし | — | そのまま残す |

## File Structure

| ファイル | 責務 | 本計画での変更 |
|---|---|---|
| `javascript/ets_batch_runner.js` | 帯判定・抽選・帯単位差し替え・実行ループ | 差し替え API を Map ベースへ作り替え、抽選を追加 |
| `javascript/easy_template_selector.js` | UI 描画・選択状態・結線 | キャラ/衣装の選択、グループ全選択、全タブでの実行 UI |
| `tests/ets_batch_runner.test.mjs` | 純粋ロジックの単体テスト | 新 API に合わせて全面改訂 |
| `tests/easy_template_selector.test.mjs` | タグツリー走査の単体テスト | 新規作成（`collectBatchLeaves`） |
| `CLAUDE.md` / `README.md` | 規約・使い方 | 新仕様へ更新 |

---

### Task 1: 帯判定・抽選・帯単位差し替え（DOM 非依存の純粋関数）

**Files:**
- Modify: `javascript/ets_batch_runner.js`（static 部分のみ。実行ループは Task 2）
- Test: `tests/ets_batch_runner.test.mjs`（全面改訂）

**Interfaces:**
- Consumes: `ETSPromptEditor#splitSections(text) → string[]`（`join('\n')` で原文に戻る）、`ETSPromptEditor#parseSection(sectionText) → ETSSection`（`category` / `comment` プロパティを持つ。コメント行が無いセクションは `category` が `null`）
- Produces:
  - `ETSBatchRunner.bandOf(category) → string | null`（`SWAP_PREFIXES` の該当要素。対象外は `null`）
  - `ETSBatchRunner.groupByBand(editor, sectionTexts) → Map<string, string[]>`
  - `ETSBatchRunner.pickSwapSections(pools, random = Math.random) → Map<string, string>`
  - `ETSBatchRunner.applicableSections(editor, templatePrompt, picked) → string[]`（実際に挿入されるセクションだけ）
  - `ETSBatchRunner.swapSections(editor, templatePrompt, picked) → string`（**第 3 引数が配列から Map に変わる破壊的変更**）
  - 既存の `ETSBatchRunner.isSwapTarget(editor, sectionText) → boolean` / `ETSBatchRunner.extractSwapSections(editor, promptText) → string[]` は残す（`applicableSections` が使う）

- [ ] **Step 1: 失敗するテストを書く**

`tests/ets_batch_runner.test.mjs` を以下の内容で**全面的に置き換える**（旧 API 前提のテストは残さない）:

```javascript
// ETSBatchRunner の DOM 非依存部分（帯判定・抽選・帯単位の差し替え）の単体テスト
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

const HOSHINO = '# 10_キャラ_ブルアカ:アビドス (ホシノ),\nhoshino \\(blue archive\\),pink hair,halo,'
const KAZUSA = '# 10_キャラ_ブルアカ:トリニティ (カズサ),\nkazusa \\(blue archive\\),red eyes,black hair,'
const SERAFUKU = '# 13_衣装_基本 (セーラー服),\nserafuku,'
const TAISOFUKU = '# 13_衣装_基本 (体操服),\ngym uniform,'

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

test('bandOf は SWAP_PREFIXES の該当要素を返し、対象外は null を返す', () => {
  assert.equal(ETSBatchRunner.bandOf('10_キャラ_ブルアカ:トリニティ'), '10_キャラ')
  assert.equal(ETSBatchRunner.bandOf('15_衣装状態_基本'), '15_衣装状態')
  assert.equal(ETSBatchRunner.bandOf('50_背景_基本:基本'), null)
  assert.equal(ETSBatchRunner.bandOf(null), null)
})

test('groupByBand は帯ごとにセクションをまとめる', () => {
  const pools = ETSBatchRunner.groupByBand(editor, [HOSHINO, KAZUSA, SERAFUKU])
  assert.deepEqual(Array.from(pools.keys()), ['10_キャラ', '13_衣装'])
  assert.equal(pools.get('10_キャラ').length, 2)
  assert.equal(pools.get('13_衣装').length, 1)
})

test('groupByBand は対象外カテゴリとコメント行なしのセクションを捨てる', () => {
  const pools = ETSBatchRunner.groupByBand(editor, ['red theme,', '# 50_背景_基本:基本 (屋外),\noutdoors,', HOSHINO])
  assert.deepEqual(Array.from(pools.keys()), ['10_キャラ'])
})

test('pickSwapSections は帯ごとに 1 件ずつ引く（乱数は注入する）', () => {
  const pools = ETSBatchRunner.groupByBand(editor, [HOSHINO, KAZUSA, SERAFUKU, TAISOFUKU])
  // 常に 0 番目を引く乱数源
  const picked = ETSBatchRunner.pickSwapSections(pools, () => 0)
  assert.equal(picked.size, 2)
  assert.equal(picked.get('10_キャラ'), HOSHINO)
  assert.equal(picked.get('13_衣装'), SERAFUKU)

  // 常に末尾を引く乱数源（Math.random は 1 を返さないので 0.999 で代用）
  const pickedLast = ETSBatchRunner.pickSwapSections(pools, () => 0.999)
  assert.equal(pickedLast.get('10_キャラ'), KAZUSA)
  assert.equal(pickedLast.get('13_衣装'), TAISOFUKU)
})

test('pickSwapSections は空のプールから空の Map を返す', () => {
  assert.equal(ETSBatchRunner.pickSwapSections(new Map()).size, 0)
})

test('applicableSections はテンプレに存在する帯の抽選結果だけを返す', () => {
  const pools = ETSBatchRunner.groupByBand(editor, [HOSHINO, SERAFUKU])
  const picked = ETSBatchRunner.pickSwapSections(pools, () => 0)
  // テンプレは 10_キャラ と 15_衣装状態 を持つが 13_衣装 は持たない
  const applicable = ETSBatchRunner.applicableSections(editor, TEMPLATE_PROMPT, picked)
  assert.deepEqual(applicable, [HOSHINO])
})

test('swapSections はテンプレに存在する帯だけを置換し、存在しない帯は挿入しない', () => {
  const pools = ETSBatchRunner.groupByBand(editor, [HOSHINO, SERAFUKU])
  const picked = ETSBatchRunner.pickSwapSections(pools, () => 0)
  const result = ETSBatchRunner.swapSections(editor, TEMPLATE_PROMPT, picked)

  // 10_キャラ はホシノに置き換わる
  assert.match(result, /アビドス \(ホシノ\)/)
  assert.doesNotMatch(result, /カズサ/)
  // テンプレに 13_衣装 のセクションが無いのでセーラー服は入らない
  assert.doesNotMatch(result, /セーラー服/)
  // 選択していない 15_衣装状態 はテンプレの値が残る
  assert.match(result, /open clothes,/)
  // 非対象セクションは維持される
  assert.match(result, /outdoors,/)
  assert.match(result, /smile,/)
})

test('swapSections は置換後も帯の出現位置を保つ', () => {
  const pools = ETSBatchRunner.groupByBand(editor, [HOSHINO])
  const picked = ETSBatchRunner.pickSwapSections(pools, () => 0)
  const lines = ETSBatchRunner.swapSections(editor, TEMPLATE_PROMPT, picked).split('\n')
  // 元のカズサのセクションは 5 行目（添字 4）から始まる
  assert.equal(lines[4], '# 10_キャラ_ブルアカ:アビドス (ホシノ),')
})

test('swapSections は同じ帯の 2 件目以降を削除する', () => {
  const prompt = [
    '# 10_キャラ_ブルアカ:トリニティ (カズサ),',
    'kazusa \\(blue archive\\),',
    '# 50_背景_基本:基本 (屋外),',
    'outdoors,',
    '# 10_キャラ_ブルアカ:アビドス (シロコ),',
    'shiroko \\(blue archive\\),',
  ].join('\n')
  const pools = ETSBatchRunner.groupByBand(editor, [HOSHINO])
  const picked = ETSBatchRunner.pickSwapSections(pools, () => 0)
  const result = ETSBatchRunner.swapSections(editor, prompt, picked)

  assert.match(result, /ホシノ/)
  assert.doesNotMatch(result, /カズサ/)
  assert.doesNotMatch(result, /シロコ/)
  assert.match(result, /outdoors,/)
})

test('swapSections は picked が空なら原文を返す', () => {
  assert.equal(ETSBatchRunner.swapSections(editor, TEMPLATE_PROMPT, new Map()), TEMPLATE_PROMPT)
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
Expected: FAIL（`bandOf` / `groupByBand` / `pickSwapSections` / `applicableSections` が未定義。`swapSections` は Map を受け取れない）

- [ ] **Step 3: static メソッドを書き換える**

`javascript/ets_batch_runner.js` の `isSwapTarget` / `extractSwapSections` / `swapSections`（現行 L29-66）を、以下で置き換える。`SWAP_PREFIXES` と `TIMINGS` の定義はそのまま残す:

```javascript
  // カテゴリが属する差し替え帯（SWAP_PREFIXES の該当要素）。対象外は null
  static bandOf(category) {
    if (!category) {
      return null
    }
    return ETSBatchRunner.SWAP_PREFIXES.find((prefix) => category.startsWith(prefix)) || null
  }

  // セクションのカテゴリが差し替え対象か
  static isSwapTarget(editor, sectionText) {
    return ETSBatchRunner.bandOf(editor.parseSection(sectionText).category) !== null
  }

  // プロンプトから差し替え対象セクションを出現順に抽出する
  static extractSwapSections(editor, promptText) {
    return editor.splitSections(promptText)
      .filter((section) => ETSBatchRunner.isSwapTarget(editor, section))
  }

  // セクション文字列の配列を帯ごとの抽選プールにまとめる
  static groupByBand(editor, sectionTexts) {
    const pools = new Map()
    for (const section of sectionTexts) {
      const band = ETSBatchRunner.bandOf(editor.parseSection(section).category)
      if (!band) {
        continue
      }
      if (!pools.has(band)) {
        pools.set(band, [])
      }
      pools.get(band).push(section)
    }
    return pools
  }

  // 帯ごとに 1 件ずつ抽選する。乱数源は単体テストのために差し替え可能にしている
  static pickSwapSections(pools, random = Math.random) {
    const picked = new Map()
    for (const [band, sections] of pools) {
      picked.set(band, sections[Math.floor(random() * sections.length)])
    }
    return picked
  }

  // picked のうち、テンプレに同じ帯のセクションがあって実際に挿入されるものだけを返す
  static applicableSections(editor, templatePrompt, picked) {
    const bands = new Set(
      ETSBatchRunner.extractSwapSections(editor, templatePrompt)
        .map((section) => ETSBatchRunner.bandOf(editor.parseSection(section).category))
    )
    return Array.from(picked)
      .filter(([band]) => bands.has(band))
      .map(([, section]) => section)
  }

  // テンプレのプロンプトを帯単位で差し替える。
  // 帯ごとに最初の出現位置を picked の内容へ置き換え、同じ帯の 2 件目以降は削除する。
  // テンプレに存在しない帯は挿入せず、picked に無い帯のセクションはそのまま残す
  static swapSections(editor, templatePrompt, picked) {
    if (picked.size === 0) {
      return templatePrompt
    }

    const usedBands = new Set()
    const newSections = []
    for (const section of editor.splitSections(templatePrompt)) {
      const band = ETSBatchRunner.bandOf(editor.parseSection(section).category)
      if (!band || !picked.has(band)) {
        newSections.push(section)
        continue
      }
      if (!usedBands.has(band)) {
        usedBands.add(band)
        newSections.push(picked.get(band))
      }
      // 同じ帯の 2 件目以降は落とす（差し替え後にキャラが二重に並ばないようにするため）
    }
    return newSections.join('\n')
  }
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/ets_batch_runner.test.mjs`
Expected: 全件 PASS

Run: `node --test`
Expected: 既存テスト含め全件 PASS（この時点では `ets_batch_runner.js` の実行ループが旧 API を呼んでいるが、実行ループは Node のテスト対象外なので落ちない）

- [ ] **Step 5: コミット**

```bash
git add javascript/ets_batch_runner.js tests/ets_batch_runner.test.mjs
git commit -m "refactor(batch): 差し替えをカテゴリ帯単位にし、帯ごとのランダム抽選を追加"
```

---

### Task 2: 実行ループを新しい差し替え API へ接続する

**Files:**
- Modify: `javascript/ets_batch_runner.js`（`start` / `runOne` / `applySwap` / `isSwapApplied`）

**Interfaces:**
- Consumes: Task 1 の `groupByBand` / `pickSwapSections` / `applicableSections` / `swapSections`
- Produces:
  - `#start(items, swapSectionTexts) → Promise<{ success: number, failure: number }>`（第 2 引数は選択されたキャラ/衣装のセクション文字列の配列。**シグネチャ変更**）
  - `#runOne(item, pools) → Promise<boolean>`
  - `#applySwap(picked)` / `#isSwapApplied(applicableSections)`

- [ ] **Step 1: `start` を書き換える**

現行の `start`（差し替え元をプロンプト欄から抽出している部分）を以下で置き換える:

```javascript
  // 選択テンプレを順次生成する。swapSectionTexts は選択されたキャラ/衣装のセクション文字列
  async start(items, swapSectionTexts) {
    if (this.running) {
      return { success: 0, failure: 0 }
    }
    this.running = true
    this.stopRequested = false

    let success = 0
    let failure = 0
    // ここで抜けると running が立ったままになり、実行中ガードで拡張全体が操作不能になる
    try {
      // 差し替え元は帯ごとの抽選プールにしておき、テンプレごとに引き直す
      const pools = ETSBatchRunner.groupByBand(this.promptEditor, swapSectionTexts || [])

      for (let i = 0; i < items.length; i++) {
        if (this.stopRequested) {
          break
        }
        const item = items[i]
        this.progressPrefix = `${i + 1}/${items.length}: ${item.name}`
        this.onProgress(this.progressPrefix)
        const ok = await this.runOne(item, pools)
        ok ? success++ : failure++
      }
      const suffix = this.stopRequested ? '（停止）' : ''
      this.onProgress(`完了${suffix}: 成功 ${success} 件 / 失敗 ${failure} 件`)
    } catch (error) {
      console.error('一括生成: 実行を中断しました', error)
      this.onProgress(`中断: ${error.message}`)
    } finally {
      this.running = false
    }
    return { success, failure }
  }
```

constructor に `this.progressPrefix = ''` を追加する（`this.stopRequested = false` の次の行）:

```javascript
    this.progressPrefix = ''
```

- [ ] **Step 2: `runOne` の差し替え部分を書き換える**

`runOne` の冒頭（`const parsed = ...` から `hasSwapTarget` の宣言まで）を以下で置き換える:

```javascript
      const parsed = this.templateManager.parseMetaText(item.template)
      // 抽選はテンプレごとに引き直す。テンプレに存在しない帯は挿入されない
      const picked = ETSBatchRunner.pickSwapSections(pools)
      const applicable = ETSBatchRunner.applicableSections(this.promptEditor, parsed.prompt, picked)
      if (applicable.length > 0) {
        // どの組み合わせを引いたかを進捗に出す（生成画像の infotext と突き合わせられるように）
        const labels = applicable.map((section) => this.promptEditor.parseSection(section).comment)
        this.onProgress(`${this.progressPrefix} ← ${labels.join(' / ')}`)
      }
```

`runOne` のシグネチャを `async runOne(item, pools) {` に変える。

差し替えの再試行ブロックを以下で置き換える（`if (hasSwapTarget) {` のブロック全体）:

```javascript
      // キャラ/衣装セクションを差し替える。遅延書き戻しで消えた場合に備えて反映確認つきで再試行し、
      // 最終的に反映できなければ失敗として次のテンプレへ進む（元キャラのままサイレント生成しない）
      if (applicable.length > 0) {
        let applied = false
        for (let attempt = 0; attempt < timings.SWAP_RETRY_ATTEMPTS; attempt++) {
          this.applySwap(picked)
          await ETSBatchRunner.delay(timings.SWAP_RETRY_INTERVAL_MS)
          if (this.isSwapApplied(applicable)) {
            applied = true
            break
          }
        }
        if (!applied) {
          console.error(`一括生成: キャラ/衣装の差し替えが反映できませんでした (${item.name})`)
          return false
        }
      }
```

生成直前の最終確認を以下で置き換える:

```javascript
      // クリック直前にもう一度確認する。静穏検知は「まだ書き戻しが始まっていない」状態も
      // 静穏と見なしうるため、遅れて到着した書き戻しで差し替えが消えている可能性がある
      if (applicable.length > 0 && !this.isSwapApplied(applicable)) {
        console.error(`一括生成: 生成直前に差し替えが失われていました (${item.name})`)
        return false
      }
```

- [ ] **Step 3: `applySwap` / `isSwapApplied` を書き換える**

```javascript
  // プロンプト欄へ差し替えを適用する
  applySwap(picked) {
    if (picked.size === 0) {
      return
    }
    const textarea = this.getPromptTextarea()
    const swapped = ETSBatchRunner.swapSections(this.promptEditor, textarea.value, picked)
    if (swapped !== textarea.value) {
      textarea.value = swapped
      updateInput(textarea)
    }
  }

  // 差し替えが反映済みか（実際に挿入されるはずのセクションがすべてプロンプト欄にあること）
  isSwapApplied(applicableSections) {
    const value = this.getPromptTextarea().value
    return applicableSections.every((section) => value.includes(section))
  }
```

- [ ] **Step 4: 構文チェックと単体テストの回帰確認**

Run: `node --check javascript/ets_batch_runner.js`
Expected: エラーなし

Run: `node --test`
Expected: 全件 PASS

**このタスク単体では実機の差し替えが無効になる**（意図した中間状態）。`easy_template_selector.js` 側の `start()` 呼び出しは Task 3 で更新するため、この時点では第 2 引数が `undefined` になり `groupByBand(..., undefined || [])` が空プールへフォールバックする。**エラーにはならず「差し替えなしで生成される」だけ**なので、このコミットの時点で実機確認をしても差し替えが効かないのは正常。実機での差し替え確認は Task 3 完了後に行うこと。

- [ ] **Step 5: コミット**

```bash
git add javascript/ets_batch_runner.js
git commit -m "feat(batch): テンプレごとに帯単位で抽選した組み合わせを適用する"
```

---

### Task 3: UI（キャラ/衣装の選択・グループ全選択・全タブでの実行 UI）

**Files:**
- Modify: `javascript/easy_template_selector.js`
- Test: `tests/easy_template_selector.test.mjs`（新規作成）

**Interfaces:**
- Consumes: Task 2 の `ETSBatchRunner#start(items, swapSectionTexts)`、`ETSBatchRunner.bandOf(category)`
- Produces:
  - `EasyTemplateSelector.collectBatchLeaves(tags, category) → { comment, tag, category }[]`（**static**。テストのためインスタンス状態に依存させない）
  - 以降のインスタンスメソッド（`isBatchSelected` / `setBatchSelected` / `toggleBatchGroup` 等）は DOM 依存のためテスト対象外

**設計メモ:**

- テンプレの選択（`batchSelection`: テンプレ名 → テンプレ本文）と、キャラ/衣装の選択（`batchSwapSelection`: 選択キー → セクション文字列）を別の Map で持つ。前者は名前順ソートのため名前がキー、後者はカテゴリ違いの同名ラベルを区別するためカテゴリ込みのキーを使う
- セクション文字列は `new ETSSection(comment, tag, category).toString()` で組み立てる。`addTag()` が挿入するのと同じ形になるので、テンプレ側のセクションと同じ規約に乗る
- 実行・停止・進捗はタブ行（`render()` が毎回作り直す `row`）へ移す。キャラ/衣装は `00_テンプレート` 以外のタブで選ぶため、設定グループ内に置いたままだと選択件数が見えないため
- グループボタンの選択状態（配下が全選択なら枠線）は表示しない。全グループの配下を毎回走査するコストに見合わないため（意図的な非対応）

- [ ] **Step 1: `collectBatchLeaves` の失敗するテストを書く**

`tests/easy_template_selector.test.mjs` を新規作成する。`easy_template_selector.js` はトップレベルで `onUiLoaded(...)` を呼ぶため、評価前にスタブを置く:

```javascript
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
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/easy_template_selector.test.mjs`
Expected: FAIL（`EasyTemplateSelector.collectBatchLeaves is not a function`）

- [ ] **Step 3: 状態と選択ヘルパーを追加する**

constructor の `this.batchSelection = new Map()` の次の行に追加:

```javascript
    // キャラ/衣装の選択。「カテゴリ + ラベル → セクション文字列」
    this.batchSwapSelection = new Map()
```

クラスに以下のメソッドを追加する（既存の `batchTemplateName` の隣）:

```javascript
  // 選択キー。同名ラベルが別カテゴリにあっても衝突しないようカテゴリを含める
  batchSelectionKey(comment, category) {
    return `${category}\n${comment}`
  }

  // テンプレの選択か（それ以外はキャラ/衣装の選択）
  isBatchTemplate(category) {
    return category.startsWith('00_テンプレート')
  }

  // 選択済みか
  isBatchSelected({ comment, category }) {
    if (this.isBatchTemplate(category)) {
      return this.batchSelection.has(this.batchTemplateName(comment, category))
    }
    return this.batchSwapSelection.has(this.batchSelectionKey(comment, category))
  }

  // 選択状態を設定する
  setBatchSelected({ comment, tag, category }, selected) {
    if (this.isBatchTemplate(category)) {
      const name = this.batchTemplateName(comment, category)
      selected ? this.batchSelection.set(name, tag) : this.batchSelection.delete(name)
      return
    }
    const key = this.batchSelectionKey(comment, category)
    if (selected) {
      this.batchSwapSelection.set(key, new ETSSection(comment, tag, category).toString())
    } else {
      this.batchSwapSelection.delete(key)
    }
  }

  // 進捗欄に出す選択件数
  batchSelectionSummary() {
    return `選択中: テンプレ ${this.batchSelection.size} 件 / キャラ・衣装 ${this.batchSwapSelection.size} 件`
  }
```

- [ ] **Step 4: 選択対象の判定を差し替え帯まで広げ、グループボタンを全選択トグルにする**

既存の `isBatchSelectable` を以下で置き換え、グループ判定と全選択を追加する:

```javascript
  // 一括生成モード中に選択トグルの対象となるボタンか（テンプレ本体・キャラ/衣装のタグ）
  isBatchSelectable(tag, category) {
    if (!this.batchMode || tag.startsWith('@')) {
      return false
    }
    return this.isBatchTemplate(category) || ETSBatchRunner.bandOf(category) !== null
  }

  // 一括生成モード中に配下の全選択トグルとして働くグループボタンか
  isBatchGroupSelectable(tag, category) {
    if (!this.batchMode || !tag.startsWith('@')) {
      return false
    }
    return this.isBatchTemplate(category) || ETSBatchRunner.bandOf(category) !== null
  }

  // カテゴリパス（'00_テンプレート:01_SFW' 等）配下のリーフを再帰的に集める。
  // 単体テストのため this に依存させず static にしている
  static collectBatchLeaves(tags, category) {
    let node = tags
    for (const key of category.split(':')) {
      if (!node) {
        return []
      }
      node = node[key]
    }

    const leaves = []
    const walk = (values, path) => {
      if (Array.isArray(values)) {
        // 配列は renderTagButtons と同じくラベル = タグとして扱う
        values.forEach((tag) => leaves.push({ comment: tag, tag, category: path }))
        return
      }
      if (!values || typeof values !== 'object') {
        return
      }
      Object.entries(values).forEach(([key, value]) => {
        if (typeof value === 'string') {
          leaves.push({ comment: key, tag: value, category: path })
        } else {
          walk(value, `${path}:${key}`)
        }
      })
    }
    walk(node, category)
    return leaves
  }

  // グループ配下を再帰的に全選択／全解除する
  toggleBatchGroup(category) {
    const leaves = EasyTemplateSelector.collectBatchLeaves(this.tags, category)
    if (leaves.length === 0) {
      return
    }
    // 1 件でも未選択があれば全選択、すべて選択済みなら全解除
    const selectAll = !leaves.every((leaf) => this.isBatchSelected(leaf))
    leaves.forEach((leaf) => this.setBatchSelected(leaf, selectAll))
    // 枠線の復元は renderTagButton が行うので、まとめて描き直す
    this.render()
  }
```

既存の `toggleBatchSelection` を以下で置き換える:

```javascript
  // 一括生成対象の選択をトグルし、ボタンの見た目と件数表示を更新する
  toggleBatchSelection(button, comment, tag, category) {
    const leaf = { comment, tag, category }
    const selected = !this.isBatchSelected(leaf)
    this.setBatchSelected(leaf, selected)
    button.style.outline = selected ? EasyTemplateSelector.BATCH_SELECTED_OUTLINE : ''
    this.updateBatchProgress(this.batchSelectionSummary())
  }
```

`renderTagButton` の `onClick` にグループ分岐を足す（`isBatchSelectable` の分岐より**前**に置く。グループボタンは `@` 始まりなので `isBatchSelectable` は false を返すが、判定順を明示しておく）:

```javascript
    const onClick = this.guardBatchRunning((e) => {
      // 一括生成モード中のグループボタンは配下の全選択トグルにする
      if (this.isBatchGroupSelectable(tag, category)) {
        this.toggleBatchGroup(category)
        return
      }

      // 一括生成モード中のテンプレ・キャラ/衣装のボタンは適用せず選択をトグルする
      if (this.isBatchSelectable(tag, category)) {
        this.toggleBatchSelection(button, comment, tag, category)
        return
      }

      this.promptEditor.addTag(comment, tag, category, e.metaKey || e.ctrlKey)
    })
```

`renderTagButton` 末尾の枠線復元を、共通ヘルパーを使う形に変える:

```javascript
    // 再描画時に選択状態の見た目を復元する
    if (this.isBatchSelectable(tag, category) && this.isBatchSelected({ comment, category })) {
      button.style.outline = EasyTemplateSelector.BATCH_SELECTED_OUTLINE
    }
```

- [ ] **Step 5: 実行・停止・進捗をタブ行へ移す**

`renderTemplateSettings` から実行・停止・進捗の生成（`if (this.batchMode) { ... }` のブロック全体）を**削除**する。モードのチェックボックスは残し、OFF 時に両方の選択をクリアするよう変更する:

```javascript
    // 一括生成モードのトグル。ON の間はテンプレ・キャラ/衣装のボタンが選択トグルになる。
    // 実行中に OFF にすると停止ボタンごと消えて止められなくなるのでガードする
    const batchModeCheckbox = ETSElementBuilder.checkbox('一括生成モード', this.batchMode, {
      onChange: this.guardBatchRunning((checked) => {
        this.batchMode = checked
        if (!checked) {
          this.batchSelection.clear()
          this.batchSwapSelection.clear()
        }
        this.render()
      })
    })
    buttons.append(batchModeCheckbox)
```

`render()` の `row.appendChild(tabs)` の後に、一括生成の操作列を足す:

```javascript
    // 一括生成の実行・停止・進捗はどのタブからでも触れるようタブ行に置く
    // （キャラ/衣装は 00_テンプレート 以外のタブで選ぶため）
    if (this.batchMode) {
      row.appendChild(this.renderBatchControls())
    }
```

`renderBatchControls` をクラスに追加する:

```javascript
  // 一括生成の実行・停止・進捗の操作列
  renderBatchControls() {
    const controls = document.createElement('div')
    controls.style.display = 'flex'
    controls.style.alignItems = 'center'
    controls.style.gap = '4px'

    const runButton = ETSElementBuilder.baseButton('▶ 一括生成', { color: 'primary' })
    runButton.addEventListener('click', () => this.startBatch())
    controls.appendChild(runButton)

    const stopButton = ETSElementBuilder.baseButton('■ 停止', { color: 'secondary' })
    stopButton.addEventListener('click', () => this.batchRunner.stop())
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

- [ ] **Step 6: 実行開始で選択したキャラ/衣装を渡す**

`startBatch` を以下で置き換える:

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
    await this.batchRunner.start(items, Array.from(this.batchSwapSelection.values()))
  }
```

- [ ] **Step 7: 構文チェックと単体テストの回帰確認**

Run: `node --check javascript/easy_template_selector.js`
Expected: エラーなし

Run: `node --test`
Expected: 全件 PASS

- [ ] **Step 8: WebUI 実機確認**

WebUI の UI Reload 後、以下を確認する:

1. 「一括生成モード」ON でタブ行に `▶ 一括生成` / `■ 停止` / 進捗が現れ、**どのタブに切り替えても表示され続ける**
2. `10_キャラ` タブでキャラのボタンをクリックすると枠線が付き、`選択中: テンプレ 0 件 / キャラ・衣装 1 件` のように件数が更新される（プロンプト欄には何も追加されない）
3. `13_衣装` / `14_衣装小物` / `15_衣装状態` のボタンも同様に選択できる。`50_背景` など対象外カテゴリのボタンは従来どおりプロンプトに追加される
4. グループボタン（`10_キャラ_ブルアカ:アビドス` 等の見出しボタン）を押すと配下が全選択され、もう一度押すと全解除される。サブグループを持つ見出しでも配下すべてが対象になる
5. `00_テンプレート` タブのグループボタンでもテンプレを全選択／全解除できる
6. キャラ 2 件・衣装 2 件・テンプレ 3 件を選んで実行すると、テンプレごとに組み合わせが変わり、進捗に `1/3: <テンプレ名> ← ホシノ / セーラー服` のように引いた組み合わせが出る
7. テンプレに `13_衣装` のセクションが無い場合、衣装は挿入されず、テンプレ側の他の帯もそのまま残る（生成画像の infotext で確認する）
8. キャラ/衣装を 1 件も選ばずにテンプレだけ選んで実行すると、差し替えなしでテンプレのまま順次生成される
9. モードを OFF にするとテンプレ・キャラ/衣装の選択がすべてクリアされ、ボタンは通常の追加動作に戻る
10. 実行中はキャラ/衣装のボタンも含めて操作が無視され、`■ 停止` だけが効く

- [ ] **Step 9: コミット**

```bash
git add javascript/easy_template_selector.js
git commit -m "feat(batch): キャラ/衣装のボタン選択とグループ一括選択に対応"
```

---

### Task 4: ドキュメント更新

**Files:**
- Modify: `CLAUDE.md`（Coding Conventions の一括生成の記述）
- Modify: `README.md`（「一括生成モード」節）

**Interfaces:**
- Consumes: Task 1〜3 の実装内容
- Produces: なし

- [ ] **Step 1: CLAUDE.md を更新する**

`Coding Conventions` の一括生成に関する既存 6 項目のうち、以下を書き換え・追記する:

- 既存の「一括生成（`ETSBatchRunner`）の差し替え対象は `SWAP_PREFIXES`…」の行に、帯という概念を追記する: 「`bandOf()` が返す帯（`SWAP_PREFIXES` の該当要素）が差し替えの単位。帯ごとに独立して抽選・置換する」
- 以下を新規に追加する:
  - 差し替え元はボタン選択（`batchSwapSelection`）のみ。プロンプト欄から抽出する経路は廃止済みなので復活させない
  - 抽選（`pickSwapSections`）はテンプレごとに引き直す。乱数源は引数で注入して単体テスト可能にしている（`Math.random` を直接呼ばない）
  - 落とし穴: テンプレに存在しない帯は挿入しない。`applicableSections()` が「実際に挿入されるセクション」を返すので、反映確認（`isSwapApplied()`）にはこれを使う。`picked` 全件で確認すると、テンプレに無い帯のせいで永久に失敗扱いになる
  - 落とし穴: 同じ帯のセクションがテンプレに複数あるときは、最初の 1 件だけ置換し残りは削除する。残すとキャラが二重に並ぶ
  - 一括生成の実行・停止・進捗はタブ行（`render()` 内）に置く。キャラ/衣装は `00_テンプレート` 以外のタブで選ぶため、設定グループ内だと選択件数が見えない
  - グループボタンの全選択は `collectBatchLeaves()` が `this.tags` をカテゴリパスで辿って再帰的にリーフを集める。`renderTagButtons()` の `randomKey` の組み立て（`${prefix}:${key}`）と対になっているので、片方を変えるときは両方見る

- [ ] **Step 2: README.md の「一括生成モード」節を書き換える**

以下の点を反映する:

- 使い方の手順を「キャラ/衣装をプロンプト欄に組む」から「キャラ/衣装のボタンを選択する」に変更する
- 一括生成の操作列がタブ行にあり、どのタブからでも実行できることを書く
- カテゴリ帯ごとにランダムに 1 件引くこと、テンプレごとに引き直すこと（同じキャラが連続することもある）を書く
- テンプレに無いカテゴリは挿入されないこと、選択していないカテゴリはテンプレの値が残ることを書く
- グループボタンで配下を全選択／全解除できることを書く
- キャラ/衣装を選ばなければ差し替えなしでテンプレのまま生成されることを書く
- 既存の「差し替えの範囲」「注意」の各項目（Seed・停止・実行中のガード・失敗時の扱い）は維持する

- [ ] **Step 3: コミット**

```bash
git add CLAUDE.md README.md
git commit -m "docs: キャラ/衣装のボタン選択とランダム抽選の仕様を反映"
```

---

## 判断メモ

- **グループボタンの選択状態表示は非対応**: 配下が全選択かどうかを枠線で示すには、描画のたびに全グループの配下を走査する必要がある。テンプレ数が増えると再描画コストに響くため、選択状態はリーフのボタンだけで示す
- **`extractSwapSections` を残す理由**: プロンプト欄からの抽出経路は廃止するが、「あるプロンプトに含まれる差し替え対象セクションを列挙する」処理自体は `applicableSections` が使う。関数名が抽出元を限定していないのでそのまま流用する
- **抽選の重複排除は行わない**: ヒアリングで「テンプレごとに毎回引き直す（重複可）」を選択済み。一巡するまで重複させない案も提示した上での決定

## レビュー却下メモ

- グループ配下が全選択かどうかを目視で確認する手段が無い（plan-review 🟡）— グループボタンを押すと `render()` が走り、配下のリーフボタンに枠線が付く。グループ自体に状態表示が無くても配下を見れば判別できるため、走査コストを払ってまで対応しない（未確認のまま見送りではなく判断済み却下）
