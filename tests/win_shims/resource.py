"""Windows test stand-in for the POSIX resource module."""
RLIMIT_NOFILE = 7
RLIM_INFINITY = -1


class error(OSError):
    pass


def getrlimit(resource):
    return (1024, 4096)


def setrlimit(resource, limits):
    return None
