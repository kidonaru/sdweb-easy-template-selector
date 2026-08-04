# 出力ファイル名へのテンプレート名差し込み 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本体のファイル名パターンで使えるキーワード `[template_name]` を拡張から追加し、ヘッダの「テンプレート名」欄の値を出力画像のファイル名に差し込めるようにする。

**Architecture:** JS 側のテンプレート名欄 → hidden Gradio Textbox → `Script.process` で `p.ets_template_name` → 本体 `modules.images.FilenameGenerator.replacements` に足したキーが `p` から読む、という一方向の流れ。`replacements` はクラス変数なので拡張の import 時にキーを 1 つ追加するだけで済み、本体のコードには触らない。

**Tech Stack:** Python 3（WebUI / Forge Neo の拡張 Script API）、Gradio 4.40、素の JavaScript（ビルド無し）

## Global Constraints

- 思考は英語、回答は日本語。**コードのコメントとエラーログメッセージは日本語**で書く。
- ハードコーディングは絶対に必要な場合を除き避ける。
- `javascript/` 配下は WebUI がアルファベット順に読み込むため、トップレベルで他ファイルのクラスを参照しない（実行時参照のみ）。
- `Script.ui()` の戻り値は位置で `process(p, *args)` に届く。既存の `args[2]`（除外タグ）/ `args[3]`（プロファイル）を崩さないよう、新しい Textbox は**戻り値の末尾**に追加する。
- WebUI 非依存の純粋モジュールには `tests/` に単体テストを添える（既存の `upscaler_aliases` / `exclude_tags` と同じ形式）。
- Windows の Bash ツールから Python を実行するときは `PYTHONIOENCODING=utf-8` を付ける。
- 生成画像の infotext は変更しない。テンプレート保存の挙動にも影響を出さない。
- hidden Textbox の elem_id は `easy_template_selector_template_name_bridge`。JS 側の欄が既に `easy_template_selector_template_name` を使っているため衝突を避ける。

---

### Task 1: テンプレート名の整形（純粋関数 + 単体テスト）

`02_NSFW/おしがま` のようなカテゴリパス付きの名前から末尾要素だけを取り出す純粋関数を作る。WebUI に依存させないため、ここではサニタイズを行わない（サニタイズは Task 2 で本体の `sanitize_filename_part` に任せる）。

**Files:**
- Create: `scripts/template_name_filename.py`
- Test: `tests/test_template_name_filename.py`

