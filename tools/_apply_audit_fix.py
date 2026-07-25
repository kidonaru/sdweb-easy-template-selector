#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""監査結果をもとにカテゴリコメント行を一括置換する内部ツール。

コメント行 1 行を同じ行番号の 1 行へ置き換えるだけなので行数は変わらず、
1 回の audit() 結果の行番号を全編集で使い回しても破綻しない。
改行コード（CRLF / LF）は元の行のものをそのまま保つ。
"""
import re

from audit_templates import read_lines


def apply(edits):
    """edits: [(file, line, new_head, new_label), ...] を適用し置換件数を返す。"""
    grouped = {}
    for path, line, head, label in edits:
        grouped.setdefault(path, []).append((line, head, label))

    applied = 0
    for path, items in grouped.items():
        lines = read_lines(path)
        for line, head, label in items:
            original = lines[line - 1]
            eol = '\r' if original.endswith('\r') else ''
            indent = re.match(r'\s*', original).group(0)
            lines[line - 1] = '%s# %s (%s),%s' % (indent, head, label, eol)
            applied += 1
        with open(path, 'w', encoding='utf-8', newline='') as fp:
            fp.write('\n'.join(lines))
    return applied
