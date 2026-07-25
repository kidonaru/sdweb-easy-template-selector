# Hires upscaler 名の reForge / Forge Neo 両対応 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** テンプレートの `Hires upscaler` 値を、保存時は常にモデルファイルの stem に正規化し、読み込み時は実行中の WebUI（reForge / Forge Neo）で有効な表示名へ解決することで、同じテンプレートファイルを両環境で使えるようにする。

**Architecture:** WebUI に依存しない純粋モジュール `scripts/upscaler_aliases.py` に変換テーブルと 2 方向の変換関数を置き、`scripts/setup.py` の既存 2 エンドポイント（`GET /easy-template/templates` と `POST /easy-template/save-template`）から呼び出す。JavaScript 側は無改修。

**Tech Stack:** Python 3（標準ライブラリ `re` のみ）、FastAPI（既存エンドポイント）、Stable Diffusion WebUI Forge Neo / reForge の `modules.shared`

## Global Constraints

- 正規形は**モデルファイルの stem**（拡張子を除いたファイル名）。例: `RealESRGAN_x4plus_anime_6B`
- 変換対象は `Hires upscaler` キーのみ。他の infotext キーには触れない
- `scripts/upscaler_aliases.py` は WebUI に依存しない（`modules.*` を import しない）。素の Python で import・実行できること
- 変換テーブルには **reForge / A1111 側にだけ存在する別名**のみを載せる。実機で確認していない別名は載せない（誤変換は素通しより状況が悪い）
- 変換に失敗しても例外を上位へ伝播させない。警告を `[easy-template]` プレフィックス付きで print し、元の内容をそのまま扱う
- `templates/*.txt` は全ファイル CRLF 管理。`core.autocrlf=true` のため改行だけの変化は `git diff` に現れず検証をすり抜ける。テンプレートを書き換える処理は必ず `newline=''` で読み書きし、**検証も `git diff` に頼らずバイト単位で行う**
- コードのコメントとエラーログメッセージは日本語で書く
- コミットメッセージは Conventional Commits 形式の日本語

---

### Task 1: 変換モジュール `scripts/upscaler_aliases.py`

**Files:**
- Create: `scripts/upscaler_aliases.py`
- Create: `tests/test_upscaler_aliases.py`

**Interfaces:**
- Consumes: なし（標準ライブラリのみ）
- Produces:
  - `UPSCALER_ALIASES: dict[str, str]` — 正規形 stem → reForge / A1111 での表示名
  - `to_canonical(value: str) -> str` — 別名なら正規形へ、未知の値はそのまま
  - `candidates_for(value: str) -> list[str]` — 値が属するグループ（正規形 + 別名）。表に無ければ `[value]`
  - `to_storage(text: str) -> str` — テキスト中の `Hires upscaler` の値を正規形へ
  - `to_display(text: str, available_names) -> tuple[str, list[str]]` — テキスト中の `Hires upscaler` の値を `available_names` に含まれる名前へ解決し、`(変換後テキスト, 解決できなかった値のリスト)` を返す

**背景メモ（実装者向け）:** Forge Neo の `modules/esrgan_model.py` は `modelloader.friendly_name(file)`（= ファイル名 stem）をそのまま upscaler の表示名にしており、reForge / A1111 が持つ組み込みの pretty name を一切持たない。つまり `UPSCALER_ALIASES` は「reForge / A1111 にだけ存在する別名」の一覧になる。ユーザーが自分で `models/ESRGAN/` 等に置いたモデル（`4x_foolhardy_Remacri` など）は両環境ともファイル名 stem が表示名になるため、表に載せる必要はない。

`to_display()` が警告を print せず未解決値を返す設計にしているのは、`GET /easy-template/templates` が UI 初期化時と保存後の `reinit()` の両方で全テンプレートを処理するため。ファイル単位で print するとコンソールが流れる。集約と出力は Task 2 で呼び出し側が行う。

- [ ] **Step 1: 失敗するテストを書く**

`tests/test_upscaler_aliases.py` を新規作成する。

