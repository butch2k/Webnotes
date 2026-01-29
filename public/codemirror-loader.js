// CodeMirror 6 loader - imports from esm.sh and exposes on window.CM

const CDN_BASE = "https://esm.sh";
const CM_VERSION = "@6";

async function loadCM() {
  try {
    // Core packages
    const [
      { EditorState, Compartment } = await import(`${CDN_BASE}/@codemirror/state${CM_VERSION}`),
      {
        EditorView,
        keymap,
        lineNumbers,
        highlightActiveLine,
        highlightActiveLineGutter,
        drawSelection,
        dropCursor,
        rectangularSelection,
        crosshairCursor,
        highlightSpecialChars,
        placeholder
      } = await import(`${CDN_BASE}/@codemirror/view${CM_VERSION}`),
      {
        defaultKeymap,
        history,
        historyKeymap,
        indentWithTab
      } = await import(`${CDN_BASE}/@codemirror/commands${CM_VERSION}`),
      {
        defaultHighlightStyle,
        syntaxHighlighting,
        indentOnInput,
        bracketMatching,
        foldGutter,
        foldKeymap,
        LanguageSupport,
        StreamLanguage,
        indentUnit,
        HighlightStyle
      } = await import(`${CDN_BASE}/@codemirror/language${CM_VERSION}`),
      { tags } = await import(`${CDN_BASE}/@lezer/highlight@1`),
      {
        closeBrackets,
        closeBracketsKeymap,
        autocompletion,
        completionKeymap
      } = await import(`${CDN_BASE}/@codemirror/autocomplete${CM_VERSION}`),
      {
        searchKeymap,
        highlightSelectionMatches,
        openSearchPanel
      } = await import(`${CDN_BASE}/@codemirror/search${CM_VERSION}`),
      { lintKeymap } = await import(`${CDN_BASE}/@codemirror/lint${CM_VERSION}`),
      // Language packages
      { javascript } = await import(`${CDN_BASE}/@codemirror/lang-javascript${CM_VERSION}`),
      { python } = await import(`${CDN_BASE}/@codemirror/lang-python${CM_VERSION}`),
      { html } = await import(`${CDN_BASE}/@codemirror/lang-html${CM_VERSION}`),
      { css } = await import(`${CDN_BASE}/@codemirror/lang-css${CM_VERSION}`),
      { json } = await import(`${CDN_BASE}/@codemirror/lang-json${CM_VERSION}`),
      { markdown } = await import(`${CDN_BASE}/@codemirror/lang-markdown${CM_VERSION}`),
      { xml } = await import(`${CDN_BASE}/@codemirror/lang-xml${CM_VERSION}`),
      { sql } = await import(`${CDN_BASE}/@codemirror/lang-sql${CM_VERSION}`),
      { java } = await import(`${CDN_BASE}/@codemirror/lang-java${CM_VERSION}`),
      { cpp } = await import(`${CDN_BASE}/@codemirror/lang-cpp${CM_VERSION}`),
      { rust } = await import(`${CDN_BASE}/@codemirror/lang-rust${CM_VERSION}`),
      { php } = await import(`${CDN_BASE}/@codemirror/lang-php${CM_VERSION}`),

      // Legacy modes (StreamLanguage)
      legacyModesModule = await import(`${CDN_BASE}/@codemirror/legacy-modes${CM_VERSION}/mode/go`),
      yamlModule = await import(`${CDN_BASE}/@codemirror/legacy-modes${CM_VERSION}/mode/yaml`),
      powerShellModule = await import(`${CDN_BASE}/@codemirror/legacy-modes${CM_VERSION}/mode/powershell`),
      clikeModule = await import(`${CDN_BASE}/@codemirror/legacy-modes${CM_VERSION}/mode/clike`),
      shellModule = await import(`${CDN_BASE}/@codemirror/legacy-modes${CM_VERSION}/mode/shell`),
      rubyModule = await import(`${CDN_BASE}/@codemirror/legacy-modes${CM_VERSION}/mode/ruby`),
      dockerFileModule = await import(`${CDN_BASE}/@codemirror/legacy-modes${CM_VERSION}/mode/dockerfile`),
      nginxModule = await import(`${CDN_BASE}/@codemirror/legacy-modes${CM_VERSION}/mode/nginx`),
      luaModule = await import(`${CDN_BASE}/@codemirror/legacy-modes${CM_VERSION}/mode/lua`),
      perlModule = await import(`${CDN_BASE}/@codemirror/legacy-modes${CM_VERSION}/mode/perl`),
      rModule = await import(`${CDN_BASE}/@codemirror/legacy-modes${CM_VERSION}/mode/r`),
      swiftModule = await import(`${CDN_BASE}/@codemirror/legacy-modes${CM_VERSION}/mode/swift`),
      tomlModule = await import(`${CDN_BASE}/@codemirror/legacy-modes${CM_VERSION}/mode/toml`),

      // Theme
      { oneDark } = await import(`${CDN_BASE}/@codemirror/theme-one-dark${CM_VERSION}`)
    ] = await Promise.all([
      import(`${CDN_BASE}/@codemirror/state${CM_VERSION}`),
      import(`${CDN_BASE}/@codemirror/view${CM_VERSION}`),
      import(`${CDN_BASE}/@codemirror/commands${CM_VERSION}`),
      import(`${CDN_BASE}/@codemirror/language${CM_VERSION}`),
      import(`${CDN_BASE}/@lezer/highlight@1`),
      import(`${CDN_BASE}/@codemirror/autocomplete${CM_VERSION}`),
      import(`${CDN_BASE}/@codemirror/search${CM_VERSION}`),
      import(`${CDN_BASE}/@codemirror/lint${CM_VERSION}`),
      import(`${CDN_BASE}/@codemirror/lang-javascript${CM_VERSION}`),
      import(`${CDN_BASE}/@codemirror/lang-python${CM_VERSION}`),
      import(`${CDN_BASE}/@codemirror/lang-html${CM_VERSION}`),
      import(`${CDN_BASE}/@codemirror/lang-css${CM_VERSION}`),
      import(`${CDN_BASE}/@codemirror/lang-json${CM_VERSION}`),
      import(`${CDN_BASE}/@codemirror/lang-markdown${CM_VERSION}`),
      import(`${CDN_BASE}/@codemirror/lang-xml${CM_VERSION}`),
      import(`${CDN_BASE}/@codemirror/lang-sql${CM_VERSION}`),
      import(`${CDN_BASE}/@codemirror/lang-java${CM_VERSION}`),
      import(`${CDN_BASE}/@codemirror/lang-cpp${CM_VERSION}`),
      import(`${CDN_BASE}/@codemirror/lang-rust${CM_VERSION}`),
      import(`${CDN_BASE}/@codemirror/lang-php${CM_VERSION}`),
      import(`${CDN_BASE}/@codemirror/legacy-modes${CM_VERSION}/mode/go`),
      import(`${CDN_BASE}/@codemirror/legacy-modes${CM_VERSION}/mode/yaml`),
      import(`${CDN_BASE}/@codemirror/legacy-modes${CM_VERSION}/mode/powershell`),
      import(`${CDN_BASE}/@codemirror/legacy-modes${CM_VERSION}/mode/clike`),
      import(`${CDN_BASE}/@codemirror/legacy-modes${CM_VERSION}/mode/shell`),
      import(`${CDN_BASE}/@codemirror/legacy-modes${CM_VERSION}/mode/ruby`),
      import(`${CDN_BASE}/@codemirror/legacy-modes${CM_VERSION}/mode/dockerfile`),
      import(`${CDN_BASE}/@codemirror/legacy-modes${CM_VERSION}/mode/nginx`),
      import(`${CDN_BASE}/@codemirror/legacy-modes${CM_VERSION}/mode/lua`),
      import(`${CDN_BASE}/@codemirror/legacy-modes${CM_VERSION}/mode/perl`),
      import(`${CDN_BASE}/@codemirror/legacy-modes${CM_VERSION}/mode/r`),
      import(`${CDN_BASE}/@codemirror/legacy-modes${CM_VERSION}/mode/swift`),
      import(`${CDN_BASE}/@codemirror/legacy-modes${CM_VERSION}/mode/toml`),
      import(`${CDN_BASE}/@codemirror/theme-one-dark${CM_VERSION}`)
    ]);

    // Expose everything on window.CM
    window.CM = {
      // State
      EditorState,
      Compartment,

      // View
      EditorView,
      keymap,
      lineNumbers,
      highlightActiveLine,
      highlightActiveLineGutter,
      drawSelection,
      dropCursor,
      rectangularSelection,
      crosshairCursor,
      highlightSpecialChars,
      placeholder,

      // Commands
      defaultKeymap,
      history,
      historyKeymap,
      indentWithTab,

      // Language
      defaultHighlightStyle,
      syntaxHighlighting,
      indentOnInput,
      bracketMatching,
      foldGutter,
      foldKeymap,
      LanguageSupport,
      StreamLanguage,
      indentUnit,
      HighlightStyle,
      tags,

      // Autocomplete
      closeBrackets,
      closeBracketsKeymap,
      autocompletion,
      completionKeymap,

      // Search
      searchKeymap,
      highlightSelectionMatches,
      openSearchPanel,

      // Lint
      lintKeymap,

      // Languages
      javascript,
      python,
      html,
      css,
      json,
      markdown,
      xml,
      sql,
      java,
      cpp,
      rust,
      php,
      go: legacyModesModule.go,
      yaml: yamlModule.yaml,
      powerShell: powerShellModule.powerShell,
      cSharp: clikeModule.cSharp,
      kotlin: clikeModule.kotlin,
      scala: clikeModule.scala,
      shell: shellModule.shell,
      ruby: rubyModule.ruby,
      dockerFile: dockerFileModule.dockerFile,
      nginx: nginxModule.nginx,
      lua: luaModule.lua,
      perl: perlModule.perl,
      r: rModule.r,
      swift: swiftModule.swift,
      toml: tomlModule.toml,

      // Theme
      oneDark
    };

    // Fire ready event
    window.dispatchEvent(new Event("cm-ready"));
    console.log("CodeMirror 6 loaded successfully");
  } catch (error) {
    console.error("Failed to load CodeMirror:", error);
    throw error;
  }
}

// Start loading
loadCM();
