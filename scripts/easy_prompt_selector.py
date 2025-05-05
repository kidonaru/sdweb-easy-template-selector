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
        if getattr(p, 'hr_prompt', None): prompts.append([p.hr_prompt, p.all_hr_prompts, 'Input Prompt(Hires)'])
        if getattr(p, 'hr_negative_prompt', None): prompts.append([p.hr_negative_prompt, p.all_hr_negative_prompts, 'Input NegativePrompt(Hires)'])

        for i in range(len(p.all_prompts)):
            seed = random.random()
            for [prompt, all_prompts, raw_prompt_param_name] in prompts:
                if '@' not in prompt: continue

                self.save_prompt_to_pnginfo(p, prompt, raw_prompt_param_name)

                replaced = "".join(replace_template(all_prompts[i], seed))
                all_prompts[i] = replaced

        # Remove blank line
        if shared.opts.easy_template_remove_blank_line:
            for i in range(len(p.all_prompts)):
                for [prompt, all_prompts, raw_prompt_param_name] in prompts:
                    lines = all_prompts[i].split('\n')
                    lines = list(filter(lambda x: len(x.strip()) > 0, lines))
                    all_prompts[i] = '\n'.join(lines)

        # Remove new line
        if shared.opts.easy_template_remove_new_line:
            for i in range(len(p.all_prompts)):
                for [prompt, all_prompts, raw_prompt_param_name] in prompts:
                    lines = all_prompts[i].split('\n')
                    lines = list(filter(lambda x: len(x.strip()) > 0, lines))
                    all_prompts[i] = ' '.join(lines)

    def save_prompt_to_pnginfo(self, p, prompt, name):
        if shared.opts.easy_template_enable_save_raw_prompt_to_pnginfo == False:
            return

        p.extra_generation_params.update({name: prompt.replace('\n', ' ')})

    def process(self, p, *args):
        self.replace_template_tags(p)
