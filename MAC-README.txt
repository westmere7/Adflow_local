RMIT Adflow — running this on a Mac
===================================

The double-click launchers in this folder are the .command files. The .bat
files beside them are for Windows; ignore those.

  run-electron.command    Run the desktop app from source (needs Node.js)
  build-app.command       Package the desktop app into dist/
  run-docker.command      Start the hosted version in Docker
  stop-docker.command     Stop it again

FIRST TIME ONLY: make them runnable
-----------------------------------
A Mac will not run a .command file it does not consider executable, and the
permission that marks it as such does not survive being checked out on Windows.
So the first time, open Terminal, drag this folder onto the window to fill in
its path, then run:

  chmod +x *.command

You only ever do this once per copy of the folder. After that, double-clicking
works normally.

"macOS cannot verify the developer of this app"
-----------------------------------------------
The desktop app is not code-signed yet, so Gatekeeper blocks it on first launch.
To allow it: right-click (or Control-click) the app, choose Open, then confirm.
macOS remembers the decision and later launches open normally. Only do this for
a copy you got from your own team.

Which one do I want?
--------------------
  - Working on ads yourself, on your own Mac      ->  the desktop app
  - Hosting Adflow for other people to open       ->  Docker

Both run the same application and produce identical files. The difference worth
knowing is that they keep SEPARATE storage: work autosaved in the desktop app
does not appear in the hosted one, or the other way round. To move a project
between them, use File > Save > Save to File (.flow) and open the file on the
other side.

More detail: ELECTRON.md (desktop) and DEPLOYMENT.md (hosting).
