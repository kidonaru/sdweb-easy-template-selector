from pathlib import Path
import random
import re
import gradio as gr

import modules.infotext_utils as parameters_copypaste
import modules.scripts as scripts
from modules.scripts import AlwaysVisible
from modules import shared
from scripts.setup import load_tags, get_tags
from scripts.hr_cfg_inherit import resolve_hr_cfg
from scripts.exclude_tags import apply_excludes_to_prompt_lists, parse_exclude_tags
from scripts.tag_profiles import DEFAULT_PROFILE
from scripts.prompt_format import ANIMA_PROFILE, insert_space_after_comma, remove_break

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

def replace_template(prompt, seed = None, profile = DEFAULT_PROFILE):
    random.seed(seed)

    tags = get_tags(profile)
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
        # 除外タグ。JS 側の 99_設定 テキストエリアが値を書き込む。
        # 生成リクエストに同梱されて process() へ届くため、別経路で送る場合のような競合が起きない
        exclude_tags = gr.Textbox("", elem_id='easy_template_selector_exclude_tags', interactive=True, visible=False)
        # プロファイル。JS 側のドロップダウンが値を書き込む。
        # サーバー側の @...@ ランダム展開が profile のタグセットを引くために生成リクエストに同梱する
        profile = gr.Textbox("", elem_id='easy_template_selector_profile', interactive=True, visible=False)

        binding = parameters_copypaste.ParamBinding(
            paste_button=apply_button,
            tabname="txt2img",
            source_text_component=image_info,
            source_tabname="txt2img")
        parameters_copypaste.register_paste_params_button(binding)

        return [image_info, apply_button, exclude_tags, profile]

    def apply_exclude_tags(self, p, exclude_text):
        """除外タグをポジティブ系プロンプトから取り除く。

        ネガティブ側は対象外。消すと望まない要素が出るようになり、事故が分かりにくいため。
        """
        # Hires.fix が無効なとき本体は all_hr_prompts を None のままにするため、リスト側の有無で判定する
        targets = [p.all_prompts]
        if getattr(p, 'all_hr_prompts', None):
            targets.append(p.all_hr_prompts)

        apply_excludes_to_prompt_lists(targets, parse_exclude_tags(exclude_text))

    def apply_anima_format(self, p, profile):
        """anima プロファイルのとき、プロンプトを Anima の規約に合わせて整形する。

        ネガティブも含む全リストが対象（カンマ詰め・BREAK はどこにでも現れうるため）。
        """
        if profile != ANIMA_PROFILE:
            return

        add_space_after_comma = shared.opts.easy_template_anima_space_after_comma
        strip_break = shared.opts.easy_template_anima_remove_break
        if not (add_space_after_comma or strip_break):
            return

        targets = [p.all_prompts, p.all_negative_prompts]
        # Hires.fix が無効なとき本体は all_hr_prompts を None のままにするため、リスト側の有無で判定する
        if getattr(p, 'all_hr_prompts', None):
            targets.append(p.all_hr_prompts)
        if getattr(p, 'all_hr_negative_prompts', None):
            targets.append(p.all_hr_negative_prompts)

        for prompts in targets:
            for i in range(len(prompts)):
                if strip_break:
                    prompts[i] = remove_break(prompts[i])
                if add_space_after_comma:
                    prompts[i] = insert_space_after_comma(prompts[i])

    def replace_template_tags(self, p, exclude_text='', profile=DEFAULT_PROFILE):
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

                replaced = "".join(replace_template(all_prompts[i], seed, profile))
                all_prompts[i] = replaced

        # @...@ の展開後に消すのは、ランダム抽選で出たタグも除外対象にするため。
        # format_prompt() より前に置くのは、空になった行を既存の空行削除に拾わせるため
        self.apply_exclude_tags(p, exclude_text)

        # @...@ 展開・除外タグ除去の後、format_prompt() の前に整形する。
        # 抽選で出たタグも対象にし、BREAK 単独行が空行になった分を既存の空行削除に拾わせるため
        self.apply_anima_format(p, profile)

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

    def inherit_hr_cfg(self, p):
        if not shared.opts.easy_template_inherit_hr_cfg:
            return

        # img2img には hr_cfg / enable_hr が無いため getattr で防御する
        # (本 Script は AlwaysVisible で img2img でも process が走る)
        hr_cfg = getattr(p, 'hr_cfg', None)
        if hr_cfg is None:
            return

        resolved = resolve_hr_cfg(getattr(p, 'enable_hr', False), hr_cfg, p.cfg_scale)
        if resolved is None:
            return

        p.hr_cfg = resolved
        print(f'[easy-template] Hires CFG Scale が 0 のため CFG Scale ({resolved}) を継承しました')

    def process(self, p, *args):
        # args は ui() の戻り値がそのまま位置で届く。args[2] = exclude_tags, args[3] = profile。
        # ui() の戻り値の並びを変えたらここも直す。
        # img2img では ui() が None を返して args が空になるため長さで防御する
        exclude_text = args[2] if len(args) > 2 else ''
        profile = args[3] if len(args) > 3 else ''
        self.replace_template_tags(p, exclude_text, profile or DEFAULT_PROFILE)
        self.inherit_hr_cfg(p)
