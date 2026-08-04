# anima プロファイル向けプロンプト整形（カンマ後スペース / BREAK 置換）設計

日付: 2026-08-03
ステータス: 承認済み

## 背景

Anima モデルはプロンプト規約が SDXL 系と異なる（docs/anima-prompt-rules.md 参照）。特に:

- カンマの直後にスペースが無いと効きが悪くなる・誤解釈される
- BREAK 構文は使ってはいけない

anima プロファイルでの生成時に、これらを自動で満たすよう整形する設定を追加する。

## 要件（確定事項）

- 適用タイミングは**生成時のみ**（`Script.process` 内で加工）。プロンプト欄は書き換えない
  - 補完・キャレット同期・一括生成の待機制御と干渉させないため（exclude_tags と同型）
- 有効化条件は「設定 ON かつ現在のプロファイルが `'anima'`」。プロファイル名は**コードに直書き**
- BREAK は**カンマに置換**する（単純削除だと前後のタグが連結される事故があるため）。置換で生じた連続カンマは 1 つに畳む

## 変更内容

### 新規: `scripts/prompt_format.py`（WebUI 非依存の純粋モジュール）

- `insert_space_after_comma(prompt)`
  - `,` の直後が空白・改行・行末のいずれでもない場合のみ `, ` に置換
  - 既存の `, ` / `,\n` / 行末カンマは変更しない
- `remove_break(prompt)`
  - 単独トークンの `BREAK`（大文字、前後が空白・行頭・行末）を `, ` に置換
  - 結果として生じる連続カンマ（`, ,` など）を 1 つに畳む
  - `xBREAKy` のような部分一致は対象外
- カンマと BREAK 以外に触れないため、重み記法 `(tag:1.2)` やエスケープ `\(...\)` には影響しない

### 変更: `scripts/settings.py`

設定を 2 つ追加（いずれも既定 ON）:

- `easy_template_anima_space_after_comma` — 「anima: カンマ後にスペースを自動挿入する」
- `easy_template_anima_remove_break` — 「anima: BREAK をカンマに置換する」

### 変更: `scripts/easy_prompt_selector.py`（`Script.process`）

- 現在のプロファイルが `'anima'` かつ該当設定が ON のとき適用
- 対象: `all_prompts` / `all_negative_prompts` / `all_hr_prompts` / `all_hr_negative_prompts` の全部
- 順序: `@...@` 展開後（抽選タグも整形対象にする）→ 除外タグ除去 → **本整形** → `format_prompt()`

### 新規: `tests/test_prompt_format.py`

素の Python で実行する既存形式。カバーするケース:

- カンマ直後が非空白 → スペース挿入
- 既に `, ` / `,\n` / 行末カンマ → 変更なし
- 単独 `BREAK`（行中・単独行）→ `, ` 置換と連続カンマ畳み
- `xBREAKy` などの部分一致 → 非対象
- 重み記法 `(tag:1.2)` が壊れないこと

## 落とし穴

- infotext には整形**後**のプロンプトが焼かれる。生成画像を PNG Info から txt2img へ送った状態でテンプレを保存すると、整形後の形で固定される（exclude_tags / Hires CFG 継承と同型）
