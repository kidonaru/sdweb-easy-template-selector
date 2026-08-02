# 除外タグ機能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 99_設定 に「除外タグ」テキストエリアを追加し、そこに書かれたタグを生成時にポジティブプロンプトから厳密一致で取り除く。

**Architecture:** 除去そのものは WebUI 非依存の純粋モジュール `scripts/exclude_tags.py` に閉じ込め、単体テストで担保する。UI（JS）は値を保持して hidden Gradio Textbox へ書き込むだけで、Python 側は生成リクエストに同梱されて届いた文字列を `Script.process` で適用する。プロンプト欄そのものは一切書き換えない。

**Tech Stack:** 素の JavaScript（ビルドなし・WebUI がアルファベット順に読み込む）、Python 3 + Gradio 4.40（Stable Diffusion WebUI Forge Neo の拡張）

## Global Constraints

- コードのコメントとエラーログメッセージは日本語で書く。
- `javascript/` 配下はトップレベルで他ファイルのクラスを参照しない（クラス参照は `onUiLoaded` 以降の実行時に限る）。
- `javascript/js-yaml.min.js` は編集しない。
- ハードコーディングは絶対に必要な場合を除き避ける。
- Python 側の変更は WebUI 再起動が必要。JavaScript の変更は UI リロードで反映される。
- テストの実行はリポジトリルートから。Windows では Bash ツールで `PYTHONIOENCODING=utf-8` を付ける。
- マッチングは厳密一致。大文字小文字の違いと重み記法 `(tag:1.2)` は別物として残す。
- 適用対象はポジティブ系のみ（`p.all_prompts` と `p.all_hr_prompts`）。ネガティブ側は触らない。
- localStorage のキーは `easy_template_exclude_tags`。
- hidden Gradio Textbox の `elem_id` は `easy_template_selector_exclude_tags`。

## File Structure

| ファイル | 責務 |
|---|---|
| `scripts/exclude_tags.py`（新規） | 除外指定のパースとプロンプトからの除去。WebUI に依存しない純粋関数のみ |
| `tests/test_exclude_tags.py`（新規） | 上記の単体テスト。素の Python で実行できる |
| `scripts/easy_prompt_selector.py`（変更） | hidden Textbox の定義と、生成時の除去処理の呼び出し |
| `javascript/ets_element_builder.js`（変更） | 複数行テキストエリアの DOM 生成 |
| `javascript/easy_template_selector.js`（変更） | 99_設定 への配置・値の保持・localStorage・Gradio 同期・readOnly 切替 |
| `CLAUDE.md`（変更） | 構成表と落とし穴の追記 |

---

### Task 1: 除去ロジック（純粋モジュール）

**Files:**
- Create: `scripts/exclude_tags.py`
- Test: `tests/test_exclude_tags.py`

**Interfaces:**
- Consumes: なし
- Produces:
  - `parse_exclude_tags(text: str | None) -> list[str]`
  - `remove_excluded_tags(prompt: str, excludes: list[str]) -> str`
  - `apply_excludes_to_prompt_lists(prompt_lists: list[list[str]], excludes: list[str]) -> None`（in-place 書き換え）

- [ ] **Step 1: 失敗するテストを書く**

`tests/test_exclude_tags.py` を新規作成する。実行方式（末尾の自前ランナー）は既存の `tests/test_upscaler_aliases.py` に合わせる。

