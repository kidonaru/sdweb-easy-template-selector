# テンプレへの RNG 記録と設定由来メタの opts 経由取得 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** テンプレートに `RNG` を記録して Forge Neo で `RNG: CPU` の Override Settings が勝手に付くのを止め、あわせて `Clip skip` / `RNG` の保存時の値取得を Settings タブの DOM スクレイピングから `shared.opts` を返す拡張 API 経由に置き換える。

**Architecture:** 拡張の Python 側に「infotext 名 → `shared.opts` の現在値」を返す GET エンドポイントを 1 本追加する（`shared.opts.data_labels` の `info.infotext` を走査するので、対象設定をハードコードしない）。JS 側は `metaInfoMap` のエントリに `readFrom: 'opts'` フラグを持たせ、保存時 (`getCurrentMetaDataMap`) はそのエントリだけ API 値を優先し、取得できなければ従来の DOM 読み取りにフォールバックする。適用時 (`applyMeta`) の挙動は現状維持（`Clip skip` は Settings スライダーへ書き込み、`RNG` は本体の貼り付け経路に任せる）。既存テンプレ 37 件へは一括で `RNG: GPU` を追記する。

**Tech Stack:** Python 3 / FastAPI（WebUI の `script_callbacks.on_app_started` 経由）、Vanilla JS（WebUI の `gradioApp()` DOM）、テンプレ書き換えは Python ワンショットスクリプト

## Global Constraints

- コードのコメントとエラーログメッセージは日本語で書く。
- ハードコーディングは絶対に必要な場合を除き避ける。特に「どの設定が infotext に出るか」は `shared.opts.data_labels` から導出し、拡張側に設定名の表を作らない。
- `javascript/js-yaml.min.js` は vendored のため触らない。
- `javascript/` 配下はトップレベルで他ファイルのクラスを参照しない（読み込み順がアルファベット順のため、参照は `onUiLoaded` 以降）。
- `templates/*.txt` は全ファイル CRLF。テンプレを書き換えるスクリプトは必ず `newline=''` で読み書きする（`core.autocrlf=true` のため改行差分は `git diff` に出ず検証をすり抜ける）。
- **`tools/audit_templates.py` の成功条件は「0 件」ではなく「着手前のベースラインから増えていないこと」。** 2026-07-25 時点のベースラインは `合計: 1 件`（`templates/02_NSFW/机上で着崩れた制服と精液.txt:70` の `70_スタイルLoRA_Artist_` 由来で、本変更とは無関係）。この 1 件を直そうとしないこと。CLAUDE.md の「現状のクリーンな状態は `合計: 0 件`」という記述は実態と乖離しており、Task 5 で是正する。
- Python 側の変更は WebUI 再起動が必要。JS / YAML / テンプレの変更は UI リロードで反映される。
- ビルド・テスト基盤は無い。検証は WebUI 上の手動確認 + `tools/audit_templates.py` + 使い捨て Python スクリプトで行う。

## 背景（実装者向け・必読）

なぜこの変更が必要かを本体コードの事実として押さえてから着手する。

1. テンプレ適用は拡張独自の処理ではなく、本体の pnginfo 貼り付け経路そのものである。`scripts/easy_prompt_selector.py:115-120` で `parameters_copypaste.ParamBinding` を作り `register_paste_params_button` に登録し、`javascript/ets_template_manager.js:109-121` が隠しテキストボックスにテンプレ全文を入れて隠しボタンをクリックしている。
2. Forge Neo の `modules/infotext_utils.py` の `_populate_defaults()` は、infotext に `RNG` フィールドが無いと `res["RNG"] = "CPU"` を補完する（`:325-326`）。
3. 同ファイルの `get_override_settings()` は補完後の値と現在の設定を比べ、違えば Override Settings に積む（`:499-528`、`if v != current_value`）。
4. Forge Neo の `randn_source` デフォルトは `CPU`（`modules/shared_options.py:228`）だが、この環境の `config.json` は `"randn_source": "GPU"`。よって「補完 CPU ≠ 現在 GPU」で毎回 `RNG: CPU` の override が生える。これが今回の不具合の根本原因。
5. reForge は補完値もデフォルトも `GPU`（`modules/infotext_utils.py:352` / `modules/shared_options.py:209`）なので現状は override が出ない。テンプレに `RNG: GPU` と明示しても現在値と一致するので無害。
6. `Clip skip` の扱いは両者で異なる。Forge Neo の `parse_generation_parameters()` は `res` から `Clip skip` / `CLIP_stop_at_last_layers` を明示的に破棄する（`modules/infotext_utils.py:421-422`）ため、infotext 経由では一切反映されない。reForge は破棄せず override settings に載せる（無指定時は `"1"` を補完する `:310-311` があるため、テンプレに書いておく方が安全）。
   → **したがって適用側は Neo のために Settings スライダー直書きを維持する必要がある。** 本タスクで opts 経由に寄せるのは「保存時の値取得」だけ。

