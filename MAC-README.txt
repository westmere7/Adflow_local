RMIT Adflow — running this on a Mac
===================================

The double-click launchers in this folder are the .command files. The .bat
files beside them are for Windows; ignore those.

  run-server.command      Run Adflow in your browser at http://localhost:8080/
                          (Node.js for live reload; falls back to Python)
  run-electron.command    Run the desktop app from source (needs Node.js)
  build-app.command       Package the desktop app into dist/

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
The desktop app is not code-signed with an Apple Developer ID yet, so Gatekeeper
blocks it on first launch. To allow it:

  macOS 15 (Sequoia) and later
    Try to open the app once and dismiss the warning. Then open System Settings >
    Privacy & Security, scroll to Security, click "Open Anyway" next to
    RMIT Adflow, and confirm.

  macOS 14 and earlier
    Right-click (or Control-click) the app, choose Open, then confirm.

macOS remembers the decision and later launches open normally. Only do this for
a copy you got from your own team.

Get the build that matches the Mac: "mac-arm64" for Apple Silicon (M1 and later),
"mac-x64" for older Intel Macs. Unzip it, then move "RMIT Adflow.app" wherever you
like (Applications is fine).

Where your work is kept
-----------------------
On this Mac, by this copy of the app. It does not sync, and it does not follow
you to another computer. To move a project, use File > Save > Save to File
(.flow) and open that file on the other machine.

More detail: ELECTRON.md.
