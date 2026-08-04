# 一括生成モードの説明表示 / UI Preset へのプロファイル追従 設計

作成日: 2026-08-04

## 目的

1. 一括生成モードをチェックしたとき、操作方法の説明を表示する（初見で何をすればよいか分かるようにする）。
2. Forge Neo の UI Preset を変更したとき、拡張側のプロファイル（`illustrious` / `anima` …）を追従させる。

## A. 一括生成モードの説明行

### 表示

`99_設定` グループの「一括生成モード」チェックボックスの直下に、**チェックが ON のときだけ**説明を表示する。文言は 3 行:

```
テンプレと差し替えタグを選んで ▶一括生成。
左クリック=選択 / 右クリック=グループ全選択。
選んだテンプレ×抽選タグを順に生成します。
```

### 実装方針

- `EasyTemplateSelector.renderTemplateSettings()` で、チェックボックスを含む `buttons` 行の直後に `this.batchMode` が true のときだけ説明ブロックを append する。
- `99_設定` は `render()` のたびに作り直され、チェックボックスの `onChange` は既に `this.render()` を呼ぶため、表示/非表示のための追加配線は不要。
- 要素生成は `ETSElementBuilder.hintText(lines)` を新設して行う（DOM 生成は `ets_element_builder.js` に集約する既存方針に合わせる）。
- 見た目（小さめの文字・淡色・行間）は `style.css` の `.easy_template_hint` に持たせる。インラインスタイルは増やさない。

## B. Forge Neo の UI Preset へのプロファイル追従

### 対応規則

- **同名優先＋既定フォールバック**: Preset 名と同名のプロファイルがあればそれを選ぶ。無ければ既定プロファイル（`illustrious`）へ戻す。
  - `anima` → `anima`
  - `xl` / `sd` / `flux` / その他 → `illustrious`
- **一方向**（Neo → 拡張）。拡張側でプロファイルを手動変更しても Neo の UI Preset は変えない。
- **起動時も追従**する。ページ読み込み時に UI Preset を読み、localStorage の前回値より優先する。

### 仕様として明示する点

- Preset が「正」。`xl` のまま手動で `anima` を選んでも、次のページ読み込みで `illustrious` に戻る。
- 同名プロファイルの無い Preset では現在値を維持せず既定へ戻す。

### 実装方針

新規 `javascript/ets_preset_sync.js` に `ETSPresetSync` を置く。責務は「UI Preset を読む・変化を通知する」に限定し、プロファイル切替そのものは既存の `setProfile()` / `reload()` に任せる。

- `static resolveProfile(preset, profiles, defaultProfile)`: 純粋関数。`profiles` に `preset` と同名があればそれを返し、無ければ `defaultProfile`。`preset` が空なら `null`（＝何もしない）を返す。
- 読み取り元は Forge Neo の UI Preset ドロップダウン `#forge_ui_preset` の input。**要素が無ければ機能全体を無効化する**（reForge / A1111 には存在しないため）。
- 変化検知の方式は実機で確認して決める。Gradio 4 の Dropdown が `change` を発火するか実際に操作して確かめ、確実に取れなければ短間隔ポーリングにフォールバックする。
  - 理由: Gradio の挙動をソース読解だけで決めて外した前例がある（`Blocks.config` のキャッシュ）。**推測で確定させない。**

`EasyTemplateSelector` 側の結線:

- **起動時**: `init()` で localStorage の値を読んだ後、UI Preset が取れればそれを優先して `this.profile` を差し替えてからタグを取得する。二重 fetch を避けるためこの時点では `reload()` を呼ばない。
- **変更時**: 解決後のプロファイルが現在値と同じなら何もしない。違えば `setProfile()` → `await this.reload()`。
- **一括生成の実行中（`batchRunner.running`）は無視する**。既存の `guardBatchRunning()` と同じ扱いで、選択状態と生成を壊さない。
- 注意点: ヘッダーのプロファイル `<select>` は `render()` の初回しか構築されないため、追従時に `select.value` を明示的に更新する必要がある（`setProfile()` 内で行う）。

## テスト方針

- `ETSPresetSync.resolveProfile()` を `tests/ets_preset_sync.test.mjs` で単体テストする（`node --test`）。ケース: 同名あり / 同名なし → 既定 / 空・null → `null`。
- DOM 依存部分（要素検出・変化検知・追従結果）は WebUI 上で手動確認する。
  - Forge Neo で UI Preset を `xl` ↔ `anima` に切り替え、プロファイルとタグ・テンプレ一覧が追従すること
  - 一括生成の実行中に Preset を変えても中断されないこと
  - 一括生成モードのチェック ON/OFF で説明行が出入りすること

## スコープ外

- 拡張 → Neo の逆方向同期
- Preset とプロファイルの対応表を設定で持たせること（同名規約で足りるため）
