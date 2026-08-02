"""scripts/exclude_tags.py の単体テスト

対象モジュールは WebUI に依存しないため、リポジトリルートから素の Python で実行できる。

    python tests/test_exclude_tags.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.exclude_tags import (
    apply_excludes_to_prompt_lists,
    parse_exclude_tags,
    remove_excluded_tags,
)


def test_parse_splits_by_comma_and_newline():
    assert parse_exclude_tags('black footwear, black pantyhose,\nsmile') == [
        'black footwear', 'black pantyhose', 'smile'
    ]


def test_parse_drops_empty_and_duplicate():
    assert parse_exclude_tags(' a , , a ,\n\n b ') == ['a', 'b']


def test_parse_accepts_empty_input():
    assert parse_exclude_tags('') == []
    assert parse_exclude_tags(None) == []


def test_remove_drops_matching_tag_and_keeps_separator():
    assert remove_excluded_tags('1girl,solo,', ['solo']) == '1girl,'


def test_remove_keeps_spacing_of_surviving_tags():
    text = 'a, black footwear, b,'
    assert remove_excluded_tags(text, ['black footwear']) == 'a, b,'


def test_remove_keeps_weighted_notation():
    text = '(black footwear:1.2),smile,'
    assert remove_excluded_tags(text, ['black footwear']) == text


def test_remove_is_case_sensitive():
    text = 'Black Footwear,smile,'
    assert remove_excluded_tags(text, ['black footwear']) == text


def test_remove_does_not_match_partially():
    text = 'black footwear focus,smile,'
    assert remove_excluded_tags(text, ['black footwear']) == text


def test_remove_leaves_comment_lines_untouched():
    text = '# 13_衣装 (黒靴),\nblack footwear,smile,'
    assert remove_excluded_tags(text, ['black footwear']) == '# 13_衣装 (黒靴),\nsmile,'


def test_remove_leaves_blank_line_when_all_tags_dropped():
    text = '# 13_衣装 (黒靴),\nblack footwear,\nsmile,'
    assert remove_excluded_tags(text, ['black footwear']) == '# 13_衣装 (黒靴),\n\nsmile,'


def test_remove_handles_escaped_parentheses():
    text = 'mari \\(blue archive\\),smile,'
    assert remove_excluded_tags(text, ['mari \\(blue archive\\)']) == 'smile,'


def test_remove_empties_line_without_trailing_comma():
    # プロンプト末尾など、カンマを伴わず 1 タグだけの行が実在する
    assert remove_excluded_tags('smile,\nblack footwear', ['black footwear']) == 'smile,\n'


def test_remove_returns_input_when_no_excludes():
    text = '1girl,solo,'
    assert remove_excluded_tags(text, []) == text


def test_apply_rewrites_every_list_in_place():
    positives = ['1girl,solo,', 'solo,smile,']
    hires = ['solo,']
    apply_excludes_to_prompt_lists([positives, hires], ['solo'])
    assert positives == ['1girl,', 'smile,']
    assert hires == ['']


def test_apply_does_nothing_without_excludes():
    positives = ['1girl,solo,']
    apply_excludes_to_prompt_lists([positives], [])
    assert positives == ['1girl,solo,']


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
