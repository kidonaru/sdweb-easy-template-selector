# オートコンプリート改修 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** プロンプト補完で (1) カッコを含むラベルを最後まで打てるようにし（半角 `(` / IME の全角 `（` の両方）、(2) 確定時にコメント行だけでなく直後のタグ行も置き換える。

**Architecture:** 変更は 2 ファイル。`ets_completion.js` はトリガ停止文字から `(` `)` を外し、置換範囲を「コメント行 + 直後のタグ行」へ広げる静的メソッド `extendToTagLine()` を追加する。`ets_completion_index.js` は検索用の正規化を NFKC + 小文字に変え、エントリ側は構築時に前計算する（IME で入る全角 `（` を半角ラベルに一致させるため）。DOM 非依存部分に閉じるので `node --test` で検証できる。

**Tech Stack:** 素の JavaScript（クラス、ビルドなし）／`node --test`（`tests/*.test.mjs` が `new Function` でクラスを読み込む方式）

## Global Constraints

- コードのコメント・エラーログメッセージは日本語で記述する。
- `javascript/` 配下はトップレベルで他ファイルのクラスを参照しない。
- `ETSCompletionIndex.flatten()` が返すエントリの形（`{ comment, tag, category }`）は変えない（`tests/ets_completion_index.test.mjs` と `ETSElementBuilder.completionItem()` が依存）。
- テストは `node --test` をリポジトリルートで実行する。

## 事前調査で確定した事実（計画の前提）

- `ETSSection.toString()` のヘッダーは無条件に `,` で終わる（`javascript/ets_section.js:30`）。よって停止文字を `,` だけにしても確定済みコメント行との区別は保てる。
- `tags/*.yml`（ローカル専用の `_` 付きを含む）に全角 `（` `）` を含む行は **0 件**。ラベルは全て半角。一方 IME 日本語入力中に打つ `(` は既定で全角 `（` になるため、正規化なしでは要望 1 が実質満たせない。→ Task 1 に NFKC 正規化を含める。
- tagcomplete の語切り出し `NORMAL_TAG_REGEX = /[^\s,|<>():\[\]]+|.../`（`a1111-sd-webui-tagcomplete/javascript/tagAutocomplete.js:426`）は **半角 `(` を区切りとして扱う**。よって `#マリー(体操服` と打つと tagcomplete 側の検索語は `#` の付かない `体操服` になり、tagcomplete のポップアップが出うる（これは本改修の前後で変わらない既存挙動。今回の変更で当拡張のポップアップも同時に出るようになる＝二重表示になりうる）。キー操作は当拡張が `gradioApp()` の捕捉フェーズで `stopPropagation()` するため奪える。全角 `（` は tagcomplete の区切りではないので語は `#マリー（体操服` のままとなり、tagcomplete 側は反応しない。→ 制限として Task 3 で CLAUDE.md に記録し、実機確認で許容範囲か見る。
- `ETSHistory.saveTextHistory()` は **呼んだ時点の DOM の値** を積む（`javascript/ets_history.js:24`）。現状 `confirm()` は変更後にしか積まないため、確定で消えたテキストは拡張の Undo で戻せない（`textarea.value` 直代入でブラウザ標準の Undo も失われる）。→ Task 2 で変更前にも積む。

---

### Task 1: カッコを含むラベルでも補完を継続する

**Files:**
- Modify: `javascript/ets_completion.js:9-10`（`STOP_CHARS`）
- Modify: `javascript/ets_completion_index.js`（`constructor` / `search` / `rankOf` の正規化）
- Test: `tests/ets_completion.test.mjs:39-43`（既存テストの差し替え）
- Test: `tests/ets_completion_index.test.mjs`（末尾にテスト追加）

