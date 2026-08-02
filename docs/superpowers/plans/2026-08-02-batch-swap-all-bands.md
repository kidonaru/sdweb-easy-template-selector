# 一括生成の差し替え対象を全カテゴリへ拡張 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一括生成の差し替え対象をキャラ/衣装の 4 帯に限定するのをやめ、`00_テンプレート` と 90 番台以降を除くすべてのカテゴリを対象にする。あわせて、同じ帯のセクションが複数あるテンプレで 2 件目以降が消える既存の欠落を直す。

**Architecture:** 帯の判定を許可リスト（`SWAP_PREFIXES`）から除外ルールへ反転させる。帯はカテゴリの先頭の番号（`10` / `13` / `50` …）とする。現行の `SWAP_PREFIXES` も `10_キャラ` が `10_キャラ_ブルアカ` を前方一致で拾う形で実質「番号 = 帯」として動いていたため、この定義は既存の抽選粒度をそのまま引き継ぐ。判定は `ETSBatchRunner.bandOf()` の 1 箇所に閉じており、選択可能なボタン・抽選プール・差し替え対象の 3 つが同時に追随する。あわせて `swapSections()` を「帯の最初の 1 件だけ置換し、残りはそのまま残す」に変える。

**Tech Stack:** Vanilla JS（WebUI 拡張、ビルドなし）、`node --test`（純粋ロジックの単体テスト）

**先行実装:** `docs/superpowers/plans/2026-08-02-batch-swap-selection.md` / `2026-08-02-batch-mode-header-ui.md`（コミット `5e57d42`〜`5cc286b`）。本計画はその上に載る差分。

## Global Constraints

- コードのコメント・エラーログメッセージは日本語で書く
- `javascript/` 配下のファイルはトップレベルで他ファイルのクラスを参照しない
- 帯の判定は `ETSBatchRunner.bandOf()` を単一のソースとする。呼び出し側（`easy_template_selector.js` の `isBatchTargetCategory()` 等）に個別の除外条件を足さない
- 除外の閾値はマジックナンバーにせず static 定数として持つ
- JS の変更は WebUI の UI Reload で反映される（再起動不要）

## 仕様の決定事項（ヒアリング済み）

| 論点 | 決定 |
|---|---|
| 対象カテゴリ | `00_テンプレート` と 90 番台以降（`90` / `96` / `97` / `98` / `99`）を除くすべて |
| `01_クオリティ:Model` | 例外を作らず対象に含める（`01_クオリティ` を丸ごと） |
| LoRA 系（`70`〜`75` / `_LoRA`） | 例外を作らず対象に含める |
| 帯の単位 | カテゴリ先頭の番号。`10_キャラ` と `10_キャラ_ブルアカ` は同じ帯 |
| 同じ帯が複数あるテンプレ | 最初の 1 件だけ置換し、2 件目以降はそのまま残す（現行の削除をやめる） |
| 進捗の件数表示 | 現状の文言のまま（ラベルだけ「キャラ・衣装」→「タグ」に直す） |

## 2 件目以降を削除しなくなる理由

現行の `swapSections()` は「差し替え後にキャラが二重に並ばないように」同じ帯の 2 件目以降を削除している。しかし全テンプレート（35 件）を集計したところ、重複ゼロなのは `10_キャラ` だけで、他の帯は 1 テンプレに複数セクションが並ぶのが常態だった。

| 帯 | 重複を含むテンプレ数 |
|---|---|
| `01_クオリティ` | 33 |
| `30_ポーズ` | 18 |
| `33_状況` | 16 |
| `60_効果` | 13 |
| `23_表情` / `15_衣装状態` | 各 11 |
| `16_肌の状態` | 8 |
| `20_目の状態` | 6 |
| `70_スタイルLoRA` / `50_背景` / `41_フォーカス` / `13_衣装` / `02_対象` | 各 5 |

対象を広げると、たとえば `33_状況` を 1 件選んだだけで `射精 / 半透明の精液 / ぶっかけ / 顔射 …` の 9 件が 1 件に潰れる。さらに **拡張前の現時点でも `13_衣装`（5 テンプレ）・`15_衣装状態`（11 テンプレ）・`14_衣装小物`（1 テンプレ）で 2 件目以降が消える欠落が起きている**。`10_キャラ` に重複が無い以上、削除は二重表示の防止に寄与しておらず、欠落だけを生んでいる。

## 対象・非対象の一覧

