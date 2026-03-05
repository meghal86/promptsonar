; Find all strings (multi-line or single-line that might be long)
(string) @prompt.string

; Find LangChain PromptTemplate / ChatPromptTemplate
(call
  function: (attribute
    object: (identifier) @obj
    attribute: (identifier) @attr)
  (#match? @obj "^(PromptTemplate|ChatPromptTemplate)$")
  (#eq? @attr "from_template")
) @prompt.framework

; Find OpenAI/Anthropic messages
(dictionary
  (pair
    key: (string) @key
    value: (string) @val
    (#match? @key "role")
    (#match? @val "system")
  )
) @prompt.framework
