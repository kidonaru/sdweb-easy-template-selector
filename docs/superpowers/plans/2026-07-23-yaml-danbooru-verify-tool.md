# tags/*.yml 一括 Danbooru 実在検証 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `tools/search_danbooru.py` に `--yaml` モードを追加し、`tags/*.yml`（ファイルまたはディレクトリ）を指定するだけで含まれる全タグの Danbooru 実在確認を一括で走らせ、実在しないタグ（誤字・単複違い等）だけをレポートできるようにする。

**Architecture:** 既存の `tools/search_danbooru.py`（Danbooru タグ CSV → SQLite キャッシュ、`query_exact` による完全一致検証）に、YAML パス解決・エントリ読み込み・LoRA エントリのスキップ・タグ抽出・検証・レポート出力の関数群を追加する。YAML のパースは新規実装せず、`tools/search_tags.py` の `flatten()` を import して再利用する。実装に先立ち、既存の `normalize()` にエスケープ括弧（`\(` `\)`）を考慮しないバグが見つかったため、まずそれを修正する（Task 1）。

**Tech Stack:** Python 3 標準ライブラリ + 既存依存の `PyYAML`（`tools/search_tags.py` が既に使用）。新規の pip 依存は追加しない。

## Global Constraints

- 本プロジェクトにビルド・テスト基盤は無い。`docs/superpowers/plans/2026-07-22-tag-search-script.md` および `2026-07-23-danbooru-tag-verify-tool.md` の先例に倣い、`python - <<'PY' ... PY` 形式の assert ベースのスクリプトと、実データに対する手動実行で動作確認する。
- コードのコメントは日本語で記述する（プロジェクト CLAUDE.md 準拠）。
- ハードコーディングを避ける。
- 本プランの検証コマンド（ヒアドキュメント `<<'PY'`、`grep` 等）は POSIX シェル構文のため、Bash ツール経由で実行する（本環境の primary shell である PowerShell では動作が異なる）。
- `tags/` ディレクトリは `.gitignore` 対象で Grep ツールでは検索できないが、本プランのスクリプトは `os`/`glob`/`open()` でファイルシステムから直接読むため影響しない。
- `tags/*.yml` は git 管理外の実データであり、他セッションでの編集により内容が変動し得る。本プランの「実データ検証」ステップの Expected 出力は、本プラン作成時点（2026-07-23）の `tags/10_キャラ_ブルアカ.yml` / `tags/10_キャラ_ブルアカ_LoRA.yml` の内容に基づく。実行時に一致しない場合は、それが妥当な差分（タグの追加・修正）によるものか確認した上で判断してよい。
- `tools/search_danbooru.py` の `normalize()` は、テンプレート内のタグ表記（AUTOMATIC1111 の強調記法と衝突しないよう括弧をエスケープした `mari \(blue archive\)` 形式）を Danbooru タグ名（`mari_(blue_archive)`）と正しく照合できないバグが本プラン作成時の調査で判明した（Task 1 で修正）。このバグは `--yaml` モードの前提となるため必ず先に直す。
- **既知の未対応記法（YAGNI、実データ調査済み）**: `extract_tags` はコロン付き重みラップ `(<内容>:<数値>)` のみを剥がす。以下は本プラン作成時点の `tags/*.yml` 実データ（46ファイル）を全数 grep 調査した結果に基づき、対応しない:
  - 角括弧 `[tag]` / 波括弧 `{tag}` の強調記法: 実データ中に独立した強調記法としての使用は無い（`<lora:Qp Flapper[style]-Illus:1.6>` のように `<lora:...>` のモデルファイル名内にのみ出現し、当該エントリは LoRA エントリとして丸ごとスキップされるため無害）。
  - コロン無し素括弧の複数タググループ（例: `(galaxies in sky, light particles, many shooting starts)`、`tags/50_背景.yml:30`）: 全データ中1件のみの希少ケース。`extract_tags` は通常のカンマ分割時にこれを3つの不整合な括弧付き断片へ分割してしまい、いずれも Danbooru に実在しない文字列として NG 表示される（誤検知）。1件のみのため専用対応は行わず、NG一覧に不自然な括弧付き文字列が出た場合は分割起因の誤検知の可能性を疑う、という運用でカバーする。
  - `<lora:` 以外の LoRA 系ディレクティブ（`<lyco:` `<hypernet:` 等）: 実データ中に使用例は無い（`<lora:` のみ）。`is_lora_entry` は `<lora:` 固定判定のままとする。将来これらが使われた場合はスキップされず偽NGとなり得るが、現状スコープ外とする。

---

## File Structure

- Modify: `tools/search_danbooru.py` — `normalize()` のバグ修正、および `--yaml` モード一式（パス解決・エントリ読み込み・LoRAスキップ・タグ抽出・検証・レポート出力・CLI引数）を追加する。新規ファイルは作らない。

## Task 1: `normalize()` のエスケープ括弧バグを修正する