| カテゴリ | 帯 | 判定 |
|---|---|---|
| `00_テンプレート` | — | 非対象（テンプレ選択として別扱い） |
| `01_クオリティ` / `02_対象` / `10`〜`16` / `20`〜`24` / `30`〜`33` / `40`〜`41` / `50`〜`52` / `60`〜`65` / `70`〜`75` | 先頭の番号 | 対象 |
| `90_モデル` / `96_解像度` / `97_Color` / `98_特殊` / `99_ネガティブ` | — | 非対象（テキスト挿入以外の副作用を持つ／コメント行を持たない） |

## File Structure

| ファイル | 責務 | 本計画での変更 |
|---|---|---|
| `javascript/ets_batch_runner.js` | 帯判定・抽選・帯単位差し替え | `SWAP_PREFIXES` を廃し `bandOf()` を除外ルールへ |
| `javascript/easy_template_selector.js` | UI 描画・選択状態 | 進捗の文言のみ |
| `tests/ets_batch_runner.test.mjs` | 純粋ロジックの単体テスト | 帯判定のテストを新仕様へ |
| `CLAUDE.md` / `README.md` | 規約・使い方 | 新仕様へ更新 |

---

### Task 1: 帯判定を除外ルールへ反転する

**Files:**
- Modify: `javascript/ets_batch_runner.js`（`SWAP_PREFIXES` と `bandOf`）
- Test: `tests/ets_batch_runner.test.mjs`

**Interfaces:**
- Consumes: なし（`bandOf` は文字列だけを見る純粋関数）
- Produces:
  - `ETSBatchRunner.NON_SWAP_CATEGORY_PREFIX = '00_'`（テンプレ本体。帯を持たない）
  - `ETSBatchRunner.NON_SWAP_BAND_MIN = 90`
  - `ETSBatchRunner.bandOf(category) → string | null`（**返り値が `'10_キャラ'` 形式から `'10'` 形式に変わる破壊的変更**。抽選プールの内部キーとしてしか使われないため呼び出し側の変更は不要）
  - `ETSBatchRunner.SWAP_PREFIXES` は**削除する**

- [ ] **Step 1: 失敗するテストを書く**

`tests/ets_batch_runner.test.mjs` の `bandOf` のテストを以下で置き換える（`test('bandOf は SWAP_PREFIXES の該当要素を返し、対象外は null を返す', ...)` の 1 テストを 3 テストに差し替える）:

```javascript
test('bandOf はカテゴリ先頭の番号を帯として返す', () => {
  assert.equal(ETSBatchRunner.bandOf('10_キャラ_ブルアカ:トリニティ'), '10')
  assert.equal(ETSBatchRunner.bandOf('15_衣装状態_基本'), '15')
  // 同じ番号のファイルは同じ帯にまとまる
  assert.equal(ETSBatchRunner.bandOf('10_キャラ'), ETSBatchRunner.bandOf('10_キャラ_LoRA'))
})

test('bandOf はキャラ/衣装以外のカテゴリも対象にする', () => {
  assert.equal(ETSBatchRunner.bandOf('50_背景_基本:基本'), '50')
  assert.equal(ETSBatchRunner.bandOf('01_クオリティ:Model'), '01')
  assert.equal(ETSBatchRunner.bandOf('23_表情:基本'), '23')
})

test('bandOf はテンプレ本体と 90 番台以降を対象外にする', () => {
  assert.equal(ETSBatchRunner.bandOf('00_テンプレート:01_SFW'), null)
  assert.equal(ETSBatchRunner.bandOf('90_モデル'), null)
  assert.equal(ETSBatchRunner.bandOf('96_解像度'), null)
  assert.equal(ETSBatchRunner.bandOf('97_Color'), null)
  assert.equal(ETSBatchRunner.bandOf('99_ネガティブ:Model'), null)
})

test('bandOf は番号で始まらないカテゴリと null を対象外にする', () => {
  assert.equal(ETSBatchRunner.bandOf('カスタム'), null)
  assert.equal(ETSBatchRunner.bandOf(null), null)
})
```

同ファイル内の既存テストのうち、`groupByBand` / `pickSwapSections` / `applicableSections` が帯名を直接参照している箇所を新しい帯名に直す。該当は以下の 4 箇所:

