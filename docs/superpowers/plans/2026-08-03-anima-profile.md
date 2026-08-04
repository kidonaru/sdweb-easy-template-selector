# anima プロファイル対応 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** UI のドロップダウンで illustrious / anima のモデル系統プロファイルを切り替え、タグは共有 + 差分、テンプレートは完全分離で使い分けられるようにする。

**Architecture:** マージ規約（stem 置換 + `_exclude.yml` 除外 + テンプレディレクトリ解決）は WebUI 非依存の新規純粋モジュール `scripts/tag_profiles.py` に一元化する。`setup.py` の API は `?profile=` を受けてマージ済みセットを返し、JS は「もらったセットを描画するだけ」を維持する。サーバー側 `@...@` ランダム展開のため、profile は除外タグと同じ hidden Textbox ブリッジで生成リクエストに同梱する。

**Tech Stack:** Python（素の unittest 風テスト・WebUI 非依存）、Vanilla JS、FastAPI（WebUI 拡張の callback 経由）

## Global Constraints

- コードのコメント・エラーログメッセージは日本語で書く
- `javascript/js-yaml.min.js` は編集しない
- `javascript/` 配下でトップレベルの他ファイルクラス参照禁止（実行時参照のみ可）
- 既存テンプレ（`templates/01_SFW` 等）は移動しない = illustrious 用
- 既定プロファイル名は `illustrious`。プロファイル検出は `tags/` 直下のサブディレクトリから行う（ハードコードしない）
- `templates/*.txt` を書き換えるスクリプトは `newline=''` で読み書き（今回はテンプレ書き換え無し）
- テスト実行はリポジトリルートで `PYTHONIOENCODING=utf-8 python tests/test_xxx.py`（Bash ツールから）
- `audit_templates.py` のベースラインは 1 件。これから増えていないことを確認する
- 実装は本リポジトリのチェックアウト上で直接行う（worktree 禁止。WebUI が実パスを読むため）

---

### Task 1: 純粋モジュール `scripts/tag_profiles.py` + 単体テスト

**Files:**
- Create: `scripts/tag_profiles.py`
- Test: `tests/test_tag_profiles.py`

**Interfaces:**
- Produces（後続タスクが依存する API）:
  - `DEFAULT_PROFILE = 'illustrious'`
  - `list_profiles(tags_dir) -> list[str]` — `[DEFAULT_PROFILE] + sorted(サブディレクトリ名)`
  - `resolve_tag_files(tags_dir, profile) -> dict[str, Path]` — stem → 採用ファイルパス（マージ・除外適用済み、stem 昇順）
  - `template_root(templates_dir, profile) -> Path` — profile のテンプレルート
  - `iter_template_files(templates_dir, profile, profiles) -> list[Path]` — profile 配下の `.txt` 一覧（ソート済み）

- [ ] **Step 1: 失敗するテストを書く**

`tests/test_tag_profiles.py`（既存 `tests/test_exclude_tags.py` と同じ素の Python 形式。`tempfile` でディレクトリツリーを作って検証する）:

