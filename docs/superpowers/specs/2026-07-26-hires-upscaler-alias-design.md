# Hires upscaler 名の reForge / Forge Neo 両対応

作成日: 2026-07-26

## 背景

同一の Hires upscaler モデルが reForge と Forge Neo で異なる名前で表示される。

| 実体ファイル | reForge の表示名 | Forge Neo の表示名 |
|---|---|---|
| `RealESRGAN_x4plus_anime_6B.pth` | `R-ESRGAN 4x+ Anime6B` | `RealESRGAN_x4plus_anime_6B` |

Neo の `modules/esrgan_model.py` は `modelloader.friendly_name(file)`（= 拡張子を除いたファイル名）をそのまま表示名にしており、reForge / A1111 が持つ組み込みの pretty name を一切持たない。一方 reForge は RealESRGAN 系に固有の表示名を割り当てている。

このため片方の環境で保存したテンプレートをもう片方で読み込むと、`Hires upscaler` の値が現在の環境のドロップダウンに存在せず、Hires 設定が意図どおり復元されない。

ユーザー導入モデル（`4x_foolhardy_Remacri` など）と Latent 系（`Latent`, `Latent (nearest)` 等）は両環境で名前が一致するため影響を受けない。実際にリポジトリのテンプレートで差異が出るのは `R-ESRGAN 4x+ Anime6B` を含む 4 ファイルのみ。

## ゴール

reForge と Forge Neo の双方で、同じテンプレートファイルから Hires upscaler が正しく復元される。テンプレートは環境を跨いでも git diff が出ない安定した表現でディスク上に保持される。

## 非ゴール

- `Hires upscaler` 以外の infotext キー（Sampler、Schedule type 等）の環境差の吸収
- 画像の pnginfo を直接 PNG Info タブへ貼る経路の変換。本拡張のテンプレート配信・保存経路のみを対象とする
- reForge 上での実機動作確認（実施環境が Forge Neo のため、確認はユーザーが手元で行う）

## 設計

### 正規形

テンプレート `.txt` 上の `Hires upscaler` の値は、**モデルファイルの stem（拡張子を除いたファイル名）を正規形**とする。例: `RealESRGAN_x4plus_anime_6B`。

Latent 系のように実体ファイルを持たないものは、表示名がそのまま正規形。

reForge の表示名ではなく stem を正規形に選ぶ理由:

- stem は実体ファイルとの対応が一意で、ユーザー導入モデルの命名規則とも一致する
- reForge の表示名は reForge にしか存在しない別名であり、それを正とすると「別名を正規形にする」ことになる

この選択には前提が 2 つある。いずれも本リポジトリの用途では成立するが、明記しておく。

- **stem が環境間で一致すること。** 同じモデルでもインストール時にファイル名を変えていれば stem は一致しない。本リポジトリのテンプレートは同一ユーザーの reForge / Neo 環境で共用する前提なので問題にならない
- **Neo の表示名が常に stem であること。** 例外が 1 つあり、`models/ESRGAN/` が空のとき Neo は `UpscalerData("ESRGAN", model_url, ...)` を積むため表示名が `ESRGAN` になる（A1111 系は `ESRGAN_4x`）。テンプレートがこの値を持つことは実質無いため、変換テーブルには載せない

### 変換テーブル

`scripts/upscaler_aliases.py` を新設し、正規形（stem）→ reForge / A1111 での表示名の辞書を拡張側で保持する。

```python
UPSCALER_ALIASES = {
    'RealESRGAN_x4plus':          'R-ESRGAN 4x+',
    'RealESRGAN_x4plus_anime_6B': 'R-ESRGAN 4x+ Anime6B',
    'RealESRGAN_x2plus':          'R-ESRGAN 2x+',
    'realesr-general-x4v3':       'R-ESRGAN General 4xV3',
    'realesr-general-wdn-x4v3':   'R-ESRGAN General WDN 4xV3',
    'realesr-animevideov3':       'R-ESRGAN AnimeVideo',
}
```

出典は A1111 の `modules/realesrgan_model.py` の `get_realesrgan_models()`。同関数が RealESRGAN 系の各モデルに固有の表示名を割り当てており、reForge もこれを引き継いでいる。1 モデルにつき別名は 1 つなので値は文字列で足りる。

`shared.sd_upscalers` からの自動導出ではなく明示的な表にする理由は、導出できるのは「実行中の環境が持つ別名」だけであり、別環境の別名は原理的に取得できないため。表は reForge / A1111 の組み込み名の一覧として拡張側が責任を持つ。

**表に載せる範囲**は「reForge / A1111 側にだけ存在する別名」に限り、実機で確認していない別名は載せない。誤った別名を載せると誤変換を招き、素通し（変換なし）より状況が悪くなるため。SwinIR / ScuNET / DAT 系は A1111 側の表示名が確定していないので今回は対象外とし、reForge 実機で確認できた時点で追記する。表に無い値は素通しされ、解決できなければ警告が出るので気付ける。

同モジュールに以下を公開する。

- `to_canonical(value) -> str`: 別名に一致すれば対応する stem を返す。一致しなければ `value` をそのまま返す
- `candidates_for(value) -> list[str]`: `value` が属するグループ（stem + 別名）を返す。表に無ければ `[value]`
- `to_storage(text) -> str`: 保存用の変換
- `to_display(text, available_names) -> tuple[str, list[str]]`: 読み込み用の変換と、解決できなかった値のリスト