```python
"""scripts/exclude_tags.py の単体テスト

対象モジュールは WebUI に依存しないため、リポジトリルートから素の Python で実行できる。

    python tests/test_exclude_tags.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.exclude_tags import (
    apply_excludes_to_prompt_lists,
    parse_exclude_tags,
    remove_excluded_tags,
)


def test_parse_splits_by_comma_and_newline():
    assert parse_exclude_tags('black footwear, black pantyhose,\nsmile') == [
        'black footwear', 'black pantyhose', 'smile'
    ]


def test_parse_drops_empty_and_duplicate():
    assert parse_exclude_tags(' a , , a ,\n\n b ') == ['a', 'b']


def test_parse_accepts_empty_input():
    assert parse_exclude_tags('') == []
    assert parse_exclude_tags(None) == []


def test_remove_drops_matching_tag_and_keeps_separator():
    assert remove_excluded_tags('1girl,solo,', ['solo']) == '1girl,'


def test_remove_keeps_spacing_of_surviving_tags():
    text = 'a, black footwear, b,'
    assert remove_excluded_tags(text, ['black footwear']) == 'a, b,'


def test_remove_keeps_weighted_notation():
    text = '(black footwear:1.2),smile,'
    assert remove_excluded_tags(text, ['black footwear']) == text


def test_remove_is_case_sensitive():
    text = 'Black Footwear,smile,'
    assert remove_excluded_tags(text, ['black footwear']) == text


def test_remove_does_not_match_partially():
    text = 'black footwear focus,smile,'
    assert remove_excluded_tags(text, ['black footwear']) == text


def test_remove_leaves_comment_lines_untouched():
    text = '# 13_衣装 (黒靴),\nblack footwear,smile,'
    assert remove_excluded_tags(text, ['black footwear']) == '# 13_衣装 (黒靴),\nsmile,'


def test_remove_leaves_blank_line_when_all_tags_dropped():
    text = '# 13_衣装 (黒靴),\nblack footwear,\nsmile,'
    assert remove_excluded_tags(text, ['black footwear']) == '# 13_衣装 (黒靴),\n\nsmile,'


def test_remove_handles_escaped_parentheses():
    text = 'mari \\(blue archive\\),smile,'
    assert remove_excluded_tags(text, ['mari \\(blue archive\\)']) == 'smile,'


def test_remove_empties_line_without_trailing_comma():
    # プロンプト末尾など、カンマを伴わず 1 タグだけの行が実在する
    assert remove_excluded_tags('smile,\nblack footwear', ['black footwear']) == 'smile,\n'


def test_remove_returns_input_when_no_excludes():
    text = '1girl,solo,'
    assert remove_excluded_tags(text, []) == text


def test_apply_rewrites_every_list_in_place():
    positives = ['1girl,solo,', 'solo,smile,']
    hires = ['solo,']
    apply_excludes_to_prompt_lists([positives, hires], ['solo'])
    assert positives == ['1girl,', 'smile,']
    assert hires == ['']


def test_apply_does_nothing_without_excludes():
    positives = ['1girl,solo,']
    apply_excludes_to_prompt_lists([positives], [])
    assert positives == ['1girl,solo,']


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

- [ ] **Step 2: テストが失敗することを確認する**

Bash ツールで実行する:

```bash
PYTHONIOENCODING=utf-8 python tests/test_exclude_tags.py
```

期待: `ModuleNotFoundError: No module named 'scripts.exclude_tags'` で落ちる。

- [ ] **Step 3: 実装を書く**

`scripts/exclude_tags.py` を新規作成する。

```python
"""除外タグの指定をパースし、プロンプトから取り除く。

WebUI に依存しない純粋モジュール。テストは tests/test_exclude_tags.py。
"""
import re

# 本体・本拡張ともコメントとして扱う行頭記法。カテゴリ情報を持つため除去対象から外す
COMMENT_LINE_HEAD = re.compile(r'^\s*(#|//)')


def parse_exclude_tags(text):
    """除外タグの指定を正規化した一覧に変換する。

    `,` と改行で区切り、前後の空白を落とし、空要素と重複を除く（記述順は保つ）。
    """
    if not text:
        return []

    tags = []
    for token in re.split(r'[,\n]', text):
        tag = token.strip()
        if tag and tag not in tags:
            tags.append(tag)
    return tags


