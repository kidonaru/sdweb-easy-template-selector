# tags / templates 整理 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** よく使うネガティブをセット化し、23_表情 の口関連タグを 24_口の形 へ移し、templates と tags の参照不整合 106 件を解消する。

**Architecture:** tags/*.yml と templates/**/*.txt のみを変更する。JavaScript / Python の実装は変更しない。検証手段としてカテゴリコメントと YAML を突き合わせる監査スクリプト `tools/audit_templates.py` を新規追加し、各タスクの前後で実行して件数の増減を確認する。

**Tech Stack:** Python 3（PyYAML）、既存の `tools/search_tags.py` / `tools/search_danbooru.py`

## Global Constraints

- 思考は英語、回答・コメント・エラーメッセージは日本語。
- **作業ディレクトリはリポジトリルート** `C:\tools\StabilityMatrix\Data\Packages\Stable Diffusion WebUI reForge\extensions\sdweb-easy-template-selector`。本計画のスクリプトは `tags` / `templates` を相対パスで参照するため、必ずルートで実行する。
- **シェルは Bash ツールを使う**（PowerShell では `PYTHONIOENCODING=utf-8 python ...` や `tail` / `grep` が動かない）。
- **改行コードを保存すること。** `templates/*.txt` は 38/38 ファイル、`tags/*.yml` は 45/47 ファイルが CRLF。`core.autocrlf=true` のため改行だけの変化は `git diff` に現れず検証をすり抜ける。ファイルを書き換えるスクリプトは必ず `open(path, encoding='utf-8', newline='')` で読み、行ごとの `\r` を保ったまま書き戻す。
- カテゴリコメント行は `# カテゴリ[:グループ] (ラベル),` 形式を厳守する。ラベルに入れ子カッコ（`マリー(体操服)` 等）が含まれるケースが templates に 49 行、tags に 775 ラベル存在する。パースは JS 実装（`javascript/ets_prompt_editor.js:27` の `/^(.*?)\s*\((.*?)\)$/`）と同じく**末尾の `)` にアンカーする貪欲マッチ**で行う（`([^)]*)` のような文字クラスでは取りこぼす）。
- YAML ファイル名の命名規則 `番号_カテゴリ名[_サブ分類].yml` と番号帯を維持する。
- `javascript/js-yaml.min.js` は編集しない。
- タグ文字列は Danbooru 実在表記を優先する（`tools/search_danbooru.py --exact`）。置換した内容は必ず報告する。
- 強度修飾語はタグ本体に含めず重み指定へ変換する（YAML は素のタグ、重みはテンプレ側のみ）。
- LoRA タグ（`<lora:...>`）とトリガーワードは Danbooru 実在確認も表記変更もしない。
- **既存 YAML エントリは変更しない（追記のみ）。重複エントリを新規追加しない。** 追記前に必ず `tools/search_tags.py` で確認する。
- **`tags/` と `templates/` は git 管理下**（`git ls-files tags` = 43、`templates` = 38）。`.gitignore` の対象は `tags/*_.yml` と `templates/*_` のみ。したがって失敗時は git で戻せる。
- 各タスクの一括書き換えの前に `git status --short` で作業ツリーがクリーンなことを確認する。失敗したら `git restore tags templates`（未コミット時）または `git revert <sha>`（コミット後）で戻す。
- 本計画のスコープ外: `10_キャラ_ブルアカ*.yml` のタグ値完全重複エントリ、`98_特殊.yml` のリスト形式（ユーザー確認済みで意図的）、`97_Color.yml` / `98_特殊.yml` は `isForceAddCategory()` によりコメント行を持たないため監査対象外。

## ベースライン（実測値）

再監査の結果、カテゴリコメント行は全 1022 行。うち不整合は **106 件（延べ）**。

| 分類 | 延べ件数 | 内容 |
|---|---|---|
| GROUP_MISMATCH | 47 | ラベルは同カテゴリに存在するが、グループ名が欠落／誤り |
| NOT_FOUND（単一候補） | 44 | ラベルは無いが、タグ値が一致する既存エントリが 1 件だけある |
| NOT_FOUND（複数候補） | 2 | 同上だが候補が複数あり、手動判断が要る |
| NOT_FOUND（候補なし） | 13 | タグ値に一致する既存エントリが無い |

**件数の推移（各タスクの完了判定）:**

| 時点 | 合計 |
|---|---|
| ベースライン | 106 |
| Task 2 完了後 | 106（`ソース` の移動先はテンプレから参照されなくなるため増減なし） |
| Task 3 の YAML 編集直後（テンプレ未更新） | 118 |
| Task 3 完了後 | 106 |
| Task 4 完了後 | 59 |
| Task 5 完了後 | 13 |
| Task 6-A 完了後 | 2 |
| Task 6-B 完了後 | 0 |

---

## File Structure

| ファイル | 責務 | 本計画での扱い |
|---|---|---|
| `tools/audit_templates.py` | カテゴリコメントと tags/*.yml の整合を検査・分類して出力する | 新規作成（Task 1） |
| `tools/_apply_audit_fix.py` | 監査結果をもとにコメント行を一括置換する（改行保存つき） | 新規作成（Task 1）、Task 4・5 で使用 |
| `tags/99_ネガティブ.yml` | ネガティブタグ定義 | `ソース` を `グラフィック:` へ移動し `画風混入防止` を追加（Task 2） |
| `tags/23_表情.yml` | 表情タグ定義 | `基本:` から口関連 5 エントリを削除（Task 3） |
| `tags/24_口の形.yml` | 口の形タグ定義 | `基本:` グループ新設（Task 3） |
| `tags/14_衣装小物.yml` | 衣装小物タグ定義 | 未登録タグ 1 件の追記（Task 6-B） |
| `templates/**/*.txt` | プロンプトテンプレート | ネガティブ 3 セクションのセット化（Task 2）、コメント行の修正（Task 3〜6）、タグ行の修正（Task 6） |

---

## Task 1: 監査スクリプトと一括置換ツールの追加

このリポジトリにはテスト基盤が無いため、本タスクで作るスクリプトが以降の全タスクの検証手段になる。

**Files:**
- Create: `tools/audit_templates.py`
- Create: `tools/_apply_audit_fix.py`

**Interfaces:**
- Produces: `audit_templates.audit() -> list[dict]`。各要素のキーは `kind` / `file` / `line` / `head` / `label` / `tag` / `same_label` / `candidates`。`kind` は `'GROUP_MISMATCH'` または `'NOT_FOUND'`。
- Produces: `audit_templates.load_tags() -> dict[(category, group, label), tag]`。グループ無しの YAML は `group=None`。
- Produces: CLI `python tools/audit_templates.py [--json <path>]`。不整合が 1 件以上なら終了コード 1。
- Produces: `_apply_audit_fix.apply(edits)`。`edits` は `[(file, line, new_head, new_label), ...]`。改行コードを保存したままコメント行を置換し、置換件数を返す。行数は変えない。

- [ ] **Step 1: `tools/audit_templates.py` を作成する**

```python
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


