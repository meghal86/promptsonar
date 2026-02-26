; Find strings and template strings
(string) @prompt.string
(template_string) @prompt.string

; Find LangChain calls
(call_expression
  function: (member_expression
    object: (identifier) @obj
    property: (property_identifier) @prop)
  (#match? @obj "^(PromptTemplate|ChatPromptTemplate)$")
  (#eq? @prop "from_template")
) @prompt.framework

; Find OpenAI role messages
(pair
  key: (property_identifier) @key
  value: (string) @val
  (#match? @key "role")
  (#match? @val "system")
) @prompt.framework
