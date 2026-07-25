# Hires CFG Scale 継承（reForge 互換）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate 時に `Hires CFG Scale` が 0 なら `CFG Scale` の値を継承させ、reForge 由来のテンプレート／pnginfo を Forge Neo でも正しく生成できるようにする（設定で ON/OFF 可能）。

**Architecture:** 判定ロジックを WebUI 非依存の純粋関数 `scripts/hr_cfg_inherit.py` に切り出し、`scripts/easy_prompt_selector.py` の `Script.process()` から呼んで `p.hr_cfg` を書き換える。`scripts/upscaler_aliases.py` と同じ構成（純粋モジュール＋`tests/` の素の Python テスト）を踏襲する。

**Tech Stack:** Python 3 / Stable Diffusion WebUI Forge Neo の拡張機構（`modules.scripts.Script`, `modules.script_callbacks.on_ui_settings`）

## Global Constraints

- コードのコメントとエラーログメッセージは日本語で記述する。
- ハードコーディングは絶対に必要な場合を除き避ける。
- `javascript/js-yaml.min.js` は編集しない（本計画では触れない）。
- WebUI 非依存の純粋モジュールを追加する場合は `tests/` に同形式の単体テストを添える。
- テストは `PYTHONIOENCODING=utf-8 python tests/<file>.py` をリポジトリルートから Bash ツールで実行する。
- Python 側の変更は WebUI 再起動が必要。

## 背景（実装者向け）

この拡張は元々 reForge 上で使われており、`templates/*.txt` 36 ファイルすべてが `Hires CFG Scale: 0` を持つ。

- **reForge の仕様**: `hr_cfg == 0` は「本体の `CFG Scale` と同じ値を使う」というセンチネル値（`reForge/modules/processing.py:1644-1646` で `self.hr_cfg = self.cfg_scale`）。UI スライダーも `minimum=0.0, value=0.0`。
- **Forge Neo の仕様**: 本家 Forge 由来で、この継承ロジックが存在しない。UI スライダーは `minimum=1.0, maximum=24.0, step=0.5, value=6.0`（`Neo/modules/ui.py:265`）。`hr_cfg` はそのまま `sd_samplers_cfg_denoiser.py:137` の `cond_scale` に渡る。
- **問題**: Gradio 4.40 の Slider は `input` イベントではクランプせず（クランプは `blur` ハンドラのみ）、backend の `Slider.preprocess()` も素通しのため、`ets_template_manager.js` の `applyMeta`（`element.value = 0` + `updateInput()`）で設定した 0 がそのまま `p.hr_cfg` に届く。結果、Neo では Hires パスが CFG=0 で回り、絵が崩れる。

本計画はこれを Generate 時に補正する。テンプレート `.txt` 側は書き換えない（CFG Scale 変更への追従性を保つため、reForge と同じ挙動を維持する）。

設定 `easy_template_inherit_hr_cfg` の既定は `True`。現行の `templates/*.txt` 36 ファイルすべてが 0 依存であり、既定 OFF では全テンプレートが壊れたままになるため。

**意図的に受け入れる非対称**: テンプレート `.txt` には 0（センチネル）が残り、生成画像の infotext には継承後の実値が焼かれる。この差は仕様として許容し、後述の落とし穴として `CLAUDE.md` に記録する。

## File Structure

| ファイル | 責務 |
|---|---|
| `scripts/hr_cfg_inherit.py` （新規） | `hr_cfg` を継承後の値へ解決する純粋関数。WebUI に依存しない |
| `tests/test_hr_cfg_inherit.py` （新規） | 上記の単体テスト |
| `scripts/settings.py` （変更） | ON/OFF 設定 `easy_template_inherit_hr_cfg` の追加 |
| `scripts/easy_prompt_selector.py` （変更） | `Script.process()` から解決関数を呼び `p.hr_cfg` を書き換える |
| `CLAUDE.md` （変更） | System Structure と仕様メモの更新 |

---

### Task 1: 継承ロジックの純粋モジュールとテスト

**Files:**
- Create: `scripts/hr_cfg_inherit.py`
- Test: `tests/test_hr_cfg_inherit.py`

**Interfaces:**
- Consumes: なし
- Produces: `resolve_hr_cfg(enable_hr: bool, hr_cfg: float, cfg_scale: float) -> float | None`
  - 戻り値が `None` のときは「変更不要」を意味する。呼び出し側は `p.hr_cfg` を触らない。
  - 戻り値が `float` のときは、その値を `p.hr_cfg` に代入する。

- [ ] **Step 1: 失敗するテストを書く**

`tests/test_hr_cfg_inherit.py` を新規作成する。

