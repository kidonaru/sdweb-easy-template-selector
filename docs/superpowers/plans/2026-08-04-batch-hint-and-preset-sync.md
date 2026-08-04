# 一括生成モードの説明表示 / UI Preset へのプロファイル追従 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一括生成モードを ON にしたときに操作説明を表示し、Forge Neo の UI Preset 変更に拡張のプロファイルを追従させる。

**Architecture:** 説明行は `99_設定` の再生成（`render()`）に乗せるだけで、追加の状態も配線も持たない。Preset 追従は新規クラス `ETSPresetSync` に「UI Preset を読む・変化を通知する」責務だけを閉じ込め、プロファイル切替は既存の `setProfile()` / `reload()` に委譲する。対応規則は純粋関数 `ETSPresetSync.resolveProfile()` に切り出して単体テストする。

**Tech Stack:** 素の JavaScript（クラス、ビルドなし）、`node --test` の単体テスト、`style.css`。設計は `docs/superpowers/specs/2026-08-04-batch-hint-and-preset-sync-design.md`。

## Global Constraints

- コードのコメントとエラーログメッセージは日本語で書く。
- `javascript/` 配下のファイルはトップレベルで他ファイルのクラスを参照しない（WebUI がアルファベット順に読み込むため、参照は `onUiLoaded` 以降の実行時に限る）。
- `javascript/js-yaml.min.js` は編集しない。
- 対応規則は「同名優先＋既定フォールバック」。既定プロファイルは `illustrious`（`EasyTemplateSelector.DEFAULT_PROFILE`）。
- 同期は一方向（Forge Neo → 拡張）のみ。拡張から Neo の UI Preset は変更しない。
- 一括生成の実行中（`this.batchRunner.running`）は追従しない。
- Forge Neo 以外（reForge / A1111）では `#forge_ui_preset` が存在しないため、機能全体を無効化する。
- JS の変更は WebUI の UI リロードで反映される（Python 側の変更は無いので再起動は不要）。

---

### Task 1: 一括生成モードの説明行

**Files:**
- Modify: `javascript/ets_element_builder.js`（`hintText()` を追加）
- Modify: `javascript/easy_template_selector.js:406-455`（`renderTemplateSettings()`）
- Modify: `style.css`（`.easy_template_hint` を追加）

**Interfaces:**
- Consumes: なし
- Produces: `ETSElementBuilder.hintText(lines: string[]) => HTMLDivElement`（1 行 1 要素の `<div>` を持つラッパーを返す）

- [ ] **Step 1: `ETSElementBuilder.hintText()` を追加**

`javascript/ets_element_builder.js` の `checkbox()`（`static checkbox(text, checked, { onChange })`）の直後に追加する。

```js
  // 説明・補足の小さめテキスト。見た目は style.css の .easy_template_hint に持たせる
  static hintText(lines) {
    const container = document.createElement('div')
    container.classList.add('easy_template_hint')

    lines.forEach((line) => {
      const row = document.createElement('div')
      row.textContent = line
      container.appendChild(row)
    })

    return container
  }
```

- [ ] **Step 2: `style.css` にスタイルを追加**

`style.css` の末尾に追加する。

```css
.easy_template_hint {
  margin: 2px 0 2px 4px;
  font-size: 0.85em;
  line-height: 1.4;
  opacity: 0.75;
  color: var(--body-text-color, #e5e7eb);
}
```

- [ ] **Step 3: 一括生成モードが ON のときだけ説明を出す**

`javascript/easy_template_selector.js` の `renderTemplateSettings()` で、`buttons` を `fields` に append している行（`fields.append(buttons)`）の直後に追加する。

```js
    // 一括生成モードは操作が変わる（ボタンが選択トグルになる）ので、ON の間だけ手順を出す
    if (this.batchMode) {
      fields.append(ETSElementBuilder.hintText([
        'テンプレと差し替えタグを選んで ▶一括生成。',
        '左クリック=選択 / 右クリック=グループ全選択。',
        '選んだテンプレ×抽選タグを順に生成します。',
      ]))
    }
```

チェックボックスの `onChange` は既に `this.render()` を呼ぶため、表示・非表示のための追加配線は不要。