def load_tags(tags_dir=TAGS_DIR):
    """tags/*.yml を読み込み {(カテゴリ, グループ, ラベル): タグ文字列} を返す。

    98_特殊.yml のようなリスト形式のファイルはカテゴリコメントを持たないため対象外。
    """
    entries = {}
    for name in sorted(os.listdir(tags_dir)):
        if not name.endswith('.yml'):
            continue
        category = name[:-4]
        with open(os.path.join(tags_dir, name), encoding='utf-8') as fp:
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


def audit(tags_dir=TAGS_DIR, templates_dir=TEMPLATES_DIR):
    entries = load_tags(tags_dir)
    by_value = collections.defaultdict(list)
    for key, value in entries.items():
        by_value[normalize(value)].append(key)

    findings = []
    for path, lineno, head, label, tag in iter_comments(templates_dir):
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
```

- [ ] **Step 2: `tools/_apply_audit_fix.py` を作成する**

```python
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
```

- [ ] **Step 3: ベースラインを確認する**

Run（Bash ツール、リポジトリルートで実行）:
```bash
PYTHONIOENCODING=utf-8 python tools/audit_templates.py | tail -3
```
Expected:
```
NOT_FOUND: 59 件
...
合計: 106 件
```
`GROUP_MISMATCH: 47 件` / `NOT_FOUND: 59 件` / `合計: 106 件` であること。

**この数値と食い違う場合は以降のタスクへ進まず、差分の原因を報告すること。**

- [ ] **Step 4: コミット**

```bash
git add tools/audit_templates.py tools/_apply_audit_fix.py
git commit -m "feat(tools): templates とタグ定義の参照整合を監査するスクリプトを追加"
```

---

## Task 2: ネガティブのセット化と既存テンプレへの適用

**Files:**
- Modify: `tags/99_ネガティブ.yml`
- Modify: `templates/02_NSFW/*.txt`（29 ファイル）

3 つの変更を行う。

1. `ソース: source pony,source furry,source cartoon` を `その他:` から `グラフィック:` へ移動する（画風系のため）
2. `グラフィック:` に `画風混入防止` を新設する。**`sunburn` は画風ではないので含めない**
3. 既存 29 テンプレートで、連続する 3 セクション（ソース / コミック調 / 3Dレンダー）を `画風混入防止` の 1 セクションへ置き換える。`日焼け跡` はその下に独立セクションとして残す

`グラフィック:コミック調` / `グラフィック:3Dレンダー` / `人体:日焼け跡` は個別使用のため**削除せず残す**。

置き換えの before / after:

```
# 99_ネガティブ:その他 (ソース),                    →  # 99_ネガティブ:グラフィック (画風混入防止),
source pony,source furry,source cartoon,             source pony,source furry,source cartoon,comic,source filmmaker,3D,
# 99_ネガティブ:グラフィック (コミック調),          # 99_ネガティブ:人体 (日焼け跡),
comic,                                               (sunburn:1.2),
# 99_ネガティブ:グラフィック (3Dレンダー),
source filmmaker,3D,
# 99_ネガティブ:人体 (日焼け跡),
(sunburn:1.2),
```

タグ列は完全に同一のため**生成結果は変わらない**。

- [ ] **Step 1: 作業ツリーがクリーンなことを確認する**

Run:
```bash
git status --short
```
Expected: 出力なし。

- [ ] **Step 2: 対象テンプレートが全件同一の並びであることを確認する**

置換をかける前に、29 ファイルすべてが想定どおりの 6 行ブロックを持つことを確認する。

```python
import os

BLOCK = [
    '# 99_ネガティブ:その他 (ソース),',
    'source pony,source furry,source cartoon,',
    '# 99_ネガティブ:グラフィック (コミック調),',
    'comic,',
    '# 99_ネガティブ:グラフィック (3Dレンダー),',
    'source filmmaker,3D,',
]

ok, ng = [], []
for dirpath, _, filenames in os.walk('templates'):
    for name in sorted(filenames):
        if not name.endswith('.txt'):
            continue
        path = os.path.join(dirpath, name)
        lines = [l.rstrip('\r\n') for l in open(path, encoding='utf-8')]
        hits = [i for i, l in enumerate(lines) if l == BLOCK[0]]
        if not hits:
            continue
        (ok if lines[hits[0]:hits[0] + 6] == BLOCK else ng).append(path)
print('完全一致: %d 件' % len(ok))
print('不一致: %d 件' % len(ng))
for p in ng:
    print(' ', p)
```

Expected: `完全一致: 29 件` / `不一致: 0 件`。**不一致が 1 件でもあれば置換せず報告する。**

- [ ] **Step 3: `tags/99_ネガティブ.yml` の `その他:` から `ソース` を削除する**

以下の 1 行（`グラフィック:` ではなく `その他:` グループ内）を削除する:

```yaml
  ソース: source pony,source furry,source cartoon
```

- [ ] **Step 4: `tags/99_ネガティブ.yml` の `グラフィック:` に 2 行を追記する**

`グラフィック:` グループ末尾（`コミック調: comic` の次）に追加する:

```yaml
  ソース: source pony,source furry,source cartoon
  画風混入防止: source pony,source furry,source cartoon,comic,source filmmaker,3D
```

- [ ] **Step 5: YAML 構文とエントリを確認する**

Run:
```bash
python -c "import yaml, sys; yaml.safe_load(open(sys.argv[1], encoding='utf-8'))" tags/99_ネガティブ.yml && echo OK
PYTHONIOENCODING=utf-8 python tools/search_tags.py --exact "ソース" "画風混入防止"
```
Expected: `OK` に続き、`# 99_ネガティブ:グラフィック (ソース), ...` と `# 99_ネガティブ:グラフィック (画風混入防止), ...` が各 1 行。`その他` の行が出ないこと。

- [ ] **Step 6: 29 テンプレートの 6 行を 4 行へ置換する**

行数が変わる編集のため、行番号ベースではなくブロック一致で置換する。

```python
import os
import sys

sys.path.insert(0, 'tools')
from audit_templates import read_lines

BLOCK = [
    '# 99_ネガティブ:その他 (ソース),',
    'source pony,source furry,source cartoon,',
    '# 99_ネガティブ:グラフィック (コミック調),',
    'comic,',
    '# 99_ネガティブ:グラフィック (3Dレンダー),',
    'source filmmaker,3D,',
]
REPLACEMENT = [
    '# 99_ネガティブ:グラフィック (画風混入防止),',
    'source pony,source furry,source cartoon,comic,source filmmaker,3D,',
]

changed = 0
for dirpath, _, filenames in os.walk('templates'):
    for name in sorted(filenames):
        if not name.endswith('.txt'):
            continue
        path = os.path.join(dirpath, name)
        lines = read_lines(path)
        stripped = [l.rstrip('\r') for l in lines]
        hits = [i for i in range(len(stripped) - 5) if stripped[i:i + 6] == BLOCK]
        if not hits:
            continue
        index = hits[0]
        eol = '\r' if lines[index].endswith('\r') else ''
        lines[index:index + 6] = ['%s%s' % (t, eol) for t in REPLACEMENT]
        with open(path, 'w', encoding='utf-8', newline='') as fp:
            fp.write('\n'.join(lines))
        changed += 1
print('置換: %d ファイル' % changed)
```

Expected: `置換: 29 ファイル`

- [ ] **Step 7: 監査に退行が無いことを確認する**

Run:
```bash
PYTHONIOENCODING=utf-8 python tools/audit_templates.py | tail -1
```
Expected: `合計: 106 件`

`ソース` の移動先グループを templates 側から参照しなくなったため、この移動で不整合は増えない。件数が増えた場合は Step 6 の置換が一部漏れているので調査すること。

- [ ] **Step 8: 生成されるネガティブが変わっていないことを確認する**

Run:
```bash
git diff templates | grep -E '^\+' | grep -v '^\+\+' | grep -v '^\+\s*#' | sort -u
```
Expected: `+source pony,source furry,source cartoon,comic,source filmmaker,3D,` の 1 行のみ。削除された `+comic,` / `+source filmmaker,3D,` 相当の内容がこの 1 行に吸収されている。

- [ ] **Step 9: 改行コードが保たれていることを確認する**

Run:
```bash
PYTHONIOENCODING=utf-8 python -c "
import os
bad = []
for dirpath, _, filenames in os.walk('templates'):
    for name in filenames:
        if not name.endswith('.txt'):
            continue
        path = os.path.join(dirpath, name)
        data = open(path, 'rb').read()
        if data.count(b'\r\n') and data.count(b'\n') != data.count(b'\r\n'):
            bad.append(path)
print('改行混在:', bad if bad else 'なし')
"
```
Expected: `改行混在: なし`

- [ ] **Step 10: コミット**

```bash
git add tags/99_ネガティブ.yml templates
git commit -m "feat(tags): ネガティブの画風系タグをセット化し既存テンプレへ適用"
```

---

## Task 3: 口関連タグを 24_口の形 へ移動

**Files:**
- Modify: `tags/23_表情.yml`
- Modify: `tags/24_口の形.yml`
- Modify: `templates/**/*.txt`（コメント行 12 箇所）

移動対象は `基本:` の 5 エントリのみ。`絵文字:` の「# 口の表現」ブロックと `オリジナル:` の複合エントリは 23_表情 に残す（ユーザー決定）。

| ラベル | タグ | 移動前 | 移動後 |
|---|---|---|---|
| 唇 | `lips` | `23_表情:基本` | `24_口の形:基本` |
| 半開きの唇 | `parted lips` | `23_表情:基本` | `24_口の形:基本` |
| 口を開く | `open mouth` | `23_表情:基本` | `24_口の形:基本` |
| 口を閉じる | `closed mouth` | `23_表情:基本` | `24_口の形:基本` |
| 舌を出す | `tongue out` | `23_表情:基本` | `24_口の形:基本` |

`23_表情:オリジナル (舌を出す)`（`open mouth,tongue out`）は同名ラベルだが別グループの複合エントリのため**移動しない**。

- [ ] **Step 1: 作業ツリーがクリーンなことを確認する**

Run:
```bash
git status --short
```
Expected: 出力なし。

- [ ] **Step 2: `tags/24_口の形.yml` の先頭に `基本:` グループを追加する**

ファイル冒頭（既存の `JujoHotaru:` の前）に挿入:

```yaml
基本:
  唇: lips
  半開きの唇: parted lips
  口を開く: open mouth
  口を閉じる: closed mouth
  舌を出す: tongue out

