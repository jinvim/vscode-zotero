# VSCode Zotero

An extension to insert reference from Zotero library and add them to a bib file.

## The problems
Currently available Zotero extensions for VSCode are not useful for inserting citations from Zotero library. They either:

- Rely on Zotero's citation picker, which can be slow and aesthetically inconsistent with VSCode.
- Require you to first export your Zotero library to a Bibtex file, which is not convenient.
- Do not support `quarto` files.
- Has not been updated for a long time.

Also, the official [Quarto extension for VSCode](https://marketplace.visualstudio.com/items?itemName=quarto.quarto) only supports Zotero citations in visual mode.

## Requirements

- Zotero
- Zotero Better Bibtex
- Zotero needs to be running to add Bib(La)Tex entries.

## Features

At the moment, the extension supports `quarto` and `latex` for inserting citation from Zotero library.

### Insert citation (`zotero.searchLibrary`)
(macOS: <kbd>ctrl</kbd> + <kbd>cmd</kbd> + <kbd>r</kbd>, Windows/Linux: <kbd>ctrl</kbd> + <kbd>alt</kbd> + <kbd>r</kbd>).

![Screenshot of inserting citation](https://raw.githubusercontent.com/jinvim/vscode-zotero/refs/heads/main/resources/fig1.gif)


Items in local Zotero database with Bibtex citation key will be shown in Quick Picks.

If you sellect an item, it will automatically add to `*.bib` file of your project. The extension searches `*.bib` file in the following order:

1. `*.bib` file in `quarto` or `latex` file header (for quarto, this includes `_quarto.yml`)
1. `bibliography.bib` or `references.bib` file in the workspace root directory
1. Any `*.bib` file in the workspace root directory.
1. If none of above is available, ask user to provide path, or create a new one (you still need to add the file to `quarto` or `latex` header).

### Open PDF/Zotero entry/DOI of citation item under cursor (`zotero.openItem`)
(macOS: <kbd>ctrl</kbd> + <kbd>cmd</kbd> + <kbd>o</kbd>, Windows/Linux: <kbd>ctrl</kbd> + <kbd>alt</kbd> + <kbd>o</kbd>).

![Screenshot of opening item](https://raw.githubusercontent.com/jinvim/vscode-zotero/refs/heads/main/resources/fig2.gif)

For any citations that were inserted using this extension, you can:

1. PDF file of the item using Zotero PDF viewer.
1. Open and show the item in Zotero library
1. Open DOI link using the default browser

## Extension Settings

* `zotero.zoteroDbPath`: Path to Zotero database file (default: `~/Zotero/zotero.sqlite`).
* `zotero.betterBibtexDbPath`: Path to Better BibTex database file (default: `~/Zotero/better-bibtex.sqlite`).
* `zotero.betterBibtexTranslator`: Better BibTeX translator to use for exporting entries (default: `Better BibLaTeX`).

## Customizing *.bib entry

The extension uses Better BibLaTeX translator to export entries from Zotero library.
If you want to exclude certain fields from the exported bib entry, you need to set "Fields to omit from export" in Better BibTeX settings in Zotero (Zotero Settings > Better BibTeX > Export > Fields to omit from export).
For example, if you want to exclude `langid` and `file` fields, you can add `langid,file` to this setting.

## Release Notes

See [CHANGELOG.md](CHANGELOG.md)

## VSCodium Users

If you are using VSCodium (or any other VSCode fork that does not have Marketplace access), you can obtain the extension by either:

- Get it from [Open VSX Registry](https://open-vsx.org/extension/jinvim/vscode-zotero); or
- Download the `.vsix` file from the [Releases page](https://github.com/jinvim/vscode-zotero/releases); or
- Use the [VSIX Download Tool](https://github.com/jinvim/vscode-zotero/issues/11#issuecomment-3565297653) to download directly from the Marketplace (thanks to @jiangshiguo).

## WSL Users

If your TeX environment is set up in WSL, you can still use this plugin by using mirrored networking mode (see [here](https://github.com/jinvim/vscode-zotero/issues/9#issuecomment-3811615501); thanks to @mirinae3145).

## Todo

- [x] Performance optimization
- [x] Rewrite `.bib` reader/writer so that it does not require Better Bibtex database.
- [x] Support both bibtex and biblatex formats.
- [x] Better handling of multiple Zotero libraries
- [x] Code cleanup
- [ ] Better handling of appending citation to existing list of citations [e.g., automatically convert `@item1` to `@item1, @item2` when inserting second citation]

## Notes

This extension began as a fork of [telescope-zotero.nvim](https://github.com/jmbuhr/telescope-zotero.nvim), which is an excellent Zotero extension using Neovim to edit `quarto` documents. The only reason kept me from migrating to VSCode for editing `quarto` documents was the lack of a good Zotero extension.

The code is heavily inspired by it, but rewritten in TypeScript for VSCode. I do not speak TypeScript, so I drafted the code using Claude and manually fixed the code to make it work. Hence, if you think I did something wrong, you're probably right.

Has not been tested on Windows or linux. If you find any issues, please let me know.

I'm working on this project as a PhD student in my spare time (which is very, very limited, during the semester). So I apologize in advance if I cannot respond to issues or feature requests in a timely manner.