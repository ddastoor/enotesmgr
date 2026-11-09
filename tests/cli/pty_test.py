# Spawns the CLI in a pseudo-terminal, types an export token and the master
# password, and reports whether the token was echoed on screen.
# Usage: python3 pty_test.py <original-cli.js> <current-cli.js> <fakefetch.cjs> <drive.json>
import os, pty, sys, time, select
FAKEFETCH, DRIVE = sys.argv[3], sys.argv[4]
def run(cli):
    pid, fd = pty.fork()
    if pid == 0:
        os.environ["FAKE_DRIVE"] = DRIVE
        os.chdir(os.path.dirname(DRIVE))
        os.execvp("node", ["node", "-r", FAKEFETCH, cli, "-m", "on"])
    out = b""
    def read_for(sec):
        nonlocal out
        end = time.time() + sec
        while time.time() < end:
            r, _, _ = select.select([fd], [], [], 0.1)
            if r:
                try: out += os.read(fd, 4096)
                except OSError: return
    read_for(1.5); os.write(fd, b"GOODTOKEN\r")
    read_for(1.5); os.write(fd, b"Master123\r")
    read_for(4)
    os.waitpid(pid, 0)
    return out.decode(errors="replace")
for label, cli in [("original", sys.argv[1]), ("new", sys.argv[2])]:
    o = run(cli)
    print(f"{label:9}: token visible on screen: {'GOODTOKEN' in o};  master password visible: {'Master123' in o};  export finished: {'Done.' in o}")