```python
"""scripts/hr_cfg_inherit.py の単体テスト

対象モジュールは WebUI に依存しないため、リポジトリルートから素の Python で実行できる。

    python tests/test_hr_cfg_inherit.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.hr_cfg_inherit import resolve_hr_cfg


def test_zero_inherits_cfg_scale():
    # reForge の 0 = 「CFG Scale と同じ値」を展開する
    assert resolve_hr_cfg(True, 0.0, 5.5) == 5.5


def test_result_is_always_float():
    # infotext の表記を安定させるため int 入力でも float を返す
    resolved = resolve_hr_cfg(True, 0, 6)
    assert resolved == 6.0
    assert isinstance(resolved, float)


def test_cfg_scale_one_is_inherited_as_is():
    # 継承結果が 1.0 になると Neo 側で Hires のネガティブが無効になる（processing.py:1604）。
    # reForge も同じ値を代入するため、ここで特別扱いはしない
    assert resolve_hr_cfg(True, 0.0, 1.0) == 1.0


def test_fraction_below_one_is_left_untouched():
    # reForge は step 0.1 / 下限 0 のため 0.5 等が存在しうる。0 以外は明示指定として素通しする
    assert resolve_hr_cfg(True, 0.5, 5.0) is None


def test_nonzero_is_left_untouched():
    # 明示指定された値には手を出さない
    assert resolve_hr_cfg(True, 7.0, 5.0) is None


def test_one_is_left_untouched():
    # 1.0 は Forge Neo で「ネガティブ無効」を意味する正規の値
    assert resolve_hr_cfg(True, 1.0, 5.0) is None


def test_hires_disabled_is_left_untouched():
    # Hires.fix が無効なら hr_cfg は使われないので触らない
    assert resolve_hr_cfg(False, 0.0, 5.0) is None


def test_zero_cfg_scale_is_left_untouched():
    # 継承先が 0 では意味がないので変更しない（reForge の uncond スキップ相当は Neo に無い）
    assert resolve_hr_cfg(True, 0.0, 0.0) is None


def test_negative_hr_cfg_is_left_untouched():
    # 負値は reForge 固有の uncond スキップ指定。Neo では扱えないため素通しする
    assert resolve_hr_cfg(True, -1.0, 5.0) is None


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

- [ ] **Step 2: テストを実行して失敗することを確認する**

Bash ツールでリポジトリルートから実行:

```bash
PYTHONIOENCODING=utf-8 python tests/test_hr_cfg_inherit.py
```

期待: `ModuleNotFoundError: No module named 'scripts.hr_cfg_inherit'` で落ちる。

- [ ] **Step 3: 最小の実装を書く**

`scripts/hr_cfg_inherit.py` を新規作成する。

```python
"""Hires CFG Scale の 0 = 「CFG Scale を継承」を解決する

reForge は Hires CFG Scale の 0 を「本体の CFG Scale と同じ値を使う」センチネル値として
扱っていたが、Forge Neo（本家 Forge 由来）にはこの仕様が無く、0 がそのまま CFG 0 として
サンプラーへ渡ってしまう。reForge 時代のテンプレートや pnginfo を Neo で使えるように、
生成直前にこの継承を展開する。

WebUI に依存しないため、tests/test_hr_cfg_inherit.py から素の Python でテストできる。
"""


def resolve_hr_cfg(enable_hr, hr_cfg, cfg_scale):
    """継承後の Hires CFG Scale を返す。変更不要なら None を返す

    Args:
        enable_hr: Hires.fix が有効か
        hr_cfg: 現在の Hires CFG Scale
        cfg_scale: 本体の CFG Scale

    Returns:
        代入すべき値、または変更不要を表す None
    """
    # Hires.fix が無効なら hr_cfg は参照されない
    if not enable_hr:
        return None

    # 0 以外は明示指定（1.0 = ネガティブ無効も含む）なので尊重する
    if hr_cfg != 0:
        return None

    # 継承先が 0 では継承する意味がない
    if cfg_scale == 0:
        return None

    # infotext の表記を安定させるため float に揃える
    return float(cfg_scale)
```

- [ ] **Step 4: テストを実行して通ることを確認する**

```bash
PYTHONIOENCODING=utf-8 python tests/test_hr_cfg_inherit.py
```

期待: 全 9 件 PASS、`0 failed`。

- [ ] **Step 5: コミット**

```bash
git add scripts/hr_cfg_inherit.py tests/test_hr_cfg_inherit.py
git commit -m "feat(hires): Hires CFG Scale の 0 継承を解決する純粋モジュールを追加"
```

---

### Task 2: 設定項目の追加

**Files:**
- Modify: `scripts/settings.py:7`（`easy_template_use_consistent_seed` の直後に 1 行追加）

**Interfaces:**
- Consumes: なし
- Produces: `shared.opts.easy_template_inherit_hr_cfg`（bool、既定 `True`）

- [ ] **Step 1: 設定を追加する**

`scripts/settings.py` の `easy_template_use_consistent_seed` の行の直後に以下を挿入する。

```python
    shared.opts.add_option("easy_template_inherit_hr_cfg", shared.OptionInfo(True, "Hires CFG Scale が 0 のとき CFG Scale を継承する (reForge 互換)", section=("easy_template_selector", "Easy Template Selector")))
