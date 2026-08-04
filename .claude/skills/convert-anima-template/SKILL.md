---
name: convert-anima-template
description: 既存の illustrious 用テンプレート .txt を Anima モデル用に変換し、templates/anima/ 配下へ保存する。docs/anima-prompt-rules.md の変換ルールを適用し、シーンを要約した自然言語描写セクションを生成して追加する。形式は create-template スキルの規約に従う。「anima 用に変換して」「テンプレを anima 化して」「anima 向けテンプレを作って」「このテンプレを Anima で使いたい」と言われたら、テンプレ名の断片だけ渡された場合でも必ずこのスキルを使うこと。
---

# convert-anima-template

illustrious 用テンプレート（`templates/01_SFW/` / `templates/02_NSFW/`）を Anima モデル用に変換するスキル。

- **変換ルールの根拠は `docs/anima-prompt-rules.md`**。作業前に必ず読むこと（本スキルは要点のみ再掲する。矛盾したら docs 側が正）。
- **テンプレート形式・タグ照合・Danbooru 実在確認・報告の規約は `create-template` スキル**（`.claude/skills/create-template/SKILL.md`）に従う。新規タグを YAML へ追記する場面が出たら、そのセクションのルールをそのまま適用する。

## プロファイルの前提

- 保存先は `templates/anima/01_SFW/` または `templates/anima/02_NSFW/`（元テンプレと同じ SFW/NSFW 区分・同じファイル名）。`templates/<profile>/` がプロファイルのルートになる（`scripts/tag_profiles.py` の規約）。
- タグ検索は必ず `--profile anima` を付ける: `PYTHONIOENCODING=utf-8 python tools/search_tags.py --profile anima <検索語>`。
- **参考テンプレは `templates/anima/01_SFW/I Need Buzz.txt` に固定する。** LoRA ブロック・メタデータ行・セクションの並びはこれを基準に踏襲する（テンプレごとに直近の別テンプレを見に行くと変換のたびに揺れるため）。
- **除外カテゴリは `_exclude.yml` の記載だけでは決まらない。** `resolve_tag_files()`（`scripts/tag_profiles.py`）は `_exclude.yml` 記載の stem を落とした**後**に `tags/anima/*.yml` を stem 置換で重ねるため、anima 側に同名ファイルがあるカテゴリは復活する。
    - **実際に除外される**（= anima テンプレで使えない。カテゴリコメントを書くと監査で不整合になる）: `10_キャラ_LoRA` / `10_キャラ_ブルアカ_LoRA` / `13_衣装_LoRA` / `30_ポーズ_LoRA` / `72_体LoRA`
    - **復活していて使える**: `70_スタイルLoRA` / `71_ディテールLoRA` / `75_その他LoRA`（anima 用 LoRA を収めた `tags/anima/` の同名ファイルで置換されている）
    - 判定を暗記せず、`ls tags/anima/` と `_exclude.yml` の差分で毎回確認する（anima 用 LoRA が増減すると顔ぶれが変わる）
- 変換後のテンプレ末尾には、参考テンプレと同じ **anima 用 LoRA ブロック**（`71_ディテールLoRA` / `70_スタイルLoRA` / `75_その他LoRA`）をネガティブ行の直前に置く。元テンプレの illustrious 用 LoRA を移植するのではなく、参考テンプレの内容をそのまま踏襲する。
- 実行時整形（`scripts/prompt_format.py`）が anima プロファイルの生成時にカンマ後スペース挿入と BREAK 除去を行う。**テンプレ内のカンマ後スペースを手で整える必要はない**（既存の `cute,kawaii` 形式のままでよい）。

## 変換ルール

元テンプレのセクションを上から順に処理する。カテゴリコメント + タグ行のペア構造は維持する。

1. **LoRA セクションの削除と置き換え**: 除外カテゴリ（上記）のセクションと、タグ行中の `<lora:...>` は削除する。ただし**削除で済ませてよいのは装飾系（ディテール / スタイル / 画質ブースト）だけ**。
    - **そのセクションがテンプレの主題（キャラ・衣装・行為・シチュエーション）を担っているなら、削除ではなく同義の実在タグへ置き換える。** 丸ごと消すとテンプレの中身が消滅する
    - LoRA のトリガーワードは Danbooru 実在確認（`search_danbooru.py --exact`）を通す。実在すればそのまま代替セクションのタグに使える。非実在なら捨てて、シチュエーションを表す実在タグの組み合わせで代替セクションを新規作成する（追記先はベースの YAML。create-template の規約どおり）
    - 例: `30_ポーズ_LoRA (スライム姦)` の `<lora:slime sex_...:1> slime sex,slime,restrained,spread legs` → `slime sex` は非実在なので破棄し、`30_ポーズ_NSFW:その他 (スライム姦) = slime \(creature\),slime \(substance\),monster,sex` を新規追加 + 既存の `30_ポーズ_NSFW:オリジナル (拘束/足を広げる)` を流用
    - 削除したもの・置き換えたものは報告に列挙する
