# Runs the CLI's '-m import' in a pseudo-terminal (a real terminal, as a user
# has): types the transfer folder, the OLD master password, the export token,
# the NEW master password and 'y', and reports whether any secret was echoed on
# screen and whether the note was imported.
# Usage: python3 pty_transfer.py <cli.js> <fakefetch.cjs> <drive.json> <folder> <token> <old-password> <new-password>
import os, pty, sys, time, select
CLI, FAKEFETCH, DRIVE, FOLDER, TOKEN, OLD, NEW = sys.argv[1:8]
pid, fd = pty.fork()
if pid == 0:
    os.environ["FAKE_DRIVE"] = DRIVE
    os.chdir(os.path.dirname(DRIVE))
    os.execvp("node", ["node", "-r", FAKEFETCH, CLI, "-m", "import"])
out = b""
def read_for(sec):
    global out
    end = time.time() + sec
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.1)
        if r:
            try: out += os.read(fd, 4096)
            except OSError: return
for answer, wait in ((FOLDER, 1.5), (OLD, 1.5), (TOKEN, 2.5), (NEW, 2.5), ("y", 2.5)):
    read_for(wait); os.write(fd, answer.encode() + b"\r")
read_for(6)
os.waitpid(pid, 0)
o = out.decode(errors="replace")
print(f"token visible: {TOKEN in o};  old password visible: {OLD in o};  new password visible: {NEW in o};  imported: {'Imported 1 of 1' in o}")
