# Hires CFG Scale スライダー下限の緩和 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Forge Neo の `Hires CFG Scale` スライダー下限を拡張側から 1.0 → 0.0 に緩和し、reForge 互換のセンチネル値 `0` が UI 操作で 1.0 に丸められる事故を無くす。

**Architecture:** WebUI 依存の UI 配線を新規モジュール `scripts/hr_cfg_ui.py` に隔離し、純粋な判定ロジックは既存の `scripts/hr_cfg_inherit.py`（テスト済みの WebUI 非依存モジュール）に置く。下限の書き換えは、本体 `ui_loadsave` が `ui-config.json` の値を書き戻した**後**（`on_app_started`）に行う。副作用として発生する「Hires negative prompt がグレーアウトする」問題は、`on_before_ui` で `modules.ui.use_cfg` を差し替えて解消する。

**Tech Stack:** Python 3 / Gradio 4.40.0 / Stable Diffusion WebUI Forge - Neo の `modules.script_callbacks`

## Global Constraints

- **コードのコメントとエラーログメッセージは日本語**で記述する
- ハードコーディングは絶対に必要な場合を除き避ける（本体側の `elem_id` は定数化し、元の下限値は実行時に実測して保持する）
- `javascript/` 配下は本タスクでは触らない
- 本体（Forge Neo 本体リポジトリ）と `ui-config.json` は一切変更しない。すべて拡張側で完結させる
- Python 側の変更のため、動作確認には **WebUI の再起動**が必要（UI リロードでは反映されない）
- 新規に追加する WebUI 非依存の純粋ロジックには `tests/` に単体テストを添える
- Gradio の非公開属性（`BlockFunction._id` など）には依存しない

## 事前に検証済みの本体側の事実（実装の根拠）

すべて実機のソースを直接読んで確認済み。

| 事実 | 場所 |
|---|---|
| `hr_cfg = gr.Slider(minimum=1.0, maximum=24.0, step=0.5, ..., elem_id="txt2img_hr_cfg")` | 本体 `modules/ui.py:265` |
| `hr_cfg.change(fn=use_cfg, inputs=[hr_cfg], outputs=[hr_negative_prompt], ...)` | 本体 `modules/ui.py:299` |
| `def use_cfg(val): return gr.skip() if val is None else gr.update(interactive=(val > 1.0))` | 本体 `modules/ui.py:61-62` |
| 同じ `use_cfg` が txt2img / img2img の `cfg_scale.change` にも使われる（計 3 箇所） | 本体 `modules/ui.py:244, 299, 642` |
| 本体 `cfg_scale` スライダーの下限は txt2img / img2img とも 1.0（＝ `use_cfg` に 0 は届かない） | 本体 `modules/ui.py:243, 640` |
| `Blocks.get_config()` は `__init__` シグネチャ名でインスタンス属性を**ページロードのたびに**読む | `gradio/blocks.py:241-249` |
| `Slider.preprocess()` は素通し、`postprocess()` は `None` 判定のみ。**バックエンド側のクランプは無い** | `gradio/components/slider.py` |
| `Slider.api_info()` は説明文字列を返すだけでバリデーションしない（API 影響なし） | `gradio/components/slider.py:102-105` |
| `on_app_started` のコールバックは `(demo: Optional[Blocks], app: FastAPI)` で呼ばれる（`demo` は None になりうる） | 本体 `modules/script_callbacks.py:253`、`webui.py:62` |
| `webui_worker()` は `while 1:` ループで、UI Reload のたびに `before_ui_callback()` → `ui.create_ui()` → `app_started_callback()` を再実行する | 本体 `webui.py:82, 87, 90, 148` |
| `Options.onchange(key, func, call=True)` が使える | 本体 `modules/options.py:228` |

### ⚠️ 決定的な事実: `ui_loadsave` が `minimum` を書き戻す

**`on_after_component` で `minimum` を書き換えても効かない。**

