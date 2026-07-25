# プロンプト出力整形のコメント行対応 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**調査結論（重要）:** Forge Neo 固有の非互換は見つからなかった。本計画で直すのはホスト非依存の既存バグであり、Forge Neo でたまたま顕在化したもの。Task 2 の README 追記は「Neo でも動作確認した」という記録であって Neo 専用の変更ではない。

**Goal:** 本拡張の出力整形（空行削除 / 改行削除）を、WebUI 本体のコメント除去より前にコメント行そのものを取り除く形に変え、テンプレートのカテゴリコメント行が空行として残る問題と、改行削除時にプロンプトが丸ごと消える問題を解消する。あわせて整形ループの `TypeError` 経路を是正する。

**Architecture:** `scripts/easy_prompt_selector.py` に純粋関数 `format_prompt(text, strip_comments, remove_blank_line, remove_new_line)` と、その内部で使う `strip_comment_lines(text)` を追加する。`shared.opts` の参照は呼び出し側に閉じ込め、整形ロジックはすべて純粋関数側に置く。これにより WebUI を起動せずフラグ 4 通りの組み合わせを機械検証できる。コメント構文の判定は本体 `modules/processing_scripts/comments.py` と同一仕様（`#` / `//` / `/* */`）に合わせる。

**Tech Stack:** Python 3 / `re` 標準ライブラリのみ（新規依存なし）。本体 API は `shared.opts` の読み取りのみ。

## 背景（根本原因）

1. 本拡張の `Script.process` は `p.all_prompts` などを書き換え、空行削除まで済ませる（`scripts/easy_prompt_selector.py:113-127`）
2. その**後**に本体の `modules/processing_scripts/comments.py` の `ScriptComments.process` が走り、`re.sub(r"[^\S\n]*(\#|\/\/).*", "", text)` で **コメント本文だけを消して改行を残す**
3. 結果、テンプレートの `# カテゴリ (説明),` 行が空行として復活し、空行削除が効いていないように見える

実行順がこうなるのは `modules/scripts.py:502` の
`scripts_list = list_scripts("scripts", ".py") + list_scripts("modules/processing_scripts", ".py", include_extensions=False)`
により拡張の script が先・本体 `comments.py` が後にロードされるため。例外は起きないためコンソールにもエラーが出ない。

実環境（Forge Neo）の設定値は `enable_prompt_comments=True` / `save_prompt_comments=False` / `easy_template_remove_blank_line=True` / `easy_template_remove_new_line=False` で、上記条件に合致する。

**同根の未報告バグ 1:** `easy_template_remove_new_line=True`（既定 False）の場合、本拡張が全行を空白 1 個で 1 行に連結した後に本体のコメント除去が走るため、`[^\S\n]*(\#|\/\/).*` が最初の `#` から行末＝プロンプト全体を削除する。この設定を有効にするとプロンプトがほぼ空になる。

**同根の未報告バグ 2:** `modules/processing.py:1568-1571` の `setup_prompts` は `if not self.enable_hr: return` するため、**Hires.fix が OFF のまま Hires prompt 欄にテキストがあると `p.all_hr_prompts` は `None`** のまま。一方で本拡張のガードは `if getattr(p, 'hr_prompt', None)` なので `[p.hr_prompt, None, ...]` が整形対象に積まれ、`all_prompts[i]` で `TypeError` になる。`ScriptRunner.process` が例外を `errors.report` で飲むため、この条件では **`@` 展開も空行削除も無言で全部止まる**。

## Global Constraints