def remove_excluded_tags(prompt, excludes):
    """プロンプトから除外タグと厳密一致する要素を取り除く。

    行ごとに `,` で区切り、`strip()` した結果が除外タグと完全一致する要素だけを落とす。
    大文字小文字の違いと重み記法 `(tag:1.2)` は別物として残す（意図しない消し込みを避けるため）。

    区切りを保つため空要素は落とさない（`1girl,solo,` から solo を消して `1girl,` になる）。
    行の中身がすべて消えた場合は空行として残し、既存の空行削除設定に処理を任せる。
    """
    if not excludes or not prompt:
        return prompt

    exclude_set = set(excludes)
    lines = []
    for line in prompt.split('\n'):
        if COMMENT_LINE_HEAD.match(line):
            lines.append(line)
            continue
        # 空要素は strip() が '' になり除外集合に入らないため、そのまま残る
        kept = [part for part in line.split(',') if part.strip() not in exclude_set]
        lines.append(','.join(kept))
    return '\n'.join(lines)


def apply_excludes_to_prompt_lists(prompt_lists, excludes):
    """複数のプロンプト一覧へまとめて除外を適用する（in-place 書き換え）。

    本体の `p.all_prompts` などがリストの同一性を前提に扱われるため、
    新しいリストを返さず要素を置き換える。
    """
    if not excludes:
        return

    for prompts in prompt_lists:
        for i in range(len(prompts)):
            prompts[i] = remove_excluded_tags(prompts[i], excludes)
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
PYTHONIOENCODING=utf-8 python tests/test_exclude_tags.py
```

期待: 全件 `PASS` で `0 failed`、終了コード 0。

- [ ] **Step 5: 既存テストが壊れていないことを確認する**

```bash
PYTHONIOENCODING=utf-8 python tests/test_upscaler_aliases.py && PYTHONIOENCODING=utf-8 python tests/test_hr_cfg_inherit.py && node --test
```

期待: いずれも成功。

- [ ] **Step 6: コミット**

```bash
git add scripts/exclude_tags.py tests/test_exclude_tags.py
git commit -m "feat(exclude): 除外タグのパースと除去を行う純粋モジュールを追加"
```

---

### Task 2: 生成パイプラインへの組み込み（Python）

**Files:**
- Modify: `scripts/easy_prompt_selector.py`（`ui()` / `replace_template_tags()` / `process()`）

**Interfaces:**
- Consumes: `parse_exclude_tags(text)`, `apply_excludes_to_prompt_lists(prompt_lists, excludes)`（Task 1）
- Produces:
  - hidden Gradio Textbox `elem_id='easy_template_selector_exclude_tags'`（Task 3 の JS が値を書き込む先）
  - `Script.apply_exclude_tags(self, p, exclude_text) -> None`

- [ ] **Step 1: import を追加する**

`scripts/easy_prompt_selector.py` の 11 行目 `from scripts.hr_cfg_inherit import resolve_hr_cfg` の直後に追加する。

```python
from scripts.exclude_tags import apply_excludes_to_prompt_lists, parse_exclude_tags
```

- [ ] **Step 2: hidden Textbox を `ui()` に追加する**

`ui()`（現在 109-123 行）の `apply_button` 定義の直後に Textbox を足し、戻り値の末尾に加える。既存 2 件の順序は変えない（`process()` が位置で読むため）。

```python
        image_info = gr.Textbox("", elem_id='easy_template_selector_image_info', interactive=True, visible=False)
        apply_button = gr.Button("", elem_id='easy_template_selector_apply_button', visible=False)
        # 除外タグ。JS 側の 99_設定 テキストエリアが値を書き込む。
        # 生成リクエストに同梱されて process() へ届くため、別経路で送る場合のような競合が起きない
        exclude_tags = gr.Textbox("", elem_id='easy_template_selector_exclude_tags', interactive=True, visible=False)

        binding = parameters_copypaste.ParamBinding(
            paste_button=apply_button,
            tabname="txt2img",
            source_text_component=image_info,
            source_tabname="txt2img")
        parameters_copypaste.register_paste_params_button(binding)

        return [image_info, apply_button, exclude_tags]
