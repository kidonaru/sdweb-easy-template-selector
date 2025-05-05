#!/bin/bash

# 引数チェック
if [ $# -ne 1 ]; then
    echo "使用方法: $0 <ファイル名>"
    exit 1
fi

# ファイルの存在チェック
if [ ! -f "$1" ]; then
    echo "エラー: ファイル '$1' が見つかりません"
    exit 1
fi

# 行番号の初期化
line_number=0

# ファイルを1行ずつ読み込んで処理
while IFS= read -r line; do
    # 行番号を3桁に整形
    padded_number=$(printf "%03d" $line_number)
    # 出力
    echo "No.${padded_number}: $line"
    # 行番号をインクリメント
    ((line_number++))
done < "$1"