```python
#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""tag_profiles の単体テスト。WebUI 非依存で素の Python で実行できる。"""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.tag_profiles import (
    DEFAULT_PROFILE,
    list_profiles,
    resolve_tag_files,
    template_root,
    iter_template_files,
)

failures = []

def check(name, actual, expected):
    if actual != expected:
        failures.append(f"{name}: expected={expected!r} actual={actual!r}")

def make_tree(root):
    """テスト用の tags/ / templates/ ツリーを作る。"""
    tags = Path(root, 'tags')
    (tags / 'anima').mkdir(parents=True)
    (tags / '01_クオリティ.yml').write_text('base', encoding='utf-8')
    (tags / '23_表情.yml').write_text('base', encoding='utf-8')
    (tags / '70_スタイルLoRA.yml').write_text('base', encoding='utf-8')
    (tags / 'anima' / '01_クオリティ.yml').write_text('anima', encoding='utf-8')
    (tags / 'anima' / '_exclude.yml').write_text('- 70_スタイルLoRA\n', encoding='utf-8')
    templates = Path(root, 'templates')
    (templates / '01_SFW').mkdir(parents=True)
    (templates / '01_SFW' / 'a.txt').write_text('x', encoding='utf-8')
    (templates / 'anima' / '01_SFW').mkdir(parents=True)
    (templates / 'anima' / '01_SFW' / 'b.txt').write_text('y', encoding='utf-8')
    return tags, templates

with tempfile.TemporaryDirectory() as root:
    tags_dir, templates_dir = make_tree(root)

    # プロファイル列挙: 既定 + サブディレクトリ
    check('list_profiles', list_profiles(tags_dir), ['illustrious', 'anima'])

    # illustrious はベースのみ
    base = resolve_tag_files(tags_dir, DEFAULT_PROFILE)
    check('base stems', list(base.keys()), ['01_クオリティ', '23_表情', '70_スタイルLoRA'])
    check('base file', base['01_クオリティ'], tags_dir / '01_クオリティ.yml')

    # anima: stem 置換 + _exclude 適用。_exclude.yml 自体はカテゴリに出ない
    anima = resolve_tag_files(tags_dir, 'anima')
    check('anima stems', list(anima.keys()), ['01_クオリティ', '23_表情'])
    check('anima override', anima['01_クオリティ'], tags_dir / 'anima' / '01_クオリティ.yml')

    # 未知プロファイルはベース扱い（起動を止めない）
    check('unknown profile', list(resolve_tag_files(tags_dir, 'なにか').keys()),
          list(base.keys()))

    # テンプレルート解決
    check('root default', template_root(templates_dir, DEFAULT_PROFILE), Path(templates_dir))
    check('root anima', template_root(templates_dir, 'anima'), Path(templates_dir) / 'anima')

    # テンプレ列挙: illustrious はプロファイルディレクトリを除外、anima は配下のみ
    profiles = list_profiles(tags_dir)
    check('templates default',
          iter_template_files(templates_dir, DEFAULT_PROFILE, profiles),
          [Path(templates_dir) / '01_SFW' / 'a.txt'])
    check('templates anima',
          iter_template_files(templates_dir, 'anima', profiles),
          [Path(templates_dir) / 'anima' / '01_SFW' / 'b.txt'])

if failures:
    print('FAIL')
    for f in failures:
        print(' -', f)
    sys.exit(1)
print('OK: test_tag_profiles')
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `PYTHONIOENCODING=utf-8 python tests/test_tag_profiles.py`
Expected: `ModuleNotFoundError`（tag_profiles 未作成）

- [ ] **Step 3: `scripts/tag_profiles.py` を実装**

```python
#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""モデル系統プロファイル（illustrious / anima など）のタグ・テンプレート解決。

WebUI 非依存の純粋モジュール。マージ規約はここに一元化し、
setup.py の API とツール類（audit_templates.py / search_tags.py）の両方から使う。