```

- [ ] **Step 3: 除去処理のメソッドを追加する**

`replace_template_tags()` の直前（現在の 125 行目の上）に追加する。

```python
    def apply_exclude_tags(self, p, exclude_text):
        """除外タグをポジティブ系プロンプトから取り除く。

        ネガティブ側は対象外。消すと望まない要素が出るようになり、事故が分かりにくいため。
        """
        # Hires.fix が無効なとき本体は all_hr_prompts を None のままにするため、リスト側の有無で判定する
        targets = [p.all_prompts]
        if getattr(p, 'all_hr_prompts', None):
            targets.append(p.all_hr_prompts)

        apply_excludes_to_prompt_lists(targets, parse_exclude_tags(exclude_text))
```

`hr_cfg_inherit.py` の `resolve_hr_cfg` / `inherit_hr_cfg` と同じく、判断ロジックは純粋モジュール側に置き、こちらは `p` からの値の取り出しと受け渡しだけを行う。

- [ ] **Step 4: `replace_template_tags()` から呼び出す**

シグネチャに `exclude_text` を足し、`@...@` 展開のループ（現在 135-143 行）の直後・整形設定を読む行（現在の `# 本体のコメント除去…` コメント）の直前に呼び出しを挿入する。

変更前:

```python
    def replace_template_tags(self, p):
```

変更後:

```python
    def replace_template_tags(self, p, exclude_text=''):
```

挿入するコード（`@` 展開ループの `all_prompts[i] = replaced` を含む for が閉じた直後）:

```python
        # @...@ の展開後に消すのは、ランダム抽選で出たタグも除外対象にするため。
        # format_prompt() より前に置くのは、空になった行を既存の空行削除に拾わせるため
        self.apply_exclude_tags(p, exclude_text)
```

- [ ] **Step 5: `process()` から値を渡す**

```python
    def process(self, p, *args):
        # img2img では ui() が None を返して args が空になるため、長さで防御する
        exclude_text = args[2] if len(args) > 2 else ''
        self.replace_template_tags(p, exclude_text)
        self.inherit_hr_cfg(p)
```

- [ ] **Step 6: 構文と import を確認する**

```bash
PYTHONIOENCODING=utf-8 python -c "import ast,sys; ast.parse(open('scripts/easy_prompt_selector.py',encoding='utf-8').read()); print('OK')"
```

期待: `OK`。（`modules` に依存するため実 import はできない。実挙動の確認は Task 3 完了後に WebUI 上で行う）

- [ ] **Step 7: コミット**

```bash
git add scripts/easy_prompt_selector.py
git commit -m "feat(exclude): 生成時にポジティブプロンプトから除外タグを取り除く"
```

---

### Task 3: 99_設定 のテキストエリア（JavaScript）

**Files:**
- Modify: `javascript/ets_element_builder.js`（`multilineTextarea()` を追加）
- Modify: `javascript/easy_template_selector.js`（`IDS` / `constructor` / `renderTemplateSettings()` / `syncBatchControls()` / `init()`）

**Interfaces:**
- Consumes: hidden Textbox `easy_template_selector_exclude_tags`（Task 2）
- Produces:
  - `ETSElementBuilder.multilineTextarea(id, placeholder, value, { onInput }) -> HTMLDivElement`
  - `EasyTemplateSelector.IDS.EXCLUDE_TAGS = 'easy_template_selector_exclude_tags_input'`
  - `EasyTemplateSelector.EXCLUDE_TAGS_STORAGE_KEY = 'easy_template_exclude_tags'`
  - `this.excludeTags`（除外タグ文字列の保持元）

- [ ] **Step 1: 複数行テキストエリアのビルダーを追加する**

`javascript/ets_element_builder.js` の既存 `textarea()`（231-283 行、テンプレート名用の単一行 `<input>`）の直後に追加する。既存メソッドは名前が紛らわしいが、他から使われているため変更しない。

