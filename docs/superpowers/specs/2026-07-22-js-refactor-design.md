# easy_prompt_selector.js リファクタリング設計

日付: 2026-07-22

## 目的

`javascript/easy_prompt_selector.js`(1580 行・単一ファイル)を責務ごとに 6 ファイルへ分割し、可読性・保守性を高める。外部公開を見据え、クラス境界がドキュメント代わりになる粒度を目指す。**挙動は一切変更しない純粋なリファクタ**である。

## 背景

現状は 3 クラスが 1 ファイルに同居している:

- `ETSElementBuilder`(~370 行): DOM 生成
- `ETSSection`(~100 行): プロンプトセクション表現
- `EasyTemplateSelector`(~1100 行): UI 描画・タグ操作・テンプレート管理・Undo/Redo・メタ情報適用が混在する神クラス

## ファイル構成

すべて `javascript/` 直下。数字プレフィックスは付けない。

| ファイル | クラス | 責務 | 移動するメソッド(元 EasyTemplateSelector) |
|---|---|---|---|
| `ets_section.js` | `ETSSection` | セクションの表現・判定・文字列化 | (既存クラスをそのまま移動) |
| `ets_element_builder.js` | `ETSElementBuilder` | DOM 要素の生成 | (既存クラスをそのまま移動) |
| `ets_prompt_editor.js` | `ETSPromptEditor`(新規) | プロンプトの分解・タグ追加/削除/移動・選択状態管理 | `splitSections` / `parseSection` / `addTag` / `removeTag` / `moveTag` / `updateTagInfo` / `selectCurrent` |
| `ets_template_manager.js` | `ETSTemplateManager`(新規) | テンプレート適用/保存・メタ情報の読み書き | `applyTemplate` / `convertToTemplate` / `saveTemplate` / `parseMetaText` / `applyMeta` / `getMetaElement` / `getCurrentMetaDataMap` / `getCurrentModel` / `getCurrentSize` |
| `ets_history.js` | `ETSHistory`(新規) | Undo/Redo 履歴管理 | `undoLastAction` / `redoLastAction` / `saveTextHistory` / `restoreFromHistory` / `resetTextHistory` / `updateUndoRedoButtons` |
| `easy_template_selector.js` | `EasyTemplateSelector` | タグ読込・UI 描画・各クラスの生成と結線 | `init` / `readFile` / `fetchTags` / `render` / `renderTabs` / `renderContent` / `renderTagButtons` / `renderTagButton` / `changeVisibility` / `reload` |

## インターフェース方針

- 新クラスはコンストラクタで依存(gradioApp 参照・設定・必要な ID 定数)を受け取る。
- 相互作用が必要な箇所(例: PromptEditor での編集後に History へ保存)は `EasyTemplateSelector` 経由またはコールバック注入で結線し、クラス間の直接循環参照を作らない。
- メソッドは「移動+委譲」を基本とし、ロジックの書き換えは行わない。共有状態(`currentSection`、`metaInfoMap`、ID 定数など)の所属クラスは責務に従って移し、他クラスからはコンストラクタ注入かメインクラス経由で参照する。
- `onUiLoaded` 登録などの既存エントリポイントの動作は維持する。

## 制約・規約

- **各ファイルのトップレベルで他ファイルのクラスを参照しない。** WebUI は `javascript/` 配下をアルファベット順に読み込むため、実行時(`onUiLoaded` 以降)にのみクラスを参照すれば順序に依存しない。この規約を CLAUDE.md に追記する。
- `javascript/js-yaml.min.js` は vendored のため触らない。

## テスト方針

ビルド・テスト基盤がないため:

1. 分割後、各ファイルを `node --check` で構文検証する。
2. reForge 上で手動確認: タグ追加/削除/移動、テンプレート適用/保存、Undo/Redo、タブ切替、タグ情報ドロップダウン、解像度変更、リロード。

## 影響範囲

- `scripts/*.py` は JS ファイル名に依存していない想定(実装前に grep で確認する)。依存があれば追随修正する。
- `style.css` は影響なし。