**Files:**
- Modify: `tools/search_danbooru.py:35-37`

**Interfaces:**
- Consumes: なし
- Produces: `normalize(text) -> str`（既存シグネチャ不変、動作のみ修正。以降の全タスクの検証精度に影響する）

- [ ] **Step 1: `normalize()` を修正する**

現在の関数（`tools/search_danbooru.py:35-37`）:
```python
def normalize(text):
    """検索・照合用に、空白をアンダースコアに、小文字に正規化する。"""
    return "_".join(text.strip().lower().split())
```

以下に置き換える:
```python
def normalize(text):
    """検索・照合用に、エスケープされた括弧 \\( \\) を通常の括弧へ戻した上で、
    空白をアンダースコアに、小文字に正規化する。

    テンプレート内のタグ表記は AUTOMATIC1111 の強調記法と衝突しないよう
    括弧を \\( \\) とエスケープする慣習があるが、Danbooru タグ名自体には
    バックスラッシュを含まないため、照合前に元の括弧へ戻す必要がある
    （例: "mari \\(blue archive\\)" → 照合用には "mari_(blue_archive)"）。
    """
    text = text.replace("\\(", "(").replace("\\)", ")")
    return "_".join(text.strip().lower().split())
```

- [ ] **Step 2: フィクスチャで修正内容と既存挙動の非破壊を確認する**

Run:
```bash
cd "C:/tools/StabilityMatrix/Data/Packages/Stable Diffusion WebUI reForge/extensions/sdweb-easy-template-selector"
python - <<'PY'
import sys
sys.path.insert(0, "tools")
import search_danbooru as sd

# エスケープ括弧が正しく戻ること
assert sd.normalize("mari \\(blue archive\\)") == "mari_(blue_archive)", sd.normalize("mari \\(blue archive\\)")
assert sd.normalize("hina \\(blue archive\\)") == "hina_(blue_archive)", sd.normalize("hina \\(blue archive\\)")

# 既存の非エスケープ挙動は変わらないこと（Task 1 の後方互換確認）
assert sd.normalize("sound effects") == "sound_effects", sd.normalize("sound effects")
assert sd.normalize("1girl") == "1girl", sd.normalize("1girl")
assert sd.normalize("Pastel Colors") == "pastel_colors", sd.normalize("Pastel Colors")

print("OK: normalize escaped-paren fix")
PY
```

Expected（標準出力）:
```
OK: normalize escaped-paren fix
```

- [ ] **Step 3: 実データで修正効果を確認する**

修正前は `mari \(blue archive\)` のような実在するキャラクタータグまで誤って NG 判定されていた（`mari_(blue_archive)` は Danbooru 実データで category=4, post_count=6413）。修正後に正しく OK になることを確認する。

Run:
```bash
python tools/search_danbooru.py --exact "mari \(blue archive\)" "hina \(blue archive\)"
```

Expected（標準出力）:
```
OK 'mari \(blue archive\)': 実在するタグです [character] post_count=6413
OK 'hina \(blue archive\)': 実在するタグです [character] post_count=9755
```

- [ ] **Step 4: コミットする**

```bash
git add tools/search_danbooru.py
git commit -m "fix(tools): search_danbooru.pyのnormalize()がエスケープ括弧タグを誤NG判定する不具合を修正"
```

## Task 2: YAML パス解決・エントリ読み込みを実装する

**Files:**
- Modify: `tools/search_danbooru.py`

**Interfaces:**
- Consumes: `tools/search_tags.py` の `flatten(node, filename, group=None) -> list[tuple[str|None, str, str]]` と `NON_DICT_WARNING_BLACKLIST`（import して利用。既存シグネチャ）
- Produces: `resolve_yaml_paths(paths: list[str]) -> list[str]`、`load_yaml_entries(yaml_paths: list[str]) -> list[tuple[str, str|None, str, str]]`（Task 4 の CLI 統合から利用）

- [ ] **Step 1: import 文を追加する**

現在のインポート（`tools/search_danbooru.py:13-17`）:
```python
import argparse
import csv
import os
import sqlite3
import sys
```

以下に置き換える:
```python
import argparse
import csv
import glob
import os
import sqlite3
import sys

import yaml

import search_tags
```

- [ ] **Step 2: `resolve_yaml_paths` / `load_yaml_entries` を追加する**

`def main():` の直前（`tools/search_danbooru.py` の `print_partial_results` 関数の後）に以下を追加する:

```python
def resolve_yaml_paths(paths):
    """--yaml に渡されたパス群を実際の .yml ファイルパスのリストへ解決する。

    ディレクトリは tools/search_tags.py の load_entries と同じく、直下の
    *.yml を非再帰でグロブする。存在しないパスは警告を出してスキップする。
    ディレクトリ指定と個別ファイル指定が重複した場合（例: --yaml tags/
    tags/10_キャラ.yml）に同一ファイルを二重集計しないよう、実体パス
    （realpath）基準で重複を除去する。
    """
    resolved = []
    seen_real = set()
    for path in paths:
        if os.path.isdir(path):
            candidates = sorted(glob.glob(os.path.join(path, "*.yml")))
        elif os.path.isfile(path):
            candidates = [path]
        else:
            print(f"警告: 指定されたパスが見つかりません: {path}", file=sys.stderr)
            continue
        for candidate in candidates:
            real = os.path.realpath(candidate)
            if real in seen_real:
                continue
            seen_real.add(real)
            resolved.append(candidate)
    return resolved


def load_yaml_entries(yaml_paths):
    """yaml_paths（解決済みファイルパスのリスト）を読み込み、
    (ファイル名, グループ, ラベル, タグ文字列) のリストを返す。

    構文エラー・非辞書ファイルは警告を出してスキップする
    （tools/search_tags.py の load_entries と同じ挙動。パース処理自体は
    search_tags.flatten() を再利用する）。
    """
    entries = []
    for path in yaml_paths:
        filename = os.path.splitext(os.path.basename(path))[0]
        try:
            with open(path, encoding="utf-8") as f:
                data = yaml.safe_load(f)
        except (yaml.YAMLError, OSError, UnicodeDecodeError) as e:
            print(f"警告: {filename}.yml の読み込みに失敗したためスキップします: {e}", file=sys.stderr)
            continue
        if not data:
            continue
        if not isinstance(data, dict):
            if filename not in search_tags.NON_DICT_WARNING_BLACKLIST:
                print(f"警告: {filename}.yml はトップレベルが辞書形式ではないためスキップします", file=sys.stderr)
            continue
        for group, label, tags in search_tags.flatten(data, filename):
            entries.append((filename, group, label, tags))
    return entries
```

- [ ] **Step 3: フィクスチャで動作確認する**

Run:
```bash
cd "C:/tools/StabilityMatrix/Data/Packages/Stable Diffusion WebUI reForge/extensions/sdweb-easy-template-selector"
python - <<'PY'
import os, sys, tempfile
sys.path.insert(0, "tools")
import search_danbooru as sd

with tempfile.TemporaryDirectory() as tmp:
    flat_path = os.path.join(tmp, "flat.yml")
    with open(flat_path, "w", encoding="utf-8") as f:
        f.write("一人の女の子: 1girl\n一人の女の子と男の子: 1girl,1boy\n")

    grouped_path = os.path.join(tmp, "grouped.yml")
    with open(grouped_path, "w", encoding="utf-8") as f:
        f.write("トリニティ:\n  マリー: mari \\(blue archive\\),blue eyes\n")

    # ディレクトリ指定で両方の.ymlを名前順に拾えること
    resolved = sd.resolve_yaml_paths([tmp])
    assert resolved == [flat_path, grouped_path], resolved

    # 存在しないパスは警告してスキップする（例外を投げない）
    resolved_missing = sd.resolve_yaml_paths([os.path.join(tmp, "no_such.yml")])
    assert resolved_missing == [], resolved_missing

    # ファイル直接指定
    resolved_file = sd.resolve_yaml_paths([flat_path])
    assert resolved_file == [flat_path], resolved_file

    # ディレクトリ指定と同一ファイルの個別指定が重複しても二重集計しないこと
    resolved_dup = sd.resolve_yaml_paths([tmp, flat_path])
    assert resolved_dup == [flat_path, grouped_path], resolved_dup

    entries = sd.load_yaml_entries([flat_path, grouped_path])
    assert ("flat", None, "一人の女の子", "1girl") in entries, entries
    assert ("flat", None, "一人の女の子と男の子", "1girl,1boy") in entries, entries
    assert ("grouped", "トリニティ", "マリー", "mari \\(blue archive\\),blue eyes") in entries, entries

print("OK: yaml path resolution/loading")
PY
```

Expected（標準出力）:
```
OK: yaml path resolution/loading
```

- [ ] **Step 4: コミットする**

```bash
git add tools/search_danbooru.py
git commit -m "feat(tools): search_danbooru.pyにYAMLパス解決・エントリ読み込みを追加"
```

## Task 3: LoRA エントリのスキップ判定・タグ抽出を実装する

**Files:**
- Modify: `tools/search_danbooru.py`

**Interfaces:**
- Consumes: なし
- Produces: `is_lora_entry(tags_str: str) -> bool`、`extract_tags(tags_str: str) -> list[str]`（Task 4 の検証処理から利用）

- [ ] **Step 1: `import re` を追加する**

現在のインポート（Task 2 で変更済み）:
```python
import argparse
import csv
import glob
import os
import sqlite3
import sys

import yaml

import search_tags
```

以下に置き換える:
```python
import argparse
import csv
import glob
import os
import re
import sqlite3
import sys

import yaml

import search_tags
```

- [ ] **Step 2: `is_lora_entry` / `extract_tags` を追加する**

