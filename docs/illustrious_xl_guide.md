# Illustrious XL v2.0 プロンプトガイド

SeaArt AI の解説記事（GrayMan 著、2025-03-18 更新）を元にした、Illustrious XL v2.0 でのプロンプトの書き方まとめ。

- 出典: https://www.seaart.ai/articleDetail/cvceb6le878c73bckfig
- 参考（v1.0/v1.1 ガイド）: https://www.seaart.ai/articleDetail/cvcdnn5e878c73fqe0s0

## v2.0 の仕様

- SDXL 1.0 ベースのアニメ系ベースモデル。データセットは Danbooru（2024 年 6 月まで）。
- ベース解像度は **1536x1536**。512px〜2048px の広い解像度域で安定して生成できる。
- **Danbooru タグ + 自然言語プロンプト（NLP）の両対応**。タグのみ・自然言語のみ・混在のいずれも可。
- robust fine-tuning を意図して学習されており、LoRA 学習のベースにも最適。

## 推奨設定

| 項目 | 推奨値 | 備考 |
|---|---|---|
| Steps | 20〜40 | 通常は 20〜28 で十分。ディテール不足なら 40 まで上げる |
| CFG Scale | 3〜7.5 | **4.5〜5 がスイートスポット**。7.5 超は過飽和、3 未満は色褪せて霧がかかったようになる |
| Sampler | Euler a | 他のサンプラーでも動作するが Euler a が最良 |
| Clip Skip | **2（必須）** | |

## 推奨解像度

1536px ベースの解像度を推奨（それ以外も以前より安定）。

| 向き | 推奨範囲 |
|---|---|
| 正方形 | 1024x1024 〜 1536x1536 |
| 縦長 | 1024x1536 〜 1248x1824 |
| 横長 | 1536x1024 〜 1824x1248 |

## プロンプトの書き方

基本は **Danbooru タグ** でのプロンプトが最も精度が高い。v2.0 では自然言語文でタグを補助したり、完全な自然言語プロンプトを使うこともできる。

### 推奨タグ順（タグベース）

1. `masterpiece, best quality, amazing quality`
2. `very aesthetic, newest`（任意）
3. レーティングタグ（`safe, sensitive` など）
4. 絵師タグ（Danbooru のもののみ）
5. 対象と人数（`1girl` / `1boy` / `1other`）
6. 対象の詳細（髪・目・衣装など）
7. ポーズ・動作タグ
8. 構図タグ（背景・環境・オブジェクト）
9. 追加タグ（スタイル・テーマ・表情）
10. 強化タグ（フォーカス・ライティング・影）
11. `absurdres, highres`（任意）

### 推奨順（自然言語併用）

1. `masterpiece, best quality, amazing quality`
2. `very aesthetic, newest`（任意）
3. レーティングタグ
4. 絵師タグ（Danbooru のみ）
5. **構図を説明する自然言語文**
6. 精度を上げる補助タグ
7. `absurdres, highres`（任意）

## プロンプト例（記事より）

### Girl（オリジナルキャラ）

**Positive:**

```
masterpiece, best quality, amazing quality, newest, very aesthetic, 1girl, upper body, smirk, grey hair, blunt bangs, long hair, round eyewear, rabbit ears, fake animal ears, blue eyes, long eyelashes, killer sweater, black sweater, fishnet sleeves, finger to mouth, dynamic pose, lineart, sharp lines, diffused light, absurdres, highres
```

**Negative:**

```
lowres, bad quality, worst quality, bad, sketch, jpeg artifacts, ugly, poorly drawn, censor, blurry, watermark, artistic failure, artistic error, bad proportions, bad perspective, displeasing, very displeasing, oldest, child, childish, traditional media
```

### Kafka（崩壊：スターレイル・版権キャラ）

**Positive:**

```
masterpiece, best quality, amazing quality, newest, very aesthetic, 1girl, kafka \(honkai: star rail\), cowboy shot, purple hair, butterfly ornament, purple eyes, round eyewear, black choker, black jacket, jacket on shoulders, high waist shorts, black shorts, collared shirt, white shirt, pantyhose under shorts, purple pantyhose, purple gloves, purple spider web print, glowing web, glowing purple string, hand up, standing, dynamic pose, darkness, dim lighting, bokeh, art, absurdres, highres
```

**Negative:** 上の Girl の例と同一。

## この拡張機能での活用ポイント

- クオリティタグ（`01_クオリティ.yml`）は推奨順（先頭にクオリティタグ、末尾に `absurdres, highres`）と整合させると効果的。
- ネガティブ（`99_ネガティブ.yml`）には上記推奨ネガティブプロンプトの要素が流用できる。
- 自然言語文の混在が可能なため、テンプレート内にタグと短文を併記する構成も有効。
