"""Windows test stand-in for the POSIX fcntl module (no-op locks)."""
LOCK_SH = 1
LOCK_EX = 2
LOCK_NB = 4
LOCK_UN = 8
F_GETFL = 3
F_SETFL = 4


def flock(fd, operation):
    return None


def lockf(fd, cmd, len=0, start=0, whence=0):
    return None


def fcntl(fd, cmd, arg=0):
    return 0


def ioctl(fd, request, arg=0, mutate_flag=True):
    return 0
