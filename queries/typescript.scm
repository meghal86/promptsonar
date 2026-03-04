; Find strings and template strings
(string) @prompt.string
(template_string) @prompt.string

; Detect assignment to variables named *prompt*
(variable_declarator
  name: (identifier) @var_name
  value: (string) @prompt.named_string
  (#match? @var_name "([Pp]rompt|[Ii]nstruction|[Mm]essage)")
)

(variable_declarator
  name: (identifier) @var_name
  value: (template_string) @prompt.named_string
  (#match? @var_name "([Pp]rompt|[Ii]nstruction|[Mm]essage)")
)

; Find LangChain calls
(call_expression
  function: (member_expression
    object: (identifier) @obj
    property: (property_identifier) @prop)
  (#match? @obj "^(PromptTemplate|ChatPromptTemplate)$")
  (#match? @prop "^(from_template|fromTemplate|fromMessages)$")
) @prompt.framework

; Find OpenAI role messages
(pair
  key: (property_identifier) @key
  value: (string) @val
  (#match? @key "role")
  (#match? @val "system")
) @prompt.framework