## File Structure

| ファイル | 役割 | 変更種別 |
|---|---|---|
| `scripts/setup.py` | 拡張の FastAPI ルート群。ここに `GET /easy-template/opts-infotext` を追加する | 変更 |
| `javascript/ets_template_manager.js` | `metaInfoMap` の定義と保存／適用処理。`RNG` エントリ追加、`readFrom: 'opts'` 対応、`getCurrentMetaDataMap` の async 化 | 変更 |
| `tools/backfill_template_rng.py` | テンプレのパラメータ行に `RNG` を追記するスクリプト。`randn_source` を変えたときの焼き直しにも使うためリポジトリへ残す | 新規 |
| `templates/**/*.txt` | パラメータ行に `RNG: GPU` が入る | 変更（スクリプト生成） |
| `CLAUDE.md` | Tools 節に `backfill_template_rng.py` を追記し、audit のベースライン記述を是正する | 変更 |

`saveTemplate()` 以外に `getCurrentMetaDataMap()` の呼び出し元は無い（`javascript/ets_template_manager.js:256` のみ）。async 化の影響範囲はこの 1 箇所に閉じる。

---

### Task 0: 着手前のベースラインを記録する

**Files:**
- Modify: なし（記録のみ）

**Interfaces:**
- Produces: 後続タスクの検証で使う audit 件数のベースライン

- [ ] **Step 1: audit のベースライン件数を取る**

Run:

```bash
PYTHONIOENCODING=utf-8 python tools/audit_templates.py | tail -3
```

期待: `合計: N 件` が出る。2026-07-25 時点では `N = 1`。**この N をメモしておく**（Task 3 Step 6 で比較する）。0 件でなくても異常ではない。

- [ ] **Step 2: 作業ツリーがクリーンであることを確認する**

Run:

```bash
git status --porcelain
```

期待: 出力が空、または本計画ファイル（`docs/superpowers/plans/2026-07-25-template-rng-and-opts-based-meta.md`）だけ。他に未コミットの変更があるなら、Task 3 の `git diff -- templates` による検証が汚れるので先に片付ける。

---

### Task 1: opts の infotext 値を返す API を追加する

**Files:**
- Modify: `scripts/setup.py`（`api_networks()` 内、`@app.get("/easy-template/tags")` ブロックの直後・`:85` と `:87` の間に挿入）
- Test: なし（テスト基盤が無いため、curl による手動検証をステップに含める）

**Interfaces:**
- Produces: `GET /easy-template/opts-infotext` → `{ "<infotext 名>": <現在値>, ... }` の JSON オブジェクト。例 `{"Clip skip": 2, "RNG": "GPU", "Model": "...", ...}`。値は `shared.opts` の生の型（数値・文字列・真偽値）で返す。Task 2 の JS がこれを `String(...)` して使う。例外を投げず、失敗時は `{}` を返す。

- [ ] **Step 1: `shared` の import を追加する**

`scripts/setup.py:7` は現在こうなっている。

```python
from modules import scripts, script_callbacks
```

これを次に置き換える。

```python
from modules import scripts, script_callbacks, shared
```

- [ ] **Step 2: エンドポイントを追加する**

`scripts/setup.py` の `api_networks()` 内、`@app.get("/easy-template/tags")` の関数定義が終わった直後（`raise EasyTemplateError(f"タグの取得に失敗しました: {str(e)}")` の次の空行のあと、`@app.post("/easy-template/save-template")` の前）に以下を挿入する。

`EasyTemplateError` を投げないのは意図的。`error_handler`（`scripts/setup.py:46-47`）は Response ではなくタプルを返す実装で Starlette の規約に合っておらず、投げると 500 相当になる。この API は取得失敗しても致命的ではなく、JS 側は空 dict を許容してフォールバックするため、警告ログ + `{}` で返す方が素直。

