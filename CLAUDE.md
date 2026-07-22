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
├── tags/                         # タグ定義 YAML（番号_カテゴリ名.yml 形式）
├── tags_examples/                # タグ定義のサンプル
├── templates/                    # プロンプトテンプレート（pnginfo の .txt、階層管理可）
├── tools/                        # 変換・分割スクリプト（convert_to_yaml.sh 等）
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