- 本体 `modules/ui_loadsave.py:94-96` — `type(x) == gr.Slider` のとき `apply_field(x, "value" / "minimum" / "maximum" / "step")` を実行し、`ui-config.json` に保存値があれば `setattr(obj, field, saved_value)` でインスタンス属性を上書きする
- `_internal_preset_param`（本体 `modules/ui.py:465` の `no_config(..., hr_cfg, ...)`）によるスキップは `("value", "step")` のみで、**`minimum` は対象外**（`ui_loadsave.py:51-52`）
- 実機の `ui-config.json:58` に `"txt2img/Hires CFG Scale/minimum": 1.0` が既に存在する
- 実行順は スライダー生成（`modules/ui.py:265`、ここで `after_component` 発火）→ `loadsave.add_block(...)`（`modules/ui.py:903`）→ `loadsave.dump_defaults()`（`:927`）。つまり拡張が書き換えた直後に本体が 1.0 へ戻す

→ 書き換えは `create_ui()` 完了後の `on_app_started` で行う。この順序なら `dump_defaults()` より後になるため、**緩和値が `ui-config.json` に焼き付くこともない**（`on_after_component` で書き換えると、キーが未保存の環境では `self.ui_settings[key] = value_in_gradio` により 0.0 が永続化され、拡張を外しても残ってしまう）。

## 仕様上の決定事項

- **設定 `easy_template_inherit_hr_cfg` と下限の同期**: 下限の書き換えは `on_app_started` に加えて `shared.opts.onchange()` にも登録する。これにより設定を切り替えると、WebUI 再起動なしで（ブラウザの再読み込みだけで）下限が追従する。OFF のときは元の下限に戻すため、「OFF なのに 0 が入力できて CFG 0 で生成される」穴を塞ぐ。
- **`step=0.5` により 0.5 が入力可能になる**: これは意図した副作用。`resolve_hr_cfg()` は 0 以外を明示指定として素通しするため、0.5 を入れると CFG 0.5 で生成される。従来は入力できなかった値なので、CLAUDE.md に明記する（センチネルは 0 のみ）。
- **`use_cfg` の差し替えはグローバル差し替えとする**: `modules.ui.use_cfg` を差し替えると txt2img / img2img の `cfg_scale.change`（`modules/ui.py:244, 642`）にも及ぶが、本体 `cfg_scale` の下限は 1.0 で `val == 0` に到達しないため挙動は変わらない。Gradio の非公開属性（`BlockFunction._id`）に依存する `demo.fns` 走査より堅牢なのでこちらを採る。

## File Structure

- **Create** `scripts/hr_cfg_ui.py` — Hires CFG Scale の UI 側配線。責務は 2 つだけ: (a) スライダー下限の切り替え、(b) `use_cfg` の差し替え。WebUI API に依存するためテストは手動。
- **Modify** `scripts/hr_cfg_inherit.py` — 純粋な判定関数 `is_hr_negative_interactive()` を追加。既存の `resolve_hr_cfg()` には触らない。
- **Modify** `tests/test_hr_cfg_inherit.py` — 上記関数のテストを追加。
- **Modify** `CLAUDE.md` — System Structure に新規ファイルを追記し、解消済みとなった落とし穴の記述を更新。

`scripts/easy_prompt_selector.py`（`Script.process` での実値展開）は**変更しない**。テンプレ側の `Hires CFG Scale: 0` を 0 のまま保つ方針も変えない。

---

### Task 1: スライダー下限を設定に応じて切り替える

**Files:**
- Create: `scripts/hr_cfg_ui.py`
- Modify: `CLAUDE.md`（System Structure、Coding Conventions の落とし穴 2 件目）
- Test: 自動テスト無し（WebUI API 依存のため手動確認。手順は Step 3 に記載）

