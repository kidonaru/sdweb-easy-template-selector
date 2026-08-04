#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""templates/ のカテゴリコメントと tags/*.yml の整合を監査する。

不整合は 2 種類に分類する:
  GROUP_MISMATCH : ラベルは同カテゴリ内に存在するが、コメントのグループ名が違う（または欠落）
  NOT_FOUND      : ラベル自体がカテゴリ内に存在しない
"""
import argparse
import collections
import json
import os
import re
import sys

import yaml

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from scripts.tag_profiles import DEFAULT_PROFILE, list_profiles, resolve_tag_files

TAGS_DIR = 'tags'
TEMPLATES_DIR = 'templates'

# JS 実装 (ets_prompt_editor.js parseSection) と同じ解釈。末尾の ')' にアンカーするため
# ラベル内の入れ子カッコ（例: マリー(体操服)）も正しく取り出せる。
LABEL_RE = re.compile(r'^(.*?)\s*\((.*?)\)$')
# 「(tag:1.2)」形式の重みのみを剥がす。「:d」等の顔文字タグを壊さないよう、
# コロンの後ろが数値で、かつ ')' / 行末 / ',' に続く場合だけを重みとみなす。
WEIGHT_RE = re.compile(r':\s*\d+(?:\.\d+)?\s*(?=\)|$|,)')


def normalize(value):
    """重み記法・空白・タグ順序を無視した比較用キーへ正規化する。"""
    value = WEIGHT_RE.sub('', value.strip().rstrip(','))
    value = value.replace('(', '').replace(')', '')
    value = re.sub(r'\s+', ' ', value)
    return ','.join(sorted(t.strip() for t in value.split(',') if t.strip())).lower()


def load_tags(tags_dir=TAGS_DIR, profile=DEFAULT_PROFILE):
    """profile のマージ済みタグセットを読み込み {(カテゴリ, グループ, ラベル): タグ文字列} を返す。

    98_特殊.yml のようなリスト形式のファイルはカテゴリコメントを持たないため対象外。
    """
    entries = {}
    for category, path in resolve_tag_files(tags_dir, profile).items():
        with open(path, encoding='utf-8') as fp:
            data = yaml.safe_load(fp) or {}
        if not isinstance(data, dict):
            continue
        for key, value in data.items():
            if isinstance(value, dict):
                for label, tag in value.items():
                    entries[(category, str(key), str(label))] = str(tag).strip()
            elif not isinstance(value, list):
                entries[(category, None, str(key))] = str(value).strip()
    return entries


def read_lines(path):
    """改行変換を行わずに読み込み、行末の \\r を保ったままの行リストを返す。"""
    with open(path, encoding='utf-8', newline='') as fp:
        return fp.read().split('\n')


def iter_comments(templates_dir=TEMPLATES_DIR):
    """templates 配下の全 .txt からカテゴリコメント行を列挙する。"""
    for dirpath, _, filenames in os.walk(templates_dir):
        for name in sorted(filenames):
            if not name.endswith('.txt'):
                continue
            path = os.path.join(dirpath, name).replace(os.sep, '/')
            lines = read_lines(path)
            for index, raw in enumerate(lines):
                line = raw.rstrip('\r')
                if not line.lstrip().startswith('#'):
                    continue
                body = re.sub(r'^\s*#\s*', '', line)
                if not body.endswith(','):
                    continue
                matched = LABEL_RE.match(body[:-1])
                if not matched:
                    continue
                next_line = ''
                if index + 1 < len(lines):
                    next_line = re.sub(r'^Negative prompt:\s*', '', lines[index + 1].rstrip('\r').strip())
                yield path, index + 1, matched.group(1).strip(), matched.group(2).strip(), next_line


def profile_of(path, templates_dir, profiles):
    """テンプレパスの先頭ディレクトリからプロファイルを判定する。"""
    rel = os.path.relpath(path, templates_dir)
    head = rel.replace(os.sep, '/').split('/')[0]
    return head if head in profiles else DEFAULT_PROFILE


def audit(tags_dir=TAGS_DIR, templates_dir=TEMPLATES_DIR):
    profiles = list_profiles(tags_dir)
    # プロファイルごとのタグセットと逆引き表を遅延構築する
    entries_by_profile = {}
    by_value_by_profile = {}

    def tables(profile):
        if profile not in entries_by_profile:
            entries = load_tags(tags_dir, profile)
            by_value = collections.defaultdict(list)
            for key, value in entries.items():
                by_value[normalize(value)].append(key)
            entries_by_profile[profile] = entries
            by_value_by_profile[profile] = by_value
        return entries_by_profile[profile], by_value_by_profile[profile]

    findings = []
    for path, lineno, head, label, tag in iter_comments(templates_dir):
        entries, by_value = tables(profile_of(path, templates_dir, profiles))
        # 「@カテゴリ@」記法はランダム指定でラベルが「ランダム」固定になる仕様のため除外する
        if tag.startswith('@'):
            continue
        category, _, group = head.partition(':')
        group = group or None
        if (category, group, label) in entries:
            continue
        same_label = [k for k in entries if k[0] == category and k[2] == label]
        findings.append({
            'kind': 'GROUP_MISMATCH' if same_label else 'NOT_FOUND',
            'file': path,
            'line': lineno,
            'head': head,
            'label': label,
            'tag': tag,
            'same_label': ['%s:%s(%s)' % k for k in same_label],
            'candidates': ['%s:%s(%s)' % k for k in by_value.get(normalize(tag), [])],
        })
    return findings


def main():
    parser = argparse.ArgumentParser(description='templates と tags の参照整合を監査する')
    parser.add_argument('--json', metavar='PATH', help='結果を JSON で書き出す')
    args = parser.parse_args()

    findings = audit()
    mismatch = [f for f in findings if f['kind'] == 'GROUP_MISMATCH']
    not_found = [f for f in findings if f['kind'] == 'NOT_FOUND']

    print('GROUP_MISMATCH: %d 件' % len(mismatch))
    for f in mismatch:
        print('  %s:%d # %s (%s) -> %s' % (f['file'], f['line'], f['head'], f['label'], f['same_label']))
    print('NOT_FOUND: %d 件' % len(not_found))
    for f in not_found:
        print('  %s:%d # %s (%s) tags=%s 値一致=%s'
              % (f['file'], f['line'], f['head'], f['label'], f['tag'][:50], f['candidates']))
    print('合計: %d 件' % len(findings))

    if args.json:
        with open(args.json, 'w', encoding='utf-8') as fp:
            json.dump(findings, fp, ensure_ascii=False, indent=1)
    return 1 if findings else 0


if __name__ == '__main__':
    sys.exit(main())