規約:
- tags/ 直下の *.yml がベース（= 既定プロファイル illustrious のセット）
- tags/<profile>/*.yml は同名 stem のベースを置換する
- tags/<profile>/_exclude.yml（stem のリスト）に載ったカテゴリは除外する
- templates/ 直下が既定プロファイル、templates/<profile>/ が各プロファイルのルート。
  既定プロファイルの列挙時はプロファイル名のサブディレクトリを除外する

落とし穴: プロファイルの検出元は tags/ のサブディレクトリのみ。templates/<profile>/ だけを
作って tags/<profile>/ を作り忘れると、そのテンプレは既定プロファイルのツリーに紛れ込む
（警告は出ない）。プロファイルを増やすときは必ず tags/ 側にディレクトリを作ること。
"""
from pathlib import Path

import yaml

DEFAULT_PROFILE = 'illustrious'

# プロファイル設定ファイル。カテゴリとして配信しない
EXCLUDE_FILE = '_exclude.yml'


def list_profiles(tags_dir):
    """tags_dir 直下のサブディレクトリからプロファイル名を列挙する。先頭は既定プロファイル。"""
    tags_dir = Path(tags_dir)
    names = sorted(p.name for p in tags_dir.iterdir() if p.is_dir())
    return [DEFAULT_PROFILE] + names


def _load_exclude_stems(profile_dir):
    """_exclude.yml から除外カテゴリ stem の集合を読む。無ければ空。壊れていても起動を止めない。"""
    path = profile_dir / EXCLUDE_FILE
    if not path.is_file():
        return set()
    try:
        data = yaml.safe_load(path.read_text(encoding='utf-8'))
    except yaml.YAMLError as e:
        print(f'[easy-template] {path} の読み込みに失敗したため除外リストを無視します: {e}')
        return set()
    if not isinstance(data, list):
        return set()
    return {str(x) for x in data}


def resolve_tag_files(tags_dir, profile):
    """profile のタグセットを stem → ファイルパスで返す（stem 昇順）。

    ベースに tags/<profile>/*.yml を stem 置換で重ね、_exclude.yml 記載分を落とす。
    存在しないプロファイルはベースのみを返す（未知値で起動を止めない）。
    """
    tags_dir = Path(tags_dir)
    files = {p.stem: p for p in tags_dir.glob('*.yml')}

    if profile != DEFAULT_PROFILE:
        profile_dir = tags_dir / profile
        if profile_dir.is_dir():
            for stem in _load_exclude_stems(profile_dir):
                files.pop(stem, None)
            for p in profile_dir.glob('*.yml'):
                if p.name == EXCLUDE_FILE:
                    continue
                files[p.stem] = p

    return {stem: files[stem] for stem in sorted(files)}


def template_root(templates_dir, profile):
    """profile のテンプレートルートディレクトリを返す。"""
    templates_dir = Path(templates_dir)
    if profile == DEFAULT_PROFILE:
        return templates_dir
    return templates_dir / profile


def iter_template_files(templates_dir, profile, profiles):
    """profile 配下の .txt をソート済みリストで返す。

    既定プロファイルでは、他プロファイルのルート（templates/<profile>/）配下を除外する。
    """
    root = template_root(templates_dir, profile)
    if not root.is_dir():
        return []
    results = sorted(root.rglob('*.txt'))
    if profile == DEFAULT_PROFILE:
        exclude_roots = [Path(templates_dir) / name
                         for name in profiles if name != DEFAULT_PROFILE]
        results = [p for p in results
                   if not any(r in p.parents for r in exclude_roots)]
    return results
```

- [ ] **Step 4: テストが通ることを確認**

Run: `PYTHONIOENCODING=utf-8 python tests/test_tag_profiles.py`
Expected: `OK: test_tag_profiles`

- [ ] **Step 5: 既存テストが壊れていないことを確認**

Run: `PYTHONIOENCODING=utf-8 python tests/test_exclude_tags.py && PYTHONIOENCODING=utf-8 python tests/test_upscaler_aliases.py && PYTHONIOENCODING=utf-8 python tests/test_hr_cfg_inherit.py`
Expected: すべて OK

- [ ] **Step 6: コミット**

```bash
git add scripts/tag_profiles.py tests/test_tag_profiles.py
git commit -m "feat(profile): プロファイル解決の純粋モジュールを追加"
```

---

### Task 2: anima プロファイルの初期データ

**Files:**
- Create: `tags/anima/_exclude.yml`

- [ ] **Step 1: `_exclude.yml` を作成**

`tags/anima/_exclude.yml`:

```yaml
# anima プロファイルで除外するカテゴリ（stem）。
# illustrious 用 LoRA は anima モデルでは効かないため丸ごと外す
- 10_キャラ_LoRA
- 10_キャラ_ブルアカ_LoRA
- 13_衣装_LoRA
- 30_ポーズ_LoRA
- 70_スタイルLoRA
- 71_ディテールLoRA
- 72_体LoRA
- 75_その他LoRA
```

差し替え YAML（`01_クオリティ` / `90_モデル` / `96_解像度` / `99_ネガティブ`）の**中身の整備は本計画のスコープ外**（設計書 §5）。ここではディレクトリと除外リストだけ用意する。`templates/anima/` は保存 API が `mkdir(parents=True)` で作るため空ディレクトリのコミットは不要。

**注意（過渡状態）: Task 3 が完了するまで WebUI を再起動・リロードしないこと。** 旧実装の `tag_files()` は `rglob` のため、この時点で再起動すると `_exclude.yml` が `tags['_exclude']` という壊れたカテゴリとして API・UI に漏れる。

- [ ] **Step 2: YAML 構文チェックと gitignore の確認**

Run: `python -c "import yaml, sys; yaml.safe_load(open(sys.argv[1], encoding='utf-8'))" tags/anima/_exclude.yml`
Expected: エラーなし

Run: `cat .gitignore` を確認し、ローカル専用パターンが `tags/*_.yml` / `templates/*_` のようにスラッシュ付き（= ルート直下のみに効く）になっている。`tags/anima/` 配下・将来の `templates/anima/` 配下でもローカル専用ルールが効くよう、両パターンをサブディレクトリにも効く形（`tags/**/*_.yml` / `templates/**/*_` またはスラッシュ無し）へ修正する。

- [ ] **Step 3: コミット**

```bash
git add tags/anima/_exclude.yml
git commit -m "feat(profile): anima プロファイルの除外リストを追加"
```

---

### Task 3: `scripts/setup.py` のプロファイル対応

**Files:**
- Modify: `scripts/setup.py`

**Interfaces:**
- Consumes: Task 1 の `tag_profiles` API 一式
- Produces:
  - `get_tags(profile=DEFAULT_PROFILE) -> dict`（Task 4 が使用。未知 profile はベースへフォールバック）
  - `GET /easy-template/profiles` → `["illustrious", "anima", ...]`（Task 5 の JS が使用）
  - `GET /easy-template/tags?profile=<name>` / `GET /easy-template/templates?profile=<name>`
  - `POST /easy-template/save-template` の body に `profile` キー追加（省略時は既定）

- [ ] **Step 1: タグ読み込みをプロファイル別に変更**

`setup.py` 冒頭の import に追加し、`tag_files()` / `load_tags()` / `get_tags()` を置き換える:

```python
from scripts.tag_profiles import (
    DEFAULT_PROFILE,
    list_profiles,
    resolve_tag_files,
    template_root,
    iter_template_files,
)
```

```python
# プロファイル名 → {stem: パース済み YAML}。load_tags() が構築する
tags = {}