```

- [ ] **Step 3: `tags/23_表情.yml` の `基本:` から 5 行を削除する**

以下 5 行（現状 22〜26 行目、`喘ぎ声: moaning` の次〜`つり上がった眉:` の前）を削除する:

```yaml
  唇: lips
  半開きの唇: parted lips
  口を開く: open mouth
  口を閉じる: closed mouth
  舌を出す: tongue out
```

削除後、`基本:` は `喘ぎ声: moaning` の次が `つり上がった眉: raised inner eyebrows` になる。

- [ ] **Step 4: YAML 構文を確認する**

Run:
```bash
for f in tags/23_表情.yml tags/24_口の形.yml; do
  python -c "import yaml, sys; yaml.safe_load(open(sys.argv[1], encoding='utf-8'))" "$f" && echo "OK $f"
done
```
Expected: 2 行とも `OK <path>`。

- [ ] **Step 5: 参照切れが 12 件増えたことを確認する**

Run:
```bash
PYTHONIOENCODING=utf-8 python tools/audit_templates.py | tail -1
```
Expected: `合計: 118 件`（106 + 12）。テンプレ未更新のため一時的に増えるのが正しい。

- [ ] **Step 6: templates のコメント行を一括置換する**

以下を `python -` で実行する:

```python
import os
import re
import sys

