"""除外タグの指定をパースし、プロンプトから取り除く。

WebUI に依存しない純粋モジュール。テストは tests/test_exclude_tags.py。
"""
import re

# 本体・本拡張ともコメントとして扱う行頭記法。カテゴリ情報を持つため除去対象から外す
COMMENT_LINE_HEAD = re.compile(r'^\s*(#|//)')


def parse_exclude_tags(text):
    """除外タグの指定を正規化した一覧に変換する。

    `,` と改行で区切り、前後の空白を落とし、空要素と重複を除く（記述順は保つ）。
    """
    if not text:
        return []

    tags = []
    for token in re.split(r'[,\n]', text):
        tag = token.strip()
        if tag and tag not in tags:
            tags.append(tag)
    return tags


def remove_excluded_tags(prompt, excludes):
    """プロンプトから除外タグと厳密一致する要素を取り除く。

    行ごとに `,` で区切り、`strip()` した結果が除外タグと完全一致する要素だけを落とす。
    大文字小文字の違いと重み記法 `(tag:1.2)` は別物として残す（意図しない消し込みを避けるため）。

    区切りを保つため空要素は落とさない（`1girl,solo,` から solo を消して `1girl,` になる）。
    行の中身がすべて消えた場合は空行として残し、既存の空行削除設定に処理を任せる。

    未対応: `(tag_a, tag_b:1.2)` のようにカッコ内にカンマを含む重み記法。単純な `,` 分割なので
    断片に割れる（現行のテンプレートにこの記法は無い）。
    """
    if not excludes or not prompt:
        return prompt

    exclude_set = set(excludes)
    lines = []
    for line in prompt.split('\n'):
        if COMMENT_LINE_HEAD.match(line):
            lines.append(line)
            continue
        # 空要素は strip() が '' になり除外集合に入らないため、そのまま残る
        kept = [part for part in line.split(',') if part.strip() not in exclude_set]
        lines.append(','.join(kept))
    return '\n'.join(lines)


def apply_excludes_to_prompt_lists(prompt_lists, excludes):
    """複数のプロンプト一覧へまとめて除外を適用する（in-place 書き換え）。

    本体の `p.all_prompts` などがリストの同一性を前提に扱われるため、
    新しいリストを返さず要素を置き換える。
    """
    if not excludes:
        return

    for prompts in prompt_lists:
        for i in range(len(prompts)):
            prompts[i] = remove_excluded_tags(prompts[i], excludes)
