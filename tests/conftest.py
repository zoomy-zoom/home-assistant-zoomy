"""Shared test set-up.

On Windows only: asyncio makes its self-pipe with an AF_INET socketpair on
127.0.0.1, which the socket guard of pytest-homeassistant-custom-component
(it allows unix sockets only) refuses, so the guard is switched off there.
Home Assistant itself does not run on Windows; Linux runs keep the guard.
"""

import sys

if sys.platform == "win32":
    import pytest_socket

    pytest_socket.disable_socket = lambda *args, **kwargs: None
