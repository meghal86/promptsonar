(string_literal) @prompt.string
(raw_string_literal) @prompt.string

(let_declaration
  pattern: (identifier) @var_name
  value: [
    (string_literal) @prompt.named_string
    (raw_string_literal) @prompt.named_string
    (call_expression
      function: (scoped_identifier
        path: (identifier) @path (#eq? @path "String")
        name: (identifier) @name (#eq? @name "from"))
      arguments: (arguments (string_literal) @prompt.named_string)
    )
    (macro_invocation
      macro: (identifier) @mac (#eq? @mac "format")
      (token_tree) @prompt.named_string
    )
  ]
  (#match? @var_name "([Pp]rompt|[Ss]ystem|[Ii]nstruction|[Jj]ailbreak)")
)