sys.path.insert(0, 'tools')
from audit_templates import read_lines

TARGETS = ['唇', '半開きの唇', '口を開く', '口を閉じる', '舌を出す']
pattern = re.compile(r'^(\s*#\s*)23_表情:基本(\s*\((?:' + '|'.join(map(re.escape, TARGETS)) + r')\),)(\r?)$')

changed = 0
for dirpath, _, filenames in os.walk('templates'):
    for name in filenames:
        if not name.endswith('.txt'):
            continue
        path = os.path.join(dirpath, name)
        lines = read_lines(path)
        hit = False
        for index, line in enumerate(lines):
            matched = pattern.match(line)
            if matched:
                lines[index] = '%s24_口の形:基本%s%s' % (matched.group(1), matched.group(2), matched.group(3))
                hit = True
                changed += 1
        if hit:
            with open(path, 'w', encoding='utf-8', newline='') as fp:
                fp.write('\n'.join(lines))
print('置換: %d 件' % changed)
```

Expected: `置換: 12 件`（半開きの唇 5 / 口を閉じる 4 / 口を開く 2 / 舌を出す 1）。

- [ ] **Step 7: 監査がベースラインに戻ったことを確認する**

Run:
```bash
PYTHONIOENCODING=utf-8 python tools/audit_templates.py | tail -1
```
Expected: `合計: 106 件`。118 のままなら置換が効いていないので Step 6 をやり直す。

- [ ] **Step 8: 改行コードが保たれていることを確認する**

Run:
```bash
PYTHONIOENCODING=utf-8 python -c "
import os
bad = []
for dirpath, _, filenames in os.walk('templates'):
    for name in filenames:
        if not name.endswith('.txt'):
            continue
        path = os.path.join(dirpath, name)
        data = open(path, 'rb').read()
        if data.count(b'\r\n') and data.count(b'\n') != data.count(b'\r\n'):
            bad.append(path)
print('改行混在:', bad if bad else 'なし')
"
```
Expected: `改行混在: なし`

- [ ] **Step 9: コミット**

```bash
git add tags/23_表情.yml tags/24_口の形.yml templates
git commit -m "refactor(tags): 23_表情 の口関連タグを 24_口の形 へ移動"
```

---

## Task 4: グループ名欠落 47 件の補完

**Files:**
- Modify: `templates/**/*.txt`

`# 23_表情 (絶望),` のようにグループ名が抜けている／誤っているコメントを、実在するグループ名付きに書き換える。ラベルは同一カテゴリ内に存在するため、**タグ行は一切変更しない**。

内訳（延べ 47 件 / ラベル 43 種）: `33_状況` 系が最多で、`# 33_状況 (愛液)` → `# 33_状況:基本 (愛液)`、`# 33_状況:基本 (顔射)` → `# 33_状況:精液 (顔射)` のようにグループを補正する。`50_背景` / `30_ポーズ` / `23_表情` は大半が `:オリジナル` の欠落。

- [ ] **Step 1: 作業ツリーがクリーンなことを確認する**

Run:
```bash
git status --short
```
Expected: 出力なし。

- [ ] **Step 2: 一括補完スクリプトを実行する**

```python
import sys

sys.path.insert(0, 'tools')
from audit_templates import audit, load_tags
from _apply_audit_fix import apply

entries = load_tags()
findings = [f for f in audit() if f['kind'] == 'GROUP_MISMATCH']

edits = []
ambiguous = []
for f in findings:
    category = f['head'].partition(':')[0]
    same = [k for k in entries if k[0] == category and k[2] == f['label']]
    if len(same) > 1:
        # タグ行の値が一致するグループへ絞り込む
        from audit_templates import normalize
        narrowed = [k for k in same if normalize(entries[k]) == normalize(f['tag'])]
        if len(narrowed) != 1:
            ambiguous.append((f['file'], f['line'], f['head'], f['label'], [k[1] for k in same]))
            continue
        same = narrowed
    target = same[0]
    head = target[0] if target[1] is None else '%s:%s' % (target[0], target[1])
    edits.append((f['file'], f['line'], head, target[2]))

print('補完: %d 件' % apply(edits))
print('AMBIGUOUS: %d 件' % len(ambiguous))
for a in ambiguous:
    print(' ', a)
```

Expected: `補完: 47 件` / `AMBIGUOUS: 0 件`。

`AMBIGUOUS` が 1 件以上出た場合は、その明細を**ユーザーに報告して指示を仰ぐ**。勝手にどちらかを選ばない。

- [ ] **Step 3: 監査で GROUP_MISMATCH が 0 になったことを確認する**

Run:
```bash
PYTHONIOENCODING=utf-8 python tools/audit_templates.py | grep -E '^(GROUP_MISMATCH|NOT_FOUND|合計)'
```
Expected: `GROUP_MISMATCH: 0 件` / `NOT_FOUND: 59 件` / `合計: 59 件`

- [ ] **Step 4: コメント行以外が変更されていないことを確認する**

Run:
```bash
git diff templates | grep -E '^[+-]' | grep -v '^[+-][+-]' | grep -v '^[+-]\s*#' | head
```
Expected: 何も出力しない。出力があればコミットせずに原因を報告する。