`def main():` の直前（Task 2 で追加した `load_yaml_entries` の後）に以下を追加する:

```python
def is_lora_entry(tags_str):
    """タグ文字列に <lora: が含まれるか判定する（LoRAエントリの丸ごとスキップ判定用）。

    <lora:...> の直後に置かれるトリガーワード（例: "zzHina"）は Danbooru タグ
    ではないため、エントリ内の他の実タグと機械的に区別せず丸ごと検証対象外にする。
    """
    return "<lora:" in tags_str


_WEIGHT_WRAPPER_RE = re.compile(r"^\((.*):\d+(?:\.\d+)?\)$")


def extract_tags(tags_str):
    """カンマ区切りのタグ文字列を個別タグのリストへ分解する。

    各トークン全体が (<内容>:<数値>) の重みラップ形式であれば、外側の
    括弧と :<数値> を剥がして <内容> だけを残す（内側のエスケープ括弧は
    タグ名の一部としてそのまま残す）。空トークンは無視する。
    """
    tags = []
    for token in tags_str.split(","):
        token = token.strip()
        if not token:
            continue
        m = _WEIGHT_WRAPPER_RE.match(token)
        if m:
            token = m.group(1).strip()
        if token:
            tags.append(token)
    return tags
```

- [ ] **Step 3: フィクスチャで動作確認する**

Run:
```bash
cd "C:/tools/StabilityMatrix/Data/Packages/Stable Diffusion WebUI reForge/extensions/sdweb-easy-template-selector"
python - <<'PY'
import sys
sys.path.insert(0, "tools")
import search_danbooru as sd

assert sd.is_lora_entry("<lora:HinaBlueArchiveIXL:1.0> zzHina, purple eyes") is True
assert sd.is_lora_entry("mari \\(blue archive\\),blue eyes") is False

assert sd.extract_tags("1girl,1boy") == ["1girl", "1boy"], sd.extract_tags("1girl,1boy")
assert sd.extract_tags("mari \\(blue archive\\),blue eyes") == ["mari \\(blue archive\\)", "blue eyes"], sd.extract_tags("mari \\(blue archive\\),blue eyes")
assert sd.extract_tags("(ibuki \\(blue archive\\):0.7), yellow eyes") == ["ibuki \\(blue archive\\)", "yellow eyes"], sd.extract_tags("(ibuki \\(blue archive\\):0.7), yellow eyes")
assert sd.extract_tags("(masterpiece:1.2)") == ["masterpiece"], sd.extract_tags("(masterpiece:1.2)")
assert sd.extract_tags(" , 1girl ,, ") == ["1girl"], sd.extract_tags(" , 1girl ,, ")

print("OK: lora detection and tag extraction")
PY
```

Expected（標準出力）:
```
OK: lora detection and tag extraction
```

- [ ] **Step 4: コミットする**

```bash
git add tools/search_danbooru.py
git commit -m "feat(tools): search_danbooru.pyにLoRAエントリ判定・タグ抽出を追加"
```

## Task 4: 検証・レポート出力・CLI統合

**Files:**
- Modify: `tools/search_danbooru.py`

**Interfaces:**
- Consumes: Task 1〜3 で追加した `query_exact`（既存）、`resolve_yaml_paths`、`load_yaml_entries`、`is_lora_entry`、`extract_tags`
- Produces: CLI `python tools/search_danbooru.py --yaml <PATH> [<PATH> ...] [--exclude-category PREFIX ...]`

- [ ] **Step 1: `verify_yaml_entries` / `print_yaml_ng_line` / `print_yaml_summary` を追加する**

`def main():` の直前（Task 3 で追加した `extract_tags` の後）に以下を追加する:

```python
def verify_yaml_entries(conn, entries):
    """entries（(filename, group, label, tags_str)のリスト）を検証する。

    LoRAエントリ（is_lora_entry が真）は丸ごとスキップし、スキップした
    タグ数を file_stats に計上する。戻り値は (ng_list, file_stats)。

    ng_list: NGだったタグのみのリスト。各要素は
        {"filename", "group", "label", "tag"}
    file_stats: {filename: {"checked": int, "ng": int, "skipped": int}}
    """
    ng_list = []
    file_stats = {}
    for filename, group, label, tags_str in entries:
        stats = file_stats.setdefault(filename, {"checked": 0, "ng": 0, "skipped": 0})
        if is_lora_entry(tags_str):
            stats["skipped"] += len(extract_tags(tags_str))
            continue
        for tag in extract_tags(tags_str):
            stats["checked"] += 1
            if query_exact(conn, tag) is None:
                stats["ng"] += 1
                ng_list.append({"filename": filename, "group": group, "label": label, "tag": tag})
    return ng_list, file_stats


def format_yaml_category(filename, group):
    return f"{filename}:{group}" if group else filename


def print_yaml_ng_line(ng):
    category = format_yaml_category(ng["filename"], ng["group"])
    print(
        f"NG {category} ({ng['label']}) tag='{ng['tag']}': "
        "Danbooru に実在するタグは見つかりませんでした（別名含め未検出）。"
    )


def print_yaml_summary(file_stats):
    print("--- サマリ ---")
    total_checked = 0
    total_ng = 0
    total_skipped = 0
    for filename in sorted(file_stats):
        stats = file_stats[filename]
        total_checked += stats["checked"]
        total_ng += stats["ng"]
        total_skipped += stats["skipped"]
        skip_note = f"（LoRAエントリのため{stats['skipped']}件スキップ）" if stats["skipped"] else ""
        print(f"{filename}.yml: {stats['ng']}/{stats['checked']}件 NG{skip_note}")
    skip_total_note = f"（LoRAスキップ合計{total_skipped}件）" if total_skipped else ""
    print(f"合計: {total_ng}/{total_checked}件 NG{skip_total_note}")
```