**Interfaces:**
- Consumes: なし
- Produces:
  - `ETSCompletion.extractQuery(value, caret)`：戻り値の形は不変（`null` / `{ lineStart, lineEnd, query }`）。`(` `)` では停止しなくなる
  - `ETSCompletionIndex.normalize(text) -> string`（NFKC + 小文字）
  - `index.entries[i].normalized = { comment, tag, category }`（構築時に前計算する検索用フィールド。`comment` / `tag` / `category` はそのまま残す）

- [ ] **Step 1: 失敗するテストを書く（トリガ側）**

`tests/ets_completion.test.mjs` の以下を置き換える。

置き換え前:

```javascript
test('カンマ・カッコが行に入った時点で発火しない', () => {
  assert.equal(extract('#細めた,|'), null)
  assert.equal(extract('#細めた(|'), null)
  assert.equal(extract('#細め|た)'), null)
})
```

置き換え後:

```javascript
test('カンマが行に入った時点で発火しない', () => {
  assert.equal(extract('#細めた,|'), null)
})

test('カッコはクエリに含める（ラベル自体がカッコを含むため）', () => {
  assert.deepEqual(extract('#マリー(体操服|'), {
    lineStart: 0,
    lineEnd: 8,
    query: 'マリー(体操服',
  })
  assert.deepEqual(extract('#マリー（体操服|'), {
    lineStart: 0,
    lineEnd: 8,
    query: 'マリー（体操服',
  })
  assert.deepEqual(extract('#マリー(体操服)|'), {
    lineStart: 0,
    lineEnd: 9,
    query: 'マリー(体操服)',
  })
})

test('カンマを消しただけの既存コメント行はクエリになる（候補が無ければ閉じる）', () => {
  assert.deepEqual(extract('# 20_目の状態 (細めた目)|'), {
    lineStart: 0,
    lineEnd: 16,
    query: ' 20_目の状態 (細めた目)',
  })
})
```

- [ ] **Step 2: 失敗するテストを書く（検索側）**

`tests/ets_completion_index.test.mjs` の末尾に追加する。

```javascript
test('全角カッコのクエリでも半角カッコのラベルに一致する', () => {
  const index = new ETSCompletionIndex({
    '10_キャラ': { 'ブルアカ': { 'マリー(体操服)': 'mari, gym uniform' } },
  })

  assert.deepEqual(index.search('マリー（体操服', 'positive').map((e) => e.comment), ['マリー(体操服)'])
  assert.deepEqual(index.search('マリー(体操服', 'positive').map((e) => e.comment), ['マリー(体操服)'])
})

test('全角英数のクエリでも半角のタグに一致する', () => {
  const index = new ETSCompletionIndex({ '65_その他': { 'ソロ': 'solo' } })

  assert.deepEqual(index.search('ｓｏｌｏ', 'positive').map((e) => e.comment), ['ソロ'])
})
```

- [ ] **Step 3: テストを実行して失敗を確認**

Run: `node --test`
Expected: FAIL（`extract('#マリー(体操服|')` が `null`、全角クエリの検索結果が空）

- [ ] **Step 4: トリガ側の実装**

`javascript/ets_completion.js`、置き換え前:

```javascript
  // 行に含まれていたら補完を出さない文字（既存のコメント行と区別するため）
  static STOP_CHARS = /[,()]/
```

置き換え後:

```javascript
  // 行に含まれていたら補完を出さない文字。
  // 確定済みのコメント行は必ず `,` で終わる（ETSSection.toString()）ので、これだけで
  // 入力中の行と区別できる。カッコはラベル自体に含まれるため停止させない
  static STOP_CHARS = /,/
```

- [ ] **Step 5: 検索側の実装**

`javascript/ets_completion_index.js`、置き換え前:

```javascript
  constructor(tags) {
    this.entries = ETSCompletionIndex.flatten(tags)
  }
```

置き換え後:

```javascript
  constructor(tags) {
    // 検索用の正規化はキー入力ごとに全件走るため、エントリ側は構築時に前計算する
    this.entries = ETSCompletionIndex.flatten(tags).map((entry) => ({
      ...entry,
      normalized: {
        comment: ETSCompletionIndex.normalize(entry.comment),
        tag: ETSCompletionIndex.normalize(entry.tag),
        category: ETSCompletionIndex.normalize(entry.category),
      },
    }))
  }

  // 検索用の正規化。IME 日本語入力では `(` が全角 `（` になるが、
  // ラベル側は半角で書かれているため NFKC で寄せてから比較する
  static normalize(text) {
    return (text ?? '').normalize('NFKC').toLowerCase()
  }
```

`search()` の冒頭、置き換え前:

```javascript
    const normalized = query.trim().toLowerCase()
```

置き換え後:

```javascript
    const normalized = ETSCompletionIndex.normalize(query.trim())
```

`rankOf()`、置き換え前:

```javascript
  // 一致の強さ。小さいほど上位。一致しない場合は null
  static rankOf(entry, normalized) {
    const comment = entry.comment.toLowerCase()
    if (comment.startsWith(normalized)) return 0
    if (comment.includes(normalized)) return 1
    if (entry.tag.toLowerCase().includes(normalized)) return 2
    if (entry.category.toLowerCase().includes(normalized)) return 3
    return null
  }
```

置き換え後:

```javascript
  // 一致の強さ。小さいほど上位。一致しない場合は null
  // entry.normalized は constructor が前計算した検索用の値
  static rankOf(entry, normalized) {
    const { comment, tag, category } = entry.normalized
    if (comment.startsWith(normalized)) return 0
    if (comment.includes(normalized)) return 1
    if (tag.includes(normalized)) return 2
    if (category.includes(normalized)) return 3
    return null
  }
```

- [ ] **Step 6: テストを実行して成功を確認**

Run: `node --test`
Expected: PASS（既存の「既存のコメント行では発火しない」「大文字小文字を区別しない」も通ること）

- [ ] **Step 7: コミット**

```bash
git add javascript/ets_completion.js javascript/ets_completion_index.js tests/ets_completion.test.mjs tests/ets_completion_index.test.mjs
git commit -m "fix(completion): カッコを含むラベルでも補完を継続する"
```

---

### Task 2: 確定時にコメント行に続くタグ行も置き換える

**Files:**
- Modify: `javascript/ets_completion.js`（`buildReplacement()` の直後に静的メソッド追加、`confirm()` の置換範囲と履歴保存）
- Test: `tests/ets_completion.test.mjs`（末尾にテスト追加）

**Interfaces:**
- Consumes: Task 1 の `ETSCompletion.extractQuery()`（`{ lineStart, lineEnd, query }`）
- Produces: `ETSCompletion.extendToTagLine(value, lineStart, lineEnd) -> number`
  - `lineStart` / `lineEnd` はコメント行の開始・終端インデックス（終端は改行の位置、または `value.length`）
  - 次の条件を **すべて** 満たすときだけ、直後の行の終端インデックスを返す。満たさなければ `lineEnd` をそのまま返す
    1. 直後に行が存在する
    2. 直後の行が空白のみでなく、`#` で始まらない
    3. **直前の行が存在しないか、`#` で始まらない**

**背景と判定の根拠:**

- セクションは「コメント行 + タグ行」の 2 行構成（`ETSPromptEditor.splitSections()` は非コメント行で必ずセクションを閉じるため、タグ行は 1 行）。確定処理がカーソル行 1 行だけを置換していたため、入力済みセクションを打ち直すと古いタグ行が取り残されていた。
- 条件 2（空行を含めない）: 空行は「区切りとして置かれた行」と「タグが空のセクション」の区別が付かないため、安全側に倒す。
- 条件 3（直前がコメント行なら広げない）: 既存コメント行の直後に改行して新しい `#` 行を挿入した場合、その次行は **前のセクションのタグ行** であり、飲み込むと無関係なタグが消える。直前がコメント行＝「自分は挿入された行」と判定して広げない。代償として「タグを持たないセクションの直後にあるセクション」を打ち直したときは古いタグ行が残るが、データ消失より軽い。

- [ ] **Step 1: 失敗するテストを書く**

`tests/ets_completion.test.mjs` の末尾に追加する。

```javascript
// 行末インデックス（改行の位置、無ければ末尾）を求める
const lineEndOf = (value, lineStart) => {
  const index = value.indexOf('\n', lineStart)
  return index === -1 ? value.length : index
}

// コメント行の開始位置を指定して extendToTagLine を呼ぶ
const extendFrom = (value, lineStart) =>
  ETSCompletion.extendToTagLine(value, lineStart, lineEndOf(value, lineStart))

test('コメント行に続くタグ行を置換範囲に含める', () => {
  const value = '#細めた\nnarrowed eyes,\nblush,'

  // タグ行 1 行だけを飲み込み、その先の行は残す
  assert.equal(extendFrom(value, 0), value.indexOf('\nblush,'))
})

test('次の行がコメント行なら置換範囲を広げない', () => {
  const value = '#細めた\n# 30_ポーズ (立ち),\nstanding,'

  assert.equal(extendFrom(value, 0), lineEndOf(value, 0))
})

test('次の行が空行・空白のみなら置換範囲を広げない', () => {
  const blank = '#細めた\n\nblush,'
  assert.equal(extendFrom(blank, 0), lineEndOf(blank, 0))

  const spaces = '#細めた\n   \nblush,'
  assert.equal(extendFrom(spaces, 0), lineEndOf(spaces, 0))
})

test('末尾行・改行で終わるテキストでは置換範囲を広げない', () => {
  const value = '1girl,\n#細めた'
  assert.equal(extendFrom(value, value.indexOf('#')), value.length)

  const trailing = '#細めた\n'
  assert.equal(extendFrom(trailing, 0), lineEndOf(trailing, 0))
})

test('直前がコメント行なら置換範囲を広げない（挿入された行とみなす）', () => {
  // 既存セクションのコメント行直後に改行して打った状況。
  // 次行 narrowed eyes, は前のセクションのタグなので飲み込んではいけない
  const value = '# 20_目の状態 (細めた目),\n#立ち\nnarrowed eyes,'
  const lineStart = value.indexOf('#立ち')

  assert.equal(extendFrom(value, lineStart), lineEndOf(value, lineStart))
})

test('タグ行まで含めて置換すると古いタグが残らない', () => {
  const value = '1girl,\n# 20_目の状態 (見開いた目),\nwide-eyed,\nblush,'
  const lineStart = value.indexOf('# 20_')
  const section = '# 20_目の状態 (細めた目),\nnarrowed eyes,'

  const range = { lineStart, lineEnd: extendFrom(value, lineStart) }
  const result = ETSCompletion.buildReplacement(value, range, section)

  assert.equal(result.value, `1girl,\n${section}\nblush,`)
  assert.equal(result.value.includes('wide-eyed'), false)
})
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `node --test tests/ets_completion.test.mjs`
Expected: FAIL（`ETSCompletion.extendToTagLine is not a function`）

- [ ] **Step 3: 最小の実装**

`javascript/ets_completion.js` の `buildReplacement()` の直後（`constructor` の前）に追加する。

```javascript
  // コメント行 [lineStart, lineEnd) から、それに続くタグ行の終端まで置換範囲を広げる。
  // セクションは「コメント行 + タグ行」の 2 行構成（ETSPromptEditor.splitSections() と
  // 同じモデル）なので、確定時に片方だけを置き換えると古いタグが取り残される。
  // 広げないのは次の 2 ケース:
  //   - 次行が空行: 区切り行とタグが空のセクションを区別できないため安全側に倒す
  //   - 直前がコメント行: 既存セクションの間に挿入された行なので、次行は前のセクションのタグ
  static extendToTagLine(value, lineStart, lineEnd) {
    if (lineEnd >= value.length) {
      return lineEnd
    }

    const prevStart = value.lastIndexOf('\n', lineStart - 2) + 1
    if (lineStart > 0 && value.slice(prevStart, lineStart - 1).startsWith('#')) {
      return lineEnd
    }

    const nextStart = lineEnd + 1
    let nextEnd = value.indexOf('\n', nextStart)
    if (nextEnd === -1) {
      nextEnd = value.length
    }

    const nextLine = value.slice(nextStart, nextEnd)
    if (nextLine.trim() === '' || nextLine.startsWith('#')) {
      return lineEnd
    }

    return nextEnd
  }
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `node --test tests/ets_completion.test.mjs`
Expected: PASS

- [ ] **Step 5: `confirm()` を更新する**

`javascript/ets_completion.js` の `confirm()` 内、置き換え前:

```javascript
    const section = new ETSSection(entry.comment, entry.tag, entry.category).toString()
    const replacement = ETSCompletion.buildReplacement(textarea.value, range, section)

    this.close()
```

置き換え後:

```javascript
    const section = new ETSSection(entry.comment, entry.tag, entry.category).toString()
    // 入力済みセクションの打ち直しでは、コメント行に続く古いタグ行ごと差し替える
    const sectionRange = {
      lineStart: range.lineStart,
      lineEnd: ETSCompletion.extendToTagLine(textarea.value, range.lineStart, range.lineEnd),
    }
    const replacement = ETSCompletion.buildReplacement(textarea.value, sectionRange, section)

    this.close()

    // 変更前の状態も履歴へ積む。textarea.value の直代入でブラウザ標準の Undo が
    // 失われるため、これが無いと確定で消えたタグ行を戻す手段が無くなる
    this.history.saveTextHistory()
```

（末尾の `this.history.saveTextHistory()` は変更後の状態を積むためそのまま残す）

- [ ] **Step 6: テスト全体を実行**

Run: `node --test`
Expected: PASS

- [ ] **Step 7: コミット**

```bash
git add javascript/ets_completion.js tests/ets_completion.test.mjs
git commit -m "fix(completion): 確定時にコメント行に続くタグ行も置き換える"
```

---

### Task 3: CLAUDE.md の記述を更新する

**Files:**
- Modify: `CLAUDE.md`（プロンプト補完に関する箇条書き）

**Interfaces:**
- Consumes: Task 1 / Task 2 の変更後の挙動
- Produces: なし

- [ ] **Step 1: 陳腐化した落とし穴を削除する**

以下の行を削除する（Task 1 で解消したため）。

```markdown
- 落とし穴: 補完のラベル検索は行に `(` が入った時点で止まるため、`マリー(体操服)` のようにカッコを含むラベルは `マリー` までしか打てない。前方部分で絞って候補から選ぶ
```

- [ ] **Step 2: 現在の挙動と新しい落とし穴を追記する**

削除した位置に以下を追加する。

```markdown
- 補完のトリガ判定は行に `,` が現れた時点で止まる。確定済みのコメント行が必ず `,` で終わること（`ETSSection.toString()` の `header += ','`）を利用した区別なので、ヘッダー形式を変えるときは `ETSCompletion.STOP_CHARS` も見直すこと
- 補完の検索は NFKC + 小文字で正規化して比較する。ラベル側は半角カッコで書かれているが、IME 日本語入力では `(` が全角 `（` になるため。エントリ側の正規化は `ETSCompletionIndex` の構築時に前計算する（キー入力ごとに全件走るため）
- 落とし穴: 半角 `(` を打つと tagcomplete 側の語切り出し（`NORMAL_TAG_REGEX` はカッコを区切り扱い）が `#` を落とすため、tagcomplete のポップアップも同時に出ることがある。キー操作は当拡張が捕捉フェーズで奪うので動作はするが、表示は重なる。IME の全角 `（` なら語が切れないので tagcomplete は反応しない
- 確定時はコメント行に続くタグ行まで置き換える。入力済みセクションを打ち直したときに古いタグが残らないようにするため。ただし「次行が空行」「直前がコメント行（＝セクション間に挿入された行で、次行は前のセクションのタグ）」の場合は広げない。副作用として、タグを持たないセクションの直後のセクションを打ち直すと古いタグ行が残る
- 確定処理は変更前と変更後の両方を Undo 履歴に積む。`textarea.value` の直代入でブラウザ標準の Undo が失われるため
```

- [ ] **Step 3: コミット**

```bash
git add CLAUDE.md
git commit -m "docs: プロンプト補完の挙動変更を CLAUDE.md に反映"
```

---

## 実機確認（WebUI 上、UI リロード後）

1. IME 日本語入力のまま `#マリー（体操服` と打ち、候補が出続けることを確認する（全角カッコ経路）。
2. 半角 `(` で `#マリー(体操服` と打った場合も候補が出ること、および tagcomplete のポップアップが重なるかどうかを確認する（重なっても ↑↓ / Enter が当拡張側で効くこと）。
3. 既存セクションのコメント行を `#` の直後まで消して打ち直し、確定後に古いタグ行が残っていないことを確認する。
4. 既存コメント行の行末で改行して新しい `#` 行を作り確定 → 次のタグ行が消えないことを確認する。
5. 確定直後に拡張の Undo ボタンで、確定前の状態（打ちかけの `#...` 行）に戻ることを確認する。
6. ネガティブプロンプト欄でも 1・3 が同じに動くことを確認する。
7. 末尾の新規行での確定が従来どおり動くことを確認する。

## 実装後の追補（要望 1 の取りこぼし）

Task 1〜3 の実装後も実機で「括弧以降が反応しない」が再現した。原因は計画の前提の取り違えで、要望 1 は **ラベル内カッコ**（`マリー(体操服)`）の話ではなく、**入力済みのコメント行を打ち直す**ケースだった。ユーザーが実際に打つのは `# 50_背景:オリジナル (ピンクのカジノ` という確定後のヘッダー形式そのもので、トリガ（`STOP_CHARS`）は通っていたが、検索対象が `comment` / `tag` / `category` の個別フィールドしか無く 1 件も一致しなかった。

追加対応（コミット `bebc128`）:

- `ETSCompletionIndex.headerOf(entry)` を追加し、確定後のコメント行と同じ `カテゴリ (ラベル)` 形式を作る（ランダムエントリのラベルは `ETSSection.toString()` に合わせて `ランダム`）
- 構築時に `normalized.header` として前計算する。比較時は空白を除去（`ETSCompletionIndex.compact()`）し、`カテゴリ(ラベル` のように空白を省いて打たれた場合も拾う
- `rankOf()` にヘッダー前方一致（rank 1）／部分一致（rank 3）を追加。ラベル前方一致が最上位である点は変えない

教訓: 入力系の改修は、要望の言葉ではなく **ユーザーが実際に打つ文字列** を確認してから設計する。実タグ YAML を全読みして `search()` を叩く使い捨てスクリプトが切り分けに有効だった。

## レビュー却下メモ

- 「97_Color / 98_特殊 の確定挙動を仕様化しテスト追加」 — `extendToTagLine()` は挿入する文字列の中身に依存しない（範囲計算のみ）ため、追加テストの価値が無い。既存セクションの打ち直しでコメント行＋タグ行がタグのみの行に置き換わるのは仕様どおり。
- 「タグが空文字のエントリで `toString()` が `''` を返す件」 — 本改修の変更点ではない既存挙動。タグ YAML に空値のエントリは無く、対処は YAGNI。
- 「ネガティブ欄での確定のテスト追加」 — `confirm()` は DOM 依存で `node --test` の対象外。実機確認 6 でカバーする。
- 「IME 変換中の `(` を含む input の絞り込みテスト」 — `composing` フラグはキー操作の素通しにのみ使い、`refresh()` は変換中でも従来どおり走る（本改修で変更しない）。実機確認 1 に含める。