- [ ] **Step 5: 改行コードが保たれていることを確認する**

Task 3 Step 8 と同じスクリプトを実行する。Expected: `改行混在: なし`

- [ ] **Step 6: コミット**

```bash
git add templates
git commit -m "fix(templates): カテゴリコメントの欠落したグループ名を補完"
```

---

## Task 5: 参照切れ 46 件を既存エントリへ再接続

**Files:**
- Modify: `templates/**/*.txt`

タグ行の値（重み記法を除いた正規化後）と一致する既存エントリが別ラベル／別カテゴリに存在するケース。**コメント行のみ**を書き換え、タグ行は変更しない。

候補が 1 件だけの 44 件は自動、候補が複数の 2 件は下表に従い手動で対応する。

### 自動対応（候補 1 件・延べ 44 件）

代表例:

| 現在のコメント | 正しいコメント | 件数 |
|---|---|---|
| `# 01_クオリティ:Model (Nova Anime XL),` | `# 01_クオリティ:Model (Nova Anime XL v6.0),` | 12 |
| `# 23_表情:基本 (よだれ),` | `# 33_状況:基本 (よだれ),` | 3 |
| `# 41_フォーカス (閉じた膣口),` | `# 33_状況:基本 (閉じた膣口),` | 3 |
| `# 41_フォーカス (クローズアップの女性器),` | `# 41_フォーカス (女性器のクローズアップ),` | 2 |
| `# 14_衣装小物 (仕込みローター),` | `# 15_衣装状態:bolero537 (仕込みローター),` | 2 |
| `# 15_衣装状態:オリジナル (服が透ける),` | `# 15_衣装状態_基本:基本 (透けた服),` | 2 |
| `# 30_ポーズ:LoRA (...),` 各種 | `# 30_ポーズ_LoRA:LoRA (...),` | 4 |
| `# 30_ポーズ:オリジナル (触手による拘束/横になる),` 他 | `# 30_ポーズ_NSFW:オリジナル (...),` | 2 |
| `# 76_スタイル_LoRA (PowerPuffMixLora),` | `# 70_スタイルLoRA (PowerPuffMixLora),` | 1 |
| `# 20_目の状態 (半目2),` | `# 20_目の状態 (半目),` | 1 |
| `# 21_視線 (何かを見ている),` | `# 21_視線 (横を見ている),` | 1 |
| `# 40_アングル (上から見下ろす斜めアングル),` | `# 40_アングル (上から見下ろす(傾け)),` | 1 |
| `# 40_アングル (主観(オランダアングル)),` | `# 40_アングル (主観(傾け)),` | 1 |
| `# 41_フォーカス (上半身と顔にフォーカス),` | `# 41_フォーカス (上半身と顔),` | 1 |
| `# 41_フォーカス (顔にフォーカス),` | `# 41_フォーカス (顔),` | 1 |
| `# 61_テーマ (ピンク),` | `# 61_テーマ (ピンク色[#FFC0CB]),` | 1 |
| `# 15_衣装状態:オリジナル (裸),` | `# 15_衣装状態_基本:露出 (完全に裸),` | 1 |
| `# 23_表情:絵文字 (笑顔),` | `# 23_表情:絵文字 (:d 笑顔),` | 1 |
| `# 30_ポーズ_基本:脚の動作 (膝を立てる),` | `# 30_ポーズ_基本:脚の動作 (片膝を立てる),` | 1 |
| `# 33_状況:オリジナル (机にかかった精液),` | `# 33_状況:精液 (机に精液),` | 1 |
| `# 33_状況:基本 (靴にかかった精液),` | `# 33_状況:精液 (靴に精液),` | 1 |

残りもすべて候補 1 件のため同じ規則で解決される。スクリプトが解決した全件は実行ログに出力させて確認する。

### 手動対応（候補 2 件・2 箇所）

| 現在のコメント | 候補 | 決め方 |
|---|---|---|
| `# 99_ネガティブ:Model (Nova Anime XL),` | `Nova Anime XL v19.0` / `Nova Anime XL v6.0`（タグ値が同一） | **同一ファイルの `# 01_クオリティ:Model (...)` 行と同じバージョンに揃える** |
| `# 01_クオリティ:Model (WAI-NSFW-illustrious-SDXL),` | `WAI-illustrious-SDXL v17.0` / `WAI-illustrious-SDXL v15.0`（タグ値が同一） | **同一ファイルの `# 90_モデル (...)` 行に書かれたモデル名／バージョンに揃える。判断できなければユーザーに確認する** |

- [ ] **Step 1: 作業ツリーがクリーンなことを確認する**

Run:
```bash
git status --short
```
Expected: 出力なし。

- [ ] **Step 2: 候補が 1 件のものだけを自動で再接続する**

候補が複数のものは自動採用せず `要手動判断` として列挙する（同一カテゴリ優先などの推測は行わない）。

```python
import sys

sys.path.insert(0, 'tools')
from audit_templates import audit, load_tags
from _apply_audit_fix import apply

entries = load_tags()
key_of = {'%s:%s(%s)' % k: k for k in entries}

edits = []
manual = []
skipped = []
for f in audit():
    if f['kind'] != 'NOT_FOUND':
        continue
    if len(f['candidates']) == 1:
        target = key_of[f['candidates'][0]]
        head = target[0] if target[1] is None else '%s:%s' % (target[0], target[1])
        edits.append((f['file'], f['line'], head, target[2]))
        print('AUTO %s:%d # %s (%s) -> # %s (%s)' % (f['file'], f['line'], f['head'], f['label'], head, target[2]))
    elif len(f['candidates']) > 1:
        manual.append((f['file'], f['line'], f['head'], f['label'], f['candidates']))
    else:
        skipped.append((f['file'], f['line'], f['head'], f['label'], f['tag']))

print('自動再接続: %d 件' % apply(edits))
print('要手動判断: %d 件' % len(manual))
for m in manual:
    print(' ', m)
print('候補なし（Task 6 で扱う）: %d 件' % len(skipped))
```

