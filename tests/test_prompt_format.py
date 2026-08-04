"""scripts/prompt_format.py の単体テスト

対象モジュールは WebUI に依存しないため、リポジトリルートから素の Python で実行できる。

    python tests/test_prompt_format.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.prompt_format import insert_space_after_comma, remove_break


def test_space_inserted_after_comma():
    assert insert_space_after_comma('1girl,looking at viewer') == '1girl, looking at viewer'


def test_space_not_duplicated():
    assert insert_space_after_comma('1girl, smile') == '1girl, smile'


def test_space_keeps_newline_after_comma():
    assert insert_space_after_comma('1girl,\nsmile') == '1girl,\nsmile'


def test_space_keeps_trailing_comma():
    assert insert_space_after_comma('1girl,') == '1girl,'


def test_space_keeps_weight_notation():
    assert insert_space_after_comma('(black hair:1.2),smile') == '(black hair:1.2), smile'


def test_break_replaced_with_comma():
    assert remove_break('1girl BREAK smile') == '1girl, smile'


def test_break_after_comma_collapses():
    assert remove_break('1girl, BREAK smile') == '1girl, smile'


def test_break_partial_word_untouched():
    assert remove_break('breakdance, jailbreak, xBREAKy') == 'breakdance, jailbreak, xBREAKy'


def test_break_lowercase_untouched():
    assert remove_break('1girl break smile') == '1girl break smile'


def test_break_on_own_line_leaves_blank_line():
    # 単独行の BREAK は空行になる（既存の空行削除に拾わせる）。改行は跨いで消費しない
    assert remove_break('1girl,\nBREAK\nsmile,') == '1girl,\n\nsmile,'


def test_break_does_not_join_comment_line():
    # 改行を消費するとコメント行が前の行へ連結されてパーサが壊れるため
    text = 'tag BREAK\n# 10_キャラ (誰か),'
    assert remove_break(text) == 'tag,\n# 10_キャラ (誰か),'


def test_break_does_not_touch_unrelated_commas():
    # remove_break は BREAK 由来の箇所以外にスペースを挿入しない（2 設定の独立性）
    assert remove_break('a,b BREAK c') == 'a,b, c'


if __name__ == '__main__':
    failures = 0
    for name, func in sorted(globals().items()):
        if not name.startswith('test_') or not callable(func):
            continue
        try:
            func()
            print(f'PASS {name}')
        except AssertionError as error:
            failures += 1
            print(f'FAIL {name}: {error}')
    print(f'\n{failures} failed')
    sys.exit(1 if failures else 0)