**Interfaces:**
- Consumes: `modules.script_callbacks.on_after_component` / `on_app_started`、`modules.shared.opts.easy_template_inherit_hr_cfg`（`scripts/settings.py:8` で登録済み）
- Produces: モジュール定数 `HR_CFG_ELEM_ID = 'txt2img_hr_cfg'`。Task 2 が同じモジュールに追記する。

- [ ] **Step 1: `scripts/hr_cfg_ui.py` を新規作成する**

```python
"""Hires CFG Scale の 0 センチネルを UI 上で扱えるようにする

Forge Neo の Hires CFG Scale スライダーは下限 1.0 で定義されており（本体 modules/ui.py:265）、
Gradio 4.40 のフロントエンドは blur 時にこの下限までクランプする。そのため
reForge 互換のセンチネル値 0 をテンプレートから流し込んでも、ユーザーが入力欄に触れた
だけで 1.0 に丸められ、scripts/hr_cfg_inherit.py の継承が発動しなくなる。

Gradio は Blocks.get_config() でコンポーネントの属性をページロードのたびに読み直すため、
minimum を書き換えれば下限を緩和できる。Slider は preprocess / postprocess の
どちらでもクランプしないので、生成側への副作用は無い。

書き換えのタイミングが on_app_started なのは、本体の ui_loadsave が UI 構築中に
ui-config.json の minimum を書き戻すため（本体 modules/ui_loadsave.py:96 の
apply_field(x, "minimum")）。on_after_component で書き換えても直後に上書きされる。
"""

from modules import script_callbacks, shared

# 本体 modules/ui.py:265 で定義されている txt2img 側の Hires CFG Scale スライダー
# （img2img には Hires.fix が無いため対象は txt2img のみ）
HR_CFG_ELEM_ID = 'txt2img_hr_cfg'

# 緩和後の下限。センチネル値 0 を保持できるようにするためだけの値
RELAXED_MINIMUM = 0.0

_hr_cfg_component = None

# ui_loadsave による書き戻し後の下限。設定を OFF に戻すときの復元先として使う
_original_minimum = None


def _capture_hr_cfg(component, **kwargs):
    """下限を書き換える対象のスライダーを覚えておく"""
    global _hr_cfg_component

    if getattr(component, 'elem_id', None) == HR_CFG_ELEM_ID:
        _hr_cfg_component = component


def _apply_minimum():
    """設定に応じて Hires CFG Scale スライダーの下限を切り替える"""
    global _original_minimum

    if _hr_cfg_component is None:
        return

    if _original_minimum is None:
        # ui_loadsave の書き戻しが済んだ後の値を本来の下限として記憶する
        _original_minimum = _hr_cfg_component.minimum

    if shared.opts.easy_template_inherit_hr_cfg:
        _hr_cfg_component.minimum = RELAXED_MINIMUM
    else:
        _hr_cfg_component.minimum = _original_minimum


def _on_app_started(demo, app):
    _apply_minimum()

    # 設定を切り替えたときにブラウザの再読み込みだけで下限が追従するようにする
    # （継承が OFF のまま 0 を入力できると CFG 0 で生成されてしまうため）
    shared.opts.onchange('easy_template_inherit_hr_cfg', _apply_minimum, call=False)


script_callbacks.on_after_component(_capture_hr_cfg)
script_callbacks.on_app_started(_on_app_started)
```

- [ ] **Step 2: 構文チェック**

Bash ツールから実行（リポジトリルート）:

```bash
PYTHONIOENCODING=utf-8 python -c "import ast; ast.parse(open('scripts/hr_cfg_ui.py',encoding='utf-8').read())"
```

Expected: 何も出力されず終了コード 0。`modules` は WebUI 内にしか無いので `import` での確認はしないこと。

- [ ] **Step 3: WebUI で手動確認**

事前に `ui-config.json` の `"txt2img/Hires CFG Scale/minimum"` の値を控えておく（既定 1.0）。