Expected: `自動再接続: 44 件` / `要手動判断: 2 件` / `候補なし（Task 6 で扱う）: 13 件`

- [ ] **Step 3: 手動対応 2 箇所を修正する**

Step 2 が出力した `要手動判断` の 2 箇所について、上の「手動対応」表の決め方に従い、該当ファイルの該当行のコメントを直接書き換える。同一ファイル内の `# 01_クオリティ:Model (...)` / `# 90_モデル (...)` 行を必ず確認してから決めること。判断が付かない場合はユーザーに確認する。

- [ ] **Step 4: 監査が 13 件まで減ったことを確認する**

Run:
```bash
PYTHONIOENCODING=utf-8 python tools/audit_templates.py | grep -E '^(GROUP_MISMATCH|NOT_FOUND|合計)'
```
Expected: `GROUP_MISMATCH: 0 件` / `NOT_FOUND: 13 件` / `合計: 13 件`

- [ ] **Step 5: コメント行以外が変更されていないことを確認する**

Run:
```bash
git diff templates | grep -E '^[+-]' | grep -v '^[+-][+-]' | grep -v '^[+-]\s*#' | head
```
Expected: 何も出力しない。

- [ ] **Step 6: 改行コードが保たれていることを確認する**

Task 3 Step 8 と同じスクリプトを実行する。Expected: `改行混在: なし`

- [ ] **Step 7: コミット**

```bash
git add templates
git commit -m "fix(templates): 参照切れしていたカテゴリコメントを既存タグ定義へ再接続"
```

---

## Task 6-A: Danbooru 表記へ寄せて既存エントリへ再接続（タグ行が変わる）

**Files:**
- Modify: `templates/**/*.txt`

**⚠ このタスクだけはテンプレの「タグ行」を書き換えるため、生成される画像が変わる。** 影響範囲を限定するため独立コミットにし、問題があれば `git revert` 一発で戻せるようにする。

Danbooru の正式表記へ直すと既存エントリと同義になるもの。重複登録を避けるため YAML には追記しない。Danbooru 判定は `tools/search_danbooru.py --exact` と部分一致再検索で確認済み。

| 現コメント | 現タグ | Danbooru 判定 | 新コメント | 新タグ | 件数 |
|---|---|---|---|---|---|
| `# 23_表情:基本 (目を細める),` | `squint,` | `squint` → alias → `squinting` | `# 20_目の状態 (細めた目2),` | `squinting,` | 2 |
| `# 23_表情:基本 (恥ずかしそうな表情),` | `shy expression,` | NG（実在せず） | `# 23_表情:基本 (内気),` | `shy,` | 1 |
| `# 23_表情:基本 (上気した頬),` | `flushed cheeks,` | `flushed` → alias → `blush` | `# 23_表情:基本 (赤面),` | `blush,` | 1 |
| `# 23_表情:基本 (快感の涙),` | `tears of pleasure,` | NG。`tears` が実在 | `# 20_目の状態 (涙),` | `tears,` | 1 |
| `# 40_アングル (前面から),` | `form front,` | `form front` / `from front` とも NG。`straight-on` が実在 | `# 40_アングル (アングル正面),` | `straight-on,` | 1 |
| `# 15_衣装状態_基本:露出 (上半身を裸にする),` | `(showing upper nude body:1.1),` | NG。`topless` が実在 | `# 15_衣装状態_基本:露出 (上裸),` | `(topless:1.1),` | 1 |
| `# 30_ポーズ (横たわる),` | `lying on side,` | alias → `on side` | `# 30_ポーズ_基本:横になる (横になる),` | `on side,` | 1 |
| `# 33_状況:基本 (絶頂寸前),` | `on the verge of orgasm,` | NG。`orgasm denial` が実在（ユーザー指定） | `# 33_状況:基本 (絶頂我慢),` | `orgasm denial,` | 1 |
| `# 33_状況:基本 (浮遊する射精),` | `floating ejaculation,` | NG。`ejaculation` が実在（ユーザー指定） | `# 33_状況:精液 (射精),` | `ejaculation,` | 1 |
| `# 33_状況:オリジナル (少し溢れた精液),` | `(little cum overflow:0.7),` | `little` は強度修飾語。素の `cum overflow` は登録済み | `# 33_状況:精液 (溢れた精液),` | `(cum overflow:0.7),` | 1 |

合計 11 箇所。

下 3 行はユーザーの指示により、当初「新規追記」としていたものを既存エントリへの再接続に変更した（`絶頂我慢: orgasm denial` / `射精: ejaculation` / `溢れた精液: cum overflow` はいずれも `33_状況.yml` に登録済み）。

- [ ] **Step 1: 作業ツリーがクリーンなことを確認する**

Run:
```bash
git status --short
```
Expected: 出力なし。

- [ ] **Step 2: 対象箇所を特定する**

Run:
```bash
PYTHONIOENCODING=utf-8 python tools/audit_templates.py --json /c/Users/kidon/AppData/Local/Temp/claude/audit.json > /dev/null
PYTHONIOENCODING=utf-8 python -c "
import json
for f in json.load(open('/c/Users/kidon/AppData/Local/Temp/claude/audit.json', encoding='utf-8')):
    if not f['candidates']:
        print('%s:%d # %s (%s) | %s' % (f['file'], f['line'], f['head'], f['label'], f['tag']))
"
```
Expected: 13 行（本タスクの 11 箇所 + Task 6-B の 2 箇所）。

- [ ] **Step 3: 上表の 11 箇所を書き換える**

Edit ツールで 1 箇所ずつ、**コメント行とその直後のタグ行をセットで**置換する。行数は変えない。行番号は Step 2 の出力を使う（行数不変の編集のみなのでズレない）。

- [ ] **Step 4: 監査が 2 件まで減ったことを確認する**

Run:
```bash
PYTHONIOENCODING=utf-8 python tools/audit_templates.py | tail -1
```
Expected: `合計: 2 件`

- [ ] **Step 5: 差分を目視確認する**

Run:
```bash
git diff templates
```
Expected: コメント行 11 行 + タグ行 11 行のみの変更。上表と一致すること。