```javascript
// 'groupByBand は帯ごとにセクションをまとめる' 内
  assert.deepEqual(Array.from(pools.keys()), ['10', '13'])
  assert.equal(pools.get('10').length, 2)
  assert.equal(pools.get('13').length, 1)

// 'groupByBand は対象外カテゴリとコメント行なしのセクションを捨てる' 内
// 50_背景 は対象になったので、対象外の例を 97_Color（帯を持たない生タグ行）だけに絞る
test('groupByBand はコメント行なしのセクションを捨てる', () => {
  const pools = ETSBatchRunner.groupByBand(editor, ['red theme,', HOSHINO])
  assert.deepEqual(Array.from(pools.keys()), ['10'])
})

// 'pickSwapSections は帯ごとに 1 件ずつ引く（乱数は注入する）' 内
  assert.equal(picked.get('10'), HOSHINO)
  assert.equal(picked.get('13'), SERAFUKU)
  assert.equal(pickedLast.get('10'), KAZUSA)
  assert.equal(pickedLast.get('13'), TAISOFUKU)
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/ets_batch_runner.test.mjs`
Expected: FAIL（`bandOf` が `'10_キャラ'` を返す。`50_背景` / `01_クオリティ` が null になる）

- [ ] **Step 3: `bandOf` を書き換える**

`javascript/ets_batch_runner.js` の `SWAP_PREFIXES` の定義（L3-4）を以下で置き換える:

```javascript
  // 差し替え対象外のカテゴリ。テンプレ本体は選択の扱いが別なので帯を持たせない
  static NON_SWAP_CATEGORY_PREFIX = '00_'
  // 90 番台以降（モデル・解像度・Color・特殊・ネガティブ）はテキスト挿入以外の副作用を持つため対象外
  static NON_SWAP_BAND_MIN = 90
```

`bandOf` を以下で置き換える:

```javascript
  // カテゴリが属する差し替え帯（先頭の番号）。対象外は null。
  // 10_キャラ と 10_キャラ_ブルアカ のように番号が同じカテゴリは同じ帯にまとまる
  static bandOf(category) {
    if (!category || category.startsWith(ETSBatchRunner.NON_SWAP_CATEGORY_PREFIX)) {
      return null
    }
    // カテゴリは 'ファイル名:グループ' 形式なので、帯の判定はファイル名側だけを見る
    const band = category.split(':')[0].match(/^\d+/)?.[0]
    if (!band || Number(band) >= ETSBatchRunner.NON_SWAP_BAND_MIN) {
      return null
    }
    return band
  }
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test`
Expected: 全件 PASS

- [ ] **Step 5: 2 件目以降を削除しない失敗するテストを書く**

`tests/ets_batch_runner.test.mjs` の `test('swapSections は同じ帯の 2 件目以降を削除する', ...)` を以下で置き換える:

```javascript
test('swapSections は同じ帯の最初の 1 件だけ置換し、2 件目以降はそのまま残す', () => {
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

  // 最初の 1 件だけホシノに置き換わる
  assert.match(result, /ホシノ/)
  assert.doesNotMatch(result, /カズサ/)
  // 2 件目以降はテンプレの記述として残す（消すとポーズや状況の描写が欠落するため）
  assert.match(result, /シロコ/)
  assert.match(result, /outdoors,/)
})

test('swapSections は同じ帯が並ぶテンプレのセクション数を変えない', () => {
  const prompt = [
    '# 33_状況:精液 (射精),',
    'ejaculation,',
    '# 33_状況:精液 (顔射),',
    'facial,',
    '# 33_状況:精液 (精液が滴る),',
    'cum drip,',
  ].join('\n')
  const pools = ETSBatchRunner.groupByBand(editor, ['# 33_状況:精液 (ぶっかけ),\nbukkake,'])
  const picked = ETSBatchRunner.pickSwapSections(pools, () => 0)
  const result = ETSBatchRunner.swapSections(editor, prompt, picked)

  assert.equal(result.split('\n').length, prompt.split('\n').length)
  assert.match(result, /ぶっかけ/)
  assert.doesNotMatch(result, /射精/)
  assert.match(result, /顔射/)
  assert.match(result, /精液が滴る/)
})
```

Run: `node --test tests/ets_batch_runner.test.mjs`
Expected: FAIL（現行の `swapSections` は 2 件目以降を削除するため、`シロコ` / `顔射` が残らず行数も減る）

- [ ] **Step 6: `swapSections` から削除をやめる**

`javascript/ets_batch_runner.js` の `swapSections` を以下で置き換える:

```javascript
  // テンプレのプロンプトを帯単位で差し替える。
  // 帯ごとに最初の出現位置だけを picked の内容へ置き換え、2 件目以降はそのまま残す。
  // テンプレに存在しない帯は挿入せず、picked に無い帯のセクションもそのまま残す
  static swapSections(editor, templatePrompt, picked) {
    if (picked.size === 0) {
      return templatePrompt
    }

    const usedBands = new Set()
    return editor.splitSections(templatePrompt).map((section) => {
      const band = ETSBatchRunner.bandOf(editor.parseSection(section).category)
      if (!band || !picked.has(band) || usedBands.has(band)) {
        return section
      }
      usedBands.add(band)
      return picked.get(band)
    }).join('\n')
  }
```