def load_tags():
    global tags
    tags = {}
    for profile in list_profiles(TAGS_DIR):
        profile_tags = {}
        for stem, filepath in resolve_tag_files(TAGS_DIR, profile).items():
            with open(filepath, "r", encoding="utf-8") as file:
                profile_tags[stem] = yaml.safe_load(file)
        tags[profile] = profile_tags
    return tags

def get_tags(profile=DEFAULT_PROFILE):
    # 未知プロファイルはベースへフォールバック（生成を止めない）。
    # `or` で書くと空辞書（全カテゴリ除外）まで巻き込むため None 判定にする
    profile_tags = tags.get(profile)
    if profile_tags is None:
        profile_tags = tags.get(DEFAULT_PROFILE, {})
    return profile_tags
```

既存の `tag_files()` / `template_files()` 関数は削除する（`rglob` はサブディレクトリ導入で stem 衝突するため。呼び出し元は本タスク内ですべて書き換える）。

- [ ] **Step 2: API エンドポイントを profile 対応にする**

`get_templates` / `get_tags` エンドポイントに FastAPI のクエリパラメータを追加:

```python
    @app.get("/easy-template/profiles")
    async def get_profiles():
        return list_profiles(TAGS_DIR)

    @app.get("/easy-template/templates")
    async def get_templates(profile: str = DEFAULT_PROFILE):
        try:
            templates = {}
            upscaler_names = available_upscaler_names()
            unresolved_upscalers = set()
            root = template_root(TEMPLATE_DIR, profile)
            for filepath in iter_template_files(TEMPLATE_DIR, profile, list_profiles(TAGS_DIR)):
                rel_path = filepath.relative_to(root)
                ...  # 以降の階層構築・upscaler 解決は既存コードのまま
```

`/easy-template/tags` も同様に `profile` を受け、`resolve_tag_files(TAGS_DIR, profile)` で列挙する:

```python
    @app.get("/easy-template/tags")
    async def get_tags_api(profile: str = DEFAULT_PROFILE):
        try:
            tags = {}
            for stem, filepath in resolve_tag_files(TAGS_DIR, profile).items():
                with open(filepath, 'r', encoding='utf-8') as f:
                    tags[stem] = f.read()
            return tags
        except Exception as e:
            raise EasyTemplateError(f"タグの取得に失敗しました: {str(e)}")
```

注意: 既存コードではエンドポイント関数名が module 関数 `get_tags` と同名になっている。プロファイル対応で module 関数を残すため、エンドポイント側を `get_tags_api` に改名して衝突を避ける（挙動はパスで決まるので改名の影響なし）。

- [ ] **Step 3: `save_template` を profile 対応にする**

```python
    @app.post("/easy-template/save-template")
    async def save_template(request: dict):
        filename = request.get('templatename')
        content = request.get('content')
        profile = request.get('profile') or DEFAULT_PROFILE

        if not filename or not content:
            raise EasyTemplateError("テンプレート名と内容が必要です", 400)
        if profile not in list_profiles(TAGS_DIR):
            raise EasyTemplateError(f"不明なプロファイルです: {profile}", 400)

        try:
            root = template_root(TEMPLATE_DIR, profile)
            template_path = root.joinpath(filename)
            # 既存のパス検証（TEMPLATE_DIR 内チェック）は root 基準に変更する