```python
"""scripts/upscaler_aliases.py の単体テスト

対象モジュールは WebUI に依存しないため、リポジトリルートから素の Python で実行できる。

    python tests/test_upscaler_aliases.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.upscaler_aliases import to_display, to_storage

# Forge Neo のドロップダウンに並ぶ名前（ファイル名 stem がそのまま表示名になる）
NEO_NAMES = ['Latent', 'RealESRGAN_x4plus_anime_6B', '4x_foolhardy_Remacri']
# reForge のドロップダウンに並ぶ名前（組み込みモデルだけ固有の表示名を持つ）
REFORGE_NAMES = ['Latent', 'R-ESRGAN 4x+ Anime6B', '4x_foolhardy_Remacri']


def test_to_storage_rewrites_alias_to_stem():
    text = 'Steps: 20, Hires upscaler: R-ESRGAN 4x+ Anime6B, Denoising strength: 0.5'
    expected = 'Steps: 20, Hires upscaler: RealESRGAN_x4plus_anime_6B, Denoising strength: 0.5'
    assert to_storage(text) == expected


def test_to_storage_keeps_user_model():
    text = 'Hires upscaler: 4x_foolhardy_Remacri, Steps: 20'
    assert to_storage(text) == text


def test_to_storage_preserves_crlf_at_line_end():
    # 値が行末（末尾カンマ無し）に来ても CRLF を LF へ壊さない
    text = 'Steps: 20\r\nHires upscaler: R-ESRGAN 4x+ Anime6B\r\n'
    expected = 'Steps: 20\r\nHires upscaler: RealESRGAN_x4plus_anime_6B\r\n'
    assert to_storage(text) == expected


def test_to_storage_touches_only_the_value():
    text = (
        'a girl, masterpiece\r\n'
        'Negative prompt: worst quality\r\n'
        'Steps: 20, Hires upscaler: R-ESRGAN 4x+ Anime6B, Model: foo\r\n'
    )
    expected = (
        'a girl, masterpiece\r\n'
        'Negative prompt: worst quality\r\n'
        'Steps: 20, Hires upscaler: RealESRGAN_x4plus_anime_6B, Model: foo\r\n'
    )
    assert to_storage(text) == expected


def test_to_display_resolves_stem_to_reforge_name():
    text = 'Hires upscaler: RealESRGAN_x4plus_anime_6B, Steps: 20'
    converted, unresolved = to_display(text, REFORGE_NAMES)
    assert converted == 'Hires upscaler: R-ESRGAN 4x+ Anime6B, Steps: 20'
    assert unresolved == []


def test_to_display_is_identity_on_neo():
    text = 'Hires upscaler: RealESRGAN_x4plus_anime_6B, Steps: 20'
    converted, unresolved = to_display(text, NEO_NAMES)
    assert converted == text
    assert unresolved == []


def test_to_display_resolves_alias_to_stem_on_neo():
    text = 'Hires upscaler: R-ESRGAN 4x+ Anime6B, Steps: 20'
    converted, unresolved = to_display(text, NEO_NAMES)
    assert converted == 'Hires upscaler: RealESRGAN_x4plus_anime_6B, Steps: 20'
    assert unresolved == []


def test_to_display_reports_unresolved_value():
    text = 'Hires upscaler: 4x_NMKD_Superscale, Steps: 20'
    converted, unresolved = to_display(text, NEO_NAMES)
    assert converted == text
    assert unresolved == ['4x_NMKD_Superscale']


def test_to_display_passes_through_when_names_unavailable():
    text = 'Hires upscaler: R-ESRGAN 4x+ Anime6B, Steps: 20'
    converted, unresolved = to_display(text, [])
    assert converted == text
    assert unresolved == []


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

- [ ] **Step 2: テストを実行して失敗を確認する**

リポジトリルートで実行する。

```bash
PYTHONIOENCODING=utf-8 python tests/test_upscaler_aliases.py
```

Expected: `ModuleNotFoundError: No module named 'scripts.upscaler_aliases'` で異常終了する。

- [ ] **Step 3: `scripts/upscaler_aliases.py` を実装する**

```python
# Hires upscaler 名の環境差を吸収する変換テーブルとヘルパー
#
# 同じモデルでも reForge / A1111 は組み込みの表示名を持つが、Forge Neo は
# ファイル名の stem をそのまま表示名にする。テンプレート上はファイル名の
# stem を正規形とし、読み込み時に実行環境の表示名へ解決する。
#
# WebUI に依存しない純粋なモジュールに保つこと（単体で import して検証するため）。
import re

