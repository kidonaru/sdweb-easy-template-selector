# Danbooru タグ実在確認ツール Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `create-template` スキルでタグを `tags/*.yml` に新規追記する前に、そのタグが実際に Danbooru に存在するかをオフラインかつ高速に確認できる CLI ツール `tools/search_danbooru.py` を作る。

**Architecture:** `a1111-sd-webui-tagcomplete` 拡張が持つ Danbooru タグの静的スナップショット（`extensions/a1111-sd-webui-tagcomplete/tags/danbooru.csv`、`name,category,post_count,"alias1,alias2,..."` 形式、14万行）を SQLite（`tools/.cache/danbooru_tags.db`）へ変換してキャッシュし、タグ名・別名（alias）の両方に対して完全一致・部分一致検索を行う。CSV の mtime がキャッシュより新しければ自動で再構築する。既存の `tools/search_tags.py`（`tags/*.yml` 検索）とは別ツールとして共存させる（データソース・検索対象が異なるため）。

**Tech Stack:** Python 3 標準ライブラリのみ（`argparse` / `csv` / `os` / `sqlite3` / `sys`）。追加の pip 依存は無し。

## Global Constraints

- 本プロジェクトにビルド・テスト基盤は無い（CLAUDE.md「Build & Test」節、および `docs/superpowers/plans/2026-07-22-tag-search-script.md` の先例）。よって本プランは pytest 等を導入せず、`python - <<'PY' ... PY` 形式の assert ベースのスクリプトと、実データに対する手動実行で動作確認する。
- コードのコメントは日本語で記述する（プロジェクト CLAUDE.md 準拠）。
- ハードコーディングを避ける: `danbooru.csv` のデフォルトパスはスクリプトファイルの位置から `extensions/a1111-sd-webui-tagcomplete/tags/danbooru.csv`（本リポジトリと同じ `extensions/` 配下に同居する構成前提）を動的に解決するが、`--csv-path` で上書き可能にする。
- `extensions/a1111-sd-webui-tagcomplete/tags/danbooru.csv` は別拡張機能が所有するファイルであり、読み取り専用ソースとして扱う（編集・移動しない）。
- キャッシュ DB (`tools/.cache/danbooru_tags.db`) は CSV から再生成可能な派生物のため git 管理下に置かない。
- 本プランの検証コマンド（ヒアドキュメント `<<'PY'`、`grep`、`ls` 等）は POSIX シェル構文のため、Bash ツール経由で実行する（本環境の primary shell である PowerShell では `ls` の出力形式等が異なり Expected と一致しない）。

---

## File Structure

- Create: `tools/search_danbooru.py` — Danbooru タグ CSV → SQLite 変換、完全一致/部分一致検索、CLI を1ファイルに収める（`tools/search_tags.py` と同じく単一スクリプト構成の既存パターンを踏襲）。
- Modify: `.gitignore` — キャッシュ DB 用ディレクトリ `tools/.cache/` を追加。
- Modify: `.claude/skills/create-template/SKILL.md` — 手順3・4の「Web検索で Danbooru 実在確認する」記述を、新ツール利用に置き換える。

## Task 1: `tools/search_danbooru.py` の実装と動作確認

**Files:**
- Create: `tools/search_danbooru.py`

**Interfaces:**
- Consumes: なし（新規スクリプト、外部 pip 依存なし）
- Produces: CLI エントリポイント `python tools/search_danbooru.py <query> [<query> ...] [--exact] [--limit N] [--csv-path PATH] [--db-path PATH] [--rebuild]`。標準出力にクエリごとの実在確認結果（`--exact`）または部分一致一覧（既定）を出力する。関数 `build_db(csv_path, db_path) -> (tag_count, alias_count)`、`ensure_db(csv_path, db_path, force_rebuild=False) -> db_path`、`normalize(text) -> str`、`display_name(name) -> str`、`query_exact(conn, query) -> dict|None`、`query_partial(conn, query, limit) -> (list[dict], int)` は他タスクからは参照されない（本タスク内で完結）。