- [ ] **Step 4: WebUI で動作確認**

1. WebUI の UI をリロードする
2. `00_テンプレート` タブの `99_設定` で「一括生成モード」を ON にする → チェックボックスの下に説明 3 行が出ること
3. OFF にする → 説明が消え、縦幅を取らないこと

- [ ] **Step 5: コミット**

```bash
git add javascript/ets_element_builder.js javascript/easy_template_selector.js style.css
git commit -m "feat: 一括生成モードの ON 中に操作説明を表示する"
```

---

### Task 2: `ETSPresetSync`（Preset の読み取りと変化検知）

**Files:**
- Create: `javascript/ets_preset_sync.js`
- Test: `tests/ets_preset_sync.test.mjs`

**Interfaces:**
- Consumes: なし（`gradioApp()` は WebUI 本体のグローバル関数）
- Produces:
  - `ETSPresetSync.resolveProfile(preset: string|null, profiles: string[], defaultProfile: string) => string|null`
  - `new ETSPresetSync({ getProfiles: () => string[], getDefaultProfile: () => string, onApply: (profile: string) => void })`
  - `instance.currentProfile() => string|null`（UI Preset から解決したプロファイル。Neo 以外では `null`）
  - `instance.start() => void`（監視開始。2 回目以降の呼び出しは無視する）

**設計上の決定（レビュー反映）:**

- `ETSPresetSync` は「前回値」を持たない。`check()` は解決結果を**毎回** `onApply` に渡し、現在のプロファイルと同じかどうかの判定は呼び出し側が行う。前回値を持つと、一括生成の実行中に切り替わった Preset を「通知済み」として記録してしまい、**実行終了後に永久に追いつかなくなる**（差分が二度と出ない）ため。
- 入力要素は毎回引き直す。`start()` の時点で `#forge_ui_preset` が未マウントでも、後から現れれば拾える。

- [ ] **Step 1: 失敗するテストを書く**

`tests/ets_preset_sync.test.mjs` を新規作成する。

```js
// ETSPresetSync の DOM 非依存部分（UI Preset → プロファイルの対応規則）の単体テスト
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../javascript/ets_preset_sync.js', import.meta.url), 'utf8')
const { ETSPresetSync } = new Function(`${src}\nreturn { ETSPresetSync }`)()

const PROFILES = ['illustrious', 'anima']

test('Preset と同名のプロファイルがあればそれを選ぶ', () => {
  assert.equal(ETSPresetSync.resolveProfile('anima', PROFILES, 'illustrious'), 'anima')
})

test('同名のプロファイルが無い Preset は既定へ戻す', () => {
  assert.equal(ETSPresetSync.resolveProfile('xl', PROFILES, 'illustrious'), 'illustrious')
  assert.equal(ETSPresetSync.resolveProfile('flux', PROFILES, 'illustrious'), 'illustrious')
})

test('Preset が取れないときは null（＝何もしない）', () => {
  assert.equal(ETSPresetSync.resolveProfile(null, PROFILES, 'illustrious'), null)
  assert.equal(ETSPresetSync.resolveProfile('', PROFILES, 'illustrious'), null)
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/ets_preset_sync.test.mjs`
Expected: FAIL（`javascript/ets_preset_sync.js` が存在せず ENOENT）

- [ ] **Step 3: `ETSPresetSync` を実装**

`javascript/ets_preset_sync.js` を新規作成する。

