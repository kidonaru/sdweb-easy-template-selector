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
import glob
import os
import re
import sqlite3
import sys

import yaml

import search_tags

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
    """検索・照合用に、エスケープされた括弧 \\( \\) を通常の括弧へ戻した上で、
    空白をアンダースコアに、小文字に正規化する。

    テンプレート内のタグ表記は AUTOMATIC1111 の強調記法と衝突しないよう
    括弧を \\( \\) とエスケープする慣習があるが、Danbooru タグ名自体には
    バックスラッシュを含まないため、照合前に元の括弧へ戻す必要がある
    （例: "mari \\(blue archive\\)" → 照合用には "mari_(blue_archive)"）。
    """
    text = text.replace("\\(", "(").replace("\\)", ")")
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