- [ ] **Step 2: フィクスチャで検証・集計ロジックを確認する**

Run:
```bash
cd "C:/tools/StabilityMatrix/Data/Packages/Stable Diffusion WebUI reForge/extensions/sdweb-easy-template-selector"
python - <<'PY'
import csv, io, os, sqlite3, sys, tempfile
from contextlib import redirect_stdout
sys.path.insert(0, "tools")
import search_danbooru as sd

with tempfile.TemporaryDirectory() as tmp:
    csv_path = os.path.join(tmp, "danbooru.csv")
    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["1girl", 0, 6008644, ""])
        w.writerow(["mari_(blue_archive)", 4, 6413, ""])
        w.writerow(["blue_eyes", 0, 1000000, ""])

    db_path = sd.ensure_db(csv_path, os.path.join(tmp, "cache.db"))
    conn = sqlite3.connect(db_path)

    entries = [
        ("flat", None, "一人の女の子", "1girl"),
        ("grouped", "トリニティ", "マリー", "mari \\(blue archive\\),blue eyes,nonexistent tag xyz"),
        ("grouped_lora", "トリニティ", "マリー(LoRA)", "<lora:x:1> zztrigger, mari \\(blue archive\\)"),
    ]
    ng_list, file_stats = sd.verify_yaml_entries(conn, entries)

    assert file_stats["flat"] == {"checked": 1, "ng": 0, "skipped": 0}, file_stats["flat"]
    assert file_stats["grouped"]["checked"] == 3 and file_stats["grouped"]["ng"] == 1, file_stats["grouped"]
    assert file_stats["grouped_lora"] == {"checked": 0, "ng": 0, "skipped": 2}, file_stats["grouped_lora"]
    assert len(ng_list) == 1 and ng_list[0]["tag"] == "nonexistent tag xyz", ng_list

    buf = io.StringIO()
    with redirect_stdout(buf):
        sd.print_yaml_summary(file_stats)
    out = buf.getvalue()
    assert "flat.yml: 0/1件 NG" in out, out
    assert "grouped.yml: 1/3件 NG" in out, out
    assert "grouped_lora.yml: 0/0件 NG（LoRAエントリのため2件スキップ）" in out, out
    assert "合計: 1/4件 NG（LoRAスキップ合計2件）" in out, out

    conn.close()

print("OK: verify_yaml_entries and summary formatting")
PY
```

Expected（標準出力）:
```
OK: verify_yaml_entries and summary formatting
```

- [ ] **Step 3: `main()` に `--yaml` / `--exclude-category` を統合する**

現在の `main()`（`tools/search_danbooru.py`）の該当箇所:
```python
    parser.add_argument("queries", nargs="+", help="検索語（クエリごとに個別に結果を表示する）")
    parser.add_argument(
        "--exact",
        action="store_true",
        help="部分一致ではなく、タグ名または別名との完全一致のみを対象にする",
    )
```

以下に置き換える:
```python
    parser.add_argument(
        "queries", nargs="*", help="検索語（クエリごとに個別に結果を表示する。--yaml 指定時は使わない）"
    )
    parser.add_argument(
        "--yaml",
        nargs="+",
        metavar="PATH",
        default=None,
        help=(
            "tags/*.yml 内の全タグを一括で実在確認するモード。ファイルまたは"
            "ディレクトリ（直下の *.yml を対象）を複数指定可能。queries とは併用不可"
        ),
    )
    parser.add_argument(
        "--exclude-category",
        nargs="+",
        default=[],
        metavar="PREFIX",
        help=(
            "--yaml モードで検証対象から除外するカテゴリ（ファイル名プレフィックス、"
            "複数指定可）。例: --exclude-category 01_クオリティ 10_キャラ_LoRA"
        ),
    )
    parser.add_argument(
        "--exact",
        action="store_true",
        help="部分一致ではなく、タグ名または別名との完全一致のみを対象にする",
    )
```

