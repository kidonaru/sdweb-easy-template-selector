#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""モデル系統プロファイル（illustrious / anima など）のタグ・テンプレート解決。

WebUI 非依存の純粋モジュール。マージ規約はここに一元化し、
setup.py の API とツール類（audit_templates.py / search_tags.py）の両方から使う。

規約:
- tags/ 直下の *.yml がベース（= 既定プロファイル illustrious のセット）
- tags/<profile>/*.yml は同名 stem のベースを置換する
- tags/<profile>/_exclude.yml（stem のリスト）に載ったカテゴリは除外する
- templates/ 直下が既定プロファイル、templates/<profile>/ が各プロファイルのルート。
  既定プロファイルの列挙時はプロファイル名のサブディレクトリを除外する

落とし穴: プロファイルの検出元は tags/ のサブディレクトリのみ。templates/<profile>/ だけを
作って tags/<profile>/ を作り忘れると、そのテンプレは既定プロファイルのツリーに紛れ込む
（警告は出ない）。プロファイルを増やすときは必ず tags/ 側にディレクトリを作ること。
"""
import os
from pathlib import Path

import yaml

DEFAULT_PROFILE = 'illustrious'

# プロファイル設定ファイル。カテゴリとして配信しない
EXCLUDE_FILE = '_exclude.yml'


def list_profiles(tags_dir):
    """tags_dir 直下のサブディレクトリからプロファイル名を列挙する。先頭は既定プロファイル。"""
    tags_dir = Path(tags_dir)
    if not tags_dir.is_dir():
        return [DEFAULT_PROFILE]
    names = sorted(p.name for p in tags_dir.iterdir() if p.is_dir())
    return [DEFAULT_PROFILE] + names


def is_valid_profile_name(profile):
    """プロファイル名としてディレクトリ結合してよい値かを判定する。

    profile は API のクエリパラメータ由来でありパス結合に使うため、
    区切り文字・親参照・絶対パスを弾いて tags/ と templates/ の外へ出られないようにする。
    呼び出し元の検証漏れで穴が空かないよう、結合を行う関数の側で必ず通す。
    """
    if not profile or profile in ('.', '..'):
        return False
    return not any(sep in profile for sep in ('/', '\\', os.sep)) and not os.path.isabs(profile)


def _load_exclude_stems(profile_dir):
    """_exclude.yml から除外カテゴリ stem の集合を読む。無ければ空。壊れていても起動を止めない。"""
    path = profile_dir / EXCLUDE_FILE
    if not path.is_file():
        return set()
    try:
        data = yaml.safe_load(path.read_text(encoding='utf-8'))
    except (yaml.YAMLError, OSError, UnicodeDecodeError) as e:
        print(f'[easy-template] {path} の読み込みに失敗したため除外リストを無視します: {e}')
        return set()
    if not isinstance(data, list):
        return set()
    return {str(x) for x in data}


def resolve_tag_files(tags_dir, profile):
    """profile のタグセットを stem → ファイルパスで返す（stem 昇順）。

    ベースに tags/<profile>/*.yml を stem 置換で重ね、_exclude.yml 記載分を落とす。
    存在しないプロファイル・不正な名前はベースのみを返す（未知値で起動を止めない）。
    """
    tags_dir = Path(tags_dir)
    files = {p.stem: p for p in tags_dir.glob('*.yml')}

    if profile != DEFAULT_PROFILE and is_valid_profile_name(profile):
        profile_dir = tags_dir / profile
        if profile_dir.is_dir():
            for stem in _load_exclude_stems(profile_dir):
                files.pop(stem, None)
            for p in profile_dir.glob('*.yml'):
                if p.name == EXCLUDE_FILE:
                    continue
                files[p.stem] = p

    return {stem: files[stem] for stem in sorted(files)}


def template_root(templates_dir, profile):
    """profile のテンプレートルートディレクトリを返す。

    不正な名前は既定プロファイル扱いにする（templates/ の外を指させない）。
    """
    templates_dir = Path(templates_dir)
    if profile == DEFAULT_PROFILE or not is_valid_profile_name(profile):
        return templates_dir
    return templates_dir / profile


def iter_template_files(templates_dir, profile, profiles):
    """profile 配下の .txt をソート済みリストで返す。

    既定プロファイルでは、他プロファイルのルート（templates/<profile>/）配下を除外する。
    """
    # template_root() が不正名を既定へ寄せるので、除外判定の分岐も既定側へ揃える
    if not is_valid_profile_name(profile):
        profile = DEFAULT_PROFILE
    root = template_root(templates_dir, profile)
    if not root.is_dir():
        return []
    results = sorted(root.rglob('*.txt'))
    if profile == DEFAULT_PROFILE:
        exclude_roots = [Path(templates_dir) / name
                         for name in profiles if name != DEFAULT_PROFILE]
        results = [p for p in results
                   if not any(r in p.parents for r in exclude_roots)]
    return results