# 正規形（モデルファイルの stem） -> reForge / A1111 での表示名
#
# 出典は A1111 の modules/realesrgan_model.py の get_realesrgan_models()。
# 同関数が RealESRGAN 系の各モデルに固有の表示名を割り当てており、reForge も
# これを引き継いでいる。Forge Neo にはこの割り当てが無く stem がそのまま
# 表示名になる。
#
# ここに載せるのは reForge / A1111 側にだけ存在する別名に限る。ユーザーが
# 自分で導入したモデルは両環境とも stem が表示名になるため記載不要。
# 実機で確認していない別名は載せないこと（誤変換は素通しより状況が悪い）。
# SwinIR / ScuNET / DAT 系は表示名が未確認のため対象外。
UPSCALER_ALIASES = {
    'RealESRGAN_x4plus': 'R-ESRGAN 4x+',
    'RealESRGAN_x4plus_anime_6B': 'R-ESRGAN 4x+ Anime6B',
    'RealESRGAN_x2plus': 'R-ESRGAN 2x+',
    'realesr-general-x4v3': 'R-ESRGAN General 4xV3',
    'realesr-general-wdn-x4v3': 'R-ESRGAN General WDN 4xV3',
    'realesr-animevideov3': 'R-ESRGAN AnimeVideo',
}

# 別名 -> 正規形の逆引き
_ALIAS_TO_CANONICAL = {alias: canonical for canonical, alias in UPSCALER_ALIASES.items()}

# パラメータ行の "Hires upscaler: <値>" を捉える。
# 値から \r を除外するのは、CRLF 改行のテンプレで値が行末（末尾カンマ無し）に
# 来たときに CRLF を LF へ壊さないため。キーと値の間を [ \t]* に限定するのは、
# \s* だと改行を跨いで次の行を値として拾いうるため。
_UPSCALER_PATTERN = re.compile(r'(Hires upscaler:[ \t]*)([^,\r\n]+)')


def to_canonical(value):
    """別名なら正規形（stem）へ、表に無ければそのまま返す"""
    return _ALIAS_TO_CANONICAL.get(value, value)


def candidates_for(value):
    """value が属するグループ（正規形 + 別名）を返す。表に無ければ [value]"""
    canonical = to_canonical(value)
    alias = UPSCALER_ALIASES.get(canonical)
    if alias is None:
        return [value]
    return [canonical, alias]


def _replace(text, resolver):
    """Hires upscaler の値だけを resolver の戻り値で置換する

    ファイル全文を対象にする。プロンプト本文に "Hires upscaler:" が現れることは
    実質無いため、パラメータ行を判別するロジックは持たない。
    """
    return _UPSCALER_PATTERN.sub(
        lambda match: match.group(1) + resolver(match.group(2).strip()),
        text,
    )


def to_storage(text):
    """保存用: Hires upscaler を常に正規形（stem）にする。実行環境に依存しない"""
    return _replace(text, to_canonical)


def to_display(text, available_names):
    """読み込み用: Hires upscaler を実行環境で選択できる名前に解決する

    戻り値は (変換後テキスト, 解決できなかった値のリスト)。
    警告の出力は呼び出し側に任せる。1 リクエストで全テンプレートを処理するため、
    ここで print するとコンソールが流れるため。

    available_names が空のときは解決材料が無いので素通しする。
    """
    if not available_names:
        return text, []

    available = set(available_names)
    unresolved = []

    def resolve(value):
        if value in available:
            return value
        for candidate in candidates_for(value):
            if candidate in available:
                return candidate
        unresolved.append(value)
        return value

    return _replace(text, resolve), unresolved