続けて、現在の以下の箇所（`args = parser.parse_args()` の直後）:
```python
    args = parser.parse_args()

    try:
        db_path = ensure_db(args.csv_path, args.db_path, force_rebuild=args.rebuild)
    except FileNotFoundError as e:
        print(f"エラー: {e}", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(db_path)
    try:
        for query in args.queries:
            if args.exact:
                print_exact_result(query, query_exact(conn, query))
            else:
                results, total = query_partial(conn, query, args.limit)
                print_partial_results(query, results, total, args.limit)
    finally:
        conn.close()
```

を以下に置き換える:
```python
    args = parser.parse_args()

    if args.yaml and args.queries:
        parser.error("--yaml と検索語(queries)は同時に指定できません")
    if not args.yaml and not args.queries:
        parser.error("検索語または --yaml のいずれかを指定してください")

    try:
        db_path = ensure_db(args.csv_path, args.db_path, force_rebuild=args.rebuild)
    except FileNotFoundError as e:
        print(f"エラー: {e}", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(db_path)
    try:
        if args.yaml:
            yaml_paths = resolve_yaml_paths(args.yaml)
            if args.exclude_category:
                # エントリ読み込み後ではなくパス解決後に除外することで、除外対象
                # ファイルの不要なパース・警告出力を避ける。
                yaml_paths = [
                    p for p in yaml_paths
                    if not any(
                        os.path.splitext(os.path.basename(p))[0].startswith(prefix)
                        for prefix in args.exclude_category
                    )
                ]
            entries = load_yaml_entries(yaml_paths)
            ng_list, file_stats = verify_yaml_entries(conn, entries)
            print(
                "（判定は a1111-sd-webui-tagcomplete の danbooru.csv スナップショットに"
                "基づきます。スナップショットに未反映の新規タグ等はNGとして表示される"
                "場合があります）"
            )
            for ng in ng_list:
                print_yaml_ng_line(ng)
            print_yaml_summary(file_stats)
        else:
            for query in args.queries:
                if args.exact:
                    print_exact_result(query, query_exact(conn, query))
                else:
                    results, total = query_partial(conn, query, args.limit)
                    print_partial_results(query, results, total, args.limit)
    finally:
        conn.close()
```

- [ ] **Step 4: CLI 統合をフィクスチャで確認する**

Run:
```bash
cd "C:/tools/StabilityMatrix/Data/Packages/Stable Diffusion WebUI reForge/extensions/sdweb-easy-template-selector"
python - <<'PY'
import csv, os, subprocess, sys, tempfile

with tempfile.TemporaryDirectory() as tmp:
    csv_path = os.path.join(tmp, "danbooru.csv")
    db_path = os.path.join(tmp, "cache.db")
    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["1girl", 0, 6008644, ""])

    yaml_dir = os.path.join(tmp, "tags")
    os.makedirs(yaml_dir)
    with open(os.path.join(yaml_dir, "02_対象.yml"), "w", encoding="utf-8") as f:
        f.write("一人の女の子: 1girl\n存在しないタグ: totally nonexistent tag\n")

    result = subprocess.run(
        [sys.executable, "tools/search_danbooru.py", "--yaml", yaml_dir,
         "--csv-path", csv_path, "--db-path", db_path],
        capture_output=True, text=True, check=True,
    )
    assert "danbooru.csv スナップショットに" in result.stdout, result.stdout
    assert "NG 02_対象 (存在しないタグ) tag='totally nonexistent tag'" in result.stdout, result.stdout
    assert "合計: 1/2件 NG" in result.stdout, result.stdout

    # queries と --yaml の同時指定はエラー
    result_conflict = subprocess.run(
        [sys.executable, "tools/search_danbooru.py", "--yaml", yaml_dir, "sometag",
         "--csv-path", csv_path, "--db-path", db_path],
        capture_output=True, text=True,
    )
    assert result_conflict.returncode != 0, result_conflict
    assert "同時に指定できません" in result_conflict.stderr, result_conflict.stderr

    # 引数なしはエラー
    result_empty = subprocess.run(
        [sys.executable, "tools/search_danbooru.py", "--csv-path", csv_path, "--db-path", db_path],
        capture_output=True, text=True,
    )
    assert result_empty.returncode != 0, result_empty

print("OK: --yaml CLI integration")
PY
```

Expected（標準出力）:
```
OK: --yaml CLI integration
```

- [ ] **Step 5: 実データ（単体ファイル）で検証する**

`tags/10_キャラ_ブルアカ.yml` を実際に検証する。プラン作成時点の内容では 1212 タグ中 26 件が NG になる（大半は実際のタグ誤り・タイポで、"one side upfake animal ears" のようなカンマ抜けの疑いがあるものを含む）。

Run:
```bash
python tools/search_danbooru.py --yaml "tags/10_キャラ_ブルアカ.yml"
```

