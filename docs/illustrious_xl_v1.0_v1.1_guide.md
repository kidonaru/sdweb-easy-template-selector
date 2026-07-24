# Illustrious XL v1.0 / v1.1 プロンプトガイド

SeaArt AI の解説記事（GrayMan 著、2025-03-18 更新）を元にした、Illustrious XL v1.0 / v1.1 でのプロンプトの書き方まとめ。

- 出典: https://www.seaart.ai/articleDetail/cvcdnn5e878c73fqe0s0
- v2.0 版のまとめ: [illustrious_xl_v2.0_guide.md](illustrious_xl_v2.0_guide.md)

## v1.0 / v1.1 の仕様

- SDXL 1.0 ベースのアニメ系ベースモデル。Kohaku XL-Beta Revision 5 の上に学習されている。
- データセットは Danbooru（2024 年 6 月まで）。新しいタグ・キャラクター・作品・絵師タグを認識する。
- ベース解像度は **1536x1536**（従来 SDXL の 1024x1024 から引き上げ）。512x512〜1536x1536 に対応するが、**512px 未満は生成エラーの原因になるため非推奨**。
- v0.1 と比べて素の生成品質が大幅に向上。LoRA 学習・ファインチューニングのベースとしても柔軟で強力。

### v1.0 と v1.1 の違い

- **v1.0**: v0.1 と同じ Danbooru タグベースの構文。v0.1 のプロンプトをそのまま使える。
- **v1.1**: **50% の自然言語プロンプト（NLP）対応**。Danbooru タグに加えて簡単な文章を併用できる。タグのみの利用も引き続き可能。
  - ただし **100% 自然言語のみのプロンプトは非推奨**（品質・精度が低下する）。
  - タグに小さな修飾語を足す使い方が有効。例: `leaning back, against wall` の代わりに `leaning against wall`、`glowing eyes, eyes visible through hair` の代わりに `glowing eyes under hair`。
  - 完全なタグ表記の方が安定・正確だが、表現の選択肢が増えた。

## 推奨設定

| 項目 | 推奨値 | 備考 |
|---|---|---|
| Steps | 20〜40 | 通常は 20〜28 で十分。ディテール不足なら 40 まで上げる |
| CFG Scale | 3〜7 | **4.5〜5 がスイートスポット**。7 超は過飽和、3 未満は色褪せて霧がかかったようになる |
| Sampler | Euler a | 他のサンプラーでも動作するが Euler a が最良 |
| Clip Skip | **2（必須）** | |

## 推奨解像度

| 向き | 推奨範囲 |
|---|---|
| 正方形 | 1024x1024 〜 1536x1536 |
| 縦長 | 1024x1536 〜 1248x1824 |
| 横長 | 1536x1024 〜 1824x1248 |

高解像度でも Hires エラーが少なく安定して生成できる。

## プロンプトスタイルのポイント

- **Danbooru タグ** でのプロンプトが最良の結果を出す。
- `masterpiece, best quality, amazing quality` は品質維持に非常に重要。プロンプトの先頭に置く。続けて `very aesthetic, newest` を足すとさらに良い。
- `absurdres, highres` はプロンプト末尾に置ける。
- レーティングタグ（`safe, sensitive` など）を対象タグの前に置くと、意図しない結果を避けられる。
- 絵師タグはクオリティタグの直後か、プロンプト末尾に置く。
- 被写体の種類に応じて `focus` 系タグを使う（動物なら `animal focus`、車両なら `vehicle focus` など）。

### 推奨タグ順

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

## ネガティブプロンプトの重要性

Illustrious XL は Pony v6 系と異なり、**ネガティブプロンプトへの追従性が非常に高い**。ポジティブと同じくらい積極的に使うことで結果が大きく改善する。

- `worst quality, bad quality, very displeasing, displeasing, oldest` で品質向上。
- `artistic error, artistic failure` で生成エラーを最小化。
- `lowres, jpeg artifacts, censor, watermark, bad hands, traditional media` などの Danbooru 標準タグも有効。
- `bad angle, bad perspective, bad proportions` など `bad` 系タグは特に高解像度で効果が顕著。
- 構図から何かを除外したいときはネガティブが最も効果的。

## プロンプト例（記事より）

### 藤原妹紅（東方・版権キャラ）

**Positive:**

```
masterpiece, best quality, amazing quality, newest, very aesthetic, upper body, 1girl, fujiwara no mokou, smile, floating hair, cherry blossoms, nature, wind, falling petals, outdoors, amazing background, highres, absurdres
```

**Negative:**

```
lowres, bad quality, worst quality, bad, sketch, jpeg artifacts, ugly, poorly drawn, censor, blurry, watermark, simple background, artistic failure, artistic error, bad angle, bad composition, displeasing, very displeasing, oldest, bad hands, anatomical nonsense, deformed, by bad artist
```

### 堕天使（オリジナル・強調構文と BREAK の使用例）

**Positive:**

```
masterpiece, best quality, amazing quality, newest, very aesthetic, upper body, 1girl, (pyrokinesis), white hair, very long hair, yellow eye, red eye, heterochromia, glowing eye, hooded cloak, magic, embers, chained, covered by chains, single wing, feathered wing, BREAK, (surreal:1.2), abstract, abstract background, colorful, forest, dark background, fiery background, night, night sky, fog, cloudly sky, BREAK, depth of field, advanced focus, bokeh, (dim lighting, chiaroscuro:1.2), soft shadows, extremely detailed background, amazing art, highres, absurdres
```

**Negative:** 上の藤原妹紅の例と同一。