1. WebUI を**再起動**する（Python 変更のため UI リロードでは反映されない）
2. 起動ログに `Error running after_component` / `Error running app_started_callback` が出ていないことを確認する
3. txt2img → Hires.fix を開き、`Hires CFG Scale` の数値入力欄に `0` を入力してから**他の場所をクリックして blur させる**
   - Expected: 表示が `0` のまま保たれる（従来は 1.0 に丸められた）
4. スライダーの**つまみを左端までドラッグ**する
   - Expected: 0 まで下がる
5. `ui-config.json` の `"txt2img/Hires CFG Scale/minimum"` が **1.0 のまま**であることを確認する（緩和値が永続化されていないこと）
6. 適当なテンプレートを適用し、`Hires CFG Scale` が 0 のまま Generate する
   - Expected: コンソールに `hr_cfg_inherit` による継承ログが出て、生成画像の infotext の `Hires CFG Scale` が本体 `CFG Scale` と同じ値になる
7. 生成画像を **PNG Info → Send to txt2img** で送り、続けてテンプレを適用し直して `Hires CFG Scale` が 0 になることを確認する（`PasteField` 経由でも 0 が保持されること。本体 `modules/ui.py:447`）
8. Settings → Easy Template Selector で「Hires CFG Scale が 0 のとき…」を **OFF** にして Apply し、**ブラウザを再読み込み**する
   - Expected: `Hires CFG Scale` に `0` を入れて blur すると 1.0 に丸められる（従来どおりの挙動に戻る）
9. 同設定を **ON** に戻して Apply → ブラウザ再読み込み
   - Expected: 再び 0 を保持できる
10. UI の Reload UI を実行し、手順 3 をもう一度行う
    - Expected: 緩和が維持されている

いずれかが Expected と食い違ったら、その時点で停止して報告すること。

- [ ] **Step 4: `CLAUDE.md` の System Structure に新規ファイルを追記**

`scripts/` ツリーの `hr_cfg_inherit.py` の行の直後に以下を挿入する:

```
│   ├── hr_cfg_ui.py              # Hires CFG Scale スライダーの下限緩和（0 センチネルの保持）
```

- [ ] **Step 5: `CLAUDE.md` の落とし穴の記述を更新**

以下の既存行（Coding Conventions の末尾）を:

```
- 落とし穴: Forge Neo のスライダー下限は 1.0 で、Gradio 4.40 は blur 時にクランプする。テンプレ適用後に `Hires CFG Scale` 入力欄を触ると 0 が 1.0 に丸められることがある（実機確認済み）。1.0 は Neo で「Hires のネガティブ無効」を意味する正規値のため継承は発動せず、ログも出ない
```

次の内容に置き換える:

```
- Forge Neo の `Hires CFG Scale` スライダーは本体側の定義が下限 1.0 で、Gradio 4.40 は blur 時にここまでクランプする。センチネル値 0 が UI 操作で 1.0 に丸められるのを防ぐため、`scripts/hr_cfg_ui.py` が下限を 0 に緩和している。`easy_template_inherit_hr_cfg` が OFF のときは元の下限に戻す（0 を入力できるのに継承しないのは事故のもと）。設定変更はブラウザの再読み込みで反映される
- 下限の書き換えは **`on_app_started` で行う**。本体の `ui_loadsave` が UI 構築中に `ui-config.json` の `minimum` を書き戻すため（本体 `modules/ui_loadsave.py:96`、`_internal_preset_param` のスキップ対象は `value` / `step` のみ）、`on_after_component` で書き換えても直後に上書きされる。この順序なら `dump_defaults()` より後になるので、緩和値が `ui-config.json` に焼き付くこともない
- 下限の緩和が効くのは Gradio が `Blocks.get_config()` でコンポーネント属性をページロードのたびに読み直すため。`Slider` は `preprocess` / `postprocess` のどちらでもクランプしないので、生成側への副作用は無い
- 落とし穴: 緩和により `step` 0.5 刻みで 0.5 も入力できるようになった。センチネルは **0 のみ**で、0.5 は明示指定として素通しされ CFG 0.5 で生成される
- 落とし穴: 1.0 は Neo で「Hires のネガティブ無効」を意味する正規値。誤って 1.0 が入ると継承は発動せずログも出ないため、テンプレ側の値が 0 のままか目視で確認すること
```