Expected（標準出力。プラン作成時点の `tags/10_キャラ_ブルアカ.yml` に基づく。内容が変わっていれば妥当な差分か確認して判断する）:
```
（判定は a1111-sd-webui-tagcomplete の danbooru.csv スナップショットに基づきます。スナップショットに未反映の新規タグ等はNGとして表示される場合があります）
NG 10_キャラ_ブルアカ:ゲヘナ (イブキ(ドレス)) tag='black hair ribbon': Danbooru に実在するタグは見つかりませんでした（別名含め未検出）。
NG 10_キャラ_ブルアカ:トリニティ (マリー) tag='mari halo': Danbooru に実在するタグは見つかりませんでした（別名含め未検出）。
NG 10_キャラ_ブルアカ:トリニティ (マリー(ユスティナ聖徒会)) tag='mari halo': Danbooru に実在するタグは見つかりませんでした（別名含め未検出）。
NG 10_キャラ_ブルアカ:トリニティ (マリー(体操服)) tag='mari halo': Danbooru に実在するタグは見つかりませんでした（別名含め未検出）。
NG 10_キャラ_ブルアカ:トリニティ (マリー(体操服2)) tag='mari halo': Danbooru に実在するタグは見つかりませんでした（別名含め未検出）。
NG 10_キャラ_ブルアカ:トリニティ (コハル(ピザハットコラボ)) tag='hair tied': Danbooru に実在するタグは見つかりませんでした（別名含め未検出）。
NG 10_キャラ_ブルアカ:トリニティ (ヒフミ) tag='light brown hair': Danbooru に実在するタグは見つかりませんでした（別名含め未検出）。
NG 10_キャラ_ブルアカ:トリニティ (ヒフミ(水着)) tag='light brown hair': Danbooru に実在するタグは見つかりませんでした（別名含め未検出）。
NG 10_キャラ_ブルアカ:トリニティ (ヒフミ(体操服)) tag='light brown hair': Danbooru に実在するタグは見つかりませんでした（別名含め未検出）。
NG 10_キャラ_ブルアカ:トリニティ (ヒフミ(学校指定水着)) tag='light brown hair': Danbooru に実在するタグは見つかりませんでした（別名含め未検出）。
NG 10_キャラ_ブルアカ:トリニティ (セリナ) tag='mini  nurse cap': Danbooru に実在するタグは見つかりませんでした（別名含め未検出）。
NG 10_キャラ_ブルアカ:トリニティ (セリナ) tag='serina halo': Danbooru に実在するタグは見つかりませんでした（別名含め未検出）。
NG 10_キャラ_ブルアカ:トリニティ (セリナ(ナース)) tag='pink nurse cap': Danbooru に実在するタグは見つかりませんでした（別名含め未検出）。
NG 10_キャラ_ブルアカ:トリニティ (セリナ(ナース)) tag='serina halo': Danbooru に実在するタグは見つかりませんでした（別名含め未検出）。
NG 10_キャラ_ブルアカ:トリニティ (セリナ(クリスマス)) tag='serina halo': Danbooru に実在するタグは見つかりませんでした（別名含め未検出）。
NG 10_キャラ_ブルアカ:ミレニアム (アリス(防寒着)) tag='low tied hair': Danbooru に実在するタグは見つかりませんでした（別名含め未検出）。
NG 10_キャラ_ブルアカ:ミレニアム (アカネ) tag='light brown hair': Danbooru に実在するタグは見つかりませんでした（別名含め未検出）。
NG 10_キャラ_ブルアカ:ミレニアム (アカネ(バニー)) tag='light brown hair': Danbooru に実在するタグは見つかりませんでした（別名含め未検出）。
NG 10_キャラ_ブルアカ:ミレニアム (アスナ) tag='light brown hair': Danbooru に実在するタグは見つかりませんでした（別名含め未検出）。
NG 10_キャラ_ブルアカ:ミレニアム (アスナ(バニー)) tag='light brown hair': Danbooru に実在するタグは見つかりませんでした（別名含め未検出）。
NG 10_キャラ_ブルアカ:ミレニアム (アスナ(制服)) tag='light brown hair': Danbooru に実在するタグは見つかりませんでした（別名含め未検出）。
NG 10_キャラ_ブルアカ:ミレニアム (アスナ(チア)) tag='light brown hair': Danbooru に実在するタグは見つかりませんでした（別名含め未検出）。
NG 10_キャラ_ブルアカ:SRT (ミヤコ) tag='one side upfake animal ears': Danbooru に実在するタグは見つかりませんでした（別名含め未検出）。
NG 10_キャラ_ブルアカ:SRT (ミヤコ(武装解除)) tag='one side upfake animal ears': Danbooru に実在するタグは見つかりませんでした（別名含め未検出）。
NG 10_キャラ_ブルアカ:アビドス (ノノミ) tag='light brown hair': Danbooru に実在するタグは見つかりませんでした（別名含め未検出）。
NG 10_キャラ_ブルアカ:アビドス (ノノミ(水着)) tag='light brown hair': Danbooru に実在するタグは見つかりませんでした（別名含め未検出）。
--- サマリ ---
10_キャラ_ブルアカ.yml: 26/1212件 NG
合計: 26/1212件 NG
```