```

- [ ] **Step 4: テストを実行して全て通ることを確認する**

```bash
PYTHONIOENCODING=utf-8 python tests/test_upscaler_aliases.py
```

Expected: 全 9 件が `PASS`、末尾に `0 failed`、終了コード 0。

- [ ] **Step 5: コミット**

```bash
git add scripts/upscaler_aliases.py tests/test_upscaler_aliases.py
git commit -m "feat(upscaler): Hires upscaler 名の変換テーブルとヘルパーを追加"
```

---

### Task 2: `scripts/setup.py` のエンドポイントに変換を組み込む

**Files:**
- Modify: `scripts/setup.py:1-7`（import 追加）
- Modify: `scripts/setup.py:37-38` の直後（`available_upscaler_names()` 追加）
- Modify: `scripts/setup.py:52-74`（`get_templates()` に読み込み時変換）
- Modify: `scripts/setup.py:114-138`（`save_template()` に保存時変換）

**Interfaces:**
- Consumes: Task 1 の `to_display(text, available_names) -> tuple[str, list[str]]`、`to_storage(text) -> str`
- Produces: `available_upscaler_names() -> list[str]`（同モジュール内でのみ使用）

**背景メモ（実装者向け）:** Forge Neo では Hires のドロップダウン選択肢は `modules/ui.py:254` で `[*shared.latent_upscale_modes, *[x.name for x in shared.sd_upscalers]]` として構築されている。`shared.latent_upscale_modes` は dict なので `list()` するとキー（`Latent`、`Latent (nearest)` など）が得られる。

- [ ] **Step 1: import を追加する**

`scripts/setup.py` の 7 行目 `from modules import scripts, script_callbacks, shared` の直後に追記する。

```python
from scripts.upscaler_aliases import to_display, to_storage
```

（WebUI の script ローダーが拡張のルートを `sys.path` に追加するため `scripts.xxx` 形式で import できる。既存の `scripts/easy_prompt_selector.py` も `from scripts.setup import load_tags, get_tags` としている。）

- [ ] **Step 2: `available_upscaler_names()` を追加する**

`scripts/setup.py` の `def get_tags():` 定義の直後、`class EasyTemplateError` の直前に追記する。

```python
def available_upscaler_names():
    """現在の環境で Hires upscaler として選択できる名前の一覧

    取得に失敗しても致命的ではないため例外は投げず、取れた分だけ返す
    （両方失敗すれば空リストになり、呼び出し側は変換をスキップする）。
    片方の失敗でもう片方を巻き添えにしないよう個別に握る。
    """
    names = []
    try:
        names += list(shared.latent_upscale_modes)
    except Exception as e:
        print(f'[easy-template] latent upscale モードの取得に失敗しました: {e}')
    try:
        names += [x.name for x in shared.sd_upscalers]
    except Exception as e:
        print(f'[easy-template] upscaler 一覧の取得に失敗しました: {e}')
    return names
```

- [ ] **Step 3: `get_templates()` に読み込み時変換を入れる**

`scripts/setup.py` の `get_templates()` を 3 箇所書き換える。

変更前:

```python
            templates = {}
            for filepath in template_files():
```

変更後:

```python
            templates = {}
            upscaler_names = available_upscaler_names()
            unresolved_upscalers = set()
            for filepath in template_files():
```

変更前:

```python
                # 最後のファイル名でテキストを保存
                with open(filepath, 'r', encoding='utf-8') as f:
                    current[filepath.stem] = f.read()
            
            return templates
```

変更後:

```python
                # 最後のファイル名でテキストを保存
                with open(filepath, 'r', encoding='utf-8') as f:
                    content = f.read()

                try:
                    # Hires upscaler を実行環境で選択できる名前へ解決する
                    content, unresolved = to_display(content, upscaler_names)
                    unresolved_upscalers.update(unresolved)
                except Exception as e:
                    # 変換に失敗してもテンプレ自体は返す（読めなくなるより無変換のほうがマシ）
                    print(f'[easy-template] Hires upscaler の解決に失敗しました ({filepath.name}): {e}')

                current[filepath.stem] = content

            if unresolved_upscalers:
                # 未導入モデルや記述ミスに気付けるよう、リクエストごとに 1 行だけ出す
                names = ', '.join(sorted(unresolved_upscalers))
                print(f'[easy-template] 現在の環境に存在しない Hires upscaler: {names}')

            return templates
