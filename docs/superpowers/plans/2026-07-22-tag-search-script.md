# タグ検索スクリプト Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `tags/*.yml` に定義された英語タグ・日本語ラベルを検索できる CLI スクリプトを作り、`create-template` スキル等でのタグ照合作業を grep より扱いやすく行えるようにする。

**Architecture:** `tools/search_tags.py` という単一の Python スクリプトを新設する。`tags/*.yml` を `PyYAML` でパースし、`(ファイル名, グループ, ラベル, タグ文字列)` のタプルへ平坦化した上で、タグ文字列側（カンマ区切りの各要素）またはラベル側に対して大文字小文字を無視した検索を行う。既定は部分一致（grep と同様、意図せぬ部分文字列にもマッチし得る）、`--exact` 指定時はタグ1要素・ラベル全体との完全一致のみを対象にする。結果はテンプレートのカテゴリコメント行形式（`# ファイル名:グループ (ラベル),`）にタグ文字列を添えて出力し、`create-template` スキルでそのままコピー利用できるようにする。

**Tech Stack:** Python 3（標準ライブラリの `argparse`/`glob`/`os`/`sys` + 既存依存の `PyYAML`）。

## Global Constraints

- 本プロジェクトにビルド・テスト基盤は無い（CLAUDE.md「Build & Test」節）。よって本プランは pytest 等の自動テストを導入せず、`tools/` 配下の既存スクリプト（`split_lora.py` 等）と同様に手動実行による動作確認で代替する。
- `tags/` は git 管理外（`.gitignore` で除外）。スクリプトはファイルシステムから直接読み込むため git 管理状態に依存しないが、リポジトリに `tags/*.yml` が存在しない環境（例: 素の worktree）では実データが無く検索結果が0件になる点に注意。
- コードのコメントは日本語で記述する（プロジェクト CLAUDE.md 準拠）。
- ハードコーディングを避ける：`tags/` ディレクトリのパスはスクリプトファイルの位置から動的に解決し、実行時の cwd に依存させない。

---

## File Structure

- Create: `tools/search_tags.py` — 検索 CLI 本体（YAML 読み込み・平坦化・検索・出力を1ファイルに収める。既存 `tools/*.py` も分割されていない単一スクリプト構成のため、この規模では追加ファイル分割は不要）。

## Task 1: `tools/search_tags.py` の実装と動作確認

**Files:**
- Create: `tools/search_tags.py`

**Interfaces:**
- Consumes: なし（新規スクリプト、外部依存は `PyYAML` のみ）
- Produces: CLI エントリポイント `python tools/search_tags.py <query> [<query> ...] [--mode {tag,label,all}] [--exact] [--tags-dir PATH]`。標準出力に `# ファイル名[:グループ] (ラベル), タグ文字列` 形式で1行ずつ結果を出力する。読み込みに問題があるファイルや検索対象ディレクトリの不備は標準エラー出力に警告/エラーを出す。

- [ ] **Step 1: `tools/search_tags.py` を作成する**