同じキャラの `mari \(blue archive\)` や `hina \(blue archive\)` 等が NG に出ていない（Task 1 の修正が効いている）ことを確認する。

- [ ] **Step 6: 実データ（LoRAスキップ）で検証する**

`tags/10_キャラ_ブルアカ_LoRA.yml` はほぼ全エントリが `<lora:` を含むため大半がスキップされる想定。

Run:
```bash
python tools/search_danbooru.py --yaml "tags/10_キャラ_ブルアカ_LoRA.yml"
```

Expected（標準出力。プラン作成時点の内容に基づく。全170エントリ中169件がLoRAでスキップされ、残り1件7タグは全てOK）:
```
（判定は a1111-sd-webui-tagcomplete の danbooru.csv スナップショットに基づきます。スナップショットに未反映の新規タグ等はNGとして表示される場合があります）
--- サマリ ---
10_キャラ_ブルアカ_LoRA.yml: 0/7件 NG（LoRAエントリのため1340件スキップ）
合計: 0/7件 NG（LoRAスキップ合計1340件）
```

- [ ] **Step 7: 実データ（ディレクトリ一括 + `--exclude-category`）で検証する**

`tags/` ディレクトリ全体は件数が多くファイル内容の変動で完全一致しないため、構造的な健全性のみ確認する（クラッシュしないこと、ファイル別サマリと合計サマリが出ること、合計NG件数がファイル別NG件数の合計と一致すること）。

Run:
```bash
python - <<'PY'
import re, subprocess, sys

result = subprocess.run(
    [sys.executable, "tools/search_danbooru.py", "--yaml", "tags/",
     "--exclude-category", "01_クオリティ"],
    capture_output=True, text=True, check=True,
)
out = result.stdout

assert "--- サマリ ---" in out, out
assert "01_クオリティ.yml:" not in out, "除外したはずのカテゴリが含まれている"

per_file_ng = sum(int(m) for m in re.findall(r": (\d+)/\d+件 NG", out.split("合計:")[0]))
total_match = re.search(r"合計: (\d+)/(\d+)件 NG", out)
assert total_match, out
assert int(total_match.group(1)) == per_file_ng, (int(total_match.group(1)), per_file_ng)

print("OK: directory-wide --yaml with --exclude-category is structurally consistent")
PY
```

Expected（標準出力）:
```
OK: directory-wide --yaml with --exclude-category is structurally consistent
```

- [ ] **Step 8: コミットする**

```bash
git add tools/search_danbooru.py
git commit -m "feat(tools): search_danbooru.pyに--yamlモード（tags/*.yml一括Danbooru実在検証）を追加"
```

## レビュー結果メモ

`plan-reviewer` によるレビュー（🟡 軽微修正後承認）を受け、指摘6件のうち5件を計画へ取り込み、1件を却下した。

- 🟡 **パス重複排除がない（二重カウントの穴）**: 取り込み。`resolve_yaml_paths` に realpath 基準の重複除去を追加し、Task 2 のフィクスチャテストに重複指定のケースを追加した。
- 🟡 **「NG＝Danbooruに実在しない」という断定が実態より強い**: 取り込み。判定源が `danbooru.csv` スナップショットであることを示す注記行を `--yaml` 出力の先頭に追加した（既存 `--exact` モードの NG メッセージ文言自体は既存ツールとの一貫性のため変更せず）。
- 🟡 **重み／強調記法の網羅範囲（角括弧・波括弧・コロン無し複数タググループ）**: 実データ（46ファイル全数）を grep 調査し、角括弧・波括弧の独立使用は無し、コロン無し複数タググループは1件のみ（`tags/50_背景.yml:30`）と判明。1件のみのため専用対応はせず、既知の限界として Global Constraints に明記するに留めた（YAGNI）。
- 🟡 **LoRA判定が`<lora:`固定（`<lyco:`等非対応）**: 実データ調査の結果、`<lora:` 以外のディレクティブは使用例なしと確認。現状スコープ外である旨を Global Constraints に明記した。
- 🟡 **除外カテゴリでも読み込み・警告は発生**: 取り込み。`--exclude-category` によるフィルタを、エントリ読み込み後ではなく `resolve_yaml_paths` 実行後・`load_yaml_entries` 実行前に移動し、除外ファイルが不要にパースされないようにした（Task 4 Step 3）。
- 🟡 **クエリ結果の非メモ化（性能）**: 却下。実データ全体（9004クエリ）でも 0.35 秒程度で完了することを計画作成時に実測済みで、SQLite のインデックスにより十分高速なため対応不要と判断した（reviewer 自身も「規模的に必須ではない」と評価）。