```

既存のディレクトリトラバーサル検証・`to_storage` 変換・書き込み処理はそのまま `root` 基準で維持する。

- [ ] **Step 4: 構文チェック**

Run: `python -c "import ast; ast.parse(open('scripts/setup.py', encoding='utf-8').read())"`
Expected: エラーなし（WebUI 依存のため import 実行はできない。実機確認は Task 7）

- [ ] **Step 5: コミット**

```bash
git add scripts/setup.py
git commit -m "feat(profile): API をプロファイル対応にする"
```

---

### Task 4: `scripts/easy_prompt_selector.py` — 生成時の profile 伝搬

**Files:**
- Modify: `scripts/easy_prompt_selector.py`

**Interfaces:**
- Consumes: Task 3 の `get_tags(profile)`、`tag_profiles.DEFAULT_PROFILE`
- Produces: hidden Textbox `easy_template_selector_profile`（Task 5 の JS が書き込む）。`ui()` の戻り値は `[image_info, apply_button, exclude_tags, profile]` の順（`args[3]` = profile）

- [ ] **Step 1: `replace_template` に profile を通す**

```python
from scripts.tag_profiles import DEFAULT_PROFILE
```

```python
def replace_template(prompt, seed = None, profile = DEFAULT_PROFILE):
    random.seed(seed)

    tags = get_tags(profile)
```

呼び出し箇所（`replace_template_tags` 内）:

```python
                replaced = "".join(replace_template(all_prompts[i], seed, profile))
```

`replace_template_tags(self, p, exclude_text='', profile=DEFAULT_PROFILE)` とシグネチャを拡張する。

- [ ] **Step 2: `ui()` に profile ブリッジを追加**

`exclude_tags` の直後に追加し、戻り値の末尾に足す:

```python
        # プロファイル。JS 側のドロップダウンが値を書き込む。
        # サーバー側の @...@ ランダム展開が profile のタグセットを引くために生成リクエストに同梱する
        profile = gr.Textbox("", elem_id='easy_template_selector_profile', interactive=True, visible=False)
```

```python
        return [image_info, apply_button, exclude_tags, profile]
```

- [ ] **Step 3: `process()` で受け取る**

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

- [ ] **Step 4: 構文チェック**

Run: `python -c "import ast; ast.parse(open('scripts/easy_prompt_selector.py', encoding='utf-8').read())"`
Expected: エラーなし

- [ ] **Step 5: コミット**

```bash
git add scripts/easy_prompt_selector.py
git commit -m "feat(profile): 生成時にプロファイルを @ 展開へ伝搬する"
```

---

### Task 5: JS — プロファイルドロップダウンと再構築

**Files:**
- Modify: `javascript/easy_template_selector.js`
- Modify: `javascript/ets_template_manager.js`

**Interfaces:**
- Consumes: `GET /easy-template/profiles`、`?profile=` 付き tags/templates API、hidden Textbox `easy_template_selector_profile`（Task 4）
- Produces: `this.profile`（現在のプロファイル名）、`getProfile` コールバック（templateManager へ配線）

- [ ] **Step 1: 定数と状態を追加**

`EasyTemplateSelector.IDS` に追加:

```javascript
    PROFILE_SELECT: 'easy_template_selector_profile_select',
    // Python 側の hidden Textbox。ドロップダウンとは別物
    PROFILE_BRIDGE: 'easy_template_selector_profile',
```

クラス定数と constructor:

```javascript
  // プロファイルの保存先。除外タグと同じくブラウザに置く
  static PROFILE_STORAGE_KEY = 'easy_template_profile'
  static DEFAULT_PROFILE = 'illustrious'
```

```javascript
    // モデル系統プロファイル。タグ・テンプレの取得と保存先を切り替える
    this.profile = EasyTemplateSelector.loadProfile()
    this.profiles = [EasyTemplateSelector.DEFAULT_PROFILE]
```

`loadProfile()` / `saveProfile(value)` は既存の `loadExcludeTags` / 除外タグの保存（`easy_template_selector.js:725-757` 付近）と同じ形で実装する。`saveProfile` は localStorage への保存と、`PROFILE_BRIDGE` の textarea へ `updateInput()` 付きで書き込む処理の両方を行う:

```javascript
  // プロファイルを localStorage から読む。読めない環境・壊れた値でも動作を止めない
  static loadProfile() {
    try {
      return localStorage.getItem(EasyTemplateSelector.PROFILE_STORAGE_KEY)
        || EasyTemplateSelector.DEFAULT_PROFILE
    } catch (e) {
      return EasyTemplateSelector.DEFAULT_PROFILE
    }
  }

  // プロファイルを保持し、localStorage と Python へ渡す hidden Textbox の両方へ反映する
  setProfile(value) {
    this.profile = value
    try {
      localStorage.setItem(EasyTemplateSelector.PROFILE_STORAGE_KEY, value)
    } catch (e) {
      // localStorage が使えなくてもセッション中の動作は続ける
    }
    this.syncProfileBridge()
  }

  // hidden Textbox へ現在のプロファイルを書き込む（生成リクエストに同梱される）
  syncProfileBridge() {
    const bridge = gradioApp()
      .getElementById(EasyTemplateSelector.IDS.PROFILE_BRIDGE)
      ?.querySelector('textarea, input')
    if (!bridge) return
    bridge.value = this.profile
    updateInput(bridge)
  }