Run: `node --test`
Expected: 全件 PASS

- [ ] **Step 7: 内部コメントとエラーログの文言を実態に合わせる**

対象が「キャラ/衣装」に限らなくなるため、以下の文言を直す。

`javascript/ets_batch_runner.js`:

| 箇所 | 変更後 |
|---|---|
| ファイル冒頭のコメント | `// タグセクションを差し替えながら複数テンプレートを順次生成するバッチ実行` |
| `start()` の JSDoc 的コメント | `// 選択テンプレを順次生成する。swapSectionTexts は選択されたタグのセクション文字列` |
| `runOne()` 内の差し替えブロックのコメント | `// 選択したタグのセクションを差し替える。遅延書き戻しで消えた場合に備えて反映確認つきで再試行し、` |
| `runOne()` 内の `console.error` | `一括生成: タグの差し替えが反映できませんでした (${item.name})` |

`javascript/easy_template_selector.js`:

| 箇所 | 変更後 |
|---|---|
| constructor の `batchSwapSelection` のコメント | `// 差し替えるタグの選択。「カテゴリ + ラベル → セクション文字列」` |
| `isBatchSelectable` のコメント | `// 一括生成モード中に選択トグルの対象となるボタンか（テンプレ本体・差し替え対象のタグ）` |
| `isBatchTargetCategory` のコメント | `// 一括生成モードで選択の対象になりうるカテゴリか（テンプレ本体 / 差し替え対象の帯）` |
| `renderTagButton` の `onClick` 内コメント | `// 一括生成モード中のテンプレ・タグのボタンは適用せず選択をトグルする` |
| `batchModeCheckbox` のコメント | `// 一括生成モードのトグル。ON の間はテンプレ・タグのボタンが選択トグルになる。` |
| `syncBatchModeUi` 内の readOnly のコメント | 変更不要 |

Run: `node --check javascript/ets_batch_runner.js`
Expected: エラーなし

- [ ] **Step 8: 進捗の文言を直す**

`javascript/easy_template_selector.js` の `batchSelectionSummary()` を以下で置き換える（キャラ/衣装に限らなくなったため）:

```javascript
  // 進捗欄に出す選択件数
  batchSelectionSummary() {
    return `選択中: テンプレ ${this.batchSelection.size} 件 / タグ ${this.batchSwapSelection.size} 件`
  }
```

Run: `node --check javascript/easy_template_selector.js`
Expected: エラーなし

- [ ] **Step 9: WebUI 実機確認**

WebUI の UI Reload 後、以下を確認する:

1. 一括生成モード ON で `50_背景` / `23_表情` / `30_ポーズ` のボタンが選択トグルになる（プロンプト欄に追加されない）
2. `90_モデル` / `96_解像度` / `97_Color` / `98_特殊` / `99_ネガティブ` のボタンは従来どおりプロンプトへの追加・適用として動く
3. `00_テンプレート` タブのボタンは従来どおりテンプレの選択として動く
4. `10_キャラ` と `10_キャラ_ブルアカ` から 1 件ずつ選ぶと、両方が同じ帯の候補として扱われる（生成ごとにどちらか一方だけが入る）
5. 背景 2 件・表情 2 件・テンプレ 2 件を選んで実行すると、テンプレごとに背景と表情が独立に引き直される
6. テンプレに存在しないカテゴリ（例: `33_状況` を持たないテンプレ）は挿入されない
7. 進捗表示が `選択中: テンプレ N 件 / タグ M 件` になっている
8. 同じ帯が複数並ぶテンプレ（例: `33_状況` が 9 件ある `templates/02_NSFW/複数人に囲まれてぶっかけ.txt`）で `33_状況` のタグを選んで実行すると、1 件目だけ差し替わり残り 8 件は生成画像の infotext に残る
9. `13_衣装` が 2 件あるテンプレで衣装を選ぶと、1 件目だけ差し替わり 2 件目は残る（拡張前は消えていた）

- [ ] **Step 10: コミット**

```bash
git add javascript/ets_batch_runner.js javascript/easy_template_selector.js tests/ets_batch_runner.test.mjs
git commit -m "feat(batch): 差し替え対象を 90 番台以降を除く全カテゴリへ拡張"
```

---

### Task 2: ドキュメント更新

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 1 の実装内容
- Produces: なし

- [ ] **Step 1: CLAUDE.md を更新する**

`Coding Conventions` の「一括生成（`ETSBatchRunner`）の差し替え対象は `SWAP_PREFIXES`…」の行を以下で置き換える:

- 一括生成の差し替え対象は `ETSBatchRunner.bandOf()` が決める。帯はカテゴリ先頭の番号で、`00_テンプレート`（テンプレ選択として別扱い）と `NON_SWAP_BAND_MIN`（90）以上は対象外。対象を変えるときはこの 1 箇所だけを直す（選択できるボタン・抽選プール・差し替え対象が同時に追随する）
- 落とし穴: 帯は番号なので `10_キャラ` と `10_キャラ_ブルアカ` は同じ帯に入り、両方から選んでも 1 件しか採用されない。別々に引きたいならカテゴリの番号を分ける

「落とし穴: 同じ帯のセクションがテンプレに複数あるときは、最初の 1 件だけ置換し残りは削除する。残すとキャラが二重に並ぶ」の行を以下で置き換える:

- 落とし穴: 同じ帯のセクションがテンプレに複数あるときは、最初の 1 件だけ置換して残りはそのまま残す。**削除してはいけない**。`10_キャラ` 以外の帯（`33_状況` / `30_ポーズ` / `01_クオリティ` など）は 1 テンプレに複数並ぶのが常態で、削除するとテンプレの描写が丸ごと欠落する。`10_キャラ` は全テンプレで重複が無いため、削除しなくてもキャラが二重に並ぶことはない

`SWAP_PREFIXES` に言及している他の記述に加え、`System Structure` のファイル一覧にある `ets_batch_runner.js # ETSBatchRunner: キャラ/衣装差し替えの一括生成（順次実行・待機制御）` の説明も「タグ差し替えの一括生成」に直す。

- [ ] **Step 2: README.md を更新する**

以下の点を反映する:

- 「差し替えの範囲」節を、`10_キャラ` / `13_衣装` / `14_衣装小物` / `15_衣装状態` の列挙から「`00_テンプレート` と 90 番台以降（`90_モデル` / `96_解像度` / `97_Color` / `98_特殊` / `99_ネガティブ`）を除くすべてのカテゴリ」に書き換える
- 体型・容姿・肌の状態がテンプレ側の値のまま使われるという記述は、選択しなければテンプレ側が残るという一般則に置き換える
- 「組み合わせの抽選」節の「カテゴリ帯」の説明に、帯はカテゴリ先頭の番号であること、番号が同じカテゴリ（`10_キャラ` と `10_キャラ_ブルアカ`）は同じ帯として 1 件だけ引かれることを追記する
- 手順 3 の「キャラ/衣装のボタン」という表現をカテゴリ全般に広げる
- 進捗表示の例（`選択中: テンプレ 0 件 / キャラ・衣装 1 件`）を新しい文言に直す
- 同じカテゴリのセクションがテンプレに複数あるときは 1 件目だけ差し替わり、残りはテンプレのまま残ることを「注意」節に追記する
- 節見出しやリード文の「キャラ/衣装」という表現を、対象が全カテゴリになったことに合わせて直す

- [ ] **Step 3: コミット**

```bash
git add CLAUDE.md README.md
git commit -m "docs: 一括生成の差し替え対象の拡張を反映"
```

---

## 判断メモ

- **帯を番号にする理由**: 現行の `SWAP_PREFIXES`（`10_キャラ` 等）は前方一致で `10_キャラ_ブルアカ` / `10_キャラ_LoRA` を同じ帯として扱っていた。番号を帯にすると同じ粒度を維持したまま、カテゴリ追加のたびにリストを更新する必要が無くなる
- **`01_クオリティ:Model` を除外しない理由**: ヒアリングで「例外を作らず 90 番台以降以外はすべて」と決定済み。実モデルの切替はテンプレの `Model` メタが行うため、このセクションだけ差し替えるとプロンプトの表記と実モデルが食い違いうるが、選ばなければ起きない
- **LoRA 系を除外しない理由**: 同上。LoRA はトリガーワードと対で学習されているため入れ替えると破綻しやすいが、これは「選んだ場合の結果」であって仕組み側で防ぐ性質のものではないとユーザーが判断した
- **2 件目以降の削除をやめる判断**: plan-review の 🔴 指摘を受け、全 35 テンプレートの帯の重複を集計して裏を取ったうえで決定した。削除が守っていた「キャラの二重表示」は `10_キャラ` に重複が無いため元から発生しえず、実際には既存テンプレの衣装・衣装状態を欠落させていた
- **`97_Color` / `98_特殊` が二重に除外される**: 90 番台以降として除外されるうえ、そもそも `isForceAddCategory()` によりコメント行を持たないため `parseSection()` の category が null になり帯判定に乗らない。どちらか一方でも防げるが、意図を明示するため番号での除外を残す
