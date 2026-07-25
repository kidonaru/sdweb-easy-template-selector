from pathlib import Path
import random
import re
import gradio as gr

import modules.infotext_utils as parameters_copypaste
import modules.scripts as scripts
from modules.scripts import AlwaysVisible
from modules import shared
from scripts.setup import load_tags, get_tags

FILE_DIR = Path().absolute()

def find_tag(tags, location):
    if type(location) == str:
        return tags[location]

    value = ''
    if len(location) > 0:
        value = tags
        for tag in location:
            value = value[tag]

    if type(value) == dict:
        key = random.choice(list(value.keys()))
        tag = value[key]
        if type(tag) == dict:
            value = find_tag(tag, [random.choice(list(tag.keys()))])
        else:
            value = find_tag(value, key)

    if (type(value) == list):
        value = random.choice(value)

    return value

def replace_template(prompt, seed = None):
    random.seed(seed)

    tags = get_tags()
    count = 0
    while count < 100:
        if not '@' in prompt:
            break

        for match in re.finditer(r'(@((?P<num>\d+(-\d+)?)\$\$)?(?P<ref>[^>]+?)@)', prompt):
            template = match.group()
            if shared.opts.easy_template_use_consistent_seed:
                random.seed(seed)
            try:
                try:
                    result = list(map(lambda x: int(x), match.group('num').split('-')))
                    min_count = min(result)
                    max_count = max(result)
                except Exception as e:
                    min_count, max_count = 1, 1
                count = random.randint(min_count, max_count)

                values = list(map(lambda x: find_tag(tags, match.group('ref').split(':')), list(range(count))))
                prompt = prompt.replace(template, ', '.join(values), 1)
            except Exception as e:
                prompt = prompt.replace(template, '', 1)
        count += 1

    random.seed()
    return prompt

# 本体 modules/processing_scripts/comments.py と同じコメント構文を対象にする。
# 本体はコメント本文だけを消して改行を残すため、空行削除より前に自前で除去する必要がある
COMMENT_BLOCK_PATTERN = re.compile(r'/\*.*?\*/', re.DOTALL)
COMMENT_LINE_PATTERN = re.compile(r'[^\S\n]*(#|//).*')

def strip_comment_lines(text):
    """プロンプトからコメント（/* */, #, //）を除去する。

    コメントだけの行は中身が空になるだけで改行は残るため、後段の空行削除で行ごと消える。
    """
    text = COMMENT_BLOCK_PATTERN.sub('', text)
    return COMMENT_LINE_PATTERN.sub('', text)

def format_prompt(text, strip_comments, remove_blank_line, remove_new_line):
    """プロンプトを出力用に整形する。

    コメント除去 → 空行削除 → 改行削除の順に適用する。
    コメント除去を先に行うのは、本体側のコメント除去（本文のみ削除・改行は残す）が
    本拡張より後に走るため、順序を逆にすると消したはずの空行が復活するから。
    """
    if strip_comments:
        text = strip_comment_lines(text)

    if remove_blank_line or remove_new_line:
        lines = [line for line in text.split('\n') if len(line.strip()) > 0]
        # 改行削除が有効なら 1 行に連結する
        text = (' ' if remove_new_line else '\n').join(lines)

    return text

class Script(scripts.Script):
    def __init__(self):
        super().__init__()
        load_tags()

    def title(self):
        return "EasyTemplateSelector"

    def show(self, is_img2img):
        return AlwaysVisible

    def ui(self, is_img2img):
        if (is_img2img):
            return None

        image_info = gr.Textbox("", elem_id='easy_template_selector_image_info', interactive=True, visible=False)
        apply_button = gr.Button("", elem_id='easy_template_selector_apply_button', visible=False)

        binding = parameters_copypaste.ParamBinding(
            paste_button=apply_button,
            tabname="txt2img",
            source_text_component=image_info,
            source_tabname="txt2img")
        parameters_copypaste.register_paste_params_button(binding)

        return [image_info, apply_button]

    def replace_template_tags(self, p):
        prompts = [
            [p.prompt, p.all_prompts, 'Input Prompt'],
            [p.negative_prompt, p.all_negative_prompts, 'Input NegativePrompt'],
        ]
        # Hires.fix が無効なとき本体は all_hr_prompts を None のままにするため、リスト側の有無で判定する
        # (hr_prompt だけを見ると None を添字アクセスして TypeError になり、process 全体が無言で止まる)
        if getattr(p, 'all_hr_prompts', None): prompts.append([p.hr_prompt, p.all_hr_prompts, 'Input Prompt(Hires)'])
        if getattr(p, 'all_hr_negative_prompts', None): prompts.append([p.hr_negative_prompt, p.all_hr_negative_prompts, 'Input NegativePrompt(Hires)'])

        for i in range(len(p.all_prompts)):
            seed = random.random()
            for [prompt, all_prompts, raw_prompt_param_name] in prompts:
                if '@' not in prompt: continue

                self.save_prompt_to_pnginfo(p, prompt, raw_prompt_param_name)

                replaced = "".join(replace_template(all_prompts[i], seed))
                all_prompts[i] = replaced

        # 本体のコメント除去（本文のみ削除・改行は残す）が本拡張より後に走るため、
        # ここでコメント行を落としておかないと空行削除をすり抜けて空行が復活する。
        # save_prompt_comments が ON のときは本体が infotext 用の生コピーを本拡張の後に取るので手を出さない
        strip_comments = (
            getattr(shared.opts, 'enable_prompt_comments', False)
            and not getattr(shared.opts, 'save_prompt_comments', False)
        )
        remove_blank_line = shared.opts.easy_template_remove_blank_line
        remove_new_line = shared.opts.easy_template_remove_new_line

        if not (strip_comments or remove_blank_line or remove_new_line):
            return

        for i in range(len(p.all_prompts)):
            for [prompt, all_prompts, raw_prompt_param_name] in prompts:
                all_prompts[i] = format_prompt(all_prompts[i], strip_comments, remove_blank_line, remove_new_line)

    def save_prompt_to_pnginfo(self, p, prompt, name):
        if shared.opts.easy_template_enable_save_raw_prompt_to_pnginfo == False:
            return

        p.extra_generation_params.update({name: prompt.replace('\n', ' ')})

    def process(self, p, *args):
        self.replace_template_tags(p)