2. **アンダースコア除去**: タグ内の `_` はスペースに置換する（`long_hair` → `long hair`）。例外: Pony スコア（`score_9` 等）と顔文字系（`@_@`, `^_^`, `=_=` 等）は保持する。
3. **数字と名詞のスペース**: `2girls` → `2 girls` のように数量タグにスペースを入れる。
    - 変換後の表記が `--profile anima` の検索でヒットするか確認する
    - ヒットしなければ create-template の手順で追記する。追記先はベースの YAML でよい（anima プロファイルはベースを継承するため）
4. **クオリティセクションの置換**: 元の `# 01_クオリティ:Model (...)` セクションを、使用する Anima チェックポイントのエントリに置き換える。エントリはチェックポイント名がキー（例: `Nova Anime AM v3.0A`）。登録済みのチェックポイントは `90_モデル.yml` の `Anima` グループで確認し、`search_tags.py --profile anima --mode label "<チェックポイント名>"` で対応するクオリティエントリを探す。無ければ初回セットアップ（後述）を行う。
5. **レーティングの明示**: Anima は SDXL の `general` が `safe` に変わっている。
    - SFW テンプレ → `safe` を明示的に含める（正式版が指示外のエロ描写を入れたがるため）
    - NSFW テンプレ → 内容に応じて `nsfw` / `explicit`
    - エントリは `01_クオリティ.yml` の `レーティング` グループに登録済み。無い値が必要になったら同グループへ追記する
6. **アーティストタグの @ 付与**: アーティスト名タグには先頭に `@` を付ける（付けないと効果が弱い）。キャラ名・作品名は対象外。
7. **BREAK 行の削除**: Anima では BREAK 構文は使用禁止。リテラル `BREAK` 行は削除する（illustrious 版で保持する慣習とは逆）。
8. **重み付きタグの扱い**: Anima は SDXL より高い重みが必要（`(chibi:2)` → `(chibi:7)` 程度）だが、適正値はタグごとのガチャ要素が大きい。**自動でスケールせず元の値のまま残し**、重み付きタグの一覧を報告して手動チューニングを促す。
9. **ネガティブプロンプトの置換**: 元の 99_ネガティブ群を、参考テンプレと同じ `99_ネガティブ:Model (<チェックポイント名>)` の 1 セクションだけに置き換える。**元テンプレ固有のネガティブ（画風混入防止・事故防止タグなど）は既定で落とし、落としたものを報告に列挙する**（ユーザーが必要と判断すれば戻す）。Anima はネガティブの効きが illustrious と違うため、まず素の推奨だけで様子を見る。
10. **キャラ・衣装セクション**: `10_キャラ_ブルアカ` / `13_衣装_ブルアカ` 等の非 LoRA キャラセクションはそのまま流用する（作品名カッコのエスケープ `\(...\)` は Anima でも必須なので維持）。
11. **自然言語シーン描写の追加**: テンプレ全体のタグからシーンを要約した 2〜3 文の英語を生成し、末尾（ネガティブの前）に独立セクションとして追加する。Anima は自然言語の併用が公式推奨（最低 2 文、属性割り当てはタグ距離より自然言語が確実）のため。

    ```
    # 80_自然言語:シーン (夕暮れの屋上),
    A girl is sitting on a bench on the school rooftop at sunset. She is smiling gently while autumn leaves drift around her.,
    ```

    書き方のルール:
    - **キャラの外見（髪色・目・衣装・体型・固有名）は書かない**。外見はタグセクションに任せることで、一括生成でキャラを差し替えても自然言語と矛盾しない。主語は `a girl` / `the girl on the left` のような無指名で書く
    - ポーズ・状況・構図・人物間の関係性を書く。複数人の属性割り当てや行為（`left girl's hand on ...` 相当）はタグより文で明示する方が確実
    - **構図を `camera` / `frame` / `framed` / `framing` / `lens` で書かない。** いずれも Danbooru の実在タグ（`framed` は額縁、`camera` はカメラ本体）で、文中にあるとその物体が被写体として描かれる。カメラを主語にせず、`the viewer` を主語にするか被写体を主語にした受動態で書く（`the camera looks up at her from below` → `she is seen from below`、`fills most of the frame` → `fills most of the view`）。詳細な書き換え表は docs の「構図の書き方（自然言語）」
    - 代名詞は極力使わない。`he` / `she` はその性別が 1 人のときのみ可、**`it` は使わない**（人間でないものは関係代名詞 `which` で受ける）
    - テンプレ全体で 300 語以内（Qwen3 の 1k token 制限）
    - エントリは `tags/anima/80_自然言語.yml` の `シーン` グループへ日本語ラベル付きで追記する（anima プロファイル専用の新規 stem なので illustrious 側には現れない。ファイルが無ければ作成する）
    - 元テンプレに「オリジナル」系グループの複合シーン記述フレーズがある場合、それを文へ昇格させる素材にしてよい（昇格させたらタグ側セクションは削除し、報告に含める）
    - 落とし穴: 80 番台は一括生成の差し替え対象帯。同帯のセクションを他に作らない限り実害は無いが、80 番台へ別カテゴリを増やすときは `bandOf()` の挙動を再確認すること