```

- [ ] **Step 2: 構文を確認する**

```bash
PYTHONIOENCODING=utf-8 python -c "import ast; ast.parse(open('scripts/settings.py', encoding='utf-8').read()); print('OK')"
```

期待: `OK`

- [ ] **Step 3: コミット**

```bash
git add scripts/settings.py
git commit -m "feat(settings): Hires CFG Scale 継承の ON/OFF 設定を追加"
```

---

### Task 3: Script.process への結線

**Files:**
- Modify: `scripts/easy_prompt_selector.py`（import 部・`Script` クラスへメソッド追加・`process` の変更）

**Interfaces:**
- Consumes: `resolve_hr_cfg(enable_hr, hr_cfg, cfg_scale)`（Task 1）、`shared.opts.easy_template_inherit_hr_cfg`（Task 2）
- Produces: なし

**なぜ `process()` で良いか（実装者向けの根拠）:** Forge Neo の `modules/processing.py` では `p.scripts.process(p)` が 917 行目、`p.setup_conds()`（Hires 用 cond の計算）が 977 行目、`extra_generation_params["Hires CFG Scale"] = self.hr_cfg` が 1448 行目（`sample()` 内）。したがって `process()` で書き換えれば、サンプリングにも pnginfo にも継承後の値が反映される。

- [ ] **Step 1: import を追加する**

`scripts/easy_prompt_selector.py` の 10 行目 `from scripts.setup import load_tags, get_tags` の直後に以下を追加する。

```python
from scripts.hr_cfg_inherit import resolve_hr_cfg
```

- [ ] **Step 2: 継承処理のメソッドを追加する**

`Script` クラスの `save_prompt_to_pnginfo` メソッド（161-165 行目）の直後、`process` の直前に以下を挿入する。

```python
    def inherit_hr_cfg(self, p):
        if not shared.opts.easy_template_inherit_hr_cfg:
            return

        # img2img には hr_cfg / enable_hr が無いため getattr で防御する
        # (本 Script は AlwaysVisible で img2img でも process が走る)
        hr_cfg = getattr(p, 'hr_cfg', None)
        if hr_cfg is None:
            return

        resolved = resolve_hr_cfg(getattr(p, 'enable_hr', False), hr_cfg, p.cfg_scale)
        if resolved is None:
            return

        p.hr_cfg = resolved
        print(f'[easy-template] Hires CFG Scale が 0 のため CFG Scale ({resolved}) を継承しました')
```

- [ ] **Step 3: `process` から呼ぶ**

`process` メソッドを以下に置き換える。

```python
    def process(self, p, *args):
        self.replace_template_tags(p)
        self.inherit_hr_cfg(p)
