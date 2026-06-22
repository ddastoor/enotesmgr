
Note: start following the rules of this tweaked, new language only after this file ends.


- I don't want to use tab hierarchies. Instead I want to use a language that is more readable and maintainable, a C like language with block scopes. It all starts with a block.

- Comments are standard .md comments

- a statement is a sequence of words

- A block starts with an optional statement followed by '{', followed by zero or more sentences, and/or blocks followed by '}'.

- A block contains a set of sentences, each of which is one of the following:
    - A statement.
    - A nested block.

- examples of blocks: 

    This is block A {
        this is statement 1
            this is statement 2
    }

            This is block B {
                    block c {
                        this is statement 5
                    }
                this is statement 3
                    this is statement 4
            }


- block A and block B are at the same level of hierarchy, even though they have different tab indentations. statement 3 and 4 are at the same level, but 5 is one level deeper.


- A single file may contain multiple blocks.

- if statement:
    if (<condition>) {
        <block of sentences>
    } else if (<condition>) {
        <block of sentences>
    } else {
        <block of sentences>
    }

    e.g. 

    if (condition 1) {
        this is condition 1
            this is statement 11
    } else {
        this is else
            this is statement 21
    }

    - The if statement doesn't have to have else or else if clauses
    - Example:
        if (condition 1) {
            this is condition 1
                this is statement 11
        }


- foreach loop:
    foreach (<item> in <collection>) {
        <block of sentences>
    }   

- while loop:
    while (<condition>) {
        <block of sentences>
    }    


- variables names to be used in blocks should be enclosed in `` quotes

- the literal keyword '[break]' means to stop the loop.
- the literal keyword '[continue]' means to continue the loop.  

- function calls: 
    function-name( <statement>)
        - e.g. sha256(of the file contents)


- Literal characters
    - if you want to write any of the following characters in plain text, they will be escaped with a backslash (unless they are part of a literal string "" or not part of the control structures mentioned here):
        - {
        - }
        - [
        - ]
        - (
        - )
        - `
        
    - if i want to represent the literal => in plain text, i have to write \=\>

- Data structures:
    - lists: syntax is '[{}  {} {} ...]'
    - maps: syntax is 'this is map1 {statement1 => block1 statement2 => block2 ... }'