- [ ] **Step 6: コミット**

```bash
git add scripts/hr_cfg_ui.py CLAUDE.md docs/superpowers/plans/2026-07-26-hr-cfg-slider-minimum.md
git commit -m "feat(hires): Hires CFG Scale スライダーの下限を 0 に緩和"
```

---

### Task 2: hr_cfg が 0 のとき Hires negative prompt を編集可能に保つ

Task 1 で 0 が入力できるようになると、本体 `modules/ui.py:61` の `use_cfg` が `interactive=(val > 1.0)` と判定するため、`Hires negative prompt` 欄がグレーアウトして編集できなくなる。しかし継承後は実際には本体 CFG Scale が適用され、negative prompt は効く。表示と挙動が食い違うので、判定に 0 を加える。

差し替えは `on_before_ui`（本体 `webui.py:87`、`ui.create_ui()` の直前）で `modules.ui.use_cfg` を置き換えて行う。`hr_cfg.change(fn=use_cfg, ...)` は `create_ui()` の実行中に評価されるため、その前にモジュール属性を差し替えておけば差し替え後の関数が束縛される。UI Reload でも `webui.py:87` を再び通るので再適用される。

**Files:**
- Modify: `scripts/hr_cfg_inherit.py`（純粋関数 `is_hr_negative_interactive` を追加）
- Modify: `tests/test_hr_cfg_inherit.py`
- Modify: `scripts/hr_cfg_ui.py`（`on_before_ui` での差し替え）
- Modify: `CLAUDE.md`
- Test: `tests/test_hr_cfg_inherit.py`

**Interfaces:**
- Consumes: `modules.script_callbacks.on_before_ui`、`scripts.hr_cfg_inherit.is_hr_negative_interactive`
- Produces: `scripts.hr_cfg_inherit.is_hr_negative_interactive(hr_cfg: float) -> bool`

- [ ] **Step 1: 失敗するテストを書く**

`tests/test_hr_cfg_inherit.py` の import 行を次に差し替える:

```python
from scripts.hr_cfg_inherit import resolve_hr_cfg, is_hr_negative_interactive
```

ファイル末尾の `if __name__ == '__main__':` ブロックより**前**に、以下のテストを追加する:

```python
def test_negative_is_interactive_for_sentinel_zero():
    # 0 は「CFG Scale を継承」のセンチネル。継承後は negative が効くので編集可能に保つ
    assert is_hr_negative_interactive(0.0) is True


def test_negative_is_not_interactive_at_one():
    # 1.0 は Neo で「Hires のネガティブ無効」を意味する正規値
    assert is_hr_negative_interactive(1.0) is False


def test_negative_is_interactive_above_one():
    # 本体 modules/ui.py:62 の use_cfg と同じ判定
    assert is_hr_negative_interactive(6.0) is True


def test_negative_is_not_interactive_below_one():
    # 0.5 等はセンチネルではないため本体と同じく無効扱いにする
    assert is_hr_negative_interactive(0.5) is False
```

- [ ] **Step 2: テストを実行して失敗を確認**

Bash ツールから実行（リポジトリルート）:

```bash
PYTHONIOENCODING=utf-8 python tests/test_hr_cfg_inherit.py
```

Expected: FAIL — `ImportError: cannot import name 'is_hr_negative_interactive'`

- [ ] **Step 3: 最小の実装を書く**

`scripts/hr_cfg_inherit.py` の末尾に追加する:

```python
def is_hr_negative_interactive(hr_cfg):
    """Hires negative prompt 欄を編集可能にすべきかを返す

    本体 modules/ui.py:62 の use_cfg は `hr_cfg > 1.0` で判定するが、
    センチネル値 0 は継承後に本体 CFG Scale へ展開されて negative が効くため、
    グレーアウトさせると表示と実挙動が食い違う。0 を編集可能側に加える。

    Args:
        hr_cfg: 現在の Hires CFG Scale

    Returns:
        編集可能にすべきなら True
    """
    return hr_cfg == 0 or hr_cfg > 1.0
```

- [ ] **Step 4: テストを実行して成功を確認**

```bash
PYTHONIOENCODING=utf-8 python tests/test_hr_cfg_inherit.py
```

Expected: PASS（全テスト。既存の `resolve_hr_cfg` のテストも含めて緑）

- [ ] **Step 5: `scripts/hr_cfg_ui.py` に `use_cfg` の差し替えを実装**

先頭の import 群を次に差し替える:

```python
import gradio as gr

from modules import script_callbacks, shared

from scripts.hr_cfg_inherit import is_hr_negative_interactive
```

`RELAXED_MINIMUM` の定義の下に定数を追加する:

```python
# 差し替え対象の本体側の関数名（本体 modules/ui.py:61）
TARGET_FN_NAME = 'use_cfg'
```

ファイル末尾（`script_callbacks.on_after_component(...)` の行の**前**）に追加する:

```python
def _use_cfg_with_sentinel(val):
    """本体 use_cfg の差し替え。センチネル値 0 も編集可能として扱う"""
    if val is None:
        return gr.skip()

    return gr.update(interactive=is_hr_negative_interactive(val))


def _patch_use_cfg():
    """create_ui の直前に modules.ui.use_cfg を差し替える

    Hires CFG Scale が 0 のとき本体は Hires negative prompt をグレーアウトするが、
    継承後は negative が効くため表示と実挙動が食い違う。差し替え対象が見つからない
    ときは何もせず警告する（本体の実装が変わった場合に黙って壊れるのを避けるため）。

    同じ use_cfg は本体 CFG Scale 側（modules/ui.py:244, 642）にも使われるが、
    そちらのスライダーは下限 1.0 で 0 に到達しないため挙動は変わらない。
    """
    # 循環インポートを避けるためコールバック内で import する
    from modules import ui

    current = getattr(ui, TARGET_FN_NAME, None)
    if not callable(current):
        print('[Easy Template Selector] Hires negative prompt の制御関数'
              f' ({TARGET_FN_NAME}) が見つからないため差し替えを見送りました')
        return

    if current is _use_cfg_with_sentinel:
        return

    setattr(ui, TARGET_FN_NAME, _use_cfg_with_sentinel)


script_callbacks.on_before_ui(_patch_use_cfg)
```

- [ ] **Step 6: 構文チェック**

```bash
PYTHONIOENCODING=utf-8 python -c "import ast; ast.parse(open('scripts/hr_cfg_ui.py',encoding='utf-8').read())"
```

Expected: 何も出力されず終了コード 0。

- [ ] **Step 7: WebUI で手動確認**

1. WebUI を**再起動**する
2. 起動ログに `[Easy Template Selector] Hires negative prompt の制御関数` の警告が出ていないことを確認する（出ていたら本体の実装が変わっている。停止して報告すること）
3. txt2img → Hires.fix を開き、`Hires CFG Scale` に `0` を入力する
   - Expected: `Hires negative prompt` 欄が**編集可能なまま**（グレーアウトしない）
4. `Hires CFG Scale` に `1` を入力する
   - Expected: `Hires negative prompt` 欄がグレーアウトする（本体どおりの挙動）
5. `Hires CFG Scale` に `6` を入力する
   - Expected: `Hires negative prompt` 欄が再び編集可能になる