```

- [ ] **Step 4: `save_template()` に保存時変換を入れる**

`scripts/setup.py` の `save_template()` 内、パス検証の `except` ブロックの直後（親ディレクトリを作る `try:` の直前）に追記する。

変更前:

```python
        except Exception as e:
            raise EasyTemplateError("無効なテンプレート名です", 400)

        try:
            # 親ディレクトリが存在しない場合は作成
```

変更後:

```python
        except Exception as e:
            raise EasyTemplateError("無効なテンプレート名です", 400)

        try:
            # Hires upscaler は環境非依存の正規形（ファイル名 stem）で保存する
            content = to_storage(content)
        except Exception as e:
            # 変換に失敗しても元の内容で保存する
            print(f'[easy-template] Hires upscaler の正規化に失敗しました: {e}')

        try:
            # 親ディレクトリが存在しない場合は作成
```

- [ ] **Step 5: 構文チェックを実行する**

WebUI を起動せずに検証できる範囲を確認する。

```bash
PYTHONIOENCODING=utf-8 python -c "import ast,sys; [ast.parse(open(p,encoding='utf-8').read(), p) for p in sys.argv[1:]]; print('OK')" scripts/setup.py scripts/upscaler_aliases.py
```

Expected: `OK` と表示され終了コード 0。

- [ ] **Step 6: Task 1 のテストが引き続き通ることを確認する**

```bash
PYTHONIOENCODING=utf-8 python tests/test_upscaler_aliases.py
```

Expected: 全 9 件 `PASS`、`0 failed`。

- [ ] **Step 7: コミット**

```bash
git add scripts/setup.py
git commit -m "feat(template): テンプレの配信時と保存時に Hires upscaler 名を変換する"
```

---

### Task 3: 既存テンプレートを正規形へ焼き直す

**Files:**
- Modify: `templates/01_SFW/アニメのポートレート.txt:37`
- Modify: `templates/02_NSFW/スライム姦.txt:52`
- Modify: `templates/02_NSFW/機雷の拘束.txt:53`
- Modify: `templates/02_NSFW/正常位脚上げ.txt:49`

**Interfaces:**
- Consumes: Task 1 の `to_storage(text) -> str`
- Produces: なし

**背景メモ（実装者向け）:** リポジトリのテンプレートに含まれる `Hires upscaler` の値は `Latent` / `4x_foolhardy_Remacri` / `R-ESRGAN 4x+ Anime6B` の 3 種類のみ。前 2 つは両環境で同名なので変更不要で、`R-ESRGAN 4x+ Anime6B` を含む上記 4 ファイルだけが対象。

`templates/*.txt` は全ファイル CRLF 管理で、`core.autocrlf=true` のため改行コードだけの変化は `git diff` に現れない。Python から書き換えるときは必ず `newline=''` を指定すること（`tools/backfill_template_rng.py` と `tools/_apply_audit_fix.py` が同じ理由で同じ扱いをしている）。

`templates/_test.txt` は git 管理外（untracked）で既に正規形のため書き換え対象にならない。コミット時に混入させないこと。

- [ ] **Step 1: 書き換え前の対象と改行の状態を記録する**

```bash
PYTHONIOENCODING=utf-8 python - <<'PY'
from pathlib import Path
total_crlf = 0
for p in sorted(Path('templates').rglob('*.txt')):
    with open(p, encoding='utf-8', newline='') as f:
        text = f.read()
    total_crlf += text.count('\r\n')
    if 'R-ESRGAN 4x+ Anime6B' in text:
        print('target', p)
print(f'CRLF 合計: {total_crlf}')
PY
```

Expected: 上記 4 ファイルのパスが `target` 付きで出力され、`CRLF 合計: N`（N は実際の値。Step 3 で同じ値になることを確認するので控えておく）。`templates/_test.txt` は既に正規形なので出ない。

- [ ] **Step 2: `to_storage()` を使って書き換える**

変換ロジックを重複させないため、Task 1 のモジュールをそのまま使う。

```bash
PYTHONIOENCODING=utf-8 python - <<'PY'
import sys
from pathlib import Path

sys.path.insert(0, '.')
from scripts.upscaler_aliases import to_storage

changed = 0
for p in sorted(Path('templates').rglob('*.txt')):
    # CRLF を壊さないため newline='' で読み書きする
    with open(p, encoding='utf-8', newline='') as f:
        text = f.read()
    converted = to_storage(text)
    if converted == text:
        continue
    with open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(converted)
    print('updated', p)
    changed += 1
print(f'{changed} files updated')
PY
```

Expected: 4 ファイルが `updated` と表示され、`4 files updated`。

- [ ] **Step 3: 書き換え結果をバイト単位で検証する**

`git diff` は `core.autocrlf=true` により改行コードの変化を隠すため、改行の検証は必ずファイルの中身を直接見る。

```bash
PYTHONIOENCODING=utf-8 python - <<'PY'
from pathlib import Path
total_crlf = 0
bad = []
leftover = []
for p in sorted(Path('templates').rglob('*.txt')):
    with open(p, encoding='utf-8', newline='') as f:
        text = f.read()
    lf = text.count('\n')
    crlf = text.count('\r\n')
    total_crlf += crlf
    if lf != crlf:
        bad.append((p, lf, crlf))
    if 'R-ESRGAN' in text:
        leftover.append(p)
print(f'CRLF 合計: {total_crlf}')
print('改行が CRLF でないファイル:', bad)
print('R-ESRGAN が残っているファイル:', leftover)
PY
```

Expected:
- `CRLF 合計` が Step 1 で控えた値と**完全に一致する**
- `改行が CRLF でないファイル: []`
- `R-ESRGAN が残っているファイル: []`

続けて内容の差分を目視する。

```bash
git diff --stat templates/
```

Expected: 4 ファイルがそれぞれ 1 行の変更として現れる（値の置換のみであることの確認。改行の検証は上のスクリプトが担当する）。

- [ ] **Step 4: テンプレート監査がベースラインから悪化していないことを確認する**

```bash
PYTHONIOENCODING=utf-8 python tools/audit_templates.py
```

Expected: 末尾が `合計: 1 件`。これは `templates/02_NSFW/机上で着崩れた制服と精液.txt:70` のローカル専用タグ由来の既知の残件で、2026-07-25 時点のベースラインと同じ。件数が増えていなければ合格（0 件を目標にしない）。

- [ ] **Step 5: コミット**

untracked の `templates/_test.txt` を巻き込まないよう、追跡済みファイルのみをステージする。

```bash
git add -u templates/
git status --short templates/
git commit -m "fix(template): Hires upscaler を環境非依存の正規形に統一"
```

`git status --short` の出力に `?? templates/_test.txt` が残り、ステージ済み（`M `）が 4 件であることを確認してからコミットする。

---

### Task 4: ドキュメントを更新する

**Files:**
- Modify: `CLAUDE.md`（System Structure / Build & Test / Coding Conventions）

**Interfaces:**
- Consumes: Task 1〜3 の成果
- Produces: なし

- [ ] **Step 1: System Structure に新規ファイルを反映する**

`CLAUDE.md` の System Structure 内、`scripts/` ブロックを次のように更新する。

変更前:

```
├── scripts/
│   ├── easy_prompt_selector.py   # WebUI 拡張エントリ（テンプレート置換・Gradio 連携）
│   ├── settings.py               # 拡張設定
│   └── setup.py                  # タグ読み込み
```

変更後:

```
├── scripts/
│   ├── easy_prompt_selector.py   # WebUI 拡張エントリ（テンプレート置換・Gradio 連携）
│   ├── settings.py               # 拡張設定
│   ├── setup.py                  # タグ読み込み・API エンドポイント
│   └── upscaler_aliases.py       # Hires upscaler 名の環境差の吸収（reForge ↔ Forge Neo）
```

同じブロックの `tools/` 行の直後に `tests/` を追加する。

変更前:

```
├── tools/                        # 検索・監査・変換スクリプト（後述の Tools 参照）
└── style.css                     # UI スタイル
```

変更後:

```
├── tools/                        # 検索・監査・変換スクリプト（後述の Tools 参照）
├── tests/                        # WebUI 非依存モジュールの単体テスト（素の Python で実行）
└── style.css                     # UI スタイル
```

- [ ] **Step 2: Build & Test 節にテストの実行方法を追記する**

`CLAUDE.md` の Build & Test 節の冒頭を次のように更新する。

変更前:

```
ビルド・テスト基盤はない。動作確認は WebUI / reForge 上で行う。
```

変更後:

```
ビルド基盤とテストフレームワークはない。動作確認は基本的に WebUI / reForge 上で行う。

例外として、WebUI に依存しないモジュール（`scripts/upscaler_aliases.py`）だけは `tests/` に単体テストがあり、素の Python で実行できる。新しく WebUI 非依存の純粋モジュールを追加する場合は同じ形式でテストを添える。
```

同節のコードブロックの末尾に次の行を追加する。

```bash
# WebUI 非依存モジュールの単体テスト（リポジトリルートで実行）
PYTHONIOENCODING=utf-8 python tests/test_upscaler_aliases.py
```

- [ ] **Step 3: Hires upscaler の扱いを Coding Conventions に追記する**

`CLAUDE.md` の Coding Conventions 節の末尾に次の 2 項目を追加する。

```
- テンプレート `.txt` の `Hires upscaler` は、モデルファイルの stem（拡張子を除いたファイル名）を正規形として保存する。reForge の組み込み表示名（`R-ESRGAN 4x+ Anime6B` など）で書かない。環境差の吸収は `scripts/upscaler_aliases.py` が行い、`GET /easy-template/templates` の配信時に実行環境の表示名へ解決し、`POST /easy-template/save-template` の保存時に正規形へ戻す
- `UPSCALER_ALIASES` に載せるのは reForge / A1111 側にだけ存在する別名に限る。実機で確認していない別名は追加しない（誤変換は素通しより状況が悪い）
```

- [ ] **Step 4: コミット**

```bash
git add CLAUDE.md
git commit -m "docs: Hires upscaler の正規形と tests/ の追加を CLAUDE.md に反映"
```

---

## 実機での確認（実装完了後）

自動テストで担保できるのは `scripts/upscaler_aliases.py` の変換ロジックまで。以下は WebUI 上で手動確認する。

1. Forge Neo の WebUI を**再起動**する（Python 側の変更は Reload では反映されない）
2. Task 3 で書き換えた 4 テンプレート（`アニメのポートレート` など）を適用し、Hires upscaler のドロップダウンが `RealESRGAN_x4plus_anime_6B` になること
3. 生成時に Override Settings へ upscaler が積まれないこと
4. 同じテンプレートを UI から再保存し、`git diff templates/` に差分が出ないこと。加えて Task 3 Step 3 のスクリプトを再実行し、CRLF 合計が変わっていないこと（保存時変換が Neo 上で恒等であることの確認）
5. コンソールに `[easy-template] 現在の環境に存在しない Hires upscaler:` が出ていないこと。出た場合は列挙された値が未導入モデルか記述ミスかを確認する
6. reForge 側での確認はユーザーが手元で実施する（`R-ESRGAN 4x+ Anime6B` として解決されること、再保存で差分が出ないこと）

## レビュー却下メモ

- **`ScuNET_PSNR` / `SwinIR_4x` / `DAT_x2` 等も表に載せるべき** — 却下。reForge 実機での表示名が未確認で、誤った別名は誤変換を招き素通しより状況が悪い。`ScuNET_PSNR` は当初案から削除し、確認できた時点で追記する方針をコメントと CLAUDE.md に明記した
- **Neo 組み込み `ESRGAN`（`models/ESRGAN/` が空のとき表示名が stem にならない）を表に載せる** — 却下。テンプレートがこの値を持つ実例が無く YAGNI。ただし「Neo の表示名は常に stem」という前提の例外であることは spec に注記した
- **`to_storage` をパラメータ行（`Steps:` で始まる行）に限定する** — 却下。プロンプト本文に `Hires upscaler:` が現れることは実質無く、行判別ロジックを増やす対価に見合わない。判断理由はコードコメントと spec に明記した
- **`Hires upscaler: ,`（値が空）のテストを追加する** — 却下。`[^,\r\n]+` が 1 文字以上を要求するためマッチせず素通しになり、実害が無い