```

注意: 除外タグブリッジ（`easy_template_selector.js:750` 付近）の要素取得方法（`getElementById(...).querySelector(...)` の実装）を確認し、同じ書き方に合わせること。

- [ ] **Step 2: `fetchTags()` を profile 付きにする**

```javascript
      const query = `?profile=${encodeURIComponent(this.profile)}`
      const templateResponse = await fetch('/easy-template/templates' + query);
      ...
      const tagResponse = await fetch('/easy-template/tags' + query);
```

- [ ] **Step 3: `init()` でプロファイル一覧を取得し、ブリッジを初期同期する**

`init()` の `fetchTags()` より前に追加:

```javascript
    // プロファイル一覧。取得に失敗しても既定プロファイルのみで動作を続ける
    try {
      const response = await fetch('/easy-template/profiles')
      if (response.ok) {
        this.profiles = await response.json()
      }
    } catch (e) {
      console.error('プロファイル一覧の取得に失敗しました:', e)
    }
    // localStorage の値がもう存在しないプロファイルなら既定へ戻す
    if (!this.profiles.includes(this.profile)) {
      this.setProfile(EasyTemplateSelector.DEFAULT_PROFILE)
    }
```

`init()` の末尾（`completion.attach()` の後）に、除外タグの初期同期（`easy_template_selector.js:798` 付近）と同じ位置づけで `this.syncProfileBridge()` を呼ぶ。既存の除外タグ初期同期がどこから呼ばれているかを確認し、同じ場所に並べること。

- [ ] **Step 4: ヘッダーにドロップダウンを追加**

`render()` の `if (!container)` ブロック内（`reloadButton` の隣）。既存ビルダーは `ETSElementBuilder.dropDown(id, options, { onChange })`（`ets_element_builder.js:175` 付近、キャメルケース）で、**`options` 引数は本文で使われておらず `<option>` 要素を生成しない**。`updateTagInfo()`（`ets_prompt_editor.js:295` 付近）と同様に、呼び出し側で `<option>` を手動追加する:

```javascript
      // プロファイル切り替え。変更でタグ・テンプレ・補完を作り直す（プロンプト欄は触らない）
      const profileSelect = ETSElementBuilder.dropDown(
        EasyTemplateSelector.IDS.PROFILE_SELECT,
        [],
        {
          onChange: this.guardBatchRunning(async (value) => {
            if (value === this.profile) return
            this.setProfile(value)
            await this.reload()
          })
        }
      )
      // dropDown は option を生成しないため自前で追加する
      this.profiles.forEach((name) => {
        const option = document.createElement('option')
        option.value = name
        option.textContent = name
        profileSelect.appendChild(option)
      })
      profileSelect.value = this.profile
      profileSelect.style.minWidth = '110px'
```

注意: `init()` はプロファイル一覧の取得（Step 3）→ `render()` の順なので、ヘッダー構築時点で `this.profiles` は確定している。

`container.header.appendChild(reloadButton)` の直前に `container.header.appendChild(profileSelect)` を追加する。

注意: ヘッダーは `render()` の `if (!container)` でしか構築されない（CLAUDE.md）。`reload()` はタグを再取得して `render()` を呼び直す既存フロー（`easy_template_selector.js:759`）で、`this.completion.setIndex(...)` の作り直しを含むか確認し、含まれない場合は `reload()` 内に `this.completion.setIndex(new ETSCompletionIndex(this.tags))` を追加する。

- [ ] **Step 5: テンプレ保存に profile を同梱**

`ets_template_manager.js` の constructor に `getProfile` コールバックを追加し（`getTags` と同じ形）、保存 API 呼び出し（`ets_template_manager.js:332` 付近）の body に追加:

```javascript
        body: JSON.stringify({
          templatename: templateName + '.txt',
          content: template,
          profile: this.getProfile ? this.getProfile() : undefined
        })
