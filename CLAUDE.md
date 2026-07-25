# CLAUDE.md

Stable Diffusion WebUI / reForge 用の拡張機能。プロンプトをカテゴリ単位で構造化し、YAML 定義のタグとテンプレート（pnginfo の `.txt`）から容易にプロンプトを組み立てられるようにする。[Easy Prompt Selector](https://github.com/blue-pen5805/sdweb-easy-prompt-selector) の改造版。

## Top-Level Rules

- **思考は必ず英語で行うこと**。ただし、**回答は日本語**で行うこと。
- **コードのコメントとエラーログメッセージは日本語**で記述すること。
- ライブラリの使い方を理解するために、**必ず Context7 MCP** を使用して最新の情報を取得すること。
- ハードコーディングは絶対に必要な場合を除き避けること。
- YAML タグファイルの編集時は、既存ファイルの命名規則（`番号_カテゴリ名[_サブ分類].yml`）と番号順序を維持すること。

## System Structure

```
sdweb-easy-template-selector/
├── javascript/
│   ├── easy_template_selector.js # エントリポイント（タグ読込・UI 描画・各クラスの結線）
│   ├── ets_section.js            # ETSSection: セクション表現・判定
│   ├── ets_element_builder.js    # ETSElementBuilder: DOM 生成
│   ├── ets_prompt_editor.js      # ETSPromptEditor: タグ追加/削除/移動・選択管理
│   ├── ets_template_manager.js   # ETSTemplateManager: テンプレート適用/保存・メタ情報
│   ├── ets_history.js            # ETSHistory: Undo/Redo 履歴
│   └── js-yaml.min.js            # YAML パーサ（vendored、編集禁止）
├── scripts/
│   ├── easy_prompt_selector.py   # WebUI 拡張エントリ（テンプレート置換・Gradio 連携）
│   ├── settings.py               # 拡張設定
│   └── setup.py                  # タグ読み込み
├── tags/                         # タグ定義 YAML（番号_カテゴリ名.yml 形式、末尾 `_` はローカル専用で git 管理外）
├── templates/                    # プロンプトテンプレート（pnginfo の .txt、階層管理可）
├── tools/                        # 検索・監査・変換スクリプト（後述の Tools 参照）
└── style.css                     # UI スタイル
```

## Coding Conventions

- `javascript/js-yaml.min.js` は vendored ライブラリのため編集しない。
- タグ YAML のカテゴリは番号プレフィックスで表示順を制御している。新規カテゴリ追加時は既存の番号帯（01=クオリティ、10番台=キャラ/衣装、20番台=表情、30番台=ポーズ、40番台=アングル、50番台=背景、60番台以降=効果/その他、99=ネガティブ）に合わせる。
- テンプレート `.txt` 内のカテゴリコメント行は `# カテゴリ名 (説明),` 形式。この形式をパーサが解釈するため崩さないこと。
- `javascript/` 配下の各ファイルは、トップレベルで他ファイルのクラスを参照しないこと（WebUI はアルファベット順に読み込むため、クラス参照は `onUiLoaded` 以降の実行時に限る）。

## Build & Test

ビルド・テスト基盤はない。動作確認は WebUI / reForge 上で行う。

```bash
# WebUI の extensions/ 配下に配置済み。反映は WebUI の再起動または UI の Reload で行う
# タグ YAML の構文確認（簡易チェック）
python -c "import yaml, sys; yaml.safe_load(open(sys.argv[1], encoding='utf-8'))" tags/対象ファイル.yml
```

- Python 側の変更は WebUI 再起動が必要。JavaScript / YAML の変更は UI リロードで反映される。

## Tools

`tools/` 配下のスクリプトはすべて**リポジトリルートで実行**する（`tags` / `templates` を相対パスで参照するため）。

Windows では標準出力が cp932 になり日本語が化けるので、**Bash ツールから `PYTHONIOENCODING=utf-8` を付けて実行**する（PowerShell ではこの記法は使えない）。

### `search_tags.py` — 既存タグの検索

`tags/*.yml` をパースしてタグ文字列と日本語ラベルを検索する。出力はそのままテンプレートのカテゴリコメント行の形式（`# カテゴリ:グループ (ラベル), タグ`）。

```bash
PYTHONIOENCODING=utf-8 python tools/search_tags.py "検索語" ["検索語2" ...]   # 部分一致（複数指定は OR）
PYTHONIOENCODING=utf-8 python tools/search_tags.py --exact "口を開く"          # タグ／ラベル単位の完全一致
PYTHONIOENCODING=utf-8 python tools/search_tags.py --mode label "赤面"         # tag / label / all（既定 all）
PYTHONIOENCODING=utf-8 python tools/search_tags.py "smile" --exclude-category 10_キャラ 70_スタイルLoRA
```

**タグの検索には Grep ツールではなくこれを使う。** 理由は 2 つ:

- YAML を構造化パースするため、`arch` のような短い語が `blue archive` に誤爆する事故を防げる
- `tags/*_.yml`（末尾 `_` のローカル専用ファイル）は gitignore 対象で Grep ツールから見えないが、本スクリプトは読む

`--exclude-category` はファイル名プレフィックス指定。`10_キャラ` で `10_キャラ.yml` / `10_キャラ_LoRA.yml` / `10_キャラ_ブルアカ.yml` をまとめて除外する。複数値を取るオプションなので、**検索語より後ろに書く**（前に書くと検索語まで飲み込んでエラーになる）。

### `search_danbooru.py` — Danbooru タグの実在確認

`a1111-sd-webui-tagcomplete` の `danbooru.csv` をキャッシュした SQLite を引く。新規タグを YAML に追加する前に必ず通す。

```bash
PYTHONIOENCODING=utf-8 python tools/search_danbooru.py --exact "squint" "from front"   # 実在確認
PYTHONIOENCODING=utf-8 python tools/search_danbooru.py --limit 8 "collar"              # 部分一致で正式表記を探す
PYTHONIOENCODING=utf-8 python tools/search_danbooru.py --yaml tags/                    # YAML 内の全タグを一括検証
PYTHONIOENCODING=utf-8 python tools/search_danbooru.py --yaml tags/ --exclude-category 10_キャラ_LoRA
```

結果の読み方:

- `OK`: 実在する
- `OK(alias)`: 別名経由で実在する。**解決先の正式タグ名を使う**
- `NG`: 実在しない

その他:

- `NG` が出たら `--exact` を外した部分一致で正式表記を探す。単数/複数形（`sound effect` ではなく `sound effects`）や語順違いで存在しないタグを作らないよう注意する。
- LoRA タグ（`<lora:...>`）とそのトリガーワードは学習時の語で発火するため、実在確認も表記変更もしない。
- `--yaml` は `queries` と併用できない。

### `audit_templates.py` — templates ↔ tags の参照整合監査

テンプレートのカテゴリコメントが `tags/*.yml` の実在エントリを指しているかを検査する。テスト基盤が無いため、これがテンプレ／タグを編集したときの唯一の機械的な検証手段。

```bash
PYTHONIOENCODING=utf-8 python tools/audit_templates.py                 # 明細を標準出力へ
PYTHONIOENCODING=utf-8 python tools/audit_templates.py --json out.json # JSON（ファイル・行番号つき）
```

- 不整合が 1 件以上なら終了コード 1、0 件なら 0。**現状のクリーンな状態は `合計: 0 件`** なので、テンプレやタグを編集したら実行して 0 件を維持する。

不整合の分類:

- `GROUP_MISMATCH`: ラベルは同カテゴリにあるが、グループ名が違う／欠落している
- `NOT_FOUND`: ラベル自体が存在しない。`candidates` にタグ値が一致する既存エントリが出る（比較時に `(tag:1.2)` の重み記法を剥がして正規化するため、重み付きで書かれたテンプレでも拾える）

検査対象外:

- `@カテゴリ@`（ランダム記法）のセクション。仕様上ラベルが `ランダム` 固定になるため
- `97_Color` / `98_特殊`。`isForceAddCategory()` によりコメント行を持たないため

コメント行のパース:

- 理由: ラベルに入れ子カッコを含むものがある（例: `マリー(体操服)`）
- 実装: JS 側の `ets_prompt_editor.js` の `parseSection` と同じ、末尾 `)` にアンカーする正規表現を使う
- 注意: 文字クラス `([^)]*)` に書き換えると入れ子カッコの行を取りこぼすので変更しないこと

### `_apply_audit_fix.py` — 監査結果によるコメント行の一括置換

`audit_templates.audit()` の結果をもとにカテゴリコメント行を書き換える内部ヘルパー。`apply(edits)` は置換件数を返す。

`edits` は `(file, line, new_head, new_label)` のタプルのリスト:

- `file`: 対象ファイルパス
- `line`: 置換する行番号（1 始まり）
- `new_head`: 置換後のカテゴリ部分（例: `33_状況:精液`）
- `new_label`: 置換後のラベル（例: `射精`）

注意点:

- 1 行を 1 行に置き換えるだけで**行数を変えない**ため、1 回の `audit()` 結果の行番号を全編集で使い回してもズレない。
- 改行コードは行ごとに判定して保存する。`templates/*.txt` は全ファイル CRLF で管理されている。
- `core.autocrlf=true` のため、改行だけの変化は `git diff` に現れず検証をすり抜ける。**テンプレを書き換えるスクリプトは必ず `newline=''` で読み書きすること。**

### `convert_to_yaml.sh` / `split_lora.py` — 変換・分割の下準備

いずれも手動で YAML 化する際の補助ツールで、単体で YAML を完成させるものではない。

```bash
bash tools/convert_to_yaml.sh <ファイル>                  # 各行に No.000: 形式の 3 桁連番を付けて標準出力
python tools/split_lora.py <ファイル> [--split-comma]     # <名前>_lora.yml と <名前>_tags.yml へ分割
```

`split_lora.py` は既定で `>` を区切りとして LoRA 部分とタグ部分を分ける。`--split-comma` を付けると LoRA 部分をカンマで区切る。

## Workflow Rules

実装の標準フロー:

1. **計画作成**: 自明な一行修正・タイポ・タグ YAML の単純追加を除き、**superpowers:writing-plans** スキルで計画を作成する（対象ファイル・変更方針・影響範囲・テスト方針を含める）
2. **計画レビュー**: ユーザーに提示する前に必ず **plan-review** スキルでレビューする
3. **ユーザー承認**: 計画を提示し承認を得てから実装に着手する
4. **コードレビュー**: 実装完了後、ユーザーに提示する前に必ず **code-review** スキルでレビューする
5. **コミットと MEMORY 更新**: **commit** スキルでコミットする。併せて、保存ルールに該当する未保存事項があれば MEMORY.md を更新する（陳腐化エントリの削除と、保留中の判断・技術的負債・教訓などの追記）。該当が無ければ更新スキップで構わない

### Memory の保存ルール

git / コード / docs から復元できない情報のみ保存する。

- **保存する**: 設計判断・技術的負債の Why、既知の落とし穴、保留中の判断、過去のインシデントの教訓、ユーザーのフィードバック、未完了 TODO、外部リソース参照
- **保存しない**: git log / diff / docs から復元できる事実（変更履歴・型・アーキテクチャ）
- **ファイル名**: `{type}_{トピック}.md`（type は `user` / `feedback` / `project` / `reference`）
- **更新タイミング**: 該当情報を得た瞬間に書く
- **整理**: MEMORY.md が 10 エントリを超えたら統合・削除を行う