```js
// Forge Neo の UI Preset（#forge_ui_preset）を読み、対応するプロファイル名を通知する。
// プロファイルの切り替えそのものは呼び出し側（EasyTemplateSelector）の責務。
class ETSPresetSync {
  // Forge Neo の UI Preset ドロップダウンの elem_id（modules_forge/main_entry.py）
  static ELEMENT_ID = 'forge_ui_preset'

  // change イベントを取りこぼしたときの保険。実機で確認して不要なら消す
  static POLL_INTERVAL = 1000

  // UI Preset 名からプロファイル名を決める。同名があればそれ、無ければ既定。
  // preset が取れない（Forge Neo でない）ときは null を返して呼び出し側に何もさせない
  static resolveProfile(preset, profiles, defaultProfile) {
    if (!preset) {
      return null
    }
    return profiles.includes(preset) ? preset : defaultProfile
  }

  constructor({ getProfiles, getDefaultProfile, onApply }) {
    this.getProfiles = getProfiles
    this.getDefaultProfile = getDefaultProfile
    this.onApply = onApply
    this.started = false
    this.listening = false
  }

  // UI Preset ドロップダウンの入力要素。reForge / A1111 には存在しないので null になりうる。
  // 起動時にまだ無くても後から現れれば拾えるよう、呼ぶたびに引き直す
  static findInput() {
    return gradioApp().getElementById(ETSPresetSync.ELEMENT_ID)?.querySelector('input') || null
  }

  currentPreset() {
    const value = ETSPresetSync.findInput()?.value
    return value ? value.trim() : null
  }

  currentProfile() {
    return ETSPresetSync.resolveProfile(
      this.currentPreset(), this.getProfiles(), this.getDefaultProfile())
  }

  // 監視を開始する。onUiLoaded から 1 回だけ呼ぶ（多重登録の保険として started を見る）
  start() {
    if (this.started) {
      return
    }
    this.started = true
    this.attachListener()
    this.timer = setInterval(() => {
      // 入力要素が遅れて現れる場合に備え、ポーリングのたびに登録を試みる
      this.attachListener()
      this.check()
    }, ETSPresetSync.POLL_INTERVAL)
  }

  attachListener() {
    if (this.listening) {
      return
    }
    const input = ETSPresetSync.findInput()
    if (!input) {
      return
    }
    this.listening = true
    input.addEventListener('change', () => this.check())
  }

  // 解決結果を毎回渡す。前回値を持たないのは、一括生成中に無視した変更へ
  // 実行終了後に追いつけるようにするため（差分で判定すると二度と通知されない）
  check() {
    const profile = this.currentProfile()
    if (profile) {
      this.onApply(profile)
    }
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/ets_preset_sync.test.mjs`
Expected: PASS（3 件）

- [ ] **Step 5: 既存テストが壊れていないことを確認**

Run: `node --test`
Expected: 全 PASS

- [ ] **Step 6: コミット**

```bash
git add javascript/ets_preset_sync.js tests/ets_preset_sync.test.mjs
git commit -m "feat: Forge Neo の UI Preset を読んでプロファイル名へ解決するクラスを追加"
```

---

### Task 3: `EasyTemplateSelector` への結線

**Files:**
- Modify: `javascript/easy_template_selector.js`（`constructor()` / `init()` / `setProfile()` / `onUiLoaded`）

**Interfaces:**
- Consumes: Task 2 の `ETSPresetSync`（`resolveProfile` / `currentProfile()` / `start()`）
- Produces: `this.presetSync`、`this.presetApplied`（`EasyTemplateSelector` のインスタンスプロパティ）

**設計上の決定（レビュー反映）:** `init()` は `reload()` からも呼ばれる（リフレッシュボタン、テンプレ保存後の `reinit()`、**ヘッダーのプロファイル `<select>` の `onChange` 自身**）。ここで無条件に UI Preset を優先すると、`xl` のまま手動で `anima` を選んだ瞬間に `illustrious` へ巻き戻り、手動切替が機能しなくなる。そのため起動時の優先は **最初の `init()` の 1 回だけ**に限定する。

- [ ] **Step 1: `constructor()` で `ETSPresetSync` を生成する**

`javascript/easy_template_selector.js` の `constructor()` 末尾、`this.batchRunner = new ETSBatchRunner({ ... })` の直後に追加する。

```js
    // 起動時の Preset 優先は最初の init() の 1 回だけ。reload() 経由の init() でも
    // 効かせると、手動でプロファイルを選んだ直後に Preset へ巻き戻ってしまう
    this.presetApplied = false

    // Forge Neo の UI Preset に追従する。Preset が「正」で、拡張から Neo へは反映しない
    this.presetSync = new ETSPresetSync({
      getProfiles: () => this.profiles,
      getDefaultProfile: () => EasyTemplateSelector.DEFAULT_PROFILE,
      // ETSPresetSync は同値でも毎回呼ぶ。ここで現在値と比べて差分だけ処理する
      onApply: async (profile) => {
        // 実行中の切り替えは選択状態と生成を壊すので無視する。既存の guardBatchRunning() を
        // 使わないのは、あちらが同期ハンドラ用で await できないため（判定内容は同じ）
        if (this.batchRunner.running) {
          return
        }
        if (profile === this.profile) {
          return
        }
        this.setProfile(profile)
        await this.reload()
      },
    })
```

