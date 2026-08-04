"""scripts/template_name_filename.py の単体テスト

対象の整形関数は WebUI に依存しないため、リポジトリルートから素の Python で実行できる。

    python tests/test_template_name_filename.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.template_name_filename import leaf_template_name


def test_takes_leaf_of_slash_path():
    assert leaf_template_name('02_NSFW/おしがま') == 'おしがま'


def test_takes_leaf_of_backslash_path():
    assert leaf_template_name(r'anima\02_NSFW\おしがま') == 'おしがま'


def test_keeps_plain_name_with_spaces():
    assert leaf_template_name('I Need Buzz') == 'I Need Buzz'


def test_trims_surrounding_spaces():
    assert leaf_template_name('  02_NSFW / おしがま  ') == 'おしがま'


def test_returns_empty_for_blank_input():
    assert leaf_template_name('') == ''
    assert leaf_template_name('   ') == ''
    assert leaf_template_name(None) == ''


def test_returns_empty_when_path_ends_with_separator():
    assert leaf_template_name('02_NSFW/') == ''


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