```python
#!/usr/bin/env python3
"""tags/*.yml からタグ・ラベルを検索する CLI ツール。

tags/ は .gitignore 対象のため、ripgrep ベースの Grep ツールでは
素通りしてヒットしない。本スクリプトはファイルシステムから直接
YAML を読み込むことでこれを回避する。

既定（部分一致）は grep と同様に無関係な文字列にも部分一致し得る
（例: "arch" は "blue archive" というタグにもマッチする）。
タグ・ラベル単位の厳密な一致が必要な場合は --exact を指定すると、
カンマ区切りの1タグ、またはラベル全体との完全一致のみに絞れる。
"""
import argparse
import glob
import os
import sys

import yaml

# Windows のコンソールは既定で cp932 になり得るため、日本語の出力
# （結果・警告メッセージの両方）が文字化けしないよう明示的に UTF-8 へ固定する。
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")


def flatten(node, group=None):
    """YAML ノードを (グループ, ラベル, タグ文字列) のリストへ平坦化する。"""
    entries = []
    if isinstance(node, dict):
        for key, value in node.items():
            if isinstance(value, dict):
                entries.extend(flatten(value, group=key))
            elif isinstance(value, str):
                entries.append((group, key, value))
    return entries


def load_entries(tags_dir):
    """tags_dir 配下の全 yml ファイルを読み込み、(ファイル名, グループ, ラベル, タグ文字列) のリストを返す。

    構文エラーのファイルや、トップレベルが辞書形式でない（リスト等の）
    ファイルは標準エラー出力に警告を出した上でスキップし、他ファイルの
    検索は継続する。
    """
    if not os.path.isdir(tags_dir):
        print(f"エラー: tags ディレクトリが見つかりません: {tags_dir}", file=sys.stderr)
        sys.exit(1)

    entries = []
    for path in sorted(glob.glob(os.path.join(tags_dir, "*.yml"))):
        filename = os.path.splitext(os.path.basename(path))[0]
        try:
            with open(path, encoding="utf-8") as f:
                data = yaml.safe_load(f)
        except yaml.YAMLError as e:
            print(f"警告: {filename}.yml の構文解析に失敗したためスキップします: {e}", file=sys.stderr)
            continue
        if not data:
            continue
        if not isinstance(data, dict):
            print(f"警告: {filename}.yml はトップレベルが辞書形式ではないためスキップします", file=sys.stderr)
            continue
        for group, label, tags in flatten(data):
            entries.append((filename, group, label, tags))
    return entries


def format_comment(filename, group, label):
    """テンプレートのカテゴリコメント行形式 (# カテゴリ:グループ (ラベル),) を生成する。"""
    category = f"{filename}:{group}" if group else filename
    return f"# {category} ({label}),"


def matches(entry, queries, mode, exact):
    """1エントリがいずれかのクエリに一致するか判定する（OR 検索）。

    exact=False（既定）はタグ・ラベルへの部分文字列一致、
    exact=True はタグ1要素・ラベル全体との完全一致のみを対象にする。
    """
    _, _, label, tags = entry
    tag_list = [t.strip() for t in tags.split(",") if t.strip()]
    haystacks = []
    if mode in ("tag", "all"):
        haystacks.extend(tag_list)
    if mode in ("label", "all"):
        haystacks.append(label)
    lowered = [h.lower() for h in haystacks]
    queries_lower = [q.lower() for q in queries]
    if exact:
        return any(q == h for q in queries_lower for h in lowered)
    return any(q in h for q in queries_lower for h in lowered)


def search(entries, queries, mode, exact):
    """クエリに一致するエントリのリストを返す。"""
    return [e for e in entries if matches(e, queries, mode, exact)]


def main():
    default_tags_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tags"
    )
    parser = argparse.ArgumentParser(
        description=(
            "tags/*.yml のタグ・日本語ラベルを検索する。既定は部分一致のため "
            "'masterpiece' は 'masterpieces_v1' のようなタグにもマッチする。"
            "タグ・ラベル単位の完全一致のみに絞りたい場合は --exact を指定する。"
        )
    )
    parser.add_argument("queries", nargs="+", help="検索語（複数指定時は OR 検索）")
    parser.add_argument(
        "--mode",
        choices=["tag", "label", "all"],
        default="all",
        help="検索対象。tag=タグ文字列のみ、label=日本語ラベルのみ、all=両方（デフォルト）",
    )
    parser.add_argument(
        "--exact",
        action="store_true",
        help="部分一致ではなく、タグ（カンマ区切りの1要素）またはラベル全体との完全一致のみを対象にする",
    )
    parser.add_argument(
        "--tags-dir",
        default=default_tags_dir,
        help=f"tags ディレクトリのパス（デフォルト: {default_tags_dir}）",
    )
    args = parser.parse_args()

    entries = load_entries(args.tags_dir)
    results = search(entries, args.queries, args.mode, args.exact)

    if not results:
        print("一致するタグは見つかりませんでした。")
        return

    for filename, group, label, tags in results:
        print(f"{format_comment(filename, group, label)} {tags}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 単一クエリでの部分一致検索を確認する**

Run: `python tools/search_tags.py masterpiece`

Expected（標準エラー出力に1行、標準出力にこの順序で7行）:

標準エラー出力（`98_特殊.yml` はトップレベルがリストのため、実行のたびに毎回出る想定通りの警告。以降のステップでも同様に出るが省略する）:
```
警告: 98_特殊.yml はトップレベルが辞書形式ではないためスキップします
```

標準出力:
```
# 01_クオリティ:Model (Nova Anime XL), masterpiece, best quality, amazing quality, very aesthetic, high resolution, ultra-detailed, absurdres, newest, scenery
# 01_クオリティ:Model (Unholy Desire Mix), unholy-aesthetic,masterpiece,best quality,amazing quality,very aesthetic,absurdres,ultra detailed face,ultra detailed eyes
# 01_クオリティ:Model (WAI-NSFW-illustrious-SDXL), masterpiece,best quality,amazing quality
# 01_クオリティ:Model (KonpaEvo Mix), masterpiece,best quality,very awa
# 01_クオリティ:Model (LunarCherryMix), masterpiece,best quality,ultra high res,photorealistic,8K UHD,hyper-detailed
# 01_クオリティ:マスピ (マスピ), masterpiece
# 75_その他LoRA (Aesthetic Quality Modifiers - Masterpiece), <lora:illustrious_quality_modifiers_masterpieces_v1:1>
```

（最後の1行は `masterpieces_v1` が `masterpiece` を部分文字列として含むため、タグ側マッチとしてヒットする。既定モードの意図した挙動。）

- [ ] **Step 3: 一致なしクエリを確認する**

Run: `python tools/search_tags.py zzz_no_such_tag_xyz`

Expected（標準出力）:
```
一致するタグは見つかりませんでした。
```

- [ ] **Step 4: 複数クエリの OR 検索を確認する**

Run: `python tools/search_tags.py zzz_no_such_tag_xyz masterpiece`

Expected: Step 2 と同じ7行が標準出力に出る（1つ目のクエリは無マッチ、2つ目のクエリでマッチするため OR として成立していることを確認）。

- [ ] **Step 5: `--mode label` でのラベル検索を確認する**

Run: `python tools/search_tags.py --mode label マスピ`

Expected（標準出力）:
```
# 01_クオリティ:マスピ (マスピ), masterpiece
```

（`--mode label` はタグ文字列側を見ないため、Step 2 の7件中この1件のみに絞られることを確認する。）

- [ ] **Step 6: `--exact` による厳密一致で誤爆が起きないことを確認する**

`grep` で "arch" のような曖昧な語を検索すると "blue archive"（無関係なキャラプリセット）に大量に部分一致してしまう問題が今回の動機のひとつだった。既定の部分一致モードではこの問題は解消されない（`python tools/search_tags.py arch` は約350件ヒットし、大半が `blue archive` 由来）。`--exact` はこれを解消するためのモードで、以下で確認する。

Run: `python tools/search_tags.py --exact arch`

Expected（標準出力、1行のみ。`architecture` 等の部分文字列にはマッチせず、カンマ区切りで独立した `arch` というタグ要素にのみ一致する）:
```
# 50_背景:オリジナル (宮殿内), indoors, palace, night, architecture, flag, arch, pillar,
```

- [ ] **Step 7: `--tags-dir` に存在しないパスを渡した場合のエラーを確認する**

Run: `python tools/search_tags.py --tags-dir "/no/such/dir" masterpiece`

Expected（標準エラー出力、終了コード1。「一致なし」と誤表示されないことを確認する）:
```
エラー: tags ディレクトリが見つかりません: /no/such/dir
```

- [ ] **Step 8: コミットする**

```bash
git add tools/search_tags.py docs/superpowers/plans/2026-07-22-tag-search-script.md
git commit -m "feat: タグ・ラベル検索用の search_tags.py を追加"
```

## レビュー結果メモ

`plan-reviewer` によるレビュー（🟡 軽微修正後承認）を受け、指摘4件をすべて計画へ取り込んだ（却下0件）。

- 🔴 **`--exact` モードを新設**: 既定の部分一致では動機の一つだった "arch"→"blue archive" 誤爆が実際には解消されないという指摘（実データで352件誤爆を確認）を受け、完全一致モードを追加し Step 6 で誤爆しないことを検証する形にした。docstring・`--help` の説明文も「部分一致は grep 同様の限界がある」ことを正直に記載するよう修正。
- 🟡 **`98_特殊.yml`（非dict形式）の無警告スキップ**: `load_entries` で `isinstance(data, dict)` チェックを追加し、非対応ファイルは標準エラー出力に警告を出してスキップするようにした。
- 🟡 **YAML構文エラーでの全体クラッシュ**: ファイル単位で `try/except yaml.YAMLError` を追加し、エラーファイルをスキップして他ファイルの検索を継続するようにした。
- 🟡 **`--tags-dir` 不在時に「一致なし」と誤報**: `os.path.isdir` チェックを追加し、ディレクトリが存在しない場合は明確なエラーメッセージと終了コード1で終了するようにした（Step 7 で検証）。

（付随して `sys.stderr` も `sys.stdout` と同様に UTF-8 へ固定した。警告メッセージも日本語で出力するため、`stdout` のみ対策していると文字化けする実装ミスに気づいたための修正。）