### ロード時の変換（`GET /easy-template/templates`）

テンプレートファイルを読んだ直後、`Hires upscaler` の値を**現在の環境で有効な名前**へ差し替える。stem で書かれていても reForge の別名で書かれていても受け付ける。

1. 現在有効な upscaler 名の集合を作る: `shared.latent_upscale_modes` + `[x.name for x in shared.sd_upscalers]`
2. テンプレートの値がその集合に含まれるならそのまま返す
3. 含まれないなら `candidates_for(値)` を引き、集合に含まれる最初の候補へ差し替える
4. どの候補も含まれないなら値を素通しし、解決できなかった値として呼び出し側へ返す

集合が空、または取得時に例外が出た場合はロード時の変換をスキップして素通しする。`shared.latent_upscale_modes` と `shared.sd_upscalers` は個別に例外を握り、片方の取得失敗でもう片方を巻き添えにしない。

解決できなかった値の警告出力は `to_display()` 内では行わず、呼び出し側が 1 リクエストあたり 1 行にまとめて `[easy-template]` プレフィックス付きで print する。`GET /easy-template/templates` は UI 初期化時とテンプレート保存後の `reinit()` の両方で呼ばれ、テンプレート数だけ print するとコンソールが流れるため。

### 保存時の変換（`POST /easy-template/save-template`）

書き込み直前に `to_canonical()` を適用し、常に stem を書き込む。表に無い値（ユーザー導入モデル）はそのまま書き込まれる。この方向は環境に依存しないため `shared` を参照しない。

### 置換の実装

対象は `Hires upscaler:` に続く値のみ。正規表現 `(Hires upscaler:[ \t]*)([^,\r\n]+)` で捕捉し、第 2 グループを置換する。upscaler 名にカンマは含まれないため、カンマ区切りのパラメータ行から安全に切り出せる。

- 値のパターンから `\r` を除外するのは、CRLF 改行のテンプレートで値が行末（末尾カンマ無し）に来たときに CRLF を LF へ壊さないため
- キーと値の間の空白を `[ \t]*` に限定するのは、`\s*` だと改行を跨いで次の行を値として拾いうるため
- 1 ファイル内に `Hires upscaler:` が複数回現れた場合はすべて置換する
- 置換はパラメータ行に限定せずファイル全文に対して行う。プロンプト本文に `Hires upscaler:` という文字列が現れることは実質無いため、行の判別ロジックを増やすより単純さを優先する

置換処理中に例外が出た場合は警告を print して元の内容をそのまま扱う。テンプレートが読めなくなるより無変換のほうが被害が小さいため。

JavaScript 側は無改修。テンプレートの読み書きは既に Python 側の 2 エンドポイントに一本化されており、`shared.sd_upscalers` も Python からしか参照できない。

## 変更対象ファイル

| ファイル | 変更内容 |
|---|---|
| `scripts/upscaler_aliases.py` | 新規。変換テーブルと変換関数 |
| `scripts/setup.py` | `get_templates()` にロード時変換、`save_template()` に保存時変換を追加 |
| `tests/test_upscaler_aliases.py` | 新規。WebUI 非依存モジュールの単体テスト |
| `templates/01_SFW/アニメのポートレート.txt` | 37 行目を stem へ |
| `templates/02_NSFW/スライム姦.txt` | 52 行目を stem へ |
| `templates/02_NSFW/機雷の拘束.txt` | 53 行目を stem へ |
| `templates/02_NSFW/正常位脚上げ.txt` | 49 行目を stem へ |
| `CLAUDE.md` | 構成・テスト実行方法・保存フォーマットの規約を反映 |

テンプレートの書き換えは `R-ESRGAN 4x+ Anime6B` → `RealESRGAN_x4plus_anime_6B` の 1 行置換。`templates/*.txt` は全ファイル CRLF 管理のため、改行コードを保持すること（`core.autocrlf=true` により改行だけの変化は `git diff` に現れず検証をすり抜けるので、検証も `git diff` に頼らない）。

## 影響範囲

- `tools/` 配下のスクリプトはディスク上のファイルを直接読むため、ロード時変換の影響を受けない
- `tools/audit_templates.py` はカテゴリコメント行のみを検査するため、パラメータ行の変更は結果に影響しない
- テンプレート適用時の Override Settings の挙動は、値が現在の環境のドロップダウンに存在するようになることで改善される
- `tests/` の新設はこれまで「テスト基盤なし」だったリポジトリ方針の変更にあたる。対象は WebUI 非依存の純粋モジュールに限定し、フレームワーク（pytest 等）は導入せず素の Python で実行できる形にとどめる

## 検証

1. `python tests/test_upscaler_aliases.py` で変換ロジックの単体テストが通ること
2. `scripts/setup.py` / `scripts/upscaler_aliases.py` の構文確認
3. Forge Neo で WebUI を再起動し、書き換えた 4 テンプレートを適用する。Hires upscaler ドロップダウンが `RealESRGAN_x4plus_anime_6B` になり、Override Settings に upscaler が積まれないこと
4. 同テンプレートを UI から再保存し、ファイルに diff が出ないこと（保存時変換が恒等であることの確認）
5. 全テンプレートの改行が CRLF のみであることをバイト単位で確認すること（`git diff` では検出できないため）
6. `PYTHONIOENCODING=utf-8 python tools/audit_templates.py` を実行し、ベースラインの `合計: 1 件` から増えていないこと
7. reForge 側での動作確認はユーザーが手元で実施する