```javascript
  // 複数行入力用のテキストエリア。単一行の textarea() とは別物（あちらは <input type="text">）
  static multilineTextarea(id, placeholder, value, { onInput }) {
    const container = document.createElement('div')
    container.id = id
    container.classList.add('block', 'gradio-textbox', 'padded')
    container.style.borderStyle = 'solid'
    container.style.overflow = 'hidden'
    container.style.width = '100%'
    container.style.marginTop = '4px'
    container.style.borderWidth = 'var(--block-border-width)'

    const label = document.createElement('label')

    const input = document.createElement('textarea')
    input.setAttribute('data-testid', 'textbox')
    input.classList.add('scroll-hide')
    input.setAttribute('dir', 'ltr')
    input.rows = 2
    input.placeholder = placeholder
    input.value = value
    input.style.width = '100%'
    input.style.resize = 'vertical'

    // Svelte のクラス名を取得して追加（既存の textarea() と同じ手順）
    let svelteClass = gradioApp().querySelector('.gradio-textbox')?.classList
      .toString()
      .match(/svelte-[a-z0-9]+/)?.[0]
    if (svelteClass) {
      container.classList.add(svelteClass)
    }

    svelteClass = gradioApp().querySelector('.gradio-textbox label')?.classList
      .toString()
      .match(/svelte-[a-z0-9]+/)?.[0]
    if (svelteClass) {
      label.classList.add(svelteClass)
    }

    svelteClass = gradioApp().querySelector('.gradio-textbox textarea')?.classList
      .toString()
      .match(/svelte-[a-z0-9]+/)?.[0]
    if (svelteClass) {
      input.classList.add(svelteClass)
    }

    input.addEventListener('input', () => {
      onInput(input.value)
    })

    label.appendChild(input)
    container.appendChild(label)

    return container
  }
```

- [ ] **Step 2: ID と localStorage キーの定数を追加する**

`javascript/easy_template_selector.js` の `IDS`（3-21 行）に 1 行足す。hidden Gradio Textbox 側の `elem_id` と衝突しないよう、こちらは `_input` 接尾辞にする。

```javascript
    BATCH_STOP_BUTTON: 'easy_template_selector_batch_stop_button',
    // JS が描画する入力欄。Python 側の hidden Textbox (elem_id: ..._exclude_tags) とは別物
    EXCLUDE_TAGS: 'easy_template_selector_exclude_tags_input',
    EXCLUDE_TAGS_BRIDGE: 'easy_template_selector_exclude_tags'
```

`BATCH_SELECTED_OUTLINE` の定義（24 行）の直後に追加する。

```javascript
  // 除外タグの保存先。サーバ側に状態を持たせないためブラウザに置く
  static EXCLUDE_TAGS_STORAGE_KEY = 'easy_template_exclude_tags'
```

- [ ] **Step 3: 状態の初期化と Gradio への同期メソッドを追加する**

`constructor` 内、`this.batchMode = false`（54 行）の直前に追加する。

```javascript
    // 除外タグ。99_設定 は render() のたびに作り直されるため、値の保持元はここに置く
    this.excludeTags = EasyTemplateSelector.loadExcludeTags()
```

クラス末尾の `reload()` の直前に、静的メソッドとインスタンスメソッドを追加する。

```javascript
  // 除外タグを localStorage から読む。読めない環境・壊れた値でも動作を止めない
  static loadExcludeTags() {
    try {
      return localStorage.getItem(EasyTemplateSelector.EXCLUDE_TAGS_STORAGE_KEY) || ''
    } catch (error) {
      console.warn('除外タグの読み込みに失敗しました:', error)
      return ''
    }
  }

  // 除外タグを保持し、localStorage と Python へ渡す hidden Textbox の両方へ反映する
  setExcludeTags(value) {
    this.excludeTags = value
    try {
      localStorage.setItem(EasyTemplateSelector.EXCLUDE_TAGS_STORAGE_KEY, value)
    } catch (error) {
      console.warn('除外タグの保存に失敗しました:', error)
    }
    this.syncExcludeTagsBridge()
  }

  // hidden Gradio Textbox へ値を書き込む。updateInput() まで行わないとフロント状態に乗らず、
  // 生成リクエストに古い値が送られる
  syncExcludeTagsBridge() {
    const bridge = gradioApp()
      .getElementById(EasyTemplateSelector.IDS.EXCLUDE_TAGS_BRIDGE)
      ?.querySelector('textarea')
    if (!bridge) {
      return
    }
    bridge.value = this.excludeTags
    updateInput(bridge)
  }
```

