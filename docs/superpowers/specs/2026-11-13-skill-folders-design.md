# Skill source folders

The user wants to understand plugin/version metadata and click a skill name to open the folder it ran from. Keep the event's recorded SKILL.md path, show it beneath the name, and group rows by name/plugin/version/path so identical names in different locations remain distinct. Rename the columns Source plugin and Plugin version, explaining that these describe the supplying plugin rather than a skill's own version. Missing metadata remains explicit; do not infer a plugin from the path.

Use a button styled as a link to call a local API that revalidates the row against the currently enabled sources, then opens the containing directory in the OS file manager. A localhost canvas cannot reliably navigate to file URLs. Accept a report row ID, not a caller-supplied filesystem path. Only open existing local absolute paths named SKILL.md; launch the file manager with an argument array and no shell. Copied logs from another OS, remote paths, missing files, and unknown paths produce a readable message. No file contents are opened or executed.

This deliberately adds paths to retained activation metadata, as requested; skill definitions and arguments remain discarded. Update the privacy description and release version. Reuse the existing table, styles, API security checks, and scanner.
