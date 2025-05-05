# Easy Template Selector

[Easy Prompt Selector](https://github.com/blue-pen5805/sdweb-easy-prompt-selector)
の改造版です。

独特なプロンプトの書き方をすることで、キャラの変更などを容易にできるようにしています。

https://github.com/user-attachments/assets/19525017-b418-4557-a94d-87330f9981e4

# インストール方法

WebUIとreForgeで動作確認しています

WebUIの`Extensions` - `Install from URL`に以下のURLを入力してインストールしてください。

```
https://github.com/kidonaru/sdweb-easy-template-selector
```

既存のテンプレートの読み込みには下記モデルが必要です

- Nova Anime XL v6.0
- WAI-NSFW-illustrious-SDXL v13.0

別途LoRAなどを参照している場合もあるので、適宜インストールしてください

また、`Settings` - `User Interface` - `Quicksettings list` の項目に`CLIP_stop_at_last_layers` を追加してください

# 機能

## テンプレートの読み込み/保存
- `templates`ディレクトリ以下にpnginfoを`.txt`で保存しておくと、`00_テンプレート`に表示され、読み込むことができます
  - プロンプトとメタ情報を読み込んで反映します
- `💾`ボタンを押すと現在のプロンプトとメタ情報を`templates`ディレクトリ以下に保存することができます
- テンプレートは階層構造で管理可能（例：`templates/03_Test/てすと.txt`）

## プロンプトの構造化
- プロンプトをカテゴリごとに分類して管理しています
- *タグを追加すると、既存のカテゴリを自動で上書きします*
  - 単純な追加は`Ctrl`キーを押しながら行うと、既存のカテゴリを上書きせずに追加できます
- ネガティブプロンプトも同様に管理可能 (`99_ネガティブ`カテゴリは自動的にネガティブプロンプトに反映)

### プロンプトサンプル

```
# URL: {{プロンプトの参考URL}},

# 01_クオリティ:Model (Nova Anime XL),
masterpiece, best quality, amazing quality, very aesthetic, high resolution, ultra-detailed, absurdres, newest, scenery,
# 02_対象 (一人の女の子(強調)),
1girl,solo,
# 10_キャラ_ブルアカ:トリニティ (カズサ),
kazusa \(blue archive\),red eyes,black hair, animal ears,halo,choker,(hooded jacket:1.1),
# 50_背景_基本:基本 (屋外),
outdoors,
```

タグボタンを押すと
```
# {{カテゴリ}} ({{タグ名}}),
{{プロンプト}},
```
というフォーマットでプロンプトに反映されます

## アンドゥ/リドゥ機能
- プロンプトの変更履歴を保持
- 最大20件の履歴を保存

## マウスオーバーでタグの中身を表示
- タグ名にカーソルを乗せると、そのタグの内容をツールチップで表示

## タグカラーのサポート
- タグ名に`[#RRGGBB]`形式で色指定するとボタンの色に反映されます (例: `赤いタグ[#FF0000]`)