```python
    @app.get("/easy-template/opts-infotext")
    async def get_opts_infotext():
        """infotext 名 → 現在の設定値のマップを返す。

        テンプレ保存時に Settings タブの DOM を読む代わりに使う。
        DOM は Settings タブが未描画だと取得できず不安定なため。
        対象は shared.opts.data_labels のうち infotext 名を持つ設定に限る
        （どの設定が infotext に出るかは本体側の定義に従い、拡張側では持たない）。

        注意: Model キーは Forge が管理する生の checkpoint 文字列で、
        JS 側の getCurrentModel() が返す加工済みの名前とは形式が異なる。
        Model をこの API 経由に移す場合は形式変換が必要。

        失敗しても致命的ではないため例外は投げず、空の dict を返す
        （JS 側は空 dict を受けて従来の DOM 読み取りへフォールバックする）。
        """
        try:
            result = {}
            for setting_name, info in shared.opts.data_labels.items():
                if not getattr(info, 'infotext', None):
                    continue
                result[info.infotext] = getattr(shared.opts, setting_name, None)
            return result
        except Exception as e:
            print(f'[easy-template] 設定値の取得に失敗しました: {e}')
            return {}
```

- [ ] **Step 3: WebUI を再起動して手動検証する**

Python 側の変更なので UI リロードでは反映されない。WebUI を再起動したうえで、以下を実行する（ポートが 7860 以外なら読み替える）。

```bash
curl -s http://127.0.0.1:7860/easy-template/opts-infotext | python -c "import json,sys; d=json.load(sys.stdin); print(len(d)); print({k: d[k] for k in ('Clip skip','RNG') if k in d})"
```

期待: 1 行目に 20 以上の件数、2 行目に `{'Clip skip': 2, 'RNG': 'GPU'}` 相当（値は現在の設定次第）。`Clip skip` と `RNG` の両キーが存在することが必須。片方でも欠けたら `shared.opts.data_labels` の走査が誤っているので Step 2 を見直す。

- [ ] **Step 4: コミット**

```bash
git add scripts/setup.py
git commit -m "feat(api): opts の infotext 値を返すエンドポイントを追加"
```

---

### Task 2: 保存時のメタ取得を opts 経由に切り替え、RNG を記録する

**Files:**
- Modify: `javascript/ets_template_manager.js:13-31`（`metaInfoMap` 定義）
- Modify: `javascript/ets_template_manager.js:225-250`（`getCurrentMetaDataMap`）
- Modify: `javascript/ets_template_manager.js:252-256`（`saveTemplate` の呼び出し側）
- Test: なし（WebUI 上での手動確認をステップに含める）

**Interfaces:**
- Consumes: Task 1 の `GET /easy-template/opts-infotext`
- Produces: `async fetchOptsInfotext()` → `Promise<Object>`（失敗時は `{}`）、`async getCurrentMetaDataMap()` → `Promise<Object>`。`metaInfoMap` のエントリに任意プロパティ `readFrom: 'opts'` が追加される。

- [ ] **Step 1: `metaInfoMap` に `RNG` を追加し、`Clip skip` に `readFrom` を付ける**

`javascript/ets_template_manager.js:25` は現在こう。

```javascript
      { key: 'Clip skip', id: 'setting_CLIP_stop_at_last_layers', type: 'input' },
```

これを次の 2 行に置き換える。`RNG` は適用を本体の貼り付け経路に任せるので `id` を持たない（`getMetaElement` は `id` が空なら `null` を返すため、`applyMeta` は何もしない）。

```javascript
      // 適用時は本体が infotext の Clip skip を破棄する (Forge Neo) ため Settings スライダーを直接書き換える。
      // 保存時の値取得だけ opts API 経由にする (Settings タブが未描画だと DOM から読めないため)。
      // id は残す: API が使えないときの DOM フォールバック先として使う
      { key: 'Clip skip', id: 'setting_CLIP_stop_at_last_layers', type: 'input', readFrom: 'opts' },
      // RNG はテンプレに書いておかないと本体が既定値を補完して Override Settings に積む。
      // 適用は本体の貼り付け経路に任せるので id は持たない
      { key: 'RNG', id: '', type: '', readFrom: 'opts' },
```

`RNG` を `Clip skip` の直後に置くのは、`convertToTemplate()` が `Object.entries(metaDataMap)` の順にパラメータ行を組み立てるため。Task 3 の backfill スクリプトも `Clip skip:` の直後へ挿入するので、既存テンプレを再保存しても並び順が変わらず差分ノイズが出ない。