- コードのコメントとエラーログメッセージは日本語で記述する
- ハードコーディングは絶対に必要な場合を除き避ける。コメント構文の正規表現は本体 `modules/processing_scripts/comments.py:10-19` と同一仕様に揃える必要があるため例外とし、根拠をコードコメントに残す
- `javascript/js-yaml.min.js` は編集しない（本計画では JS を一切変更しない）
- Python 側の変更のため、実機確認には WebUI の再起動が必要（Reload UI では不十分）
- テスト基盤は存在しない。検証は「純粋関数の単体検証スクリプト（scratchpad に置き、コミットしない）」＋「WebUI 実機確認」で行う
- 既存の設定オプション（`easy_template_remove_blank_line` / `easy_template_remove_new_line` / `easy_template_enable_save_raw_prompt_to_pnginfo` / `easy_template_use_consistent_seed`）の既定値と意味は変えない
- `tools/` 系スクリプトおよび検証スクリプトは Bash ツールから `PYTHONIOENCODING=utf-8` を付けて実行する（PowerShell ではこの記法が使えない）
- 本体 API 差異への耐性: `enable_prompt_comments` / `save_prompt_comments` は `getattr` フォールバックで参照し、オプションを持たないホストでも例外を出さない

## 仕様: 設定組み合わせごとの期待挙動

対象プロンプト（例）:

```text
# 01_クオリティ:Model (Nova Anime XL v6.0),
masterpiece,

1girl,
```

| ケース | `enable_prompt_comments` | `save_prompt_comments` | `remove_blank_line` | `remove_new_line` | 本拡張適用後の期待値 | 最終プロンプト（本体 comments.py 通過後） |
| --- | --- | --- | --- | --- | --- | --- |
| A（実環境） | True | False | True | False | `masterpiece,\n1girl,` | 変化なし（`masterpiece,\n1girl,`） |
| B | True | False | True | True | `masterpiece, 1girl,` | 変化なし |
| C（Raw Comments 保存） | True | True | True | False | `# 01_...,\nmasterpiece,\n1girl,`（コメント行は残す＝現状維持） | `\nmasterpiece,\n1girl,`（空行が残る＝現状維持） |
| D（旧ホスト等） | オプション無し | オプション無し | True | False | `# 01_...,\nmasterpiece,\n1girl,`（現状維持） | 本体のコメント除去自体が無い |

ケース C の意図: 本体は `save_prompt_comments` が ON でも strip を必ず実行するが、その直前に `p._all_prompts_c = p.all_prompts.copy()` で infotext 用の生コピーを取る（`comments.py:33-35`）。このスナップショットは**本拡張の後**に取られるため、拡張が先にコメントを消すと「Save Raw Comments」で残るはずのコメントが失われる。よってこの設定下ではコメント除去に手を出さない（＝空行は残るが、それは本体設定を尊重した結果）。なお、このスナップショットには本拡張の `@` 展開が既に反映済みで、完全な原文ではない。

---

### Task 1: 整形処理の純粋関数化とコメント行除去の追加

**Files:**
- Modify: `scripts/easy_prompt_selector.py`
  - 追加: 正規表現定数 2 つ、`strip_comment_lines`、`format_prompt`（`replace_template` の後・`class Script` の前）
  - 書き換え: `replace_template_tags` の hr プロンプト追加ガード（100-101 行）と出力整形部（113-127 行）
- Test: 検証スクリプト（scratchpad 配下。リポジトリにはコミットしない）

**Interfaces:**
- Produces:
  - `strip_comment_lines(text: str) -> str` — `/* */`、`#`、`//` のコメントを除去する純粋関数
  - `format_prompt(text: str, strip_comments: bool, remove_blank_line: bool, remove_new_line: bool) -> str` — コメント除去 → 空行削除 → 改行削除の順に適用する純粋関数。`shared.opts` を参照しない

- [ ] **Step 1: 検証スクリプトを書く**

セッションの scratchpad に `test_format_prompt.py` として作成する（以下 `<scratchpad>` は実際のパスに置換する）。