- [ ] **Step 2: 最初の起動時だけ UI Preset を優先する**

`init()` の中、localStorage の値を検証している次のブロックの直後に追加する。

```js
    // localStorage の値がもう存在しないプロファイルなら既定へ戻す
    if (!this.profiles.includes(this.profile)) {
      this.setProfile(EasyTemplateSelector.DEFAULT_PROFILE)
    }
```

追加する内容:

```js
    // UI Preset が読める環境（Forge Neo）では、初回だけ localStorage の前回値より Preset を
    // 優先する。fetchTags() の前に決めることで、追従のための二重取得を避ける。
    // 2 回目以降（reload() 経由）で効かせると手動のプロファイル切替を打ち消してしまう
    if (!this.presetApplied) {
      this.presetApplied = true
      const presetProfile = this.presetSync.currentProfile()
      if (presetProfile && presetProfile !== this.profile) {
        this.setProfile(presetProfile)
      }
    }
```

- [ ] **Step 3: `setProfile()` でヘッダーの `<select>` も更新する**

ヘッダーは `render()` の初回しか構築されないため、追従で値を変えても表示が古いままになる。`setProfile()` の `this.profile = value` の直後に追加する。

```js
    // ヘッダーは初回しか構築されないので、外部（UI Preset 追従）からの変更を表示へ反映する
    const select = gradioApp().getElementById(EasyTemplateSelector.IDS.PROFILE_SELECT)
    if (select) {
      select.value = value
    }
```

- [ ] **Step 4: 監視を開始する**

`onUiLoaded` の末尾、`easyPromptSelector.syncTemplateNameBridge()` の直後に追加する。

```js
  // UI Preset の監視。init() は reload() からも呼ばれるためここで 1 回だけ開始する
  easyPromptSelector.presetSync.start()
```

- [ ] **Step 5: 既存テストが壊れていないことを確認**

`tests/easy_template_selector.test.mjs` は `easy_template_selector.js` をそのまま評価するため、構文エラーやトップレベルでの他クラス参照があると落ちる。

Run: `node --test`
Expected: 全 PASS

- [ ] **Step 6: コミット**

```bash
git add javascript/easy_template_selector.js
git commit -m "feat: UI Preset の変更にプロファイルを追従させる"
```

---

### Task 4: 実機確認と変化検知方式の確定

**Files:**
- Modify: `javascript/ets_preset_sync.js`（確認結果に応じて `change` リスナかポーリングの一方を削る）
- Modify: `CLAUDE.md`（挙動と落とし穴を追記）

**Interfaces:**
- Consumes: Task 2 / Task 3 の実装
- Produces: なし

- [ ] **Step 1: Forge Neo で追従を確認**

1. WebUI の UI をリロードする
2. UI Preset を `xl` → `anima` に変更 → 拡張ヘッダーのプロファイルが `anima` になり、タグ・テンプレ一覧が anima のものに入れ替わること
3. `anima` → `xl` に戻す → プロファイルが `illustrious` に戻ること
4. UI Preset を `flux` にする → プロファイルが `illustrious`（既定）になること
5. `anima` のままページを再読み込み → プロファイルが `anima` で始まること
6. `xl` のまま手動でプロファイルを `anima` にして再読み込み → `illustrious` に戻ること（仕様どおり）

- [ ] **Step 2: 手動切替が壊れていないことを確認（レビュー指摘の回帰確認）**

`init()` は `reload()` からも呼ばれるため、Preset 優先が 2 回目以降にも効くと手動切替を打ち消す。次を確認する。

1. UI Preset を `xl`（＝同名プロファイル無し）にする
2. 拡張ヘッダーのプロファイル `<select>` で `anima` を選ぶ → **`anima` のままになり、`illustrious` へ巻き戻らないこと**
3. その状態でヘッダーのリフレッシュボタンを押す → `anima` のままであること
4. その状態でテンプレートを保存する（`reinit()` が走る）→ `anima` のままであること

