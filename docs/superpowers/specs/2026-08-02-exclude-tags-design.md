# 除外タグ機能 設計

## 目的

99_設定 グループに「除外タグ」テキストエリアを追加し、そこに書かれたタグを生成時のプロンプトから取り除く。テンプレートには含まれているが今回は出したくないタグ（例: `black footwear, black pantyhose,`）を、テンプレートを編集せずに一時的に無効化するための機能。

## 決定事項

| 論点 | 決定 | 理由 |
|---|---|---|
| 削除する場所 | Python の生成時（`Script.process`） | プロンプト欄を書き換えないため、補完・キャレット同期・一括生成の待機制御に干渉しない |
| 値の受け渡し | hidden Gradio Textbox | 生成リクエストに同梱されるためタイミング競合が起きない。新規 API も設定項目も不要 |
| 永続化 | localStorage | サーバ側の状態を増やさない |
| マッチング | 厳密一致 | 重み記法 `(tag:1.2)` や大文字小文字違いは別物として残す |
| 適用対象 | ポジティブ系のみ（`all_prompts` / `all_hr_prompts`） | ネガティブから消すと望まない要素が出るようになり、事故が分かりにくい |
| 一括生成の実行中 | `readOnly` | プロンプト欄と一貫した挙動。実行途中で除外条件が変わる事故を防ぐ |

## UI（JavaScript）

`renderTemplateSettings()` の 99_設定 グループに、既存チェックボックス行の下へテキストエリアを 1 つ追加する。

- DOM 生成は既存規約どおり `ETSElementBuilder` に集約する。既存の `textarea()` はテンプレート名用の単一行 `<input>` を作る別物なので、複数行の `<textarea>` を作る `multilineTextarea()` を新設する
- 99_設定 グループは `render()` のたびに作り直されるため、値の保持元はインスタンス変数 `this.excludeTags` とし、描画時にそこから初期値を入れる
- placeholder は `black footwear, black pantyhose,`
- 入力のたびに次の 2 つを行う
  1. localStorage（キー `easy_template_exclude_tags`）へ保存
  2. hidden Gradio Textbox へ値を書き込み、`updateInput()` で Gradio のフロント状態へ反映
- UI 読込時に localStorage から復元し、同じ経路で Gradio 側へも反映する
- 一括生成の**実行中**は `readOnly` にする。切り替えは `syncBatchControls()` に相乗りさせる（実行/停止ボタンの排他表示と同じ 1 箇所で完結させるため）

## 受け渡し（JavaScript → Python）

`Script.ui()` の戻り値に `gr.Textbox(elem_id='easy_template_selector_exclude_tags', visible=False)` を追加し、`process(self, p, *args)` の `args[2]` で受け取る。

- `ui()` は img2img で `None` を返し args が空になるため、長さで防御して未指定時は何もしない

## 除去ロジック（Python）

WebUI 非依存の純粋モジュール `scripts/exclude_tags.py` を新設する。

- `parse_exclude_tags(text)`: `,` と改行で分割 → trim → 空要素と重複を除去した一覧を返す
- `remove_excluded_tags(prompt, excludes)`: 行ごとに `,` で分割し、`strip()` が除外集合と厳密一致する要素だけ落として `,` で連結し直す
  - 区切りを保つため空要素は落とさない（`1girl,solo,` から `solo` を消すと `1girl,` になる）
  - 行全体が消えた場合は空行として残し、既存の「出力時に空行を削除する」設定に任せる
  - `#` / `//` で始まる行は対象外とし、カテゴリコメント行を壊さない

適用位置は `replace_template_tags()` の中、**`@...@` 展開の後・`format_prompt()` の前**。

- 展開後に置くのは、ランダム抽選で出たタグも除外対象にするため
- 整形前に置くのは、空になった行を既存の空行削除に拾わせるため

対象は `p.all_prompts` と `p.all_hr_prompts` のみ。

## infotext

除去は `all_prompts` に対して行うため、生成画像の infotext には除去済みプロンプトが焼かれる。除外タグ自体は `extra_generation_params` に記録しない。

## テスト

`tests/test_exclude_tags.py` を素の Python で実行できる形で追加する（既存の `tests/test_upscaler_aliases.py` と同形式）。

検証する挙動:

- 単純な除去（`1girl,solo,` から `solo`）
- 末尾カンマと区切りの保持
- 重み記法 `(black footwear:1.2)` を残すこと
- 大文字小文字違いを残すこと
- 部分一致（`black footwear focus`）を残すこと
- コメント行を素通しすること
- 行全体が消えたときに空行になること
- 除外指定が空のときに入力をそのまま返すこと
- エスケープ括弧を含むタグ（`mari \(blue archive\)`）の除去
- 末尾カンマの無い行が除外タグだけだったときに空行になること
- 複数のプロンプト一覧へまとめて適用したときに in-place で書き換わること

## 影響範囲

| ファイル | 変更 |
|---|---|
| `javascript/ets_element_builder.js` | `multilineTextarea()` 追加 |
| `javascript/easy_template_selector.js` | 99_設定 への追加・localStorage・Gradio 同期・readOnly 切替 |
| `scripts/easy_prompt_selector.py` | `ui()` に Textbox 追加、除去処理の呼び出し |
| `scripts/exclude_tags.py` | 新規 |
| `tests/test_exclude_tags.py` | 新規 |
| `CLAUDE.md` | 構成表と落とし穴の追記 |

## スコープ外

- ネガティブプロンプトへの除外適用
- 除外タグのプリセット保存・切り替え
- 除外が効いたことの UI 上でのフィードバック表示