```

`easy_template_selector.js` の constructor で templateManager 生成時に `getProfile: () => this.profile` を配線する（トップレベル参照禁止ルールに注意。既存の `getTags` の渡し方に合わせる）。

- [ ] **Step 6: JS 単体テストと構文確認**

Run: `node --test`
Expected: 既存テストがすべて PASS

Run: `node --check javascript/easy_template_selector.js && node --check javascript/ets_template_manager.js`
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add javascript/easy_template_selector.js javascript/ets_template_manager.js
git commit -m "feat(profile): プロファイル切り替えドロップダウンを追加"
```

---

### Task 6: ツール類のプロファイル対応

**Files:**
- Modify: `tools/audit_templates.py`
- Modify: `tools/search_tags.py`

**Interfaces:**
- Consumes: Task 1 の `tag_profiles` API（`sys.path` にリポジトリルートを足して import する。tools/ はリポジトリルートで実行する規約）

- [ ] **Step 1: `audit_templates.py` — テンプレの場所から profile を判定して照合**

`load_tags(tags_dir)` を profile 対応にする:

```python
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from scripts.tag_profiles import DEFAULT_PROFILE, list_profiles, resolve_tag_files
```

```python
def load_tags(tags_dir=TAGS_DIR, profile=DEFAULT_PROFILE):
    """profile のマージ済みタグセットを読み込み {(カテゴリ, グループ, ラベル): タグ文字列} を返す。"""
    entries = {}
    for category, path in resolve_tag_files(tags_dir, profile).items():
        with open(path, encoding='utf-8') as fp:
            data = yaml.safe_load(fp) or {}
        if not isinstance(data, dict):
            continue
        for key, value in data.items():
            if isinstance(value, dict):
                for label, tag in value.items():
                    entries[(category, str(key), str(label))] = str(tag).strip()
            elif not isinstance(value, list):
                entries[(category, None, str(key))] = str(value).strip()
    return entries
```

`iter_comments` はテンプレパスも返しているので、`audit()` 側でパスの先頭ディレクトリからプロファイルを判定し、プロファイルごとのタグセットで照合する:

```python
def profile_of(path, templates_dir, profiles):
    """テンプレパスの先頭ディレクトリからプロファイルを判定する。"""
    rel = os.path.relpath(path, templates_dir)
    head = rel.replace(os.sep, '/').split('/')[0]
    return head if head in profiles else DEFAULT_PROFILE


def audit(tags_dir=TAGS_DIR, templates_dir=TEMPLATES_DIR):
    profiles = list_profiles(tags_dir)
    # プロファイルごとのタグセットと逆引き表を遅延構築する
    entries_by_profile = {}
    by_value_by_profile = {}

    def tables(profile):
        if profile not in entries_by_profile:
            entries = load_tags(tags_dir, profile)
            by_value = collections.defaultdict(list)
            for key, value in entries.items():
                by_value[normalize(value)].append(key)
            entries_by_profile[profile] = entries
            by_value_by_profile[profile] = by_value
        return entries_by_profile[profile], by_value_by_profile[profile]

    findings = []
    for path, lineno, head, label, tag in iter_comments(templates_dir):
        entries, by_value = tables(profile_of(path, templates_dir, profiles))
        # 以降の判定ロジックは既存のまま（entries / by_value の参照先だけ変わる）
```

既存 `audit()` の判定ロジック本体（`GROUP_MISMATCH` / `NOT_FOUND` 分岐、`audit_templates.py:97-116`）は変更しない。

- [ ] **Step 2: 監査を実行してベースライン確認**

Run: `PYTHONIOENCODING=utf-8 python tools/audit_templates.py; echo "exit=$?"`
Expected: `合計: 1 件`（既知の残件のみ。増えていないこと）

- [ ] **Step 3: `search_tags.py` — `--profile` オプション追加**

`load_entries` を profile 対応にする。**エントリの `filename` は常に stem のまま**にする（出力 `# カテゴリ:グループ (ラベル),` はテンプレートへそのまま貼り付けられる形式という本ツールの契約を守るため。`--exclude-category` の stem プレフィックス一致もこれで壊れない）。プロファイルの由来はエントリではなく**結果のグループ見出し**で区別する:

```python
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from scripts.tag_profiles import DEFAULT_PROFILE, list_profiles, resolve_tag_files
```

