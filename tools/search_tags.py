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

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from scripts.tag_profiles import DEFAULT_PROFILE, EXCLUDE_FILE, list_profiles, resolve_tag_files

# Windows のコンソールは既定で cp932 になり得るため、日本語の出力
# （結果・警告メッセージの両方）が文字化けしないよう明示的に UTF-8 へ固定する。
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

# トップレベルが辞書形式ではない仕様で意図的に作られているファイル。
# 「トップレベルが辞書形式ではない」警告の対象から除外する。
NON_DICT_WARNING_BLACKLIST = {"98_特殊"}


def flatten(node, filename, group=None):
    """YAML ノードを (グループ, ラベル, タグ文字列) のリストへ平坦化する。"""
    entries = []
    if isinstance(node, dict):
        for key, value in node.items():
            if isinstance(value, dict):
                entries.extend(flatten(value, filename, group=key))
            elif isinstance(value, str):
                entries.append((group, key, value))
            else:
                print(
                    f"警告: {filename}.yml の '{key}' はタグ文字列(str)ではないため無視します: {type(value).__name__}",
                    file=sys.stderr,
                )
    return entries


def load_files(stem_path_pairs):
    """(stem, パス) の列を読み込み、(ファイル名, グループ, ラベル, タグ文字列) のリストを返す。

    構文エラーのファイルや、トップレベルが辞書形式でない（リスト等の）
    ファイルは標準エラー出力に警告を出した上でスキップし、他ファイルの
    検索は継続する。
    """
    entries = []
    for filename, path in stem_path_pairs:
        try:
            with open(path, encoding="utf-8") as f:
                data = yaml.safe_load(f)
        except (yaml.YAMLError, OSError, UnicodeDecodeError) as e:
            print(f"警告: {filename}.yml の読み込みに失敗したためスキップします: {e}", file=sys.stderr)
            continue
        if not data:
            continue
        if not isinstance(data, dict):
            if filename not in NON_DICT_WARNING_BLACKLIST:
                print(f"警告: {filename}.yml はトップレベルが辞書形式ではないためスキップします", file=sys.stderr)
            continue
        for group, label, tags in flatten(data, filename):
            entries.append((filename, group, label, tags))
    return entries


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

    def merged_pairs(name):
        return [(stem, str(path)) for stem, path in resolve_tag_files(tags_dir, name).items()]

    if profile is not None:
        return [(None, load_files(merged_pairs(profile)))]

    groups = [(None, load_files(merged_pairs(DEFAULT_PROFILE)))]
    for name in list_profiles(tags_dir):
        if name == DEFAULT_PROFILE:
            continue
        profile_dir = os.path.join(tags_dir, name)
        pairs = []
        for path in sorted(glob.glob(os.path.join(profile_dir, "*.yml"))):
            # 除外判定は tag_profiles と同じ基準にする（片方だけずれると列挙結果が食い違う）
            if os.path.basename(path) == EXCLUDE_FILE:
                continue
            pairs.append((os.path.splitext(os.path.basename(path))[0], path))
        if pairs:
            groups.append((name, load_files(pairs)))
    return groups


def format_comment(filename, group, label):
    """テンプレートのカテゴリコメント行形式 (# カテゴリ:グループ (ラベル),) を生成する。"""
    category = f"{filename}:{group}" if group else filename
    return f"# {category} ({label}),"


def matches(entry, queries_lower, mode, exact):
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
    if exact:
        return any(q == h for q in queries_lower for h in lowered)
    return any(q in h for q in queries_lower for h in lowered)


def search(entries, queries, mode, exact):
    queries_lower = [q.lower() for q in queries]
    return [e for e in entries if matches(e, queries_lower, mode, exact)]


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
    parser.add_argument(
        "--exclude-category",
        nargs="+",
        default=[],
        metavar="PREFIX",
        help=(
            "検索から除外するカテゴリ（ファイル名プレフィックス、複数指定可）。"
            "例: --exclude-category 10_キャラ は 10_キャラ.yml・10_キャラ_LoRA.yml・"
            "10_キャラ_ブルアカ.yml などをまとめて除外する"
        ),
    )
    parser.add_argument(
        "--profile",
        help="プロファイル名（例: anima）。指定時はそのプロファイルのマージ済みセットだけを検索する",
    )
    args = parser.parse_args()

    found = False
    for heading, entries in load_entry_groups(args.tags_dir, args.profile):
        if args.exclude_category:
            entries = [
                e for e in entries
                if not any(e[0].startswith(prefix) for prefix in args.exclude_category)
            ]
        results = search(entries, args.queries, args.mode, args.exact)
        if not results:
            continue
        found = True
        if heading is not None:
            print(f"## プロファイル: {heading}（差し替え分）")
        for filename, group, label, tags in results:
            print(f"{format_comment(filename, group, label)} {tags}")

    if not found:
        print("一致するタグは見つかりませんでした。")


if __name__ == "__main__":
    main()