- [ ] **Step 1: `tools/search_danbooru.py` を作成する**

```python
#!/usr/bin/env python3
"""Danbooru タグの実在確認・検索を行う CLI ツール。

a1111-sd-webui-tagcomplete 拡張が持つ Danbooru タグのスナップショット
（tags/danbooru.csv, 形式: name,category,post_count,"alias1,alias2,..."）
を SQLite にキャッシュし、タグ名・別名から検索する。

create-template スキルで新規タグを tags/*.yml に追記する前に、
そのタグ文字列が実際に Danbooru 上で使われているタグかどうかを
オフラインかつ高速に確認する用途を想定している
（従来は Web 検索で都度確認しておりレート制限・速度の問題があった）。
"""
import argparse
import csv
import os
import sqlite3
import sys

# Windows のコンソールは既定で cp932 になり得るため、日本語の出力が
# 文字化けしないよう明示的に UTF-8 へ固定する。
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# a1111-sd-webui-tagcomplete は本リポジトリと同じ extensions/ 配下に
# 同居しているインストール構成を前提としたデフォルトパス。
DEFAULT_CSV_PATH = os.path.join(
    os.path.dirname(_REPO_ROOT), "a1111-sd-webui-tagcomplete", "tags", "danbooru.csv"
)
DEFAULT_DB_PATH = os.path.join(_REPO_ROOT, "tools", ".cache", "danbooru_tags.db")

CATEGORY_LABELS = {0: "general", 1: "artist", 3: "copyright", 4: "character", 5: "meta"}


def normalize(text):
    """検索・照合用に、空白をアンダースコアに、小文字に正規化する。"""
    return "_".join(text.strip().lower().split())


def display_name(name):
    """DB上の name（アンダースコア区切り）を空白区切りの表示形式に変換する。"""
    return name.replace("_", " ")


def build_db(csv_path, db_path):
    """csv_path の Danbooru タグ CSV を db_path の SQLite DB へ変換する。

    既存の db_path があれば作り直す。戻り値は (タグ数, エイリアス数)。
    """
    if not os.path.isfile(csv_path):
        raise FileNotFoundError(f"Danbooru タグ CSV が見つかりません: {csv_path}")

    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    if os.path.exists(db_path):
        os.remove(db_path)

    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            "CREATE TABLE tags ("
            "id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, "
            "category INTEGER NOT NULL, post_count INTEGER NOT NULL)"
        )
        conn.execute(
            "CREATE TABLE aliases ("
            "id INTEGER PRIMARY KEY, alias TEXT NOT NULL, "
            "tag_id INTEGER NOT NULL REFERENCES tags(id))"
        )

        tag_count = 0
        alias_count = 0
        with open(csv_path, encoding="utf-8", newline="") as f:
            reader = csv.reader(f)
            for row in reader:
                if len(row) < 3:
                    continue
                name, category_str, post_count_str = row[0], row[1], row[2]
                # Danbooru のタグ名・別名は既に小文字+アンダースコア区切りの正規形で
                # CSV に格納されている前提（normalize() 側もこれに合わせて小文字化・
                # アンダースコア変換して照合する）。CSV ソースを差し替える場合は要確認。
                aliases_str = row[3] if len(row) > 3 else ""
                if not name:
                    continue
                try:
                    category = int(category_str)
                    post_count = int(post_count_str)
                except ValueError:
                    print(
                        f"警告: 数値変換に失敗した行をスキップします: {row}",
                        file=sys.stderr,
                    )
                    continue

                cur = conn.execute(
                    "INSERT OR IGNORE INTO tags (name, category, post_count) VALUES (?, ?, ?)",
                    (name, category, post_count),
                )
                if cur.rowcount == 0:
                    print(f"警告: 重複タグ名をスキップします: {name}", file=sys.stderr)
                    continue
                tag_id = cur.lastrowid
                tag_count += 1

                for alias in (a.strip() for a in aliases_str.split(",")):
                    if not alias:
                        continue
                    conn.execute(
                        "INSERT INTO aliases (alias, tag_id) VALUES (?, ?)",
                        (alias, tag_id),
                    )
                    alias_count += 1

        conn.execute("CREATE INDEX idx_aliases_alias ON aliases(alias)")
        conn.commit()
    finally:
        conn.close()

    return tag_count, alias_count


def ensure_db(csv_path, db_path, force_rebuild=False):
    """必要なら db_path を再構築し、パスを返す。

    db_path が存在しない、csv_path より古い、または force_rebuild=True の
    場合に再構築する。csv_path が存在しない場合は、getmtime の生の OS
    エラーではなく分かりやすい FileNotFoundError を送出するため、
    mtime 比較より先に存在確認する。
    """
    if not os.path.isfile(csv_path):
        raise FileNotFoundError(f"Danbooru タグ CSV が見つかりません: {csv_path}")

    needs_build = (
        force_rebuild
        or not os.path.isfile(db_path)
        or os.path.getmtime(db_path) < os.path.getmtime(csv_path)
    )
    if needs_build:
        build_db(csv_path, db_path)
    return db_path


def query_exact(conn, query):
    """完全一致検索。name → alias の順に調べ、見つかった1件の情報を返す（無ければ None）。

    戻り値: {"name", "category", "post_count", "matched_via_alias"(str|None)} または None
    """
    normalized = normalize(query)
    row = conn.execute(
        "SELECT name, category, post_count FROM tags WHERE name = ?", (normalized,)
    ).fetchone()
    if row:
        return {"name": row[0], "category": row[1], "post_count": row[2], "matched_via_alias": None}

    row = conn.execute(
        "SELECT t.name, t.category, t.post_count, a.alias "
        "FROM aliases a JOIN tags t ON a.tag_id = t.id WHERE a.alias = ?",
        (normalized,),
    ).fetchone()
    if row:
        return {"name": row[0], "category": row[1], "post_count": row[2], "matched_via_alias": row[3]}

    return None


def escape_like(text):
    """LIKE パターン中のメタ文字（%, _, エスケープ文字自体）をエスケープする。

    normalize() は空白を "_" に変換するため、エスケープせずに LIKE パターンへ
    渡すと "_" が「任意の1文字」を意味するワイルドカードとして解釈されてしまい、
    意図しない文字列にもマッチしてしまう（例: "sound_effect" が "soundXeffect" にも
    マッチする）。ユーザークエリに "%" が含まれる場合も同様に全件マッチしてしまう
    ため、両方エスケープする。
    """
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def query_partial(conn, query, limit):
    """部分一致検索。name または alias に query を部分文字列として含むタグを
    post_count 降順で最大 limit 件返す。

    戻り値: (results, total_count) の tuple。
    results の各要素は {"name", "category", "post_count", "aliases": [str, ...]}
    """
    normalized = normalize(query)
    like_pattern = f"%{escape_like(normalized)}%"

    total = conn.execute(
        "SELECT COUNT(DISTINCT t.id) FROM tags t LEFT JOIN aliases a ON a.tag_id = t.id "
        "WHERE t.name LIKE ? ESCAPE '\\' OR a.alias LIKE ? ESCAPE '\\'",
        (like_pattern, like_pattern),
    ).fetchone()[0]

    rows = conn.execute(
        "SELECT DISTINCT t.id, t.name, t.category, t.post_count FROM tags t "
        "LEFT JOIN aliases a ON a.tag_id = t.id "
        "WHERE t.name LIKE ? ESCAPE '\\' OR a.alias LIKE ? ESCAPE '\\' "
        "ORDER BY t.post_count DESC LIMIT ?",
        (like_pattern, like_pattern, limit),
    ).fetchall()

    results = []
    for tag_id, name, category, post_count in rows:
        alias_rows = conn.execute(
            "SELECT alias FROM aliases WHERE tag_id = ?", (tag_id,)
        ).fetchall()
        results.append(
            {
                "name": name,
                "category": category,
                "post_count": post_count,
                "aliases": [a[0] for a in alias_rows],
            }
        )
    return results, total


def format_category(category):
    return CATEGORY_LABELS.get(category, f"unknown({category})")


def print_exact_result(query, result):
    if result is None:
        print(f"NG '{query}': Danbooru に実在するタグは見つかりませんでした（別名含め未検出）。")
        return
    if result["matched_via_alias"]:
        print(
            f"OK(alias) '{query}': 別名 '{result['matched_via_alias']}' として "
            f"タグ '{display_name(result['name'])}' の別名です "
            f"[{format_category(result['category'])}] post_count={result['post_count']}"
        )
    else:
        print(
            f"OK '{query}': 実在するタグです "
            f"[{format_category(result['category'])}] post_count={result['post_count']}"
        )


def print_partial_results(query, results, total, limit):
    if not results:
        print(f"NG '{query}': 部分一致するタグは見つかりませんでした。")
        return
    print(f"'{query}' の部分一致結果（post_count 降順、上位{len(results)}/{total}件）:")
    for r in results:
        aliases = ",".join(r["aliases"]) if r["aliases"] else "-"
        print(
            f"  {display_name(r['name'])} [{format_category(r['category'])}] "
            f"post_count={r['post_count']} aliases={aliases}"
        )
    if total > limit:
        print(f"  ...他 {total - limit} 件（--exact または具体的なクエリで絞り込んでください）")


def main():
    parser = argparse.ArgumentParser(
        description=(
            "Danbooru タグの実在確認・検索を行う（a1111-sd-webui-tagcomplete の "
            "danbooru.csv をキャッシュした SQLite DB を利用）。"
            "既定は部分一致、--exact でタグ名/別名との完全一致のみに絞る。"
        )
    )
    parser.add_argument("queries", nargs="+", help="検索語（クエリごとに個別に結果を表示する）")
    parser.add_argument(
        "--exact",
        action="store_true",
        help="部分一致ではなく、タグ名または別名との完全一致のみを対象にする",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=20,
        help="部分一致モードでの最大表示件数（デフォルト: 20）",
    )
    parser.add_argument(
        "--csv-path",
        default=DEFAULT_CSV_PATH,
        help=f"Danbooru タグ CSV のパス（デフォルト: {DEFAULT_CSV_PATH}）",
    )
    parser.add_argument(
        "--db-path",
        default=DEFAULT_DB_PATH,
        help=f"キャッシュ用 SQLite DB のパス（デフォルト: {DEFAULT_DB_PATH}）",
    )
    parser.add_argument(
        "--rebuild",
        action="store_true",
        help="キャッシュ DB を強制的に再構築してから検索する",
    )
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


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: フィクスチャCSVでの単体動作を確認する**

`build_db` / `query_exact` / `query_partial` の挙動を、実データに依存しない小さな固定 CSV で検証する。

Run:
```bash
cd "C:/tools/StabilityMatrix/Data/Packages/Stable Diffusion WebUI reForge/extensions/sdweb-easy-template-selector"
python - <<'PY'
import csv, os, sqlite3, sys, tempfile
sys.path.insert(0, "tools")
import search_danbooru as sd

