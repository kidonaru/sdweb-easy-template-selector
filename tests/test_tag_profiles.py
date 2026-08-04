#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""tag_profiles の単体テスト。WebUI 非依存で素の Python で実行できる。"""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.tag_profiles import (
    DEFAULT_PROFILE,
    is_valid_profile_name,
    list_profiles,
    resolve_tag_files,
    template_root,
    iter_template_files,
)

failures = []


def check(name, actual, expected):
    if actual != expected:
        failures.append(f"{name}: expected={expected!r} actual={actual!r}")


def make_tree(root):
    """テスト用の tags/ / templates/ ツリーを作る。"""
    tags = Path(root, 'tags')
    (tags / 'anima').mkdir(parents=True)
    (tags / '01_クオリティ.yml').write_text('base', encoding='utf-8')
    (tags / '23_表情.yml').write_text('base', encoding='utf-8')
    (tags / '70_スタイルLoRA.yml').write_text('base', encoding='utf-8')
    (tags / 'anima' / '01_クオリティ.yml').write_text('anima', encoding='utf-8')
    (tags / 'anima' / '_exclude.yml').write_text('- 70_スタイルLoRA\n', encoding='utf-8')
    templates = Path(root, 'templates')
    (templates / '01_SFW').mkdir(parents=True)
    (templates / '01_SFW' / 'a.txt').write_text('x', encoding='utf-8')
    (templates / 'anima' / '01_SFW').mkdir(parents=True)
    (templates / 'anima' / '01_SFW' / 'b.txt').write_text('y', encoding='utf-8')
    return tags, templates


with tempfile.TemporaryDirectory() as root:
    tags_dir, templates_dir = make_tree(root)

    # プロファイル列挙: 既定 + サブディレクトリ
    check('list_profiles', list_profiles(tags_dir), ['illustrious', 'anima'])

    # illustrious はベースのみ
    base = resolve_tag_files(tags_dir, DEFAULT_PROFILE)
    check('base stems', list(base.keys()), ['01_クオリティ', '23_表情', '70_スタイルLoRA'])
    check('base file', base['01_クオリティ'], tags_dir / '01_クオリティ.yml')

    # anima: stem 置換 + _exclude 適用。_exclude.yml 自体はカテゴリに出ない
    anima = resolve_tag_files(tags_dir, 'anima')
    check('anima stems', list(anima.keys()), ['01_クオリティ', '23_表情'])
    check('anima override', anima['01_クオリティ'], tags_dir / 'anima' / '01_クオリティ.yml')

    # 未知プロファイルはベース扱い（起動を止めない）
    check('unknown profile', list(resolve_tag_files(tags_dir, 'なにか').keys()),
          list(base.keys()))

    # テンプレルート解決
    check('root default', template_root(templates_dir, DEFAULT_PROFILE), Path(templates_dir))
    check('root anima', template_root(templates_dir, 'anima'), Path(templates_dir) / 'anima')

    # テンプレ列挙: illustrious はプロファイルディレクトリを除外、anima は配下のみ
    profiles = list_profiles(tags_dir)
    check('templates default',
          iter_template_files(templates_dir, DEFAULT_PROFILE, profiles),
          [Path(templates_dir) / '01_SFW' / 'a.txt'])
    check('templates anima',
          iter_template_files(templates_dir, 'anima', profiles),
          [Path(templates_dir) / 'anima' / '01_SFW' / 'b.txt'])

    # プロファイル名の検証: 区切り文字・親参照・絶対パスは弾く
    check('valid name', is_valid_profile_name('anima'), True)
    check('reject parent', is_valid_profile_name('..'), False)
    check('reject slash', is_valid_profile_name('../../etc'), False)
    check('reject backslash', is_valid_profile_name('..\\secret'), False)
    check('reject empty', is_valid_profile_name(''), False)

    # 不正な名前はディレクトリを外へ出さず、既定プロファイルとして扱う
    check('traversal tags', list(resolve_tag_files(tags_dir, '../..').keys()), list(base.keys()))
    check('traversal root', template_root(templates_dir, '../..'), Path(templates_dir))
    check('traversal templates',
          iter_template_files(templates_dir, '../..', profiles),
          [Path(templates_dir) / '01_SFW' / 'a.txt'])

with tempfile.TemporaryDirectory() as root:
    # 壊れた _exclude.yml・リスト以外の _exclude.yml でも例外を出さず除外なしで続行する
    tags_dir = Path(root, 'tags')
    (tags_dir / 'broken').mkdir(parents=True)
    (tags_dir / '01_クオリティ.yml').write_text('base', encoding='utf-8')
    (tags_dir / 'broken' / '_exclude.yml').write_text('- [', encoding='utf-8')
    check('broken exclude', list(resolve_tag_files(tags_dir, 'broken').keys()), ['01_クオリティ'])

    (tags_dir / 'broken' / '_exclude.yml').write_text('key: value\n', encoding='utf-8')
    check('non-list exclude', list(resolve_tag_files(tags_dir, 'broken').keys()), ['01_クオリティ'])

if failures:
    print('FAIL')
    for f in failures:
        print(' -', f)
    sys.exit(1)
print('OK: test_tag_profiles')
