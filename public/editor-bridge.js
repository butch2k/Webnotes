// EditorBridge - thin wrapper around CodeMirror 6 for easy integration

window.EditorBridge = (function() {
  let view = null;
  let languageCompartment = null;
  let themeCompartment = null;
  let wrapCompartment = null;
  let updateCallback = null;
  let mochaSyntax = null;
  let latteSyntax = null;

  // Language map
  const langMap = {
    javascript: () => window.CM.javascript(),
    typescript: () => window.CM.javascript({ typescript: true }),
    python: () => window.CM.python(),
    html: () => window.CM.html(),
    css: () => window.CM.css(),
    json: () => window.CM.json(),
    markdown: () => window.CM.markdown(),
    xml: () => window.CM.xml(),
    sql: () => window.CM.sql(),
    java: () => window.CM.java(),
    cpp: () => window.CM.cpp(),
    c: () => window.CM.cpp(),
    rust: () => window.CM.rust(),
    php: () => window.CM.php(),
    go: () => new window.CM.LanguageSupport(window.CM.StreamLanguage.define(window.CM.go)),
    yaml: () => new window.CM.LanguageSupport(window.CM.StreamLanguage.define(window.CM.yaml)),
    yml: () => new window.CM.LanguageSupport(window.CM.StreamLanguage.define(window.CM.yaml)),
    powershell: () => new window.CM.LanguageSupport(window.CM.StreamLanguage.define(window.CM.powerShell)),
    bash: () => new window.CM.LanguageSupport(window.CM.StreamLanguage.define(window.CM.shell)),
    csharp: () => new window.CM.LanguageSupport(window.CM.StreamLanguage.define(window.CM.cSharp)),
    ruby: () => new window.CM.LanguageSupport(window.CM.StreamLanguage.define(window.CM.ruby)),
    dockerfile: () => new window.CM.LanguageSupport(window.CM.StreamLanguage.define(window.CM.dockerFile)),
    nginx: () => new window.CM.LanguageSupport(window.CM.StreamLanguage.define(window.CM.nginx)),
    lua: () => new window.CM.LanguageSupport(window.CM.StreamLanguage.define(window.CM.lua)),
    perl: () => new window.CM.LanguageSupport(window.CM.StreamLanguage.define(window.CM.perl)),
    r: () => new window.CM.LanguageSupport(window.CM.StreamLanguage.define(window.CM.r)),
    swift: () => new window.CM.LanguageSupport(window.CM.StreamLanguage.define(window.CM.swift)),
    kotlin: () => new window.CM.LanguageSupport(window.CM.StreamLanguage.define(window.CM.kotlin)),
    scala: () => new window.CM.LanguageSupport(window.CM.StreamLanguage.define(window.CM.scala)),
    toml: () => new window.CM.LanguageSupport(window.CM.StreamLanguage.define(window.CM.toml)),
    plaintext: () => null
  };

  // Catppuccin Mocha (dark) theme
  function catppuccinMocha() {
    return window.CM.EditorView.theme({
      "&": {
        color: "#cdd6f4",
        backgroundColor: "#1e1e2e"
      },
      ".cm-content": {
        caretColor: "#f5e0dc"
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "#f5e0dc"
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: "rgba(203, 166, 247, 0.30)"
      },
      ".cm-activeLine": {
        backgroundColor: "rgba(49, 50, 68, 0.5)"
      },
      ".cm-gutters": {
        backgroundColor: "#1e1e2e",
        color: "#7f849c",
        border: "none"
      },
      ".cm-activeLineGutter": {
        backgroundColor: "#313244",
        color: "#f5e0dc"
      },
      ".cm-lineNumbers .cm-gutterElement": {
        color: "#6c7086"
      }
    }, { dark: true });
  }

  // Catppuccin Latte (light) theme
  function catppuccinLatte() {
    return window.CM.EditorView.theme({
      "&": {
        color: "#4c4f69",
        backgroundColor: "#eff1f5"
      },
      ".cm-content": {
        caretColor: "#dc8a78"
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "#dc8a78"
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: "rgba(136, 57, 239, 0.25)"
      },
      ".cm-activeLine": {
        backgroundColor: "rgba(230, 233, 239, 0.5)"
      },
      ".cm-gutters": {
        backgroundColor: "#eff1f5",
        color: "#9ca0b0",
        border: "none"
      },
      ".cm-activeLineGutter": {
        backgroundColor: "#e6e9ef",
        color: "#dc8a78"
      },
      ".cm-lineNumbers .cm-gutterElement": {
        color: "#8c8fa1"
      }
    }, { dark: false });
  }

  function init(container, initialValue, isDark) {
    // Wait for CM to be ready if not loaded yet
    if (!window.CM) {
      window.addEventListener("cm-ready", () => init(container, initialValue, isDark), { once: true });
      return;
    }

    const CM = window.CM;

    // Define Catppuccin Mocha syntax highlighting
    mochaSyntax = CM.HighlightStyle.define([
      { tag: CM.tags.keyword, color: "#cba6f7" },
      { tag: [CM.tags.name, CM.tags.deleted, CM.tags.character, CM.tags.propertyName, CM.tags.macroName], color: "#cdd6f4" },
      { tag: [CM.tags.function(CM.tags.variableName), CM.tags.labelName], color: "#89b4fa" },
      { tag: [CM.tags.color, CM.tags.constant(CM.tags.name), CM.tags.standard(CM.tags.name)], color: "#fab387" },
      { tag: [CM.tags.definition(CM.tags.name), CM.tags.separator], color: "#cdd6f4" },
      { tag: [CM.tags.typeName, CM.tags.className, CM.tags.number, CM.tags.changed, CM.tags.annotation, CM.tags.modifier, CM.tags.self, CM.tags.namespace], color: "#f9e2af" },
      { tag: [CM.tags.operator, CM.tags.operatorKeyword, CM.tags.url, CM.tags.escape, CM.tags.regexp, CM.tags.link, CM.tags.special(CM.tags.string)], color: "#89dceb" },
      { tag: [CM.tags.meta, CM.tags.comment], color: "#6c7086" },
      { tag: CM.tags.strong, fontWeight: "bold" },
      { tag: CM.tags.emphasis, fontStyle: "italic" },
      { tag: CM.tags.strikethrough, textDecoration: "line-through" },
      { tag: CM.tags.link, color: "#89b4fa", textDecoration: "underline" },
      { tag: CM.tags.heading, fontWeight: "bold", color: "#cba6f7" },
      { tag: [CM.tags.atom, CM.tags.bool, CM.tags.special(CM.tags.variableName)], color: "#fab387" },
      { tag: [CM.tags.processingInstruction, CM.tags.string, CM.tags.inserted], color: "#a6e3a1" },
      { tag: CM.tags.invalid, color: "#f38ba8" },
      { tag: CM.tags.attributeName, color: "#f9e2af" },
      { tag: CM.tags.tagName, color: "#cba6f7" },
      { tag: CM.tags.propertyName, color: "#89b4fa" }
    ]);

    // Define Catppuccin Latte syntax highlighting
    latteSyntax = CM.HighlightStyle.define([
      { tag: CM.tags.keyword, color: "#8839ef" },
      { tag: [CM.tags.name, CM.tags.deleted, CM.tags.character, CM.tags.propertyName, CM.tags.macroName], color: "#4c4f69" },
      { tag: [CM.tags.function(CM.tags.variableName), CM.tags.labelName], color: "#1e66f5" },
      { tag: [CM.tags.color, CM.tags.constant(CM.tags.name), CM.tags.standard(CM.tags.name)], color: "#fe640b" },
      { tag: [CM.tags.definition(CM.tags.name), CM.tags.separator], color: "#4c4f69" },
      { tag: [CM.tags.typeName, CM.tags.className, CM.tags.number, CM.tags.changed, CM.tags.annotation, CM.tags.modifier, CM.tags.self, CM.tags.namespace], color: "#df8e1d" },
      { tag: [CM.tags.operator, CM.tags.operatorKeyword, CM.tags.url, CM.tags.escape, CM.tags.regexp, CM.tags.link, CM.tags.special(CM.tags.string)], color: "#04a5e5" },
      { tag: [CM.tags.meta, CM.tags.comment], color: "#9ca0b0" },
      { tag: CM.tags.strong, fontWeight: "bold" },
      { tag: CM.tags.emphasis, fontStyle: "italic" },
      { tag: CM.tags.strikethrough, textDecoration: "line-through" },
      { tag: CM.tags.link, color: "#1e66f5", textDecoration: "underline" },
      { tag: CM.tags.heading, fontWeight: "bold", color: "#8839ef" },
      { tag: [CM.tags.atom, CM.tags.bool, CM.tags.special(CM.tags.variableName)], color: "#fe640b" },
      { tag: [CM.tags.processingInstruction, CM.tags.string, CM.tags.inserted], color: "#40a02b" },
      { tag: CM.tags.invalid, color: "#d20f39" },
      { tag: CM.tags.attributeName, color: "#df8e1d" },
      { tag: CM.tags.tagName, color: "#8839ef" },
      { tag: CM.tags.propertyName, color: "#1e66f5" }
    ]);

    // Create compartments for dynamic configuration
    languageCompartment = new CM.Compartment();
    themeCompartment = new CM.Compartment();
    wrapCompartment = new CM.Compartment();

    // Build extensions array
    const extensions = [
      // Basic setup
      CM.lineNumbers(),
      CM.highlightActiveLine(),
      CM.highlightActiveLineGutter(),
      CM.highlightSpecialChars(),
      CM.history(),
      CM.foldGutter(),
      CM.drawSelection(),
      CM.dropCursor(),
      CM.indentOnInput(),
      CM.bracketMatching(),
      CM.closeBrackets(),
      CM.autocompletion(),
      CM.rectangularSelection(),
      CM.crosshairCursor(),
      CM.highlightSelectionMatches(),

      // Keymaps
      CM.keymap.of([
        ...CM.defaultKeymap,
        ...CM.historyKeymap,
        ...CM.foldKeymap,
        ...CM.completionKeymap,
        ...CM.closeBracketsKeymap,
        ...CM.searchKeymap,
        ...CM.lintKeymap,
        CM.indentWithTab
      ]),

      // Indent with 2 spaces
      CM.indentUnit.of("  "),

      // Line wrapping
      wrapCompartment.of(CM.EditorView.lineWrapping),

      // Update listener for changes
      CM.EditorView.updateListener.of((update) => {
        if (update.docChanged && updateCallback) {
          updateCallback();
        }
      }),

      // Language compartment (initially plaintext)
      languageCompartment.of([]),

      // Theme compartment
      themeCompartment.of(isDark ? [catppuccinMocha(), CM.syntaxHighlighting(mochaSyntax)] : [catppuccinLatte(), CM.syntaxHighlighting(latteSyntax)])
    ];

    // Create state
    const state = CM.EditorState.create({
      doc: initialValue,
      extensions
    });

    // Create view
    view = new CM.EditorView({
      state,
      parent: container
    });
  }

  function getValue() {
    if (!view) return "";
    return view.state.doc.toString();
  }

  function setValue(text) {
    if (!view) return;
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: text
      }
    });
  }

  function setLanguage(langName) {
    if (!view || !languageCompartment) return;

    const langFunc = langMap[langName] || langMap.plaintext;
    const lang = langFunc();

    view.dispatch({
      effects: languageCompartment.reconfigure(lang ? [lang] : [])
    });
  }

  function setTheme(isDark) {
    if (!view || !themeCompartment || !mochaSyntax || !latteSyntax) return;

    const CM = window.CM;
    view.dispatch({
      effects: themeCompartment.reconfigure(isDark ? [catppuccinMocha(), CM.syntaxHighlighting(mochaSyntax)] : [catppuccinLatte(), CM.syntaxHighlighting(latteSyntax)])
    });
  }

  function focus() {
    if (view) {
      view.focus();
    }
  }

  function onUpdate(callback) {
    updateCallback = callback;
  }

  function openSearch() {
    if (view) {
      window.CM.openSearchPanel(view);
    }
  }

  function getView() {
    return view;
  }

  function setLineWrapping(enabled) {
    if (!view || !wrapCompartment) return;
    const CM = window.CM;
    view.dispatch({
      effects: wrapCompartment.reconfigure(enabled ? CM.EditorView.lineWrapping : [])
    });
  }

  function destroy() {
    if (view) {
      view.destroy();
      view = null;
      languageCompartment = null;
      themeCompartment = null;
      wrapCompartment = null;
      updateCallback = null;
    }
  }

  return {
    init,
    getValue,
    setValue,
    setLanguage,
    setTheme,
    setLineWrapping,
    focus,
    onUpdate,
    openSearch,
    getView,
    destroy
  };
})();
