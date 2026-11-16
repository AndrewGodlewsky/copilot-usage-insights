# Compact refresh feedback

Approved: prototype A (rotating refresh arrow), with less horizontal space. Reference: `refresh-button-prototypes-71ca.html` in the chat scratch folder.

The header and footer refresh controls show a small rotating arrow and “Refreshing…” during the existing report load. After an explicit successful refresh, briefly show a check and “Updated”, then restore “Refresh”. Failed loads restore the available control without claiming success. Queued filter changes must settle before feedback finishes.

Use intrinsic sizing with compact padding, reserving only the longest label and icon so surrounding controls do not shift. Keep the footer's link styling. Use the existing blue/teal theme accents, visible focus, accessible status, and static feedback under reduced motion. No screen overlay, extra requests, dependencies, or changes to refresh cadence.

Alternatives shown: a moving underline and animated dots. The user selected the recognizable rotating arrow. Only real completion changes the status; no artificial delay before showing data.

Check delayed success, unchanged responses, failed fetches, queued loads, repeated refreshes, and clearing the success timer. Build and run the full suite for the release. Visual size and animation checks remain manual under the user's browser restriction.