```python
# -*- coding: utf-8 -*-
# format_prompt / strip_comment_lines の単体検証（WebUI 非起動）
import importlib.util
import sys
import types
from pathlib import Path

REPO = Path(r"C:\tools\StabilityMatrix\Data\Packages\Stable Diffusion WebUI Forge - Neo\extensions\sdweb-easy-template-selector")


def install_stubs():
    """WebUI 本体モジュールをスタブ化して easy_prompt_selector を import できるようにする"""
    for name in ["gradio", "modules", "modules.infotext_utils", "modules.scripts", "modules.shared"]:
        sys.modules.setdefault(name, types.ModuleType(name))
    modules = sys.modules["modules"]
    scripts_mod = sys.modules["modules.scripts"]
    scripts_mod.AlwaysVisible = object()

    class _Script:
        def __init__(self):
            pass

    scripts_mod.Script = _Script
    modules.scripts = scripts_mod
    modules.infotext_utils = sys.modules["modules.infotext_utils"]
    modules.shared = sys.modules["modules.shared"]

    pkg = types.ModuleType("scripts")
    pkg.__path__ = []
    setup = types.ModuleType("scripts.setup")
    setup.load_tags = lambda: {}
    setup.get_tags = lambda: {}
    pkg.setup = setup
    sys.modules["scripts"] = pkg
    sys.modules["scripts.setup"] = setup


install_stubs()
spec = importlib.util.spec_from_file_location("eps", REPO / "scripts" / "easy_prompt_selector.py")
eps = importlib.util.module_from_spec(spec)
spec.loader.exec_module(eps)

# --- strip_comment_lines 単体 ---
# 期待値は本体 modules/processing_scripts/comments.py と同一挙動。
# `[^\S\n]*` が先行空白も食うため、行末コメントの手前のスペースも消える（本体仕様と一致）
STRIP_CASES = [
    ("# 01_クオリティ:Model (Nova Anime XL v6.0),\nmasterpiece,\n",
     "\nmasterpiece,\n",
     "コメント専用行は中身が空になる(改行は残る)"),
    ("masterpiece, # 末尾コメント\n1girl,\n",
     "masterpiece,\n1girl,\n",
     "行末コメントは本文を残して除去。先行空白も消える"),
    ("  // 行コメント\n1girl,\n",
     "\n1girl,\n",
     "// 形式のコメント専用行"),
    ("/* 複数行\nコメント */\n1girl,\n",
     "\n1girl,\n",
     "ブロックコメント"),
    ("1girl,\nsolo,\n",
     "1girl,\nsolo,\n",
     "コメントが無ければ不変"),
    ("<lora:NeedBuzz_sign_Illustrious:0.95> need_buzz,\n(1girl:1.2),\n",
     "<lora:NeedBuzz_sign_Illustrious:0.95> need_buzz,\n(1girl:1.2),\n",
     "LoRA 記法・重み記法は誤爆しない"),
    ("/* 未閉じ\n1girl,\n",
     "/* 未閉じ\n1girl,\n",
     "未閉じブロックコメントは素通り(本体と同挙動)"),
    ("1girl,\r\n# x\r\nsolo,\r\n",
     "1girl,\r\n\r\nsolo,\r\n",
     "CRLF: コメント行の中身のみ消え \\r は残る(本体と同挙動)"),
]

# --- format_prompt 組み合わせ ---
SRC = "# 01_クオリティ (最高品質),\nmasterpiece,\n\n1girl,\n"
FORMAT_CASES = [
    ((True, True, False), "masterpiece,\n1girl,", "ケースA: コメント除去+空行削除"),
    ((True, True, True), "masterpiece, 1girl,", "ケースB: さらに改行削除"),
    ((False, True, False), "# 01_クオリティ (最高品質),\nmasterpiece,\n1girl,", "ケースC/D: コメントは残す"),
    ((False, False, False), SRC, "全 OFF: 完全に不変"),
    ((True, False, True), "masterpiece, 1girl,", "空行削除 OFF でも改行削除は空行を落とす"),
    ((True, True, False), "masterpiece,\n1girl,", "冪等性確認用(同入力・同出力)"),
]
COMMENT_ONLY = "# only comment,\n"

ng = 0


def check(desc, got, expected):
    global ng
    ok = got == expected
    ng += 0 if ok else 1
    print(("OK  " if ok else "NG  ") + desc)
    if not ok:
        print("    期待:", repr(expected))
        print("    実際:", repr(got))


for src, expected, desc in STRIP_CASES:
    check("strip: " + desc, eps.strip_comment_lines(src), expected)

for (sc, rb, rn), expected, desc in FORMAT_CASES:
    check("format: " + desc, eps.format_prompt(SRC, sc, rb, rn), expected)

check("format: コメントのみのプロンプトは空になる", eps.format_prompt(COMMENT_ONLY, True, True, False), "")
check("format: 空文字は空文字", eps.format_prompt("", True, True, False), "")
check("format: 冪等(2 回適用しても同じ)",
      eps.format_prompt(eps.format_prompt(SRC, True, True, False), True, True, False),
      eps.format_prompt(SRC, True, True, False))

print("失敗:", ng)
sys.exit(1 if ng else 0)
```