**Interfaces:**
- Consumes: なし
- Produces: `leaf_template_name(raw: str | None) -> str` — パス区切り（`/` と `\`）で分割した末尾要素を前後の空白を除いて返す。入力が `None` / 空 / 区切りで終わる場合は `''` を返す。

- [ ] **Step 1: 失敗するテストを書く**

`tests/test_template_name_filename.py` を新規作成:

```python
"""scripts/template_name_filename.py の単体テスト

対象の整形関数は WebUI に依存しないため、リポジトリルートから素の Python で実行できる。

    python tests/test_template_name_filename.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.template_name_filename import leaf_template_name


def test_takes_leaf_of_slash_path():
    assert leaf_template_name('02_NSFW/おしがま') == 'おしがま'


def test_takes_leaf_of_backslash_path():
    assert leaf_template_name(r'anima\02_NSFW\おしがま') == 'おしがま'


def test_keeps_plain_name_with_spaces():
    assert leaf_template_name('I Need Buzz') == 'I Need Buzz'


def test_trims_surrounding_spaces():
    assert leaf_template_name('  02_NSFW / おしがま  ') == 'おしがま'


def test_returns_empty_for_blank_input():
    assert leaf_template_name('') == ''
    assert leaf_template_name('   ') == ''
    assert leaf_template_name(None) == ''


def test_returns_empty_when_path_ends_with_separator():
    assert leaf_template_name('02_NSFW/') == ''


if __name__ == '__main__':
    failures = 0
    for name, func in sorted(globals().items()):
        if not name.startswith('test_') or not callable(func):
            continue
        try:
            func()
            print(f'PASS {name}')
        except AssertionError as error:
            failures += 1
            print(f'FAIL {name}: {error}')
    print(f'\n{failures} failed')
    sys.exit(1 if failures else 0)
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `PYTHONIOENCODING=utf-8 python tests/test_template_name_filename.py`
Expected: FAIL（`ModuleNotFoundError: No module named 'scripts.template_name_filename'`）

- [ ] **Step 3: 最小の実装を書く**

`scripts/template_name_filename.py` を新規作成:

```python
# 出力ファイル名パターンのキーワード [template_name] を提供する
#
# ヘッダの「テンプレート名」欄の値（例: 02_NSFW/おしがま）から末尾要素だけを取り出し、
# 本体の FilenameGenerator に差し込む。
#
# leaf_template_name() は WebUI に依存しない純粋関数に保つこと（単体で import して検証するため）。
import re

# テンプレート名のパス区切り。サーバー側は / を使うが、手入力で \ が混ざる場合も拾う
_SEPARATORS = re.compile(r'[\\/]')


def leaf_template_name(raw):
    """カテゴリパス付きのテンプレート名から末尾のテンプレート名だけを取り出す。

    例: '02_NSFW/おしがま' -> 'おしがま'
    値が無い場合や区切りで終わる場合は空文字を返す。
    """
    if not raw:
        return ''

    return _SEPARATORS.split(raw)[-1].strip()
```

- [ ] **Step 4: テストが通ることを確認**

Run: `PYTHONIOENCODING=utf-8 python tests/test_template_name_filename.py`
Expected: PASS（`PASS test_...` が 6 行と `0 failed`）

- [ ] **Step 5: コミット**

```bash
git add scripts/template_name_filename.py tests/test_template_name_filename.py
git commit -m "feat: テンプレート名からファイル名用の末尾要素を取り出す整形関数を追加"
```

---

### Task 2: `[template_name]` キーワードの登録と Python 側の配線

本体の `FilenameGenerator.replacements` にキーを追加し、hidden Textbox で受け取った値を `p` に載せる。

**Files:**
- Modify: `scripts/template_name_filename.py`（`register_filename_pattern()` を追記）
- Modify: `scripts/easy_prompt_selector.py`（import と登録呼び出し、`ui()` の Textbox 追加、`process()` での格納）

**Interfaces:**
- Consumes: `leaf_template_name(raw) -> str`（Task 1）
- Produces:
  - `register_filename_pattern() -> None` — `modules.images.FilenameGenerator.replacements['template_name']` を登録する。複数回呼んでも安全。
  - `p.ets_template_name: str` — 生成中の `StableDiffusionProcessing` に載る生のテンプレート名（カテゴリパス付き）

- [ ] **Step 1: 登録関数を実装**

`scripts/template_name_filename.py` の末尾に追記（先頭の `import re` はそのまま）:

```python
def _template_name_for_filename(generator):
    """FilenameGenerator から呼ばれる [template_name] の実体。

    値が無いときは NOTHING_AND_SKIP_PREVIOUS_TEXT を返し、直前の区切り文字ごと
    落とす（'[seed]-[template_name]' で末尾に '-' だけが残るのを防ぐ）。
    """
    from modules.images import NOTHING_AND_SKIP_PREVIOUS_TEXT, sanitize_filename_part

    name = leaf_template_name(getattr(generator.p, 'ets_template_name', ''))
    if not name:
        return NOTHING_AND_SKIP_PREVIOUS_TEXT

    # 空白は残す。'I Need Buzz' のような名前を読める形のままファイル名に出すため
    return sanitize_filename_part(name, replace_spaces=False)


def register_filename_pattern():
    """本体のファイル名パターンに [template_name] を追加する。

    replacements はクラス変数なので、キーを 1 つ足すだけで
    ファイル名・グリッド・サブフォルダのどのパターンからも使えるようになる。
    """
    from modules.images import FilenameGenerator

    FilenameGenerator.replacements['template_name'] = _template_name_for_filename
```

WebUI への import は関数の中で行う。モジュール先頭で import すると `tests/` から素の Python で読み込めなくなるため。

- [ ] **Step 2: 拡張の import 時に登録を呼ぶ**

`scripts/easy_prompt_selector.py` の import 群（`from scripts.prompt_format import ...` の行の直後）に追加:

```python
from scripts.template_name_filename import register_filename_pattern
```

そして `FILE_DIR = Path().absolute()` の直後に追加:

```python
# ファイル名パターンのキーワード [template_name] を本体へ登録する。
# replacements はクラス変数なので、拡張の読み込み時に一度足せば以降ずっと効く
register_filename_pattern()
```

- [ ] **Step 3: hidden Textbox を `ui()` に追加**

`scripts/easy_prompt_selector.py` の `ui()` 内、`profile = gr.Textbox(...)` の直後に追加:

```python
        # テンプレート名。JS 側のヘッダの入力欄が値を書き込む。
        # ファイル名パターンの [template_name] が使うため生成リクエストに同梱する
        template_name = gr.Textbox("", elem_id='easy_template_selector_template_name_bridge', interactive=True, visible=False)
```

戻り値を差し替える（**末尾に追加**。既存の位置を崩さないため）:

```python
        return [image_info, apply_button, exclude_tags, profile, template_name]
```

- [ ] **Step 4: `process()` で `p` に載せる**

`scripts/easy_prompt_selector.py` の `process()` を差し替える。変更前:

```python
    def process(self, p, *args):
        # args は ui() の戻り値がそのまま位置で届く。args[2] = exclude_tags, args[3] = profile。
        # ui() の戻り値の並びを変えたらここも直す。
        # img2img では ui() が None を返して args が空になるため長さで防御する
        exclude_text = args[2] if len(args) > 2 else ''
        profile = args[3] if len(args) > 3 else ''
        self.replace_template_tags(p, exclude_text, profile or DEFAULT_PROFILE)
        self.inherit_hr_cfg(p)
```

変更後:

```python
    def process(self, p, *args):
        # args は ui() の戻り値がそのまま位置で届く。
        # args[2] = exclude_tags, args[3] = profile, args[4] = template_name。
        # ui() の戻り値の並びを変えたらここも直す。
        # img2img では ui() が None を返して args が空になるため長さで防御する
        exclude_text = args[2] if len(args) > 2 else ''
        profile = args[3] if len(args) > 3 else ''
        # ファイル名パターンの [template_name] が p から読む
        p.ets_template_name = args[4] if len(args) > 4 else ''
        self.replace_template_tags(p, exclude_text, profile or DEFAULT_PROFILE)
        self.inherit_hr_cfg(p)
```

- [ ] **Step 5: 既存テストが壊れていないことを確認**

Run:

```bash
PYTHONIOENCODING=utf-8 python tests/test_template_name_filename.py
PYTHONIOENCODING=utf-8 python tests/test_exclude_tags.py
PYTHONIOENCODING=utf-8 python tests/test_upscaler_aliases.py
PYTHONIOENCODING=utf-8 python tests/test_hr_cfg_inherit.py
```

Expected: 4 つとも PASS

- [ ] **Step 6: 構文チェック**

Run: `PYTHONIOENCODING=utf-8 python -m py_compile scripts/easy_prompt_selector.py scripts/template_name_filename.py`
Expected: 出力なし（エラーが出なければ成功）

- [ ] **Step 7: コミット**

```bash
git add scripts/template_name_filename.py scripts/easy_prompt_selector.py
git commit -m "feat: ファイル名パターンに [template_name] を追加"
```

---

### Task 3: JS 側の同期（テンプレート名欄 → hidden Textbox）

ヘッダの「テンプレート名」欄の値を hidden Gradio Textbox へ書き込む。手入力とテンプレ適用の両方が `input` イベントとして届くため、リスナは 1 本で足りる（`applyMeta()` が `updateInput()` を呼ぶ）。

**Files:**
- Modify: `javascript/easy_template_selector.js`（`IDS` への追加、`templateNameArea` の `onChange`、`syncTemplateNameBridge()` の追加、`onUiLoaded` での初回同期）

**Interfaces:**
- Consumes: `easy_template_selector_template_name_bridge`（Task 2 の hidden Textbox）
- Produces: `EasyTemplateSelector.prototype.syncTemplateNameBridge() -> void`

- [ ] **Step 1: bridge の id を `IDS` に追加**

`javascript/easy_template_selector.js` の `static IDS = {` 内、`PROFILE_BRIDGE: 'easy_template_selector_profile'` の行を差し替える:

```js
    // Python 側の hidden Textbox。ドロップダウンとは別物
    PROFILE_BRIDGE: 'easy_template_selector_profile',
    // Python 側の hidden Textbox。ヘッダの入力欄 (TEMPLATE_NAME) とは別物
    TEMPLATE_NAME_BRIDGE: 'easy_template_selector_template_name_bridge'
```

- [ ] **Step 2: 同期メソッドを追加**

`syncProfileBridge()` メソッドの直後に追加:

```js
  // ヘッダのテンプレート名欄の値を hidden Textbox へ書き込む（生成リクエストに同梱される）。
  // テンプレ適用時も applyMeta() の updateInput() が input イベントを起こすので同じ経路で拾える
  syncTemplateNameBridge() {
    const input = gradioApp()
      .getElementById(EasyTemplateSelector.IDS.TEMPLATE_NAME)
      ?.querySelector('input')
    const bridge = gradioApp()
      .getElementById(EasyTemplateSelector.IDS.TEMPLATE_NAME_BRIDGE)
      ?.querySelector('textarea')
    if (!input || !bridge) {
      return
    }
    bridge.value = input.value
    updateInput(bridge)
  }
```

- [ ] **Step 3: テンプレート名欄の `onChange` を配線**

`javascript/easy_template_selector.js` の `templateNameArea` の生成箇所を差し替える。変更前:

```js
      const templateNameArea = ETSElementBuilder.textarea(EasyTemplateSelector.IDS.TEMPLATE_NAME, "テンプレート名", {
        onChange: () => {}
      })
```

変更後:

```js
      const templateNameArea = ETSElementBuilder.textarea(EasyTemplateSelector.IDS.TEMPLATE_NAME, "テンプレート名", {
        onChange: () => this.syncTemplateNameBridge()
      })
```

- [ ] **Step 4: 初回同期を `onUiLoaded` に追加**

ファイル末尾の `onUiLoaded` 内、`easyPromptSelector.syncProfileBridge()` の直後に追加:

```js
  easyPromptSelector.syncTemplateNameBridge()
```

- [ ] **Step 5: 構文チェック**

Run: `node --check javascript/easy_template_selector.js`
Expected: 出力なし

- [ ] **Step 6: 既存の JS 単体テストが通ることを確認**

Run: `node --test`
Expected: PASS（`fail 0`）

- [ ] **Step 7: コミット**

```bash
git add javascript/easy_template_selector.js
git commit -m "feat: テンプレート名欄を Python 側の hidden Textbox へ同期"
```

---

### Task 4: 実機確認とドキュメント追記

WebUI 上で配線が通っていることを確認し、落とし穴を CLAUDE.md に残す。

**Files:**
- Modify: `CLAUDE.md`（Coding Conventions に追記）

**Interfaces:**
- Consumes: Task 1〜3 の全成果
- Produces: なし

- [ ] **Step 1: WebUI を再起動**

Python 側を変更しているため UI リロードでは反映されない。WebUI を再起動する。

- [ ] **Step 2: ファイル名パターンを設定**

Settings > Saving images/grids > `Images filename pattern` に `[seed]-[template_name]` を入れて Apply settings。

- [ ] **Step 3: テンプレ適用 → 生成して確認**

任意のテンプレートを適用してから 1 枚生成し、`outputs/txt2img-images/` 配下のファイル名が `<seed>-<テンプレ名>.png` になっていることを確認する。カテゴリ（`02_NSFW/` 等）が付いていないこと、空白入りの名前がそのまま残っていることも見る。

- [ ] **Step 4: 空欄時の挙動を確認**

ヘッダの「テンプレート名」欄を空にして生成し、ファイル名が `<seed>.png` になる（末尾に `-` が残らない）ことを確認する。

- [ ] **Step 5: 一括生成で確認**

一括生成モードで 2 テンプレート以上を回し、ファイル名がテンプレートごとに変わることを確認する。

- [ ] **Step 6: グリッド画像を確認**

Batch count を 2 以上にして生成し、グリッド画像（`outputs/txt2img-grids/`）のファイル名にもテンプレート名が入ることを確認する。`grid_filename_pattern` も同じ `FilenameGenerator` を使うため自動的に効くはずだが、設計上のメリットとして挙げているので実機で裏を取る。

なお Settings の `Grid filename pattern` が空の場合は本体の既定パターンが使われるため、その場合は `[seed]-[template_name]` を入れてから確認する。

- [ ] **Step 7: 既存機能の回帰確認**

`args` の位置がずれていないこと、および `replacements` へのキー追加が既存のパターンを壊していないことを確認する。

- 99_設定 の除外タグにタグを 1 つ入れて生成し、そのタグが効いている（除外されている）こと
- プロファイルを切り替えて `@カテゴリ@` を含むテンプレートを生成し、当該プロファイルのタグが引かれること
- ファイル名パターンを `[prompt_words]-[template_name]` にして生成し、`[prompt_words]` が従来どおり展開されること

- [ ] **Step 8: CLAUDE.md に追記**

`CLAUDE.md` の Coding Conventions、除外タグに関する記述群の末尾（`- 落とし穴: 生成画像の infotext には除外**後**の…` の行の直後）に追加:

```markdown
- 出力ファイル名の `[template_name]` は、ヘッダの「テンプレート名」欄の値の末尾要素（`02_NSFW/おしがま` なら `おしがま`）。値は hidden Textbox（`easy_template_selector_template_name_bridge`）経由で `p.ets_template_name` に載り、`scripts/template_name_filename.py` が本体の `FilenameGenerator.replacements` に足したキーが読む
- 落とし穴: 欄の値はテンプレ適用時にしか自動更新されない。適用後にプロンプトを手で編集しても名前は残る（派生を追えるようにするための意図的な仕様）。任意の名前を付けたいときは欄を直接書き換える
- 落とし穴: `Script.ui()` の戻り値は位置で `process(p, *args)` に届く。テンプレート名は `args[4]`。新しい hidden Textbox は必ず戻り値の**末尾**に足す
```

- [ ] **Step 9: コミット**

```bash
git add CLAUDE.md
git commit -m "docs: [template_name] のファイル名パターンについて CLAUDE.md に追記"
```

---

## レビュー却下メモ

- キー名を `template_name` ではなく `ets_template_name` のような拡張プレフィックス付きにして衝突を避けるべき — 却下。インストール済み拡張で `FilenameGenerator` に触れているものが 1 つも無いこと、本体の組み込みキーとも衝突しないことを確認済み。キー名は利用者が Settings で手入力するため、短く一般的な `[template_name]` の可読性を優先する。将来衝突した場合は後勝ちで挙動が変わるが、他拡張が同じ辞書に触れた時点で気付ける
