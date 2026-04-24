;; this is pretty much the test set from minilisp. format is:
;; test name | expected result | test case
(setq lisp-tests
      '(;; constants
        ("constant" "t" "t")
        ("constant" "nil" "nil")
        ("constant" "nil" "()")
        ;; Basic data types
        ("integer"      "1"         "1")
        ("integer"      "-1"        "-1")
        ("symbol"       "a"         "'a")
        ("quote"        "a"         "(quote a)")
        ("quote"        "63"        "'63")
        ("quote"        "(+ 1 2)"   "'(+ 1 2)")
        ("+"            "3"         "(+ 1 2)")
        ("+"            "-2"        "(+ 1 -3)")
        ("unary -"      "-3"        "(- 3)")
        ("-"            "-2"        "(- 3 5)")
        ("-"            "-9"        "(- 3 5 7)")
        ("<"            "t"         "(< 2 3)")
        ("<"            "nil"        "(< 3 3)")
        ("<"            "nil"        "(< 4 3)")
        ("literal list" "(a b c)"   "'(a b c)")
        ("literal list" "(a b . c)" "'(a b . c)")
        ;; let/let*
        ("progn"        "3"   "(progn 1 2 3)")
        ("progn-side"   "11"  "(let ((x 10)) (progn (setq x (+ x 1)) x))")
        ("let*-seq"     "3"   "(let* ((x 1) (y (+ x 1)) (z (+ y 1))) z)")
        ("let*-shadow"  "2"   "(let* ((x 1) (x 2)) x)")
        ("let-basic"    "3"   "(let ((x 1) (y 2)) (+ x y))")
        ;;("let-parallel" "error" "(let ((x 1) (y (+ x 1))) y)") ; Should fail if x is not global
        ("let-shadow"   "1"   "(let ((x 1)) (let ((x 2)) 10) x)")
        ("let-nest"     "3"   "(let ((x 1)) (let ((y (+ x 2))) y))")
        ("let-empty"    "5"   "(let () 5)")
        ("let-setq-local"  "2"   "(let ((x 1)) (setq x 2) x)")
        ("let-shadow-setq" "1"   "(let ((x 1)) (let ((x 5)) (setq x 10)) x)")
        ("let-global-prot" "10"  "(setq x 10) (let ((x 1)) (setq x 2)) x")
        ("let-mult-setq"   "3"   "(let ((x 1) (y 1)) (setq x 2) (setq y (+ x 1)) y)")
        ;; not / null (Identical behavior in Lisp)
        ("not-nil"      "t"         "(not nil)")
        ("not-list"     "nil"       "(not '(1 2))")
        ("not-val"      "nil"       "(not 1)")
        ("null-nil"     "t"         "(null ())")
        ("null-val"     "nil"       "(null 'a)")
        ;; numberp
        ("numberp-int"  "t"         "(numberp 42)")
        ("numberp-neg"  "t"         "(numberp -5)")
        ("numberp-sym"  "nil"       "(numberp 'a)")
        ("numberp-nil"  "nil"       "(numberp nil)")
        ;; symbolp
        ("symbolp-sym"  "t"         "(symbolp 'foo)")
        ("symbolp-t"    "t"         "(symbolp t)")
        ("symbolp-nil"  "t"         "(symbolp nil)")
        ("symbolp-num"  "nil"       "(symbolp 100)")
        ("symbolp-str"  "nil"       "(symbolp \"hi\")")
        ;; listp
        ("listp-list"   "t"         "(listp '(1 2))")
        ("listp-nil"    "t"         "(listp nil)")
        ("listp-cons"   "t"         "(listp (cons 1 2))")
        ("listp-atom"   "nil"       "(listp 'a)")
        ("listp-num"    "nil"       "(listp 42)")
        ;; functionp (assuming standard function objects)
        ("functionp-lam" "t"        "(functionp (lambda (x) x))")
        ("functionp-pri" "t"        "(functionp +)")
        ("functionp-sym" "nil"      "(functionp 'car)")
        ;; stringp
        ("stringp-str"  "t"         "(stringp \"hello\")")
        ("stringp-mt"   "t"         "(stringp \"\")")
        ("stringp-sym"  "nil"       "(stringp 'hello)")
        ("stringp-nil"  "nil"       "(stringp nil)")
        ;; the same, but nested
        ;; Dotted pairs and complex lists
        ("listp-dotted" "t"         "(listp '(a . b))")
        ("listp-nested" "t"         "(listp '((a b) (c d)))")
        ("symbolp-nest" "nil"       "(symbolp '(a . b))")
        ;; Nested number checks
        ("numberp-nest" "nil"       "(numberp '(1))")
        ("car-is-num"   "t"         "(numberp (car '(1 2)))")
        ;; Empty nested structures
        ("null-nest"    "nil"       "(null '(nil))") ; A list containing nil is not nil
        ("listp-nest-mt" "t"        "(listp '(()))")
        ;; Function and Closure checks
        ("func-nested"  "t"         "(functionp (lambda (x) (lambda (y) (+ x y))))")
        ("func-builtin" "t"         "(functionp (car (list + -)))")
        ;; String edge cases
        ("stringp-nest" "nil"       "(stringp '(\"hi\"))")
        ("stringp-char" "t"         "(stringp (car '(\"a\" \"b\")))") ; strings are first-class, car returns a string
        ;; string= and friends — case-sensitive comparisons
        ("string="      "t"    "(string= \"abc\" \"abc\")")
        ("string=-no"   "nil"  "(string= \"abc\" \"ABC\")")
        ("string/="     "t"    "(string/= \"abc\" \"def\")")
        ("string/=-no"  "nil"  "(string/= \"abc\" \"abc\")")
        ("string<"      "t"    "(string< \"abc\" \"abd\")")
        ("string<-no"   "nil"  "(string< \"abd\" \"abc\")")
        ("string>"      "t"    "(string> \"abd\" \"abc\")")
        ("string>-no"   "nil"  "(string> \"abc\" \"abd\")")
        ("string<="     "t"    "(string<= \"abc\" \"abc\")")
        ("string<=-lt"  "t"    "(string<= \"abc\" \"abd\")")
        ("string<=-no"  "nil"  "(string<= \"abd\" \"abc\")")
        ("string>="     "t"    "(string>= \"abc\" \"abc\")")
        ("string>=-gt"  "t"    "(string>= \"abd\" \"abc\")")
        ("string>=-no"  "nil"  "(string>= \"abc\" \"abd\")")
        ;; case-insensitive comparisons
        ("string-equal"       "t"   "(string-equal \"abc\" \"ABC\")")
        ("string-equal-no"    "nil" "(string-equal \"abc\" \"def\")")
        ("string-not-equal"   "t"   "(string-not-equal \"abc\" \"def\")")
        ("string-not-equal-no" "nil" "(string-not-equal \"abc\" \"ABC\")")
        ("string-lessp"       "t"   "(string-lessp \"abc\" \"ABD\")")
        ("string-lessp-no"    "nil" "(string-lessp \"ABD\" \"abc\")")
        ("string-greaterp"    "t"   "(string-greaterp \"ABD\" \"abc\")")
        ("string-greaterp-no" "nil" "(string-greaterp \"abc\" \"ABD\")")
        ("string-not-lessp"   "t"   "(string-not-lessp \"ABC\" \"abc\")")
        ("string-not-lessp-gt" "t"  "(string-not-lessp \"ABD\" \"abc\")")
        ("string-not-greaterp"    "t"   "(string-not-greaterp \"abc\" \"ABC\")")
        ("string-not-greaterp-lt" "t"   "(string-not-greaterp \"abc\" \"ABD\")")
        ;; string coercion
        ("string-sym"   "\"foo\""  "(string 'foo)")
        ("string-str"   "\"bar\""  "(string \"bar\")")
        ;; case operations
        ("string-upcase"     "\"HELLO\""        "(string-upcase \"hello\")")
        ("string-downcase"   "\"hello\""        "(string-downcase \"HELLO\")")
        ("string-capitalize" "\"Hello World\""  "(string-capitalize \"hello world\")")
        ("string-capitalize-mixed" "\"Hello World\"" "(string-capitalize \"HELLO WORLD\")")
        ;; trim operations
        ("string-trim-ws"    "\"hello\""   "(string-trim \"  hello  \")")
        ("string-trim-bag"   "\"hello\""   "(string-trim \" \" \"  hello  \")")
        ("string-ltrim"      "\"hello  \"" "(string-left-trim \" \" \"  hello  \")")
        ("string-rtrim"      "\"  hello\"" "(string-right-trim \" \" \"  hello  \")")
        ;; subseq on strings and lists
        ("subseq-str"        "\"ell\""    "(subseq \"hello\" 1 4)")
        ("subseq-str-noend"  "\"lo\""     "(subseq \"hello\" 3)")
        ("subseq-list"       "(b c)"      "(subseq '(a b c d) 1 3)")
        ("subseq-list-noend" "(c d)"      "(subseq '(a b c d) 2)")
        ;; char
        ("char-first"  "\"h\""  "(char \"hello\" 0)")
        ("char-last"   "\"o\""  "(char \"hello\" 4)")
        ("char-oob"    "nil"    "(char \"hello\" 10)")
        ;; intern / symbol-name
        ("intern"      "foo"       "(intern \"foo\")")
        ("intern-eq"   "t"         "(eq (intern \"foo\") 'foo)")
        ("symbol-name" "\"foo\""   "(symbol-name 'foo)")
        ;; string-append
        ("string-append"   "\"helloworld\"" "(string-append \"hello\" \"world\")")
        ("string-append-3" "\"abc\""        "(string-append \"a\" \"b\" \"c\")")
        ("string-append-0" "\"\""           "(string-append)")
        ;; string-to-number / number-to-string
        ("string-to-number-i" "42"      "(string-to-number \"42\")")
        ("string-to-number-f" "3.14"    "(string-to-number \"3.14\")")
        ("string-to-number-x" "nil"     "(string-to-number \"abc\")")
        ("number-to-string-i" "\"42\""  "(number-to-string 42)")
        ("number-to-string-f" "\"3.14\"" "(number-to-string 3.14)")
        ;; string-contains
        ("string-contains-t"   "t"   "(string-contains \"hello world\" \"world\")")
        ("string-contains-nil" "nil" "(string-contains \"hello\" \"xyz\")")
        ;; split-string
        ("split-string-ws"  "(\"hello\" \"world\")"  "(split-string \"hello world\")")
        ("split-string-sep" "(\"a\" \"b\" \"c\")"    "(split-string \"a,b,c\" \",\")")
        ("split-string-mt"  "nil"                    "(split-string \"\")")
        ;; Basic data type methods
        ("atom-sym"    "t"   "(atom 'x)")
        ("atom-num"    "t"   "(atom 42)")
        ("atom-list"   "nil" "(atom '(1 2))")
        ("atom-empty"  "t"   "(atom nil)") ; nil is both an atom and an empty list
        ;; List manipulation
        ("cons"   "(a . b)"  "(cons 'a 'b)")
        ("cons"   "(a b c)"  "(cons 'a (cons 'b (cons 'c ())))")
        ("car"    "a"        "(car '(a b c))")
        ("cdr"    "(b c)"    "(cdr '(a b c))")
        ("setcar" "(x . b)"  "(define obj (cons 'a 'b)) (setcar obj 'x) obj")
        ;; List utilities
        ("length"     "3"          "(length '(a b c))")
        ("length-0"   "0"          "(length '())")
        ("length-str" "5"          "(length \"hello\")")
        ("length-str0" "0"         "(length \"\")")
        ("nth"        "b"          "(nth 1 '(a b c))")
        ("nth-out"    "nil"        "(nth 5 '(a b c))")
        ("last"       "(c)"        "(last '(a b c))")
        ("last-empty" "nil"        "(last '())")
        ("reverse"    "(c b a)"    "(reverse '(a b c))")
        ("reverse-1"  "(a)"        "(reverse '(a))")
        ("append"     "(1 2 3 4)"  "(append '(1 2) '(3 4))")
        ("append-3"   "(1 2 3 4 5)" "(append '(1) '(2 3) '(4 5))")
        ("mapcar"     "(2 3 4)"    "(mapcar (lambda (x) (+ 1 x)) '(1 2 3))")
        ("mapcar-nil" "nil"        "(mapcar (lambda (x) x) '())")
        ("cadr"       "2"          "(cadr '(1 2 3))")
        ("caddr"      "3"          "(caddr '(1 2 3))")
        ("caar"       "a"          "(caar '((a b) c))")
        ("cddr"       "(3)"        "(cddr '(1 2 3))")
        ("cddr-short" "nil"        "(cddr '(1 2))")
        ("dolist-sum"   "6"   "(let ((s 0)) (dolist (x '(1 2 3)) (setq s (+ s x))) s)")
        ("dolist-ret"   "6"   "(let ((s 0)) (dolist (x '(1 2 3) s) (setq s (+ s x))))") ; body runs, then result form is returned
        ;; Numeric shorthands
        ("1+"       "6"    "(1+ 5)")
        ("1+"       "0"    "(1+ -1)")
        ("1-"       "4"    "(1- 5)")
        ("1-"       "-2"   "(1- -1)")
        ("max-2"    "10"   "(max 5 10)")
        ("max-multi" "50"   "(max 5 50 10 20)")
        ("max-neg"   "-1"   "(max -10 -5 -1)")
        ("min-2"    "5"    "(min 5 10)")
        ("min-multi" "5"    "(min 50 10 5 20)")
        ("min-neg"   "-10"  "(min -10 -5 -1)")
        ("abs-pos"   "10"   "(abs 10)")
        ("abs-neg"   "10"   "(abs -10)")
        ("abs-zero"  "0"    "(abs 0)")
        ("mod-exact" "0"    "(mod 10 5)")
        ("mod-rem"   "1"    "(mod 10 3)")
        ("mod-neg"   "2"    "(mod -1 3)")
        ;; Comments
        ("comment" "5" "
  ; 2
  5 ; 3")
        ;; apply
        ("apply-basic" "3"   "(apply #'+ '(1 2))")
        ("apply-extra" "6"   "(apply #'+ 1 2 '(3))")
        ("apply-args"  "15"  "(defun f (x y z) (+ x y z)) (apply #'f '(3 5 7))")
        ("apply-lambda" "10" "(apply (lambda (x y) (* x y)) '(2 5))")
        ;; read
        ("read-sym"    "foo"       "(read \"foo\")")
        ("read-list"   "(1 2 3)"   "(read \"(1 2 3)\")")
        ("read-nest"   "((a) b)"   "(read \"((a) b)\")")
        ("read-string" "\"hello\"" "(read \"\\\"hello\\\"\")")
        ;; Global variables
        ("define" "7"  "(define x 7) x")
        ("define" "10" "(define x 7) (+ x 3)")
        ("define" "7"  "(define + 7) +")
        ("setq"   "11" "(define x 7) (setq x 11) x")
        ("setq"   "17" "(setq + 17) +")
        ;; Conditionals
        ("if" "a"  "(if 1 'a)")
        ("if" "nil" "(if () 'a)")
        ("if" "a"  "(if 1 'a 'b)")
        ("if" "a"  "(if 0 'a 'b)")
        ("if" "a"  "(if 'x 'a 'b)")
        ("if" "b"  "(if () 'a 'b)")
        ("if" "c"  "(if () 'a 'b 'c)")
        ;; Numeric comparisons
        ("=" "t"  "(= 3 3)")
        ("=" "nil" "(= 3 2)")
        ;; eq/or/and
        ("eq" "t"  "(eq 'foo 'foo)")
        ("eq" "t"  "(eq + +)")
        ("eq" "nil" "(eq 'foo 'bar)")
        ("eq" "nil" "(eq + 'bar)")
        ("and-true"     "3"   "(and 1 2 3)")
        ("and-false"    "nil" "(and 1 nil 3)")
        ("and-empty"    "t"   "(and)")
        ("or-true"      "1"   "(or 1 2 3)")
        ("or-first"     "1"   "(or 1 (undefined-fn))") ; Tests short-circuiting
        ("or-false"     "nil" "(or nil nil nil)")
        ("or-empty"     "nil" "(or)")
        ;; cond
        ("cond-first"   "1"   "(cond (t 1) (t 2))")
        ("cond-second"  "2"   "(cond (nil 1) (t 2))")
        ("cond-default" "3"   "(cond (nil 1) (nil 2) (t 3))")
        ("cond-fallthru" "nil" "(cond (nil 1) (nil 2))")
        ("cond-multiform" "2"  "(cond (t 1 2))")
        ("cond-empty"   "nil" "(cond)")
        ("cond-complex" "10"  "(cond ((= 1 2) 5) ((= 1 1) 10) (t 15))")
        ;; gensym
        ("gensym" "G__0" "(gensym)")
        ("gensym" "nil"   "(eq (gensym) 'G__0)")
        ("gensym" "nil"   "(eq (gensym) (gensym))")
        ("gensym" "t"    "((lambda (x) (eq x x)) (gensym))")
        ;; Functions
        ("lambda" "<function>" "(lambda (x) x)")
        ("lambda" "t"          "((lambda () t))")
        ("lambda" "9"          "((lambda (x) (+ x x x)) 3)")
        ("defun"  "12"         "(defun double (x) (+ x x)) (double 6)")
        ("args"   "15"         "(defun f (x y z) (+ x y z)) (f 3 5 7)")
        ("restargs" "(3 5 7)"  "(defun f (x . y) (cons x y)) (f 3 5 7)")
        ("restargs" "(3)"      "(defun f (x . y) (cons x y)) (f 3)")
        ;; Lexical closures
        ("closure" "3" "(defun call (f) ((lambda (var) (f)) 5))
  ((lambda (var) (call (lambda () var))) 3)")
        ("counter" "3" "
  (define counter
    ((lambda (val)
       (lambda () (setq val (+ val 1)) val))
     0))
  (counter)
  (counter)
  (counter)")
        ;; While loop
        ("while" "45" "
  (define i 0)
  (define sum 0)
  (while (< i 10)
    (setq sum (+ sum i))
    (setq i (+ i 1)))
  sum")
        ;; Macros
        ("macro" "42" "
  (defun list (x . y) (cons x y))
  (defmacro if-zero (x then) (list 'if (list '= x 0) then))
  (if-zero 0 42)")
        ("macro" "7" "(defmacro seven () 7) ((lambda () (seven)))")
        ("macroexpand" "(if (= x 0) (print x))" "
  (defun list (x . y) (cons x y))
  (defmacro if-zero (x then) (list 'if (list '= x 0) then))
  (macroexpand (if-zero x (print x)))")
        ;; Recursion
        ("recursion" "55" "(defun f (x) (if (= x 0) 0 (+ (f (+ x -1)) x))) (f 10)")
        ;; Keywords: self-evaluating, print with colon
        ("keyword-self"  ":foo"    ":foo")
        ("keyword-eq"    "t"       "(eq :foo :foo)")
        ("keyword-neq"   "nil"     "(eq :foo :bar)")
        ("keyword-in-list" "(:a :b)" "(list :a :b)")
        ;; #: uninterned symbol — treated as plain symbol
        ("hash-colon"    "foo"     "#:foo")
        ("hash-colon-eq" "t"       "(eq #:foo 'foo)")
        ;; #+ reader conditional
        ("#+present"     "1"       "#+common-lisp 1")
        ("#+absent"      "nil"     "#+sbcl 1")
        ("#+or-present"  "1"       "#+(or sbcl common-lisp) 1")
        ("#+or-absent"   "nil"     "#+(or sbcl ccl) 1")
        ("#+and-present" "1"       "#+(and common-lisp) 1")
        ("#+and-absent"  "nil"     "#+(and common-lisp sbcl) 1")
        ("#+not-absent"  "1"       "#+(not sbcl) 1")
        ("#+not-present" "nil"     "#+(not common-lisp) 1")
        ("#+in-list"     "(1 3)"   "(list #+common-lisp 1 #+sbcl 2 3)")
        ;; #- reader conditional (complement of #+)
        ("#-absent"      "1"       "#-sbcl 1")
        ("#-present"     "nil"     "#-common-lisp 1")
        ;; eval-when — treat as progn
        ("eval-when"     "42"      "(eval-when (:load-toplevel :execute) 42)")
        ;; defvar — bind only if unbound
        ("defvar-bind"   "7"       "(defvar x 7) x")
        ("defvar-no-rebind" "7"    "(defvar x 7) (defvar x 99) x")
        ;; defparameter — always rebind
        ("defparameter"  "99"      "(defparameter x 7) (defparameter x 99) x")
        ;; defconstant — bind (treated like defparameter)
        ("defconstant"   "42"      "(defconstant pi-approx 42) pi-approx")
        ;; setf on plain variable
        ("setf-var"      "10"      "(setq x 5) (setf x 10) x")
        ;; *features* is a list of keywords
        ("features-list" "t"       "(listp *features*)")
        ("features-cl"   "t"       "(not (null (member :common-lisp *features*)))")))

(defun run-lisp-test (name expected expr)
  "Run EXPR via eval-string and compare result to EXPECTED.
Returns (PASS ACTUAL) where PASS is t or nil."
  (let* ((actual (prin1-to-string (eval-string expr)))
         (ok (string= actual expected)))
    (list ok actual)))

(defun run-lisp-tests (test-list)
  "Run TEST-LIST and report pass/fail."
  (let* ((total (length test-list))
         (pass 0)
         (fail 0))
    (message "Running %d lisp tests..." total)
    (dolist (test test-list)
      (let* ((name     (nth 0 test))
             (expected (nth 1 test))
             (expr     (nth 2 test))
             (result   (run-lisp-test name expected expr))
             (ok       (car result))
             (actual   (cadr result)))
        (if ok
            (progn (setq pass (1+ pass))
                   (message "  [PASS] %s %s" name expr))
          (progn (setq fail (1+ fail))
                 (message "  [FAIL] %s %s" name expr)
                 (message "         expected: %s" expected)
                 (message "         got:      %s" actual)))))
    (message "---")
    (message "%d/%d passed" pass total)
    fail))

(let ((failures (run-lisp-tests lisp-tests)))
  (when (> failures 0)
    (ext:exit 1)))