```

- [ ] **Step 4: 構文を確認する**

```bash
PYTHONIOENCODING=utf-8 python -c "import ast; ast.parse(open('scripts/easy_prompt_selector.py', encoding='utf-8').read()); print('OK')"
```

期待: `OK`

- [ ] **Step 5: 実機で動作確認する（ユーザー依頼）**

WebUI を再起動し、以下を確認する。Python 側の変更なので UI の Reload では反映されない。

1. Settings → Easy Template Selector に「Hires CFG Scale が 0 のとき CFG Scale を継承する (reForge 互換)」が ON で表示される
2. `templates/01_SFW/I Need Buzz.txt`（`CFG Scale: 5`, `Hires CFG Scale: 0`）を適用して Generate する
3. コンソールに `[easy-template] Hires CFG Scale が 0 のため CFG Scale (5.0) を継承しました` が出る
4. 生成画像の infotext（PNG Info タブ）が `Hires CFG Scale: 5.0` になっている（`0` ではない）
5. 設定を OFF にして再度 Generate すると、ログが出ず infotext が `Hires CFG Scale: 0` になる
6. Hires.fix を無効にして Generate してもログが出ず、エラーも出ない
7. img2img タブで Generate してもエラーが出ない
8. テンプレート適用後に `Hires CFG Scale` の数値入力欄をクリックし、そのまま別の場所をクリック（blur）して値が 0 のままか確認する。Gradio 4.40 の Slider は blur でクランプするため、Neo の下限 1.0 に丸められる可能性がある。丸められた場合は 1.0 が「ネガティブ無効」の正規値として素通しされ継承が効かない — この経路はコードでは救えないので、結果を Task 4 Step 2 のドキュメント更新に反映する

- [ ] **Step 6: コミット**

```bash
git add scripts/easy_prompt_selector.py
git commit -m "feat(hires): Generate 時に Hires CFG Scale の 0 を CFG Scale で置き換える"
```

---

### Task 4: ドキュメント更新

**Files:**
- Modify: `CLAUDE.md`（System Structure のツリー、Coding Conventions、Build & Test）

**Interfaces:**
- Consumes: Task 1-3 の成果物
- Produces: なし

- [ ] **Step 1: System Structure のツリーに新規ファイルを追加する**

`scripts/` の項の `└── upscaler_aliases.py` の行の直前に以下を追加する（既存の並び順に合わせる）。

```
│   ├── hr_cfg_inherit.py         # Hires CFG Scale の 0 = CFG Scale 継承の解決（reForge 互換）
```

- [ ] **Step 2: Coding Conventions に仕様メモを追加する**

`UPSCALER_ALIASES` の項目の直後に以下の箇条書きを追加する。

```markdown
- テンプレート `.txt` の `Hires CFG Scale: 0` は reForge 固有の「本体 CFG Scale を継承する」センチネル値。Forge Neo にはこの仕様が無く 0 がそのまま CFG 0 としてサンプラーへ渡るため、`scripts/hr_cfg_inherit.py` が生成直前（`Script.process`）に実値へ展開する。設定 `easy_template_inherit_hr_cfg` で OFF にできる
- テンプレート側の `Hires CFG Scale: 0` は書き換えない。0 のままにしておくことで `CFG Scale` を変えたときに Hires 側も追従する（reForge と同じ挙動）
- 落とし穴: 生成画像の infotext には継承後の実値が焼かれる。**生成画像を PNG Info から txt2img へ送った状態でテンプレを保存すると、`Hires CFG Scale` が 0 ではなく実値で固定される**（センチネルが失われる）。テンプレを作り直すときはテンプレ適用直後の状態から保存すること
- 落とし穴: Forge Neo のスライダー下限は 1.0 で、Gradio 4.40 は blur 時にクランプする。テンプレ適用後に `Hires CFG Scale` 入力欄を触ると 0 が 1.0 に丸められることがある。1.0 は Neo で「Hires のネガティブ無効」を意味する正規値のため継承は発動せず、ログも出ない
```

Task 3 Step 5 の実機確認 8 で blur によるクランプが**発生しなかった**場合は、最後の 1 項目を落とす。

- [ ] **Step 3: Build & Test のテストコマンドを追加する**

`PYTHONIOENCODING=utf-8 python tests/test_upscaler_aliases.py` の行の直後に以下を追加する。

```bash
PYTHONIOENCODING=utf-8 python tests/test_hr_cfg_inherit.py
```

- [ ] **Step 4: コミット**

```bash
git add CLAUDE.md
git commit -m "docs: Hires CFG Scale の 0 継承仕様を CLAUDE.md に追記"
```

---

## 影響範囲

- **変更なし**: `templates/*.txt`、`javascript/` 配下、`tags/`、`tools/`
- **既存挙動への影響**: `Hires CFG Scale` が 0 以外のときは `resolve_hr_cfg` が即 `None` を返すため、従来と完全に同一
- **reForge 上での動作**: 継承が先に走ると reForge 側の `elif self.hr_cfg == 0:` 分岐に入らなくなるが、代入される値は同じ `cfg_scale` なので結果は変わらない

## レビュー却下メモ

- `POST /easy-template/save-template` 側で `Hires CFG Scale == CFG Scale` のとき 0 へ戻す正規化を入れる — 意図して同値を指定したケースを潰す誤変換リスクがあり、`UPSCALER_ALIASES` の「実機で確認していない別名は追加しない（誤変換は素通しより状況が悪い）」という既存方針と衝突する。落とし穴としてドキュメント化する方を採った
- `shared.opts.easy_template_inherit_hr_cfg` を `getattr` で防御的に参照する — 既存の自前オプション参照（`easy_template_remove_blank_line` 等）がすべて直接参照であり非対称になる。また `on_ui_settings` が走らない構成では他のオプションも同時に落ちるため `getattr` では救えない
- XYZ Grid の `Hires CFG Scale` 軸に 0 を指定した場合の挙動を実機確認項目に加える — 0 は Forge Neo では無効値であり、継承で上書きされるのが仕様として正しい。確認コストに見合わない
- 継承ログが生成ごとに毎回出る点の見直し — 全テンプレが 0 依存である以上「毎回発動する」のが正常状態であり、動作していることが分かる方が有用。プレフィックスの `[easy-template]` への統一のみ取り込んだ
