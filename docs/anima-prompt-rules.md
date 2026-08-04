# Anima プロンプトルールまとめ

出典: [としあきdiffusion Wiki - Anima](https://wikiwiki.jp/sd_toshiaki/Anima)（2026-07-30 更新版を 2026-08-03 に取得）

## 基本ルール

- Danbooru タグと自然言語の両方が使え、併用も可能。Danbooru と Gelbooru で用法が異なるタグは Gelbooru が優先される
- **タグ間にアンダースコアを入れない**（`long_hair` ❌ → `long hair` ⭕）。SDXL 以上に効きが悪化する
  - 例外: Pony スコア（`score_9` など）と顔文字系（`@_@`, `^_^`）はアンダースコア可
- **カンマの後にスペースを入れる**（`1girl,looking at viewer` ❌ → `1girl, looking at viewer` ⭕）
- **数字と名詞の間のスペースを省略しない**（`2girls, 2dogs` ❌ → `2 girls, 2 dogs` ⭕）。省略すると顕著な悪影響
- 重み付けは SDXL より高い数値が必要（従来 `(chibi:2)` → Anima では `(chibi:7)` 程度）
- 自然言語は最低 2 文程度で記述するのが公式推奨。短すぎるプロンプトは望ましくない
- ただし Qwen3 小型モデルの 1k token 制限があるため **300 語以内**が無難
- 日本語は認識しない（英語で書く）

## 推奨の入力順序

```
[品質/メタ/年代/レーティング], [1girl, 1boy, 1other など], キャラクター, シリーズ, アーティスト, その他のタグや自然言語
```

品質～レーティングは順不同。従わなくてもある程度は問題ない。

## カテゴリ別タグ

### 品質

- 人間評価: `masterpiece, best quality, good quality, normal quality, low quality, worst quality`
- Pony V7 スコア: `score_9` ～ `score_1`
- `masterpiece` 多用はマスピ絵に近づく。`(masterpiece, best quality:0.4)` で弱めると緩和されるがガチャ要素が増える
- **Aesthetic モデルでは品質タグ不要**（高品質画像のみで学習済み）。残しても構わない。ディテール過剰なら score タグ削除や `anime coloring` 追加を推奨

### メタ

`highres, absurdres, anime screenshot, jpeg artifacts, official art` など

### 年代

- 年数指定: `year 2025, year 2024, ...`
- 時代指定: `newest, recent, mid, early, old`

### レーティング

`safe, sensitive, nsfw, explicit`（danbooru の general / sensitive / nsfw / explicit に対応）

- **SDXL 時代の `general` が `safe` に変わっている点に注意**
- 正式版は指示外のエロ描写を入れたがるため、SFW 絵には `safe` を明示する

### アーティスト

- **アーティストタグは先頭に `@` を付ける**。付けないと効果が弱まる

### ネガティブプロンプト（公式推奨）

```
worst quality, low quality, score_1, score_2, score_3, 6 fingers, 6 toes, ai-generated, bad eyes, bad pupils, bad iris, bad hands, bad fingers,
```

ロゴを描きたがるので以下も強く推奨:

```
watermark, patreon logo,
```

- Turbo モデルは CFG=1.0 のためネガティブプロンプトが機能しない

## プロンプトのコツ

### 複合タグ・自然言語

- 「Danbooru タグ＋人/色/形の指定」が有効（例: `blonde hair boy, black hair girl` で描き分け可能）
- 「タグ同士の距離で影響を制御する」テクニックはほぼ無意味。属性の割り当ては自然言語で書く方が確実（例: `girl is wearing glasses`）
- **BREAK 構文は使ってはいけない**

### 主語・代名詞

- `another` 系タグ（`hand on another's head`）はグダグダになりがち。行為者と相手を明示する（`left girl's hand on 1st girl's head`）
- 人称代名詞はなるべく使わない。`he` / `she` はその性別が 1 人なら可。**`it` はほぼ常に地雷**
- 関係代名詞は直前を確実に指すので有用。「直前の人間でないもの」には `it` ではなく `which` を使う

### 構図の書き方（自然言語）

自然言語の文中でも、単語が Danbooru の実在タグと一致すると**その物体が被写体として描かれる**。構図を説明したつもりの語が画面内のオブジェクトになる事故が起きるため、以下は文中で使わない。

| 使わない語 | Danbooru | 症状 |
|---|---|---|
| `camera` | 実在（14k posts） | カメラ本体・ファインダー枠が描かれる |
| `frame` / `framed` / `framing` | `framed` の別名（3.4k posts、**額縁**の意） | 額縁・枠が描かれる |
| `lens` | 実在（78 posts） | レンズが描かれる |

代わりに使う語（いずれも Danbooru に実在しないため安全）:

- **`the viewer`** — 視点の主語。Danbooru 側の `looking at viewer` / `pov` と語彙が一致するので補強し合う
- **`the view`** — 画面・画角を指す名詞（`fills most of the view` / `stays in view` / `out of view`）
- **`shot`** — `cowboy shot` など既存タグの語尾としても自然

書き換えの型:

| ❌ | ⭕ | 対応するタグ |
|---|---|---|
| the camera looks up at her from below | she is **seen from below** | `from below` |
| the camera looks down at her | she is **seen from above** | `from above` |
| the camera looks straight on at her | she is **seen straight on from the front** | `straight-on` |
| the camera sits close in front of her | **the viewer** stands close in front of her | `pov` |
| the point-of-view camera | **from the viewer's point of view** | `pov` |
| fills most of the frame | fills most of the **view** | — |
| framed from the waist up | **seen** from the waist up | `upper body` |
| crops her head out of the frame | her head is **cut off out of view** | `head out of frame` |

原則は**「カメラを主語にしない」**。視点は `the viewer` を主語にするか、被写体を主語にした受動態（`is seen from ...`）で書く。

意図的に白枠を描かせる場合（`white border` タグ併用時）も `framed by a white border` ではなく `enclosed by a white border` と書く。

### エスケープ処理

- 版権キャラの作品名カッコは**エスケープ必須**（`\(nantoka\)`）。無いと再現度が大幅低下

## 推奨生成パラメータ（参考）

| 項目 | Base | Aesthetic | Turbo |
| --- | --- | --- | --- |
| サイズ | 512×512～1536×1536 | 同左 | 同左 |
| ステップ数 | 30～50 | 30～50 | 8～12 |
| CFG | 4～5 | 4～5 | 1 |

- サンプラー: 公式お気に入りは `er_sde` / `euler_a` / `dpmpp_2m_sde_gpu`。Aesthetic / Turbo は `euler` も推奨
- スケジューラ: `beta57`（要 RES4LYF）を使わないなら `simple` が安定。**Flow Matching モデルのため `karras` / `exponential` はほぼ破綻する**
- flow_shift: 既定 3.0。ディテール強化は下げる、構図・ポーズ安定は 5.0～7.0 に上げる
- 1536×1536 超はノイズ・破綻の原因（特に縦方向）。Hires.fix でも 1536 超でノイズが出ることがある

## トラブルシューティング（プロンプト関連）

- **画風が安定しない**: ポジティブにアーティストタグを入れるより、合わない絵柄のアーティストタグをネガティブに入れる手法が有効。アニメ絵にしたいなら `anime screenshot` / `anime screencap`
- **指定していない物（猫・マスコット・汗・吐息など）が登場する**: Forge Neo では [sd-forge-negpip](https://github.com/Haoming02/sd-forge-negpip) で `(animal, speech bubble, text, wet, sweat, water drop, puff of air, sigh:-1)` のように -1 強調すると消せる
