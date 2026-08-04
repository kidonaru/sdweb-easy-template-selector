#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""anima プロファイル向けのプロンプト整形（WebUI 非依存の純粋モジュール）。

Anima はカンマ直後にスペースが無いと効きが悪く、BREAK 構文は使用禁止のため、
生成直前にプロンプトを整形する。ルールの出典は docs/anima-prompt-rules.md。
"""
import re

# 整形を適用するプロファイル名。tag_profiles はプロファイルを tags/ のサブディレクトリから
# 動的に発見するため、ディレクトリ名を変えたらここも直すこと（不一致でも例外は出ず、
# 整形が無言で効かなくなるだけなので気付きにくい）
ANIMA_PROFILE = 'anima'

# カンマの直後に空白・改行・行末以外が続く箇所
_COMMA_NO_SPACE_PATTERN = re.compile(r',(?=\S)')

# 単独トークンの BREAK（A1111 構文）。改行を跨いで消費するとカテゴリコメント行が
# 前の行へ連結されてパーサが壊れるため、水平方向の空白だけを巻き込む
_BREAK_PATTERN = re.compile(r'[ \t]*\bBREAK\b[ \t]*')

# BREAK 置換で生じる連続カンマ（同一行内）
_COMMA_RUN_PATTERN = re.compile(r',[ \t]*(?:,[ \t]*)+')


def insert_space_after_comma(prompt):
    """カンマ直後にスペースが無い箇所へ ', ' を補う。既存の空白・改行・行末は触らない。"""
    return _COMMA_NO_SPACE_PATTERN.sub(', ', prompt)


def remove_break(prompt):
    """単独トークンの BREAK を ', ' に置換し、生じた連続カンマを 1 つに畳む。

    単純削除にしないのは、前後にカンマが無い書き方だとタグ同士が連結されるため。
    単独行の BREAK は空行になり、既存の空行削除（format_prompt）が拾う。
    BREAK 由来の箇所以外には触れない（カンマ後スペース挿入は別設定の責務）。
    """
    replaced = _BREAK_PATTERN.sub(', ', prompt)
    collapsed = _COMMA_RUN_PATTERN.sub(', ', replaced)
    # カンマだけになった行（単独行 BREAK 由来）を空行にし、行末の空白を落とす
    collapsed = re.sub(r'^[ \t]*,[ \t]*$', '', collapsed, flags=re.MULTILINE)
    return re.sub(r'[ \t]+$', '', collapsed, flags=re.MULTILINE)