- [ ] **Step 2: 実行して失敗を確認する**

Run（Bash ツール）: `PYTHONIOENCODING=utf-8 python "<scratchpad>/test_format_prompt.py"`
Expected: FAIL — `AttributeError: module 'eps' has no attribute 'strip_comment_lines'`

- [ ] **Step 3: 純粋関数を実装する**

`scripts/easy_prompt_selector.py` の `replace_template` 定義の後（`class Script` の前）に追加する。

```python
# 本体 modules/processing_scripts/comments.py と同じコメント構文を対象にする。
# 本体はコメント本文だけを消して改行を残すため、空行削除より前に自前で除去する必要がある
COMMENT_BLOCK_PATTERN = re.compile(r'/\*.*?\*/', re.DOTALL)
COMMENT_LINE_PATTERN = re.compile(r'[^\S\n]*(#|//).*')

def strip_comment_lines(text):
    """プロンプトからコメント（/* */, #, //）を除去する。

    コメントだけの行は中身が空になるだけで改行は残るため、後段の空行削除で行ごと消える。
    """
    text = COMMENT_BLOCK_PATTERN.sub('', text)
    return COMMENT_LINE_PATTERN.sub('', text)

def format_prompt(text, strip_comments, remove_blank_line, remove_new_line):
    """プロンプトを出力用に整形する。

    コメント除去 → 空行削除 → 改行削除の順に適用する。
    コメント除去を先に行うのは、本体側のコメント除去（本文のみ削除・改行は残す）が
    本拡張より後に走るため、順序を逆にすると消したはずの空行が復活するから。
    """
    if strip_comments:
        text = strip_comment_lines(text)

    if remove_blank_line or remove_new_line:
        lines = [line for line in text.split('\n') if len(line.strip()) > 0]
        # 改行削除が有効なら 1 行に連結する
        text = (' ' if remove_new_line else '\n').join(lines)

    return text
```

- [ ] **Step 4: 実行して成功を確認する**

Run: `PYTHONIOENCODING=utf-8 python "<scratchpad>/test_format_prompt.py"`
Expected: PASS（`失敗: 0`、終了コード 0）

期待値と実挙動がずれた場合、**期待値ではなく本体 `modules/processing_scripts/comments.py:10-19` を正とする**。本体と同じ正規表現を使うことが本修正の前提であり、正規表現側を独自に変えてはならない。

- [ ] **Step 5: `replace_template_tags` を書き換える**

(a) hr プロンプトのガードを本体の条件に合わせる。`scripts/easy_prompt_selector.py:100-101` を置き換える。

置換前:

```python
        if getattr(p, 'hr_prompt', None): prompts.append([p.hr_prompt, p.all_hr_prompts, 'Input Prompt(Hires)'])
        if getattr(p, 'hr_negative_prompt', None): prompts.append([p.hr_negative_prompt, p.all_hr_negative_prompts, 'Input NegativePrompt(Hires)'])
```

置換後:

```python
        # Hires.fix が無効なとき本体は all_hr_prompts を None のままにするため、リスト側の有無で判定する
        # (hr_prompt だけを見ると None を添字アクセスして TypeError になり、process 全体が無言で止まる)
        if getattr(p, 'all_hr_prompts', None): prompts.append([p.hr_prompt, p.all_hr_prompts, 'Input Prompt(Hires)'])
        if getattr(p, 'all_hr_negative_prompts', None): prompts.append([p.hr_negative_prompt, p.all_hr_negative_prompts, 'Input NegativePrompt(Hires)'])
```

(b) 出力整形部（113-127 行の「Remove blank line」/「Remove new line」ブロック全体）を置き換える。

```python
        # 本体のコメント除去（本文のみ削除・改行は残す）が本拡張より後に走るため、
        # ここでコメント行を落としておかないと空行削除をすり抜けて空行が復活する。
        # save_prompt_comments が ON のときは本体が infotext 用の生コピーを本拡張の後に取るので手を出さない
        strip_comments = (
            getattr(shared.opts, 'enable_prompt_comments', False)
            and not getattr(shared.opts, 'save_prompt_comments', False)
        )
        remove_blank_line = shared.opts.easy_template_remove_blank_line
        remove_new_line = shared.opts.easy_template_remove_new_line

        if not (strip_comments or remove_blank_line or remove_new_line):
            return

        for i in range(len(p.all_prompts)):
            for [prompt, all_prompts, raw_prompt_param_name] in prompts:
                all_prompts[i] = format_prompt(all_prompts[i], strip_comments, remove_blank_line, remove_new_line)
```

- [ ] **Step 6: 構文チェックと単体検証**

Run:
```bash
PYTHONIOENCODING=utf-8 python -m py_compile scripts/easy_prompt_selector.py && echo COMPILE_OK
PYTHONIOENCODING=utf-8 python "<scratchpad>/test_format_prompt.py"
```
Expected: `COMPILE_OK` と `失敗: 0`

- [ ] **Step 7: テンプレ／タグの参照整合が壊れていないことを確認する**

Run: `PYTHONIOENCODING=utf-8 python tools/audit_templates.py`
Expected: `合計: 0 件`（テンプレのコメント行形式は変更していないので現状維持）

- [ ] **Step 8: WebUI 実機確認**

1. WebUI（Forge Neo）を再起動する
2. テンプレート `01_SFW/I Need Buzz` を適用し、`@` 記法を 1 つ含む状態で 1 枚生成する
3. 生成画像の pnginfo の Prompt を確認する
   - Expected: `# ...` 行由来の空行が無い / タグが欠落していない / `@...@` が展開済み
4. 設定 `Easy Template Selector > 出力時に改行を削除する` を ON にして再生成する
   - Expected: プロンプトが 1 行に連結され、内容が丸ごと消えていない（修正前は空になる）
   - 確認後、設定は OFF に戻す
5. Hires.fix を OFF のまま Hires prompt 欄に任意のテキストを入れて生成する
   - Expected: `@` 展開・空行削除がともに機能する（修正前はここで `TypeError` により無言で全部止まる）
6. コンソールに `Error running process:` が出ていないことを確認する

- [ ] **Step 9: コミット**

```bash
git add scripts/easy_prompt_selector.py
git commit -m "fix(prompt): 本体のコメント除去より前にコメント行を落として空行残りを解消"
```

---

### Task 2: 対応環境の記載更新

**Files:**
- Modify: `README.md:14`

**Interfaces:**
- Consumes: Task 1 の修正が入り、Forge Neo 実機で出力整形が正しく動くことを確認済みの状態
- Produces: なし（ドキュメントのみ）

- [ ] **Step 1: README の動作確認環境に Forge Neo を追記する**

置換前:

```markdown
WebUIとreForgeで動作確認しています
```

置換後:

```markdown
WebUI・reForge・Forge Neo で動作確認しています
```

- [ ] **Step 2: 記述を確認する**

