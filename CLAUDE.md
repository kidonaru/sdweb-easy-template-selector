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
│   ├── ets_completion.js         # ETSCompletion: プロンプト欄の補完（トリガ判定・ポップアップ・確定）
│   ├── ets_completion_index.js   # ETSCompletionIndex: 補完候補の平坦化と検索
│   └── js-yaml.min.js            # YAML パーサ（vendored、編集禁止）
├── scripts/
│   ├── easy_prompt_selector.py   # WebUI 拡張エントリ（テンプレート置換・Gradio 連携）
│   ├── hr_cfg_inherit.py         # Hires CFG Scale の 0 = CFG Scale 継承の解決（reForge 互換）
│   ├── hr_cfg_ui.py              # Hires CFG Scale スライダーの下限緩和（0 センチネルの保持）
│   ├── settings.py               # 拡張設定
│   ├── setup.py                  # タグ読み込み・API エンドポイント
│   └── upscaler_aliases.py       # Hires upscaler 名の環境差の吸収（reForge ↔ Forge Neo）
├── tags/                         # タグ定義 YAML（番号_カテゴリ名.yml 形式、末尾 `_` はローカル専用で git 管理外）
├── templates/                    # プロンプトテンプレート（pnginfo の .txt、階層管理可）
├── tools/                        # 検索・監査・変換スクリプト（後述の Tools 参照）
├── tests/                        # WebUI 非依存モジュールの単体テスト（素の Python で実行）
└── style.css                     # UI スタイル
```

## Coding Conventions

- `javascript/js-yaml.min.js` は vendored ライブラリのため編集しない。
- タグ YAML のカテゴリは番号プレフィックスで表示順を制御している。新規カテゴリ追加時は既存の番号帯（01=クオリティ、10番台=キャラ/衣装、20番台=表情、30番台=ポーズ、40番台=アングル、50番台=背景、60番台以降=効果/その他、99=ネガティブ）に合わせる。
- テンプレート `.txt` 内のカテゴリコメント行は `# カテゴリ名 (説明),` 形式。この形式をパーサが解釈するため崩さないこと。
- `javascript/` 配下の各ファイルは、トップレベルで他ファイルのクラスを参照しないこと（WebUI はアルファベット順に読み込むため、クラス参照は `onUiLoaded` 以降の実行時に限る）。
- テンプレート `.txt` の `Hires upscaler` は、モデルファイルの stem（拡張子を除いたファイル名）を正規形として保存する。reForge の組み込み表示名（`R-ESRGAN 4x+ Anime6B` など）で書かない。環境差の吸収は `scripts/upscaler_aliases.py` が行い、`GET /easy-template/templates` の配信時に実行環境の表示名へ解決し、`POST /easy-template/save-template` の保存時に正規形へ戻す
- `UPSCALER_ALIASES` に載せるのは reForge / A1111 側にだけ存在する別名に限る。実機で確認していない別名は追加しない（誤変換は素通しより状況が悪い）
- テンプレート `.txt` の `Hires CFG Scale: 0` は reForge 固有の「本体 CFG Scale を継承する」センチネル値。Forge Neo にはこの仕様が無く 0 がそのまま CFG 0 としてサンプラーへ渡るため、`scripts/hr_cfg_inherit.py` が生成直前（`Script.process`）に実値へ展開する。設定 `easy_template_inherit_hr_cfg` で OFF にできる
- テンプレート側の `Hires CFG Scale: 0` は書き換えない。0 のままにしておくことで `CFG Scale` を変えたときに Hires 側も追従する（reForge と同じ挙動）
- 落とし穴: 生成画像の infotext には継承後の実値が焼かれる。**生成画像を PNG Info から txt2img へ送った状態でテンプレを保存すると、`Hires CFG Scale` が 0 ではなく実値で固定される**（センチネルが失われる）。テンプレを作り直すときはテンプレ適用直後の状態から保存すること
- Forge Neo の `Hires CFG Scale` スライダーは本体側の定義が下限 1.0 で、Gradio 4.40 は blur 時にここまでクランプする。センチネル値 0 が UI 操作で 1.0 に丸められるのを防ぐため、`scripts/hr_cfg_ui.py` が下限を 0 に緩和している。`easy_template_inherit_hr_cfg` が OFF のときは元の下限に戻す（0 を入力できるのに継承しないのは事故のもと）。設定変更はブラウザの再読み込みで反映される
- 下限の書き換えは **`on_app_started` で行う**。本体の `ui_loadsave` が UI 構築中に `ui-config.json` の `minimum` を書き戻すため（本体 `modules/ui_loadsave.py:96`、`_internal_preset_param` のスキップ対象は `value` / `step` のみ）、`on_after_component` で書き換えても直後に上書きされる。この順序なら `dump_defaults()` より後になるので、緩和値が `ui-config.json` に焼き付くこともない
- 落とし穴: Gradio 4.40 はフロントへ渡す config を `Blocks.queue()` / `launch()` の時点で `Blocks.config` にキャッシュし、ページ配信時はそれを使い回す（`gradio/routes.py:385`）。**`minimum` 属性を書き換えるだけでは反映されない**ため、書き換え後に `demo.config = demo.get_config_file()` でキャッシュを作り直す必要がある（`on_app_started` は `launch()` より後なので必須）
- `Slider` は `preprocess` / `postprocess` のどちらでもクランプしないので、下限を下げても生成側への副作用は無い
- 本体は `Hires CFG Scale > 1.0` のときだけ `Hires negative prompt` を編集可能にする（本体 `modules/ui.py:61` の `use_cfg`）。0 は継承後に negative が効くため、`scripts/hr_cfg_ui.py` が `on_before_ui` で `modules.ui.use_cfg` を差し替え、0 も編集可能側に含めている（`create_ui()` の実行中に `fn=use_cfg` が評価されるので、その前に差し替える）。同じ関数は本体 `CFG Scale` 側（`modules/ui.py:244, 642`）にも使われるが、そちらの下限は 1.0 で 0 に到達しないため挙動は変わらない。`easy_template_inherit_hr_cfg` が OFF のときは 0 が文字通りの CFG 0 になるので、本体と同じ判定にフォールバックする
- 落とし穴: 緩和により `step` 0.5 刻みで 0.5 も入力できるようになった。センチネルは **0 のみ**で、0.5 は明示指定として素通しされ CFG 0.5 で生成される
- 落とし穴: 1.0 は Neo で「Hires のネガティブ無効」を意味する正規値。誤って 1.0 が入ると継承は発動せずログも出ないため、テンプレ側の値が 0 のままか目視で確認すること
- プロンプト補完は行頭 `#` をトリガとする。tagcomplete も同じ textarea を見ているが、検索語がカンマ区切りで切り出され `#` ごと検索されるため danbooru タグには一致せず、tagcomplete 側のポップアップは出ない（`navigateInList()` は自分のポップアップが出ているときしかキーを消費しない）。この性質に依存しているので、tagcomplete 側の設定でパーサや翻訳を増やしたときは共存を再確認すること
- 補完の keydown は `gradioApp()` の捕捉フェーズで受ける。textarea 自身に登録すると `eventPhase` が `AT_TARGET` になり、`capture: true` を付けても登録順でしか呼ばれないため、他拡張より先に処理できる保証がない
- 補完の対象外は `00_テンプレート` / `90_モデル` / `96_解像度` の 3 カテゴリと、`01_クオリティ:Model` / `99_ネガティブ:Model` の 2 グループ。前者はテキスト挿入以外の副作用を持ち、後者は `applyModelTag()` が先頭 1 件だけを差し替える前提のためセクションが重複すると壊れる
- 補完のトリガ判定は行に `,` が現れた時点で止まる。確定済みのコメント行が必ず `,` で終わること（`ETSSection.toString()` の `header += ','`）を利用した区別なので、ヘッダー形式を変えるときは `ETSCompletion.STOP_CHARS` も見直すこと
- 補完の検索は NFKC + 小文字で正規化して比較する。ラベル側は半角カッコで書かれているが、IME 日本語入力では `(` が全角 `（` になるため。エントリ側の正規化は `ETSCompletionIndex` の構築時に前計算する（キー入力ごとに全件走るため）
- 落とし穴: 半角 `(` を打つと tagcomplete 側の語切り出し（`NORMAL_TAG_REGEX` はカッコを区切り扱い）が `#` を落とすため、tagcomplete のポップアップも同時に出ることがある。キー操作は当拡張が捕捉フェーズで奪うので動作はするが、表示は重なる。IME の全角 `（` なら語が切れないので tagcomplete は反応しない
- 確定時はコメント行に続くタグ行まで置き換える。入力済みセクションを打ち直したときに古いタグが残らないようにするため。ただし「次行が空行」「直前がコメント行（＝セクション間に挿入された行で、次行は前のセクションのタグ）」の場合は広げない。副作用として、タグを持たないセクションの直後のセクションを打ち直すと古いタグ行が残る
- 確定処理は変更前と変更後の両方を Undo 履歴に積む。`textarea.value` の直代入でブラウザ標準の Undo が失われるため
- 落とし穴: 候補が出ている間の Enter は確定に使われる。普通に改行したいときは Esc で閉じてから