12. **自然言語風フレーズのタグコア分離**:

    判定基準: セクションのタグ行を Danbooru で引き、実在しない多語フレーズが主体なら分離対象（例: `bright natural sunlight pouring through large windows`）。`dripping pussy` のような実在タグ単体のセクションは対象外でそのまま残す。

    分離対象は次の 2 段階で処理する:
    1. **タグコア抽出**: フレーズが指す内容のうち Danbooru タグとして成立する部分だけを短いセクションとして残す。既存のアトムなエントリ（`半目` / `赤面` / `膝立ち` 等）に分解できるなら流用し、無ければ実在確認の上で追記する。例: `明るく清潔なリビングルーム` の長文 → `living room,wooden floor,window,indoors`
    2. **記述部分の統合**: 光の当たり方・緊張感・雰囲気・体の細かな状態などタグ化できない描写は、ルール 11 の自然言語シーン描写の文へ統合する。**複数セクション由来の記述もテンプレ全体で 1 つの 80 セクションにまとめる**（セクションごとに文を分けない）

    付随ルール:
    - 元のオリジナル系 YAML エントリは変更しない（追記のみ）。タグコア版は新しいラベルで追記する。例: `透け感のある可愛らしいホームドレス` はそのまま残し、`透けフリルドレス: see-through,frilled dress,off shoulder` を追加
    - 分解・昇格した元セクションと生成した文の対応は報告に含める
13. **非実在タグの正規化と自然言語への寄せ**: 組み立てた全セクションのタグを `search_danbooru.py --exact` にかけ、`NG` のタグを次の優先順で処理する。多語フレーズだけでなく **1〜2 語の非実在タグも対象**（ルール 12 は「フレーズが主体のセクション」だけを見るので、そこから漏れる）。

    1. **正規タグへ置き換える**: 例 `body shot` → `full body`、`shallow depth of field` → `depth of field`、`see-through clothes` → `see-through`
    2. **実在タグの組み合わせへ分解する**: 例 `dust particles in moonlight` → `dust,moonlight,light particles`
    3. **タグ化できない描写・関係性は落として文へ吸収する**: ルール 11 の 80_自然言語セクションに書く。例 `tentacles grabbing another's breast` → セクションごと削除し、文に「触手が胸を締めつける」相当を含める（`another's` 系は docs 的にも精度が低い）

    付随ルール:
    - **例外（実在確認しない・変更しない）**: `01_クオリティ` 帯（品質 / スタイル / レーティング。`masterpiece` / `score_7` / `very aesthetic` / `safe` / `nsfw` / `cute` / `kawaii` など、描写ではなくモデルへの効き方を指定する語彙）、`99_ネガティブ` 帯、LoRA トリガーワード、キャラ固有の学習語（`mari halo` など作品由来のタグ）
    - **共有 YAML の既存エントリは書き換えない**。illustrious 側の全テンプレに波及するため、正規化版は**新しいラベルで追記**して anima テンプレ側がそちらを指す（例: `全身: body shot` は残し、`全身2: full body` を追加）。同義の既存エントリがあればそれを流用する（例: `youthful,petite` → 既存の `小柄: petite`）
    - 置き換え・分解・文へ吸収した対応表を報告に含める

### メタデータ行

メタデータ行は 2 つの出所を**値ごとに**使い分ける。「参考テンプレを流用」と「元テンプレを移植」が競合したときは、下の分類が正。