Run（Bash ツール）: `PYTHONIOENCODING=utf-8 grep -n "Forge Neo" README.md`
Expected: 上記 1 行がヒットする

- [ ] **Step 3: コミット**

```bash
git add README.md
git commit -m "docs: 動作確認環境に Forge Neo を追記"
```

---

## 非スコープ・既知の残存事項

- `templates/*.txt` のコメント行形式（`# カテゴリ名 (説明),`）は変更しない。JS 側 `ets_prompt_editor.js` の `parseSection` と `tools/audit_templates.py` が同形式を前提にしている
- JavaScript 側は変更しない（Forge Neo で動作しているとのユーザー報告に基づく）
- `metadata.ini` による callback 実行順の指定（`[callbacks/...]` の `After`）は採用しない。本体側のコールバック名（`base/comments.py/script_process/ScriptComments`）に依存し、名前が変われば無言で順序指定が無効化されて同じバグに戻るため、拡張側で自己完結する方式を選ぶ
- `enable_prompt_comments` を持たないホストでは従来どおりコメント行がそのままモデルに渡る（本計画で挙動を変えない）。現行の WebUI / reForge / Forge Neo はいずれも本オプションを持つため実害は無い見込み
- `save_prompt_comments`（本体「Save Raw Comments」/ 既定 OFF）が ON のときはコメント除去を行わないため、空行は残る（仕様表ケース C）
- `p.main_prompt` / `p.main_negative_prompt` は整形しない。本体 `comments.py` はこれらもコメント除去するが、本拡張の整形対象は `all_prompts` 系のみで、グリッド画像の infotext（`use_main_prompt=True`）には空行が残る可能性がある。実害が小さいため対象外とする
- 行内の末尾空白は削除しない（`strip()` は空行判定にのみ使う）。CRLF 入力時は `remove_new_line=True` で行内に `\r` が残るが、テキストエリア経由のプロンプトは LF 正規化されるため実運用では発生しない見込み
- `easy_template_enable_save_raw_prompt_to_pnginfo`（既定 OFF）が ON のとき、`save_prompt_to_pnginfo` は `prompt.replace('\n', ' ')` で改行を空白化するため、コメントを含む原文を保存すると `#` 以降が同一行に潜る。その infotext を貼り戻すと以降が全部コメント扱いになる。本計画では触らない既知の footgun
- `@` 展開とコメント除去の順序は「`@` 展開 → コメント除去」を維持する。`save_prompt_to_pnginfo` に渡す原文（`p.prompt`）を変えないためで、コメント行内に `@...@` があると消える予定の記法まで展開され乱数を消費するが、現行テンプレのコメント行形式に `@` は含まれない

## レビュー却下メモ

- 「行ごとに `strip()` して行内末尾空白も落とす」— 既存の出力を変える範囲が広く、今回の症状と無関係なため却下（非スコープに明記）
- 「`@` 展開結果にコメント記号が混入するケースのテスト追加」— タグ YAML に `#` / `//` を含む値は存在せず、混入しても `strip_comment_lines` の既存テストと同じ経路になるため却下

## Self-Review

- **原因への対応:** コメント行が空行として残る問題（Task 1 Step 5b）、改行削除時にプロンプトが消える同根バグ（同、`format_prompt` の順序）、`all_hr_prompts is None` の `TypeError`（Step 5a）、対応環境の記載（Task 2）をカバー
- **プレースホルダ:** なし。検証スクリプト・実装コード・置換前後の文面をすべて実体で記載（`<scratchpad>` のみ実行時に実パスへ置換）
- **型・名称整合:** `strip_comment_lines(text) -> str` と `format_prompt(text, strip_comments, remove_blank_line, remove_new_line) -> str` を Step 3 で定義し、Step 1 の検証スクリプトと Step 5 の呼び出しで同名・同引数順で参照。定数 `COMMENT_BLOCK_PATTERN` / `COMMENT_LINE_PATTERN` も同一名
