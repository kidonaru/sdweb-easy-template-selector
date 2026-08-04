# 出力ファイル名パターンのキーワード [template_name] を提供する
#
# ヘッダの「テンプレート名」欄の値（例: 02_NSFW/おしがま）から末尾要素だけを取り出し、
# 本体の FilenameGenerator に差し込む。
#
# leaf_template_name() は WebUI に依存しない純粋関数に保つこと（単体で import して検証するため）。
import re

# テンプレート名のパス区切り。サーバー側は / を使うが、手入力で \ が混ざる場合も拾う
_SEPARATORS = re.compile(r'[\\/]')


def leaf_template_name(raw):
    """カテゴリパス付きのテンプレート名から末尾のテンプレート名だけを取り出す。

    例: '02_NSFW/おしがま' -> 'おしがま'
    値が無い場合や区切りで終わる場合は空文字を返す。
    """
    if not raw:
        return ''

    return _SEPARATORS.split(raw)[-1].strip()


def _template_name_for_filename(generator):
    """FilenameGenerator から呼ばれる [template_name] の実体。

    値が無いときは NOTHING_AND_SKIP_PREVIOUS_TEXT を返し、直前の区切り文字ごと
    落とす（'[seed]-[template_name]' で末尾に '-' だけが残るのを防ぐ）。
    """
    from modules.images import NOTHING_AND_SKIP_PREVIOUS_TEXT, sanitize_filename_part

    name = leaf_template_name(getattr(generator.p, 'ets_template_name', ''))
    if not name:
        return NOTHING_AND_SKIP_PREVIOUS_TEXT

    # 空白は残す。'I Need Buzz' のような名前を読める形のままファイル名に出すため
    return sanitize_filename_part(name, replace_spaces=False)


def register_filename_pattern():
    """本体のファイル名パターンに [template_name] を追加する。

    replacements はクラス変数なので、キーを 1 つ足すだけで
    ファイル名・グリッド・サブフォルダのどのパターンからも使えるようになる。
    """
    from modules.images import FilenameGenerator

    FilenameGenerator.replacements['template_name'] = _template_name_for_filename
