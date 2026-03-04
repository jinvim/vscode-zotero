# Change Log

## [Unreleased]

## [1.3.1] - 2026-03-04

- Reverted dependency version of `@types/vscode` to `^1.105.1` to maintain compatibility with Cursor (issue #21).

## [1.3.0] - 2026-03-01

### Breaking changes

- The extension no longer support reading citation keys from Better BibTeX's `better-bibtex.sqlite` database. Users relying on older versions of Zotero and Better BibTeX are encouraged to use 1.2.7 or earlier versions of the extension.

### New features

- Improved performance by optimizing Zotero database SQL queries.

### Bug fixes

- Fix issues where `*.bib` file in `yaml` headers are not correctly parsed (e.g., list of multiple `*.bib` files).

## [1.2.7] - 2026-02-21

- Fix issues where URI scheme (e.g., `vscode-remote://` for WSL/SSH) is not preserved when resolving `.bib` file paths relative to the current document (issue #19).

## [1.2.6] - 2026-02-19

- Fix issue where the extension would not correctly resolve relative paths to `.bib` files in some cases (e.g., when the active editor is a file in a subdirectory of the workspace; issue #18).

## [1.2.5] - 2026-02-18

### Breaking changes

- The extension will now run as a UI extension (#17). 
- This means that the VS Code instance will use Zotero DB in the local machine (i.e., Zotero is assumed to be installed and running in the local machine, not the remote).

## [1.2.4] - 2026-02-17

### Breaking changes

- New version of Better BibTeX introduces changes to the database schema (it no longer uses `better-bibtex.sqlite`; issue #16).
- So the extension will now attempt to read citation keys directly from the Zotero database.
- If the extension detects `better-bibtex.sqlite` file exists, it will fall back to trying to read from `better-bibtex.sqlite` (legacy method). 

## [1.2.3] - 2026-02-13

- Reduced binary size (PR #15; thanks to thanks to @mirinae3145)
- Fixed issue where items with editors (e.g., book chapters with both authors and editors) would not be correctly shown in Quick Picks (e.g., shown as et al. even thuogh they have less than 3 authors).

## [1.2.2] - 2026-02-03

- Fixed bug where opening item without PDF / DOI would cause an error.


## [1.2.1] - 2026-01-31

- Better error handling when searching zotero library by citation key.
- Reverted dependency version of `@types/vscode` to `^1.106.0` to maintain compatibility with Positron.


## [1.2.0] - 2026-01-31

### Breaking changes

- Removed `zotero.serverUrl` configuration option (in favor of using WSL in mirrored networking mode; see #9).

### New features

- Added support for opening items/pdfs in group libraries (issue #14).
- If there are multiple items with the same `citeKey`, user will be prompted to select the desired item from a list.

### Bug fixes

- Fix handling of citation keys with hyphens (issue #14).

## [1.1.5] - 2026-01-26

- Temporary fix for appending citations to existing citation lists for `*.tex` files (issue #13).
  - Only the `citekey` will be inserted at the cursor position.
  - Full support for this feature is planned for a future release.
- Updated dependency versions.

## [1.1.4] - 2026-01-09

- Security update for dependencies.

## [1.1.3] - 2025-11-11

- Fixed handling of `*.bib` file paths in `_quarto.yml` files (issue #10).
  - When there are multiple `*.bib` files specified in `_quarto.yml`, only the first one is used (for now).
- If no workspace is open, resolve `*.bib` path relative to the folder of the active editor.

## [1.1.2] - 2025-09-25

- Added option to set a custom url for the Better BibTeX server in the extension settings (issue #9).

## [1.1.1] - 2025-09-24

- Fixed issue where `libraryID` is not correctly handled when communicating with Better BibTeX (issue #7; PR #8; thanks to @mirinae3145).

## [1.1.0] - 2025-09-24

### Breaking changes

- This plugin now requires Zotero running to add Bib(La)Tex entries. If the connection to Better BibTeX fails, an error message will be displayed.

### New features

- Added feature to choose between BibTeX and BibLaTeX formats when adding citations. Users can set their preference in the extension settings (issue #2; PR #5; thanks to @mirinae3145).
- In addition, exported Bib(La)Tex entries now respect the user's preference for ignoring certain keys as set in Better BibTeX settings (issue #2).
- Improved performance by optimizing Zotero database access (up to 2x faster).

## [1.0.2] - 2025-09-06

- Fixed issue where `proceedingsTitle` was not correctly converted to `booktitle` in BibTeX entries for `inproceedings` item types (issue #3; thanks to @crazyn2).
- Improved handling of `.bib` file paths for formats other than `quarto` or `latex`. Now, the default behavior is to search for any `.bib` file in the workspace root (issue #4; thanks to @daniel-ge).

## [1.0.1] - 2025-08-10

- Fixed issues where the extension would not run on Windows and Linux.

## [1.0.0] - 2025-07-16

- Initial release