## Build & Test

ビルド基盤とテストフレームワークはない。動作確認は基本的に WebUI / reForge 上で行う。

例外として、WebUI に依存しないモジュール（`scripts/upscaler_aliases.py`）だけは `tests/` に単体テストがあり、素の Python で実行できる。新しく WebUI 非依存の純粋モジュールを追加する場合は同じ形式でテストを添える。

```bash
# WebUI の extensions/ 配下に配置済み。反映は WebUI の再起動または UI の Reload で行う
# タグ YAML の構文確認（簡易チェック）
python -c "import yaml, sys; yaml.safe_load(open(sys.argv[1], encoding='utf-8'))" tags/対象ファイル.yml

# WebUI 非依存モジュールの単体テスト（リポジトリルートで実行）
PYTHONIOENCODING=utf-8 python tests/test_upscaler_aliases.py
PYTHONIOENCODING=utf-8 python tests/test_hr_cfg_inherit.py

# JavaScript の純粋モジュールの単体テスト（リポジトリルートで実行）
node --test
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

- 不整合が 1 件以上なら終了コード 1、0 件なら 0。**2026-07-25 時点のベースラインは `合計: 1 件`**（`templates/02_NSFW/机上で着崩れた制服と精液.txt:70` の `70_スタイルLoRA_Artist_` 由来。ローカル専用タグに依存する既知の残件）。テンプレやタグを編集したら実行し、**この件数から増えていないこと**を確認する。0 件を目標にしないこと。

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

### `backfill_template_rng.py` — テンプレへの RNG 追記

テンプレのパラメータ行に `RNG: <値>` を追記する。既に `RNG:` があるファイルはスキップする。

```bash
PYTHONIOENCODING=utf-8 python tools/backfill_template_rng.py              # dry-run（対象一覧と件数のみ）
PYTHONIOENCODING=utf-8 python tools/backfill_template_rng.py --apply      # 実際に書き換える
PYTHONIOENCODING=utf-8 python tools/backfill_template_rng.py --value CPU --apply  # 値を変えて焼き直す
```

必要な理由: Forge Neo は infotext に `RNG` が無いと `_populate_defaults()` が既定値（`CPU`）を補完し、現在の `randn_source` 設定と食い違うとテンプレ読込ごとに `RNG: CPU` の Override Settings を積む（本体 `modules/infotext_utils.py` の `_populate_defaults` / `get_override_settings`）。テンプレ側に明示しておくことでこれを防ぐ。

- 挿入位置は `Clip skip: N,` の直後。JS 側 `metaInfoMap` の並び順と揃えているため、UI から再保存しても差分が出ない
- Settings の Random Number Generator を変えたら `--value` を変えて再実行し、全テンプレを焼き直す（テンプレに値が焼かれているため、設定変更だけでは追随しない）
- `templates/*.txt` は CRLF 管理なので `newline=''` で読み書きしている（`_apply_audit_fix.py` と同じ理由）

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

- **git worktree は使用しない**: WebUI は本拡張を `extensions/sdweb-easy-template-selector` の実パスから直接読み込むため、worktree 内で変更しても実機確認（WebUI 再起動）に反映されない。作業は本リポジトリのチェックアウト上で直接行う

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