with tempfile.TemporaryDirectory() as tmp:
    csv_path = os.path.join(tmp, "fixture.csv")
    db_path = os.path.join(tmp, "fixture.db")
    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["sound_effects", 0, 24204, "onomatopoeia,sfx"])
        w.writerow(["pastel_colors", 0, 2807, ""])
        w.writerow(["projectile_cum", 0, 7414, ""])
        w.writerow(["1girl", 0, 6008644, "1girls,sole_female"])
        w.writerow(["hatsune_miku", 4, 106634, "/hm"])

    tag_count, alias_count = sd.build_db(csv_path, db_path)
    assert (tag_count, alias_count) == (5, 5), (tag_count, alias_count)

    conn = sqlite3.connect(db_path)

    r = sd.query_exact(conn, "sound effects")
    assert r == {"name": "sound_effects", "category": 0, "post_count": 24204, "matched_via_alias": None}, r

    r = sd.query_exact(conn, "onomatopoeia")
    assert r == {"name": "sound_effects", "category": 0, "post_count": 24204, "matched_via_alias": "onomatopoeia"}, r

    r = sd.query_exact(conn, "sound effect")
    assert r is None, r

    results, total = sd.query_partial(conn, "girl", 10)
    assert total == 1 and results[0]["name"] == "1girl", (total, results)

    results, total = sd.query_partial(conn, "cum", 10)
    assert total == 1 and results[0]["name"] == "projectile_cum", (total, results)

    conn.close()