- [ ] **Step 2: `fetchOptsInfotext()` を追加する**

`javascript/ets_template_manager.js` の `getCurrentMetaDataMap()`（`:225`）の直前に以下のメソッドを挿入する。

```javascript
  // 設定由来のメタ値を拡張 API から取得する。Settings タブの DOM 依存を避けるため
  async fetchOptsInfotext() {
    try {
      const response = await fetch('/easy-template/opts-infotext')
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`)
      }
      return await response.json()
    } catch (error) {
      // API が使えないときは呼び出し側が DOM 読み取りへフォールバックする
      console.error('設定値の取得に失敗しました:', error)
      return {}
    }
  }
```

- [ ] **Step 3: `getCurrentMetaDataMap()` を async 化して opts 値を使う**

`javascript/ets_template_manager.js:225-250` の現在の実装は以下。

```javascript
  getCurrentMetaDataMap() {
    let metaDataMap = {}

    for (const metaInfo of this.metaInfoMap) {
      if (metaInfo.key === 'Model') {
        const modelName = this.getCurrentModel()
        metaDataMap[metaInfo.key] = modelName
        continue
      } else if (metaInfo.key === 'Size') {
        const size = this.getCurrentSize()
        metaDataMap[metaInfo.key] = size
        continue
      }

      const element = this.getMetaElement(metaInfo.key)
      if (element) {
        if (metaInfo.type === 'checkbox') {
          metaDataMap[metaInfo.key] = element.checked.toString()
        } else {
          metaDataMap[metaInfo.key] = element.value
        }
      }
    }

    return metaDataMap
  }
```

これを次で置き換える。`readFrom === 'opts'` のエントリは「API 値 → DOM 読み取り → 警告してキー省略」の順にフォールバックする。API だけに頼ると、Python 側の変更が未反映（WebUI 未再起動）のときに `Clip skip` が黙ってテンプレから欠落し、「保存は成功したが中身が欠けたファイル」ができてしまう。

```javascript
  async getCurrentMetaDataMap() {
    let metaDataMap = {}
    const optsInfotext = await this.fetchOptsInfotext()

    for (const metaInfo of this.metaInfoMap) {
      if (metaInfo.key === 'Model') {
        const modelName = this.getCurrentModel()
        metaDataMap[metaInfo.key] = modelName
        continue
      } else if (metaInfo.key === 'Size') {
        const size = this.getCurrentSize()
        metaDataMap[metaInfo.key] = size
        continue
      }

      if (metaInfo.readFrom === 'opts') {
        const value = optsInfotext[metaInfo.key]
        if (value !== undefined && value !== null) {
          metaDataMap[metaInfo.key] = String(value)
          continue
        }
        // API から取れないときは従来どおり Settings の DOM を読む
        const fallback = this.getMetaElement(metaInfo.key)
        if (fallback) {
          console.warn(`設定値を API から取得できないため DOM から読み取ります: ${metaInfo.key}`)
          metaDataMap[metaInfo.key] = fallback.value
        } else {
          console.warn(`設定値が取得できないためテンプレに書き込みません: ${metaInfo.key}`)
        }
        continue
      }

      const element = this.getMetaElement(metaInfo.key)
      if (element) {
        if (metaInfo.type === 'checkbox') {
          metaDataMap[metaInfo.key] = element.checked.toString()
        } else {
          metaDataMap[metaInfo.key] = element.value
        }
      }
    }

    return metaDataMap
  }
```

- [ ] **Step 4: `saveTemplate()` の呼び出しを await にする**

`javascript/ets_template_manager.js:256` は現在こう。

```javascript
    var metaDataMap = this.getCurrentMetaDataMap()
```

これを次に置き換える（`saveTemplate` はすでに `async`）。

```javascript
    var metaDataMap = await this.getCurrentMetaDataMap()
