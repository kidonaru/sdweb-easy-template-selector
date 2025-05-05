import re
import sys
import os

def split_lora_and_tags(input_file, split_by_comma=True):
    # 出力ファイル名を生成
    base_name = os.path.splitext(input_file)[0]
    lora_output_file = f"{base_name}_lora.yml"
    tags_output_file = f"{base_name}_tags.yml"

    with open(input_file, 'r', encoding='utf-8') as f:
        content = f.read()

    # 正規表現パターンを分岐
    if split_by_comma:
        pattern = r'(<lora:[^>]+>[^,]*,)(.*)'
    else:
        pattern = r'(<lora:[^>]+>)(.*)'
    
    # 各行を処理
    lines = content.split('\n')
    lora_lines = []
    tags_lines = []
    
    for line in lines:
        if ':' in line and '<lora:' in line:
            # インデントを保持
            indent = len(line) - len(line.lstrip())
            indent_str = ' ' * indent
            
            # キャラクター名と設定を分離
            char_name, settings = line.split(':', 1)
            char_name = char_name.strip()
            
            # loraとタグを分離
            match = re.search(pattern, settings.strip())
            if match:
                lora_part = match.group(1)
                tags_part = match.group(2).strip()
                
                lora_lines.append(f"{indent_str}{char_name}: {lora_part}")
                tags_lines.append(f"{indent_str}{char_name}: {tags_part}")
            else:
                # loraがない場合はそのままコピー
                lora_lines.append(line)
                tags_lines.append(line)
        else:
            # loraがない行はそのままコピー
            lora_lines.append(line)
            tags_lines.append(line)
    
    # 結果をファイルに書き込み
    with open(lora_output_file, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lora_lines))
    
    with open(tags_output_file, 'w', encoding='utf-8') as f:
        f.write('\n'.join(tags_lines))

if __name__ == "__main__":
    if len(sys.argv) < 2 or len(sys.argv) > 3:
        print("loraとタグを分離するスクリプト")
        print("使用方法: python split_lora.py <入力ファイルパス> [--split-comma]")
        print("--split-comma: lora部分をカンマで区切る（デフォルトは>で区切る）")
        sys.exit(1)
    
    input_file = sys.argv[1]
    split_by_comma = False
    if len(sys.argv) == 3 and sys.argv[2] == "--split-comma":
        split_by_comma = True
    
    split_lora_and_tags(input_file, split_by_comma)