print("OK: fixture tests passed")
PY
```

Expected（標準出力）:
```
OK: fixture tests passed
```

- [ ] **Step 3: 実データに対する `--exact` モードの実在確認を検証する**

`extensions/a1111-sd-webui-tagcomplete/tags/danbooru.csv` を実際に読み込ませ、過去に誤って `tags/*.yml` へ追記していた誤タグ（`sound effect`, `pastel color`, `projection cum`）が実在しないこと、正しいタグ（`sound effects`, `pastel colors`, `projectile cum`）が実在すること、alias 経由の解決（`onomatopoeia` → `sound effects`）が機能することを確認する。

Run:
```bash
python tools/search_danbooru.py --exact "sound effects" "sound effect" "pastel colors" "pastel color" "projectile cum" "projection cum" "onomatopoeia"
```

Expected（標準出力。初回実行のためこのタイミングで `tools/.cache/danbooru_tags.db` が自動生成される）:
```
OK 'sound effects': 実在するタグです [general] post_count=24204
NG 'sound effect': Danbooru に実在するタグは見つかりませんでした（別名含め未検出）。
OK 'pastel colors': 実在するタグです [general] post_count=2807
NG 'pastel color': Danbooru に実在するタグは見つかりませんでした（別名含め未検出）。
OK 'projectile cum': 実在するタグです [general] post_count=7414
NG 'projection cum': Danbooru に実在するタグは見つかりませんでした（別名含め未検出）。
OK(alias) 'onomatopoeia': 別名 'onomatopoeia' として タグ 'sound effects' の別名です [general] post_count=24204
```

続けて、キャッシュ DB が生成されたことを確認する。

Run: `ls tools/.cache/`

Expected（標準出力）:
```
danbooru_tags.db
```

- [ ] **Step 4: 部分一致モードを検証する**

Run:
```bash
python tools/search_danbooru.py "sound effect"
```

Expected（標準出力）:
```
'sound effect' の部分一致結果（post_count 降順、上位4/4件）:
  sound effects [general] post_count=24204 aliases=onomatopoeia,sfx
  sound effects only [general] post_count=485 aliases=-
  spoken sound effect [general] post_count=112 aliases=-
  sound effect request [meta] post_count=25 aliases=-
```

- [ ] **Step 5: キャッシュが再利用され、`--rebuild` で強制再構築されることを確認する**

Run:
```bash
python - <<'PY'
import os, subprocess, sys, time

db_path = os.path.join("tools", ".cache", "danbooru_tags.db")

before = os.path.getmtime(db_path)
subprocess.run([sys.executable, "tools/search_danbooru.py", "--exact", "1girl"], check=True, capture_output=True)
after = os.path.getmtime(db_path)
assert before == after, ("キャッシュが再利用されず再構築されてしまった", before, after)
print("OK: cache reused (mtime unchanged)")

time.sleep(1.1)
subprocess.run([sys.executable, "tools/search_danbooru.py", "--rebuild", "--exact", "1girl"], check=True, capture_output=True)
after_rebuild = os.path.getmtime(db_path)
assert after_rebuild > after, ("--rebuild を指定したのに再構築されなかった", after, after_rebuild)
print("OK: --rebuild forced a rebuild")
PY
```

Expected（標準出力）:
```
OK: cache reused (mtime unchanged)
OK: --rebuild forced a rebuild
```

- [ ] **Step 6: CSV が見つからない場合のエラーを確認する**

Run:
```bash
python tools/search_danbooru.py --csv-path "/no/such/danbooru.csv" --db-path "/tmp/no_such_cache.db" --exact 1girl
```

Expected（標準エラー出力、終了コード1。「一致なし」と誤表示されないことを確認する）:
```
エラー: Danbooru タグ CSV が見つかりません: /no/such/danbooru.csv
```

- [ ] **Step 7: コミットする**

```bash
git add tools/search_danbooru.py docs/superpowers/plans/2026-07-23-danbooru-tag-verify-tool.md
git commit -m "feat: Danbooru タグ実在確認用の search_danbooru.py を追加"
```

## Task 2: キャッシュ DB を `.gitignore` に追加する

**Files:**
- Modify: `.gitignore`

**Interfaces:**
- Consumes: Task 1 で作られる `tools/.cache/danbooru_tags.db`
- Produces: なし（設定変更のみ）

- [ ] **Step 1: `.gitignore` にキャッシュディレクトリを追記する**

現在の `.gitignore`:
```
# Byte-compiled / optimized / DLL files
__pycache__/

tags/**
templates/*_
```

以下を末尾に追記する:
```

# Danbooru タグ検索キャッシュ（danbooru.csv から自動生成、再生成可能なため管理外）
tools/.cache/
```

- [ ] **Step 2: 無視設定が効いていることを確認する**

Run:
```bash
git check-ignore tools/.cache/danbooru_tags.db && echo "IGNORED"
```

Expected（標準出力）:
```
IGNORED
```

- [ ] **Step 3: コミットする**

```bash
git add .gitignore
git commit -m "chore: Danbooruタグキャッシュディレクトリをgitignoreに追加"
```

## Task 3: `create-template` スキルを新ツール利用に更新する

**Files:**
- Modify: `.claude/skills/create-template/SKILL.md`

**Interfaces:**
- Consumes: Task 1 で作られる `python tools/search_danbooru.py <タグ> --exact` CLI
- Produces: なし（ドキュメント更新のみ）

- [ ] **Step 1: 手順3（既存タグの照合）の記述を更新する**

`.claude/skills/create-template/SKILL.md` の該当箇所:

現在の記述（前回セッションで Web 検索ベースの確認手順として追記した箇所）:
```
   - `search_tags.py` は `tags/*.yml` 内の既存表記と照合するだけで、その表記が実際に Danbooru 上で有効なタグかどうかは保証しない。既存エントリを流用する場合でも、単数/複数形や語形が怪しい場合（例: `sound effect`）は次項と同様に Danbooru 側で実在確認する。
```

これを以下に置き換える:
```
   - `search_tags.py` は `tags/*.yml` 内の既存表記と照合するだけで、その表記が実際に Danbooru 上で有効なタグかどうかは保証しない。既存エントリを流用する場合でも、単数/複数形や語形が怪しい場合（例: `sound effect`）は次項と同様に `tools/search_danbooru.py` で実在確認する。
```

- [ ] **Step 2: 手順4（不足タグの追加）の記述を更新する**

現在の記述:
```
   - 追記前に Danbooru でタグの実在を確認する（例: `https://danbooru.donmai.us/tags?search[name_matches]=<タグ>*`）。単数/複数形の思い込み（`sound effect` ではなく `sound effects`、`pastel color` ではなく `pastel colors` 等）や語順違いで存在しないタグを作らないよう注意する。Danbooru に相当タグが無い場合は、それが入力プロンプト由来の独自表現であることを踏まえた上でそのまま追記してよいが、実在しない旨をユーザーへの報告に含める。
```

これを以下に置き換える:
```
   - 追記前に `python tools/search_danbooru.py <タグ> --exact` で Danbooru 実在確認する（例: `python tools/search_danbooru.py "sound effects" --exact`）。`OK` なら実在、`OK(alias)` なら別名経由で実在、`NG` なら実在しない。単数/複数形の思い込み（`sound effect` ではなく `sound effects`、`pastel color` ではなく `pastel colors` 等）や語順違いで存在しないタグを作らないよう注意する。`NG` の場合は正式な表記が無いか `--exact` を外した部分一致検索で確認する。それでも Danbooru に相当タグが無い場合は、それが入力プロンプト由来の独自表現であることを踏まえた上でそのまま追記してよいが、実在しない旨をユーザーへの報告に含める。ツールが「Danbooru タグ CSV が見つかりません」エラーで失敗する場合（`a1111-sd-webui-tagcomplete` 拡張が未導入等）は、この確認手順自体をスキップし、その旨をユーザーへの報告に含めた上で先に進んでよい。
```

- [ ] **Step 3: 更新内容を確認する**

Run:
```bash
grep -n "search_danbooru" ".claude/skills/create-template/SKILL.md"
```

Expected（標準出力、2箇所ヒット。行番号は編集内容により前後する）:
```
52:   - `search_tags.py` は `tags/*.yml` 内の既存表記と照合するだけで、その表記が実際に Danbooru 上で有効なタグかどうかは保証しない。既存エントリを流用する場合でも、単数/複数形や語形が怪しい場合（例: `sound effect`）は次項と同様に `tools/search_danbooru.py` で実在確認する。
55:   - 追記前に `python tools/search_danbooru.py <タグ> --exact` で Danbooru 実在確認する（例: `python tools/search_danbooru.py "sound effects" --exact`）。`OK` なら実在、`OK(alias)` なら別名経由で実在、`NG` なら実在しない。単数/複数形の思い込み（`sound effect` ではなく `sound effects`、`pastel color` ではなく `pastel colors` 等）や語順違いで存在しないタグを作らないよう注意する。`NG` の場合は正式な表記が無いか `--exact` を外した部分一致検索で確認する。それでも Danbooru に相当タグが無い場合は、それが入力プロンプト由来の独自表現であることを踏まえた上でそのまま追記してよいが、実在しない旨をユーザーへの報告に含める。ツールが「Danbooru タグ CSV が見つかりません」エラーで失敗する場合（`a1111-sd-webui-tagcomplete` 拡張が未導入等）は、この確認手順自体をスキップし、その旨をユーザーへの報告に含めた上で先に進んでよい。
```

- [ ] **Step 4: コミットする**

```bash
git add ".claude/skills/create-template/SKILL.md"
git commit -m "docs(create-template): Danbooruタグ実在確認をsearch_danbooru.py利用に更新"
```

## レビュー結果メモ

`plan-reviewer` によるレビュー（🟡 軽微修正後承認）を受け、指摘5件をすべて計画へ取り込んだ（却下0件）。

- 🟡 **`query_partial` の LIKE メタ文字未エスケープ（最重要）**: `normalize()` が空白を `_` に変換した結果を無エスケープで LIKE パターンに使うと、SQLite の LIKE で `_`（任意の1文字）・`%`（任意の0文字以上）がワイルドカードとして解釈され、意図しない文字列にもマッチしてしまう指摘。`escape_like()` ヘルパーを追加し、`%`/`_`/エスケープ文字自体をエスケープした上で `LIKE ? ESCAPE '\\'` を使うよう修正した。
- 🟡 **`ensure_db` の mtime 比較エッジケース**: csv が存在しない場合に `os.path.getmtime` の生 OS エラーが出てしまう指摘。mtime 比較より先に csv の存在確認を行い、分かりやすい `FileNotFoundError` を送出するよう修正した。
- 🟡 **外部拡張への実質的ハード依存**: `a1111-sd-webui-tagcomplete` 未導入時にツールが機能しない点について、SKILL.md 側に「CSV 未検出エラー時は確認手順をスキップして先に進んでよい」旨のフォールバック文を追加した。
- 🟡 **正規化前提の不明示**: `build_db` が name/alias を小文字+アンダースコア区切りの既定形のまま格納する前提（`normalize()` 側もこれに合わせて小文字化する）をコメントで明記した。
- 🟡 **検証コマンドのシェル依存**: ヒアドキュメント・`grep`・`ls` を使う検証ステップは POSIX シェル前提（本環境の primary shell である PowerShell とは異なる）である旨を Global Constraints に明記した。
