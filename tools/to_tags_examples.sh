#!/bin/bash

# スクリプトのディレクトリの一つ上に移動
cd "$(dirname "$0")/.."

# tagsディレクトリ内のファイルをループ
for file in tags/*; do
    # 拡張子を除いたファイル名を取得
    filename=$(basename "$file")
    filename_without_ext="${filename%.*}"
    
    # ファイル名の最後が_で終わっていない場合のみコピー
    if [[ ! "$filename_without_ext" =~ _$ ]]; then
        cp "$file" tags_examples/
    fi
done