```python
def load_entry_groups(tags_dir, profile=None):
    """(見出し, エントリリスト) のグループを返す。

    profile 指定時: そのプロファイルのマージ済みセットのみ（見出し None の 1 グループ）。
    未指定時: ベース（見出し None）+ 各プロファイルの差し替え分
    （見出し「プロファイル名」）の全プロファイル横断。
    エントリの filename は常に stem。出力の貼り付け可能な形式を守るため、
    由来の区別は見出し側で行う。
    """
    if not os.path.isdir(tags_dir):
        print(f"エラー: tags ディレクトリが見つかりません: {tags_dir}", file=sys.stderr)
        sys.exit(1)

    def load_files(stem_path_pairs):
        entries = []
        for filename, path in stem_path_pairs:
            # 既存の per-file 読み込み（YAML パース・警告・flatten）を関数化して流用する
            ...
        return entries

    if profile is not None:
        pairs = [(stem, str(path)) for stem, path in resolve_tag_files(tags_dir, profile).items()]
        return [(None, load_files(pairs))]

    groups = [(None, load_files(
        [(stem, str(path)) for stem, path in resolve_tag_files(tags_dir, DEFAULT_PROFILE).items()]))]
    for name in list_profiles(tags_dir):
        if name == DEFAULT_PROFILE:
            continue
        profile_dir = os.path.join(tags_dir, name)
        pairs = []
        for path in sorted(glob.glob(os.path.join(profile_dir, "*.yml"))):
            stem = os.path.splitext(os.path.basename(path))[0]
            if stem.startswith('_'):
                continue
            pairs.append((stem, path))
        if pairs:
            groups.append((name, load_files(pairs)))
    return groups
```

既存の per-file 読み込みループの中身（YAML パース・警告・`flatten`）は `load_files` 内へ関数化して流用し、重複させない。`main()` はグループごとに検索・出力し、見出し付きグループの結果には先頭に区切り行を出す:

```python
    for heading, entries in load_entry_groups(args.tags_dir, args.profile):
        results = search(entries, ...)  # 既存の検索・除外処理をグループ単位で適用
        if not results:
            continue
        if heading is not None:
            print(f"## プロファイル: {heading}（差し替え分）")
        # 以降は既存の結果出力
```

argparse に追加:

```python
    parser.add_argument(
        "--profile",
        help="プロファイル名（例: anima）。指定時はそのプロファイルのマージ済みセットだけを検索する",
    )
```


- [ ] **Step 4: 動作確認**

Run: `PYTHONIOENCODING=utf-8 python tools/search_tags.py "smile" | head -5`
Expected: 従来どおりの出力（ベースのタグがヒット）

Run: `PYTHONIOENCODING=utf-8 python tools/search_tags.py --profile anima "smile" | head -5`
Expected: エラーなく実行できる（anima は共有カテゴリを含むので同様にヒット）

- [ ] **Step 5: コミット**

```bash
git add tools/audit_templates.py tools/search_tags.py
git commit -m "feat(profile): ツール類をプロファイル対応にする"
```

---

### Task 7: 実機確認（WebUI 再起動）

**Files:** なし（動作確認のみ）

- [ ] **Step 1: WebUI を再起動し、以下をユーザーと確認する**

1. ヘッダーにプロファイルドロップダウンが出る（`illustrious` / `anima`）
2. `anima` へ切り替えるとタグタブから LoRA 系カテゴリが消え、テンプレツリーが空（`templates/anima/` 未整備のため）になる。プロンプト欄は変化しない
3. `illustrious` へ戻すと従来どおり全カテゴリ・全テンプレが出る
4. リロード後もドロップダウンの選択が復元される（localStorage）
5. anima 選択中にテンプレ保存すると `templates/anima/` 配下に保存される
6. anima 選択中に `@01_クオリティ@` 入りプロンプトで生成し、（差し替え YAML 整備前なので）ベースのプールから展開されること・エラーが出ないことを確認
7. 補完（行頭 `#`）が anima のカテゴリセットで動く
8. 一括生成モード中はドロップダウンが無視される（`guardBatchRunning`）

- [ ] **Step 2: 問題なければ完了。差し替え YAML（`01_クオリティ` / `90_モデル` / `96_解像度` / `99_ネガティブ`）の中身整備を次タスクとしてユーザーに引き継ぐ**

---

## レビュー却下メモ

- プロファイル切替のたびに `POST /easy-template/reload` で全プロファイル分をディスク再読込するのは無駄（確信度: 低）— 未確認のまま見送り。既存 reload フロー流用の単純さを優先。切替が体感で遅ければ Task 7 で計測して別途最適化する
