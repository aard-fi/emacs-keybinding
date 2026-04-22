#!/usr/bin/emacs --script

(require 'org)
(require 'vc-git)
(require 'json)

(defun get-git-info ()
  "Get Git metadata using Emacs built-in VC-Git.

Returns a list with information:
  :last-tag is the last tag found
  :head-is-tagged returns t if HEAD has a tag, nil otherwise
  :tag-on-head returns the tag on HEAD, nil otherwise
  :count returns the commit count since last tag
  :hash returns the hash of HEAD"
  (let* ((last-tag (with-temp-buffer
                    (vc-git-command t nil nil "describe" "--tags" "--abbrev=0")
                    (goto-char (point-min))
                    (if (re-search-forward "[^\n]+" nil t) (match-string 0) "none")))
        (head-tag (with-temp-buffer
                    (vc-git-command t nil nil "tag" "--points-at" "HEAD")
                    (goto-char (point-min))
                    (if (re-search-forward "[^\n]+" nil t) (match-string 0) nil)))
        (count    (with-temp-buffer
                    (vc-git-command t nil nil "rev-list" "--count" (concat last-tag "..HEAD"))
                    (goto-char (point-min))
                    (if (re-search-forward "[0-9]+" nil t) (match-string 0) "0")))
        (rev-hash (with-temp-buffer
                    (vc-git-command t nil nil "rev-parse" "HEAD")
                    (goto-char (point-min))
                    (if (re-search-forward "[^\n]+" nil t) (match-string 0) "unknown"))))
    (list :last-tag last-tag
          :head-is-tagged (if head-tag t nil)
          :tag-on-head head-tag
          :count count
          :hash rev-hash)))

(defun update-manifest-version (git-info manifest-path is-chrome)
  "Update version and version_name in manifest-path using git-info.

This marks developer version, and can handle differences for chrome and
firefox - so eventually we might be able to build both archives from a single
run."
  (let* ((tag      (plist-get git-info :last-tag))
         (on-tag   (plist-get git-info :head-tag))
         (count    (plist-get git-info :count))
         (hash     (plist-get git-info :hash))
         (manifest (json-read-file manifest-path)))

    (if is-chrome
        ;; chrome: set version and version_name
        (let ((version-name (build-version-name git-info)))
          (setf (alist-get 'version manifest) tag)
          (setf (alist-get 'version_name manifest) version-name))
      ;; firefox: remove version name, add 4th digit for developer builds
      (let ((version-number (if (or on-tag (string= count "0"))
                       tag
                     (format "%s.%s" tag count))))
        (setf (alist-get 'version manifest) version-number)
        ;; remove version_name if it exists
        (setf manifest (assq-delete-all 'version_name manifest))))

    (with-temp-file manifest-path
      (let ((json-encoding-pretty-print t))
        (insert (json-encode manifest))))
        (message "Updated %s for %s" manifest-path (if is-chrome "Chrome" "Firefox"))))

(defun build-version-name (git-info)
  "Build the version name from the git info string"
  (let* ((tag      (plist-get git-info :last-tag))
         (on-tag   (plist-get git-info :head-tag))
         (count    (plist-get git-info :count))
         (hash     (plist-get git-info :hash)))
    (if on-tag tag (format "%s-dev.%s.%s" tag count hash))))

(defun make-html()
  "Export all org files to html. This expects files to have #+EXPORT_FILE_NAME: set correctly."
  (let ((org-files (directory-files-recursively "." (rx ".org"))))
    (mapcar (lambda (file)
              (let ((default-directory (file-name-directory (expand-file-name file))))
                (with-temp-buffer
                  (insert-file-contents (file-name-nondirectory file))
                  (org-mode)
                  (org-html-export-to-html)))) org-files)))

(defun make-zip(is-chrome)
  "Pack up everything that should be part of the extension in a zip file. Zip
output will be available in the *zip* buffer. Also updates manifest.json with
version info from git tags."
  (let* ((git-info (get-git-info))
         (zip-name (format "../Emacs-keybinding-%s-%s.zip"
                           (build-version-name git-info)
                           (if is-chrome "chrome" "firefox")))
        (zip-files))
    (when git-info
      (update-manifest-version git-info "manifest.json" is-chrome))
    (setq zip-files (directory-files-recursively "." (rx (or ".html" ".js" ".json" ".png" "icons" "LICENSE"))))
    (apply #'call-process "zip" nil "*zip*" nil "-r" "-FS" zip-name (append zip-files))))

(message "Building html pages...")
(make-html)
(message "Building zip...")
(make-zip nil)
(make-zip t)
