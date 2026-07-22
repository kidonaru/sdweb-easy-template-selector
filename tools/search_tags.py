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
