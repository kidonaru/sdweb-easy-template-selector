"""テンプレのパラメータ行に RNG を追記する。

Forge Neo は infotext に RNG が無いと既定値 (CPU) を補完し、
現在の設定と食い違うと Override Settings に積む。
テンプレ側に明示しておくことでこれを防ぐ。

randn_source 設定を変えたときは --value を変えて再実行し、テンプレを焼き直す。

改行コードは newline='' で保存する (templates/*.txt は CRLF 管理。
core.autocrlf=true のため LF に潰しても git diff に出ず気づけない)。
"""
import argparse
import re
import sys
from pathlib import Path

TEMPLATE_DIR = Path(__file__).resolve().parent.parent / 'templates'

# パラメータ行の目印。Steps: で始まり Sampler: を含む 1 行がテンプレ末尾にある
PARAM_LINE_PREFIX = 'Steps:'
PARAM_LINE_MARKER = 'Sampler:'

# 保存時 (JS の metaInfoMap) と並び順を揃えるため Clip skip の直後へ挿入する。
# 一致しなければ行末に追記する
CLIP_SKIP_PATTERN = re.compile(r'(Clip skip:\s*[^,]+,)')


def find_param_line_index(lines):
    """パラメータ行の添字を返す。見つからなければ None。

    プロンプト側に Steps: で始まる行が紛れ込む可能性を避けるため末尾から走査し、
    Sampler: を含むことも条件にする
    """
    for i in range(len(lines) - 1, -1, -1):
        line = lines[i]
        if line.startswith(PARAM_LINE_PREFIX) and PARAM_LINE_MARKER in line:
            return i
    return None


def build_new_param_line(line, value):
    """パラメータ行に RNG を追記した行を返す。既にあれば None"""
    if 'RNG:' in line:
        return None

    stripped = line.rstrip()
    entry = f'RNG: {value},'

    if CLIP_SKIP_PATTERN.search(stripped):
        return CLIP_SKIP_PATTERN.sub(rf'\1 {entry}', stripped, count=1)

    if stripped.endswith(','):
        return f'{stripped} {entry}'
    return f'{stripped}, {entry}'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--value', default='GPU', help='書き込む RNG の値 (既定: GPU)')
    parser.add_argument('--apply', action='store_true', help='実際にファイルを書き換える')
    args = parser.parse_args()

    changed = 0
    skipped = 0
    failed = []

    for path in sorted(TEMPLATE_DIR.rglob('*.txt')):
        with open(path, 'r', encoding='utf-8', newline='') as f:
            content = f.read()

        lines = content.split('\n')
        index = find_param_line_index(lines)
        if index is None:
            failed.append(path)
            continue

        # split('\n') では CRLF の \r が行末に残るので、\r を保ったまま加工する
        raw = lines[index]
        suffix = '\r' if raw.endswith('\r') else ''
        new_line = build_new_param_line(raw.rstrip('\r'), args.value)
        if new_line is None:
            skipped += 1
            continue

        lines[index] = new_line + suffix
        if args.apply:
            with open(path, 'w', encoding='utf-8', newline='') as f:
                f.write('\n'.join(lines))
        changed += 1
        print(f'{"書き換え" if args.apply else "対象"}: {path.relative_to(TEMPLATE_DIR)}')

    print(f'\n変更: {changed} 件 / 既に RNG あり: {skipped} 件 / パラメータ行なし: {len(failed)} 件')
    for path in failed:
        print(f'  パラメータ行が見つかりません: {path.relative_to(TEMPLATE_DIR)}')

    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