- [ ] **Step 6: コミット**

```bash
git add templates
git commit -m "fix(templates): 未登録タグを Danbooru 実在表記へ寄せて既存定義へ再接続"
```

---

## Task 6-B: 未登録タグ 2 箇所の解消

**Files:**
- Modify: `tags/14_衣装小物.yml`
- Modify: `templates/**/*.txt`

### 新規追記する 1 件

| 追記先 | ラベル | YAML のタグ | テンプレのタグ行 | Danbooru 判定 |
|---|---|---|---|---|
| `14_衣装小物.yml` | 鉄の拘束具 | `cuffs,collar,chain` | `cuffs,collar,chain,` へ変更 | `iron cuffs` / `iron collar` は NG、`cuffs` / `collar` / `chain` は実在 |

**本計画で YAML に新規追記するタグはこの 1 件のみ**（および Task 2 のネガティブセット）。他はすべて既存エントリへの再接続で解決する。

### 既存 2 エントリへ分割する 1 件

`# 41_フォーカス (顔が画面外/クローズアップ),` + `(head out of frame, close-up: 1.5),` は、既存の `顔が画面外: head out of frame` と `クローズアップ: close-up` の単純結合。新規エントリを作らず 2 セクションに分割する（重みは各タグへ配る。生成結果は等価）:

```
# 41_フォーカス (顔が画面外),
(head out of frame:1.5),
# 41_フォーカス (クローズアップ),
(close-up:1.5),
```

- [ ] **Step 1: 追記先に重複が無いことを確認する**

ラベルだけでなく**タグ値でも**確認する（語順違いの既存エントリを見落とさないため）。

Run:
```bash
PYTHONIOENCODING=utf-8 python tools/search_tags.py --exact "鉄の拘束具"
PYTHONIOENCODING=utf-8 python tools/search_tags.py "cuffs,collar"
```
Expected: いずれもヒット無し。ヒットした場合は追記せず、そのエントリへコメントを寄せる（Task 6-A と同じ扱い）。

- [ ] **Step 2: `tags/14_衣装小物.yml` に追記する**

既存の書式（グループの有無・インデント）に合わせて追加:

```yaml
鉄の拘束具: cuffs,collar,chain
```

`14_衣装小物.yml` には既に `bolero537:` という LoRA グループがある。今回の追記は LoRA ではないため、そのグループには入れず既存の一般エントリと同じ階層に置く。

- [ ] **Step 3: YAML 構文を確認する**

Run:
```bash
python -c "import yaml, sys; yaml.safe_load(open(sys.argv[1], encoding='utf-8'))" tags/14_衣装小物.yml && echo OK
```
Expected: `OK`

- [ ] **Step 4: テンプレ側を修正する**

Edit ツールで以下を実施する:

1. `iron cuffs,iron collar,chain,` → `cuffs,collar,chain,`
2. `# 41_フォーカス (顔が画面外/クローズアップ),` + `(head out of frame, close-up: 1.5),` の 2 行を、上記「既存 2 エントリへ分割する 1 件」の 4 行へ置換（**この編集だけ行数が 2 行増える**ため、1 を先に済ませてから行う）

- [ ] **Step 5: 監査が 0 件になったことを確認する**

Run:
```bash
PYTHONIOENCODING=utf-8 python tools/audit_templates.py; echo "exit=$?"
```
Expected: `GROUP_MISMATCH: 0 件` / `NOT_FOUND: 0 件` / `合計: 0 件` / `exit=0`

0 件にならない場合は残った明細を報告し、握りつぶさないこと。

- [ ] **Step 6: 改行コードが保たれていることを確認する**

Task 3 Step 8 と同じスクリプトを実行する。Expected: `改行混在: なし`

- [ ] **Step 7: コミット**

```bash
git add tags templates
git commit -m "fix(tags): テンプレートにのみ存在した未登録タグを追加して参照を解消"
```

---

## Task 7: 最終確認と報告

**Files:** なし（検証のみ）

- [ ] **Step 1: 全タグ YAML の構文を一括確認する**

Run:
```bash
PYTHONIOENCODING=utf-8 python -c "
import os, yaml
ng = []
for name in sorted(os.listdir('tags')):
    if not name.endswith('.yml'):
        continue
    try:
        yaml.safe_load(open('tags/' + name, encoding='utf-8'))
    except Exception as e:
        ng.append((name, str(e)))
print('NG:', ng if ng else 'なし')
"
```
Expected: `NG: なし`

- [ ] **Step 2: 監査を再実行する**

Run:
```bash
PYTHONIOENCODING=utf-8 python tools/audit_templates.py; echo "exit=$?"
```
Expected: `合計: 0 件` / `exit=0`

- [ ] **Step 3: 改行コードの最終確認**

Run:
```bash
PYTHONIOENCODING=utf-8 python -c "
import os
bad = []
for root in ('templates', 'tags'):
    for dirpath, _, filenames in os.walk(root):
        for name in filenames:
            if not name.endswith(('.txt', '.yml')):
                continue
            path = os.path.join(dirpath, name)
            data = open(path, 'rb').read()
            if data.count(b'\r\n') and data.count(b'\n') != data.count(b'\r\n'):
                bad.append(path)
print('改行混在:', bad if bad else 'なし')
"
```
Expected: `改行混在: なし`

- [ ] **Step 4: コミット履歴を確認する**

Run:
```bash
git log --oneline -7
git status --short
```
Expected: Task 1〜6-B の 7 コミットが並び、作業ツリーがクリーン。

- [ ] **Step 5: WebUI で目視確認する（ユーザー作業）**

以下をユーザーに依頼する。`tools/` 以下の追加のみで WebUI 側の Python は変更していないため、**UI の Reload のみで反映される**（WebUI 再起動は不要）。