```

- [ ] **Step 5: `getCurrentMetaDataMap` の他の呼び出し元が無いことを確認する**

Run:

```bash
grep -rn "getCurrentMetaDataMap" javascript/ scripts/
```

期待: 定義行（`ets_template_manager.js` 内の `async getCurrentMetaDataMap()`）と Step 4 で直した `await this.getCurrentMetaDataMap()` の 2 行のみ。3 行以上出たら残りの呼び出し元も `await` を付ける。

- [ ] **Step 6: WebUI 上で保存を手動確認する**

1. UI をリロードする（JS のみの変更なので再起動は不要。Task 1 の再起動が済んでいること）
2. 適当なプロンプトを入れ、テンプレート名に `_rng_check` を指定して保存する
3. 生成されたファイルを確認する

```bash
PYTHONIOENCODING=utf-8 python -c "print(open('templates/_rng_check.txt', encoding='utf-8').read().splitlines()[-1])"
```

期待: 末尾のパラメータ行に `Clip skip: 2, RNG: GPU,` が（設定値どおりに）含まれている。ブラウザのコンソールに `設定値の取得に失敗しました` / `DOM から読み取ります` / `テンプレに書き込みません` のいずれも出ていないこと（出ていたら API 経由になっていないので Task 1 の反映を確認する）。

4. 確認できたら検証用テンプレを削除する

```bash
rm templates/_rng_check.txt
```

- [ ] **Step 7: フォールバックが効くことを確認する**

ブラウザのコンソールで API を一時的に壊し、`Clip skip` が DOM から拾われることを確認する。

```javascript
const orig = window.fetch
window.fetch = (url, ...rest) => url === '/easy-template/opts-infotext'
  ? Promise.resolve(new Response('', { status: 500 }))
  : orig(url, ...rest)
