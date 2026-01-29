// Extra highlight.js language modules not in the common bundle
if (typeof hljs !== 'undefined') {
  hljs.registerLanguage('nginx', function nginx(hljs) {
  const regex = hljs.regex;
  const VAR = {
    className: 'variable',
    variants: [
      { begin: /\$\d+/ },
      { begin: /\$\{\w+\}/ },
      { begin: regex.concat(/[$@]/, hljs.UNDERSCORE_IDENT_RE) }
    ]
  };
  const LITERALS = [
    "on",
    "off",
    "yes",
    "no",
    "true",
    "false",
    "none",
    "blocked",
    "debug",
    "info",
    "notice",
    "warn",
    "error",
    "crit",
    "select",
    "break",
    "last",
    "permanent",
    "redirect",
    "kqueue",
    "rtsig",
    "epoll",
    "poll",
    "/dev/poll"
  ];
  const DEFAULT = {
    endsWithParent: true,
    keywords: {
      $pattern: /[a-z_]{2,}|\/dev\/poll/,
      literal: LITERALS
    },
    relevance: 0,
    illegal: '=>',
    contains: [
      hljs.HASH_COMMENT_MODE,
      {
        className: 'string',
        contains: [
          hljs.BACKSLASH_ESCAPE,
          VAR
        ],
        variants: [
          {
            begin: /"/,
            end: /"/
          },
          {
            begin: /'/,
            end: /'/
          }
        ]
      },
      // this swallows entire URLs to avoid detecting numbers within
      {
        begin: '([a-z]+):/',
        end: '\\s',
        endsWithParent: true,
        excludeEnd: true,
        contains: [ VAR ]
      },
      {
        className: 'regexp',
        contains: [
          hljs.BACKSLASH_ESCAPE,
          VAR
        ],
        variants: [
          {
            begin: "\\s\\^",
            end: "\\s|\\{|;",
            returnEnd: true
          },
          // regexp locations (~, ~*)
          {
            begin: "~\\*?\\s+",
            end: "\\s|\\{|;",
            returnEnd: true
          },
          // *.example.com
          { begin: "\\*(\\.[a-z\\-]+)+" },
          // sub.example.*
          { begin: "([a-z\\-]+\\.)+\\*" }
        ]
      },
      // IP
      {
        className: 'number',
        begin: '\\b\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}(:\\d{1,5})?\\b'
      },
      // units
      {
        className: 'number',
        begin: '\\b\\d+[kKmMgGdshdwy]?\\b',
        relevance: 0
      },
      VAR
    ]
  };

  return {
    name: 'Nginx config',
    aliases: [ 'nginxconf' ],
    contains: [
      hljs.HASH_COMMENT_MODE,
      {
        beginKeywords: "upstream location",
        end: /;|\{/,
        contains: DEFAULT.contains,
        keywords: { section: "upstream location" }
      },
      {
        className: 'section',
        begin: regex.concat(hljs.UNDERSCORE_IDENT_RE + regex.lookahead(/\s+\{/)),
        relevance: 0
      },
      {
        begin: regex.lookahead(hljs.UNDERSCORE_IDENT_RE + '\\s'),
        end: ';|\\{',
        contains: [
          {
            className: 'attribute',
            begin: hljs.UNDERSCORE_IDENT_RE,
            starts: DEFAULT
          }
        ],
        relevance: 0
      }
    ],
    illegal: '[^\\s\\}\\{]'
  };
});
  hljs.registerLanguage('dockerfile', function dockerfile(hljs) {
  const KEYWORDS = [
    "from",
    "maintainer",
    "expose",
    "env",
    "arg",
    "user",
    "onbuild",
    "stopsignal"
  ];
  return {
    name: 'Dockerfile',
    aliases: [ 'docker' ],
    case_insensitive: true,
    keywords: KEYWORDS,
    contains: [
      hljs.HASH_COMMENT_MODE,
      hljs.APOS_STRING_MODE,
      hljs.QUOTE_STRING_MODE,
      hljs.NUMBER_MODE,
      {
        beginKeywords: 'run cmd entrypoint volume add copy workdir label healthcheck shell',
        starts: {
          end: /[^\\]$/,
          subLanguage: 'bash'
        }
      }
    ],
    illegal: '</'
  };
});
  hljs.registerLanguage('properties', function properties(hljs) {
  // whitespaces: space, tab, formfeed
  const WS0 = '[ \\t\\f]*';
  const WS1 = '[ \\t\\f]+';
  // delimiter
  const EQUAL_DELIM = WS0 + '[:=]' + WS0;
  const WS_DELIM = WS1;
  const DELIM = '(' + EQUAL_DELIM + '|' + WS_DELIM + ')';
  const KEY = '([^\\\\:= \\t\\f\\n]|\\\\.)+';

  const DELIM_AND_VALUE = {
    // skip DELIM
    end: DELIM,
    relevance: 0,
    starts: {
      // value: everything until end of line (again, taking into account backslashes)
      className: 'string',
      end: /$/,
      relevance: 0,
      contains: [
        { begin: '\\\\\\\\' },
        { begin: '\\\\\\n' }
      ]
    }
  };

  return {
    name: '.properties',
    disableAutodetect: true,
    case_insensitive: true,
    illegal: /\S/,
    contains: [
      hljs.COMMENT('^\\s*[!#]', '$'),
      // key: everything until whitespace or = or : (taking into account backslashes)
      // case of a key-value pair
      {
        returnBegin: true,
        variants: [
          { begin: KEY + EQUAL_DELIM },
          { begin: KEY + WS_DELIM }
        ],
        contains: [
          {
            className: 'attr',
            begin: KEY,
            endsParent: true
          }
        ],
        starts: DELIM_AND_VALUE
      },
      // case of an empty key
      {
        className: 'attr',
        begin: KEY + WS0 + '$'
      }
    ]
  };
});
}