- [ ] **Step 4: 99_設定 にテキストエリアを配置する**

`renderTemplateSettings()`（346-385 行）の末尾を書き換える。

変更前:

```javascript
    fields.append(buttons)

    return fields
  }
```

変更後:

```javascript
    fields.append(buttons)

    // 除外タグ。生成時に Python 側がポジティブプロンプトから厳密一致で取り除く。
    // 99_設定 は render() のたびに作り直されるので、初期値は this.excludeTags から入れる
    fields.append(ETSElementBuilder.multilineTextarea(
      EasyTemplateSelector.IDS.EXCLUDE_TAGS,
      '除外タグ (例: black footwear, black pantyhose,)',
      this.excludeTags,
      { onInput: (value) => this.setExcludeTags(value) }
    ))

    return fields
  }
```

- [ ] **Step 5: 一括生成の実行中は readOnly にする**

`syncBatchControls()`（622-633 行）の末尾に追加する。`syncBatchModeUi()` → `syncBatchControls()` の経路で `render()` 直後にも走るため、作り直された要素にも反映される。

```javascript
    // 実行中の編集は「テンプレごとに除外条件が変わる」事故になるため止める。
    // プロンプト欄と同じく readOnly（disabled はフォーム送信への影響を避けて使わない）
    const excludeInput = gradioApp()
      .getElementById(EasyTemplateSelector.IDS.EXCLUDE_TAGS)
      ?.querySelector('textarea')
    if (excludeInput) {
      excludeInput.readOnly = running
      excludeInput.style.opacity = running ? '0.6' : ''
    }
```

- [ ] **Step 6: 起動時に hidden Textbox へ初期値を流し込む**

`onUiLoaded` の `await easyPromptSelector.init()` の直後に追加する。localStorage に前回値があるとき、一度も入力しないまま生成しても Python 側に届くようにするため。

```javascript
  await easyPromptSelector.init()
  easyPromptSelector.syncExcludeTagsBridge()
```

- [ ] **Step 7: 既存の JS テストが通ることを確認する**

```bash
node --test
```

期待: 既存テストが全て成功（本タスクは純粋モジュールを触らないため、新規テストは追加しない）。

- [ ] **Step 8: WebUI 上で動作を確認する**

WebUI を再起動する（Task 2 で Python を変更しているため UI リロードでは足りない）。以下を順に確認する。

1. 「🔯タグを選択」を開き、テンプレートタブ末尾の 99_設定 に除外タグ欄が出ている
2. 適当なテンプレートを適用し、プロンプトに含まれるタグ（例 `solo`）を除外タグ欄へ入力して生成する
3. 生成画像の PNG Info で、そのタグがプロンプトから消えていること／他のタグと区切りが壊れていないことを確認する
4. プロンプト欄の表示は書き換わっていないことを確認する
5. `(tag:1.2)` 形式・大文字混じり・部分一致のタグが**消えない**ことを確認する
6. ブラウザをリロードし、除外タグ欄の値が復元され、そのまま生成しても除外が効くことを確認する
7. 一括生成モードで実行中、除外タグ欄が編集できない（薄く表示される）ことと、停止後に戻ることを確認する

- [ ] **Step 9: コミット**

```bash
git add javascript/ets_element_builder.js javascript/easy_template_selector.js
git commit -m "feat(exclude): 99_設定 に除外タグの入力欄を追加"
```

---

### Task 4: ドキュメント更新

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: Task 1-3 の全成果
- Produces: なし

- [ ] **Step 1: System Structure の構成表に新規ファイルを追記する**

`scripts/` のツリーに 1 行足す（既存の並び順に合わせ `easy_prompt_selector.py` の下、`hr_cfg_inherit.py` の上）。

```
│   ├── exclude_tags.py           # 除外タグのパースとプロンプトからの除去（WebUI 非依存）
```

- [ ] **Step 2: Coding Conventions に仕様と落とし穴を追記する**

一括生成に関する記述群の直後に追加する。