6. **本体 CFG Scale 側の退行確認**: txt2img の `CFG Scale` を `1` にする
   - Expected: 上部のネガティブプロンプト欄がグレーアウトする（本体 `modules/ui.py:244` の挙動が壊れていない）
7. `CFG Scale` を `6` に戻す
   - Expected: ネガティブプロンプト欄が編集可能に戻る
8. img2img タブでも手順 6-7 を行う（本体 `modules/ui.py:642`）
9. UI の Reload UI を実行し、手順 3 をもう一度行う
   - Expected: 差し替えが維持されている
10. Task 1 の手動確認（Step 3 の全項目）を再実行し、退行が無いことを確認する

- [ ] **Step 8: `CLAUDE.md` に追記**

Task 1 の Step 5 で書き換えた箇所の直後に、以下を追加する:

```
- 本体は `Hires CFG Scale > 1.0` のときだけ `Hires negative prompt` を編集可能にする（本体 `modules/ui.py:61` の `use_cfg`）。0 は継承後に negative が効くため、`scripts/hr_cfg_ui.py` が `on_before_ui` で `modules.ui.use_cfg` を差し替え、0 も編集可能側に含めている（`create_ui()` の実行中に `fn=use_cfg` が評価されるので、その前に差し替える）。同じ関数は本体 `CFG Scale` 側（`modules/ui.py:244, 642`）にも使われるが、そちらの下限は 1.0 で 0 に到達しないため挙動は変わらない
```

- [ ] **Step 9: コミット**

```bash
git add scripts/hr_cfg_inherit.py scripts/hr_cfg_ui.py tests/test_hr_cfg_inherit.py CLAUDE.md
git commit -m "feat(hires): Hires CFG Scale が 0 のとき Hires negative prompt を編集可能に保つ"
```

---

## 影響範囲とリスク

- **本体の更新で壊れうる箇所**: `elem_id="txt2img_hr_cfg"`（Task 1）と `modules.ui.use_cfg` という名前（Task 2）。前者が変われば下限緩和が静かに効かなくなる（従来挙動に戻るだけで生成結果は壊れない）。後者が変われば警告ログを出して差し替えを見送る。
- **`ui_loadsave` との関係**: `ui-config.json` の `minimum` は常に本体側の値（1.0）のまま維持され、拡張はその後に上書きするだけ。拡張を削除すれば完全に元の挙動へ戻る。
- **他拡張との競合**: 同じスライダーの `minimum` を触る拡張は把握していない。`on_app_started` は登録順に全て呼ばれるため後勝ちになる。
- **API 経由の生成**: `Slider.minimum` は API のスキーマ説明文に現れるだけでバリデーションはしないため、API 利用側への影響は無い。
- **`--nowebui` 起動**: `app_started_callback(None, app)`（本体 `webui.py:62`）が呼ばれるが、`_hr_cfg_component` が None のため `_apply_minimum()` は何もせず抜ける。
- **`hires_fix_show_prompts` が OFF の場合**: `hr_negative_prompt` は生成されるが非表示になるだけで、Task 2 の差し替えは無害。
- **軽微な表示不一致**: `hr_cfg == 0` かつ `cfg_scale == 0` のとき、`resolve_hr_cfg()` は継承しないが negative prompt 欄は編集可能表示になる。ただし本体 `cfg_scale` の下限は 1.0 なので通常は到達しない。

## ロールバック

いずれのタスクも独立して `git revert` 可能。`scripts/hr_cfg_ui.py` を削除すれば本体の挙動に完全に戻る（`ui-config.json` は汚染されないため後始末は不要）。`scripts/hr_cfg_inherit.py` の `resolve_hr_cfg` による生成時の継承はそのまま残る。

## レビュー却下メモ

- `demo.fns` を走査して `BlockFunction.fn` を差し替える案 — `on_before_ui` での `modules.ui.use_cfg` 差し替えで同じ目的を達成でき、Gradio の非公開属性（`_id`）に依存しないため不採用（レビューでも同案が推奨された）