- **参考テンプレ（`templates/anima/01_SFW/I Need Buzz.txt`）から流用する = モデル依存の固定値**
    - `Steps` / `CFG Scale` / `Sampler` / `Schedule type` / `Model`
    - 併せてクオリティセクション（`01_クオリティ:Model`）とネガティブセクション（`99_ネガティブ:Model`）も同じチェックポイントのものに揃える
    - 参考値: Steps: 30 / CFG Scale: 4.5 / Sampler: `Euler a` / **Schedule type: `Simple`**（Flow Matching モデルのため Karras / Exponential は破綻する。`Automatic` も Karras に解決されうるので使わない）
- **元テンプレから移植する = 画の再現に関わる可変値**
    - `Size` / `Seed` / `RNG` / `Denoising strength` / `Hires` 一式（`Hires CFG Scale` / `Hires upscale` / `Hires steps` / `Hires upscaler`）
    - 解像度や Hires 倍率、アップスケーラの種類を参考テンプレに合わせて書き換えないこと。元絵の再現性が崩れる
- **チェックポイントの選び方**: 既定は参考テンプレが使っているもの。`90_モデル.yml` の `Anima` グループに複数登録があっても、ユーザーの指定が無ければ参考テンプレに追従し、採用したモデル名を報告に明記する。未登録のチェックポイントを使う指示が出たら初回セットアップ（後述）を行う。

## 初回セットアップ（使用チェックポイントのエントリが未登録の場合)

エントリのキーは汎用の `Anima` ではなく**チェックポイント名**（例: `Nova Anime AM v3.0A`）。`Model` グループの既存エントリと同じ規約で、以下の 3 ファイルを対応するキーで揃えて追記する。追記先はベースの YAML（anima プロファイルはベース YAML を継承するため、`tags/anima/` に置換ファイルを作らない。作ると同 stem のベース全体が置換されてしまう）:

- `90_モデル.yml` の `Anima` グループ: `<チェックポイント名>: <モデルファイルの stem>`
- `01_クオリティ.yml` の `Model` グループ: そのモデルの推奨品質タグ。配布元の推奨が無ければ `masterpiece, best quality` を出発点に、ユーザーの使用バリアント（Base / Aesthetic / Turbo）を `AskUserQuestion` で確認して決める（Aesthetic は品質タグ不要のため空寄りでもよい）
- `99_ネガティブ.yml` の `Model` グループ: そのモデルの推奨ネガティブ。無ければ公式推奨
  `worst quality, low quality, score_1, score_2, score_3, 6 fingers, 6 toes, ai-generated, bad eyes, bad pupils, bad iris, bad hands, bad fingers, watermark, patreon logo`
  を出発点にする（Turbo は CFG=1 でネガティブが機能しない点をユーザーに伝える）

追記後は YAML 構文確認（`python -c "import yaml, sys; yaml.safe_load(open(sys.argv[1], encoding='utf-8'))" tags/対象.yml`）を行う。

## 手順

1. 対象テンプレを特定して読む（名前の断片なら `templates/` を検索して確認）。併せて参考テンプレ `templates/anima/01_SFW/I Need Buzz.txt` を読む
2. `docs/anima-prompt-rules.md` を読む
3. 初回セットアップの要否を `--profile anima` の検索で確認し、必要ならユーザー確認の上で追記
4. 「変換ルール」を上から適用してセクションを組み立てる。新規タグの追記・実在確認は create-template の規約どおり
5. `templates/anima/<SFW区分>/<元と同じファイル名>.txt` に UTF-8 で保存（改行は CRLF。既存テンプレと同じ）
6. `PYTHONIOENCODING=utf-8 python tools/audit_templates.py` を実行し、不整合がベースライン（CLAUDE.md 参照）から増えていないことを確認
7. 報告する

## 報告

create-template の報告項目に加えて:

- 削除した LoRA セクション・トリガーワードと、主題を担っていたため**代替セクションへ置き換えた**もの（置き換え前後の対応）
- 採用したチェックポイント名（参考テンプレ追従か、ユーザー指定か）
- 落とした元テンプレ固有のネガティブセクション
- アンダースコア除去・数字スペース挿入で表記が変わったタグ
- @ を付けたアーティストタグ
- 削除した BREAK 行の位置
- **元の重みのまま残した重み付きタグ**（Anima では高い値が必要な旨を添える）
- 置き換えたクオリティ / ネガティブ / メタデータの内容
- 追加した自然言語シーン描写の全文と、素材として昇格・削除したタグセクション
- **非実在タグの正規化対応表**（置き換え / 分解 / 文へ吸収 の別と、追記した新ラベル）
