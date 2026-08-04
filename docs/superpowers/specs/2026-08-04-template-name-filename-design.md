# 出力画像のファイル名にテンプレート名を入れる

## 目的

生成画像がどのテンプレートから出たものかを、ファイル名だけで判別できるようにする。特に一括生成では 1 セッションで多数のテンプレートを回すため、エクスプローラ上で並べたときに区別が付かない。

## 方針

本体のファイル名パターンで使えるキーワード `[template_name]` を拡張から追加する。拡張が保存処理へ割り込んで名前を強制するのではなく、本体の既存仕組み（`FilenameGenerator`）に 1 キー足すだけに留める。

配置の自由度が上がる（先頭・末尾・サブフォルダのいずれにも使える）うえ、本体の保存処理には触れないため壊れにくい。代償として、利用者は **Settings > Saving images > Images filename pattern** を一度編集する必要がある（例: `[seed]-[template_name]`）。

## 値の流れ

除外タグ（`easy_template_selector_exclude_tags`）と同じ配線に乗せる。

```
ヘッダの「テンプレート名」欄 (DOM textarea, IDS.TEMPLATE_NAME)
  → input イベントで hidden Gradio Textbox へ書き込み（updateInput 付き）
  → Script.process で p.ets_template_name に格納
  → FilenameGenerator の [template_name] が p から読む
```

- hidden Textbox 経由なので値は生成リクエストに同梱される。テンプレ適用直後に生成しても古い値が使われる競合が起きない。
- テンプレ適用時は `applyMeta()` が `updateInput()` を呼ぶため、手入力と同じ `input` イベントとして観測できる。リスナは 1 本で手入力とテンプレ適用の両方をまかなう。

## 陳腐化の扱い

「テンプレート名」欄の現在値をそのまま使う。テンプレ適用後にプロンプトを手で編集しても名前は残る。

理由:

- 欄は画面に見えていて手で書き換えられるので、値が実態とずれても利用者が把握・修正できる
- 一括生成では帯単位でタグを差し替えるのが常態であり、「プロンプトが変わったら名前を消す」方式だとほぼ常に名前が消えて役に立たない
- 派生画像であっても元テンプレが分かることに価値がある

## 値の整形

`02_NSFW/おしがま` → `おしがま`。

- 末尾要素のみを取る。区切りは `/` と `\` の両方を扱う
- 本体の `sanitize_filename_part` を `replace_spaces=False` で通し、ファイル名に使えない文字を落とす。`I Need Buzz` のような空白入りのテンプレ名をそのまま読める形で残すため
- 空のときは `NOTHING_AND_SKIP_PREVIOUS_TEXT` を返す。`[seed]-[template_name]` のようなパターンで区切り文字だけが残るのを防ぐ（本体の `[denoising]` と同じ作法）

整形部分は WebUI 非依存の純粋関数として切り出し、`tests/` に単体テストを添える（既存の `upscaler_aliases` 等と同じ方針）。

## 登録方法

`FilenameGenerator.replacements` はクラス変数のため、拡張の import 時にキーを 1 つ追加するだけでよい。本体のコードは変更しない。

`grid_filename_pattern` と `directories_filename_pattern` も同じ generator を使うので、グリッド画像やサブフォルダ分けにもそのまま流用できる。

## 変更ファイル

| ファイル | 内容 |
|---|---|
| `scripts/template_name_filename.py`（新規） | 整形の純粋関数 + `[template_name]` の登録 |
| `scripts/easy_prompt_selector.py` | hidden Textbox（`elem_id: easy_template_selector_template_name_bridge`）を `ui()` の戻り値**末尾**に追加、`process` で `p` へ格納 |

JS 側のテンプレート名欄が既に `easy_template_selector_template_name` を使っているため、hidden Textbox 側は `_bridge` サフィックスを付ける（除外タグの `..._exclude_tags_input` / `..._exclude_tags` と同じく、JS 側と Python 側で id を分ける）。
| `javascript/easy_template_selector.js` | テンプレート名欄 → hidden Textbox の同期 |
| `tests/test_template_name_filename.py`（新規） | 整形関数の単体テスト |

`ui()` の戻り値は位置で `process(p, *args)` に届くため、新しい Textbox は必ず末尾に追加する（既存の `args[2]` = 除外タグ、`args[3]` = プロファイルの位置を崩さない）。

## 影響範囲

- 生成画像の infotext は変わらない。テンプレート保存への影響なし
- img2img は `ui()` が `None` を返して args が空になるため値が届かない。空扱いでスキップされる
- ファイル名パターンを編集しない限り、既存の挙動は一切変わらない

## テスト方針

- 整形関数: `tests/test_template_name_filename.py` を素の Python で実行
- 配線: WebUI 上で確認する
  - ファイル名パターンに `[template_name]` を入れ、テンプレ適用 → 生成 → ファイル名に名前が入ること
  - 欄を空にして生成 → 区切り文字が残らないこと
  - 一括生成 → テンプレごとに違う名前が付くこと
  - 除外タグ・プロファイルが従来どおり効くこと（args の位置がずれていないことの確認）