1. `99_ネガティブ` の `グラフィック` に `画風混入防止` と（移動した）`ソース` が表示され、クリックでネガティブへ挿入されること
2. `24_口の形` に `基本` グループが表示され、`口を開く` 等が選べること
3. `23_表情` から口関連 5 件が消えていること
4. 既存テンプレートを 1 つ読み込み、セクションのカテゴリが正しく解決されること（特に Task 6-A で書き換えた `20_目の状態` / `40_アングル` / `15_衣装状態_基本` を含むテンプレ）
5. `99_ネガティブ` は `isSubCategoryMatch()` 対象カテゴリのため、`セット` 追加によって同カテゴリ内の差し替え挙動に想定外の影響が出ていないこと

- [ ] **Step 6: ユーザーへ報告する**

以下を必ず含める:

- 追加した `99_ネガティブ:グラフィック (画風混入防止)` の内容と、`ソース` を `その他:` → `グラフィック:` へ移動したこと、既存 29 テンプレートで 3 セクションを 1 セクションへ集約したこと（タグ列は同一のため生成結果は不変）
- `23_表情` → `24_口の形` へ移動した 5 エントリと、追随更新したテンプレ 12 箇所
- 補完したグループ名 47 件 / 既存エントリへ再接続した 46 件 / Danbooru 表記へ寄せた 11 件 / 新規追記 1 件 / 分割 1 件
- **Danbooru タグへ置換したタグ**（置換前 → 置換後）: `squint`→`squinting`、`shy expression`→`shy`、`flushed cheeks`→`blush`、`tears of pleasure`→`tears`、`form front`→`straight-on`、`showing upper nude body`→`topless`、`lying on side`→`on side`、`on the verge of orgasm`→`orgasm denial`、`floating ejaculation`→`ejaculation`、`iron cuffs,iron collar`→`cuffs,collar`
- **生成結果が変わる変更**: Task 6-A の 11 箇所と Task 6-B の `iron cuffs,iron collar,chain`→`cuffs,collar,chain`。気に入らなければ該当コミットを `git revert` で戻せる旨を添える
- **強度修飾語を重みへ変換したタグ**: `little cum overflow` → 既存エントリ `溢れた精液: cum overflow` を流用し、テンプレは `(cum overflow:0.7)`
- **Danbooru 実在未確認のまま登録したタグ**: なし（本計画の新規追記は `鉄の拘束具: cuffs,collar,chain` の 1 件のみで、3 タグとも実在確認済み）
- **今回スコープ外として残した項目**: `10_キャラ_ブルアカ*.yml` のタグ値完全重複エントリ（イロハ / アスナ / カリン 等）、`98_特殊.yml` のリスト形式
- 恒久ツールとして `tools/audit_templates.py` が残ること（今後テンプレを追加した際の整合チェックに使える）

---

## ユーザー指示による変更（plan-review 後）

- ネガティブセットのラベルを `よく使うセット` → **`画風混入防止`** に変更。
- セットの置き場所を新設 `セット:` グループ → **既存の `グラフィック:` グループ**に変更。あわせて `ソース` を `その他:` から `グラフィック:` へ移動（画風系のため）。
- **`sunburn` はセットに含めない**（画風ではないため）。テンプレートでは既存の `# 99_ネガティブ:人体 (日焼け跡),` を独立セクションとして残す。
- 既存 29 テンプレート（すべて `02_NSFW`）の ソース / コミック調 / 3Dレンダー の 3 セクションを `画風混入防止` 1 セクションへ集約する。タグ列は完全に同一で生成結果は変わらない。
- `on the verge of orgasm` → **`orgasm denial`** を使用（既存 `33_状況:基本 (絶頂我慢)` に登録済みのため再接続に変更）。
- `floating ejaculation` → **`ejaculation`** を使用（既存 `33_状況:精液 (射精)` に登録済みのため再接続に変更）。
- `cum overflow` は既存 `33_状況:精液 (溢れた精液)` に登録済みと判明したため、新規追記を取りやめ再接続に変更。

この結果、YAML への新規追記は `14_衣装小物 (鉄の拘束具)` の 1 件のみになった（Task 2 のネガティブセットを除く）。

## レビュー却下メモ

plan-review（plan-reviewer サブエージェント）の指摘のうち、以下は却下した。

- **「JS 実装 `ets_prompt_editor.js:27` は `一人の女の子(強調)` を末尾 `)` 欠落で取り出す」** — 誤り。`/^(.*?)\s*\((.*?)\)$/` は末尾 `)` にアンカーされるため入れ子でも正しく `一人の女の子(強調)` を返す。Python の同等正規表現で実測確認済み。ただし「監査スクリプト側の `([^)]*)` が取りこぼす」という指摘本体は正しく、Global Constraints と Task 1 で修正済み。
- **「`tags/14_衣装小物_LoRA.yml` の新規作成は既存構成と不整合」** — 指摘は妥当だが、再監査で `仕込みローター` が既に `15_衣装状態:bolero537` に存在すると判明したため、ファイル作成自体を計画から削除した（指摘の前提ごと解消）。
- **「Task 6-A のタグ行変更について事前同意を取るべき」** — 一部却下。ユーザーはスコープ確定時に「Danbooru 実在確認して表記修正（推奨）」を選択済みのため、変更内容を本計画の表として提示すること（＝計画承認）をもって同意とみなす。ただし独立コミット化と revert 手順の明示は指摘どおり取り込んだ。

## 反映した主な指摘

- ベースライン件数の誤り（78 → 実測 106）とタスク間の件数チェーンの再計算
- 監査正規表現が入れ子カッコを取りこぼす問題（templates 49 行 / tags 775 ラベルが盲点だった）
- タグ値の比較で重み記法を正規化していなかった問題（結果、既存エントリ 5 件を「未登録」と誤判定していた。特に `41_フォーカス` の `女性器のクローズアップ` は重複追加になるところだった）
- `score()` によるモデルバージョン自動選択の破綻 → 候補 1 件のみ自動、複数候補は手動へ変更
- CRLF が LF に変換される問題 → `newline=''` での読み書きと改行検証ステップを追加
- 「`tags/` と `templates/` は .gitignore 対象」という誤った前提の訂正
- バックアップ／ロールバック手順、シェル前提（Bash ツール）、実行カレントディレクトリの明記