```markdown
- 除外タグは 99_設定 のテキストエリアに入力し、`Script.process` がポジティブ系プロンプト（`all_prompts` / `all_hr_prompts`）から厳密一致で取り除く。プロンプト欄は書き換えないため、補完・キャレット同期・一括生成の待機制御に干渉しない
- 除外タグ欄の値は JS が localStorage（`easy_template_exclude_tags`）に持ち、入力のたびに hidden Gradio Textbox（`easy_template_selector_exclude_tags`）へ `updateInput()` 付きで書き込む。生成リクエストに同梱されるので、入力直後に生成しても古い値が使われる競合が起きない
- 落とし穴: `Script.ui()` の戻り値は位置で `process(p, *args)` に届く。除外タグは `args[2]` なので、`ui()` の戻り値の順序を変えると壊れる。img2img は `ui()` が `None` を返して args が空になるため長さで防御している
- 除去は `@...@` 展開の**後**、`format_prompt()` の**前**に行う。前者はランダム抽選で出たタグも対象にするため、後者は空になった行を既存の空行削除に拾わせるため
- 除外のマッチングは厳密一致で、重み記法 `(tag:1.2)` と大文字小文字違いは残す。`black footwear` の指定で `black footwear focus` まで巻き込む事故を避けるため、部分一致にはしない
- 除外タグ欄は `render()` のたびに作り直されるため、値の保持元は `this.excludeTags`。一括生成の実行中の `readOnly` 切り替えは `syncBatchControls()` に集約している（`render()` 直後にも `syncBatchModeUi()` 経由で走るため、作り直された要素にも反映される）
- 落とし穴: 生成画像の infotext には除外**後**のプロンプトが焼かれる（`Hires CFG Scale` の継承と同型）。**生成画像を PNG Info から txt2img へ送った状態でテンプレを保存すると、除外したタグが欠けたテンプレになる**。テンプレを作り直すときはテンプレ適用直後の状態から保存すること
```

- [ ] **Step 3: Build & Test にテストコマンドを追記する**

既存の Python 単体テストの並びに 1 行足す。

```bash
PYTHONIOENCODING=utf-8 python tests/test_exclude_tags.py
```

- [ ] **Step 4: コミット**

```bash
git add CLAUDE.md
git commit -m "docs: 除外タグ機能の仕様と落とし穴を追記"
```

---

## Self-Review

**Spec coverage:**

| 設計書の項目 | 実装タスク |
|---|---|
| UI（テキストエリア・placeholder・localStorage・Gradio 同期・readOnly） | Task 3 |
| 受け渡し（hidden Textbox・args[2]・img2img 防御） | Task 2 |
| 除去ロジック（parse / remove・厳密一致・コメント行素通し・空行化） | Task 1 |
| 適用位置（@ 展開後・format_prompt 前・ポジティブのみ） | Task 2 Step 3-4 |
| infotext（追加記録なし） | 設計どおり何も実装しない |
| テスト（9 項目） | Task 1 Step 1 |
| CLAUDE.md 更新 | Task 4 |

**Type consistency:** `parse_exclude_tags` / `remove_excluded_tags` / `apply_excludes_to_prompt_lists` / `apply_exclude_tags` / `setExcludeTags` / `syncExcludeTagsBridge` / `multilineTextarea` の名前と引数は全タスクで一致している。`IDS.EXCLUDE_TAGS`（JS 側の入力欄）と `IDS.EXCLUDE_TAGS_BRIDGE`（Python 側の hidden Textbox）は別の値であることを Task 3 Step 2 で明記済み。

## レビュー却下メモ

- `getattr(p, 'all_hr_prompts', None)` の Hires 有無判定が `replace_template_tags()` と `apply_exclude_tags()` で重複する（共通化すべき） — 却下。既存側は 4 種のプロンプト組（ポジ・ネガ・Hires ポジ・Hires ネガ）を構築するための条件で、新設側はポジ系 2 本のみと対象が異なる。共通化すると引数で対象を切り替える関数になり、1 行のイディオムを消すための複雑化に見合わない。
