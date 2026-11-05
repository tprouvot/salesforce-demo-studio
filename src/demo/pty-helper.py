"""Runs one command in a pseudo-terminal, for the terminal windows of sfdemo demos (macOS and Linux).

    python3 pty-helper.py <cols> <rows> <program> [args...]

What the program prints goes to stdout as a terminal would show it (colours, spinners); what comes on stdin is
typed into the terminal (Ctrl+C as \\x03 interrupts the program, as in a real terminal). The exit code is the
program's. SIGTERM ends the program's whole process group.
"""
import errno
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios


def main():
    cols, rows, argv = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3:]
    pid, fd = pty.fork()
    if pid == 0:
        try:
            fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
        except OSError:
            pass
        try:
            os.execvp(argv[0], argv)
        except OSError as e:
            os.write(2, ('%s: %s\n' % (argv[0], e.strerror)).encode())
            os._exit(127)

    def stop(signum, frame):
        for sig in (signal.SIGHUP, signal.SIGTERM):
            try:
                os.killpg(pid, sig)
            except OSError:
                pass
        os._exit(143)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGHUP, stop)

    def write_all(target, data):
        while data:
            try:
                n = os.write(target, data)
            except OSError as e:
                if e.errno == errno.EINTR:
                    continue
                return
            data = data[n:]

    stdin_open = True
    status = None
    while True:
        watch = [fd] + ([0] if stdin_open else [])
        try:
            ready, _, _ = select.select(watch, [], [], 0.1)
        except InterruptedError:
            continue
        if fd in ready:
            try:
                data = os.read(fd, 65536)
            except OSError:
                data = b''
            if not data:
                break
            write_all(1, data)
        if 0 in ready:
            data = os.read(0, 65536)
            if data:
                write_all(fd, data)
            else:
                stdin_open = False
        if not ready and status is None:
            done, st = os.waitpid(pid, os.WNOHANG)
            if done:
                status = st
                # what is still buffered, then stop (a child left in the background must not hold the window)
                while True:
                    r, _, _ = select.select([fd], [], [], 0.05)
                    if not r:
                        break
                    try:
                        data = os.read(fd, 65536)
                    except OSError:
                        data = b''
                    if not data:
                        break
                    write_all(1, data)
                break
    if status is None:
        _, status = os.waitpid(pid, 0)
    if os.WIFEXITED(status):
        sys.exit(os.WEXITSTATUS(status))
    sys.exit(128 + os.WTERMSIG(status) if os.WIFSIGNALED(status) else 1)


if __name__ == '__main__':
    main()