```

この状態で Settings タブを一度開いてから（DOM を描画させる）テンプレート名 `_fallback_check` で保存する。

期待: コンソールに `設定値を API から取得できないため DOM から読み取ります: Clip skip` と `設定値が取得できないためテンプレに書き込みません: RNG` が出る。保存されたファイルには `Clip skip` が入り `RNG` は入らない。

```bash
PYTHONIOENCODING=utf-8 python -c "print(open('templates/_fallback_check.txt', encoding='utf-8').read().splitlines()[-1])"
rm templates/_fallback_check.txt
```

確認後、ブラウザをリロードして `window.fetch` の差し替えを解除する。

- [ ] **Step 8: コミット**

```bash
git add javascript/ets_template_manager.js
git commit -m "feat(template): Clip skip/RNG の保存値を opts API から取得し RNG を記録する"
```

---

### Task 3: 既存テンプレ 37 件に `RNG: GPU` を追記する

**Files:**
- Create: `tools/backfill_template_rng.py`
- Modify: `templates/**/*.txt`（37 件、スクリプトによる書き換え）

**Interfaces:**
- Consumes: なし（Task 1・2 とは独立。順序入れ替え可）
- Produces: `python tools/backfill_template_rng.py [--value GPU] [--apply]`。`randn_source` を変えたときの焼き直しにも使う。

**注意:** `templates/*.txt` は全ファイル CRLF で、`core.autocrlf=true` のため改行だけの変化は `git diff` に出ない。`newline=''` で読み書きしないと全ファイルの改行を LF に潰しても気づけない。既存の `tools/_apply_audit_fix.py` が同じ理由で `newline=''` を使っているので、迷ったらそれに倣う。

- [ ] **Step 1: スクリプトを作成する**

Create `tools/backfill_template_rng.py`:

```python
"""テンプレのパラメータ行に RNG を追記する。

Forge Neo は infotext に RNG が無いと既定値 (CPU) を補完し、
現在の設定と食い違うと Override Settings に積む。
テンプレ側に明示しておくことでこれを防ぐ。

randn_source 設定を変えたときは --value を変えて再実行し、テンプレを焼き直す。

改行コードは newline='' で保存する (templates/*.txt は CRLF 管理。
core.autocrlf=true のため LF に潰しても git diff に出ず気づけない)。
"""
import argparse
import re
import sys
from pathlib import Path

TEMPLATE_DIR = Path(__file__).resolve().parent.parent / 'templates'

# パラメータ行の目印。Steps: で始まり Sampler: を含む 1 行がテンプレ末尾にある
PARAM_LINE_PREFIX = 'Steps:'
PARAM_LINE_MARKER = 'Sampler:'

# 保存時 (JS の metaInfoMap) と並び順を揃えるため Clip skip の直後へ挿入する。
# 一致しなければ行末に追記する
CLIP_SKIP_PATTERN = re.compile(r'(Clip skip:\s*[^,]+,)')


def find_param_line_index(lines):
    """パラメータ行の添字を返す。見つからなければ None。

    プロンプト側に Steps: で始まる行が紛れ込む可能性を避けるため末尾から走査し、
    Sampler: を含むことも条件にする
    """
    for i in range(len(lines) - 1, -1, -1):
        line = lines[i]
        if line.startswith(PARAM_LINE_PREFIX) and PARAM_LINE_MARKER in line:
            return i
    return None


def build_new_param_line(line, value):
    """パラメータ行に RNG を追記した行を返す。既にあれば None"""
    if 'RNG:' in line:
        return None

    stripped = line.rstrip()
    entry = f'RNG: {value},'

    if CLIP_SKIP_PATTERN.search(stripped):
        return CLIP_SKIP_PATTERN.sub(rf'\1 {entry}', stripped, count=1)

    if stripped.endswith(','):
        return f'{stripped} {entry}'
    return f'{stripped}, {entry}'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--value', default='GPU', help='書き込む RNG の値 (既定: GPU)')
    parser.add_argument('--apply', action='store_true', help='実際にファイルを書き換える')
    args = parser.parse_args()

    changed = 0
    skipped = 0
    failed = []

    for path in sorted(TEMPLATE_DIR.rglob('*.txt')):
        with open(path, 'r', encoding='utf-8', newline='') as f:
            content = f.read()

        lines = content.split('\n')
        index = find_param_line_index(lines)
        if index is None:
            failed.append(path)
            continue

        # split('\n') では CRLF の \r が行末に残るので、\r を保ったまま加工する
        raw = lines[index]
        suffix = '\r' if raw.endswith('\r') else ''
        new_line = build_new_param_line(raw.rstrip('\r'), args.value)
        if new_line is None:
            skipped += 1
            continue

        lines[index] = new_line + suffix
        if args.apply:
            with open(path, 'w', encoding='utf-8', newline='') as f:
                f.write('\n'.join(lines))
        changed += 1
        print(f'{"書き換え" if args.apply else "対象"}: {path.relative_to(TEMPLATE_DIR)}')

    print(f'\n変更: {changed} 件 / 既に RNG あり: {skipped} 件 / パラメータ行なし: {len(failed)} 件')
    for path in failed:
        print(f'  パラメータ行が見つかりません: {path.relative_to(TEMPLATE_DIR)}')

    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
```

- [ ] **Step 2: dry-run で対象件数を確認する**

Run:

```bash
PYTHONIOENCODING=utf-8 python tools/backfill_template_rng.py
```

期待: 末尾が `変更: 37 件 / 既に RNG あり: 0 件 / パラメータ行なし: 0 件`。`パラメータ行なし` が 1 件以上なら、そのテンプレは `Steps:` + `Sampler:` の行を持たない異常ファイルなので中身を確認してから進める（勝手に書き換えない）。

- [ ] **Step 3: 適用する**

Run:

```bash
PYTHONIOENCODING=utf-8 python tools/backfill_template_rng.py --apply
```

期待: 同じ 37 件が `書き換え:` として出る。

- [ ] **Step 4: 改行コードが CRLF のまま維持されていることを確認する**

`git diff` では改行差分が見えないので、バイト列を直接見る。

```bash
PYTHONIOENCODING=utf-8 python -c "
from pathlib import Path
bad = [str(p) for p in Path('templates').rglob('*.txt') if b'\r\n' not in p.read_bytes()]
print('LF に潰れたファイル:', bad if bad else 'なし')
"
```

期待: `LF に潰れたファイル: なし`。1 件でも出たら `git checkout -- templates` で戻し、Step 1 の `newline=''` 周りを直す。

- [ ] **Step 5: 差分が RNG の追記だけであることを確認する**

Run:

```bash
git diff --stat -- templates | tail -3
git diff -- templates | grep "^[+-]" | grep -v "^[+-][+-]" | grep -vc "RNG: GPU"
```

期待: `--stat` が 37 files changed、各ファイル 1 insertion / 1 deletion。2 つ目のコマンドは `RNG: GPU` を含まない変更行の本数で、**0** であること（`grep -c` が 0 件のとき終了コード 1 で `0` を出力するのは正常）。`--value` に `GPU` 以外を指定した場合は grep パターンをその値に読み替える。

- [ ] **Step 6: 参照整合監査がベースラインから増えていないことを確認する**

Run:

```bash
PYTHONIOENCODING=utf-8 python tools/audit_templates.py | tail -3
```

期待: `合計:` の件数が Task 0 Step 1 で記録した N と同じ。増えていたら差分を確認する。**N を 0 に減らそうとしないこと**（既存の 1 件は本変更と無関係）。

- [ ] **Step 7: コミット**

```bash
git add tools/backfill_template_rng.py
git add -u templates
git commit -m "fix(template): 既存テンプレに RNG: GPU を追記して Override Settings の混入を防ぐ"
```

`git add -u` を使うのは、検証用に作った未追跡テンプレ（`_rng_check.txt` 等）を巻き込まないため。`.gitignore` は `templates/*_` しか除外していない。

---

### Task 4: Neo / reForge 双方で実機確認する

**Files:**
- Modify: なし（確認のみ）

**Interfaces:**
- Consumes: Task 1〜3 のすべて

- [ ] **Step 1: Forge Neo で override が出ないことを確認する**

1. WebUI（Forge Neo）を再起動する
2. txt2img で任意のテンプレートを読み込む
3. txt2img の「Override settings」ドロップダウンを見る

期待: `RNG: CPU` が出ない。`Clip skip` も出ない（Neo は本体が infotext の Clip skip を破棄するため）。他の項目（`Model` など現在値と異なる設定）が出るのは正常。

- [ ] **Step 2: Neo で Clip skip の適用が opts まで届くことを確認する**

この確認は本設計の成立条件そのもの。適用は DOM 書き換え・保存は opts 経由という非対称なので、DOM への書き込みが `shared.opts` にコミットされないと「適用直後に保存すると古い値が焼かれる」劣化が起きる。

1. Settings の Clip Skip を一時的に `1` に変えて Apply する
2. `Clip skip: 2` を含むテンプレートを読み込む
3. 1.5 秒以上待って Settings の Clip Skip の表示を見る → `2` になっていること
4. **opts 側にも届いているか確認する**

```bash
curl -s http://127.0.0.1:7860/easy-template/opts-infotext | python -c "import json,sys; print(json.load(sys.stdin).get('Clip skip'))"
```

期待: `2`。ここが `1` のままなら DOM 書き込みが `shared.opts` にコミットされていないので、Task 2 の方針（保存を opts 経由にする）が成立しない。その場合は実装を止めてユーザーに報告する。

5. テンプレ読込の直後（2 秒以内）にテンプレート名 `_race_check` で保存し、`Clip skip: 2` が焼かれることを確認する

```bash
PYTHONIOENCODING=utf-8 python -c "print(open('templates/_race_check.txt', encoding='utf-8').read().splitlines()[-1])"
rm templates/_race_check.txt
```

期待: `Clip skip: 2` が含まれる。`1` だったら opts への反映が遅延しているので、これも実装を止めて報告する。

6. 確認後、Clip Skip は元の値に戻す

- [ ] **Step 3: reForge で override が出ないことを確認する**

reForge を起動し、同じテンプレートを読み込んで「Override settings」を見る。

期待:
- `RNG: GPU` が出ない（テンプレの値と reForge の `config.json` の `randn_source: GPU` が一致するため）
- `Clip skip` は **reForge 側の現在の Clip Skip 設定と一致していれば出ない**。reForge の `CLIP_stop_at_last_layers` デフォルトは `1`（Neo は `2`）なので、reForge の設定が 1 のままならテンプレの `Clip skip: 2` が override として出るのが正常。これは不具合ではない

- [ ] **Step 4: 保存往復を確認する**

reForge 側でもテンプレート名 `_roundtrip_check` で保存し、パラメータ行に `Clip skip` と `RNG` が入り、かつ並び順が既存テンプレと同じ（`Clip skip: N, RNG: X,`）であることを確認する。

```bash
PYTHONIOENCODING=utf-8 python -c "print(open('templates/_roundtrip_check.txt', encoding='utf-8').read().splitlines()[-1])"
rm templates/_roundtrip_check.txt
```

期待: `Clip skip: 1, RNG: GPU,` のように 2 つが隣接して含まれる（値は reForge の設定次第）。

---

### Task 5: CLAUDE.md を更新する

**Files:**
- Modify: `CLAUDE.md`（Tools 節、`audit_templates.py` の記述と `_apply_audit_fix.py` の間）

**Interfaces:**
- Consumes: Task 3 で作った `tools/backfill_template_rng.py`

- [ ] **Step 1: audit のベースライン記述を実態に合わせる**

`CLAUDE.md` の `audit_templates.py` 節にある次の記述を探す。

```markdown
- 不整合が 1 件以上なら終了コード 1、0 件なら 0。**現状のクリーンな状態は `合計: 0 件`** なので、テンプレやタグを編集したら実行して 0 件を維持する。
```

これを次に置き換える。件数は Task 0 Step 1 で記録した実測値に合わせる。

```markdown
- 不整合が 1 件以上なら終了コード 1、0 件なら 0。**2026-07-25 時点のベースラインは `合計: 1 件`**（`templates/02_NSFW/机上で着崩れた制服と精液.txt:70` の `70_スタイルLoRA_Artist_` 由来。ローカル専用タグに依存する既知の残件）。テンプレやタグを編集したら実行し、**この件数から増えていないこと**を確認する。0 件を目標にしないこと。
```

- [ ] **Step 2: Tools 節に `backfill_template_rng.py` を追記する**

`CLAUDE.md` の `### _apply_audit_fix.py — 監査結果によるコメント行の一括置換` の直前に、以下の節を挿入する。

```markdown
### `backfill_template_rng.py` — テンプレへの RNG 追記

テンプレのパラメータ行に `RNG: <値>` を追記する。既に `RNG:` があるファイルはスキップする。

```bash
PYTHONIOENCODING=utf-8 python tools/backfill_template_rng.py              # dry-run（対象一覧と件数のみ）
PYTHONIOENCODING=utf-8 python tools/backfill_template_rng.py --apply      # 実際に書き換える
PYTHONIOENCODING=utf-8 python tools/backfill_template_rng.py --value CPU --apply  # 値を変えて焼き直す
```

必要な理由: Forge Neo は infotext に `RNG` が無いと `_populate_defaults()` が既定値（`CPU`）を補完し、現在の `randn_source` 設定と食い違うとテンプレ読込ごとに `RNG: CPU` の Override Settings を積む（本体 `modules/infotext_utils.py` の `_populate_defaults` / `get_override_settings`）。テンプレ側に明示しておくことでこれを防ぐ。

- 挿入位置は `Clip skip: N,` の直後。JS 側 `metaInfoMap` の並び順と揃えているため、UI から再保存しても差分が出ない
- Settings の Random Number Generator を変えたら `--value` を変えて再実行し、全テンプレを焼き直す（テンプレに値が焼かれているため、設定変更だけでは追随しない）
- `templates/*.txt` は CRLF 管理なので `newline=''` で読み書きしている（`_apply_audit_fix.py` と同じ理由）
```

- [ ] **Step 3: 記述の整合を確認する**

Run:

```bash
grep -n "合計: 1 件\|backfill_template_rng" CLAUDE.md
```

期待: ベースライン記述 1 箇所と、Tools 節の見出し + コマンド例 3 行が出る。

- [ ] **Step 4: コミット**

```bash
git add CLAUDE.md
git commit -m "docs: backfill_template_rng.py を Tools 節に追記し audit のベースラインを是正"
```

---

## 既知のトレードオフ（実装後に残るリスク）

実装者はこれを消そうとしないこと。ユーザーが承知のうえで選んだ挙動である。

- テンプレに `RNG` を焼くため、**`randn_source` 設定を `CPU` / `NV` に変えると、テンプレ読込時に「RNG を GPU に上書き」する Override Settings が毎回付く**。設定側では回避できない。設定を変えたら `tools/backfill_template_rng.py --value CPU --apply` で焼き直す運用になる。
- `Model` の取得は依然として Settings タブの DOM（`setting_sd_model_checkpoint`）に依存している。`getCurrentModel()` は拡張子・ディレクトリを落とす加工をしており、`opts-infotext` が返す `Model` の生値とは形式が違うため、今回は移行対象外とした。同じ不安定さを抱えているので、実際に取得失敗が起きたら別タスクで対応する（形式変換が必要）。
- `data_labels` に同じ `infotext` 名を持つ設定が複数あると、`opts-infotext` のレスポンスは後勝ちで上書きされる。現状 `Clip skip` / `RNG` に重複は無く実害はない。
- `audit_templates.py` の既存 1 件（ローカル専用タグ `70_スタイルLoRA_Artist_` 由来）は本変更のスコープ外。

## レビュー却下メモ

なし（`plan-reviewer` の指摘 🔴 3 件・🟡 8 件をすべて取り込んだ）。
