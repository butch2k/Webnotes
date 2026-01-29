// EditorBridge - thin wrapper around CodeMirror 6 for easy integration

window.EditorBridge = (function() {
  let view = null;
  let languageCompartment = null;
  let themeCompartment = null;
  let updateCallback = null;

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
    go: () => window.CM.LanguageSupport.of(window.CM.StreamLanguage.define(window.CM.go)),
    yaml: () => window.CM.LanguageSupport.of(window.CM.StreamLanguage.define(window.CM.yaml)),
    yml: () => window.CM.LanguageSupport.of(window.CM.StreamLanguage.define(window.CM.yaml)),
    plaintext: () => null,
    auto: () => null
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
        backgroundColor: "#45475a"
      },
      ".cm-activeLine": {
        backgroundColor: "#313244"
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
        backgroundColor: "#acb0be"
      },
      ".cm-activeLine": {
        backgroundColor: "#e6e9ef"
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

    // Create compartments for dynamic configuration
    languageCompartment = new CM.Compartment();
    themeCompartment = new CM.Compartment();

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
      CM.syntaxHighlighting(CM.defaultHighlightStyle, { fallback: true }),
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
      CM.EditorView.lineWrapping,

      // Update listener for changes
      CM.EditorView.updateListener.of((update) => {
        if (update.docChanged && updateCallback) {
          updateCallback();
        }
      }),

      // Language compartment (initially plaintext)
      languageCompartment.of([]),

      // Theme compartment
      themeCompartment.of(isDark ? [catppuccinMocha()] : [catppuccinLatte()])
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
    if (!view || !themeCompartment) return;

    view.dispatch({
      effects: themeCompartment.reconfigure(isDark ? [catppuccinMocha()] : [catppuccinLatte()])
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

  function destroy() {
    if (view) {
      view.destroy();
      view = null;
      languageCompartment = null;
      themeCompartment = null;
      updateCallback = null;
    }
  }

  return {
    init,
    getValue,
    setValue,
    setLanguage,
    setTheme,
    focus,
    onUpdate,
    openSearch,
    getView,
    destroy
  };
})();