- [ ] **Step 3: 変化検知と Preset 値の実測**

ブラウザの DevTools コンソールで、UI Preset の input の値と `change` イベントを確認する。

```js
const input = gradioApp().getElementById('forge_ui_preset').querySelector('input')
console.log('[ETS] 現在値:', JSON.stringify(input.value))
input.addEventListener('change', (e) => console.log('[ETS] change:', JSON.stringify(e.target.value)))
```

確認して分岐する:

- **値の表記**: `"anima"` / `"xl"` のように `PresetArch` の小文字キーそのままなら `resolveProfile()` の完全一致でよい。大文字・空白・別表記だった場合は、`currentPreset()` で小文字化して正規化し、その旨をコメントに残す（対応表は作らない）。
- **`change` イベント**: 確実に飛ぶなら `start()` の `setInterval` と `POLL_INTERVAL` を削る。飛ばないなら `change` リスナと `attachListener()` を削ってポーリングのみにする。両方残す判断も可。

どちらに倒したかと理由を、その場でコード上のコメントに残す。**推測で決めない。**

なお `setInterval` を削る場合は、一括生成中に無視した Preset 変更へ実行終了後に追いつけなくなる（`change` は既に消費済みのため）。その場合は Step 6 の `CLAUDE.md` に落とし穴として明記する。

- [ ] **Step 4: 一括生成中の無視と、その後の追いつきを確認**

1. 一括生成モードを ON にし、テンプレと差し替えタグを選んで ▶一括生成を開始する
2. 実行中に UI Preset を `anima` へ変更する → 生成が続き、プロファイル・タグ一覧が切り替わらないこと
3. 生成が終わる（または停止する）まで待つ。**UI Preset はそのまま触らない**
4. ポーリングを残した場合: 数秒でプロファイルが `anima` に追いつくこと
   ポーリングを削った場合: 追いつかないこと（＝ Step 3 で明記した落とし穴どおりの挙動であること）

- [ ] **Step 5: reForge / Forge Neo 以外での無害性を確認**

`#forge_ui_preset` が無い環境では `currentProfile()` が `null` を返し、`check()` が何もせず localStorage の値がそのまま使われる。手元に reForge が無い場合は、DevTools で以下を実行して同じ経路（要素が見つからない）を確認する。

```js
// 要素が見つからない状況を再現する
console.log(gradioApp().getElementById('forge_ui_preset_missing')?.querySelector('input') || null)
```

- [ ] **Step 6: `CLAUDE.md` に挙動を追記**

「Coding Conventions」の末尾（テンプレート名 `[template_name]` の項の後）に追記する。

```markdown
- 拡張のプロファイルは Forge Neo の UI Preset（`#forge_ui_preset`）に追従する（`javascript/ets_preset_sync.js`）。Preset 名と同名のプロファイルがあればそれ、無ければ既定の `illustrious`。同期は一方向で、拡張から Neo の Preset は変えない
- 落とし穴: Preset が「正」なので、`xl` のまま手動でプロファイルを `anima` にしてもページ再読み込みで `illustrious` に戻る。localStorage の値は UI Preset が読めない環境（reForge / A1111）でのみ効く
- 一括生成の実行中は Preset 追従を無視する（`reload()` がプロンプト欄と選択状態を壊すため）
- 起動時の Preset 優先は `presetApplied` で最初の `init()` の 1 回だけに限定する。`init()` は `reload()` からも呼ばれる（リフレッシュ・テンプレ保存・**プロファイル `<select>` の `onChange` 自身**）ため、毎回効かせるとヘッダーで手動選択したプロファイルが即座に Preset へ巻き戻る
- `ETSPresetSync` は前回値を持たず、解決結果を毎回通知する。差分で判定すると、一括生成中に無視した変更へ実行終了後に追いつけなくなるため
```

- [ ] **Step 7: コミット**

```bash
git add javascript/ets_preset_sync.js CLAUDE.md
git commit -m "docs: UI Preset 追従の挙動と検知方式を確定して記録する"
```

---

## レビュー却下メモ

（今回は `plan-reviewer` の指摘 5 件をすべて取り込んだため、却下項目なし）
