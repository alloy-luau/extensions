;; extends

; Alloy. The Luau grammar reads a word it does not know as a name, so
; the declaration words of Alloy color here. Words that are also
; common names, such as new, try, and match, stay names. The predicate
; keeps these words as names in a Luau buffer.
((identifier) @keyword
  (#any-of? @keyword
    "struct" "enum" "impl" "trait" "interface" "namespace" "macro"
    "attribute" "remote" "import" "export" "extends" "satisfies"
    "async" "await" "declare" "extern" "requires" "const")
  (#alloy-buffer?))

; new is a constructor before a type name. `new(x)`, `new.f`, and
; `new = 1` are a local named new. The predicate has the rule.
((identifier) @keyword.operator
  (#eq? @keyword.operator "new")
  (#alloy-new? @keyword.operator))
