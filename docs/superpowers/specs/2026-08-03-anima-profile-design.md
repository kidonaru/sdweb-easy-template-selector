# anima プロファイル対応 設計書

日付: 2026-08-03

## 目的

現状 illustrious 系モデル前提のタグ・テンプレートを、UI 切り替えで anima 系モデルでも使えるようにする。プロンプトはある程度互換があるためタグは共有 + 差分方式とし、テンプレートは完全分離する。

## 方針の要約

- **タグ**: ベース `tags/*.yml` を共有し、anima はサブディレクトリ差分（stem 置換 + 除外リスト）で上書きする
- **テンプレート**: `templates/anima/` に完全分離。既存テンプレは移動せず illustrious 用として扱う
- **マージはサーバー側**: JS は「もらったセットを描画するだけ」を維持し、マージ規約は Python の純粋モジュールに一元化してツール類からも再利用する

## 1. データレイアウト

```
tags/
├── 01_クオリティ.yml        # 共有（illustrious のとき使用）
├── ...
└── anima/
    ├── 01_クオリティ.yml    # anima 用に差し替え（同名 stem で置換）
    ├── 90_モデル.yml
    ├── 96_解像度.yml
    ├── 99_ネガティブ.yml
    └── _exclude.yml         # anima で除外するカテゴリ stem のリスト
templates/
├── 01_SFW/                  # 既存 = illustrious 用（移動しない）
├── 02_NSFW/
└── anima/
    ├── 01_SFW/
    └── 02_NSFW/
```

- 差し替え対象カテゴリ: `01_クオリティ` / `90_モデル` / `96_解像度` / `99_ネガティブ`（+ 必要に応じて LoRA 系の anima 版）
- `_exclude.yml` の初期値: `10_キャラ_LoRA`, `10_キャラ_ブルアカ_LoRA`, `13_衣装_LoRA`, `30_ポーズ_LoRA`, `70_スタイルLoRA`, `71_ディテールLoRA`, `72_体LoRA`, `75_その他LoRA`
- ファイル名は既存の命名規則（`番号_カテゴリ名[_サブ分類].yml`）を維持
- 末尾 `_` のローカル専用ルールは `tags/anima/` 配下でも同様（gitignore パターンを確認して必要なら追記）

## 2. サーバー側

### 新規純粋モジュール `scripts/tag_profiles.py`（WebUI 非依存）

責務:

- プロファイル名の列挙（`tags/` 直下のサブディレクトリから検出。既定プロファイルは `illustrious` = ベースのみ）
- タグセットのマージ: ベース stem 一覧に `tags/<profile>/*.yml` を stem 置換で重ね、`_exclude.yml` 記載分を落とす
- テンプレディレクトリの解決: `illustrious` → `templates/`（他プロファイル名のサブディレクトリを除外）、`anima` → `templates/anima/`

`tests/test_tag_profiles.py` を素の Python で実行できる形で添える。

### `scripts/setup.py` の変更

- `GET /easy-template/tags?profile=<name>`: マージ済みタグセットを返す。`profile` 省略 or `illustrious` はベースのみ
- `GET /easy-template/templates?profile=<name>`: プロファイルに応じたテンプレツリーを返す
- `POST /easy-template/save-template`: リクエストに profile を追加し、保存先ディレクトリを振り分け
- `tag_files()` の `rglob` を「ベース直下 + 指定プロファイル配下」の明示走査に変更（サブディレクトリ導入による stem 衝突の解消）

## 3. JS 側 UI

- ヘッダーに profile ドロップダウン（`illustrious` / `anima`）を常設
- 選択は localStorage（キー: `easy_template_profile`）に保存し、起動時に復元
- 切り替え時の動作:
  - `fetchTags()` を profile 付きで再実行
  - タグボタン・テンプレツリー・補完インデックス（`ETSCompletionIndex`）を再構築
  - プロンプト欄・除外タグ欄は**触らない**（書き直しは手動）
- テンプレ保存時は現在の profile を API に渡す
- 一括生成の実行中はドロップダウンも `guardBatchRunning()` でガードする
- ヘッダーは `render()` の `if (!container)` でしか構築されないため、ドロップダウンも常設要素として一度だけ作る（既存の一括生成 UI と同じ扱い）

## 4. ツール類

- `audit_templates.py`: テンプレの場所（`templates/anima/` 配下か否か）から profile を自動判定し、対応するマージ済みタグセットで照合する。`tag_profiles.py` を再利用
- `search_tags.py`: `--profile` オプションを追加（既定は全プロファイル横断）
- `search_danbooru.py --yaml`: 既存のまま全ファイル走査で問題なし（変更不要）

## 5. スコープ外（YAGNI）

- プロファイルの動的追加 UI（ディレクトリを掘れば増える設計にはしておく）
- 既存テンプレの `illustrious/` サブディレクトリへの移動
- anima 用タグ YAML の中身（クオリティタグの具体値など）の整備 — 本実装後に別タスクで行う

## テスト方針

- `tests/test_tag_profiles.py`: マージ・除外・テンプレディレクトリ解決の単体テスト（素の Python）
- JS 側は実機（WebUI 上）で動作確認: profile 切り替え → タグボタン/テンプレツリー/補完の再構築、テンプレ保存先の振り分け、一括生成中のガード
- `audit_templates.py` を実行し、ベースライン（1 件）から増えていないことを確認
