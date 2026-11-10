# Spawns the CLI's '-m sensitive' mode in a pseudo-terminal (a real terminal, as
# a user has), types a note password, and reports whether it was echoed on
# screen and whether the note was decrypted.
# Usage: python3 pty_sensitive.py <cli.js> <file.sensitive> <password> <work-dir>
import os, pty, sys, time, select
CLI, FILE, PASSWORD, WORK = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
pid, fd = pty.fork()
if pid == 0:
    os.chdir(WORK)
    os.execvp("node", ["node", CLI, "-m", "sensitive", "-s", FILE])
out = b""
def read_for(sec):
    global out
    end = time.time() + sec
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.1)
        if r:
            try: out += os.read(fd, 4096)
            except OSError: return
read_for(1.5); os.write(fd, PASSWORD.encode() + b"\r")
read_for(4)
os.waitpid(pid, 0)
o = out.decode(errors="replace")
print(f"password visible on screen: {PASSWORD in o};  prompt shown: {'Password for' in o};  decrypted: {'Decrypted 1 of 1' in o}")
